// S20 repro corpus — the three places where the honesty instruments are
// quietest on the worst inputs.
//
// 1. Wing probes: the absorbed-power detector loses its long-reach probes
//    exactly at the ROI sizes the workbench itself steers to. At ROI 100 the
//    frame releases a width that is 41.8 percent below the whole-frame truth
//    with an EMPTY warning list.
// 2. Alpha threshold: the self-calibrated consistency ceiling grows with the
//    background noise without an upper bound, so a genuinely non-Gaussian beam
//    walks through it at high sigma_B and is released 40 percent low.
// 3. Cross-tier check: a residual ramp that makes the stage-A moments
//    indefinite silences the tier comparison entirely, so the released number
//    goes out unchecked rather than checked-and-fine.
//
// These were the BEFORE numbers for the honesty-floor stage. That stage has
// landed, and this file has been re-pinned once: it now records what each of
// those three frames says AFTER the stage, with the old value quoted in the
// comment beside every changed pin. Not one suppression decision moved - the
// stage is additive observability only, and the re-pins below are the proof
// (every released d4 and every suppressionReason is unchanged to the digit).
//
// Re-pin ledger (old -> new):
//   floor of the absorbed-power ceiling   0.3 percent -> 0.05 percent
//   wing ROI 140 / 120 / 100 absorbed.high  false -> true (three silent frames
//                                          that now speak; the excesses
//                                          0.1792 / 0.1265 / 0.0735 percent
//                                          are unchanged, only the floor moved)
//   wing ROI 100 warning list             [] -> [ABSORBED_POWER,
//                                          WING_PROBE_REDUCED]
//   alpha ceiling sigma_B 50 / 100 / 150  the released rows now carry
//                                          ALPHA_GATE_WEAK (info)
//   ramp slope 2 / 5                      now carry TIER_CHECK_UNAVAILABLE
//                                          (info, reason stage_a_invalid)
//
// Runtime: about 25 s.

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeImage } from "../../packages/image/src/analyze.ts";
import { computeRectMoments } from "../../packages/image/src/moments.ts";
import {
  addGaussian,
  addGaussianNoise,
  gaussianSceneF32,
  relativeErrorPercent,
  roundTo,
  shortWarningCodes,
} from "./lib/scenes.ts";

// ---------------------------------------------------------------------------
// 1. Wing-probe reach vs ROI size.
// 512x512, core sigma 8x6 amplitude 1000, plus a halo of amplitude 0.5
// (0.05 percent of peak) at 8x the core width. Noise-free on purpose: the
// probe reach, not the noise, is the variable under study.
// ---------------------------------------------------------------------------
const WING_SIZE = 512;
const WING_CENTRE = 255.5;

function wingScene(withHalo: boolean): Float32Array {
  const pixels = gaussianSceneF32(WING_SIZE, WING_SIZE, WING_CENTRE, WING_CENTRE, 8, 6, 0, 1000, 0);
  if (withHalo) addGaussian(pixels, WING_SIZE, WING_SIZE, WING_CENTRE, WING_CENTRE, 64, 48, 0, 0.5);
  return pixels;
}

function centredRoi(side: number): { x0: number; y0: number; width: number; height: number } {
  const x0 = Math.round(WING_CENTRE - side / 2);
  return { x0, y0: x0, width: side, height: side };
}

