import assert from "node:assert/strict";
import test from "node:test";

import { assessAperture, type ApertureAssessment } from "../../packages/image/src/aperture.ts";
import { fitGauss2d, type FitResult, type Gauss2dFitParams } from "../../packages/image/src/fit.ts";
import {
  ALPHA_CONSISTENCY_MAX_PERCENT,
  ALPHA_MC_MIN_DEC_SIGMA_PX,
  ALPHA_MC_MIN_VALID,
  ALPHA_MC_REALIZATIONS,
  COVERAGE_MIN_FINITE_FRACTION,
  MEDIAN_PEAK_MIN_SIGMA,
  MULTI_PEAK_MIN_PEAK_FRACTION,
  MULTI_PEAK_SEPARATION_WIDTH_FACTOR,
  RESIDUAL_RMS_PEAK_FRACTION,
} from "../../packages/image/src/thresholds.ts";

// Deterministic inline LCG for noise fixtures; identical sequence on every run.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// Unit-variance noise from a uniform [0,1) draw: (u - 0.5) * sqrt(12).
// Support is [-sqrt(3), sqrt(3)], so `amplitude * unitGaussian(next)` never
// exceeds amplitude * 1.732: fixtures can rely on the noise never crossing
// a threshold a few times its own scale.
function unitGaussian(next: () => number): number {
  return (next() - 0.5) * Math.sqrt(12);
}

// Deterministic mulberry32 PRNG, identical to the production alpha-MC PRNG
// (packages/image/src/aperture.ts). The S18 release/field oracles below use
// this plus Box-Muller so the test-side noise exercises the same numerics as
// the production null.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Adds iid N(0, sigmaB^2) noise to a pixel array with a fixed literal seed.
// Box-Muller with u1 = 1 - rand() (never ln(0)) and the paired spare cached
// locally, so every seed yields a bit-identical noise field on every run.
function addGaussianNoise(pixels: number[], sigmaB: number, seed: number): void {
  const rand = mulberry32(seed >>> 0);
  let spare: number | null = null;
  for (let i = 0; i < pixels.length; i += 1) {
    let value: number;
    if (spare !== null) {
      value = spare;
      spare = null;
    } else {
      let u1 = 0;
      while (u1 <= 0) u1 = 1 - rand();
      const u2 = rand();
      const radius = Math.sqrt(-2 * Math.log(u1));
      const angle = 2 * Math.PI * u2;
      spare = radius * Math.sin(angle);
      value = radius * Math.cos(angle);
    }
    pixels[i] += sigmaB * value;
  }
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function gaussian2dPixels(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  sigma1: number,
  sigma2: number,
  theta: number,
  amplitude: number,
  background: number,
): number[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      pixels[x + y * width] =
        background + amplitude * Math.exp(-((u * u) / (2 * sigma1 * sigma1) + (v * v) / (2 * sigma2 * sigma2)));
    }
  }
  return pixels;
}

function maxFinite(values: number[]): number {
  let peak = -Infinity;
  for (const value of values) {
    if (Number.isFinite(value) && value > peak) peak = value;
  }
  return peak;
}

// A hand-built converged fit result for gate-precedence oracles that do not
// need a real LM run.
function syntheticFitResult(params: Gauss2dFitParams): FitResult<Gauss2dFitParams> {
  return {
    status: "converged",
    converged: true,
    params,
    iterations: 3,
    costInitial: 1,
    costFinal: 0.1,
    residualRmsCounts: 0.3,
    residualMaxAbsCounts: 0.6,
    decimated: false,
    decimationFactor: 1,
    startSource: "half-area",
  };
}

test("S18a aperture pipeline releases the stage-B moments of a noisy rotated Gaussian near the 4-sigma truncation factor", () => {
  // revised: the frame is widened to 160 x 160 and the centre moved away from
  // the border because the new aperture-clipping gate requires the 6-sigma
  // check ellipse to lie fully inside the image (the old 96 x 96 fixture was
  // legitimately clipped and is now expected to be suppressed).
  const width = 160;
  const height = 160;
  const centerX = 79.3;
  const centerY = 79.7;
  const sigma1 = 9;
  const sigma2 = 5;
  const theta = 0.6;
  const amplitude = 100;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigma1, sigma2, theta, amplitude, 0);
  const next = makeLcg(20240711);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const params = fit.params as Gauss2dFitParams;

  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 0.5);
  assert.equal(assessment.alphaUsed, 4);
  assert.equal(assessment.suppressionReason, null);
  assert.notEqual(assessment.moments, null);
  assert.equal(assessment.moments!.valid, true);
  assert.equal(assessment.gates.fitConverged, true);
  assert.equal(assessment.gates.amplitudePositive, true);
  assert.equal(assessment.gates.clipping.checkEllipseInside, true);
  assert.equal(assessment.gates.residual.high, false);
  assert.equal(assessment.gates.alphaConsistency.inconsistent, false);
  assert.notEqual(assessment.gates.alphaConsistency.deltaMajorPercent, null);
  assert.notEqual(assessment.gates.alphaConsistency.deltaMinorPercent, null);
  assert.equal(assessment.gates.multiPeak.detected, false);

  // The alpha=4 aperture of a pure Gaussian truncates the second moment by
  // the documented 0.9986568 factor (the moments oracle pins that number for
  // the radius-4-sigma case). The released d4sigma must land within 1 percent
  // of 4 * sigmaTrue * factor, and the ratio to the fit's own 4*sigmaMajor
  // must reproduce the factor.
  const truncationFactor = 0.9986568;
  const expectedD4Major = 4 * sigma1 * truncationFactor;
  const d4Major = assessment.moments!.d4SigmaMajorPx!;
  assert.ok(
    d4Major >= 0.99 * expectedD4Major && d4Major <= 1.005 * expectedD4Major,
    `d4Major ${d4Major} vs band around ${expectedD4Major}`,
  );
  assert.ok(
    relativeError(d4Major / (4 * params.sigmaMajorPx), truncationFactor) < 0.01,
    `truncation ratio ${d4Major / (4 * params.sigmaMajorPx)}`,
  );

  const peakCorr = maxFinite(pixels);
  assert.equal(assessment.peakToBackgroundNoise, peakCorr / 0.5);
  assert.equal(assessment.pedestal.hint, false);
});

test("S18a a non-converged fit is suppressed as fit_not_converged with null moments and null fitWidths", () => {
  const width = 48;
  const height = 48;
  const pixels = gaussian2dPixels(width, height, 24, 24, 8, 6, 0.2, 80, 2);
  const roi = { x0: 0, y0: 0, width, height };
  const capped = fitGauss2d({ values: pixels, width, height }, roi, { maxIterations: 1 });
  assert.equal(capped.status, "max_iterations");

  const assessment = assessAperture({ values: pixels, width, height }, roi, capped, 1);
  assert.equal(assessment.gates.fitConverged, false);
  assert.equal(assessment.suppressionReason, "fit_not_converged");
  assert.equal(assessment.moments, null);
  assert.equal(assessment.fitWidths, null);
  // The later gates are still evaluated against the (non-null) parameter
  // vector, so every reported number stays NaN-free.
  assert.ok(Number.isFinite(assessment.gates.residual.rmsCounts));
  assert.ok(Number.isFinite(assessment.gates.residual.maxAllowedCounts));
  assert.ok(Number.isInteger(assessment.gates.multiPeak.significantPeakCount));

  // No parameter vector at all (invalid start): the no-data defaults are
  // rms 0 / high false, amplitude positive, check ellipse reported inside,
  // null alpha deltas / not inconsistent and zero peaks.
  const nanValues = new Float64Array(8 * 8).fill(Number.NaN);
  const nanFit = fitGauss2d({ values: nanValues, width: 8, height: 8 }, { x0: 0, y0: 0, width: 8, height: 8 });
  const defaults = assessAperture(
    { values: nanValues, width: 8, height: 8 },
    { x0: 0, y0: 0, width: 8, height: 8 },
    nanFit,
    1,
  );
  assert.equal(defaults.suppressionReason, "fit_not_converged");
  assert.equal(defaults.moments, null);
  assert.equal(defaults.fitWidths, null);
  assert.equal(defaults.gates.amplitudePositive, true);
  assert.equal(defaults.gates.clipping.checkEllipseInside, true);
  assert.equal(defaults.gates.residual.rmsCounts, 0);
  assert.equal(defaults.gates.residual.high, false);
  assert.equal(defaults.gates.alphaConsistency.deltaMajorPercent, null);
  assert.equal(defaults.gates.alphaConsistency.deltaMinorPercent, null);
  assert.equal(defaults.gates.alphaConsistency.inconsistent, false);
  assert.equal(defaults.gates.multiPeak.significantPeakCount, 0);
  assert.equal(defaults.gates.multiPeak.detected, false);
  assert.equal(defaults.pedestal.meanOutsideRelativeToPeak, null);
  assert.equal(defaults.pedestal.fittedBackgroundRelativeToPeak, null);
  assert.equal(defaults.pedestal.hint, false);
});

test("S18a residual gate: a pure-noise SNR 20 beam passes the R4 bound, an off-centre second Gaussian fails it first", () => {
  // R4/P4-H2 regression. Peak 100 with sigmaB = 1 puts the pure-noise RMS at
  // ~1 count, which is 1 percent of the peak: the old v4 ceiling of 5
  // percent of peak would have flagged pure noise, while the noise-relative
  // bound max(2*sigmaB, 0.005*peak) = 2 comfortably passes it. sigmaB = 1 is
  // used (not 5) so the uniform noise (max 1.73) can also never produce a
  // spurious multi-peak candidate above the 4*sigmaB = 4 threshold.
  // revised: frame widened to 160 x 160 with a centred beam so the released
  // case is not suppressed by the new clipping gate.
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, 9, 9, 0, 100, 0);
  const next = makeLcg(555);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 1 * unitGaussian(next);

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const regression = assessAperture({ values: pixels, width, height }, roi, fit, 1);
  assert.equal(regression.gates.residual.high, false);
  assert.notEqual(regression.suppressionReason, "residual_high");
  assert.equal(regression.suppressionReason, null);
  assert.notEqual(regression.moments, null);
  assert.ok(regression.gates.residual.rmsCounts > 0.5, `rms ${regression.gates.residual.rmsCounts}`);
  assert.ok(regression.gates.residual.maxAllowedCounts >= 1.9, `bound ${regression.gates.residual.maxAllowedCounts}`);

  // A second displaced Gaussian (30 percent of the main amplitude) that no
  // single Gaussian can explain: the model residual RMS far exceeds the
  // max(2*0.5, 0.005*130) = 1 count bound. The alpha and multi-peak gates on
  // such a doublet may also trip, but release precedence is fit -> amplitude
  // -> residual -> clipping -> alpha -> multiPeak, so residual_high must be
  // reported.
  const bimodal = gaussian2dPixels(width, height, 35, 48, 6, 6, 0, 100, 0);
  const second = gaussian2dPixels(width, height, 60, 48, 6, 6, 0, 30, 0);
  for (let i = 0; i < bimodal.length; i += 1) bimodal[i] += second[i];

  const doubletFit = fitGauss2d({ values: bimodal, width, height }, roi);
  const suppressed = assessAperture({ values: bimodal, width, height }, roi, doubletFit, 0.5);
  assert.equal(suppressed.gates.residual.high, true);
  assert.equal(suppressed.suppressionReason, "residual_high");
  assert.equal(suppressed.moments, null); // stage-A rect moments are never substituted
});

test("S18a a core-plus-halo profile is suppressed as alpha_inconsistent while the residual gate still passes", () => {
  // Core sigma 4 (amplitude 100) plus a 1 percent halo of sigma 16. The
  // least-squares single-Gauss fit hugs the core (the halo amplitude is too
  // small to steer it), so the model residual stays a few counts at most -
  // far below the sigmaB = 2 bound of 4 counts. But the halo skirts both
  // ellipse passes unequally: at the 4-sigma-fit boundary the halo still
  // carries exp(-(16/16)^2/2)/1-ish relative weight while the 6-sigma-fit
  // pass captures most of it, so the two d4 sigmas differ by the wing-heavy
  // amount the plan documents (~10 points and more) - firmly beyond the
  // self-calibrated ceiling. 128 x 128 keeps the 6-sigma aperture (radius
  // <= ~60 px) fully inside the frame so clipping cannot wash the comparison
  // out. The halo is spatial structure, not a constant background, so the
  // new fit-background subtraction does NOT remove it and the gate still
  // fires. S18_GATE_CALIBRATION_SPEC section 6.1: the fixture runs at
  // sigmaB = 2 (stays suppressed with margin) instead of 5, because at SNR 20
  // the defect is statistically unidentifiable under any self-calibrating
  // design that meets the SNR-20 release oracle.
  const width = 128;
  const height = 128;
  const roi = { x0: 0, y0: 0, width, height };
  const centerX = 64;
  const centerY = 64;
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const r2 = dx * dx + dy * dy;
      pixels[x + y * width] = 100 * Math.exp(-r2 / (2 * 16)) + 1 * Math.exp(-r2 / (2 * 256));
    }
  }

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 2);
  assert.equal(assessment.gates.residual.high, false);
  assert.equal(
    assessment.gates.alphaConsistency.inconsistent,
    true,
    `deltas ${assessment.gates.alphaConsistency.deltaMajorPercent} / ${assessment.gates.alphaConsistency.deltaMinorPercent}`,
  );
  const deltaMajor = assessment.gates.alphaConsistency.deltaMajorPercent;
  const deltaMinor = assessment.gates.alphaConsistency.deltaMinorPercent;
  assert.ok(deltaMajor !== null && deltaMinor !== null);
  assert.ok(
    (deltaMajor as number) > 3 || (deltaMinor as number) > 3,
    `deltas ${deltaMajor} / ${deltaMinor}`,
  );
  assert.equal(assessment.suppressionReason, "alpha_inconsistent");
  assert.equal(assessment.moments, null); // no stage-A substitution
  assert.notEqual(assessment.fitWidths, null); // model-bound widths still reported

  // S18_GATE_CALIBRATION_SPEC section 6.1 companion: the SAME fixture at
  // sigmaB = 5 (SNR 20) now RELEASES. The wing-heavy delta is real structure
  // but at this noise level it is statistically indistinguishable from the
  // null distribution the self-calibrated ceiling is built from - this is the
  // documented, intentional behaviour change (pinned, never weakened).
  const released = assessAperture({ values: pixels, width, height }, roi, fit, 5);
  assert.equal(
    released.gates.alphaConsistency.inconsistent,
    false,
    `released deltas ${released.gates.alphaConsistency.deltaMajorPercent} / ${released.gates.alphaConsistency.deltaMinorPercent}`,
  );
  assert.equal(released.suppressionReason, null);
  assert.notEqual(released.moments, null);

  // The noise-free variant (sigmaB = 0) skips the MC entirely: both
  // thresholds are exactly the 3 percent floor and the deterministic
  // wing-heavy delta (~14 percent) is still caught.
  const noiseFree = assessAperture({ values: pixels, width, height }, roi, fit, 0);
  assert.equal(noiseFree.gates.alphaConsistency.thresholdMajorPercent, 3);
  assert.equal(noiseFree.gates.alphaConsistency.thresholdMinorPercent, 3);
  assert.equal(noiseFree.gates.alphaConsistency.mcRealizationCount, 0);
  assert.equal(noiseFree.gates.alphaConsistency.inconsistent, true);
  assert.equal(noiseFree.suppressionReason, "alpha_inconsistent");
});

