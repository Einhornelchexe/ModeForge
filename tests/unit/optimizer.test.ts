import assert from "node:assert/strict";
import test from "node:test";
import { relativeError } from "../../packages/core/src/index.ts";
import { simulateBeamline } from "../../packages/optics/src/index.ts";
import { optimizeTwoLensTelescope, type LensCandidate } from "../../packages/optimizer/src/index.ts";

const beam = { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 } as const;
const lensA: LensCandidate = { id: "f100", focalLengthMm: 100, apertureRadiusMm: 10 };
const lensB: LensCandidate = { id: "f150", focalLengthMm: 150, apertureRadiusMm: 10 };

test("two-lens optimizer recovers a known deterministic target", () => {
  const target = simulateBeamline({
    version: "0.1",
    beam,
    components: [
      { id: "pre-lens-1", kind: "free-space", lengthMm: 100 },
      { id: "f100", kind: "thin-lens", focalLengthMm: 100, apertureRadiusMm: 10 },
      { id: "between-lenses", kind: "free-space", lengthMm: 200 },
      { id: "f100", kind: "thin-lens", focalLengthMm: 100, apertureRadiusMm: 10 },
      { id: "to-target", kind: "free-space", lengthMm: 200 },
    ],
  });
  const targetRadiusMm = target.envelope.radiusXmm.at(-1);
  assert.ok(targetRadiusMm !== undefined);

  const result = optimizeTwoLensTelescope({
    version: "0.1",
    beam,
    lenses: [lensA, lensB],
    search: {
      lens1Zmm: [100, 120],
      lens2Zmm: [250, 300],
      targetZmm: 500,
      targetRadiusMm,
      minSeparationMm: 50,
      apertureMarginMin: 2,
      maxResults: 3,
      sensitivityShiftMm: 1,
      sensitivityFocalLengthMm: 0.5,
      sensitivityM2Delta: 0.05,
    },
  });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.solutions[0]?.rank, 1);
  assert.equal(result.solutions[0]?.lens1.id, "f100");
  assert.equal(result.solutions[0]?.lens2.id, "f100");
  assert.equal(result.solutions[0]?.lens1Zmm, 100);
  assert.equal(result.solutions[0]?.lens2Zmm, 300);
  assert.ok(relativeError(result.solutions[0]?.achievedRadiusMm ?? 0, targetRadiusMm) < 1e-12);
  assert.ok((result.solutions[0]?.sensitivity?.maxRadiusDeltaMm ?? 0) > 0);
  assert.ok((result.solutions[0]?.sensitivity?.maxRadiusDeltaFromFocalLengthMm ?? 0) > 0);
  assert.ok((result.solutions[0]?.sensitivity?.maxRadiusDeltaFromM2Mm ?? 0) > 0);
});

test("two-lens optimizer accepts diameter targets and pulse fluence constraints", () => {
  const targetRadiusMm = 0.55;
  const result = optimizeTwoLensTelescope({
    version: "0.1",
    beam,
    pulse: { pulseEnergyJ: 1e-6, durationFwhmS: 100e-15, shape: "gaussian" },
    lenses: [lensA, lensB],
    search: {
      lens1Zmm: [100],
      lens2Zmm: [300],
      targetZmm: 500,
      targetDiameterMm: 2 * targetRadiusMm,
      maxFluenceJPerCm2: 1,
      maxPeakIntensityWPerCm2: 1e14,
      maxResults: 1,
    },
  });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.solutions.length, 1);
  assert.equal(result.solutions[0]?.targetDiameterMm, 2 * targetRadiusMm);
  assert.ok((result.solutions[0]?.beamline.pulse?.fluenceJPerCm2 ?? 0) > 0);
});

test("two-lens optimizer can target the propagated waist", () => {
  const target = simulateBeamline({
    version: "0.1",
    beam,
    components: [
      { id: "pre-lens-1", kind: "free-space", lengthMm: 100 },
      { id: "f100", kind: "thin-lens", focalLengthMm: 100, apertureRadiusMm: 10 },
      { id: "between-lenses", kind: "free-space", lengthMm: 200 },
      { id: "f100", kind: "thin-lens", focalLengthMm: 100, apertureRadiusMm: 10 },
      { id: "to-target", kind: "free-space", lengthMm: 200 },
    ],
  });
  const waist = target.waists[0];
  assert.ok(waist);

  const result = optimizeTwoLensTelescope({
    version: "0.1",
    beam,
    lenses: [lensA, lensB],
    search: {
      lens1Zmm: [100, 120],
      lens2Zmm: [250, 300],
      targetZmm: 500,
      targetWaistRadiusMm: waist.radiusMm,
      targetWaistZmm: waist.zMm,
      maxResults: 1,
    },
  });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.solutions[0]?.lens1.id, "f100");
  assert.equal(result.solutions[0]?.lens2.id, "f100");
  assert.ok(relativeError(result.solutions[0]?.achievedWaistRadiusMm ?? 0, waist.radiusMm) < 1e-12);
});

test("two-lens optimizer reports impossible constraints", () => {
  const result = optimizeTwoLensTelescope({
    version: "0.1",
    beam,
    lenses: [lensA],
    search: {
      lens1Zmm: [100],
      lens2Zmm: [110],
      targetZmm: 120,
      targetRadiusMm: 0.5,
      minSeparationMm: 50,
    },
  });
  assert.equal(result.solutions.length, 0);
  assert.equal(result.warnings[0]?.code, "INVALID_INPUT");
});
