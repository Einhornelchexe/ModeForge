import assert from "node:assert/strict";
import test from "node:test";

import {
  applySphericalSurfacePhase,
  applyThinLensPhase,
  createGaussianField,
  surfacePhaseSamplingWarnings,
  type ScalarField,
} from "../../packages/field/src/index.ts";
import { runHeadlessJob, type FieldBeamlineJobResult } from "../../packages/api/src/index.ts";

function uniformField(n: number, dxMm: number, wavelengthUm: number): ScalarField {
  const base = createGaussianField({ nx: n, ny: n, dxMm, dyMm: dxMm, wavelengthUm, waistRadiusMm: 1 });
  return { ...base, real: base.real.map(() => 1), imag: base.imag.map(() => 0) };
}

function phaseAt(field: ScalarField, xIndex: number, yIndex: number): number {
  const idx = yIndex * field.nx + xIndex;
  return Math.atan2(field.imag[idx], field.real[idx]);
}

function wrapPi(value: number): number {
  let v = value % (2 * Math.PI);
  if (v > Math.PI) v -= 2 * Math.PI;
  if (v < -Math.PI) v += 2 * Math.PI;
  return v;
}

const LAMBDA_UM = 1.064;
const K0 = (2 * Math.PI) / (LAMBDA_UM / 1000);

test("S14 real-sag mask matches the analytic spherical sag phase exactly", () => {
  const n = 65; // odd -> integer centre pixel
  const dx = 0.05;
  const field = uniformField(n, dx, LAMBDA_UM);
  const out = applySphericalSurfacePhase(field, 50, 1, 1.5);
  const cy = (n - 1) / 2;
  for (const offset of [3, 10, 20, 30]) {
    const r = offset * dx;
    const sag = 50 - Math.sqrt(50 * 50 - r * r);
    const expected = wrapPi(K0 * (1 - 1.5) * sag);
    const actual = phaseAt(out, cy + offset, cy);
    assert.ok(Math.abs(wrapPi(actual - expected)) < 1e-9, `r=${r}: expected ${expected}, got ${actual}`);
  }
  // negative radius mirrors the sign
  const outNeg = applySphericalSurfacePhase(field, -50, 1.5, 1);
  const rTest = 20 * dx;
  const sagNeg = -50 + Math.sqrt(50 * 50 - rTest * rTest);
  const expectedNeg = wrapPi(K0 * (1.5 - 1) * sagNeg);
  assert.ok(Math.abs(wrapPi(phaseAt(outNeg, cy + 20, cy) - expectedNeg)) < 1e-9);
});

test("S14 surface pair reproduces the ideal thin lens paraxially and the r^4 aberration term quantitatively", () => {
  const n = 65;
  const dx = 0.05;
  const field = uniformField(n, dx, LAMBDA_UM);
  const pair = applySphericalSurfacePhase(applySphericalSurfacePhase(field, 50, 1, 1.5), -50, 1.5, 1);
  const ideal = applyThinLensPhase(field, 50); // 1/f = (n-1)(1/R1 - 1/R2) = 0.02
  const cy = (n - 1) / 2;
  // paraxial region: difference is tiny
  for (const offset of [2, 4, 6]) {
    const diff = wrapPi(phaseAt(pair, cy + offset, cy) - phaseAt(ideal, cy + offset, cy));
    assert.ok(Math.abs(diff) < 1e-3, `paraxial residual at offset ${offset}: ${diff}`);
  }
  // at larger r the residual must equal the model's own 4th-order sag term:
  // both surfaces contribute -k * dn * r^4/(8 R^3) with dn = 0.5 -> total -k r^4/(8 * 50^3) * 1
  for (const offset of [24, 30]) {
    const r = offset * dx;
    const predicted = wrapPi(-(K0 * r ** 4) / (8 * 50 ** 3));
    const actual = wrapPi(phaseAt(pair, cy + offset, cy) - phaseAt(ideal, cy + offset, cy));
    assert.ok(
      Math.abs(actual - predicted) < Math.abs(predicted) * 0.02 + 1e-4,
      `r=${r}: predicted r^4 residual ${predicted}, got ${actual}`,
    );
  }
});