test("S18a multi-peak gate fires on a significant widely separated second lobe after the earlier gates pass", () => {
  // The M-4 wiring: a bright narrow spike (20 counts, sigma 2) at 60 px from
  // a strong main Gaussian (100 counts, sigma 6) in a 160 x 160 frame. The
  // spike is too narrow and too weak for the single-Gauss fit to chase (the
  // fit stays on the main lobe, sigma ~ 6-7), so its full-resolution model
  // residual (RMS ~ 0.5 count) stays under the max(2*1, 0.005*peak) = 2
  // count bound. It sits ~60 px out while BOTH ellipse windows stop at
  // 4*sigmaFit ~ 26 px and 6*sigmaFit ~ 40 px, so the alpha comparison is
  // unaffected and consistent. The separation gate 2*wEst = 4*sigmaFit < 60
  // therefore keeps both significant maxima. Both clear the self-calibrated
  // candidate threshold max(sigmaB * (sqrt(2 ln M) + MULTI_PEAK_EVT_MARGIN),
  // 0.1 * peakCorr): with M = 25600 scanned pixels the EVT arm
  // sigmaB * (sqrt(2 ln M) + 0.5) is ~5.0 counts, below the 0.1 * peakCorr
  // ~10 count floor that decides; the spike is ~20 counts (about 16.7
  // percent of the peak) and counts as a second beam. There are no other
  // maxima: the uniform noise-free field is monotone away from each
  // non-integer centre (integer centres would cancel strict 8-neighbour
  // maxima through symmetric equal-valued neighbours).
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 60.3, 80.4, 6, 6, 0, 100, 0);
  const spike = gaussian2dPixels(width, height, 120.4, 80.3, 2, 2, 0, 20, 0);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += spike[i];

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 1);
  assert.equal(assessment.gates.fitConverged, true);
  assert.equal(assessment.gates.residual.high, false);
  assert.equal(
    assessment.gates.alphaConsistency.inconsistent,
    false,
    `deltas ${assessment.gates.alphaConsistency.deltaMajorPercent} / ${assessment.gates.alphaConsistency.deltaMinorPercent}`,
  );
  assert.equal(assessment.gates.multiPeak.significantPeakCount, 2);
  assert.equal(assessment.gates.multiPeak.detected, true);
  assert.equal(assessment.suppressionReason, "multi_peak");
  assert.equal(assessment.moments, null); // no stage-A substitution
  assert.notEqual(assessment.fitWidths, null); // model-bound widths still reported
});

test("S18a sigmaB=0 no longer lets benign flank noise on a single real beam trip the multi-peak gate", () => {
  // The sigmaB=0 EVT arm collapses to 0, so without the peak-relative floor
  // the candidate threshold would collapse to value > 0 and sigma ~1e-9
  // noise on a clean Gaussian would produce a dozen "peaks" and a multi_peak
  // suppression. The self-calibrated candidate threshold
  // max(sigmaB * (sqrt(2 ln M) + MULTI_PEAK_EVT_MARGIN), 0.1 * peakCorr)
  // keeps exactly the single real maximum above the ~10-count floor while
  // the 1e-9 noise stays far below it.
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 48.4, 47.6, 5, 5, 0, 100, 0);
  const next = makeLcg(424242);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 1e-9 * unitGaussian(next);

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 0);
  assert.equal(assessment.gates.multiPeak.significantPeakCount, 1);
  assert.equal(assessment.gates.multiPeak.detected, false);
  assert.equal(assessment.suppressionReason, null);
  assert.notEqual(assessment.moments, null);
});

test("S18a a 5-percent secondary bump stays below the 10-percent multi-peak floor and is not counted", () => {
  // A secondary lobe at 5 percent of the corrected peak is below
  // MULTI_PEAK_MIN_PEAK_FRACTION (0.1): it is structural but not a second
  // beam. Only the main maximum clears the candidate floor, so the multi-
  // peak count stays at 1 and the gate does NOT report multi_peak. The
  // single-Gauss model cannot explain the 60-px-distant 5-count bump, so the
  // residual gate may legitimately suppress this fixture for OTHER reasons -
  // the oracle therefore pins only the multi-peak gate itself.
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 60.3, 80.4, 6, 6, 0, 100, 0);
  const bump = gaussian2dPixels(width, height, 120.4, 80.3, 2, 2, 0, 5, 0);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += bump[i];

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 1);
  assert.equal(assessment.gates.multiPeak.significantPeakCount, 1);
  assert.equal(assessment.gates.multiPeak.detected, false);
  assert.notEqual(assessment.suppressionReason, "multi_peak");
});

test("S18a nonpositive_amplitude suppresses a converged fit and nulls the model-bound widths", () => {
  // A converged fit whose amplitudeCounts <= 0 describes a hole, not a beam:
  // the stage-C model-bound widths of such a fit are meaningless, so both
  // fitWidths and moments must be null and the new reason fires immediately
  // after the fit gate.
  const width = 128;
  const height = 128;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 64, 64, 8, 6, 0, 100, 0);

  const inverted = syntheticFitResult({
    amplitudeCounts: -899,
    backgroundCounts: 0,
    centerXPx: 64,
    centerYPx: 64,
    sigmaMajorPx: 8,
    sigmaMinorPx: 6,
    thetaRad: 0,
  });
  const suppressed = assessAperture({ values: pixels, width, height }, roi, inverted, 1);
  assert.equal(suppressed.gates.amplitudePositive, false);
  assert.equal(suppressed.suppressionReason, "nonpositive_amplitude");
  assert.equal(suppressed.moments, null);
  assert.equal(suppressed.fitWidths, null);

  // A positive fit is unaffected by the new gate and keeps its stage-C
  // widths on the same fixture.
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const positive = assessAperture({ values: pixels, width, height }, roi, fit, 1);
  assert.equal(positive.gates.amplitudePositive, true);
  assert.notEqual(positive.suppressionReason, "nonpositive_amplitude");
  assert.notEqual(positive.fitWidths, null);
});

test("S18a aperture_clipped suppresses a beam whose 6-sigma check ellipse reaches the image border", () => {
  // Reviewer walk: beam sigma (10, 5) at cy = 80 in a 160 x 160 frame. Before
  // the clipping gate the alpha RATIO stayed below 0.14 percent for
  // cx = 24/16/8 even though both ellipse passes were truncated by the image
  // boundary, and each was released with a large true width bias. Now the
  // larger check ellipse must lie inside [0, width-1] x [0, height-1]; the
  // centred beam stays released while the edge cases are suppressed.
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const sigma1 = 10;
  const sigma2 = 5;
  const cy = 80;
  for (const cx of [24, 16, 8]) {
    const pixels = gaussian2dPixels(width, height, cx, cy, sigma1, sigma2, 0, 100, 0);
    const fit = fitGauss2d({ values: pixels, width, height }, roi);
    assert.equal(fit.status, "converged", `cx=${cx}`);
    const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 1);
    assert.equal(assessment.gates.clipping.checkEllipseInside, false, `cx=${cx}`);
    assert.equal(assessment.suppressionReason, "aperture_clipped", `cx=${cx}`);
    assert.equal(assessment.moments, null, `cx=${cx}`);
    assert.notEqual(assessment.fitWidths, null, `cx=${cx}`); // stage-C widths stay reported
  }

  const centrePixels = gaussian2dPixels(width, height, 80, cy, sigma1, sigma2, 0, 100, 0);
  const centreFit = fitGauss2d({ values: centrePixels, width, height }, roi);
  assert.equal(centreFit.status, "converged");
  const centreAssessment = assessAperture({ values: centrePixels, width, height }, roi, centreFit, 1);
  assert.equal(centreAssessment.gates.clipping.checkEllipseInside, true);
  assert.equal(centreAssessment.suppressionReason, null);
  assert.notEqual(centreAssessment.moments, null);
});

test("S18a release precedence: residual_high wins over aperture_clipped when both gates would fail", () => {
  // The documented order is fit -> nonpositive_amplitude -> residual ->
  // aperture_clipped -> alpha -> multiPeak: the first failing gate is the
  // reported reason. This hand-built fit claims a beam at the left edge
  // (clipped) whose residual against the real data (a beam on the right) is
  // also astronomically high, so residual_high must be reported.
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 72, 48, 9, 9, 0, 150, 0);
  const manualFit = syntheticFitResult({
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: 12,
    centerYPx: 48,
    sigmaMajorPx: 10,
    sigmaMinorPx: 10,
    thetaRad: 0,
  });
  const assessment = assessAperture({ values: pixels, width, height }, roi, manualFit, 1);
  assert.equal(assessment.gates.clipping.checkEllipseInside, false); // 12 - 60 < 0
  assert.equal(assessment.gates.residual.high, true);
  assert.equal(assessment.suppressionReason, "residual_high");
  assert.equal(assessment.moments, null);
});

test("S18a the stage-B alpha gate and moments ignore the constant background the fit absorbed (B_eff = 0 semantics)", () => {
  // Measured defect: with a mathematically perfect fit of beam + CONSTANT
  // 0.1-percent-of-peak background, the unsubtracted constant drove the
  // alpha delta to 5.4 percent (suppression) while the pedestal hint stayed
  // inert. Stage B now runs the two ellipse passes and the pedestal scan on
  // the fit-background-subtracted field, so the constant the fit accounts
  // for no longer disturbs the gate; the 0.1 percent level itself stays
  // below the 0.5 percent hint fraction (a 1 percent constant fires the
  // revised pedestal oracle below).
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const clean = gaussian2dPixels(width, height, 79.3, 79.7, 9, 5, 0.3, 100, 0);
  const contaminated = clean.map((v) => v + 0.1);

  const cleanFit = fitGauss2d({ values: clean, width, height }, roi);
  const contaminatedFit = fitGauss2d({ values: contaminated, width, height }, roi);
  assert.equal(cleanFit.status, "converged");
  assert.equal(contaminatedFit.status, "converged");

  const cleanAssessment = assessAperture({ values: clean, width, height }, roi, cleanFit, 1);
  assert.equal(cleanAssessment.suppressionReason, null);
  assert.notEqual(cleanAssessment.moments, null);

  const contaminatedAssessment = assessAperture({ values: contaminated, width, height }, roi, contaminatedFit, 1);
  assert.equal(
    contaminatedAssessment.gates.alphaConsistency.inconsistent,
    false,
    `deltas ${contaminatedAssessment.gates.alphaConsistency.deltaMajorPercent} / ${contaminatedAssessment.gates.alphaConsistency.deltaMinorPercent}`,
  );
  assert.equal(contaminatedAssessment.suppressionReason, null);
  assert.notEqual(contaminatedAssessment.moments, null);

  // The released moments stay within 1 percent of the clean reference.
  const contaminatedMoments = contaminatedAssessment.moments as ApertureAssessment["moments"] & NonNullable<ApertureAssessment["moments"]>;
  const cleanMoments = cleanAssessment.moments as NonNullable<ApertureAssessment["moments"]>;
  assert.ok(relativeError(contaminatedMoments.centroidXPx as number, cleanMoments.centroidXPx as number) < 0.01);
  assert.ok(relativeError(contaminatedMoments.centroidYPx as number, cleanMoments.centroidYPx as number) < 0.01);
  assert.ok(relativeError(contaminatedMoments.sigmaMajorPx as number, cleanMoments.sigmaMajorPx as number) < 0.01);
  assert.ok(relativeError(contaminatedMoments.sigmaMinorPx as number, cleanMoments.sigmaMinorPx as number) < 0.01);

  // The fit absorbed the constant: ~0.1 counts against ~100 peak.
  const fittedRelative = contaminatedAssessment.pedestal.fittedBackgroundRelativeToPeak;
  assert.notEqual(fittedRelative, null);
  assert.ok(Math.abs((fittedRelative as number) - 0.001) < 0.0005, `fitted ${fittedRelative}`);
  // 0.1 percent is below the 0.5 percent hint threshold, so the hint stays off.
  assert.equal(contaminatedAssessment.pedestal.hint, false);
});