test("S20 repro: the wing detector loses reach with the ROI and finally goes silent", () => {
  const pixels = wingScene(true);
  // `high` was false on the last three rows before the honesty floor landed;
  // the excess and d4 columns are unchanged from that run to the digit, which
  // is what makes this a floor change and not a measurement change.
  // `available` is the S20 stage-B probe-reach field: the reported probeAlpha
  // alone could not distinguish "the most informative radius" from "the only
  // radius left", and rows 140 / 120 / 100 are exactly the second case.
  const expected: {
    side: number;
    probeAlpha: number;
    available: number[];
    excessPercent: number;
    high: boolean;
    d4: number;
  }[] = [
    { side: 512, probeAlpha: 12, available: [4, 6, 9, 12], excessPercent: 1.7296, high: true, d4: 32.1165 },
    { side: 300, probeAlpha: 12, available: [4, 6, 9, 12], excessPercent: 1.287, high: true, d4: 32.0919 },
    { side: 200, probeAlpha: 12, available: [4, 6, 9, 12], excessPercent: 0.6323, high: true, d4: 32.0554 },
    { side: 160, probeAlpha: 9, available: [4, 6, 9], excessPercent: 0.3637, high: true, d4: 32.0319 },
    // was high: false
    { side: 140, probeAlpha: 6, available: [4, 6], excessPercent: 0.1792, high: true, d4: 32.0183 },
    // was high: false
    { side: 120, probeAlpha: 6, available: [4, 6], excessPercent: 0.1265, high: true, d4: 32.004 },
    // was high: false
    { side: 100, probeAlpha: 6, available: [4, 6], excessPercent: 0.0735, high: true, d4: 31.9896 },
  ];

  for (const row of expected) {
    const result = analyzeImage({
      pixels,
      width: WING_SIZE,
      height: WING_SIZE,
      dtype: "float32",
      roi: centredRoi(row.side),
    });
    const absorbed = result.aperture.absorbedPower;
    assert.equal(absorbed.probeAlpha, row.probeAlpha, `probe alpha at ROI ${row.side}`);
    assert.deepEqual(absorbed.availableProbeAlphas, row.available, `probe reach at ROI ${row.side}`);
    assert.equal(
      absorbed.maxAvailableProbeAlpha,
      row.available[row.available.length - 1],
      `widest available probe at ROI ${row.side}`,
    );
    assert.equal(
      roundTo(100 * (absorbed.apertureExcessFraction ?? Number.NaN), 4),
      row.excessPercent,
      `wing excess at ROI ${row.side}`,
    );
    // The floor is a constant 0.05 percent (was 0.3); only the measured excess
    // falls with the probe reach.
    assert.equal(roundTo(100 * (absorbed.thresholdFraction ?? Number.NaN), 4), 0.05, `floor at ROI ${row.side}`);
    assert.equal(absorbed.high, row.high, `wing warning armed at ROI ${row.side}`);
    assert.equal(result.moments.suppressionReason, null, `released at ROI ${row.side}`);
    assert.equal(
      roundTo(result.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 4),
      row.d4,
      `released d4 at ROI ${row.side}`,
    );
    // The probe-reach notice tracks the reach exactly: it speaks when both long
    // probes are gone and stays quiet while either survives.
    assert.equal(
      shortWarningCodes(result).includes("WING_PROBE_REDUCED"),
      row.side <= 140,
      `probe-reach notice at ROI ${row.side}`,
    );
  }

  // The formerly silent frame: ROI 100 still releases 31.9896, but no longer
  // with nothing at all to say. This assertion read `[]` before the stage.
  const tight = analyzeImage({
    pixels,
    width: WING_SIZE,
    height: WING_SIZE,
    dtype: "float32",
    roi: centredRoi(100),
  });
  assert.deepEqual(
    shortWarningCodes(tight),
    ["ABSORBED_POWER", "WING_PROBE_REDUCED"],
    "the tightest ROI is no longer silent",
  );

  // Whole-frame truth of the same scene, for the size of what goes unsaid.
  const truth = computeRectMoments(
    { values: Float64Array.from(pixels), width: WING_SIZE, height: WING_SIZE },
    { x0: 0, y0: 0, width: WING_SIZE, height: WING_SIZE },
  );
  assert.equal(roundTo(truth.d4SigmaMajorPx ?? Number.NaN, 4), 54.9734);
  assert.equal(
    roundTo(relativeErrorPercent(tight.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, truth.d4SigmaMajorPx ?? Number.NaN), 1),
    -41.8,
  );
});

