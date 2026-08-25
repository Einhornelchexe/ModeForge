// S20 repro corpus — non-finite coverage in the measurement aperture.
//
// What this pins: the measured behaviour of the engine when part of the alpha
// aperture carries non-finite pixels, now that the coverage gate has landed.
//
// The file was written as a FAIL-BEFORE oracle and has been re-pinned once.
// Before the gate, every row below released: random masks moved the width by
// under 0.7 percent (harmless), but a dead column of 3.4 percent of the
// aperture moved it by +5.9 percent and a masked flank by -20.6 percent, with
// every gate quiet and only IMAGE_FLOAT_SPECIALS speaking — whose text said
// the values were "ignored". The released widths those rows produced are kept
// in the comments as the historical record of what was being released.
//
// After the gate the split is: the random rows still release, bit-identical
// to their pre-gate values (that identity is the point — they were never
// collateral damage), and the structured rows suppress with the reason
// coverage_insufficient. The alpha-consistency measurements are still pinned
// on the suppressed rows, because they are the evidence that the gate which
// used to be asked about these frames could not see them.
//
// Runtime: about 8 s. All values are exact pins of a deterministic scene.

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeImage } from "../../packages/image/src/analyze.ts";
import {
  addGaussianNoise,
  frameRects,
  gaussianFieldF64,
  gaussianSceneF32,
  relativeErrorPercent,
  roundTo,
  shortWarningCodes,
} from "./lib/scenes.ts";

// ---------------------------------------------------------------------------
// Scene: 200x160, sigma 11x6 at 0.7 rad, amplitude 2000, sigma_B = 1,
// rect-median over a 12 px frame, ROI 14/14/172/132.
// ---------------------------------------------------------------------------
const WIDTH = 200;
const HEIGHT = 160;
const RIM = 12;
const REFERENCE_RECTS = frameRects(WIDTH, HEIGHT, RIM);
const ROI = { x0: 14, y0: 14, width: 172, height: 132 };
const CX = 100.3;
const CY = 79.7;
const SIGMA_X = 11;
const SIGMA_Y = 6;
const THETA = 0.7;
const AMPLITUDE = 2000;
const NOISE_SEED = 3;

type MaskMode = "none" | "random" | "column" | "flank";

function maskedRun(mode: MaskMode, param: number): {
  dead: number;
  inEllipse: number;
  result: ReturnType<typeof analyzeImage>;
} {
  const pixels = gaussianFieldF64(WIDTH, HEIGHT, CX, CY, SIGMA_X, SIGMA_Y, THETA, AMPLITUDE, 0);
  addGaussianNoise(pixels, 1.0, NOISE_SEED);

  // Membership in the alpha = 6 check ellipse: the support both moment passes
  // read. The mask is applied only inside it, so "fraction of dead pixels" is
  // a fraction of the aperture, not of the frame.
  const cos = Math.cos(THETA);
  const sin = Math.sin(THETA);
  let dead = 0;
  let inEllipse = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const dx = x - CX;
      const dy = y - CY;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if ((u * u) / (6 * SIGMA_X) ** 2 + (v * v) / (6 * SIGMA_Y) ** 2 > 1) continue;
      inEllipse += 1;
      let kill = false;
      if (mode === "random") kill = ((x * 7919 + y * 104729) % 1000) / 1000 < param;
      else if (mode === "column") kill = Math.abs(x - Math.round(CX)) < param;
      else if (mode === "flank") kill = u > param * SIGMA_X;
      if (kill) {
        pixels[x + y * WIDTH] = Number.NaN;
        dead += 1;
      }
    }
  }

  const result = analyzeImage({
    pixels: Array.from(pixels),
    width: WIDTH,
    height: HEIGHT,
    dtype: "float32",
    background: { method: "rect-median", rects: REFERENCE_RECTS },
    backgroundSigmaRects: REFERENCE_RECTS,
    roi: ROI,
  });
  return { dead, inEllipse, result };
}