test("S18a pedestal hint fires whenever the fitted background or the outside mean clears the 0.5 percent fraction", () => {
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };

  // revised: a 1 percent constant pedestal is absorbed by the fit as
  // backgroundCounts ~ 1. Before the stage-B background subtraction the hint
  // fired through meanOutsideRelativeToPeak ~ 0.01; now the outside mean is
  // measured on the subtracted field (near the far Gaussian tail) and the
  // hint fires through fittedBackgroundRelativeToPeak = |1| / peak ~ 0.01,
  // which is still the documented 1 percent pedestal that biases D4sigma by
  // +10.4 percent (R4 series).
  const withPedestal = gaussian2dPixels(width, height, 48, 48, 8, 8, 0, 100, 1);
  const pedestalFit = fitGauss2d({ values: withPedestal, width, height }, roi);
  assert.equal(pedestalFit.status, "converged");
  const pedestal = assessAperture({ values: withPedestal, width, height }, roi, pedestalFit, 1);
  assert.notEqual(pedestal.pedestal.fittedBackgroundRelativeToPeak, null);
  assert.ok(
    Math.abs((pedestal.pedestal.fittedBackgroundRelativeToPeak as number) - 0.01) < 0.002,
    `fitted ${pedestal.pedestal.fittedBackgroundRelativeToPeak}`,
  );
  assert.equal(pedestal.pedestal.hint, true);
  // The outside mean on the subtracted field is the far Gaussian tail, far
  // below the hint threshold.
  assert.notEqual(pedestal.pedestal.meanOutsideRelativeToPeak, null);
  assert.ok((pedestal.pedestal.meanOutsideRelativeToPeak as number) < 0.005);

  // A genuinely clean case keeps both components below the fraction.
  const clean = gaussian2dPixels(width, height, 48, 48, 8, 8, 0, 100, 0);
  const cleanFit = fitGauss2d({ values: clean, width, height }, roi);
  assert.equal(cleanFit.status, "converged");
  const cleanAssessment = assessAperture({ values: clean, width, height }, roi, cleanFit, 1);
  assert.equal(cleanAssessment.pedestal.hint, false);
  assert.notEqual(cleanAssessment.pedestal.meanOutsideRelativeToPeak, null);
  assert.ok((cleanAssessment.pedestal.meanOutsideRelativeToPeak as number) < 0.005);
  assert.notEqual(cleanAssessment.pedestal.fittedBackgroundRelativeToPeak, null);
  assert.ok((cleanAssessment.pedestal.fittedBackgroundRelativeToPeak as number) < 0.005);
});

test("S18a peakToBackgroundNoise follows the M9 rule exactly", () => {
  const width = 64;
  const height = 64;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 32, 32, 6, 6, 0, 100, 0);
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");

  // sigmaB = 0 turns the ratio off even though the peak is positive.
  const zeroSigma = assessAperture({ values: pixels, width, height }, roi, fit, 0);
  assert.equal(zeroSigma.peakToBackgroundNoise, null);

  // Both positive: exactly I_peak_corr / sigma_B = 100 / 4.
  const positive = assessAperture({ values: pixels, width, height }, roi, fit, 4);
  assert.equal(positive.peakToBackgroundNoise, 25);
});

test("S18a aperture assessments are deterministic and never mutate the input pixel array", () => {
  const width = 48;
  const height = 48;
  const roi = { x0: 0, y0: 0, width, height };
  const next = makeLcg(9001);
  const pixels = gaussian2dPixels(width, height, 24.2, 23.7, 7, 4.5, -0.4, 80, 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.7 * unitGaussian(next);
  const original = pixels.slice();

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  const first = assessAperture({ values: pixels, width, height }, roi, fit, 0.7);
  const second = assessAperture({ values: pixels, width, height }, roi, fit, 0.7);
  assert.deepStrictEqual(second, first);
  assert.deepStrictEqual(pixels, original);
});

test("S18a confirmed ROI bounds the 6-sigma clipping gate even when the ellipse fits in the image", () => {
  const width = 160;
  const height = 160;
  const roi = { x0: 48, y0: 48, width: 64, height: 64 };
  const pixels = gaussian2dPixels(width, height, 80, 80, 10, 10, 0, 120, 0);
  pixels[20 + 80 * width] = 1e6;
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 1);
  assert.equal(assessment.gates.clipping.checkEllipseInside, false);
  assert.equal(assessment.suppressionReason, "aperture_clipped");
  assert.equal(assessment.moments, null);
});

test("S18a poison outside the confirmed ROI cannot veto a beam whose check ellipse sits inside the ROI", () => {
  const width = 160;
  const height = 160;
  const roi = { x0: 16, y0: 16, width: 128, height: 128 };
  const pixels = gaussian2dPixels(width, height, 80, 80, 8, 5, 0.2, 100, 0);
  pixels[2 + 2 * width] = 1e6;
  pixels[157 + 2 * width] = 1e6;
  pixels[2 + 157 * width] = 1e6;
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 1);
  assert.equal(assessment.gates.clipping.checkEllipseInside, true);
  assert.equal(assessment.gates.multiPeak.detected, false);
  assert.equal(assessment.suppressionReason, null);
  assert.notEqual(assessment.moments, null);
});

test("S18 oracle: a perfect Gaussian releases at SNR 20 (>= 13/15) and at SNR 100 (15/15)", () => {
  // S18_GATE_CALIBRATION_SPEC section 7 oracle 1: 300x240, sigma (11, 6),
  // amplitude 100, 15 deterministic seeds. Noise is test-side mulberry32 +
  // Box-Muller with fixed literal seeds (identical numerics to the
  // production null), so the fixture is stable forever.
  const width = 300;
  const height = 240;
  const roi = { x0: 0, y0: 0, width, height };
  const clean = gaussian2dPixels(width, height, 150, 120, 11, 6, 0, 100, 0);
  const countReleased = (sigmaB: number, seedBase: number): number => {
    let released = 0;
    for (let i = 0; i < 15; i += 1) {
      const pixels = clean.slice();
      addGaussianNoise(pixels, sigmaB, seedBase + i);
      const fit = fitGauss2d({ values: pixels, width, height }, roi);
      const assessment = assessAperture({ values: pixels, width, height }, roi, fit, sigmaB);
      if (assessment.suppressionReason === null) released += 1;
    }
    return released;
  };
  const snr20 = countReleased(5, 0xa11ce5);
  const snr100 = countReleased(1, 0x51e5);
  assert.ok(snr20 >= 13, `SNR-20 stage-B released ${snr20}/15`);
  assert.equal(snr100, 15, `SNR-100 stage-B released ${snr100}/15`);
});

test("S20 oracle: the same release curve at SNR 50 and SNR 30 (the two cells the doc curve left unpinned)", () => {
  // Same scene family as the SNR 100 / SNR 20 oracle above: 300x240, sigma
  // (11, 6), amplitude 100, 15 deterministic seeds, sigma_B handed to
  // assessAperture explicitly. This case is purely additive - it does not
  // touch the two cells pinned above.
  //
  // docs/theory/image_analysis.md records the curve as 15/15 at SNR 100,
  // 14/15 at SNR 50, 13/15 at SNR 30 and 13/15 at SNR 20. Those two middle
  // cells had no oracle. Measured here against the shipped modules, both come
  // out at 15/15, i.e. at or above the documented figure; the exact count is
  // pinned and the documented figure is asserted as the floor, so a later
  // change that merely restores the documented curve still fails loudly
  // enough to be looked at, and one that falls below it fails outright.
  //
  // Seed choice: both new cells reuse the SNR-100 seed base, so the four-cell
  // curve is a pure sigma_B sweep over one noise realization family rather
  // than four independently chosen seed sets. Measured seed sensitivity at
  // this frame size, over eight literal bases, is 13/15 to 15/15 at SNR 50
  // and 13/15 to 15/15 at SNR 30 - the pinned cell is not the flattering end
  // of a search, it is the base the existing oracle already used.
  //
  // S20 stage I re-baseline, all four cells over the same eight bases
  // (0x51e5, 0xa11ce5, 0xb0a710, 0xc0ffee, 0xd15ea5e, 0xfeed, 0x1234,
  // 0xbeef): SNR 100 -> 14-15/15, SNR 50 -> 13-15/15, SNR 30 -> 13-15/15,
  // SNR 20 -> 13-15/15. That band, not the four point values, is what
  // docs/theory/image_analysis.md now documents; the exact counts below stay
  // pinned on the base above. See gate-calibration spec section 13.1.
  const width = 300;
  const height = 240;
  const roi = { x0: 0, y0: 0, width, height };
  const clean = gaussian2dPixels(width, height, 150, 120, 11, 6, 0, 100, 0);
  const countReleased = (sigmaB: number, seedBase: number): number => {
    let released = 0;
    for (let i = 0; i < 15; i += 1) {
      const pixels = clean.slice();
      addGaussianNoise(pixels, sigmaB, seedBase + i);
      const fit = fitGauss2d({ values: pixels, width, height }, roi);
      const assessment = assessAperture({ values: pixels, width, height }, roi, fit, sigmaB);
      if (assessment.suppressionReason === null) released += 1;
    }
    return released;
  };

  const snr50 = countReleased(2, 0x51e5);
  assert.ok(snr50 >= 14, `SNR-50 stage-B released ${snr50}/15, documented floor 14/15`);
  assert.equal(snr50, 15, `SNR-50 stage-B released ${snr50}/15`);

  const snr30 = countReleased(10 / 3, 0x51e5);
  assert.ok(snr30 >= 13, `SNR-30 stage-B released ${snr30}/15, documented floor 13/15`);
  assert.equal(snr30, 15, `SNR-30 stage-B released ${snr30}/15`);
});

test("S18 oracle: a 10 percent halo at 3x width on core sigma ~11 stays alpha_inconsistent at SNR 20", () => {
  // S18_GATE_CALIBRATION_SPEC section 7 oracle 5: core sigma 11 (amplitude
  // 100) plus a 10-percent-amplitude halo at 3x width (sigma 33), 256x256,
  // one fixed seed, sigmaB = 5. The measured wing-heavy delta (~20 percent)
  // clears the self-calibrated ceiling (~14-16 percent), so the single-Gauss
  // fit's own geometry is rejected as alpha_inconsistent.
  const width = 256;
  const height = 256;
  const roi = { x0: 0, y0: 0, width, height };
  const centerX = 128;
  const centerY = 128;
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const r2 = dx * dx + dy * dy;
      pixels[x + y * width] = 100 * Math.exp(-r2 / (2 * 121)) + 10 * Math.exp(-r2 / (2 * 1089));
    }
  }
  addGaussianNoise(pixels, 5, 0x5eed);
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 5);
  assert.equal(assessment.gates.clipping.checkEllipseInside, true);
  assert.equal(assessment.gates.residual.high, false);
  assert.equal(
    assessment.gates.alphaConsistency.inconsistent,
    true,
    `deltas ${assessment.gates.alphaConsistency.deltaMajorPercent} / ${assessment.gates.alphaConsistency.deltaMinorPercent}`,
  );
  assert.equal(assessment.suppressionReason, "alpha_inconsistent");
  assert.equal(assessment.moments, null);
});

test("S18 field pins: threshold composition, sigmaB=0 EVT arm, ROI scan count, decimation, determinism", () => {
  // S18_GATE_CALIBRATION_SPEC section 7 oracle 8. Large beam: sigmaMajor 40
  // -> decimationFactor 4. Compact beam: sigmaMajor <= 10 -> decimationFactor
  // 1. thresholdCounts is exactly max(evtThresholdCounts, peakFloorCounts),
  // the EVT arm is 0 at sigmaB = 0, and scannedPixelCount is the ROI pixel
  // count. Determinism (oracle 3): two identical calls give strictly equal
  // (===) thresholds.
  const width = 480;
  const height = 480;
  const roi = { x0: 0, y0: 0, width, height };
  const large = gaussian2dPixels(width, height, 240, 240, 40, 33, 0.2, 100, 0);
  const next = makeLcg(20240818);
  for (let i = 0; i < large.length; i += 1) large[i] += 0.5 * unitGaussian(next);
  const largeFit = fitGauss2d({ values: large, width, height }, roi);
  assert.equal(largeFit.status, "converged");
  const largeAssessment = assessAperture({ values: large, width, height }, roi, largeFit, 2);
  assert.equal(largeAssessment.gates.alphaConsistency.decimationFactor, 4);
  assert.equal(largeAssessment.gates.multiPeak.scannedPixelCount, width * height);
  assert.equal(
    largeAssessment.gates.multiPeak.thresholdCounts,
    Math.max(largeAssessment.gates.multiPeak.evtThresholdCounts, largeAssessment.gates.multiPeak.peakFloorCounts),
  );

  const smallW = 96;
  const smallH = 96;
  const smallRoi = { x0: 0, y0: 0, width: smallW, height: smallH };
  const small = gaussian2dPixels(smallW, smallH, 48, 48, 8, 6, 0, 100, 0);
  const smallNext = makeLcg(20240819);
  for (let i = 0; i < small.length; i += 1) small[i] += 0.5 * unitGaussian(smallNext);
  const smallFit = fitGauss2d({ values: small, width: smallW, height: smallH }, smallRoi);
  assert.equal(smallFit.status, "converged");
  const smallAssessment = assessAperture(
    { values: small, width: smallW, height: smallH },
    smallRoi,
    smallFit,
    2,
  );
  assert.equal(smallAssessment.gates.alphaConsistency.decimationFactor, 1);
  assert.equal(smallAssessment.gates.multiPeak.scannedPixelCount, smallW * smallH);
  assert.equal(
    smallAssessment.gates.multiPeak.thresholdCounts,
    Math.max(smallAssessment.gates.multiPeak.evtThresholdCounts, smallAssessment.gates.multiPeak.peakFloorCounts),
  );

  const zero = assessAperture({ values: small, width: smallW, height: smallH }, smallRoi, smallFit, 0);
  assert.equal(zero.gates.multiPeak.evtThresholdCounts, 0);
  assert.equal(zero.gates.multiPeak.thresholdCounts, zero.gates.multiPeak.peakFloorCounts);
  assert.equal(zero.gates.alphaConsistency.thresholdMajorPercent, 3);
  assert.equal(zero.gates.alphaConsistency.thresholdMinorPercent, 3);
  assert.equal(zero.gates.alphaConsistency.mcRealizationCount, 0);

  const again = assessAperture({ values: small, width: smallW, height: smallH }, smallRoi, smallFit, 2);
  assert.equal(
    again.gates.alphaConsistency.thresholdMajorPercent,
    smallAssessment.gates.alphaConsistency.thresholdMajorPercent,
  );
  assert.equal(
    again.gates.alphaConsistency.thresholdMinorPercent,
    smallAssessment.gates.alphaConsistency.thresholdMinorPercent,
  );
  assert.equal(again.gates.multiPeak.thresholdCounts, smallAssessment.gates.multiPeak.thresholdCounts);
});

