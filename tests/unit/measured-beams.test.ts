import assert from "node:assert/strict";
import test from "node:test";
import { relativeError } from "../../packages/core/src/index.ts";
import { fitGaussianBeamFromRadii, parseBeamWidthMeasurementsCsv, oneOverE2RadiusToFwhmDiameterMm } from "../../packages/beams/src/index.ts";
import { gaussianRadiusAtZ, simulateBeamline } from "../../packages/optics/src/index.ts";

test("cylindrical lens creates per-axis beamline output", () => {
  const result = simulateBeamline({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 },
    components: [
      { id: "pre", kind: "free-space", lengthMm: 100 },
      { id: "cyl-x", kind: "cylindrical-lens", focalLengthMm: 150, axis: "x", apertureRadiusMm: 10 },
      { id: "post", kind: "free-space", lengthMm: 100 },
    ],
  });
  assert.ok(result.envelope.radiusYmm);
  assert.notEqual(result.envelope.radiusXmm.at(-1), result.envelope.radiusYmm?.at(-1));
  assert.equal(result.matrices.some((matrix) => matrix.componentId === "cyl-x" && matrix.axis === "x"), true);
  assert.equal(result.matrices.some((matrix) => matrix.componentId === "cyl-x" && matrix.axis === "y"), true);
});

test("measured Gaussian beam fit recovers synthetic waist and M2", () => {
  const wavelengthUm = 1.064;
  const waistRadiusMm = 0.4;
  const waistPositionMm = 25;
  const m2 = 1.3;
  const measurements = [-75, -25, 25, 75, 125].map((zMm) => ({
    zMm,
    radiusMm: gaussianRadiusAtZ(zMm - waistPositionMm, waistRadiusMm, wavelengthUm, m2),
  }));
  const fit = fitGaussianBeamFromRadii(measurements, wavelengthUm);
  assert.equal(fit.ok, true);
  assert.ok(relativeError(fit.waistRadiusMm ?? 0, waistRadiusMm) < 1e-10);
  assert.ok(relativeError(fit.waistPositionMm ?? 0, waistPositionMm) < 1e-10);
  assert.ok(relativeError(fit.m2 ?? 0, m2) < 1e-10);
  assert.ok((fit.maxRelativeResidual ?? 1) < 1e-12);
});

test("measured beam fit rejects underspecified data", () => {
  const fit = fitGaussianBeamFromRadii([{ zMm: 0, radiusMm: 1 }], 1.064);
  assert.equal(fit.ok, false);
  assert.equal(fit.warnings[0]?.code, "INVALID_INPUT");
});

test("measured beam CSV import converts FWHM diameter to radius input", () => {
  const csv = `zMm,fwhmDiameterMm
0,${oneOverE2RadiusToFwhmDiameterMm(0.4)}
10,${oneOverE2RadiusToFwhmDiameterMm(0.42)}
20,${oneOverE2RadiusToFwhmDiameterMm(0.45)}
`;
  const parsed = parseBeamWidthMeasurementsCsv(csv, "fwhm_diameter");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.length, 3);
    assert.ok(relativeError(parsed.value[0]?.radiusMm ?? 0, 0.4) < 1e-12);
  }
});