test("S20 repro: the clean baseline of the coverage scene releases with no warning-severity entry", () => {
  const { inEllipse, result } = maskedRun("none", 0);
  const stageB = result.moments.stageB;
  assert.notEqual(stageB, null);
  assert.equal(inEllipse, 7463, "alpha = 6 aperture pixel count");
  assert.equal(result.moments.suppressionReason, null);
  assert.equal(roundTo(stageB?.d4SigmaMajorPx ?? Number.NaN, 4), 43.9408);
  assert.equal(result.raw.nonFiniteCount, 0);
  // S20 stage B re-pin (honesty floor, arm 2). This row used to read [] here.
  // It now carries the probe-reach notice, and correctly: the ROI is 172x132
  // around a sigma 11x6 beam, so the 9 and 12 sigma wing probes do not fit and
  // the absorbed-power check runs on the 4 and 6 sigma radii alone. The row is
  // still fully released with no gate, no suppression and no warning-severity
  // entry - the only change is that the reduced reach is now stated instead of
  // being invisible.
  assert.deepEqual(shortWarningCodes(result), ["WING_PROBE_REDUCED"]);
  assert.deepEqual(result.aperture.absorbedPower.availableProbeAlphas, [4, 6]);
  assert.equal(result.warnings.every((w) => w.severity === "info"), true);

  const alpha = result.aperture.gates.alphaConsistency;
  assert.equal(roundTo(alpha.deltaMajorPercent ?? Number.NaN, 4), 0.1577);
  assert.equal(alpha.thresholdMajorPercent, 3);
  assert.equal(alpha.mcRealizationCount, 64);
});

test("S20 repro: random dead pixels stay benign up to half the aperture", () => {
  // The worst random row moves the released width by +0.678 percent at a dead
  // fraction of 50 percent. Any coverage rule that suppresses one of these
  // rows costs yield on ordinary sensors with scattered defects, so these five
  // released values are pinned to the digit: the coverage gate landed without
  // moving one of them.
  //
  // `bias` is what the coverage estimator says about each row. It reproduces
  // the released error to three decimals, which is why the estimator is used
  // as the discriminator rather than a dead-pixel fraction: at 50 percent dead
  // it reads 0.677 while a 3.4-percent dead COLUMN reads 5.924.
  const expected: {
    param: number;
    dead: number;
    d4: number;
    errorPercent: number;
    finite: number;
    finiteFraction: number;
    bias: number;
  }[] = [
    { param: 0.01, dead: 80, d4: 44.1052, errorPercent: 0.374, finite: 3295, finiteFraction: 0.9928, bias: 0.373 },
    { param: 0.05, dead: 375, d4: 43.9353, errorPercent: -0.012, finite: 3151, finiteFraction: 0.9494, bias: -0.011 },
    { param: 0.1, dead: 747, d4: 43.9948, errorPercent: 0.123, finite: 2987, finiteFraction: 0.9, bias: 0.129 },
    { param: 0.3, dead: 2237, d4: 43.9849, errorPercent: 0.1, finite: 2324, finiteFraction: 0.7002, bias: 0.097 },
    { param: 0.5, dead: 3734, d4: 44.2387, errorPercent: 0.678, finite: 1669, finiteFraction: 0.5029, bias: 0.677 },
  ];
  const baseline = maskedRun("none", 0).result.moments.stageB?.d4SigmaMajorPx ?? Number.NaN;

  for (const row of expected) {
    const { dead, result } = maskedRun("random", row.param);
    const d4 = result.moments.stageB?.d4SigmaMajorPx ?? Number.NaN;
    assert.equal(dead, row.dead, `dead pixel count at random ${row.param}`);
    assert.equal(roundTo(d4, 4), row.d4, `released d4 at random ${row.param}`);
    assert.equal(
      roundTo(relativeErrorPercent(d4, baseline), 3),
      row.errorPercent,
      `released error at random ${row.param}`,
    );
    assert.equal(result.moments.suppressionReason, null, `released at random ${row.param}`);
    assert.ok(
      Math.abs(relativeErrorPercent(d4, baseline)) <= 0.68,
      `random masks must stay benign (${row.param})`,
    );

    // The coverage block ran (the ROI carries non-finite pixels) and cleared
    // the frame on both arms.
    const coverage = result.aperture.coverage;
    assert.equal(coverage.aperturePixelCount, 3319, `alpha = 4 aperture pixels at random ${row.param}`);
    assert.equal(coverage.finitePixelCount, row.finite, `finite aperture pixels at random ${row.param}`);
    assert.equal(roundTo(coverage.finiteFraction ?? Number.NaN, 4), row.finiteFraction, `finite fraction at random ${row.param}`);
    assert.equal(roundTo(coverage.modelBiasMajorPercent ?? Number.NaN, 3), row.bias, `coverage bias at random ${row.param}`);
    assert.equal(coverage.high, false, `coverage verdict at random ${row.param}`);
    // ... and stayed under the sub-threshold notice as well, so the released
    // frame's warning list is untouched by this stage.
    assert.equal(
      shortWarningCodes(result).includes("COVERAGE_LOSS"),
      false,
      `no coverage notice at random ${row.param}`,
    );
  }
});