test("S18 oracle: a pure-noise ROI never shows more than one significant peak across seeds", () => {
  // S18_GATE_CALIBRATION_SPEC section 7 oracle 7: constant-sigmaB noise over
  // a 300x240 ROI, 12 deterministic seeds. The EVT threshold
  // sigmaB * (sqrt(2 ln M) + 0.5) keeps the strict-8-neighbour local-max
  // count at <= 1 in every seed. A hand-built converged parameter vector
  // keeps the multi-peak scan live; the oracle targets the candidate
  // threshold, not fit convergence on noise.
  const width = 300;
  const height = 240;
  const roi = { x0: 0, y0: 0, width, height };
  const noiseFit = syntheticFitResult({
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: 150,
    centerYPx: 120,
    sigmaMajorPx: 11,
    sigmaMinorPx: 6,
    thetaRad: 0,
  });
  for (let s = 0; s < 12; s += 1) {
    const sigmaB = 5;
    const pixels = new Array<number>(width * height).fill(0);
    addGaussianNoise(pixels, sigmaB, 0x0a11ce + s);
    const assessment = assessAperture({ values: pixels, width, height }, roi, noiseFit, sigmaB);
    assert.ok(
      assessment.gates.multiPeak.significantPeakCount <= 1,
      `seed ${s}: ${assessment.gates.multiPeak.significantPeakCount} significant peaks`,
    );
  }
});

test("S18 oracle 9.7: a line-like beam fails closed and never releases at sigmaB > 0", () => {
  // S18_GATE_CALIBRATION_SPEC section 7 oracle 9 / revisions 9.2-9.3: a fit
  // with sigmaMinor 0.15 px on a quiet matching field (fit sigmaMinor 0.11
  // measured a false RELEASE before the finite-delta guard). At sigmaB = 5
  // the MC null runs (gates 1-4 pass: the model field is exact, so the
  // residual is ~0 and the 6-sigma check ellipse is inside), but every
  // realization's ellipse passes read a single pixel row: v = 0 exactly for
  // every sample, so lambdaMinor = 0 and the 0/0 NaN delta marks every
  // realization invalid. nValid stays below ALPHA_MC_MIN_VALID and the gate
  // fails closed; the thresholds remain the finite 3 percent floor.
  const width = 300;
  const height = 240;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 150, 120, 15, 0.15, 0, 100, 0);
  const lineFit = syntheticFitResult({
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: 150,
    centerYPx: 120,
    sigmaMajorPx: 15,
    sigmaMinorPx: 0.15,
    thetaRad: 0,
  });

  const assessment = assessAperture({ values: pixels, width, height }, roi, lineFit, 5);
  assert.equal(assessment.suppressionReason, "alpha_inconsistent");
  assert.equal(assessment.moments, null);
  assert.ok(Number.isFinite(assessment.gates.alphaConsistency.thresholdMajorPercent));
  assert.ok(Number.isFinite(assessment.gates.alphaConsistency.thresholdMinorPercent));
  assert.equal(assessment.gates.alphaConsistency.nullRmsMajorPercent, null);
  assert.equal(assessment.gates.alphaConsistency.nullRmsMinorPercent, null);
  assert.ok(
    assessment.gates.alphaConsistency.mcRealizationCount < ALPHA_MC_MIN_VALID,
    `valid realizations ${assessment.gates.alphaConsistency.mcRealizationCount}`,
  );
});

test("S18 oracle 9.7: MC-skip fields are honest when sigmaB=0 and on an early-suppressed frame", () => {
  // S18_GATE_CALIBRATION_SPEC section 7 oracle 9 / revision 9.4: the MC runs
  // ONLY when gates 1-4 already passed AND sigmaB > 0. Both skipped paths
  // must report nullRms null, mcRealizationCount 0, decimationFactor 1 and
  // the 3 percent floor thresholds.
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, 9, 5, 0.6, 100, 0);
  const next = makeLcg(20240711);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");

  const zero = assessAperture({ values: pixels, width, height }, roi, fit, 0);
  assert.equal(zero.gates.alphaConsistency.thresholdMajorPercent, 3);
  assert.equal(zero.gates.alphaConsistency.thresholdMinorPercent, 3);
  assert.equal(zero.gates.alphaConsistency.nullRmsMajorPercent, null);
  assert.equal(zero.gates.alphaConsistency.nullRmsMinorPercent, null);
  assert.equal(zero.gates.alphaConsistency.mcRealizationCount, 0);
  assert.equal(zero.gates.alphaConsistency.decimationFactor, 1);

  // Early-suppressed frame (revision 9.4): residual_high fails BEFORE the
  // alpha gate, so the MC is never attempted - same honest field defaults.
  // Satellite 60 counts at sigmaB 1: the blended single-Gauss residual RMS
  // (~4 counts) clears the ceiling max(2*sigmaB, 0.005*peak) = 2 with margin,
  // so residual_high reliably fires BEFORE the alpha gate.
  const bimodal = gaussian2dPixels(width, height, 35, 48, 6, 6, 0, 100, 0);
  const second = gaussian2dPixels(width, height, 60, 48, 6, 6, 0, 60, 0);
  for (let i = 0; i < bimodal.length; i += 1) bimodal[i] += second[i];
  const doubletFit = fitGauss2d({ values: bimodal, width, height }, roi);
  const suppressed = assessAperture({ values: bimodal, width, height }, roi, doubletFit, 1);
  assert.equal(suppressed.gates.residual.high, true);
  assert.equal(suppressed.gates.alphaConsistency.thresholdMajorPercent, 3);
  assert.equal(suppressed.gates.alphaConsistency.thresholdMinorPercent, 3);
  assert.equal(suppressed.gates.alphaConsistency.nullRmsMajorPercent, null);
  assert.equal(suppressed.gates.alphaConsistency.nullRmsMinorPercent, null);
  assert.equal(suppressed.gates.alphaConsistency.mcRealizationCount, 0);
  assert.equal(suppressed.gates.alphaConsistency.decimationFactor, 1);
  assert.equal(suppressed.suppressionReason, "residual_high");
});

test("S18 oracle 9.7: hostile/degenerate fit parameters neither hang nor throw at sigmaB > 0", () => {
  // S18_GATE_CALIBRATION_SPEC revision 9.3: non-finite sigmaMajorPx /
  // sigmaMinorPx / thetaRad or a sigma <= 0 on the public assessAperture
  // surface must skip the MC (the decimation loop must never iterate on
  // non-finite input) and the assessment must return honest floor thresholds
  // plus a suppression reason - never hang, never throw. sigmaMajorPx 1e308
  // is additionally quenched by the earlier gates: the 6-sigma check ellipse
  // is not finite inside the ROI, so the MC is skipped before any allocation.
  const width = 300;
  const height = 240;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 150, 120, 15, 6, 0, 100, 0);

  const hostilePairs: Array<[number, number]> = [
    [Number.POSITIVE_INFINITY, 6],
    [1e308, 6],
    [Number.NaN, 6],
    [15, 0],
    [15, -1],
  ];

  for (const [major, minor] of hostilePairs) {
    const fit = syntheticFitResult({
      amplitudeCounts: 100,
      backgroundCounts: 0,
      centerXPx: 150,
      centerYPx: 120,
      sigmaMajorPx: major,
      sigmaMinorPx: minor,
      thetaRad: 0,
    });
    let assessment: ApertureAssessment | undefined;
    assert.doesNotThrow(() => {
      assessment = assessAperture({ values: pixels, width, height }, roi, fit, 5);
    }, `sigmaMajor ${major} sigmaMinor ${minor} threw`);
    assert.ok(assessment !== undefined);
    const a = assessment as ApertureAssessment;
    assert.ok(Number.isFinite(a.gates.alphaConsistency.thresholdMajorPercent), `sigmaMajor ${major}`);
    assert.ok(Number.isFinite(a.gates.alphaConsistency.thresholdMinorPercent), `sigmaMajor ${major}`);
    assert.equal(a.gates.alphaConsistency.nullRmsMajorPercent, null, `sigmaMajor ${major}`);
    assert.equal(a.gates.alphaConsistency.nullRmsMinorPercent, null, `sigmaMajor ${major}`);
    assert.equal(a.gates.alphaConsistency.mcRealizationCount, 0, `sigmaMajor ${major}`);
    assert.equal(a.gates.alphaConsistency.decimationFactor, 1, `sigmaMajor ${major}`);
    assert.notEqual(a.suppressionReason, null, `sigmaMajor ${major}`);
    assert.equal(a.moments, null, `sigmaMajor ${major}`);
  }
});

test("S18 oracle 9.9: a zero minor d4 is no measurement - the needle never releases, at any sigmaB", () => {
  // S18_GATE_CALIBRATION_SPEC revision 9.9 (a). A noiseless line-degenerate
  // Gaussian (sigma 12 x 1e-4, theta 0, 161 x 121, matching converged fit)
  // makes BOTH aperture passes report d4SigmaMinorPx = 0, so the OBSERVED
  // minor delta is 0/0 = NaN. Because NaN > threshold is false, the release
  // check used to wave it through whenever sigmaB = 0 skipped the MC: the
  // frame RELEASED with a headline d4SigmaMinorPx of exactly 0. A non-finite
  // observed delta is now reported as null and makes the gate inconsistent at
  // ANY sigmaB, and no MC ran, so both thresholds stay on the exact floor.
  const width = 161;
  const height = 121;
  const roi = { x0: 0, y0: 0, width, height };
  const centerX = 80;
  const centerY = 60;
  const sigmaMajorPx = 12;
  const sigmaMinorPx = 1e-4;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigmaMajorPx, sigmaMinorPx, 0, 100, 0);
  const needleFit = syntheticFitResult({
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: centerX,
    centerYPx: centerY,
    sigmaMajorPx,
    sigmaMinorPx,
    thetaRad: 0,
  });

  // sigmaB = 0 skips the MC (the pre-fix false RELEASE); sigmaB = 1 runs it
  // and every realization is invalid (revision 9.2), so the nValid path fails
  // closed. Both must suppress, and for the SAME honest reason.
  for (const sigmaB of [0, 1]) {
    const assessment = assessAperture({ values: pixels, width, height }, roi, needleFit, sigmaB);
    const alpha = assessment.gates.alphaConsistency;
    // Gates 1-4 genuinely pass here: the suppression is the alpha gate's own.
    assert.equal(assessment.gates.fitConverged, true, `sigmaB ${sigmaB}`);
    assert.equal(assessment.gates.residual.high, false, `sigmaB ${sigmaB}`);
    assert.equal(assessment.gates.clipping.checkEllipseInside, true, `sigmaB ${sigmaB}`);
    assert.equal(assessment.suppressionReason, "alpha_inconsistent", `sigmaB ${sigmaB}`);
    assert.equal(assessment.moments, null, `sigmaB ${sigmaB}`);
    assert.equal(alpha.inconsistent, true, `sigmaB ${sigmaB}`);
    // The delta fields stay honest: no measurement, no number.
    assert.equal(alpha.deltaMinorPercent, null, `sigmaB ${sigmaB}`);
    // The thresholds are the exact floor - never NaN, never widened.
    assert.equal(alpha.thresholdMajorPercent, ALPHA_CONSISTENCY_MAX_PERCENT, `sigmaB ${sigmaB}`);
    assert.equal(alpha.thresholdMinorPercent, ALPHA_CONSISTENCY_MAX_PERCENT, `sigmaB ${sigmaB}`);
    assert.equal(alpha.mcRealizationCount, 0, `sigmaB ${sigmaB}`);
    assert.equal(alpha.nullRmsMajorPercent, null, `sigmaB ${sigmaB}`);
    assert.equal(alpha.nullRmsMinorPercent, null, `sigmaB ${sigmaB}`);
  }

  // The major axis IS a genuine measurement on this frame and keeps being
  // reported: the fix nulls the degenerate axis only, never both.
  const quiet = assessAperture({ values: pixels, width, height }, roi, needleFit, 0);
  assert.ok(
    Number.isFinite(quiet.gates.alphaConsistency.deltaMajorPercent as number),
    `major delta ${quiet.gates.alphaConsistency.deltaMajorPercent}`,
  );
});