test("S20 repro: the clean control reads zero wing excess at every ROI size", () => {
  // Same geometry without the halo. Whatever a later stage does to the wing
  // floor, this row must stay silent: it is the false-positive budget.
  const pixels = wingScene(false);
  for (const side of [512, 300, 200, 160, 140, 120, 100]) {
    const result = analyzeImage({
      pixels,
      width: WING_SIZE,
      height: WING_SIZE,
      dtype: "float32",
      roi: centredRoi(side),
    });
    const absorbed = result.aperture.absorbedPower;
    assert.equal(absorbed.probeAlpha, 4, `clean control probe alpha at ROI ${side}`);
    assert.equal(
      roundTo(100 * (absorbed.apertureExcessFraction ?? Number.NaN), 4),
      0,
      `clean control excess at ROI ${side}`,
    );
    // The false-positive budget of the lowered floor, row by row: every ROI
    // size of the halo-free control stays silent at 0.05 percent exactly as it
    // did at 0.3 percent.
    assert.equal(absorbed.high, false, `clean control stays silent at ROI ${side}`);
    assert.equal(
      roundTo(100 * (absorbed.thresholdFraction ?? Number.NaN), 4),
      0.05,
      `clean control floor at ROI ${side}`,
    );
    assert.equal(
      shortWarningCodes(result).includes("ABSORBED_POWER"),
      false,
      `clean control raises no wing warning at ROI ${side}`,
    );
    assert.equal(result.moments.suppressionReason, null, `clean control releases at ROI ${side}`);
    assert.equal(roundTo(result.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 4), 31.9554);
  }
});

// ---------------------------------------------------------------------------
// 2. The alpha ceiling grows with sigma_B and eventually clears a real defect.
// 192x192, core sigma 8 amplitude 1000 plus a 1-percent halo at 4x width.
// ---------------------------------------------------------------------------
const HALO_SIZE = 192;

function coreHaloScene(sigmaB: number): Float32Array {
  const pixels = new Float32Array(HALO_SIZE * HALO_SIZE);
  for (let y = 0; y < HALO_SIZE; y += 1) {
    for (let x = 0; x < HALO_SIZE; x += 1) {
      const dx = x - 95.5;
      const dy = y - 95.5;
      const r2 = dx * dx + dy * dy;
      pixels[y * HALO_SIZE + x] = 1000 * Math.exp(-r2 / (2 * 64)) + 10 * Math.exp(-r2 / (2 * 1024));
    }
  }
  if (sigmaB > 0) addGaussianNoise(pixels, sigmaB, 4242);
  return pixels;
}

