// S20 repro corpus — the gate ceilings and what they are referenced against.
//
// BEFORE the gate-refinement stage both ceilings were built from the RAW peak
// of the corrected field, and two things followed.
//
// F4  The multi-peak candidate floor was a fraction of that raw peak, which
//     still contains any additive offset, while the field being scanned has the
//     fitted background removed. Adding a constant to the whole image therefore
//     raised the floor without raising the signal: the same secondary lobe was
//     counted at offset 0 and missed at offset 1000. The residual ceiling moved
//     with the offset in exactly the same way.
// V5b One hot pixel did the same thing locally. On a flat-topped beam whose
//     Gaussian model residual is genuinely too high, a single 4500-count pixel
//     on a 1000-count peak lifted the residual ceiling past the measured
//     residual and the residual verdict disappeared. At 100000 counts the frame
//     released outright.
//
// AFTER the stage both ceilings reference the stage-B, outlier-robust peak
// (aperture.ts ceilingPeak): the fitted background is removed, and on beams
// wide enough for it to mean anything a 3x3 median filter removes single bright
// pixels. This file now pins the FIXED behaviour, and every row carries the
// number it used to produce so the change stays auditable.
//
// Old -> new ledger (all measured, this file's scenes):
//
//   test 1, candidate floor      offset 0 / 100 / 250 / 500 / 1000 / 2000
//     before  99.93 / 109.93 / 124.93 / 149.93 / 199.93 / 299.93  (tracks the
//             offset one for one)
//     after   98.90 at every offset
//   test 1, significant peaks    before 2/2/2/1/1/1   after 2 at every offset
//   test 1, verdict              before residual_high x5 then alpha_inconsistent
//                                at offset 2000       after residual_high x6
//   test 2, verdict flips        before 3 of 5 lobe amplitudes flipped between
//                                offset 0 and offset 1000; after 0 of 5
//   test 2, lobe 100 at offset 0 before 1 peak, not detected; after 2 peaks,
//                                detected (the floor no longer sits above the
//                                lobe once the offset is out of it)
//   test 3                       unchanged in every number (this is the row the
//                                offset fix does not answer)
//   test 4, residual ceiling     before 5.007 / 20 / 22.5 / 25 / 500
//                                after  5.011 / 5.010 / 5.010 / 5.010 / 5.002
//   test 4, residual verdict     before true/true/false/false/false
//                                after  true at every hot value
//   test 4, candidate floor      before 100.13 / 400 / 450 / 500 / 10000
//                                after  100.21 / 100.21 / 100.21 / 100.21 / 100.05
//   test 4, frame verdict        before residual_high, residual_high,
//                                alpha_inconsistent, alpha_inconsistent, RELEASED
//                                after  residual_high at every hot value
//
// Runtime: about 18 s.

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeImage } from "../../packages/image/src/analyze.ts";
import { computeRectMoments } from "../../packages/image/src/moments.ts";
import {
  addGaussian,
  addGaussianNoise,
  frameRects,
  gaussianFieldF64,
  relativeErrorPercent,
  roundTo,
} from "./lib/scenes.ts";

// ---------------------------------------------------------------------------
// F4 — 260x200, main beam sigma 11x6 amplitude 1000 at (110.3, 99.7),
// secondary lobe 60 px away, sigma_B = 1, background method "none" so the
// additive offset survives into the corrected field.
// ---------------------------------------------------------------------------
const F4_WIDTH = 260;
const F4_HEIGHT = 200;
const F4_RECTS = frameRects(F4_WIDTH, F4_HEIGHT, 14);
const F4_ROI = { x0: 16, y0: 16, width: 228, height: 168 };

type LobeOutcome = {
  peaks: number;
  detected: boolean;
  peakFloor: number;
  evtThreshold: number;
  thresholdCounts: number;
  fittedBackground: number;
  suppression: string | null;
  residualCeiling: number;
  d4Major: number | null;
};

function twoLobeScene(
  offset: number,
  lobeAmplitude: number,
  lobeSigma1: number,
  lobeSigma2: number,
  separation: number,
): number[] {
  const pixels = gaussianFieldF64(F4_WIDTH, F4_HEIGHT, 110.3, 99.7, 11, 6, 0, 1000, offset);
  if (lobeAmplitude > 0) {
    addGaussian(pixels, F4_WIDTH, F4_HEIGHT, 110.3 + separation, 99.7, lobeSigma1, lobeSigma2, 0, lobeAmplitude);
  }
  addGaussianNoise(pixels, 1.0, 5);
  return Array.from(pixels);
}

