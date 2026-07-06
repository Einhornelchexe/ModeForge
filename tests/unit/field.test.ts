import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCircularAperture,
  createGaussianField,
  createGaussianFieldAtPlane,
  fieldPower,
  fieldMomentRadii,
  fieldSamplingWarnings,
  applyThinLensPhase,
  propagateAngularSpectrum,
  propagateFresnel,
} from "../../packages/field/src/index.ts";
import { relativeError } from "../../packages/core/src/index.ts";
import { gaussianRadiusAtZ } from "../../packages/optics/src/index.ts";

test("Fresnel field propagation preserves discrete power on the same grid", () => {
  const field = createGaussianField({ nx: 8, ny: 8, dxMm: 0.05, dyMm: 0.05, wavelengthUm: 1.064, waistRadiusMm: 0.12 });
  const propagated = propagateFresnel(field, 10);
  assert.ok(relativeError(fieldPower(propagated), fieldPower(field)) < 1e-12);
  assert.ok(propagated.real.some((value) => Math.abs(value) > 1e-12));
});

test("Fresnel Gaussian moment radius stays near analytical Gaussian oracle", () => {
  const waistRadiusMm = 0.12;
  const wavelengthUm = 1.064;
  const distanceMm = 3;
  const field = createGaussianField({ nx: 33, ny: 33, dxMm: 0.025, dyMm: 0.025, wavelengthUm, waistRadiusMm });
  const propagated = propagateFresnel(field, distanceMm);
  const radii = fieldMomentRadii(propagated);
  const expected = gaussianRadiusAtZ(distanceMm, waistRadiusMm, wavelengthUm);
  assert.ok(relativeError(radii.radiusXmm, expected) < 0.08);
  assert.ok(relativeError(radii.radiusYmm, expected) < 0.08);
});

test("angular-spectrum propagation preserves power and tracks the Fresnel oracle paraxially", () => {
  const field = createGaussianField({ nx: 17, ny: 17, dxMm: 0.04, dyMm: 0.04, wavelengthUm: 1.064, waistRadiusMm: 0.12 });
  const fresnel = propagateFresnel(field, 2);
  const angular = propagateAngularSpectrum(field, 2);
  assert.ok(relativeError(fieldPower(angular), fieldPower(field)) < 1e-10);
  assert.ok(relativeError(fieldMomentRadii(angular).radiusXmm, fieldMomentRadii(fresnel).radiusXmm) < 0.03);
});

test("field thin-lens phase follows the analytical Gaussian radius approximately", () => {
  const waistRadiusMm = 0.12;
  const wavelengthUm = 1.064;
  const field = createGaussianFieldAtPlane({ nx: 41, ny: 41, dxMm: 0.02, dyMm: 0.02, wavelengthUm, radiusXmm: waistRadiusMm });
  const afterLens = applyThinLensPhase(field, 30);
  const propagated = propagateFresnel(afterLens, 20);
  const radii = fieldMomentRadii(propagated);
  const expected = gaussianRadiusAtZ(20, waistRadiusMm, wavelengthUm);
  assert.ok(radii.radiusXmm < expected);
});

test("circular aperture removes field power", () => {
  const field = createGaussianField({ nx: 9, ny: 9, dxMm: 0.05, dyMm: 0.05, wavelengthUm: 1.064, waistRadiusMm: 0.15 });
  const clipped = applyCircularAperture(field, 0.08);
  assert.ok(fieldPower(clipped) < fieldPower(field));
});

test("field sampling diagnostics warn on coarse grids", () => {
  const field = createGaussianField({ nx: 5, ny: 5, dxMm: 0.2, dyMm: 0.2, wavelengthUm: 1.064, waistRadiusMm: 0.2 });
  const warnings = fieldSamplingWarnings(field, 0.2);
  assert.equal(warnings[0]?.code, "FIELD_SAMPLING_LOW");
});
