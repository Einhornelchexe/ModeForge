import assert from "node:assert/strict";
import test from "node:test";
import { FUSED_SILICA, N_BK7, gvdFs2PerMm, refractiveIndex } from "../../packages/materials/src/index.ts";
import { calculatePulse, gaussianPeakFluenceJPerCm2, pulseEnergyJ, temporalPeakFactor } from "../../packages/pulses/src/index.ts";
import { materialReference } from "../../packages/validation/src/index.ts";

test("N-BK7 Sellmeier index is in the expected visible range", () => {
  const n = refractiveIndex(N_BK7, 0.5876);
  assert.ok(Math.abs(n - 1.5168) < 5e-4);
  assert.equal(materialReference.materialId, N_BK7.id);
  assert.ok(Math.abs(materialReference.expectedN - n) < 1e-12);
});

test("fused silica GVD is finite and positive near 800 nm", () => {
  const gvd = gvdFs2PerMm(FUSED_SILICA, 0.8);
  assert.ok(gvd > 20 && gvd < 60);
});

test("pulse energy and Gaussian peak factor are explicit", () => {
  assert.equal(pulseEnergyJ({ averagePowerW: 1, repetitionRateHz: 1000 }), 0.001);
  assert.ok(temporalPeakFactor("gaussian") > 0.93 && temporalPeakFactor("gaussian") < 0.95);
});

test("pulse result includes spatial fluence when radius is supplied", () => {
  const result = calculatePulse(
    { averagePowerW: 1, repetitionRateHz: 1000, durationFwhmS: 100e-15, shape: "gaussian" },
    { radiusXmm: 0.1 },
  );
  assert.ok(result.peakPowerW > 1e9);
  assert.ok(result.fluenceJPerCm2 !== undefined && result.fluenceJPerCm2 > 0);
});

test("pulse helpers reject nonphysical direct inputs", () => {
  assert.throws(() => pulseEnergyJ({ averagePowerW: 1, repetitionRateHz: 0 }), /repetitionRateHz/);
  assert.throws(() => temporalPeakFactor("triangle" as never), /pulse shape/);
  assert.throws(() => gaussianPeakFluenceJPerCm2(1e-3, 0), /radiusXmm/);
  assert.throws(() => calculatePulse({ pulseEnergyJ: 1e-3, durationFwhmS: 0, shape: "gaussian" }), /durationFwhmS/);
});