test("S18 oracle 9.9: the 1.5 px minor guard outranks the runtime budget on a rotated 16:1 needle", () => {
  // S18_GATE_CALIBRATION_SPEC revision 9.9 (b), the capped-geometry pin.
  // sigma 80 x 5 at 45 deg on a 691^2 ROI: the target rule wants b = 8, the
  // minor guard pulls it back to b = 2 (decimated minor sigma 2.5 px). The
  // superseded 32768-grid cap then doubled b to 4 (decimated minor sigma
  // 1.25 px, BELOW the documented floor), which measured a minor null rms of
  // 0.948x the full-resolution statistic and a detuned minor threshold. The
  // guard is now final and the local grid (347 x 347 = 120409 px) still
  // affords all 64 realizations inside the total-pixel budget.
  const width = 691;
  const height = 691;
  const roi = { x0: 0, y0: 0, width, height };
  const centerX = 345;
  const centerY = 345;
  const sigmaMajorPx = 80;
  const sigmaMinorPx = 5;
  const thetaRad = Math.PI / 4;
  const sigmaB = 20;
  const clean = gaussian2dPixels(width, height, centerX, centerY, sigmaMajorPx, sigmaMinorPx, thetaRad, 400, 0);

  const frozen = assessAperture(
    { values: clean, width, height },
    roi,
    syntheticFitResult({
      amplitudeCounts: 400,
      backgroundCounts: 0,
      centerXPx: centerX,
      centerYPx: centerY,
      sigmaMajorPx,
      sigmaMinorPx,
      thetaRad,
    }),
    sigmaB,
  );
  const frozenAlpha = frozen.gates.alphaConsistency;
  assert.equal(frozenAlpha.decimationFactor, 2, "the guard's b, never the superseded cap's 4");
  assert.ok(
    sigmaMinorPx / frozenAlpha.decimationFactor >= ALPHA_MC_MIN_DEC_SIGMA_PX,
    `decimated minor sigma ${sigmaMinorPx / frozenAlpha.decimationFactor} px must clear the guard`,
  );
  assert.equal(frozenAlpha.mcRealizationCount, ALPHA_MC_REALIZATIONS);
  // Measured under the new rule: null rms 2.117 %, threshold 4.657 %. The
  // bands are wide enough for last-ulp platform drift and tight enough to
  // catch a decimation regression (the cap-forced null measured 2.235 %).
  assert.ok(
    (frozenAlpha.nullRmsMinorPercent as number) > 2.0 && (frozenAlpha.nullRmsMinorPercent as number) < 2.3,
    `minor null rms ${frozenAlpha.nullRmsMinorPercent}`,
  );
  assert.ok(
    frozenAlpha.thresholdMinorPercent > 4.5 && frozenAlpha.thresholdMinorPercent < 4.9,
    `minor threshold ${frozenAlpha.thresholdMinorPercent}`,
  );

  // End to end on the seed-0 noise realization of the same scene: a perfect
  // Gaussian at SNR 20 must release. Measured 12/12 over the seeds
  // mulberry32(90210 + s), s = 0..11.
  const pixels = clean.slice();
  addGaussianNoise(pixels, sigmaB, 90210);
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, sigmaB);
  assert.equal(assessment.gates.alphaConsistency.decimationFactor, 2);
  assert.equal(
    assessment.suppressionReason,
    null,
    `deltas ${assessment.gates.alphaConsistency.deltaMajorPercent} / ${assessment.gates.alphaConsistency.deltaMinorPercent}` +
      ` vs ${assessment.gates.alphaConsistency.thresholdMajorPercent} / ${assessment.gates.alphaConsistency.thresholdMinorPercent}`,
  );
  assert.ok(assessment.moments !== null);
});

test("S18 oracle 9.9: the runtime budget lowers the realization count, never the decimation guard", () => {
  // S18_GATE_CALIBRATION_SPEC revision 9.9 (b), invariant 2. sigma 118 x 4 at
  // 45 deg: the guard fixes b = 2 (decimated minor sigma 2 px) and the local
  // grid is 507 x 507 = 257049 px, so ALPHA_MC_MAX_TOTAL_GRID_PIXELS affords
  // 32 realizations rather than 64. N gives way, the guard does not, and the
  // beam still releases on a null the gate can stand behind.
  const width = 1011;
  const height = 1011;
  const roi = { x0: 0, y0: 0, width, height };
  const centerX = 505;
  const centerY = 505;
  const sigmaMajorPx = 118;
  const sigmaMinorPx = 4;
  const thetaRad = Math.PI / 4;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigmaMajorPx, sigmaMinorPx, thetaRad, 400, 0);
  const assessment = assessAperture(
    { values: pixels, width, height },
    roi,
    syntheticFitResult({
      amplitudeCounts: 400,
      backgroundCounts: 0,
      centerXPx: centerX,
      centerYPx: centerY,
      sigmaMajorPx,
      sigmaMinorPx,
      thetaRad,
    }),
    20,
  );
  const alpha = assessment.gates.alphaConsistency;
  assert.equal(alpha.decimationFactor, 2, "the guard's b, never the superseded cap's 8");
  assert.ok(
    sigmaMinorPx / alpha.decimationFactor >= ALPHA_MC_MIN_DEC_SIGMA_PX,
    `decimated minor sigma ${sigmaMinorPx / alpha.decimationFactor} px must clear the guard`,
  );
  assert.equal(alpha.mcRealizationCount, ALPHA_MC_MIN_VALID, "the budget buys exactly the floor here");
  assert.ok(alpha.mcRealizationCount < ALPHA_MC_REALIZATIONS);
  assert.ok((alpha.nullRmsMinorPercent as number) > 0, `minor null rms ${alpha.nullRmsMinorPercent}`);
  assert.equal(
    assessment.suppressionReason,
    null,
    `deltas ${alpha.deltaMajorPercent} / ${alpha.deltaMinorPercent} vs ${alpha.thresholdMajorPercent} / ${alpha.thresholdMinorPercent}`,
  );
});

test("S18 oracle 9.9: a local grid too large for the minimum realization count fails the gate closed", () => {
  // S18_GATE_CALIBRATION_SPEC revision 9.9 (b), the endgame. sigma 160 x 5 at
  // 45 deg on a 1369^2 frame: the guard fixes b = 2 (decimated minor sigma
  // 2.5 px) and the local grid is 685 x 685 = 469225 px, which cannot afford
  // ALPHA_MC_MIN_VALID realizations inside the total-pixel budget. The
  // superseded rule bought a fit by doubling b to 8 (decimated minor sigma
  // 0.625 px, below the documented floor) and released on a ceiling its own
  // null no longer supported. The gate now runs NO MC at all and fails
  // closed - not verified, therefore not released - reporting the guard's
  // decimation factor, zero realizations and the floor thresholds.
  const width = 1369;
  const height = 1369;
  const roi = { x0: 0, y0: 0, width, height };
  const centerX = 684;
  const centerY = 684;
  const sigmaMajorPx = 160;
  const sigmaMinorPx = 5;
  const thetaRad = Math.PI / 4;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigmaMajorPx, sigmaMinorPx, thetaRad, 400, 0);
  const assessment = assessAperture(
    { values: pixels, width, height },
    roi,
    syntheticFitResult({
      amplitudeCounts: 400,
      backgroundCounts: 0,
      centerXPx: centerX,
      centerYPx: centerY,
      sigmaMajorPx,
      sigmaMinorPx,
      thetaRad,
    }),
    20,
  );
  const alpha = assessment.gates.alphaConsistency;
  // Gates 1-4 pass: this is the alpha gate's own honest refusal, not an
  // earlier suppression standing in for it.
  assert.equal(assessment.gates.fitConverged, true);
  assert.equal(assessment.gates.residual.high, false);
  assert.equal(assessment.gates.clipping.checkEllipseInside, true);
  assert.equal(assessment.suppressionReason, "alpha_inconsistent");
  assert.equal(assessment.moments, null);
  assert.equal(alpha.inconsistent, true);
  assert.equal(alpha.decimationFactor, 2, "the guard's b, never the superseded cap's 8");
  assert.ok(
    sigmaMinorPx / alpha.decimationFactor >= ALPHA_MC_MIN_DEC_SIGMA_PX,
    `decimated minor sigma ${sigmaMinorPx / alpha.decimationFactor} px must clear the guard`,
  );
  assert.equal(alpha.mcRealizationCount, 0);
  assert.equal(alpha.nullRmsMajorPercent, null);
  assert.equal(alpha.nullRmsMinorPercent, null);
  assert.equal(alpha.thresholdMajorPercent, ALPHA_CONSISTENCY_MAX_PERCENT);
  assert.equal(alpha.thresholdMinorPercent, ALPHA_CONSISTENCY_MAX_PERCENT);
});

test("S18-R2 F4: the multi-peak gate reads the stage-B field, so an un-subtracted offset no longer manufactures peaks", () => {
  // Final-review finding F4. evaluateMultiPeakGate was the ONLY post-residual
  // gate still reading the raw corrected values while every other one reads
  // the fit-background-subtracted stage-B field. With an un-subtracted offset
  // above ~10 percent of the peak the candidate floor
  // (MULTI_PEAK_MIN_PEAK_FRACTION * peakCorr) sits BELOW offset + a few
  // sigmaB, so ordinary background noise maxima were counted as beams.
  const width = 192;
  const height = 192;
  const sigmaB = 200;
  const roi = { x0: 0, y0: 0, width, height };

  // Reference implementation of the pre-fix gate: the SAME strict 8-neighbour
  // scan, the SAME threshold and the SAME greedy separation counting, run on
  // the RAW corrected field. This is the red state, pinned inside the oracle
  // so the finding cannot silently come back.
  const rawFieldPeakCount = (values: number[], thresholdCounts: number, separationPx: number): number => {
    const candidates: Array<{ x: number; y: number; value: number }> = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = values[x + y * width];
        if (!(value > thresholdCounts)) continue;
        let strict = true;
        for (let dy = -1; dy <= 1 && strict; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (values[nx + ny * width] >= value) {
              strict = false;
              break;
            }
          }
        }
        if (strict) candidates.push({ x, y, value });
      }
    }
    candidates.sort((a, b) => b.value - a.value);
    const accepted: Array<{ x: number; y: number }> = [];
    for (const candidate of candidates) {
      if (accepted.every((other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) > separationPx)) {
        accepted.push(candidate);
      }
    }
    return accepted.length;
  };

  for (const offsetCounts of [0, 2000]) {
    const pixels = gaussian2dPixels(width, height, 95.5, 95.5, 11, 6, 0, 20000, offsetCounts);
    addGaussianNoise(pixels, sigmaB, 4242);
    const fit = fitGauss2d({ values: pixels, width, height }, roi);
    assert.equal(fit.status, "converged", `offset ${offsetCounts}`);
    const assessment = assessAperture({ values: pixels, width, height }, roi, fit, sigmaB);
    const raw = rawFieldPeakCount(
      pixels,
      assessment.gates.multiPeak.thresholdCounts,
      2 * MULTI_PEAK_SEPARATION_WIDTH_FACTOR * (fit.params as Gauss2dFitParams).sigmaMajorPx,
    );
    if (offsetCounts === 0) {
      // Without an offset the two fields agree: nothing about the well-behaved
      // case may change.
      assert.equal(raw, 1);
    } else {
      // Red state: on the raw field this scene counted 16 peaks and was
      // suppressed as multi_peak.
      assert.ok(raw >= 2, `offset ${offsetCounts}: raw-field peaks ${raw}`);
    }
    assert.equal(assessment.gates.multiPeak.significantPeakCount, 1, `offset ${offsetCounts}`);
    assert.equal(assessment.gates.multiPeak.detected, false, `offset ${offsetCounts}`);
    assert.notEqual(assessment.suppressionReason, "multi_peak");
    assert.notEqual(assessment.moments, null, `offset ${offsetCounts}: the beam must release`);
  }
});

test("S18-R2 F5: an early-suppressed frame reports alpha inconsistent = false, because the gate never ran", () => {
  // Final-review finding F5. Revision 9.4 skips the self-calibrating MC when
  // an earlier gate already failed, which leaves the alpha gate with nothing
  // but the bare 3 percent floor. Comparing the observed deltas against that
  // floor and exporting inconsistent = true published a verdict the gate never
  // reached; a JSON consumer read "alpha inconsistent" when the truth was
  // "alpha not evaluated". The measurements stay, the verdict goes.
  const width = 64;
  const height = 64;
  const roi = { x0: 0, y0: 0, width, height };
  const values = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - 31.5;
      const dy = y - 31.5;
      // A flat-topped profile no Gaussian can fit: the residual gate fails
      // first, long before the alpha gate would have run.
      values[x + y * width] = 1000 * Math.exp(-Math.pow((dx * dx) / 100 + (dy * dy) / 100, 3));
    }
  }
  const fit = fitGauss2d({ values, width, height }, roi);
  const assessment = assessAperture({ values, width, height }, roi, fit, 1);
  const alpha = assessment.gates.alphaConsistency;
  assert.equal(assessment.gates.residual.high, true);
  assert.equal(assessment.suppressionReason, "residual_high");
  assert.equal(assessment.moments, null);
  // The verdict is withheld ...
  assert.equal(alpha.inconsistent, false);
  // ... while every measurement the gate DID take is still exported.
  assert.notEqual(alpha.deltaMajorPercent, null);
  assert.notEqual(alpha.deltaMinorPercent, null);
  assert.ok((alpha.deltaMajorPercent as number) > ALPHA_CONSISTENCY_MAX_PERCENT);
  assert.equal(alpha.thresholdMajorPercent, ALPHA_CONSISTENCY_MAX_PERCENT);
  assert.equal(alpha.thresholdMinorPercent, ALPHA_CONSISTENCY_MAX_PERCENT);
  assert.equal(alpha.nullRmsMajorPercent, null);
  assert.equal(alpha.mcRealizationCount, 0);
  assert.equal(alpha.d4ScatterMajorPercent, null);
  assert.equal(alpha.d4ScatterMinorPercent, null);
});

test("S18-R2 F2: the alpha-MC exports the released width own noise scatter, corrected for the decimation factor", () => {
  // Final-review finding F2. The alpha gate compares two apertures on the SAME
  // realization, so it says nothing about how far the released number itself
  // moves under this image noise. The MC realizations already carry that
  // information; the export is the sample standard deviation of their
  // alpha-pass d4, mapped back from the decimated grid by the factor b.
  //
  // The oracle measures the TRUE scatter of the released d4 over independent
  // noise realizations of the same scene and compares it against the exported
  // single-image number. A missing b-correction would show up as a factor-b
  // mismatch, which is exactly what this geometry (b = 2) tests.
  const width = 200;
  const height = 200;
  const sigmaB = 30;
  const roi = { x0: 0, y0: 0, width, height };
  const released: number[] = [];
  const exported: number[] = [];
  let decimationFactor = 0;
  for (let k = 0; k < 14; k += 1) {
    const pixels = gaussian2dPixels(width, height, 99.5, 99.5, 12, 8, 0, 1000, 0);
    addGaussianNoise(pixels, sigmaB, 7000 + k * 104729);
    const fit = fitGauss2d({ values: pixels, width, height }, roi);
    const assessment = assessAperture({ values: pixels, width, height }, roi, fit, sigmaB);
    if (assessment.moments === null) continue;
    released.push(assessment.moments.d4SigmaMajorPx as number);
    const scatter = assessment.gates.alphaConsistency.d4ScatterMajorPercent;
    assert.notEqual(scatter, null);
    exported.push(scatter as number);
    decimationFactor = assessment.gates.alphaConsistency.decimationFactor;
  }
  assert.ok(released.length >= 8, `only ${released.length} released realizations`);
  assert.equal(decimationFactor, 2, "this geometry must exercise a decimated MC");
  const mean = released.reduce((a, b) => a + b, 0) / released.length;
  const variance = released.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (released.length - 1);
  const empiricalPercent = (100 * Math.sqrt(variance)) / mean;
  const exportedPercent = exported.reduce((a, b) => a + b, 0) / exported.length;
  assert.ok(
    exportedPercent > empiricalPercent / 1.5 && exportedPercent < empiricalPercent * 1.5,
    `exported ${exportedPercent} vs empirical ${empiricalPercent}`,
  );
  // The un-corrected decimated value would be off by exactly the decimation
  // factor; pin that it is NOT what is exported.
  assert.ok(
    Math.abs(exportedPercent * decimationFactor - empiricalPercent) > 0.5 * empiricalPercent,
    `a missing b-correction would have exported ${exportedPercent * decimationFactor} against ${empiricalPercent}`,
  );
});