test("S20 repro: a structured mask is caught by the coverage gate, not by the consistency gate", () => {
  // 3.4 percent of the aperture, arranged as a column, is worth +5.9 percent
  // on the released width — while a random 50 percent mask is worth +0.7.
  // A plain dead-fraction threshold cannot separate the two, which is why the
  // discriminator is the model-bias estimator pinned in `bias` below.
  //
  // `wasReleasedD4` / `wasErrorPercent` are what these five rows RELEASED
  // before the coverage gate landed; they are the numbers the gate exists to
  // stop shipping, kept here as the record of the defect.
  const expected: {
    mode: MaskMode;
    param: number;
    label: string;
    dead: number;
    wasReleasedD4: number;
    wasErrorPercent: number;
    finite: number;
    finiteFraction: number;
    biasMajor: number;
    biasMinor: number;
  }[] = [
    { mode: "column", param: 2, label: "column +-2 px", dead: 256, wasReleasedD4: 46.544, wasErrorPercent: 5.924, finite: 3148, finiteFraction: 0.9485, biasMajor: 5.924, biasMinor: 1.071 },
    { mode: "column", param: 5, label: "column +-5 px", dead: 770, wasReleasedD4: 53.1812, wasErrorPercent: 21.029, finite: 2808, finiteFraction: 0.846, biasMajor: 21.031, biasMinor: 2.798 },
    { mode: "column", param: 10, label: "column +-10 px", dead: 1619, wasReleasedD4: 67.5159, wasErrorPercent: 53.652, finite: 2247, finiteFraction: 0.677, biasMajor: 53.645, biasMinor: 4.427 },
    { mode: "flank", param: 1.0, label: "flank u > 1 sigma", dead: 2942, wasReleasedD4: 34.8959, wasErrorPercent: -20.584, finite: 2180, finiteFraction: 0.6568, biasMajor: -20.583, biasMinor: -0.008 },
    { mode: "flank", param: 2.0, label: "flank u > 2 sigma", dead: 2178, wasReleasedD4: 41.3989, wasErrorPercent: -5.785, finite: 2668, finiteFraction: 0.8039, biasMajor: -5.778, biasMinor: 0.015 },
  ];

  for (const row of expected) {
    const { dead, result } = maskedRun(row.mode, row.param);
    assert.equal(dead, row.dead, `dead pixel count for ${row.label}`);

    // The frame is suppressed and carries no stage-B number at all: the
    // contract is that a suppressed stage B is never substituted.
    assert.equal(result.moments.suppressionReason, "coverage_insufficient", `verdict for ${row.label}`);
    assert.equal(result.moments.stageB, null, `no released moments for ${row.label}`);

    // The estimator's numbers, which reproduce the released error the row used
    // to ship to three decimals.
    const coverage = result.aperture.coverage;
    assert.equal(coverage.aperturePixelCount, 3319, `aperture pixels for ${row.label}`);
    assert.equal(coverage.finitePixelCount, row.finite, `finite aperture pixels for ${row.label}`);
    assert.equal(roundTo(coverage.finiteFraction ?? Number.NaN, 4), row.finiteFraction, `finite fraction for ${row.label}`);
    assert.equal(roundTo(coverage.modelBiasMajorPercent ?? Number.NaN, 3), row.biasMajor, `major bias for ${row.label}`);
    assert.equal(roundTo(coverage.modelBiasMinorPercent ?? Number.NaN, 3), row.biasMinor, `minor bias for ${row.label}`);
    assert.equal(coverage.high, true, `coverage verdict for ${row.label}`);
    assert.ok(
      Math.abs(row.biasMajor - row.wasErrorPercent) < 0.01,
      `the estimator reproduces the width this row used to release (${row.label}: ${row.biasMajor} vs ${row.wasErrorPercent}, from d4 ${row.wasReleasedD4})`,
    );

    // The gate that was supposed to notice is still blind, and still says so.
    // This is why a new gate was needed rather than a re-tuned old one.
    const alpha = result.aperture.gates.alphaConsistency;
    assert.ok(
      (alpha.deltaMajorPercent ?? Number.NaN) < 0.25,
      `the observed alpha delta stays at baseline size for ${row.label}`,
    );
    assert.equal(alpha.thresholdMajorPercent, 3, `threshold untouched for ${row.label}`);
    assert.equal(alpha.inconsistent, false, `the consistency gate never objects for ${row.label}`);

    const codes = shortWarningCodes(result);
    assert.ok(codes.includes("FLOAT_SPECIALS"), `float-specials notice for ${row.label}`);
    assert.ok(codes.includes("APERTURE_SUPPRESSED"), `suppression notice for ${row.label}`);
    // The sub-threshold notice belongs to released frames only; a suppressed
    // frame must not carry both statements at once.
    assert.equal(codes.includes("COVERAGE_LOSS"), false, `no sub-threshold notice for ${row.label}`);
  }
});

