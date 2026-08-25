// S20 repro corpus — the self-calibrated consistency ceiling across scene
// families, and what a hard cap on it would cost.
//
// The ceiling is max(ALPHA_CONSISTENCY_MAX_PERCENT, k * nullRms) with no upper
// bound. A proposed hardening was to cap it at 3 * ALPHA_CONSISTENCY_MAX_PERCENT
// and fail closed above. This file measures the ceiling on six clean, legitimate
// scene families so the cost of any such cap is a pinned number rather than an
// argument, and states the two separation facts that follow from the bands.
//
// Scene family shape (identical to the release-curve oracle in
// tests/unit/image-aperture.test.ts): 300x240 frame, amplitude 100, full-frame
// ROI, noise from the shared mulberry32 + Box-Muller stream, sigma_B handed to
// assessAperture explicitly so the background estimator never enters.
//
// Reduction against the source sweep: the two curve families keep their 15
// seeds (their bands are the documented curve record); the four geometry
// families use 8 seeds each. A seventh family (sigma 3x1.5 at SNR 15) was
// dropped as redundant with sigma 3x1.5 at SNR 20 for every claim below.
//
// Runtime: about 16 s.

import assert from "node:assert/strict";
import test from "node:test";

import { assessAperture } from "../../packages/image/src/aperture.ts";
import { fitGauss2d } from "../../packages/image/src/fit.ts";
import { ALPHA_CONSISTENCY_MAX_PERCENT } from "../../packages/image/src/thresholds.ts";
import { addGaussianNoise, gaussianFieldF64, roundTo } from "./lib/scenes.ts";

const WIDTH = 300;
const HEIGHT = 240;
const ROI = { x0: 0, y0: 0, width: WIDTH, height: HEIGHT };

type FamilyBands = {
  released: number;
  seeds: number;
  thresholdMajor: [number, number];
  thresholdMinor: [number, number];
};

function measureFamily(
  sigma1: number,
  sigma2: number,
  sigmaB: number,
  seeds: number,
  seedBase: number,
): FamilyBands {
  const clean = gaussianFieldF64(WIDTH, HEIGHT, 150, 120, sigma1, sigma2, 0, 100, 0);
  let released = 0;
  let majorLow = Number.POSITIVE_INFINITY;
  let majorHigh = Number.NEGATIVE_INFINITY;
  let minorLow = Number.POSITIVE_INFINITY;
  let minorHigh = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < seeds; i += 1) {
    const pixels = Float64Array.from(clean);
    addGaussianNoise(pixels, sigmaB, seedBase + i);
    const fit = fitGauss2d({ values: pixels, width: WIDTH, height: HEIGHT }, ROI);
    const assessment = assessAperture({ values: pixels, width: WIDTH, height: HEIGHT }, ROI, fit, sigmaB);
    const alpha = assessment.gates.alphaConsistency;
    majorLow = Math.min(majorLow, alpha.thresholdMajorPercent);
    majorHigh = Math.max(majorHigh, alpha.thresholdMajorPercent);
    minorLow = Math.min(minorLow, alpha.thresholdMinorPercent);
    minorHigh = Math.max(minorHigh, alpha.thresholdMinorPercent);
    if (assessment.suppressionReason === null) released += 1;
  }
  return {
    released,
    seeds,
    thresholdMajor: [roundTo(majorLow, 3), roundTo(majorHigh, 3)],
    thresholdMinor: [roundTo(minorLow, 3), roundTo(minorHigh, 3)],
  };
}

// The seed bases are the ones already used by the release-curve oracle, so the
// two curve rows below reproduce its documented bands exactly.
const CURVE_SNR_100_SEED_BASE = 0x51e5;
const SNR_20_SEED_BASE = 0xa11ce5;

const FAMILIES: {
  label: string;
  sigma1: number;
  sigma2: number;
  sigmaB: number;
  seeds: number;
  seedBase: number;
  expected: FamilyBands;
}[] = [
  {
    label: "curve family, sigma 11x6, SNR 100",
    sigma1: 11,
    sigma2: 6,
    sigmaB: 1,
    seeds: 15,
    seedBase: CURVE_SNR_100_SEED_BASE,
    expected: { released: 15, seeds: 15, thresholdMajor: [3, 3.091], thresholdMinor: [3, 3] },
  },
  {
    label: "curve family, sigma 11x6, SNR 20",
    sigma1: 11,
    sigma2: 6,
    sigmaB: 5,
    seeds: 15,
    seedBase: SNR_20_SEED_BASE,
    expected: { released: 15, seeds: 15, thresholdMajor: [14.273, 15.578], thresholdMinor: [13.45, 15.323] },
  },
  {
    label: "sigma 8x6, SNR 20",
    sigma1: 8,
    sigma2: 6,
    sigmaB: 5,
    seeds: 8,
    seedBase: SNR_20_SEED_BASE,
    expected: { released: 7, seeds: 8, thresholdMajor: [15.131, 16.293], thresholdMinor: [17.528, 20.939] },
  },
  {
    label: "sigma 20x12, SNR 20",
    sigma1: 20,
    sigma2: 12,
    sigmaB: 5,
    seeds: 8,
    seedBase: SNR_20_SEED_BASE,
    expected: { released: 8, seeds: 8, thresholdMajor: [7.177, 7.44], thresholdMinor: [6.577, 7.568] },
  },
  {
    label: "sigma 5x3, SNR 20",
    sigma1: 5,
    sigma2: 3,
    sigmaB: 5,
    seeds: 8,
    seedBase: SNR_20_SEED_BASE,
    expected: { released: 6, seeds: 8, thresholdMajor: [33.222, 40.552], thresholdMinor: [39.291, 58.387] },
  },
  {
    label: "sigma 3x1.5, SNR 20",
    sigma1: 3,
    sigma2: 1.5,
    sigmaB: 5,
    seeds: 8,
    seedBase: SNR_20_SEED_BASE,
    expected: { released: 7, seeds: 8, thresholdMajor: [47.9, 80.82], thresholdMinor: [86.704, 3165.876] },
  },
];