test("S18-R2 F1a: an absorbed faint wide wing raises absorbedPower.high; a clean beam and a pure flat offset do not", () => {
  // Final-review finding F1 (a). A halo at 0.05 percent of the peak and 8x the
  // core width carries 3.2 percent of the power; the LM absorbs it into the
  // constant background term (measured backgroundCounts 0.0347 on a peak of
  // 1000), so the pedestal hint - which references the PEAK - stays four
  // orders below its fraction and both alpha passes see the same uniformly
  // subtracted level. The released d4 lands 41.6 percent below the in-frame
  // truth with nothing said about it.
  const width = 256;
  const height = 256;
  const roi = { x0: 0, y0: 0, width, height };
  const centre = 127.5;

  const wing = new Float64Array(width * height);
  const clean = new Float64Array(width * height);
  const offsetOnly = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      const core = 1000 * Math.exp(-((dx * dx) / (2 * 16) + (dy * dy) / (2 * 9)));
      const halo = 0.5 * Math.exp(-((dx * dx) / (2 * 1024) + (dy * dy) / (2 * 576)));
      wing[x + y * width] = core + halo;
      clean[x + y * width] = core;
      // A flat level the background stage failed to remove: stage B is immune
      // to it by construction, so the detector must stay silent.
      offsetOnly[x + y * width] = core + 40;
    }
  }

  const assess = (values: Float64Array) => {
    const fit = fitGauss2d({ values, width, height }, roi);
    assert.equal(fit.status, "converged");
    return assessAperture({ values, width, height }, roi, fit, 0);
  };

  const wingAssessment = assess(wing);
  const cleanAssessment = assess(clean);
  const offsetAssessment = assess(offsetOnly);

  // The scene still releases - the point of the finding is that it releases
  // a wrong number, and the instrument has to make that visible.
  assert.notEqual(wingAssessment.moments, null);
  assert.equal(wingAssessment.suppressionReason, null);
  // The blind channels stay blind: this is the red state, pinned.
  assert.equal(wingAssessment.pedestal.hint, false);
  assert.equal(wingAssessment.gates.alphaConsistency.inconsistent, false);
  // ... and the new instrument fires.
  assert.equal(wingAssessment.absorbedPower.high, true);
  assert.ok(
    (wingAssessment.absorbedPower.apertureExcessFraction as number) >
      (wingAssessment.absorbedPower.thresholdFraction as number),
    `excess ${wingAssessment.absorbedPower.apertureExcessFraction}`,
  );
  assert.notEqual(wingAssessment.absorbedPower.probeAlpha, null);

  // A clean beam and a beam on a pure flat offset are both silent. The flat
  // case is the one the naive fitB * roiPixelCount statistic could not tell
  // apart: its flat fraction is large while nothing about the released width
  // is wrong.
  assert.equal(cleanAssessment.absorbedPower.high, false);
  assert.equal(offsetAssessment.absorbedPower.high, false);
  assert.ok(
    Math.abs(offsetAssessment.absorbedPower.flatFractionOfBeamPower as number) > 0.5,
    `flat fraction ${offsetAssessment.absorbedPower.flatFractionOfBeamPower}`,
  );
  assert.notEqual(offsetAssessment.moments, null);
});

// ---------------------------------------------------------------------------
// S20 stage A: the aperture-coverage gate.
//
// One scene serves all of these: 240 x 200, sigma 11 x 6 at 0.6 rad, amplitude
// 100, sigma_B 0.5, one fixed noise seed. `coverageScene` masks pixels only
// inside the 6-sigma check ellipse, so a "dead fraction" below is a fraction of
// the measurement support rather than of the frame.
// ---------------------------------------------------------------------------
const COV_W = 240;
const COV_H = 200;
const COV_CX = 120.3;
const COV_CY = 99.7;
const COV_S1 = 11;
const COV_S2 = 6;
const COV_THETA = 0.6;
const COV_AMP = 100;
const COV_SIGMA_B = 0.5;
const COV_SEED = 0x5eed21;
const COV_ROI_FULL = { x0: 0, y0: 0, width: COV_W, height: COV_H };
const COV_ROI_INNER = { x0: 20, y0: 16, width: COV_W - 40, height: COV_H - 32 };

function coverageScene(kill: ((x: number, y: number) => boolean) | null): { pixels: number[]; dead: number } {
  const pixels = gaussian2dPixels(COV_W, COV_H, COV_CX, COV_CY, COV_S1, COV_S2, COV_THETA, COV_AMP, 0);
  addGaussianNoise(pixels, COV_SIGMA_B, COV_SEED);
  let dead = 0;
  if (kill !== null) {
    const cos = Math.cos(COV_THETA);
    const sin = Math.sin(COV_THETA);
    for (let y = 0; y < COV_H; y += 1) {
      for (let x = 0; x < COV_W; x += 1) {
        const dx = x - COV_CX;
        const dy = y - COV_CY;
        const u = dx * cos + dy * sin;
        const v = -dx * sin + dy * cos;
        if ((u * u) / (6 * COV_S1) ** 2 + (v * v) / (6 * COV_S2) ** 2 > 1) continue;
        if (kill(x, y)) {
          pixels[x + y * COV_W] = Number.NaN;
          dead += 1;
        }
      }
    }
  }
  return { pixels, dead };
}

function coverageAssess(pixels: number[], roi: { x0: number; y0: number; width: number; height: number }): ApertureAssessment {
  const image = { values: pixels, width: COV_W, height: COV_H };
  return assessAperture(image, roi, fitGauss2d(image, roi), COV_SIGMA_B);
}

function round4(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 1e4) / 1e4 + 0;
}

test("S20 coverage: a clean frame never enters the block, and a ROI smaller than the frame is not a coverage loss", () => {
  // I-3. The block runs only when the ROI itself carries non-finite pixels, so
  // on a clean frame every coverage field is its no-data default and the
  // release is bit-identical to a build without the block.
  const clean = coverageScene(null).pixels;
  const full = coverageAssess(clean, COV_ROI_FULL);
  assert.equal(full.suppressionReason, null);
  assert.equal(round4(full.moments?.d4SigmaMajorPx), 43.8486);
  assert.equal(round4(full.moments?.d4SigmaMinorPx), 23.8615);
  assert.equal(full.coverage.aperturePixelCount, 0);
  assert.equal(full.coverage.finitePixelCount, 0);
  assert.equal(full.coverage.finiteFraction, null);
  assert.equal(full.coverage.modelBiasMajorPercent, null);
  assert.equal(full.coverage.modelBiasMinorPercent, null);
  assert.equal(full.coverage.high, false);

  // R-13. The stage-B field NaN-masks everything outside the ROI, so a block
  // reading THAT field would see any ROI smaller than the frame as a near-total
  // coverage loss and suppress every windowed analysis. The trigger and the
  // mask read the corrected field instead, and this inner ROI proves it: still
  // released, still never entered.
  const inner = coverageAssess(clean, COV_ROI_INNER);
  assert.equal(inner.suppressionReason, null);
  assert.equal(round4(inner.moments?.d4SigmaMajorPx), 43.8466);
  assert.equal(inner.coverage.aperturePixelCount, 0);
  assert.equal(inner.coverage.finiteFraction, null);
  assert.equal(inner.coverage.high, false);
});

test("S20 coverage: a dead column suppresses the release while the consistency gate stays silent", () => {
  // A dead sensor column through the beam centre: 245 pixels, 5 percent of the
  // aperture. The model rasterized over the same gap moves 5.97 percent on the
  // major axis, which is what the release used to carry.
  const { pixels, dead } = coverageScene((x) => Math.abs(x - Math.round(COV_CX)) < 2);
  assert.equal(dead, 245);
  const assessment = coverageAssess(pixels, COV_ROI_FULL);

  assert.equal(assessment.suppressionReason, "coverage_insufficient");
  assert.equal(assessment.moments, null);
  assert.equal(assessment.coverage.aperturePixelCount, 3312);
  assert.equal(assessment.coverage.finitePixelCount, 3148);
  assert.equal(round4(assessment.coverage.finiteFraction), 0.9505);
  assert.equal(round4(assessment.coverage.modelBiasMajorPercent), 5.9666);
  assert.equal(round4(assessment.coverage.modelBiasMinorPercent), 0.7082);
  assert.equal(assessment.coverage.high, true);

  // The four earlier gates all passed - this is a fifth gate, not a re-tuned
  // fourth one. In particular the consistency gate is measured and quiet: both
  // of its apertures are cut by the same column, so their RATIO barely moves.
  assert.equal(assessment.gates.fitConverged, true);
  assert.equal(assessment.gates.amplitudePositive, true);
  assert.equal(assessment.gates.residual.high, false);
  assert.equal(assessment.gates.clipping.checkEllipseInside, true);
  assert.equal(assessment.gates.alphaConsistency.inconsistent, false);
  assert.ok(
    (assessment.gates.alphaConsistency.deltaMajorPercent as number) <
      assessment.gates.alphaConsistency.thresholdMajorPercent,
    `alpha delta ${assessment.gates.alphaConsistency.deltaMajorPercent} against ${assessment.gates.alphaConsistency.thresholdMajorPercent}`,
  );

  // The same verdict and the same numbers on a ROI smaller than the frame.
  const inner = coverageAssess(pixels, COV_ROI_INNER);
  assert.equal(inner.suppressionReason, "coverage_insufficient");
  assert.equal(inner.coverage.aperturePixelCount, 3312);
  assert.equal(inner.coverage.finitePixelCount, 3148);
  assert.equal(round4(inner.coverage.modelBiasMajorPercent), 5.9666);
});

test("S20 coverage: a scattered mask over half the aperture still releases", () => {
  // The mandatory-release family: scattered dead pixels thin the support
  // evenly, so the second moment barely moves. At 50 percent dead the
  // estimator reads -0.52 percent, against 5.97 for a 5-percent dead COLUMN -
  // which is exactly why the discriminator is the estimator and not a dead-
  // pixel fraction.
  //
  // The honest limit, measured over 1920 masked frames during calibration: an
  // iid random mask at the same density is NOT this benign. On this scene an
  // iid 50-percent mask reads -2.57 percent and is suppressed, and across that
  // campaign 93.7 percent of the rows a 2-percent ceiling flags are confirmed
  // off by more than 2 percent by their own released width. Scattered-defect
  // benignity is a property of evenly spread masks, not of randomness.
  const expected: { fraction: number; dead: number; finite: number; finiteFraction: number; bias: number; d4: number }[] = [
    { fraction: 0.1, dead: 741, finite: 2976, finiteFraction: 0.8983, bias: -0.04, d4: 43.8323 },
    { fraction: 0.3, dead: 2236, finite: 2314, finiteFraction: 0.6987, bias: -0.0735, d4: 43.8369 },
    { fraction: 0.5, dead: 3721, finite: 1648, finiteFraction: 0.4976, bias: -0.5198, d4: 43.6179 },
  ];
  for (const row of expected) {
    const { pixels, dead } = coverageScene((x, y) => ((x * 7919 + y * 104729) % 1000) / 1000 < row.fraction);
    assert.equal(dead, row.dead, `dead pixels at ${row.fraction}`);
    const assessment = coverageAssess(pixels, COV_ROI_FULL);
    assert.equal(assessment.suppressionReason, null, `released at ${row.fraction}`);
    assert.equal(round4(assessment.moments?.d4SigmaMajorPx), row.d4, `released d4 at ${row.fraction}`);
    assert.equal(assessment.coverage.finitePixelCount, row.finite, `finite aperture pixels at ${row.fraction}`);
    assert.equal(round4(assessment.coverage.finiteFraction), row.finiteFraction, `finite fraction at ${row.fraction}`);
    assert.equal(round4(assessment.coverage.modelBiasMajorPercent), row.bias, `bias at ${row.fraction}`);
    assert.equal(assessment.coverage.high, false, `coverage verdict at ${row.fraction}`);
    // The mandatory-release rows clear the finite-fraction floor by a factor
    // of at least two, so none of them sits on a suppression edge.
    assert.ok(
      (assessment.coverage.finiteFraction as number) >= 2 * COVERAGE_MIN_FINITE_FRACTION,
      `finite fraction ${assessment.coverage.finiteFraction} against floor ${COVERAGE_MIN_FINITE_FRACTION}`,
    );
  }
});

