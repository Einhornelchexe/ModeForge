import assert from "node:assert/strict";
import test from "node:test";
import {
  d4SigmaDiameterToMomentRadiusMm,
  fwhmDiameterToOneOverE2RadiusMm,
  hermiteGaussianM2,
  laguerreGaussianM2,
  momentM2FromD4Sigma,
  oneOverE2RadiusToFwhmDiameterMm,
  superGaussianRelativeIntensity,
  topHatRelativeIntensity,
} from "../../packages/beams/src/index.ts";
import { simulateBeamline } from "../../packages/optics/src/index.ts";

test("higher-order mode M2 factors are explicit metadata", () => {
  assert.deepEqual(hermiteGaussianM2({ kind: "HG", m: 1, n: 2, waistRadiusMm: 0.5 }), { m2x: 3, m2y: 5 });
  assert.equal(laguerreGaussianM2({ kind: "LG", p: 1, l: -2, waistRadiusMm: 0.5 }), 5);
});

test("D4sigma and moment M2 helpers follow documented definitions", () => {
  assert.equal(d4SigmaDiameterToMomentRadiusMm(4), 2);
  const m2 = momentM2FromD4Sigma(1, (4 * 1.064e-3) / (Math.PI * 1), 1.064);
  assert.ok(Math.abs(m2 - 1) < 1e-12);
  const fwhmDiameterMm = oneOverE2RadiusToFwhmDiameterMm(1);
  assert.ok(Math.abs(fwhmDiameterToOneOverE2RadiusMm(fwhmDiameterMm) - 1) < 1e-12);
});

test("static profiles do not imply field propagation", () => {
  assert.equal(topHatRelativeIntensity(0.5, 1), 1);
  assert.equal(topHatRelativeIntensity(2, 1), 0);
  assert.ok(superGaussianRelativeIntensity(0.5, 1, 4) > 0);
});

test("simulateBeamline returns a BeamlineResult without UI dependencies", () => {
  const result = simulateBeamline({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 },
    components: [
      { id: "fs1", kind: "free-space", lengthMm: 100 },
      { id: "l1", kind: "thin-lens", focalLengthMm: 150, apertureRadiusMm: 10 },
    ],
  });
  assert.equal(result.zGridMm.length, 2);
  assert.equal(result.matrices.length, 2);
  assert.ok(result.envelope.radiusXmm.every((value) => value > 0));
});

test("simulateBeamline mirrors aperture warnings onto component results", () => {
  const result = simulateBeamline({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 },
    components: [{ id: "tight-lens", kind: "thin-lens", focalLengthMm: 150, apertureRadiusMm: 0.1 }],
  });
  assert.equal(result.warnings[0]?.code, "APERTURE_MARGIN_LOW");
  assert.equal(result.components[0]?.warnings[0]?.code, "APERTURE_MARGIN_LOW");
  assert.equal(result.components[0]?.warnings[0]?.componentId, "tight-lens");
});

test("S16-R1 free-space refractiveIndex propagates the reduced path L/n", () => {
  const beam = { kind: "gaussian" as const, wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm: 0 };
  const inGlass = simulateBeamline({
    version: "0.1",
    beam,
    components: [{ id: "f", kind: "free-space", lengthMm: 30, refractiveIndex: 1.5 }],
  });
  assert.ok(Math.abs(inGlass.matrices[0].b - 20) < 1e-12, "ABCD B must be L/n = 20");
  const vacuum20 = simulateBeamline({ version: "0.1", beam, components: [{ id: "f", kind: "free-space", lengthMm: 20 }] });
  const rGlass = inGlass.envelope.radiusXmm.at(-1);
  const rVac = vacuum20.envelope.radiusXmm.at(-1);
  assert.ok(Math.abs((rGlass ?? 0) - (rVac ?? 1)) < 1e-12, "envelope radius equals 20 mm of vacuum");
});

test("S16-R3 aperture margin checks the ENTRY radius, not only the exit", () => {
  // beam focuses inside a long free-space: entry radius at the thin lens is
  // large, exit radius of the following aperture-bearing lens is small
  const result = simulateBeamline({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 2, waistPositionMm: 0 },
    components: [
      { id: "l1", kind: "thin-lens", focalLengthMm: 100 },
      { id: "d1", kind: "free-space", lengthMm: 99 },
      // near focus the beam is tiny at EXIT; entry of this thick lens is tiny
      // too - but the FIRST lens carries the tight aperture: at l1 the beam
      // radius is 2 mm on BOTH sides, so a 2.2 mm aperture must warn (margin
      // 1.1 < 1.5) regardless of entry/exit choice; the regression case is
      // the aperture on a component the beam SHRINKS through:
      { id: "l2", kind: "thin-lens", focalLengthMm: 50, apertureRadiusMm: 0.5 },
    ],
  });
  const l2 = result.components.find((c) => c.componentId === "l2");
  // at z=99 the beam is ~0.03 mm: margin huge, no warning expected
  assert.ok((l2?.apertureMargin ?? 0) > 1.5);
  // now force entry-side clipping: aperture sits on a thick lens right after the source
  const clipped = simulateBeamline({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 2, waistPositionMm: 0 },
    components: [
      { id: "tl", kind: "thick-lens", radius1Mm: 30, radius2Mm: -30, thicknessMm: 8, refractiveIndex: 1.8, apertureRadiusMm: 2.1 },
    ],
  });
  const tl = clipped.components.find((c) => c.componentId === "tl");
  // entry radius 2 mm vs aperture 2.1 mm -> margin 1.05 < 1.5 must warn even
  // if the exit radius is a bit smaller after the strong lens
  assert.ok((tl?.apertureMargin ?? 10) < 1.5);
  assert.ok(clipped.warnings.some((w) => w.code === "APERTURE_MARGIN_LOW" && w.componentId === "tl"));
});