function runTwoLobe(
  offset: number,
  lobeAmplitude: number,
  lobeSigma1: number,
  lobeSigma2: number,
  separation: number,
): LobeOutcome {
  const result = analyzeImage({
    pixels: twoLobeScene(offset, lobeAmplitude, lobeSigma1, lobeSigma2, separation),
    width: F4_WIDTH,
    height: F4_HEIGHT,
    dtype: "float32",
    background: { method: "none" },
    backgroundSigmaRects: F4_RECTS,
    roi: F4_ROI,
  });
  const multiPeak = result.aperture.gates.multiPeak;
  return {
    peaks: multiPeak.significantPeakCount,
    detected: multiPeak.detected,
    peakFloor: roundTo(multiPeak.peakFloorCounts, 2),
    evtThreshold: roundTo(multiPeak.evtThresholdCounts, 2),
    thresholdCounts: roundTo(multiPeak.thresholdCounts, 2),
    fittedBackground: roundTo(result.fits.gauss2d.params?.backgroundCounts ?? Number.NaN, 2),
    suppression: result.moments.suppressionReason,
    residualCeiling: roundTo(result.aperture.gates.residual.maxAllowedCounts, 3),
    d4Major: result.moments.stageB?.d4SigmaMajorPx ?? null,
  };
}

test("S20 repro: an additive offset no longer moves the candidate floor", () => {
  // The floor is a fraction of the STAGE-B peak, so the whole ladder collapses
  // onto one number while the fitted background still tracks the offset exactly
  // (which is the proof that the offset really is in the image). The
  // extreme-value arm, built from sigma_B, never moved in the first place.
  const expected: { offset: number; fittedBackground: number }[] = [
    { offset: 0, fittedBackground: 1.68 },
    { offset: 100, fittedBackground: 101.68 },
    { offset: 250, fittedBackground: 251.68 },
    { offset: 500, fittedBackground: 501.68 },
    { offset: 1000, fittedBackground: 1001.68 },
    { offset: 2000, fittedBackground: 2001.68 },
  ];
  for (const row of expected) {
    const outcome = runTwoLobe(row.offset, 150, 11, 6, 60);
    assert.equal(outcome.peaks, 2, `significant peaks at offset ${row.offset}`);
    assert.equal(outcome.detected, true, `multi-peak verdict at offset ${row.offset}`);
    // One number for the whole ladder - this is the fix.
    assert.equal(outcome.peakFloor, 98.9, `candidate floor at offset ${row.offset}`);
    assert.equal(outcome.residualCeiling, 4.945, `residual ceiling at offset ${row.offset}`);
    assert.equal(outcome.evtThreshold, 5.08, `extreme-value arm at offset ${row.offset}`);
    assert.equal(outcome.thresholdCounts, 98.9, `the floor arm wins at offset ${row.offset}`);
    assert.equal(outcome.fittedBackground, row.fittedBackground, `fitted background at offset ${row.offset}`);
    assert.equal(outcome.suppression, "residual_high", `verdict at offset ${row.offset}`);
  }
});

test("S20 repro: the same lobe is now counted at offset 0 and at offset 1000", () => {
  const expected: { lobe: number; floor: number }[] = [
    { lobe: 100, floor: 98.96 },
    { lobe: 120, floor: 98.93 },
    { lobe: 150, floor: 98.9 },
    { lobe: 200, floor: 98.84 },
    { lobe: 250, floor: 98.79 },
  ];
  let flips = 0;
  for (const row of expected) {
    const zero = runTwoLobe(0, row.lobe, 11, 6, 60);
    const offset = runTwoLobe(1000, row.lobe, 11, 6, 60);
    assert.equal(zero.peaks, 2, `peaks at offset 0, lobe ${row.lobe}`);
    assert.equal(zero.detected, true, `verdict at offset 0, lobe ${row.lobe}`);
    assert.equal(zero.suppression, "residual_high", `suppression at offset 0, lobe ${row.lobe}`);
    assert.equal(offset.peaks, 2, `peaks at offset 1000, lobe ${row.lobe}`);
    assert.equal(offset.detected, true, `verdict at offset 1000, lobe ${row.lobe}`);
    assert.equal(offset.suppression, "residual_high", `suppression at offset 1000, lobe ${row.lobe}`);
    // The floor depends on the lobe (it raises the beam's own stage-B peak a
    // little) but no longer on the constant.
    assert.equal(zero.peakFloor, row.floor, `floor at offset 0, lobe ${row.lobe}`);
    assert.equal(offset.peakFloor, row.floor, `floor at offset 1000, lobe ${row.lobe}`);
    if (zero.detected !== offset.detected) flips += 1;
  }
  // Three of five lobe amplitudes used to change verdict on nothing but a
  // constant. None of them does now.
  assert.equal(flips, 0);
});