test("S20 coverage: the finite-fraction floor stops a frame resting on a sparse aperture", () => {
  // Keeping every twelfth pixel is the one pattern the bias arm cannot see: a
  // uniform decimation thins the model raster and the observed field in
  // exactly the same way, so the estimator reads -0.008 percent. The floor is
  // the second arm precisely for this: 8.2 percent of the aperture carries
  // data, and no width should be released off that.
  let index = 0;
  const { pixels } = coverageScene(() => {
    index += 1;
    return index % 12 !== 0;
  });
  const assessment = coverageAssess(pixels, COV_ROI_FULL);

  assert.equal(assessment.suppressionReason, "coverage_insufficient");
  assert.equal(assessment.moments, null);
  assert.equal(assessment.coverage.aperturePixelCount, 3322);
  assert.equal(assessment.coverage.finitePixelCount, 273);
  assert.equal(round4(assessment.coverage.finiteFraction), 0.0822);
  assert.ok(
    Math.abs(assessment.coverage.modelBiasMajorPercent as number) < 0.1,
    `the bias arm is blind here (${assessment.coverage.modelBiasMajorPercent})`,
  );
  assert.ok(
    (assessment.coverage.finiteFraction as number) < COVERAGE_MIN_FINITE_FRACTION,
    `the floor is what catches it (${assessment.coverage.finiteFraction})`,
  );
  assert.equal(assessment.coverage.high, true);
});

test("S20 coverage: a large frame with a single non-finite pixel stays inside the runtime budget", () => {
  // R-34. One NaN anywhere in the ROI is enough to enter the block, so the
  // worst case for cost is a big frame with a big aperture and a single dead
  // pixel. The block is O(aperture): it allocates and walks the aperture
  // bounding box, never the frame.
  //
  // Measured on the development machine, 1024 x 1024 with a sigma 50 x 30 beam
  // (75 377 aperture pixels): 554 ms for the clean frame, 612 ms with the one
  // NaN - a 10 percent difference. The absolute budget below is set well above
  // that so a loaded machine does not turn this into a flake; what the test
  // really guards is the RATIO, which is machine-independent.
  const width = 1024;
  const height = 1024;
  const cx = width / 2;
  const cy = height / 2;
  const params: Gauss2dFitParams = {
    amplitudeCounts: 1000,
    centerXPx: cx,
    centerYPx: cy,
    sigmaMajorPx: 50,
    sigmaMinorPx: 30,
    thetaRad: 0,
    backgroundCounts: 0,
  };
  const fit = syntheticFitResult(params);
  const roi = { x0: 0, y0: 0, width, height };
  const clean = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      clean[x + y * width] = 1000 * Math.exp(-((dx * dx) / 5000 + (dy * dy) / 1800));
    }
  }
  const dirty = Float64Array.from(clean);
  dirty[Math.round(cx) + 3 + (Math.round(cy) + 3) * width] = Number.NaN;

  // Warm-up, so the comparison is not a measurement of first-call compilation.
  assessAperture({ values: clean, width, height }, roi, fit, 1);
  assessAperture({ values: dirty, width, height }, roi, fit, 1);

  const cleanStart = process.hrtime.bigint();
  const cleanAssessment = assessAperture({ values: clean, width, height }, roi, fit, 1);
  const cleanMs = Number(process.hrtime.bigint() - cleanStart) / 1e6;

  const dirtyStart = process.hrtime.bigint();
  const dirtyAssessment = assessAperture({ values: dirty, width, height }, roi, fit, 1);
  const dirtyMs = Number(process.hrtime.bigint() - dirtyStart) / 1e6;

  assert.equal(cleanAssessment.coverage.aperturePixelCount, 0, "the clean frame never enters the block");
  assert.equal(dirtyAssessment.coverage.aperturePixelCount, 75377);
  assert.equal(dirtyAssessment.coverage.finitePixelCount, 75376);
  assert.equal(dirtyAssessment.suppressionReason, null, "one dead pixel is not a coverage failure");
  assert.ok(
    Math.abs(dirtyAssessment.coverage.modelBiasMajorPercent as number) < 0.01,
    `one dead pixel moves nothing (${dirtyAssessment.coverage.modelBiasMajorPercent})`,
  );

  assert.ok(dirtyMs < 2500, `one-NaN assessment took ${dirtyMs.toFixed(0)} ms (clean ${cleanMs.toFixed(0)} ms)`);
  assert.ok(
    dirtyMs < 2 * cleanMs + 100,
    `the coverage block must stay a fraction of the pass it rides on: ${dirtyMs.toFixed(0)} ms against ${cleanMs.toFixed(0)} ms`,
  );
});

// ---------------------------------------------------------------------------
// S20 stage B: the wing-probe reach of the absorbed-power detector.
//
// The detector drops any probe whose ellipse leaves the ROI, and it used to
// drop it silently. The two new fields say which radii actually ran, so a
// reported probeAlpha can be read as "the most informative radius" or "the
// only radius left" - a distinction worth a factor 9.7 in measured excess on
// the wing scene below (1.7296 percent at the 12 sigma probe against 0.1792
// percent at the 6 sigma one).
// ---------------------------------------------------------------------------

test("S20 stage B: absorbedPower reports which wing probes fitted inside the ROI", () => {
  const width = 512;
  const height = 512;
  const centre = 255.5;
  const values = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      values[x + y * width] =
        1000 * Math.exp(-((dx * dx) / (2 * 64) + (dy * dy) / (2 * 36))) +
        0.5 * Math.exp(-((dx * dx) / (2 * 4096) + (dy * dy) / (2 * 2304)));
    }
  }

  const centredRoi = (side: number) => {
    const x0 = Math.round(centre - side / 2);
    return { x0, y0: x0, width: side, height: side };
  };

  // All four radii fit in the full frame; the widest one sees the wing best.
  const full = centredRoi(512);
  const fullFit = fitGauss2d({ values, width, height }, full);
  assert.equal(fullFit.status, "converged");
  const fullAssessment = assessAperture({ values, width, height }, full, fullFit, 0);
  assert.deepEqual(fullAssessment.absorbedPower.availableProbeAlphas, [4, 6, 9, 12]);
  assert.equal(fullAssessment.absorbedPower.maxAvailableProbeAlpha, 12);
  assert.equal(fullAssessment.absorbedPower.probeAlpha, 12);

  // A 140 px ROI leaves only the two innermost radii, and the measured excess
  // collapses with them - the beam has not changed, the reach has.
  const tight = centredRoi(140);
  const tightFit = fitGauss2d({ values, width, height }, tight);
  assert.equal(tightFit.status, "converged");
  const tightAssessment = assessAperture({ values, width, height }, tight, tightFit, 0);
  assert.deepEqual(tightAssessment.absorbedPower.availableProbeAlphas, [4, 6]);
  assert.equal(tightAssessment.absorbedPower.maxAvailableProbeAlpha, 6);
  assert.equal(tightAssessment.absorbedPower.probeAlpha, 6);
  assert.ok(
    Math.abs(fullAssessment.absorbedPower.apertureExcessFraction as number) >
      9 * Math.abs(tightAssessment.absorbedPower.apertureExcessFraction as number),
    `full ${fullAssessment.absorbedPower.apertureExcessFraction} against tight ${tightAssessment.absorbedPower.apertureExcessFraction}`,
  );

  // Both frames release: the reach is a caveat on a released number, never a
  // gate on it.
  assert.equal(fullAssessment.suppressionReason, null);
  assert.equal(tightAssessment.suppressionReason, null);
});

test("S20 stage B: a probe list that never ran is empty, not a claim of full reach", () => {
  // No fit parameters at all: evaluateAbsorbedPower returns its no-measurement
  // form. The honest reading of "nothing was probed" is the empty list; a
  // default of [4, 6, 9, 12] would assert a reach that was never tried.
  const width = 64;
  const height = 64;
  const values = new Float64Array(width * height);
  for (let i = 0; i < values.length; i += 1) values[i] = 5;
  const roi = { x0: 0, y0: 0, width, height };
  const noFit: FitResult<Gauss2dFitParams> = {
    status: "invalid_start",
    converged: false,
    params: null,
    iterations: 0,
    costInitial: 0,
    costFinal: 0,
    residualRmsCounts: null,
    residualMaxAbsCounts: null,
    decimated: false,
    decimationFactor: 1,
    startSource: "half-area",
  };
  const assessment = assessAperture({ values, width, height }, roi, noFit, 0);
  assert.deepEqual(assessment.absorbedPower.availableProbeAlphas, []);
  assert.equal(assessment.absorbedPower.maxAvailableProbeAlpha, null);
  assert.equal(assessment.absorbedPower.probeAlpha, null);
  assert.equal(assessment.absorbedPower.high, false);
});

// ---------------------------------------------------------------------------
// S20 stage F — the peak the gate CEILINGS are referenced against.
//
// Both ceilings (the peak arm of the residual RMS bound and the multi-peak
// candidate floor) used to read the RAW maximum of the corrected ROI. They now
// read a stage-B, outlier-robust peak: the fitted background is removed, and on
// beams whose fitted minor sigma reaches MEDIAN_PEAK_MIN_SIGMA a 3x3 median
// filter removes single bright pixels first. peakCorr itself is unchanged and
// still drives peakToBackgroundNoise and the pedestal block, which is what the
// "raw peak still moves" assertions below check.
// ---------------------------------------------------------------------------

test("S20 stage F: an additive offset no longer moves either gate ceiling", () => {
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const sigmaB = 1;
  const run = (offset: number): ApertureAssessment => {
    const pixels = gaussian2dPixels(width, height, 80.5, 79.5, 8, 8, 0, 1000, offset);
    const next = makeLcg(31337);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] += sigmaB * unitGaussian(next);
    const fit = fitGauss2d({ values: pixels, width, height }, roi);
    assert.equal(fit.status, "converged");
    return assessAperture({ values: pixels, width, height }, roi, fit, sigmaB);
  };
  const flat = run(0);
  const raised = run(1000);
  // The RAW peak moved by the whole offset - peakToBackgroundNoise proves it.
  assert.ok(
    (raised.peakToBackgroundNoise as number) - (flat.peakToBackgroundNoise as number) > 900,
    `raw peak moved by ${(raised.peakToBackgroundNoise as number) - (flat.peakToBackgroundNoise as number)}`,
  );
  // The ceilings did not.
  assert.ok(
    relativeError(raised.gates.residual.maxAllowedCounts, flat.gates.residual.maxAllowedCounts) < 1e-3,
    `residual ceiling ${flat.gates.residual.maxAllowedCounts} -> ${raised.gates.residual.maxAllowedCounts}`,
  );
  assert.ok(
    relativeError(raised.gates.multiPeak.peakFloorCounts, flat.gates.multiPeak.peakFloorCounts) < 1e-3,
    `candidate floor ${flat.gates.multiPeak.peakFloorCounts} -> ${raised.gates.multiPeak.peakFloorCounts}`,
  );
});

// The five R-39 semantics pins below hold the fit FIXED (syntheticFitResult
// with the scene's true parameters) instead of running the LM. That is
// deliberate: a single pixel bright enough to make the point is also bright
// enough to capture a real LM fit, which collapses the fitted minor sigma below
// MEDIAN_PEAK_MIN_SIGMA and takes the model arm - a separate, documented limit
// (see thresholds.ts). These pins are about the MEDIAN FILTER's semantics, so
// the arm has to be the median one by construction. The end-to-end hot-pixel
// behaviour with a real fit is pinned in
// tests/repro-s20/s20-gate-interactions.test.ts, on a beam wide enough that the
// fit survives.
function wideBeamScene(width: number, height: number, sigma: number, amplitude: number): number[] {
  return gaussian2dPixels(width, height, (width - 1) / 2, (height - 1) / 2, sigma, sigma, 0, amplitude, 0);
}

function wideBeamFit(width: number, height: number, sigma: number, amplitude: number): FitResult<Gauss2dFitParams> {
  return syntheticFitResult({
    amplitudeCounts: amplitude,
    centerXPx: (width - 1) / 2,
    centerYPx: (height - 1) / 2,
    sigmaMajorPx: sigma,
    sigmaMinorPx: sigma,
    thetaRad: 0,
    backgroundCounts: 0,
  });
}

test("S20 stage F: one hot pixel no longer moves either gate ceiling", () => {
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const sigma = 6;
  const amplitude = 1000;
  const fit = wideBeamFit(width, height, sigma, amplitude);
  const run = (hot: number): ApertureAssessment => {
    const pixels = wideBeamScene(width, height, sigma, amplitude);
    if (hot > 0) pixels[20 + 20 * width] = hot;
    return assessAperture({ values: pixels, width, height }, roi, fit, 1);
  };
  const clean = run(0);
  const spiked = run(100000);
  // 100x the beam peak on ONE pixel: the raw peak follows it exactly.
  assert.ok((spiked.peakToBackgroundNoise as number) > 99000, `raw peak ${spiked.peakToBackgroundNoise}`);
  assert.ok((clean.peakToBackgroundNoise as number) < 1100, `raw peak ${clean.peakToBackgroundNoise}`);
  // The ceilings stay on the beam, bit for bit.
  assert.equal(spiked.gates.residual.maxAllowedCounts, clean.gates.residual.maxAllowedCounts);
  assert.equal(spiked.gates.multiPeak.peakFloorCounts, clean.gates.multiPeak.peakFloorCounts);
});

test("S20 stage F: a genuine 3x3 bright STRUCTURE does move the ceiling", () => {
  // The honest counterweight to the pin above: the median filter suppresses an
  // ISOLATED bright pixel, not brightness. A 3x3 block is real structure - its
  // centre window is entirely hot, so the median is the hot value and the
  // ceiling follows it. A filter that swallowed this one would be a blanket cap
  // on the ceiling, which is a different (and dishonest) instrument.
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const fit = wideBeamFit(width, height, 6, 1000);
  const pixels = wideBeamScene(width, height, 6, 1000);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) pixels[20 + dx + (20 + dy) * width] = 50000;
  }
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 1);
  assert.equal(assessment.gates.multiPeak.peakFloorCounts, 0.1 * 50000);
  assert.equal(assessment.gates.residual.maxAllowedCounts, 0.005 * 50000);
});