test("S20 repro: an uncapped consistency ceiling releases a wing-heavy beam 40 percent low", () => {
  const clean = coreHaloScene(0);
  const truth = computeRectMoments(
    { values: Float64Array.from(clean), width: HALO_SIZE, height: HALO_SIZE },
    { x0: 0, y0: 0, width: HALO_SIZE, height: HALO_SIZE },
  );
  assert.equal(roundTo(truth.d4SigmaMajorPx ?? Number.NaN, 4), 55.4329);

  // `weakGate` is the S20 stage-B re-pin: the three released rows now carry
  // IMAGE_ALPHA_GATE_WEAK, because their ceiling (11.1 / 22.3 / 31.4 percent)
  // is past the 10 percent reporting level. Nothing about the release moved -
  // every suppression, d4 and error column is identical to the pre-stage run.
  // A cap on that ceiling was measured and rejected (it kills the pinned
  // SNR-20 release curve outright), so the honest instrument is the notice,
  // not a gate.
  const expected: {
    sigmaB: number;
    deltaPercent: number;
    thresholdPercent: number;
    suppression: string | null;
    d4: number | null;
    errorPercent: number | null;
    tierGapPercent: number | null;
    weakGate: boolean;
  }[] = [
    { sigmaB: 0.5, deltaPercent: 11.9461, thresholdPercent: 3, suppression: "alpha_inconsistent", d4: null, errorPercent: null, tierGapPercent: null, weakGate: false },
    { sigmaB: 5, deltaPercent: 11.7517, thresholdPercent: 3, suppression: "alpha_inconsistent", d4: null, errorPercent: null, tierGapPercent: null, weakGate: false },
    { sigmaB: 20, deltaPercent: 11.0272, thresholdPercent: 4.8416, suppression: "alpha_inconsistent", d4: null, errorPercent: null, tierGapPercent: null, weakGate: false },
    { sigmaB: 50, deltaPercent: 9.356, thresholdPercent: 11.0756, suppression: null, d4: 33.6782, errorPercent: -39.245, tierGapPercent: 108.4, weakGate: true },
    { sigmaB: 100, deltaPercent: 6.3321, thresholdPercent: 22.2874, suppression: null, d4: 33.1907, errorPercent: -40.125, tierGapPercent: 147.5, weakGate: true },
    { sigmaB: 150, deltaPercent: 0.2812, thresholdPercent: 31.3522, suppression: null, d4: 33.2436, errorPercent: -40.029, tierGapPercent: 178, weakGate: true },
  ];

  for (const row of expected) {
    const result = analyzeImage({
      pixels: coreHaloScene(row.sigmaB),
      width: HALO_SIZE,
      height: HALO_SIZE,
      dtype: "float32",
    });
    const alpha = result.aperture.gates.alphaConsistency;
    assert.equal(roundTo(alpha.deltaMajorPercent ?? Number.NaN, 4), row.deltaPercent, `delta at sigmaB ${row.sigmaB}`);
    assert.equal(
      roundTo(alpha.thresholdMajorPercent, 4),
      row.thresholdPercent,
      `ceiling at sigmaB ${row.sigmaB}`,
    );
    assert.equal(result.moments.suppressionReason, row.suppression, `verdict at sigmaB ${row.sigmaB}`);
    assert.equal(
      shortWarningCodes(result).includes("ALPHA_GATE_WEAK"),
      row.weakGate,
      `weak-ceiling notice at sigmaB ${row.sigmaB}`,
    );
    if (row.d4 === null) {
      assert.equal(result.moments.stageB, null, `nothing released at sigmaB ${row.sigmaB}`);
      continue;
    }
    const d4 = result.moments.stageB?.d4SigmaMajorPx ?? Number.NaN;
    assert.equal(roundTo(d4, 4), row.d4, `released d4 at sigmaB ${row.sigmaB}`);
    assert.equal(
      roundTo(relativeErrorPercent(d4, truth.d4SigmaMajorPx ?? Number.NaN), 3),
      row.errorPercent,
      `released error at sigmaB ${row.sigmaB}`,
    );

    // The cross-tier gap is enormous and still does not fire: the stage-A
    // noise scale grows with sigma_B along with the ceiling.
    const stageA = result.momentsRoiDiagnostic.moments.d4SigmaMajorPx ?? Number.NaN;
    assert.equal(
      roundTo((100 * Math.abs(stageA - d4)) / d4, 1),
      row.tierGapPercent,
      `cross-tier gap at sigmaB ${row.sigmaB}`,
    );
    assert.ok(
      !shortWarningCodes(result).includes("TIER_DISAGREEMENT"),
      `the tier warning stays silent at sigmaB ${row.sigmaB}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. The cross-tier check disappears when the stage-A moments turn indefinite.
// 96x72, sigma 6x4, amplitude 10000, plus a linear ramp, rect-median over four
// corner rectangles.
// ---------------------------------------------------------------------------
const RAMP_W = 96;
const RAMP_H = 72;
const RAMP_CX = 47.5;
const RAMP_CY = 35.5;
const RAMP_TRUTH_MAJOR = 24;
const RAMP_TRUTH_MINOR = 16;
const RAMP_CORNERS = [
  { x0: 0, y0: 0, width: 12, height: 9 },
  { x0: RAMP_W - 12, y0: 0, width: 12, height: 9 },
  { x0: 0, y0: RAMP_H - 9, width: 12, height: 9 },
  { x0: RAMP_W - 12, y0: RAMP_H - 9, width: 12, height: 9 },
];

function rampScene(slope: number): number[] {
  const values: number[] = new Array<number>(RAMP_W * RAMP_H);
  for (let y = 0; y < RAMP_H; y += 1) {
    for (let x = 0; x < RAMP_W; x += 1) {
      const dx = (x - RAMP_CX) / 6;
      const dy = (y - RAMP_CY) / 4;
      values[x + y * RAMP_W] = 1000 + 10000 * Math.exp(-0.5 * (dx * dx + dy * dy)) + slope * (x - RAMP_CX);
    }
  }
  return values;
}

test("S20 repro: a steeper ramp silences the cross-tier check instead of tripping it", () => {
  // `tierEvaluated` and `unavailable` are the S20 stage-B re-pin: the two
  // steep rows used to be indistinguishable from a checked-and-fine frame -
  // no tier warning, and the only signal was IMAGE_MOMENTS_UNDEFINED, which
  // speaks about the DIAGNOSTIC tier and not about the released number. They
  // now carry IMAGE_TIER_CHECK_UNAVAILABLE with the reason named. The released
  // bias and centroid columns are unchanged: no gate moved.
  const expected: {
    slope: number;
    stageAValid: boolean;
    tierWarning: boolean;
    tierEvaluated: boolean;
    unavailable: string | null;
    biasMajorPercent: number;
    centroidX: number;
  }[] = [
    { slope: 0, stageAValid: true, tierWarning: false, tierEvaluated: true, unavailable: null, biasMajorPercent: -0.1346, centroidX: 47.5 },
    { slope: 1, stageAValid: true, tierWarning: true, tierEvaluated: true, unavailable: null, biasMajorPercent: -0.1529, centroidX: 47.6152 },
    { slope: 2, stageAValid: false, tierWarning: false, tierEvaluated: false, unavailable: "stage_a_invalid", biasMajorPercent: -0.2077, centroidX: 47.7303 },
    { slope: 5, stageAValid: false, tierWarning: false, tierEvaluated: false, unavailable: "stage_a_invalid", biasMajorPercent: -0.4922, centroidX: 48.0724 },
  ];

  for (const row of expected) {
    const result = analyzeImage({
      pixels: rampScene(row.slope),
      width: RAMP_W,
      height: RAMP_H,
      dtype: "float32",
      background: { method: "rect-median", rects: RAMP_CORNERS },
      backgroundSigmaRects: RAMP_CORNERS,
    });
    const stageB = result.moments.stageB;
    assert.equal(result.moments.suppressionReason, null, `released at slope ${row.slope}`);
    assert.equal(
      result.momentsRoiDiagnostic.moments.valid,
      row.stageAValid,
      `stage-A validity at slope ${row.slope}`,
    );
    assert.equal(
      shortWarningCodes(result).includes("TIER_DISAGREEMENT"),
      row.tierWarning,
      `tier warning at slope ${row.slope}`,
    );
    assert.equal(result.tierCheck.evaluated, row.tierEvaluated, `tier check evaluated at slope ${row.slope}`);
    assert.equal(
      result.tierCheck.unavailableReason === null ? null : result.tierCheck.unavailableReason.kind,
      row.unavailable,
      `tier check reason at slope ${row.slope}`,
    );
    assert.equal(
      shortWarningCodes(result).includes("TIER_CHECK_UNAVAILABLE"),
      row.unavailable !== null,
      `tier-unavailable notice at slope ${row.slope}`,
    );
    assert.equal(
      roundTo(relativeErrorPercent(stageB?.d4SigmaMajorPx ?? Number.NaN, RAMP_TRUTH_MAJOR), 4),
      row.biasMajorPercent,
      `released major bias at slope ${row.slope}`,
    );
    assert.equal(roundTo(stageB?.centroidXPx ?? Number.NaN, 4), row.centroidX, `centroid at slope ${row.slope}`);
  }

  // The minor axis is untouched throughout: the released damage of a residual
  // ramp is a centroid drift, not a width error.
  const steep = analyzeImage({
    pixels: rampScene(5),
    width: RAMP_W,
    height: RAMP_H,
    dtype: "float32",
    background: { method: "rect-median", rects: RAMP_CORNERS },
    backgroundSigmaRects: RAMP_CORNERS,
  });
  assert.equal(
    roundTo(relativeErrorPercent(steep.moments.stageB?.d4SigmaMinorPx ?? Number.NaN, RAMP_TRUTH_MINOR), 4),
    -0.12,
  );
  assert.equal(steep.momentsRoiDiagnostic.moments.invalidReason, "indefinite_covariance");
});