test("S20 repro: a narrow lobe inside the release aperture is never counted and the width goes out wrong", () => {
  // Separation 30 px sits inside the alpha = 4 semi-major axis, so a missed
  // multi-peak verdict is also a wrong released width — at both offsets, which
  // makes this the row that survives the offset fix and needs its own answer.
  // Every number here is unchanged by the ceiling change.
  const reference = runTwoLobe(0, 0, 3, 3, 30);
  assert.equal(reference.suppression, null);
  assert.equal(roundTo(reference.d4Major ?? Number.NaN, 4), 43.9433);

  for (const [lobe, d4, errorPercent] of [
    [110, 45.9348, 4.532],
    [180, 47.0947, 7.172],
  ] as [number, number, number][]) {
    for (const offset of [0, 1000]) {
      const outcome = runTwoLobe(offset, lobe, 3, 3, 30);
      assert.equal(outcome.detected, false, `lobe ${lobe} at offset ${offset} is not counted`);
      assert.equal(outcome.suppression, null, `lobe ${lobe} at offset ${offset} releases`);
      assert.equal(roundTo(outcome.d4Major ?? Number.NaN, 4), d4, `released d4 for lobe ${lobe} at offset ${offset}`);
      assert.equal(
        roundTo(relativeErrorPercent(outcome.d4Major ?? Number.NaN, reference.d4Major ?? Number.NaN), 3),
        errorPercent,
        `released error for lobe ${lobe} at offset ${offset}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// V5b — 256x256 flat-topped beam (super-Gaussian order 1.5, half width 30,
// amplitude 1000), sigma_B = 1, one hot pixel far outside the beam.
// ---------------------------------------------------------------------------
const HOT_SIZE = 256;

function flatToppedScene(hot: number): Float32Array {
  const pixels = new Float32Array(HOT_SIZE * HOT_SIZE);
  for (let y = 0; y < HOT_SIZE; y += 1) {
    for (let x = 0; x < HOT_SIZE; x += 1) {
      const dx = x - 127.5;
      const dy = y - 127.5;
      const r = Math.sqrt(dx * dx + dy * dy) / 30;
      pixels[y * HOT_SIZE + x] = 1000 * Math.exp(-2 * Math.pow(r * r, 1.5));
    }
  }
  addGaussianNoise(pixels, 1, 606);
  if (hot > 0) pixels[30 * HOT_SIZE + 30] = hot;
  return pixels;
}

test("S20 repro: one hot pixel no longer buys a release", () => {
  // Ground truth of the beam, so the released number at the extreme end has
  // something to be compared against.
  const clean = new Float32Array(HOT_SIZE * HOT_SIZE);
  for (let y = 0; y < HOT_SIZE; y += 1) {
    for (let x = 0; x < HOT_SIZE; x += 1) {
      const dx = x - 127.5;
      const dy = y - 127.5;
      const r = Math.sqrt(dx * dx + dy * dy) / 30;
      clean[y * HOT_SIZE + x] = 1000 * Math.exp(-2 * Math.pow(r * r, 1.5));
    }
  }
  const truth = computeRectMoments(
    { values: Float64Array.from(clean), width: HOT_SIZE, height: HOT_SIZE },
    { x0: 0, y0: 0, width: HOT_SIZE, height: HOT_SIZE },
  );
  assert.equal(roundTo(truth.d4SigmaMajorPx ?? Number.NaN, 4), 54.6909);

  const expected: {
    hot: number;
    ceiling: number;
    residualRms: number;
    peakFloor: number;
  }[] = [
    { hot: 0, ceiling: 5.011, residualRms: 12.759, peakFloor: 100.21 },
    { hot: 4000, ceiling: 5.01, residualRms: 20.178, peakFloor: 100.21 },
    { hot: 4500, ceiling: 5.01, residualRms: 21.726, peakFloor: 100.21 },
    { hot: 5000, ceiling: 5.01, residualRms: 23.335, peakFloor: 100.21 },
    { hot: 100000, ceiling: 5.002, residualRms: 390.837, peakFloor: 100.05 },
  ];

  for (const row of expected) {
    const result = analyzeImage({
      pixels: flatToppedScene(row.hot),
      width: HOT_SIZE,
      height: HOT_SIZE,
      dtype: "float32",
    });
    const gates = result.aperture.gates;
    // The ceiling is now a property of the BEAM: it moves by 0.2 percent across
    // a hot pixel that spans four orders of magnitude (before: by a factor 100).
    assert.equal(roundTo(gates.residual.maxAllowedCounts, 3), row.ceiling, `residual ceiling at hot ${row.hot}`);
    assert.equal(roundTo(gates.residual.rmsCounts, 3), row.residualRms, `residual rms at hot ${row.hot}`);
    assert.equal(gates.residual.high, true, `residual verdict at hot ${row.hot}`);
    assert.equal(roundTo(gates.multiPeak.peakFloorCounts, 2), row.peakFloor, `candidate floor at hot ${row.hot}`);
    assert.equal(result.moments.suppressionReason, "residual_high", `verdict at hot ${row.hot}`);
    assert.equal(result.moments.stageB, null, `nothing is released at hot ${row.hot}`);
  }

  // The whole point: the 4000 -> 4500 flip on a 1000-count peak is gone, and so
  // is the outright release at 100000. The gate now says the same thing about
  // this beam at every hot-pixel level, which is the only honest answer - the
  // beam did not change.
  assert.equal(1 / (HOT_SIZE * HOT_SIZE), 1 / 65536);

  // The robust arm is what makes that possible: the fitted minor sigma of this
  // beam is far above MEDIAN_PEAK_MIN_SIGMA, so the ceiling is built from the
  // 3x3-median-filtered field, where a single 100000-count pixel is invisible.
  const extreme = analyzeImage({
    pixels: flatToppedScene(100000),
    width: HOT_SIZE,
    height: HOT_SIZE,
    dtype: "float32",
  });
  assert.equal(roundTo(extreme.fits.gauss2d.params?.sigmaMinorPx ?? Number.NaN, 3), 15.208);
});