// ---------------------------------------------------------------------------
// Biased masks on a 192x192 circular beam (sigma 10, amplitude 1000,
// sigma_B = 5): a dead annulus, dead wings, a dead sensor block.
// ---------------------------------------------------------------------------
const MASK_SIZE = 192;
const MASK_TRUTH_D4 = 40;

function biasedMaskScene(kind: "annulus" | "wings" | "block" | "none" | "core" | "stripes" | "half" | "sparse"): Float32Array {
  const pixels = gaussianSceneF32(MASK_SIZE, MASK_SIZE, 95.5, 95.5, 10, 10, 0, 1000, 0);
  addGaussianNoise(pixels, 5, 606060);
  if (kind === "none") return pixels;
  if (kind === "sparse") {
    let i = 0;
    for (let y = 0; y < MASK_SIZE; y += 1) {
      for (let x = 0; x < MASK_SIZE; x += 1, i += 1) if (i % 20 !== 0) pixels[y * MASK_SIZE + x] = Number.NaN;
    }
    return pixels;
  }
  if (kind === "stripes") {
    for (let y = 0; y < MASK_SIZE; y += 1) {
      if (y % 4 !== 0) for (let x = 0; x < MASK_SIZE; x += 1) pixels[y * MASK_SIZE + x] = Number.NaN;
    }
    return pixels;
  }
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const r = Math.hypot(x - 95.5, y - 95.5);
      if (kind === "annulus" && r > 15 && r < 25) pixels[y * MASK_SIZE + x] = Number.NaN;
      if (kind === "wings" && r > 22) pixels[y * MASK_SIZE + x] = Number.NaN;
      if (kind === "core" && r < 15) pixels[y * MASK_SIZE + x] = Number.NaN;
      if (kind === "block" && x > 96 && x < 130 && y > 96 && y < 130) pixels[y * MASK_SIZE + x] = Number.NaN;
    }
  }
  return pixels;
}

