import assert from "node:assert/strict";
import test from "node:test";
import { relativeError } from "../../packages/core/src/index.ts";
import {
  determinant,
  divideComplex,
  freeSpaceMatrix,
  gaussianRadiusAtZ,
  multiplyMatrices,
  paraxialCard,
  qAtWaist,
  qAtZ,
  radiusFromQ,
  rayleighRangeMm,
  simulateBeamline,
  surfaceStackMatrix,
  thickSphericalLensStack,
  thinLensMatrix,
  transformQ,
  waistFromQ,
} from "../../packages/optics/src/index.ts";
import { gaussianReference } from "../../packages/validation/src/index.ts";

test("Gaussian free-space propagation matches analytical radius", () => {
  assert.ok(relativeError(rayleighRangeMm(0.5, 1.064), gaussianReference.expectedRayleighRangeMm) < 1e-14);
  assert.ok(relativeError(gaussianRadiusAtZ(100, 0.5, 1.064), gaussianReference.expectedRadiusAt100Mm) < 1e-14);
});

test("thin lens q transform follows ABCD formula", () => {
  const qIn = qAtWaist(0.5, 1.064);
  const qOut = transformQ(qIn, thinLensMatrix(100));
  const expected = divideComplex(qIn, { re: 1 - qIn.re / 100, im: -qIn.im / 100 });
  assert.ok(relativeError(qOut.re, expected.re) < 1e-12);
  assert.ok(relativeError(qOut.im, expected.im) < 1e-12);
});

test("free-space and thin-lens matrices are symplectic in air", () => {
  assert.equal(determinant(freeSpaceMatrix(10)), 1);
  assert.equal(determinant(thinLensMatrix(100)), 1);
});

test("matrix helpers enforce finite physical inputs", () => {
  assert.throws(() => freeSpaceMatrix(Number.NaN), /lengthMm/);
  assert.throws(() => thinLensMatrix(0), /focalLengthMm/);
  assert.throws(() => determinant({ a: 1, b: 0, c: 0, d: Number.POSITIVE_INFINITY }), /matrix\.d/);
  const left = thinLensMatrix(100);
  const right = freeSpaceMatrix(50);
  assert.ok(relativeError(determinant(multiplyMatrices(left, right)), determinant(left) * determinant(right)) < 1e-12);
});

test("plane-parallel slab uses reduced optical B term while retaining physical length", () => {
  const result = simulateBeamline({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 },
    components: [{ id: "slab", kind: "slab", thicknessMm: 10, refractiveIndex: 1.5 }],
  });
  assert.equal(result.zGridMm.at(-1), 10);
  assert.ok(relativeError(result.matrices[0]?.b ?? 0, 10 / 1.5) < 1e-12);
});

test("qAtZ, radiusFromQ, and waistFromQ are internally consistent", () => {
  const q = qAtZ(25, 0.4, 1.064, 1.3);
  assert.ok(relativeError(radiusFromQ(q, 1.064, 1.3), gaussianRadiusAtZ(25, 0.4, 1.064, 1.3)) < 1e-12);
  const waist = waistFromQ(q, 1.064, 1.3);
  assert.ok(relativeError(waist.waistRadiusMm, 0.4) < 1e-12);
  assert.ok(relativeError(waist.waistOffsetMm, -25) < 1e-12);
});

test("thick spherical lens paraxial EFL is near lensmaker value", () => {
  const stack = thickSphericalLensStack({
    id: "lens",
    radius1Mm: 50,
    radius2Mm: -50,
    thicknessMm: 5,
    refractiveIndex: 1.5,
  });
  const card = paraxialCard(stack);
  const lensmakerPower = (1.5 - 1) * (1 / 50 - 1 / -50 + ((1.5 - 1) * 5) / (1.5 * 50 * -50));
  const expectedEfl = 1 / lensmakerPower;
  assert.ok(card.effectiveFocalLengthMm !== undefined);
  assert.ok(card.effectiveFocalLengthMm > 0);
  assert.ok(relativeError(card.effectiveFocalLengthMm, expectedEfl) < 0.03);
  assert.ok(relativeError(determinant(surfaceStackMatrix(stack)), 1) < 1e-12);
});

test("surface stacks reject nonphysical media and negative thickness", () => {
  const stack = thickSphericalLensStack({
    id: "bad-lens",
    radius1Mm: "Infinity",
    radius2Mm: "Infinity",
    thicknessMm: 1,
    refractiveIndex: 1.5,
  });
  stack.surfaces[0].thicknessAfterMm = -1;
  assert.throws(() => surfaceStackMatrix(stack), /thicknessAfterMm/);

  const badMedium = thickSphericalLensStack({
    id: "bad-medium",
    radius1Mm: "Infinity",
    radius2Mm: "Infinity",
    thicknessMm: 1,
    refractiveIndex: 0,
  });
  assert.throws(() => surfaceStackMatrix(badMedium), /refractiveIndexAfter/);
});