// The pathological wing-heavy scene's ceilings, pinned in
// s20-honesty-floor.test.ts on the 192x192 core-plus-halo scene. Restated here
// as literals so the separation argument below reads in one place.
const PATHOLOGY_CEILING_AT_SIGMA_B_50 = 11.0756;
const PATHOLOGY_CEILING_AT_SIGMA_B_100 = 22.2874;

const measured = new Map<string, FamilyBands>();

test("S20 repro: the consistency ceiling per clean scene family", () => {
  for (const family of FAMILIES) {
    const bands = measureFamily(family.sigma1, family.sigma2, family.sigmaB, family.seeds, family.seedBase);
    measured.set(family.label, bands);
    assert.deepEqual(bands, family.expected, `bands for ${family.label}`);
  }
});

test("S20 repro: a cap at three times the fixed ceiling empties the pinned release cell", () => {
  const cap = 3 * ALPHA_CONSISTENCY_MAX_PERCENT;
  assert.equal(cap, 9);

  const curve20 = measured.get("curve family, sigma 11x6, SNR 20");
  assert.ok(curve20, "the family table must run first");
  // Every seed of the pinned SNR-20 release cell sits above the cap on BOTH
  // axes, so a fail-closed rule at the cap takes the cell from 15/15 to 0/15.
  assert.ok(curve20.thresholdMajor[0] > cap, `lowest major ceiling ${curve20.thresholdMajor[0]} must exceed ${cap}`);
  assert.ok(curve20.thresholdMinor[0] > cap, `lowest minor ceiling ${curve20.thresholdMinor[0]} must exceed ${cap}`);

  // Two further legitimate geometry families are entirely above the cap too.
  for (const label of ["sigma 5x3, SNR 20", "sigma 3x1.5, SNR 20"]) {
    const bands = measured.get(label);
    assert.ok(bands, `${label} must run first`);
    assert.ok(bands.thresholdMajor[0] > cap, `${label} lowest major ceiling above the cap`);
  }

  // The one family the cap leaves alone: the wide geometry, whose null scatter
  // is small because the aperture holds many independent samples.
  const wide = measured.get("sigma 20x12, SNR 20");
  assert.ok(wide);
  assert.ok(wide.thresholdMajor[1] < cap, "the wide family stays under the cap on the major axis");
  assert.ok(wide.thresholdMinor[1] < cap, "the wide family stays under the cap on the minor axis");
});

test("S20 repro: no cap separates the wing-heavy pathology from the clean families", () => {
  const curve20 = measured.get("curve family, sigma 11x6, SNR 20");
  const family8x6 = measured.get("sigma 8x6, SNR 20");
  const family5x3 = measured.get("sigma 5x3, SNR 20");
  assert.ok(curve20 && family8x6 && family5x3, "the family table must run first");

  // To suppress the pathology at sigma_B = 50 (released 39 percent low) the cap
  // must sit below its ceiling — which is below every seed of the pinned
  // release cell. Catching that case therefore empties the release cell.
  assert.ok(
    PATHOLOGY_CEILING_AT_SIGMA_B_50 < curve20.thresholdMinor[0],
    "the pathology ceiling at sigma_B 50 is below the whole pinned release band",
  );

  // Aiming only at the sigma_B = 100 case still costs two clean families: any
  // cap below that ceiling is also below the lowest sigma 5x3 ceiling.
  assert.ok(
    PATHOLOGY_CEILING_AT_SIGMA_B_100 < family5x3.thresholdMajor[0],
    "a cap that catches the pathology at sigma_B 100 also empties the sigma 5x3 family",
  );

  // And the pathology band brackets a clean band from both sides: the clean
  // sigma 8x6 ceilings lie between the two pathological ones, so there is no
  // ordering by ceiling alone that puts the defect on one side.
  assert.ok(PATHOLOGY_CEILING_AT_SIGMA_B_50 < family8x6.thresholdMinor[0]);
  assert.ok(family8x6.thresholdMinor[1] < PATHOLOGY_CEILING_AT_SIGMA_B_100);
});

test("S20 repro: a visibility threshold at 10 percent speaks and stays silent where intended", () => {
  // The alternative to a cap is a warning on released frames whose ceiling
  // exceeds a fixed percentage. Candidate 10: silent on the high-SNR curve cell
  // and on the wide geometry, speaking from the SNR-20 curve cell upward.
  const candidate = 10;
  const curve100 = measured.get("curve family, sigma 11x6, SNR 100");
  const curve20 = measured.get("curve family, sigma 11x6, SNR 20");
  const wide = measured.get("sigma 20x12, SNR 20");
  assert.ok(curve100 && curve20 && wide, "the family table must run first");

  assert.ok(curve100.thresholdMajor[1] < candidate, "silent at SNR 100");
  assert.ok(wide.thresholdMajor[1] < candidate, "silent on the wide geometry at SNR 20");
  assert.ok(wide.thresholdMinor[1] < candidate, "silent on the wide geometry, minor axis");
  assert.ok(curve20.thresholdMinor[0] > candidate, "speaks on every seed of the SNR-20 curve cell");
  assert.ok(PATHOLOGY_CEILING_AT_SIGMA_B_50 > candidate, "speaks on the pathology at sigma_B 50");
});