function runBeamline(surfacePhase: "ideal" | "real-sag"): FieldBeamlineJobResult {
  const job = runHeadlessJob({
    kind: "field-beamline",
    input: {
      beamline: {
        version: "0.1",
        beam: { kind: "gaussian", wavelengthUm: LAMBDA_UM, waistRadiusMm: 0.3, waistPositionMm: 0 },
        components: [
          { id: "d1", kind: "free-space", lengthMm: 20 },
          { id: "TL", kind: "thick-lens", radius1Mm: 50, radius2Mm: -50, thicknessMm: 5, refractiveIndex: 1.5, apertureRadiusMm: 12 },
          { id: "d2", kind: "free-space", lengthMm: 60 },
        ],
      },
      grid: { nx: 64, ny: 64, dxMm: 0.04, dyMm: 0.04 },
      probesZmm: [45, 85],
      surfacePhase,
    },
  });
  assert.equal(job.ok, true);
  if (!job.ok || job.value.kind !== "field-beamline") throw new Error("expected field-beamline result");
  return job.value.result;
}

test("S14 real-sag matches the analytic paraxial envelope at low NA (and beats the ideal-EFL mask)", () => {
  const ideal = runBeamline("ideal");
  const real = runBeamline("real-sag");
  // z = 85 mm is a grid point of the analytic result (end of the beamline)
  const zIndex = real.analytical.zGridMm.indexOf(85);
  assert.ok(zIndex >= 0);
  const analytic = real.analytical.envelope.radiusXmm[zIndex];
  const realProbe = real.probes.find((p) => p.zMm === 85);
  const idealProbe = ideal.probes.find((p) => p.zMm === 85);
  assert.ok(realProbe && idealProbe);
  const realDev = Math.abs(realProbe.radiusXmm - analytic) / analytic;
  const idealDev = Math.abs(idealProbe.radiusXmm - analytic) / analytic;
  // the sag pair with internal t/n IS the paraxial thick lens -> sub-percent
  assert.ok(realDev < 0.01, `real-sag vs analytic deviation ${realDev}`);
  // the single-EFL-at-front-vertex "ideal" mask has wrong principal planes,
  // so at this geometry it must deviate MORE than the real-sag chain
  assert.ok(realDev < idealDev, `expected real-sag (${realDev}) closer to analytic than ideal (${idealDev})`);
});

test("S14 sampling guard warns for an undersampled sag mask and stays silent when resolved", () => {
  const coarse = uniformField(64, 0.05, LAMBDA_UM);
  const aliased = surfacePhaseSamplingWarnings(coarse, 50, 1, 1.5, 5);
  assert.ok(aliased.some((w) => w.code === "FIELD_SAMPLING_LOW" && w.severity === "warning" && w.message.includes("undersampled")));
  const fine = uniformField(64, 0.025, LAMBDA_UM);
  const clean = surfacePhaseSamplingWarnings(fine, 50, 1, 1.5, 1);
  assert.equal(clean.length, 0);
  const hemisphere = surfacePhaseSamplingWarnings(fine, 4, 1, 1.5, 5);
  assert.ok(hemisphere.some((w) => w.message.includes("hemisphere")));
});

test("S14 sampling guard downgrades margin-only aliasing to info when the beam is small", () => {
  // small Gaussian beam, large aperture: mask aliases only far outside the beam
  const beam = createGaussianField({ nx: 64, ny: 64, dxMm: 0.05, dyMm: 0.05, wavelengthUm: LAMBDA_UM, waistRadiusMm: 0.3 });
  const result = surfacePhaseSamplingWarnings(beam, 50, 1, 1.5, 12);
  assert.equal(result.filter((w) => w.severity === "warning").length, 0);
  assert.ok(result.some((w) => w.severity === "info" && w.message.includes("beyond")));
  // explicit beam radius override behaves identically
  const overridden = surfacePhaseSamplingWarnings(beam, 50, 1, 1.5, 12, 0.3);
  assert.ok(overridden.some((w) => w.severity === "info"));
  assert.equal(overridden.filter((w) => w.severity === "warning").length, 0);
});