test("S20 stage F: the median arm reproduces the closed-form 3x3 median of a Gaussian", () => {
  // Reference implementation, not a copy of the code: for a circular Gaussian
  // of sigma s centred ON a pixel the nine window values are A, 4x A*e^(-1/2s^2)
  // and 4x A*e^(-1/s^2), so the median is exactly A*e^(-1/(2 s^2)). Noise-free
  // and background-free, so the fitted A and B are the true ones.
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const sigma = 6;
  const amplitude = 1000;
  const pixels = gaussian2dPixels(width, height, 80, 80, sigma, sigma, 0, amplitude, 0);
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 0);
  const expectedMedianPeak = amplitude * Math.exp(-1 / (2 * sigma * sigma));
  assert.ok(
    relativeError(assessment.gates.multiPeak.peakFloorCounts, 0.1 * expectedMedianPeak) < 1e-3,
    `floor ${assessment.gates.multiPeak.peakFloorCounts} vs 0.1 * ${expectedMedianPeak}`,
  );
  assert.ok(
    relativeError(assessment.gates.residual.maxAllowedCounts, 0.005 * expectedMedianPeak) < 1e-3,
    `ceiling ${assessment.gates.residual.maxAllowedCounts} vs 0.005 * ${expectedMedianPeak}`,
  );
  // And it is strictly below the raw arm, by the documented 1.38 percent.
  assert.ok(assessment.gates.multiPeak.peakFloorCounts < 0.1 * amplitude);
});

test("S20 stage F: a sub-pixel centred wide beam still releases on the median arm", () => {
  // R-39 sub-pixel pin. A sub-pixel centre roughly doubles the median filter's
  // under-read (the window is off-centre with respect to the true peak too),
  // which must stay a ceiling effect and never a verdict effect.
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 80.37, 79.62, 8, 8, 0, 1000, 0);
  const next = makeLcg(9091);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 1 * unitGaussian(next);
  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 1);
  assert.equal(assessment.suppressionReason, null);
  assert.notEqual(assessment.moments, null);
  // Median arm: the floor sits below the raw peak arm but far above half of it.
  const floor = assessment.gates.multiPeak.peakFloorCounts;
  assert.ok(floor < 0.1 * 1000, `floor ${floor}`);
  assert.ok(floor > 0.09 * 1000, `floor ${floor}`);
});

test("S20 stage F: the median window is clamped at the ROI edge and a corner spike cannot raise the ceiling", () => {
  // R-39 border pin. At a corner the window holds four cells; three of them are
  // ordinary, so the lower median is an ordinary value and the spike is gone.
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const fit = wideBeamFit(width, height, 6, 1000);
  const build = (corner: number): number[] => {
    const pixels = wideBeamScene(width, height, 6, 1000);
    if (corner > 0) pixels[0] = corner;
    return pixels;
  };
  const a = assessAperture({ values: build(0), width, height }, roi, fit, 1);
  const b = assessAperture({ values: build(50000), width, height }, roi, fit, 1);
  assert.equal(b.gates.multiPeak.peakFloorCounts, a.gates.multiPeak.peakFloorCounts);
  assert.equal(b.gates.residual.maxAllowedCounts, a.gates.residual.maxAllowedCounts);
});

test("S20 stage F: non-finite neighbours are dropped, never counted, and a walled-in spike stays out", () => {
  // R-39 NaN-neighbour policy. Two cases in one scene, both far from the beam:
  // a spike whose whole 3x3 neighbourhood is non-finite (one finite sample, the
  // window is below the minimum and contributes nothing) and a spike with only
  // two finite neighbours left (three samples: the lower median is an ordinary
  // value). Neither may reach the ceiling.
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const fit = wideBeamFit(width, height, 6, 1000);
  const build = (spike: number): number[] => {
    const pixels = wideBeamScene(width, height, 6, 1000);
    // Walled in: all eight neighbours non-finite.
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        pixels[20 + dx + (20 + dy) * width] = Number.NaN;
      }
    }
    // Six of eight neighbours non-finite: three finite samples remain, which is
    // exactly the minimum, and the lower median of three is the middle one.
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
    ] as [number, number][]) {
      pixels[70 + dx + (20 + dy) * width] = Number.NaN;
    }
    if (spike > 0) {
      pixels[20 + 20 * width] = spike;
      pixels[70 + 20 * width] = spike;
    }
    return pixels;
  };
  const a = assessAperture({ values: build(0), width, height }, roi, fit, 1);
  const b = assessAperture({ values: build(50000), width, height }, roi, fit, 1);
  assert.equal(b.gates.multiPeak.peakFloorCounts, a.gates.multiPeak.peakFloorCounts);
  assert.equal(b.gates.residual.maxAllowedCounts, a.gates.residual.maxAllowedCounts);
  // The raw peak, by contrast, went straight to the spike.
  assert.ok((b.peakToBackgroundNoise as number) > 49000, `raw peak ${b.peakToBackgroundNoise}`);
});

test("S20 stage F: a bright STRUCTURE outside the confirmed ROI cannot set a ceiling inside it", () => {
  // The 3x3 block is the case the median filter deliberately does NOT suppress
  // (see the structure pin above), so this is a clean test of the ROI clamp
  // alone: the same block is invisible purely because it sits outside the
  // analysis domain the operator confirmed.
  const width = 160;
  const height = 160;
  const roi = { x0: 32, y0: 32, width: 96, height: 96 };
  const fit = syntheticFitResult({
    amplitudeCounts: 1000,
    centerXPx: 79.5,
    centerYPx: 79.5,
    sigmaMajorPx: 6,
    sigmaMinorPx: 6,
    thetaRad: 0,
    backgroundCounts: 0,
  });
  const build = (spike: number): number[] => {
    const pixels = gaussian2dPixels(width, height, 79.5, 79.5, 6, 6, 0, 1000, 0);
    if (spike > 0) {
      for (let dy = 0; dy < 3; dy += 1) {
        for (let dx = 0; dx < 3; dx += 1) pixels[4 + dx + (4 + dy) * width] = spike;
      }
    }
    return pixels;
  };
  const a = assessAperture({ values: build(0), width, height }, roi, fit, 1);
  const b = assessAperture({ values: build(50000), width, height }, roi, fit, 1);
  assert.equal(b.gates.multiPeak.peakFloorCounts, a.gates.multiPeak.peakFloorCounts);
  assert.equal(b.gates.residual.maxAllowedCounts, a.gates.residual.maxAllowedCounts);
});

test("S20 stage F: below the minimum sigma the ceilings use the model peak, not a median", () => {
  // A narrow beam: the 3x3 median destroys the beam own peak rather than an
  // outlier (measured -39 percent at sigma 1 on a pixel centre, -64 percent on
  // a sub-pixel one), so the arm is the deterministic model peak A + B_fit,
  // which in stage-B reference is exactly A.
  const width = 128;
  const height = 128;
  const roi = { x0: 0, y0: 0, width, height };
  for (const sigma of [1, 1.5, 2]) {
    const pixels = gaussian2dPixels(width, height, 64.37, 63.62, sigma, sigma, 0, 10000, 0);
    const fit = fitGauss2d({ values: pixels, width, height }, roi);
    assert.equal(fit.status, "converged");
    const params = fit.params as Gauss2dFitParams;
    assert.ok(
      params.sigmaMinorPx < MEDIAN_PEAK_MIN_SIGMA,
      `sigma ${sigma} fits minor ${params.sigmaMinorPx}`,
    );
    const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 0);
    assert.ok(
      relativeError(assessment.gates.multiPeak.peakFloorCounts, 0.1 * params.amplitudeCounts) < 1e-9,
      `sigma ${sigma}: floor ${assessment.gates.multiPeak.peakFloorCounts} vs 0.1 * A ${params.amplitudeCounts}`,
    );
    assert.ok(
      relativeError(assessment.gates.residual.maxAllowedCounts, 0.005 * params.amplitudeCounts) < 1e-9,
      `sigma ${sigma}: ceiling ${assessment.gates.residual.maxAllowedCounts}`,
    );
  }
});

test("S20 stage F: a ROI where no window reaches the minimum sample count falls to the model peak", () => {
  // The explicit fallback, and the reason it is worth pinning: the alternative
  // - a silent revert to the raw maximum - would hand the ceiling to the
  // brightest surviving pixel, which is exactly the defect the arm exists to
  // suppress. Sparse lattice, spacing 3, everything else non-finite: every 3x3
  // window holds a single finite value, below the three-sample minimum.
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = new Array<number>(width * height).fill(Number.NaN);
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) pixels[x + y * width] = 50000;
  }
  const params: Gauss2dFitParams = {
    amplitudeCounts: 100,
    centerXPx: 48,
    centerYPx: 48,
    sigmaMajorPx: 8,
    sigmaMinorPx: 6,
    thetaRad: 0,
    backgroundCounts: 0,
  };
  const assessment = assessAperture({ values: pixels, width, height }, roi, syntheticFitResult(params), 0);
  // Model peak (100), not the raw maximum (50000).
  assert.equal(assessment.gates.multiPeak.peakFloorCounts, 10);
  assert.equal(assessment.gates.residual.maxAllowedCounts, 0.5);
});

test("S20 stage F: a spike that captures the FIT takes the model arm with it", () => {
  // The runnable witness for the limit documented at MEDIAN_PEAK_MIN_SIGMA. The
  // arm is chosen from the FITTED geometry, so a spike bright enough to capture
  // the LM collapses the fitted minor sigma below the constant - and the model
  // arm then reports the SPIKE's amplitude, because that is what the model now
  // describes. The robust median arm never runs, so the V5b protection does not
  // reach this regime at all.
  //
  // This is the case the flat-top V5b scene does NOT exhibit: there a 100 000-
  // count hot pixel leaves the fitted minor sigma at 15.208, the median arm runs
  // and the ceiling stays on the beam (pinned end to end in
  // tests/repro-s20/s20-gate-interactions.test.ts).
  const width = 64;
  const height = 64;
  const roi = { x0: 0, y0: 0, width, height };
  const sigmaB = 1;
  const run = (spike: number): { assessment: ApertureAssessment; params: Gauss2dFitParams } => {
    const pixels = gaussian2dPixels(width, height, 32, 32, 1, 1, 0, 1000, 0);
    if (spike > 0) pixels[5 + 5 * width] = spike;
    const fit = fitGauss2d({ values: pixels, width, height }, roi);
    assert.equal(fit.status, "converged");
    return {
      assessment: assessAperture({ values: pixels, width, height }, roi, fit, sigmaB),
      params: fit.params as Gauss2dFitParams,
    };
  };

  // The same beam without the spike: honest ceiling 0.005 * 1000 = 5.
  const clean = run(0);
  assert.equal(clean.params.centerXPx, 32);
  assert.equal(clean.assessment.gates.residual.maxAllowedCounts, 5);
  assert.equal(clean.assessment.suppressionReason, null);

  const captured = run(3000);
  // 1. The fit itself moved onto the defect.
  assert.equal(roundTo(captured.params.centerXPx, 3), 5);
  assert.equal(roundTo(captured.params.centerYPx, 3), 5);
  assert.ok(
    Math.abs(captured.params.amplitudeCounts - 3000) < 30,
    `the fitted amplitude tracks the spike, not the beam: ${captured.params.amplitudeCounts}`,
  );

  // 2. Which arm ran: the fitted minor sigma is far BELOW the constant, so the
  //    ceilings are the MODEL arm's - exactly 0.005 * A and 0.1 * A - and no
  //    median was ever taken.
  assert.ok(
    captured.params.sigmaMinorPx < MEDIAN_PEAK_MIN_SIGMA,
    `captured minor sigma ${captured.params.sigmaMinorPx} must be below ${MEDIAN_PEAK_MIN_SIGMA}`,
  );
  assert.equal(roundTo(captured.params.sigmaMinorPx, 4), 0.1049);
  assert.equal(
    captured.assessment.gates.residual.maxAllowedCounts,
    RESIDUAL_RMS_PEAK_FRACTION * captured.params.amplitudeCounts,
  );
  assert.equal(
    captured.assessment.gates.multiPeak.peakFloorCounts,
    MULTI_PEAK_MIN_PEAK_FRACTION * captured.params.amplitudeCounts,
  );

  // 3. Magnitude class: the ceiling is the SPIKE's, roughly three times the
  //    beam's own, on one pixel out of 4096.
  assert.equal(roundTo(captured.assessment.gates.residual.maxAllowedCounts, 4), 14.9923);
  const inflation =
    captured.assessment.gates.residual.maxAllowedCounts / clean.assessment.gates.residual.maxAllowedCounts;
  assert.ok(inflation > 2.5 && inflation < 3.5, `ceiling inflation ${inflation}`);

  // 4. What it costs: an inflated ceiling NUMBER, not a release. The residual
  //    still clears it and the frame is suppressed.
  assert.equal(roundTo(captured.assessment.gates.residual.rmsCounts, 4), 27.6549);
  assert.equal(captured.assessment.gates.residual.high, true);
  assert.equal(captured.assessment.suppressionReason, "residual_high");
  assert.equal(captured.assessment.moments, null);
});

test("S20 stage F: the null-params path keeps the raw peak formulas", () => {
  // I-8 / R-25, pinned on the reachable public surface. With no fitted model
  // there is neither a background to subtract nor a sigma to choose an arm
  // with, so the raw peak stands - deliberately, and identically to the
  // fallbackAperture path in analyze.ts. Both gates report their no-data
  // defaults here, so nothing is gated on the number.
  const width = 64;
  const height = 64;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 32, 32, 6, 6, 0, 100, 0);
  pixels[10 + 10 * width] = 8000;
  const nullFit: FitResult<Gauss2dFitParams> = {
    status: "invalid_start",
    converged: false,
    params: null,
    iterations: 0,
    costInitial: 0,
    costFinal: 0,
    residualRmsCounts: 0,
    residualMaxAbsCounts: 0,
    decimated: false,
    decimationFactor: 1,
    startSource: "half-area",
  };
  const assessment = assessAperture({ values: pixels, width, height }, roi, nullFit, 1);
  assert.equal(assessment.gates.residual.maxAllowedCounts, Math.max(2 * 1, 0.005 * 8000));
  assert.equal(assessment.gates.multiPeak.peakFloorCounts, 0.1 * 8000);
  assert.equal(assessment.gates.residual.high, false);
  assert.equal(assessment.gates.multiPeak.significantPeakCount, 0);
  assert.equal(assessment.suppressionReason, "fit_not_converged");
});
