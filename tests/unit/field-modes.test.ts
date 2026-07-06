import assert from "node:assert/strict";
import test from "node:test";

import {
  createGaussianField,
  createModeFieldAtPlane,
  fieldMomentRadii,
  fieldPower,
  propagateFresnel,
} from "../../packages/field/src/index.ts";
import { gaussianRadiusAtZ, runHeadlessJob } from "../../packages/api/src/index.ts";

const GRID = { nx: 128, ny: 128, dxMm: 0.03, dyMm: 0.03, wavelengthUm: 1.064 };

test("S17 HG(0,0) mode equals the fundamental Gaussian exactly (same power convention)", () => {
  const mode = createModeFieldAtPlane({ ...GRID, radiusXmm: 0.4, mode: { kind: "HG", m: 0, n: 0 } });
  const gauss = createGaussianField({ ...GRID, waistRadiusMm: 0.4 });
  for (let i = 0; i < mode.real.length; i += 17) {
    assert.ok(Math.abs(mode.real[i] - gauss.real[i]) < 1e-9);
    assert.ok(Math.abs(mode.imag[i]) < 1e-12);
  }
  // power convention: pi*wx*wy/2 like the peak-1 fundamental
  assert.ok(Math.abs(fieldPower(mode) - (Math.PI * 0.4 * 0.4) / 2) < 1e-6, String(fieldPower(mode)));
});

test("S17 HG second-moment radii follow w*sqrt(2m+1) per axis", () => {
  const w = 0.35;
  const mode = createModeFieldAtPlane({ ...GRID, radiusXmm: w, mode: { kind: "HG", m: 3, n: 1 } });
  const radii = fieldMomentRadii(mode);
  assert.ok(Math.abs(radii.radiusXmm - w * Math.sqrt(7)) / (w * Math.sqrt(7)) < 5e-3, `x ${radii.radiusXmm}`);
  assert.ok(Math.abs(radii.radiusYmm - w * Math.sqrt(3)) / (w * Math.sqrt(3)) < 5e-3, `y ${radii.radiusYmm}`);
});

test("S17 LG second-moment radius follows w*sqrt(2p+|l|+1), isotropic, unit power", () => {
  const w = 0.35;
  const mode = createModeFieldAtPlane({ ...GRID, radiusXmm: w, mode: { kind: "LG", p: 1, l: 2 } });
  const radii = fieldMomentRadii(mode);
  const expected = w * Math.sqrt(5);
  assert.ok(Math.abs(radii.radiusXmm - expected) / expected < 5e-3, `x ${radii.radiusXmm}`);
  assert.ok(Math.abs(radii.radiusXmm - radii.radiusYmm) / expected < 1e-6, "isotropy");
  assert.ok(Math.abs(fieldPower(mode) - (Math.PI * w * w) / 2) < 1e-6, "fundamental-equivalent power");
});

test("S17 orthogonality: HG(1,0) is discretely orthogonal to HG(0,0)", () => {
  const a = createModeFieldAtPlane({ ...GRID, radiusXmm: 0.4, mode: { kind: "HG", m: 1, n: 0 } });
  const b = createModeFieldAtPlane({ ...GRID, radiusXmm: 0.4, mode: { kind: "HG", m: 0, n: 0 } });
  let overlap = 0;
  for (let i = 0; i < a.real.length; i += 1) overlap += a.real[i] * b.real[i] + a.imag[i] * b.imag[i];
  assert.ok(Math.abs(overlap) < 1e-10, `overlap ${overlap}`);
});

test("S17 free-space propagation is self-similar: moment radius follows the M2 envelope", () => {
  // embedded waist w0 = 0.25, HG(2,0): W0 = w0*sqrt(5), M2 = 5
  const w0 = 0.25;
  const mode = createModeFieldAtPlane({ nx: 160, ny: 160, dxMm: 0.035, dyMm: 0.035, wavelengthUm: 1.064, radiusXmm: w0, mode: { kind: "HG", m: 2, n: 0 } });
  const w0Measured = fieldMomentRadii(mode).radiusXmm;
  const z = 120;
  const out = propagateFresnel(mode, z);
  const measured = fieldMomentRadii(out).radiusXmm;
  const expected = gaussianRadiusAtZ(z, w0Measured, 1.064, 5);
  assert.ok(Math.abs(measured - expected) / expected < 0.01, `W(z) ${measured} vs ${expected}`);
});