test("S20 repro: a masked annulus, masked wings and a masked block are all stopped", () => {
  // Before the coverage gate these three released the widths in
  // `wasReleasedD4`, wrong by `wasErrorPercent` against the unmasked truth of
  // 40 px. The block mask is the interesting one: it pulls the two axes in
  // OPPOSITE directions (+8.5 major, -17.9 minor), which no single-axis rule
  // would have caught.
  const expected: {
    kind: "annulus" | "wings" | "block";
    finite: number;
    aperture: number;
    wasReleasedD4: number;
    wasErrorPercent: number;
    finiteFraction: number;
    biasMajor: number;
    biasMinor: number;
  }[] = [
    { kind: "annulus", finite: 3764, aperture: 5024, wasReleasedD4: 33.0514, wasErrorPercent: -17.371, finiteFraction: 0.7492, biasMajor: -17.48, biasMinor: -17.48 },
    { kind: "wings", finite: 1528, aperture: 5026, wasReleasedD4: 35.0248, wasErrorPercent: -12.438, finiteFraction: 0.304, biasMajor: -12.409, biasMinor: -12.371 },
    { kind: "block", finite: 4005, aperture: 5024, wasReleasedD4: 43.2497, wasErrorPercent: 8.124, finiteFraction: 0.7972, biasMajor: 8.451, biasMinor: -17.946 },
  ];
  for (const row of expected) {
    const result = analyzeImage({
      pixels: biasedMaskScene(row.kind),
      width: MASK_SIZE,
      height: MASK_SIZE,
      dtype: "float32",
    });
    assert.equal(result.moments.suppressionReason, "coverage_insufficient", `verdict for mask ${row.kind}`);
    assert.equal(result.moments.stageB, null, `no released moments for mask ${row.kind}`);

    const coverage = result.aperture.coverage;
    assert.equal(coverage.aperturePixelCount, row.aperture, `aperture pixels for mask ${row.kind}`);
    assert.equal(coverage.finitePixelCount, row.finite, `finite aperture pixels for mask ${row.kind}`);
    assert.equal(roundTo(coverage.finiteFraction ?? Number.NaN, 4), row.finiteFraction, `finite fraction for mask ${row.kind}`);
    assert.equal(roundTo(coverage.modelBiasMajorPercent ?? Number.NaN, 3), row.biasMajor, `major bias for mask ${row.kind}`);
    assert.equal(roundTo(coverage.modelBiasMinorPercent ?? Number.NaN, 3), row.biasMinor, `minor bias for mask ${row.kind}`);
    // The estimator lands within a percentage point of the error the row used
    // to release against the unmasked truth of MASK_TRUTH_D4.
    assert.ok(
      Math.abs(row.biasMajor - row.wasErrorPercent) < 1,
      `estimator vs the shipped error for mask ${row.kind} (${row.biasMajor} vs ${row.wasErrorPercent}, from d4 ${row.wasReleasedD4} against ${MASK_TRUTH_D4})`,
    );
    assert.ok(shortWarningCodes(result).includes("FLOAT_SPECIALS"));
  }
});

test("S20 repro: a frame resting on 5 percent of its aperture is stopped by the coverage floor", () => {
  // The sparse mask keeps every twentieth pixel. 250 of 5007 aperture pixels
  // carry data; before the gate the frame released a d4 of 40.31.
  //
  // This row is the reason the gate has a second arm. A uniform decimation
  // biases the model raster and the observed field in exactly the same way, so
  // the bias estimator reads ~0.00 percent and is BLIND here. What stops the
  // frame is the finite-fraction floor: 0.0499 against a floor of 0.2.
  const result = analyzeImage({
    pixels: biasedMaskScene("sparse"),
    width: MASK_SIZE,
    height: MASK_SIZE,
    dtype: "float32",
  });
  assert.equal(result.moments.suppressionReason, "coverage_insufficient");
  assert.equal(result.moments.stageB, null);

  const coverage = result.aperture.coverage;
  assert.equal(coverage.aperturePixelCount, 5007);
  assert.equal(coverage.finitePixelCount, 250);
  assert.equal(roundTo(coverage.finiteFraction ?? Number.NaN, 4), 0.0499);
  assert.equal(coverage.high, true);
  assert.ok(
    Math.abs(coverage.modelBiasMajorPercent ?? Number.NaN) < 0.1,
    `the bias arm is blind on a uniform decimation (${coverage.modelBiasMajorPercent})`,
  );
  assert.ok(shortWarningCodes(result).includes("FLOAT_SPECIALS"));

  // Control: the same scene with no mask at all. It has no non-finite pixels,
  // so the coverage block is never entered and its fields carry the no-data
  // defaults — the released number is bit-identical to the pre-gate value.
  const clean = analyzeImage({
    pixels: biasedMaskScene("none"),
    width: MASK_SIZE,
    height: MASK_SIZE,
    dtype: "float32",
  });
  assert.equal(clean.moments.suppressionReason, null);
  assert.equal(clean.moments.stageB?.finitePixelCount, 5024);
  assert.equal(roundTo(clean.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 4), 39.9835);
  assert.equal(clean.raw.nonFiniteCount, 0);
  assert.equal(clean.aperture.coverage.aperturePixelCount, 0);
  assert.equal(clean.aperture.coverage.finiteFraction, null);
  assert.equal(clean.aperture.coverage.modelBiasMajorPercent, null);
  assert.equal(clean.aperture.coverage.high, false);
});