test("S17 field-beamline job renders a true mode source through the beamline", () => {
  const job = runHeadlessJob({
    kind: "field-beamline",
    input: {
      beamline: {
        version: "0.1",
        beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.25, waistPositionMm: 0, m2: 5 },
        components: [{ id: "d", kind: "free-space", lengthMm: 120 }],
      },
      grid: { nx: 160, ny: 160, dxMm: 0.02, dyMm: 0.02 },
      probesZmm: [0, 120],
      sourceMode: { kind: "HG", m: 2, n: 0 },
    },
  });
  assert.equal(job.ok, true);
  if (!job.ok || job.value.kind !== "field-beamline") throw new Error("expected field-beamline");
  const result = job.value.result;
  // ISO semantics: the beam waist IS the mode's measured waist
  const w0Expected = 0.25;
  assert.ok(Math.abs(result.probes[0].radiusXmm - w0Expected) / w0Expected < 5e-3, `probe0 ${result.probes[0].radiusXmm}`);
  const envelopeEnd = result.analytical.envelope.radiusXmm.at(-1) ?? Number.NaN;
  assert.ok(Math.abs(result.probes[1].radiusXmm - envelopeEnd) / envelopeEnd < 0.015, `probe ${result.probes[1].radiusXmm} vs envelope ${envelopeEnd}`);
  assert.ok(result.warnings.some((w) => w.message.includes("Mode source HG(2,0)")));
});


test("S17-R2 LG from an elliptical source is fully circularized (envelope and wavefront)", () => {
  const mode = createModeFieldAtPlane({
    ...GRID,
    radiusXmm: 0.3,
    radiusYmm: 0.6,
    wavefrontRadiusXmm: 200,
    wavefrontRadiusYmm: 900,
    mode: { kind: "LG", p: 0, l: 1 },
  });
  const radii = fieldMomentRadii(mode);
  assert.ok(Math.abs(radii.radiusXmm - radii.radiusYmm) / radii.radiusXmm < 1e-6, "must stay isotropic");
});

test("S17-R2 field-fresnel mode source uses ISO waist semantics", () => {
  const job = runHeadlessJob({
    kind: "field-fresnel",
    input: {
      gaussian: { nx: 128, ny: 128, dxMm: 0.03, dyMm: 0.03, wavelengthUm: 1.064, waistRadiusMm: 0.4 },
      distanceMm: 1e-6,
      mode: { kind: "HG", m: 2, n: 0 },
    },
  });
  assert.equal(job.ok, true);
  if (!job.ok || job.value.kind !== "field-fresnel") throw new Error("expected field-fresnel");
  // the entered waist IS the measured second-moment radius (not embedded*sqrt5)
  assert.ok(Math.abs(job.value.result.momentRadiusXmm - 0.4) / 0.4 < 5e-3, String(job.value.result.momentRadiusXmm));
});

test("S17-R2 elliptical beam with equal M2 propagates with the effective-wavelength envelope", () => {
  const job = runHeadlessJob({
    kind: "field-beamline",
    input: {
      beamline: {
        version: "0.1",
        beam: {
          kind: "elliptical-gaussian",
          wavelengthUm: 1.064,
          waistRadiusXmm: 0.25,
          waistRadiusYmm: 0.25,
          waistPositionXmm: 0,
          waistPositionYmm: 0,
          m2x: 2,
          m2y: 2,
        },
        components: [{ id: "d", kind: "free-space", lengthMm: 150 }],
      },
      grid: { nx: 160, ny: 160, dxMm: 0.025, dyMm: 0.025 },
      probesZmm: [150],
    },
  });
  assert.equal(job.ok, true);
  if (!job.ok || job.value.kind !== "field-beamline") throw new Error("expected field-beamline");
  const result = job.value.result;
  const envelopeEnd = result.analytical.envelope.radiusXmm.at(-1) ?? Number.NaN;
  assert.ok(Math.abs(result.probes[0].radiusXmm - envelopeEnd) / envelopeEnd < 0.02, `probe ${result.probes[0].radiusXmm} vs ${envelopeEnd}`);
});

test("S17-R2 a source waist already unresolvable at z = 0 raises the focus warning", () => {
  const job = runHeadlessJob({
    kind: "field-beamline",
    input: {
      beamline: {
        version: "0.1",
        beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.01, waistPositionMm: 0 },
        components: [{ id: "d", kind: "free-space", lengthMm: 10 }],
      },
      grid: { nx: 64, ny: 64, dxMm: 0.05, dyMm: 0.05 },
      probesZmm: [10],
    },
  });
  assert.equal(job.ok, true);
  if (!job.ok || job.value.kind !== "field-beamline") throw new Error("expected field-beamline");
  assert.ok(job.value.result.warnings.some((w) => w.message.includes("CANNOT be resolved")), "z=0 waist must warn");
});
