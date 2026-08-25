// Image analyzer tab — pure exported-function tests, no DOM.
//
// Companion to image-view-export.test.ts (same runner, same import pattern,
// same "build the input from the real analyzeImage on a tiny synthetic frame"
// constructor). That file owns buildAnalysisCsv / buildAnalysisSummaryJson;
// this one covers the remaining exported surface of
// apps/web/src/views/image.ts.
//
// Exported-surface inventory and coverage:
//   resolveTypedRoi        VF-01..VF-06
//   imageCloseupKind       VF-07..VF-08
//   umToDisplay            VF-09
//   IMAGE_PROFILE_KEYS     VF-10
//   profileLabel           VF-11
//   resolveProfileKey      VF-12
//   buildProfilePlotData   VF-13..VF-19
//   suggestionDelta        VF-20..VF-22
//   imageRoiStateKey       VF-23
//   renderImageTab         VF-24..VF-38
//   buildAnalysisCsv / buildAnalysisSummaryJson — skipped here: already
//     covered end-to-end by tests/unit/image-view-export.test.ts.
//   ImageRoiRect / TypedRoiResolution / ImageCloseupKind / ProfilePlotMarker /
//     ProfilePlotData / SuggestionDelta — type-only exports, nothing to
//     execute; they are pinned structurally by the assertions below.
//   axesCrossed / alignedPixelPair / pairSizeHtml are NOT exported (module
//     private) and this task must not add exports, so their axis-identity
//     behaviour is pinned through renderImageTab, the only exported caller
//     (VF-25 / VF-26).
//
// Deterministic: no clock, no randomness, no snapshots. Expected values are
// hand-computed with explicit tolerances.

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeImage, type ImageAnalysisResult } from "../../packages/api/src/index.ts";
import {
  buildProfilePlotData,
  buildProfileResidualPlotData,
  IMAGE_PROFILE_KEYS,
  imageCloseupKind,
  imageRoiStateKey,
  modelComparisonBlock,
  profileLabel,
  qualityBox,
  normalizeResidualValue,
  residualModeAvailability,
  residualModeScaleFactor,
  residualScaleFromGrids,
  resolvedResidualMode,
  renderImageTab,
  roiFromFitEligible,
  resolveProfileKey,
  resolveTypedRoi,
  suggestionDelta,
  superGaussInterpretation,
  umToDisplay,
} from "../../apps/web/src/views/image.ts";
import { strings } from "../../apps/web/src/i18n.ts";
import { S } from "../../apps/web/src/store.ts";
import { warningCard } from "../../apps/web/src/views/ui.ts";
import {
  applySuggestedImageRoi,
  bgRectEditorAvailable,
  completeNumber,
  normalizeImageDrawTarget,
  numericDraftValue,
  resolveIdleImagePointerAction,
  selectImagePreviewView,
  transitionImageDrawMode,
  type DarkError,
  type ImageDrawModeState,
  type ImageProfileKey,
  type ImageTabState,
} from "../../apps/web/src/state.ts";

// Exact-arithmetic comparisons; the looser bound is used wherever a trig
// value enters the expression.
const EXACT = 1e-9;
const TRIG = 1e-6;

function closeTo(actual: number, expected: number, tolerance: number, what: string): void {
  assert.ok(Number.isFinite(actual), `${what}: expected a finite number, got ${String(actual)}`);
  const scale = Math.max(1, Math.abs(expected));
  const delta = Math.abs(actual - expected) / scale;
  assert.ok(delta <= tolerance, `${what}: ${actual} vs expected ${expected} (relative delta ${delta} > ${tolerance})`);
}

// ── shared scene (mirrors image-view-export.test.ts) ───────────────────────

function analyze(pixels: number[], width: number, height: number): ImageAnalysisResult {
  let lastError: Error | null = null;
  for (const dtype of ["float32", "float64"]) {
    try {
      return analyzeImage({ pixels, width, height, dtype: dtype as never });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("analyzeImage rejected every candidate dtype");
}

function gaussianFrame(width: number, height: number, cx: number, cy: number, sigma: number): number[] {
  const values = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      values[y * width + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  return values;
}

let cachedClean: ImageAnalysisResult | null = null;
function cleanResult(): ImageAnalysisResult {
  if (cachedClean === null) cachedClean = analyze(gaussianFrame(32, 32, 16, 16, 2.5), 32, 32);
  return cachedClean;
}

type Mutable = Record<string, unknown>;

function withOverrides(base: ImageAnalysisResult, overrides: Mutable): ImageAnalysisResult {
  return { ...(base as unknown as Mutable), ...overrides } as unknown as ImageAnalysisResult;
}

// ── VF-01..VF-06 resolveTypedRoi ──────────────────────────────────────────

test("VF-01: a rectangle fully inside the frame resolves as valid and rounds to integers", () => {
  const resolved = resolveTypedRoi("10.4", "20.6", "30.2", "40.8", 100, 80);
  assert.equal(resolved.kind, "valid");
  assert.deepEqual(resolved.kind === "valid" ? resolved.rect : null, { x0: 10, y0: 21, width: 30, height: 41 });
});

test("VF-02: a rectangle exactly on the frame edge stays valid", () => {
  const full = resolveTypedRoi("0", "0", "100", "80", 100, 80);
  assert.equal(full.kind, "valid");
  assert.deepEqual(full.kind === "valid" ? full.rect : null, { x0: 0, y0: 0, width: 100, height: 80 });

  // Flush against the right/bottom edge: x0 + w === imgW and y0 + h === imgH.
  const flush = resolveTypedRoi("60", "50", "40", "30", 100, 80);
  assert.equal(flush.kind, "valid");
  assert.deepEqual(flush.kind === "valid" ? flush.rect : null, { x0: 60, y0: 50, width: 40, height: 30 });
});

test("VF-03: a partially overlapping rectangle clamps to the exact intersection", () => {
  // Frame 100x80, entry (-10, -5, 40, 30):
  //   left = max(0, -10) = 0, top = max(0, -5) = 0
  //   right = min(100, 30) = 30, bottom = min(80, 25) = 25
  //   -> intersection 30 x 25 at (0, 0)
  const topLeft = resolveTypedRoi("-10", "-5", "40", "30", 100, 80);
  assert.equal(topLeft.kind, "clamped");
  assert.deepEqual(topLeft.kind === "clamped" ? topLeft.rect : null, { x0: 0, y0: 0, width: 30, height: 25 });

  // Overhang on the far side: (90, 70, 25, 25) -> right = min(100, 115) = 100,
  // bottom = min(80, 95) = 80 -> intersection 10 x 10 at (90, 70).
  const bottomRight = resolveTypedRoi("90", "70", "25", "25", 100, 80);
  assert.equal(bottomRight.kind, "clamped");
  assert.deepEqual(bottomRight.kind === "clamped" ? bottomRight.rect : null, { x0: 90, y0: 70, width: 10, height: 10 });
});

test("VF-04: a rectangle fully outside the frame is invalid", () => {
  assert.equal(resolveTypedRoi("200", "200", "10", "10", 100, 80).kind, "invalid");
  assert.equal(resolveTypedRoi("-50", "10", "20", "20", 100, 80).kind, "invalid");
  // Touching the edge with zero overlap is still outside.
  assert.equal(resolveTypedRoi("100", "10", "20", "20", 100, 80).kind, "invalid");
});

test("VF-05: a sub-pixel overhang clamps, a sub-half-pixel intersection is invalid", () => {
  // The integer fast path runs first: round(99.4) = 99 with width 1 still fits
  // inside 100, so a rounding-sized overhang resolves as valid, not clamped.
  assert.equal(resolveTypedRoi("99.4", "10", "1", "20", 100, 80).kind, "valid");

  // Entry (99.2, 10, 2, 20): rounded it would be 99 + 2 = 101 > 100, so the
  // fast path rejects it. left = 99.2, right = min(100, 101.2) = 100 ->
  // intersection width 0.8 >= 0.5, so it clamps to a 1 px wide column.
  const clamped = resolveTypedRoi("99.2", "10", "2", "20", 100, 80);
  assert.equal(clamped.kind, "clamped");
  assert.deepEqual(clamped.kind === "clamped" ? clamped.rect : null, { x0: 99, y0: 10, width: 1, height: 20 });

  // Entry (99.6, 10, 0.8, 20): left = 99.6, right = min(100, 100.4) = 100 ->
  // intersection width 0.4 < 0.5, which is not a usable rectangle.
  assert.equal(resolveTypedRoi("99.6", "10", "0.8", "20", 100, 80).kind, "invalid");
});

test("VF-06: zero, negative, non-numeric and frameless entries report incomplete, not invalid", () => {
  // The module distinguishes a not-yet-usable entry ("incomplete") from a
  // rectangle that misses the frame ("invalid"); a zero or negative size is
  // the former, so the run button can stay blocked without an error banner.
  for (const [w, h] of [
    ["0", "10"],
    ["10", "0"],
    ["-5", "10"],
    ["10", "-5"],
    ["", "10"],
    ["abc", "10"],
  ] as const) {
    assert.equal(resolveTypedRoi("0", "0", w, h, 100, 80).kind, "incomplete", `w=${w} h=${h}`);
  }
  assert.equal(resolveTypedRoi("0", "0", "10", "10", 0, 80).kind, "incomplete");
  assert.equal(resolveTypedRoi("0", "0", "10", "10", 100, 0).kind, "incomplete");
  assert.equal(resolveTypedRoi("x", "0", "10", "10", 100, 80).kind, "incomplete");
});

// ── VF-07..VF-08 imageCloseupKind ─────────────────────────────────────────

function releasedVariant(base: ImageAnalysisResult, d4Major: number, d4Minor: number): ImageAnalysisResult {
  const moments = (base as unknown as Mutable).moments as Mutable;
  return withOverrides(base, {
    moments: {
      ...moments,
      stageB: {
        ...((moments.stageB ?? {}) as Mutable),
        valid: true,
        invalidReason: null,
        d4SigmaMajorPx: d4Major,
        d4SigmaMinorPx: d4Minor,
        centroidXPx: 150,
        centroidYPx: 150,
        thetaRad: 0,
      },
      suppressionReason: null,
    },
  });
}

test("VF-07: imageCloseupKind returns null without a result or a usable frame", () => {
  assert.equal(imageCloseupKind(300, 300, null), null);
  assert.equal(imageCloseupKind(0, 300, cleanResult()), null);
  assert.equal(imageCloseupKind(300, 0, cleanResult()), null);
  // A beam that already fills the frame gets no close-up: pad = max(96, 3*100)
  // = 300 and 300 >= 0.85 * 300 = 255.
  assert.equal(imageCloseupKind(300, 300, releasedVariant(cleanResult(), 100, 100)), null);
});

test("VF-08: imageCloseupKind separates the d4-driven window from the fixed floor", () => {
  // d4 major 40 -> pad = max(96, 120) = 120 < 255, and 3*40 = 120 >= 96, so
  // the window is driven by the released width.
  assert.equal(imageCloseupKind(300, 300, releasedVariant(cleanResult(), 40, 30)), "d4");
  // d4 major 20 -> 3*20 = 60 < 96, so the 96 px floor decides the window.
  assert.equal(imageCloseupKind(300, 300, releasedVariant(cleanResult(), 20, 15)), "fixed");
  // No released width and no fit widths, but fit parameters exist: the window
  // falls back to 0.2 * min(width, height).
  const base = cleanResult();
  const fallback = withOverrides(base, {
    moments: { ...((base as unknown as Mutable).moments as Mutable), stageB: null, suppressionReason: "fit_not_converged" },
    fits: { ...((base as unknown as Mutable).fits as Mutable), fitWidths: null },
  });
  assert.ok(fallback.fits.gauss2d.params !== null, "precondition: the clean scene produced fit parameters");
  assert.equal(imageCloseupKind(300, 300, fallback), "fallback");
});

// ── VF-09 umToDisplay ─────────────────────────────────────────────────────

test("VF-09: umToDisplay switches to mm at 1000 um and reports missing values as an em dash", () => {
  assert.equal(umToDisplay(0), "0 µm");
  assert.equal(umToDisplay(80), "80 µm");
  assert.equal(umToDisplay(999), "999 µm");
  assert.equal(umToDisplay(1000), "1 mm");
  // Three significant digits, and the shared formatter only trims a trailing
  // zero run that takes the decimal point with it: 1.5 mm prints as "1.50 mm".
  assert.equal(umToDisplay(1500), "1.50 mm");
  assert.equal(umToDisplay(-2000), "-2 mm");
  assert.equal(umToDisplay(null), "—");
  assert.equal(umToDisplay(undefined), "—");
  assert.equal(umToDisplay(Number.NaN), "—");
  assert.equal(umToDisplay(Number.POSITIVE_INFINITY), "—");
});

// ── VF-10..VF-12 profile key surface ──────────────────────────────────────

test("VF-10: IMAGE_PROFILE_KEYS lists the six released profiles in engine order", () => {
  assert.deepEqual([...IMAGE_PROFILE_KEYS], ["cutX", "cutY", "projectionX", "projectionY", "axisMajor", "axisMinor"]);
});

test("VF-11: profileLabel gives every key a distinct non-empty label in both languages", () => {
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    const labels = IMAGE_PROFILE_KEYS.map((key) => profileLabel(T, key));
    for (const label of labels) {
      assert.ok(label.length > 0, `${lang}: empty label`);
      assert.ok(!label.includes("undefined"), `${lang}: label leaked undefined`);
    }
    assert.equal(new Set(labels).size, labels.length, `${lang}: labels must be distinct`);
  }
});

test("VF-12: resolveProfileKey keeps a released key and otherwise falls back to the first released one", () => {
  assert.equal(resolveProfileKey(null, "cutX"), null);
  const base = cleanResult();
  assert.ok(base.profiles.cutX !== null, "precondition: the clean scene releases cutX");
  assert.equal(resolveProfileKey(base, "axisMajor"), "axisMajor");

  const withoutCuts = withOverrides(base, {
    profiles: { ...((base as unknown as Mutable).profiles as Mutable), cutX: null, cutY: null },
  });
  assert.equal(resolveProfileKey(withoutCuts, "cutX"), "projectionX");

  const empty = withOverrides(base, {
    profiles: { cutX: null, cutY: null, projectionX: null, projectionY: null, axisMajor: null, axisMinor: null },
  });
  assert.equal(resolveProfileKey(empty, "cutX"), null);
});

// ── VF-13..VF-19 buildProfilePlotData ─────────────────────────────────────

// Synthetic model scene. The measured samples are irrelevant for the model
// assertions, so they are zeroed; what is pinned is the curve the view
// derives from the released fit parameters.
const MODEL = {
  amplitude: 1000,
  centerXPx: 60.25,
  centerYPx: 40.5,
  sigmaMajorPx: 12,
  sigmaMinorPx: 5,
  thetaRad: Math.PI / 6, // 30 degrees
  roiWidth: 121,
  roiHeight: 81,
};

// Hand-computed projected variances at theta = 30 degrees
// (cos^2 = 3/4, sin^2 = 1/4, sigma1 = 12, sigma2 = 5):
//   Sigma_xx = 144 * 3/4 + 25 * 1/4 = 108 + 6.25   = 114.25
//   Sigma_yy = 144 * 1/4 + 25 * 3/4 =  36 + 18.75  =  54.75
const SIGMA_XX = 114.25;
const SIGMA_YY = 54.75;

function flatWidths(): Mutable {
  const measurement = { widthPx: null, leftCrossingPx: null, rightCrossingPx: null, ambiguous: false, suppressedReason: "gap" };
  return { peakValueCounts: 0, peakPositionPx: 0, fwhmData: { ...measurement }, oneOverESquaredData: { ...measurement } };
}

function projectionScene(options: {
  axis: "x" | "y";
  background: number;
  thetaRad?: number;
  contributing?: number[];
  superGauss?: { amplitude: number; w1Px: number; w2Px: number; superGaussN: number; thetaRad: number };
}): ImageAnalysisResult {
  const base = cleanResult();
  const thetaRad = options.thetaRad ?? MODEL.thetaRad;
  const length = options.axis === "x" ? MODEL.roiWidth : MODEL.roiHeight;
  const lines = options.axis === "x" ? MODEL.roiHeight : MODEL.roiWidth;
  const positionsPx = Array.from({ length }, (_, i) => i);
  const profile = {
    kind: options.axis === "x" ? "projection-x" : "projection-y",
    positionsPx,
    values: positionsPx.map(() => 0),
    contributingCounts: options.contributing ?? positionsPx.map(() => lines),
    widths: flatWidths(),
  };
  const fits = (base as unknown as Mutable).fits as Mutable;
  const gauss2d = fits.gauss2d as Mutable;
  return withOverrides(base, {
    roi: {
      ...((base as unknown as Mutable).roi as Mutable),
      rect: { x0: 0, y0: 0, width: MODEL.roiWidth, height: MODEL.roiHeight },
    },
    // stageB nulled so the profile lane falls back to the fit parameters and
    // the model geometry under test is exactly the one written below.
    moments: { ...((base as unknown as Mutable).moments as Mutable), stageB: null, suppressionReason: "fit_not_converged" },
    fits: {
      ...fits,
      gauss2d: {
        ...gauss2d,
        status: "converged",
        converged: true,
        params: {
          amplitudeCounts: MODEL.amplitude,
          backgroundCounts: options.background,
          centerXPx: MODEL.centerXPx,
          centerYPx: MODEL.centerYPx,
          sigmaMajorPx: MODEL.sigmaMajorPx,
          sigmaMinorPx: MODEL.sigmaMinorPx,
          thetaRad,
        },
      },
      superGauss2d:
        options.superGauss === undefined
          ? null
          : {
              status: "converged",
              converged: true,
              iterations: 1,
              params: {
                amplitudeCounts: options.superGauss.amplitude,
                backgroundCounts: 0,
                centerXPx: MODEL.centerXPx,
                centerYPx: MODEL.centerYPx,
                w1Px: options.superGauss.w1Px,
                w2Px: options.superGauss.w2Px,
                thetaRad: options.superGauss.thetaRad,
                superGaussN: options.superGauss.superGaussN,
              },
            },
    },
    profiles: {
      cutX: null,
      cutY: null,
      projectionX: options.axis === "x" ? profile : null,
      projectionY: options.axis === "x" ? null : profile,
      axisMajor: null,
      axisMinor: null,
    },
  });
}

test("VF-13: every released profile yields a plot payload whose series lengths match the engine samples", () => {
  const base = cleanResult();
  for (const key of IMAGE_PROFILE_KEYS) {
    const profile = base.profiles[key];
    if (profile === null) continue;
    const data = buildProfilePlotData(base, key);
    assert.ok(data !== null, `${key}: expected a payload`);
    const payload = data as NonNullable<typeof data>;
    assert.equal(payload.key, key);
    assert.equal(payload.positions.length, profile.positionsPx.length, `${key}: position count`);
    assert.equal(payload.measured.length, profile.positionsPx.length, `${key}: measured count`);
    assert.ok(payload.gauss !== null, `${key}: the converged clean scene must produce a model line`);
    assert.equal((payload.gauss as number[]).length, profile.positionsPx.length, `${key}: model count`);
    assert.equal(payload.unit, "px", `${key}: an uncalibrated scene stays in pixels`);
    assert.deepEqual(payload.measured, profile.values, `${key}: measured samples are passed through untouched`);
  }
});

test("VF-14: crossing markers are the engine crossings, unscaled on an uncalibrated scene", () => {
  const base = cleanResult();
  let checked = 0;
  for (const key of IMAGE_PROFILE_KEYS) {
    const profile = base.profiles[key];
    if (profile === null) continue;
    const data = buildProfilePlotData(base, key);
    const payload = data as NonNullable<typeof data>;
    const expected: number[] = [];
    for (const value of [
      profile.widths.fwhmData.leftCrossingPx,
      profile.widths.fwhmData.rightCrossingPx,
      profile.widths.oneOverESquaredData.leftCrossingPx,
      profile.widths.oneOverESquaredData.rightCrossingPx,
    ]) {
      if (value !== null && Number.isFinite(value)) expected.push(value);
    }
    assert.deepEqual(
      payload.markers.map((marker) => marker.position),
      expected,
      `${key}: marker positions`,
    );
    const fwhmCount = payload.markers.filter((marker) => marker.kind === "fwhm").length;
    assert.ok(fwhmCount <= 2, `${key}: at most two FWHM crossings`);
    checked += 1;
  }
  assert.ok(checked > 0, "precondition: at least one profile was released");
});

test("VF-15: the projection-x model is the analytic marginal with Sigma_xx = 114.25 at theta = 30 degrees", () => {
  const scene = projectionScene({ axis: "x", background: 0 });
  const data = buildProfilePlotData(scene, "projectionX");
  const payload = data as NonNullable<typeof data>;
  const model = payload.gauss as number[];
  assert.equal(model.length, MODEL.roiWidth);

  const peak = (MODEL.amplitude * Math.sqrt(2 * Math.PI) * MODEL.sigmaMajorPx * MODEL.sigmaMinorPx) / Math.sqrt(SIGMA_XX);
  for (const index of [0, 30, 60, 61, 90, 120]) {
    const d = index - MODEL.centerXPx;
    closeTo(model[index], peak * Math.exp(-(d * d) / (2 * SIGMA_XX)), TRIG, `projection-x sample ${index}`);
  }

  // Independent read-back of the variance from two samples of the returned
  // curve: ln(v1) - ln(v2) = (d2^2 - d1^2) / (2 * Sigma_xx).
  const i1 = 55;
  const i2 = 70;
  const d1 = i1 - MODEL.centerXPx;
  const d2 = i2 - MODEL.centerXPx;
  const recovered = (d2 * d2 - d1 * d1) / (2 * (Math.log(model[i1]) - Math.log(model[i2])));
  closeTo(recovered, SIGMA_XX, TRIG, "variance recovered from the projection-x curve");

  // Peak scaling A * sqrt(2*pi) * sigma1 * sigma2 / sqrt(Sigma_xx).
  const peakIndex = model.indexOf(Math.max(...model));
  closeTo(model[peakIndex], peak * Math.exp(-((peakIndex - MODEL.centerXPx) ** 2) / (2 * SIGMA_XX)), TRIG, "projection-x peak");
});

test("VF-16: the projection-y model uses Sigma_yy = 54.75, the perpendicular hand value", () => {
  const scene = projectionScene({ axis: "y", background: 0 });
  const data = buildProfilePlotData(scene, "projectionY");
  const payload = data as NonNullable<typeof data>;
  const model = payload.gauss as number[];
  assert.equal(model.length, MODEL.roiHeight);

  const peak = (MODEL.amplitude * Math.sqrt(2 * Math.PI) * MODEL.sigmaMajorPx * MODEL.sigmaMinorPx) / Math.sqrt(SIGMA_YY);
  for (const index of [0, 20, 40, 41, 60, 80]) {
    const d = index - MODEL.centerYPx;
    closeTo(model[index], peak * Math.exp(-(d * d) / (2 * SIGMA_YY)), TRIG, `projection-y sample ${index}`);
  }
  closeTo(variancesFromModule(MODEL.thetaRad).xx, SIGMA_XX, TRIG, "Sigma_xx read back from the module");
  closeTo(variancesFromModule(MODEL.thetaRad).yy, SIGMA_YY, TRIG, "Sigma_yy read back from the module");
});

// Reads the projected variance back out of a curve the module returned, with
// no reference to the module's own covariance code: for a background-free
// projection, ln(v1) - ln(v2) = (d2^2 - d1^2) / (2 * Sigma).
function varianceFromCurve(model: ReadonlyArray<number>, centre: number, i1: number, i2: number): number {
  const d1 = i1 - centre;
  const d2 = i2 - centre;
  assert.ok(model[i1] > 0 && model[i2] > 0, "the log-ratio read-back needs two positive samples");
  return (d2 * d2 - d1 * d1) / (2 * (Math.log(model[i1]) - Math.log(model[i2])));
}

// Both projected variances of one rotated model, each recovered from the
// module's own returned curve.
function variancesFromModule(thetaRad: number): { xx: number; yy: number } {
  const alongX = buildProfilePlotData(projectionScene({ axis: "x", background: 0, thetaRad }), "projectionX");
  const alongY = buildProfilePlotData(projectionScene({ axis: "y", background: 0, thetaRad }), "projectionY");
  const curveX = (alongX as NonNullable<typeof alongX>).gauss as number[];
  const curveY = (alongY as NonNullable<typeof alongY>).gauss as number[];
  return {
    xx: varianceFromCurve(curveX, MODEL.centerXPx, 55, 70),
    yy: varianceFromCurve(curveY, MODEL.centerYPx, 35, 50),
  };
}

test("VF-16b: the trace of the two projected variances the module produces is independent of theta", () => {
  // Sigma_xx(theta) + Sigma_yy(theta) = sigma1^2 + sigma2^2 for every theta.
  // Both terms are recovered from the module's returned curves, so a wrong
  // covariance projection inside buildProfilePlotData breaks this, while the
  // previous pure-algebra form could not have noticed.
  const trace = MODEL.sigmaMajorPx ** 2 + MODEL.sigmaMinorPx ** 2; // 144 + 25 = 169
  const thetas = [MODEL.thetaRad, (55 * Math.PI) / 180, 0];
  const traces: number[] = [];
  for (const theta of thetas) {
    const { xx, yy } = variancesFromModule(theta);
    const degrees = ((theta * 180) / Math.PI).toFixed(0);
    // Each recovered term must also be the hand value for that angle.
    const expectedXx = MODEL.sigmaMajorPx ** 2 * Math.cos(theta) ** 2 + MODEL.sigmaMinorPx ** 2 * Math.sin(theta) ** 2;
    const expectedYy = MODEL.sigmaMajorPx ** 2 * Math.sin(theta) ** 2 + MODEL.sigmaMinorPx ** 2 * Math.cos(theta) ** 2;
    closeTo(xx, expectedXx, TRIG, `Sigma_xx at ${degrees} degrees`);
    closeTo(yy, expectedYy, TRIG, `Sigma_yy at ${degrees} degrees`);
    closeTo(xx + yy, trace, TRIG, `trace at ${degrees} degrees`);
    traces.push(xx + yy);
  }
  // And the traces agree with each other, which is the theta-invariance claim.
  for (let i = 1; i < traces.length; i += 1) {
    closeTo(traces[i], traces[0], TRIG, `trace invariance between angle 0 and angle ${i}`);
  }
  // At theta = 0 the axes are unrotated, so the two terms must separate into
  // the raw sigmas rather than merely summing correctly.
  const unrotated = variancesFromModule(0);
  closeTo(unrotated.xx, MODEL.sigmaMajorPx ** 2, TRIG, "Sigma_xx at 0 degrees is sigma1^2");
  closeTo(unrotated.yy, MODEL.sigmaMinorPx ** 2, TRIG, "Sigma_yy at 0 degrees is sigma2^2");
});

test("VF-17: the summed background uses each bin's own contributing line count", () => {
  const background = 7;
  const contributing = Array.from({ length: MODEL.roiWidth }, (_, i) => (i === 0 ? 40 : MODEL.roiHeight));
  const scene = projectionScene({ axis: "x", background, contributing });
  const data = buildProfilePlotData(scene, "projectionX");
  const model = (data as NonNullable<typeof data>).gauss as number[];

  const peak = (MODEL.amplitude * Math.sqrt(2 * Math.PI) * MODEL.sigmaMajorPx * MODEL.sigmaMinorPx) / Math.sqrt(SIGMA_XX);
  const gaussAt = (index: number): number => peak * Math.exp(-((index - MODEL.centerXPx) ** 2) / (2 * SIGMA_XX));
  closeTo(model[0], gaussAt(0) + 40 * background, TRIG, "bin 0 uses its own 40 contributing lines");
  closeTo(model[10], gaussAt(10) + MODEL.roiHeight * background, TRIG, "bin 10 uses the full row count");
  // A flat background offsets the whole curve without touching its width.
  const zeroBackground = buildProfilePlotData(projectionScene({ axis: "x", background: 0 }), "projectionX");
  const flat = (zeroBackground as NonNullable<typeof zeroBackground>).gauss as number[];
  closeTo(model[10] - flat[10], MODEL.roiHeight * background, TRIG, "background offset");
});

// Independent reference for the super-Gauss projection, written out here
// rather than reused from the module: the 2D super-Gauss
//   I = A * exp(-2 * ((u/w1)^2 + (v/w2)^2)^n),
//   u =  dx*cos(th) + dy*sin(th),  v = -dx*sin(th) + dy*cos(th)
// summed over the ROI rows at their integer pixel centres.
function superGauss2dAt(
  params: { amplitude: number; w1Px: number; w2Px: number; superGaussN: number; thetaRad: number },
  x: number,
  y: number,
): number {
  const dx = x - MODEL.centerXPx;
  const dy = y - MODEL.centerYPx;
  const u = dx * Math.cos(params.thetaRad) + dy * Math.sin(params.thetaRad);
  const v = -dx * Math.sin(params.thetaRad) + dy * Math.cos(params.thetaRad);
  const e = (u / params.w1Px) ** 2 + (v / params.w2Px) ** 2;
  return params.amplitude * Math.exp(-2 * Math.pow(e, params.superGaussN));
}

function superGaussColumnSum(
  params: { amplitude: number; w1Px: number; w2Px: number; superGaussN: number; thetaRad: number },
  x: number,
): number {
  let sum = 0;
  for (let y = 0; y < MODEL.roiHeight; y += 1) sum += superGauss2dAt(params, x, y);
  return sum;
}

test("VF-18b: the super-Gauss projection matches an independent column quadrature, not a single slice", () => {
  // n = 3, distinctly anisotropic widths, rotated by 30 degrees: the model
  // varies strongly across the column, so a single-row evaluation (the exact
  // regression class the quadrature exists for) misses by a large factor.
  const params = { amplitude: 500, w1Px: 45, w2Px: 18, superGaussN: 3, thetaRad: Math.PI / 6 };
  const scene = projectionScene({ axis: "x", background: 0, superGauss: params });
  const data = buildProfilePlotData(scene, "projectionX");
  const model = (data as NonNullable<typeof data>).superGauss as number[];

  for (const x of [60, 75]) {
    const reference = superGaussColumnSum(params, x);
    assert.ok(reference > 0, `reference quadrature at x=${x} must be positive`);
    closeTo(model[x], reference, EXACT, `super-Gauss projection at x=${x} vs independent column quadrature`);

    // Discrimination guard: the two plausible single-slice regressions land
    // far outside the tolerance above, so this test really separates them.
    const centreRowTimesLines = superGauss2dAt(params, x, MODEL.centerYPx) * MODEL.roiHeight;
    const centreRowOnly = superGauss2dAt(params, x, MODEL.centerYPx);
    assert.ok(
      Math.abs(centreRowTimesLines - reference) / reference > 0.5,
      `x=${x}: centre-row x rows must differ from the quadrature by more than 50 % (got ${centreRowTimesLines} vs ${reference})`,
    );
    assert.ok(
      Math.abs(centreRowOnly - reference) / reference > 0.5,
      `x=${x}: a single centre row must differ from the quadrature by more than 50 % (got ${centreRowOnly} vs ${reference})`,
    );
  }
});

test("VF-18: the super-Gauss projection is finite with monotonically decaying wings", () => {
  const scene = projectionScene({
    axis: "x",
    background: 0,
    superGauss: { amplitude: 500, w1Px: 45, w2Px: 30, superGaussN: 2, thetaRad: 0 },
  });
  const data = buildProfilePlotData(scene, "projectionX");
  const payload = data as NonNullable<typeof data>;
  assert.ok(payload.superGauss !== null, "a converged super-Gauss fit must produce a third line");
  const model = payload.superGauss as number[];
  assert.equal(model.length, MODEL.roiWidth);
  for (let i = 0; i < model.length; i += 1) {
    assert.ok(Number.isFinite(model[i]), `super-Gauss sample ${i} must be finite`);
    assert.ok(model[i] > 0, `super-Gauss sample ${i} must stay positive for a positive amplitude`);
  }
  const centreIndex = 60;
  for (let i = centreIndex + 1; i < model.length; i += 1) {
    assert.ok(model[i] <= model[i - 1] + EXACT, `right wing must not rise at ${i}`);
  }
  for (let i = 1; i <= centreIndex; i += 1) {
    assert.ok(model[i] >= model[i - 1] - EXACT, `left wing must not fall at ${i}`);
  }
  assert.ok(model[centreIndex] > model[80], "decay must be strict beyond the flat top");
  assert.ok(model[80] > model[100], "decay must be strict on the wing");
  assert.ok(model[100] > model[120], "decay must be strict at the edge");

  // With no super-Gauss fit released the third line is simply absent.
  const withoutSuper = buildProfilePlotData(projectionScene({ axis: "x", background: 0 }), "projectionX");
  assert.equal((withoutSuper as NonNullable<typeof withoutSuper>).superGauss, null);
});

test("VF-19: buildProfilePlotData reports nothing when there is no result or no released profile", () => {
  assert.equal(buildProfilePlotData(null, "cutX"), null);
  const base = cleanResult();
  const empty = withOverrides(base, {
    profiles: { cutX: null, cutY: null, projectionX: null, projectionY: null, axisMajor: null, axisMinor: null },
  });
  assert.equal(buildProfilePlotData(empty, "cutX"), null);
  // An unreleased selection resolves to the first released profile instead.
  const onlyAxis = withOverrides(base, {
    profiles: {
      ...((base as unknown as Mutable).profiles as Mutable),
      cutX: null,
      cutY: null,
      projectionX: null,
      projectionY: null,
    },
  });
  const fallback = buildProfilePlotData(onlyAxis, "cutX");
  assert.equal((fallback as NonNullable<typeof fallback>).key, "axisMajor");
});

// ── VF-20..VF-22 suggestionDelta ──────────────────────────────────────────

function suggestionScene(
  analyzed: { x0: number; y0: number; width: number; height: number },
  suggested: { x0: number; y0: number; width: number; height: number } | null,
): ImageAnalysisResult {
  const base = cleanResult();
  return withOverrides(base, {
    roi: {
      ...((base as unknown as Mutable).roi as Mutable),
      rect: analyzed,
      suggestion: suggested === null ? null : { rect: suggested, clampedToImage: false, suspectNoiseDominated: false },
    },
  });
}

const ANALYZED = { x0: 0, y0: 0, width: 100, height: 100 };

test("VF-20: no callout data below both relative thresholds, including exactly on them", () => {
  assert.equal(suggestionDelta(null), null);
  assert.equal(suggestionDelta(suggestionScene(ANALYZED, null)), null);
  // identical rectangle
  assert.equal(suggestionDelta(suggestionScene(ANALYZED, ANALYZED)), null);
  // centre offset 5 px on a 100 px side -> 0.05, below the 0.10 threshold
  assert.equal(suggestionDelta(suggestionScene(ANALYZED, { x0: 5, y0: 0, width: 100, height: 100 })), null);
  // centre offset exactly 10 px -> 0.10, the comparison is strictly greater
  assert.equal(suggestionDelta(suggestionScene(ANALYZED, { x0: 10, y0: 0, width: 100, height: 100 })), null);
  // area exactly +10 % (110 x 100 = 11000 vs 10000) with a 5 px centre shift
  assert.equal(suggestionDelta(suggestionScene(ANALYZED, { x0: 0, y0: 0, width: 110, height: 100 })), null);
});

test("VF-21: a materially smaller or larger proposal is reported with its exact ratios", () => {
  const tighter = suggestionDelta(suggestionScene(ANALYZED, { x0: 25, y0: 25, width: 50, height: 50 }));
  assert.ok(tighter !== null);
  assert.equal(tighter.direction, "tighter");
  closeTo(tighter.areaRatio, 0.25, EXACT, "tighter area ratio"); // 2500 / 10000
  closeTo(tighter.areaRelative, 0.75, EXACT, "tighter relative area change");
  closeTo(tighter.positionRelative, 0, EXACT, "tighter centre offset"); // both centred on (50, 50)

  const wider = suggestionDelta(suggestionScene(ANALYZED, { x0: 0, y0: 0, width: 120, height: 120 }));
  assert.ok(wider !== null);
  assert.equal(wider.direction, "wider");
  closeTo(wider.areaRatio, 1.44, EXACT, "wider area ratio"); // 14400 / 10000
  closeTo(wider.areaRelative, 0.44, EXACT, "wider relative area change");
  closeTo(wider.positionRelative, 0.1, EXACT, "wider centre offset"); // (60,60) vs (50,50)
});

test("VF-22: an equal-area proposal that moved is reported as a placement change", () => {
  const shifted = suggestionDelta(suggestionScene(ANALYZED, { x0: 20, y0: 0, width: 100, height: 100 }));
  assert.ok(shifted !== null);
  assert.equal(shifted.direction, "shifted");
  closeTo(shifted.areaRelative, 0, EXACT, "shifted relative area change");
  closeTo(shifted.positionRelative, 0.2, EXACT, "shifted centre offset"); // 20 px on a 100 px side
  // A degenerate analysed rectangle carries no ratio at all.
  assert.equal(suggestionDelta(suggestionScene({ x0: 0, y0: 0, width: 0, height: 100 }, ANALYZED)), null);
});

// ── VF-23..VF-26 module-state readers ─────────────────────────────────────

// These two exports read the shared workbench store, so every test that
// touches it restores the previous slice afterwards.
function withImageState<T>(patch: Partial<ImageTabState>, body: () => T): T {
  const previous = S.img;
  S.img = { ...previous, ...patch };
  try {
    return body();
  } finally {
    S.img = previous;
  }
}

test("VF-23: imageRoiStateKey changes whenever any part of the rectangle entry changes", () => {
  const base = withImageState({ roiMode: "rect", roiX0: "1", roiY0: "2", roiW: "3", roiH: "4" }, () => imageRoiStateKey());
  const sameAgain = withImageState({ roiMode: "rect", roiX0: "1", roiY0: "2", roiW: "3", roiH: "4" }, () => imageRoiStateKey());
  assert.equal(base, sameAgain, "the key is a pure function of the entry");
  for (const patch of [
    { roiMode: "full" as const, roiX0: "1", roiY0: "2", roiW: "3", roiH: "4" },
    { roiMode: "rect" as const, roiX0: "9", roiY0: "2", roiW: "3", roiH: "4" },
    { roiMode: "rect" as const, roiX0: "1", roiY0: "9", roiW: "3", roiH: "4" },
    { roiMode: "rect" as const, roiX0: "1", roiY0: "2", roiW: "9", roiH: "4" },
    { roiMode: "rect" as const, roiX0: "1", roiY0: "2", roiW: "3", roiH: "9" },
  ]) {
    assert.notEqual(withImageState(patch, () => imageRoiStateKey()), base, JSON.stringify(patch));
  }
});

test("VF-24: renderImageTab produces markup without leaking undefined or NaN", () => {
  const T = strings("en");
  const empty = withImageState({ loaded: false, result: null, width: 0, height: 0 }, () => renderImageTab(T));
  assert.ok(empty.length > 0);
  assert.ok(!empty.includes("undefined"), "empty state must not leak undefined");
  assert.ok(!empty.includes("NaN"), "empty state must not leak NaN");

  const withResult = withImageState({ loaded: true, result: cleanResult(), width: 32, height: 32 }, () => renderImageTab(T));
  assert.ok(!withResult.includes("undefined"), "result state must not leak undefined");
  assert.ok(!withResult.includes("NaN"), "result state must not leak NaN");
  assert.ok(withResult.includes('id="img-canvas"'), "the frame canvas must be present");
  assert.ok(withResult.includes('data-act="img-run"'), "the run action must be present");
  assert.ok(withResult.includes(T.imgD4Sigma), "the released width tile label must be present");
});

// Axis-identity pairing, pinned through the only exported caller. Under an
// anisotropic pitch the physical eigen-order can be the opposite of the pixel
// eigen-order; the pixel parenthetical then has to follow the physical axis
// identity instead of its own sort order.
function crossedAxisScene(physicalThetaRad: number | null): ImageAnalysisResult {
  const base = cleanResult();
  const moments = (base as unknown as Mutable).moments as Mutable;
  return withOverrides(base, {
    moments: {
      ...moments,
      stageB: {
        ...((moments.stageB ?? {}) as Mutable),
        valid: true,
        invalidReason: null,
        d4SigmaMajorPx: 40,
        d4SigmaMinorPx: 10,
        centroidXPx: 16,
        centroidYPx: 16,
        thetaRad: 0,
      },
      suppressionReason: null,
      // A physical decomposition only exists when the run was calibrated;
      // null models the uncalibrated run.
      physical:
        physicalThetaRad === null
          ? null
          : { d4SigmaMajorUm: 400, d4SigmaMinorUm: 80, centerXUm: 160, centerYUm: 32, thetaRad: physicalThetaRad },
    },
  });
}

// Scope every axis-pairing assertion to the value cell of one key-result
// tile, so a substring can never be satisfied by markup elsewhere on the tab.
function tileValueHtml(html: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<div class="tile-label">${escapedLabel}</div><div class="tile-value"[^>]*>([\\s\\S]*?)</div>`);
  const match = pattern.exec(html);
  assert.ok(match !== null, `key-result tile "${label}" not found in the rendered markup`);
  return (match as RegExpExecArray)[1];
}

const MICROMETRE_TOKEN = /µm|&micro;|\bum\b/;

// The pixel parenthetical of a tile value. Asserted through this accessor
// instead of by whole-string equality so an additive tile decoration (the
// axis-label span, for one) cannot break an axis-pairing assertion, while a
// wrong or duplicated pixel pair still does.
function sizePxSpanContent(tileValue: string): string | null {
  const spans = [...tileValue.matchAll(/<span class="size-px">([\s\S]*?)<\/span>/g)];
  assert.ok(spans.length <= 1, `expected at most one pixel parenthetical, found ${spans.length}`);
  return spans.length === 1 ? spans[0][1] : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

test("VF-25: crossed physical and pixel axes swap the pixel parenthetical", () => {
  // Pixel major along x (theta 0), physical major along y (theta pi/2): the
  // 400 um axis is the 10 px one, so the parenthetical must read 10 x 40.
  const T = strings("en");
  const html = withImageState(
    { loaded: true, result: crossedAxisScene(Math.PI / 2), width: 32, height: 32, calX: "10", calY: "2" },
    () => renderImageTab(T),
  );
  const value = tileValueHtml(html, T.imgD4Sigma);
  assert.ok(value.startsWith("400 µm × 80 µm"), `the micrometre pair keeps the physical order: ${value}`);
  assert.equal(
    sizePxSpanContent(value),
    "(10 px × 40 px)",
    "the pixel parenthetical must follow the physical axis identity, not its own sort order",
  );
});

test("VF-26: aligned physical and pixel axes keep the pixel parenthetical in place", () => {
  const T = strings("en");
  const html = withImageState(
    { loaded: true, result: crossedAxisScene(0), width: 32, height: 32, calX: "10", calY: "2" },
    () => renderImageTab(T),
  );
  const value = tileValueHtml(html, T.imgD4Sigma);
  assert.ok(value.startsWith("400 µm × 80 µm"), `the micrometre pair is unchanged: ${value}`);
  assert.equal(sizePxSpanContent(value), "(40 px × 10 px)", "aligned axes keep the pixel pair in pixel-major order");
});

test("VF-27: an uncalibrated run shows the pixel pair alone, with no micrometre token in the tile", () => {
  const T = strings("en");
  const html = withImageState(
    { loaded: true, result: crossedAxisScene(null), width: 32, height: 32, calX: "", calY: "" },
    () => renderImageTab(T),
  );
  // Without a physical decomposition there is no axis identity to follow, so
  // the pair stays in pixel-major order and carries no parenthetical at all.
  const value = tileValueHtml(html, T.imgD4Sigma);
  assert.ok(stripTags(value).startsWith("40 px × 10 px"), `the released-width tile leads with the bare pixel pair: ${value}`);
  assert.ok(!MICROMETRE_TOKEN.test(value), `no micrometre token may appear in the tile value: ${value}`);
  assert.equal(sizePxSpanContent(value), null, "there is no pixel parenthetical when there is no micrometre primary");
  assert.ok(!html.includes("undefined"));

  // Guard the guard: with a pitch and a physical decomposition the same tile
  // DOES carry a micrometre token, so the negative assertion above is not
  // vacuously true.
  const calibrated = withImageState(
    { loaded: true, result: crossedAxisScene(Math.PI / 2), width: 32, height: 32, calX: "10", calY: "2" },
    () => renderImageTab(T),
  );
  assert.ok(MICROMETRE_TOKEN.test(tileValueHtml(calibrated, T.imgD4Sigma)), "the calibrated tile must carry a micrometre token");
});

// Dark-frame picker is only in the markup when the background method is
// dark-frame; the three typed DarkError kinds each map to one i18n string.
const DARK_ERROR_CASES: ReadonlyArray<{
  kind: DarkError["kind"];
  error: DarkError;
  message: (T: ReturnType<typeof strings>, error: DarkError) => string;
}> = [
  {
    kind: "decode",
    error: { kind: "decode", detail: ["decoder detail"] },
    message: (T) => T.imgBgDarkDecodeFailed,
  },
  {
    kind: "dimensions",
    error: { kind: "dimensions", darkWidth: 8, darkHeight: 8, imageWidth: 32, imageHeight: 32 },
    message: (T, error) =>
      error.kind === "dimensions" ? T.imgBgDarkDimMismatch(error.darkWidth, error.darkHeight, error.imageWidth, error.imageHeight) : "",
  },
  {
    kind: "dtype",
    error: { kind: "dtype", darkDtype: "uint16", imageDtype: "uint32" },
    message: (T, error) => (error.kind === "dtype" ? T.imgBgDarkDtypeMismatch(error.darkDtype, error.imageDtype) : ""),
  },
];

test("VF-28: renderImageTab shows a distinct localized dark-error text per kind in both languages", () => {
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    const messages = DARK_ERROR_CASES.map((entry) => entry.message(T, entry.error));
    for (const text of messages) {
      assert.ok(text.length > 0, `${lang}: empty dark-error text`);
    }
    assert.equal(new Set(messages).size, messages.length, `${lang}: dark-error texts must be distinct`);

    for (const current of DARK_ERROR_CASES) {
      const html = withImageState(
        { loaded: true, width: 32, height: 32, bgMethod: "dark-frame", darkError: current.error },
        () => renderImageTab(T),
      );
      const expected = current.message(T, current.error);
      assert.ok(html.includes(expected), `${lang} ${current.kind}: expected "${expected}" in the markup`);
      if (current.kind === "decode") assert.ok(html.includes("decoder detail"), `${lang}: decode detail must be rendered`);
      for (const other of DARK_ERROR_CASES) {
        if (other.kind === current.kind) continue;
        const otherText = other.message(T, other.error);
        assert.ok(
          !html.includes(otherText),
          `${lang} ${current.kind}: must not contain the ${other.kind} text "${otherText}"`,
        );
      }
    }
  }
});

test("VF-29: renderImageTab with darkError null renders none of the three kind texts", () => {
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    const html = withImageState(
      { loaded: true, width: 32, height: 32, bgMethod: "dark-frame", darkError: null },
      () => renderImageTab(T),
    );
    assert.ok(html.includes(T.imgBgPickDark), `${lang} null: the dark-frame picker must still be present`);
    for (const entry of DARK_ERROR_CASES) {
        const text = entry.message(T, entry.error);
      assert.ok(!html.includes(text), `${lang} null: must not contain the ${entry.kind} text "${text}"`);
    }
  }
});

test("VF-30: the loaded dark-frame note identifies the decoded source dtype, not the engine float32 copy", () => {
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    const darkFrame = {
      name: "dark_pedestal.tif",
      width: 64,
      height: 48,
      sourceDtype: "uint16",
      dtype: "float32",
      pixels: new Float32Array(64 * 48),
    };
    const html = withImageState(
      { loaded: true, width: 64, height: 48, bgMethod: "dark-frame", darkFrame },
      () => renderImageTab(T),
    );
    assert.ok(html.includes(T.imgBgDarkLoaded(darkFrame.name, darkFrame.width, darkFrame.height, "uint16")), `${lang}: source dtype note`);
    assert.ok(!html.includes(T.imgBgDarkLoaded(darkFrame.name, darkFrame.width, darkFrame.height, "float32")), `${lang}: engine dtype must not be shown`);
  }
});

test("VF-31: background-rectangle draw target is available only for rectangle background methods and otherwise falls back to ROI", () => {
  for (const method of ["none", "manual-offset", "dark-frame", "rect-median", "robust-plane"] as const) {
    const visible = bgRectEditorAvailable(method);
    assert.equal(visible, method === "rect-median" || method === "robust-plane", `${method}: editor visibility`);
    assert.equal(normalizeImageDrawTarget("roi", method), "roi", `${method}: ROI remains selected`);
    assert.equal(normalizeImageDrawTarget("bg-rect", method), visible ? "bg-rect" : "roi", `${method}: background target normalization`);
  }
});

test("VF-32: draw-target toggle is localized, leak-free, and rendered only with the rectangle editor", () => {
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    for (const method of ["rect-median", "robust-plane"] as const) {
      for (const drawTarget of ["roi", "bg-rect"] as const) {
        const html = withImageState(
          { loaded: true, width: 32, height: 32, bgMethod: method, drawTarget, bgRects: [{ x0: 0, y0: 0, width: 4, height: 4 }] },
          () => renderImageTab(T),
        );
        assert.ok(html.includes('data-act="img-draw-target"'), `${lang} ${method} ${drawTarget}: target control`);
        assert.ok(html.includes(T.imgDrawTargetRoi), `${lang} ${method} ${drawTarget}: ROI label`);
        assert.ok(html.includes(T.imgDrawTargetBgRect), `${lang} ${method} ${drawTarget}: background label`);
        assert.ok(!html.includes("undefined"), `${lang} ${method} ${drawTarget}: no undefined`);
        assert.ok(!html.includes("NaN"), `${lang} ${method} ${drawTarget}: no NaN`);
      }
    }
    const unavailable = withImageState(
      { loaded: true, width: 32, height: 32, bgMethod: "none", drawTarget: "bg-rect" },
      () => renderImageTab(T),
    );
    assert.ok(!unavailable.includes('data-act="img-draw-target"'), `${lang}: unavailable method hides the target control`);
    assert.ok(!unavailable.includes(T.imgDrawTargetBgRect), `${lang}: unavailable method does not leak its label`);

  }
});

test("VF-33: background draw mode restores the prior preview on every automatic exit, unless the operator chose a view", () => {
  const roiState: ImageDrawModeState = {
    bgMethod: "rect-median",
    drawTarget: "roi",
    previewView: "closeup",
    previewViewBeforeBgDraw: null,
  };
  const bgDraw = transitionImageDrawMode(roiState, "rect-median", "bg-rect");
  assert.deepEqual(bgDraw, {
    bgMethod: "rect-median",
    drawTarget: "bg-rect",
    previewView: "full",
    previewViewBeforeBgDraw: "closeup",
  }, "entering background draw mode forces full frame and remembers close-up");

  const toggleExit = transitionImageDrawMode(bgDraw, "rect-median", "roi");
  assert.deepEqual(toggleExit, { ...roiState }, "the explicit draw-target toggle restores and clears the memo");

  const methodFallback = transitionImageDrawMode(bgDraw, "none", "bg-rect");
  assert.deepEqual(
    methodFallback,
    { bgMethod: "none", drawTarget: "roi", previewView: "closeup", previewViewBeforeBgDraw: null },
    "a non-rectangle method falls back to ROI and restores the prior view",
  );

  const manualBgDraw = transitionImageDrawMode(
    { ...roiState, previewView: "full" },
    "rect-median",
    "bg-rect",
  );
  const manuallySelected = { ...manualBgDraw, ...selectImagePreviewView("closeup") };
  const manualExit = transitionImageDrawMode(manuallySelected, "rect-median", "roi");
  assert.deepEqual(
    manualExit,
    { bgMethod: "rect-median", drawTarget: "roi", previewView: "closeup", previewViewBeforeBgDraw: null },
    "a view chosen during background drawing wins when the mode exits",
  );
});

test("VF-34: both suggested-ROI actions leave background drawing and restore the saved preview", () => {
  const bgDraw: ImageDrawModeState = {
    bgMethod: "robust-plane",
    drawTarget: "bg-rect",
    previewView: "full",
    previewViewBeforeBgDraw: "closeup",
  };
  const suggestion = { x0: 12, y0: 18, width: 40, height: 30 };
  for (const action of ["apply", "apply-and-run"] as const) {
    const applied = applySuggestedImageRoi(bgDraw, suggestion);
    assert.equal(applied.drawTarget, "roi", `${action}: ROI drawing is restored`);
    assert.equal(applied.previewView, "closeup", `${action}: prior preview is restored`);
    assert.equal(applied.previewViewBeforeBgDraw, null, `${action}: preview memo is cleared`);
    assert.deepEqual(
      { roiMode: applied.roiMode, x0: applied.roiX0, y0: applied.roiY0, width: applied.roiW, height: applied.roiH },
      { roiMode: "rect", x0: "12", y0: "18", width: "40", height: "30" },
      `${action}: suggestion writes the rectangle draft`,
    );
  }
});

function convergedUnreleasableFit(base: ImageAnalysisResult): ImageAnalysisResult {
  const baseRecord = base as unknown as Mutable;
  const moments = baseRecord.moments as Mutable;
  const fits = baseRecord.fits as Mutable;
  const gauss = fits.gauss2d as Mutable;
  const params = gauss.params as Mutable;
  return withOverrides(base, {
    moments: { ...moments, stageB: null, suppressionReason: "fit_not_converged" },
    fits: {
      ...fits,
      gauss2d: {
        ...gauss,
        status: "converged",
        converged: true,
        geometryReleasable: false,
        params: { ...params, centerXPx: -1000, centerYPx: 16, sigmaMajorPx: 20, sigmaMinorPx: 5 },
      },
    },
  });
}

test("VF-35: ROI-from-fit is rendered only when the shared handler eligibility accepts the result", () => {
  const T = strings("en");
  const healthy = cleanResult();
  assert.equal(healthy.moments.stageB?.valid, true, "healthy fixture releases stage-B widths");
  assert.equal(roiFromFitEligible(healthy), true, "the handler eligibility accepts released widths");
  const healthyHtml = withImageState({ loaded: true, result: healthy, width: 32, height: 32 }, () => renderImageTab(T));
  assert.ok(healthyHtml.includes('data-act="img-roi-from-fit"'), "healthy released scene renders the ROI-from-fit button");

  // Plain result-state fixture: no analyzer run is needed for the converged
  // fit that the analyzer has already marked as geometrically unreleasable.
  const unreleasable = convergedUnreleasableFit(healthy);
  assert.equal(unreleasable.fits.gauss2d.converged, true, "fixture fit converged");
  assert.equal(unreleasable.fits.gauss2d.geometryReleasable, false, "fixture geometry is unreleasable");
  assert.equal(roiFromFitEligible(unreleasable), false, "the handler eligibility rejects the unreleasable fit");
  const unreleasableHtml = withImageState({ loaded: true, result: unreleasable, width: 32, height: 32 }, () => renderImageTab(T));
  assert.ok(!unreleasableHtml.includes('data-act="img-roi-from-fit"'), "unreleasable fit omits the button");

  const noFit = withOverrides(healthy, {
    moments: { ...((healthy as unknown as Mutable).moments as Mutable), stageB: null, suppressionReason: "fit_not_converged" },
    fits: {
      ...((healthy as unknown as Mutable).fits as Mutable),
      gauss2d: { ...(((healthy as unknown as Mutable).fits as Mutable).gauss2d as Mutable), converged: false, params: null },
    },
  });
  assert.equal(roiFromFitEligible(noFit), false, "the handler eligibility rejects a missing fit");
  const noFitHtml = withImageState({ loaded: true, result: noFit, width: 32, height: 32 }, () => renderImageTab(T));
  assert.ok(!noFitHtml.includes('data-act="img-roi-from-fit"'), "missing fit omits the button");
});

function kvValueForLabel(html: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<span class="k">${escapedLabel}</span><span class="v"[^>]*>([\\s\\S]*?)</span>`).exec(html);
  assert.ok(match !== null, `key-value row "${label}" not found in the rendered markup`);
  return stripTags((match as RegExpExecArray)[1]);
}

function autoProvenanceScene(
  resolvedMethod: "robust-plane" | "none",
  autoFallbackReason?: "no-suggestion",
): ImageAnalysisResult {
  const base = cleanResult();
  const baseRecord = base as unknown as Mutable;
  const background = baseRecord.background as Mutable;
  const roi = baseRecord.roi as Mutable;
  return withOverrides(base, {
    background: {
      ...background,
      requestedMethod: "auto",
      resolvedMethod,
      resolvedRects: [
        { x0: 0, y0: 0, width: 4, height: 4 },
        { x0: 28, y0: 0, width: 4, height: 4 },
        { x0: 0, y0: 28, width: 4, height: 4 },
        { x0: 28, y0: 28, width: 4, height: 4 },
      ],
    },
    roi: {
      ...roi,
      source: "auto",
      rect: autoFallbackReason ? { x0: 0, y0: 0, width: 32, height: 32 } : { x0: 4, y0: 5, width: 20, height: 18 },
      ...(autoFallbackReason === undefined ? {} : { autoFallbackReason }),
    },
  });
}

test("VF-36: auto entries and the derived master-toggle state render in both languages", () => {
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    const autoHtml = withImageState({ loaded: true, width: 32, height: 32, bgMethod: "auto", roiMode: "auto" }, () => renderImageTab(T));
    assert.ok(autoHtml.includes(`<option value="auto" selected>${T.imgAuto}</option>`), `${lang}: background Auto entry is selected`);
    assert.ok(
      autoHtml.includes(`data-act="img-roi-mode" data-arg="auto" class="mf-seg-btn active">${T.imgRoiAuto}</button>`),
      `${lang}: ROI Auto entry is selected`,
    );
    assert.ok(autoHtml.includes(T.imgAutoMode), `${lang}: localized master-toggle label`);
    assert.match(autoHtml, /data-act="img-auto-mode" class="mf-seg-btn active"/, `${lang}: master toggle is active only when both modes are auto`);
    assert.ok(!autoHtml.includes('data-act="img-draw-target"'), `${lang}: Auto background does not offer background-rectangle drawing`);

    for (const patch of [
      { bgMethod: "auto" as const, roiMode: "full" as const },
      { bgMethod: "none" as const, roiMode: "auto" as const },
      { bgMethod: "none" as const, roiMode: "full" as const },
    ]) {
      const html = withImageState({ loaded: true, width: 32, height: 32, ...patch }, () => renderImageTab(T));
      assert.match(html, /data-act="img-auto-mode" class="mf-seg-btn"/, `${lang} ${patch.bgMethod}/${patch.roiMode}: master toggle is inactive`);
      assert.doesNotMatch(html, /data-act="img-auto-mode" class="mf-seg-btn active"/, `${lang} ${patch.bgMethod}/${patch.roiMode}: no stale active state`);
    }
  }
});

test("VF-37: automatic provenance is localized and hidden when its current setting changed", () => {
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    const autoResult = autoProvenanceScene("robust-plane");
    const robustHtml = withImageState(
      { loaded: true, result: autoResult, width: 32, height: 32, bgMethod: "auto", roiMode: "auto" },
      () => renderImageTab(T),
    );
    assert.ok(robustHtml.includes(T.imgBgAutoRobustPlane), `${lang}: robust-plane background provenance`);
    assert.ok(robustHtml.includes(T.imgAutoRoi(4, 5, 20, 18)), `${lang}: applied automatic ROI provenance`);
    assert.ok(!robustHtml.includes(T.imgBgAutoNone), `${lang}: robust-plane run is not described as a fallback`);
    assert.ok(!robustHtml.includes(T.imgAutoRoiNoSuggestion), `${lang}: successful automatic ROI has no fallback note`);

    const fallbackHtml = withImageState(
      { loaded: true, result: autoProvenanceScene("none", "no-suggestion"), width: 32, height: 32, bgMethod: "auto", roiMode: "auto" },
      () => renderImageTab(T),
    );
    assert.ok(fallbackHtml.includes(T.imgBgAutoNone), `${lang}: degraded background provenance`);
    assert.ok(fallbackHtml.includes(T.imgAutoRoi(0, 0, 32, 32)), `${lang}: fallback still records the analyzed ROI`);
    assert.ok(fallbackHtml.includes(T.imgAutoRoiNoSuggestion), `${lang}: no-suggestion fallback provenance`);

    const changedBackgroundHtml = withImageState(
      { loaded: true, result: autoResult, width: 32, height: 32, bgMethod: "none", roiMode: "auto" },
      () => renderImageTab(T),
    );
    assert.ok(!changedBackgroundHtml.includes(T.imgBgAutoRobustPlane), `${lang}: old automatic background provenance clears after changing method`);
    assert.ok(changedBackgroundHtml.includes(T.imgAutoRoi(4, 5, 20, 18)), `${lang}: unchanged automatic ROI provenance remains`);

    const changedRoiHtml = withImageState(
      { loaded: true, result: autoResult, width: 32, height: 32, bgMethod: "auto", roiMode: "full" },
      () => renderImageTab(T),
    );
    assert.ok(changedRoiHtml.includes(T.imgBgAutoRobustPlane), `${lang}: unchanged automatic background provenance remains`);
    assert.ok(!changedRoiHtml.includes(T.imgAutoRoi(4, 5, 20, 18)), `${lang}: old automatic ROI provenance clears after changing mode`);

    const ordinaryHtml = withImageState({ loaded: true, result: cleanResult(), width: 32, height: 32 }, () => renderImageTab(T));
    assert.ok(!ordinaryHtml.includes(T.imgBgAutoRobustPlane), `${lang}: ordinary run has no automatic background provenance`);
    assert.ok(!ordinaryHtml.includes(T.imgBgAutoNone), `${lang}: ordinary run has no degraded background provenance`);
    assert.ok(!ordinaryHtml.includes(T.imgAutoRoiNoSuggestion), `${lang}: ordinary run has no automatic ROI fallback provenance`);
  }
});

test("VF-38: ROI source uses distinct input, full-frame, and automatic labels", () => {
  const base = cleanResult();
  const baseRecord = base as unknown as Mutable;
  const roi = baseRecord.roi as Mutable;
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    for (const [source, expected] of [
      ["input", T.imgRoiSourceInput],
      ["full-frame", T.imgRoiSourceFull],
      ["auto", T.imgRoiSourceAuto],
    ] as const) {
      const result = withOverrides(base, { roi: { ...roi, source } });
      const html = withImageState({ loaded: true, result, width: 32, height: 32 }, () => renderImageTab(T));
      assert.equal(kvValueForLabel(html, T.imgRoiSource), expected, `${lang} ${source}: distinct ROI source label`);
    }
  }
});

test("VF-39: shared residual scale ignores null and non-finite empty blocks", () => {
  const scale = residualScaleFromGrids([
    { values: [null, Number.NaN, Number.POSITIVE_INFINITY, -2.5, 7] },
    { values: [undefined, -9, null] },
  ]);
  assert.equal(scale, 9, "only finite numeric block means may contribute to S");
  assert.equal(residualScaleFromGrids([{ values: [null, Number.NaN] }]), 0, "no finite blocks means S is zero, not a null-derived sample");
});

test("VF-40: residual modes are pure linear relabeling with the documented guards", () => {
  const usable = { amplitudeCounts: 20, sigmaCounts: 5, scaleSource: "mad", floorApplied: false } as const;
  assert.equal(residualModeScaleFactor("counts", usable), 1);
  assert.equal(residualModeScaleFactor("percent-peak", usable), 5);
  assert.equal(residualModeScaleFactor("sigma", usable), 0.2);
  assert.equal(normalizeResidualValue(-4, residualModeScaleFactor("percent-peak", usable)), -20);
  assert.equal(normalizeResidualValue(-4, residualModeScaleFactor("sigma", usable)), -0.8);

  const noAmplitude = { ...usable, amplitudeCounts: 0 };
  assert.equal(residualModeAvailability(noAmplitude).percentPeakDisabled, true);
  assert.equal(residualModeScaleFactor("percent-peak", noAmplitude), null);
  assert.equal(resolvedResidualMode("percent-peak", noAmplitude), "counts");

  for (const input of [
    { ...usable, sigmaCounts: 0 },
    { ...usable, scaleSource: "zero" },
    { ...usable, floorApplied: true },
  ]) {
    assert.equal(residualModeAvailability(input).sigmaDisabled, true);
    assert.equal(residualModeScaleFactor("sigma", input), null);
    assert.equal(resolvedResidualMode("sigma", input), "counts");
  }
});

test("VF-41: profile residual data stays on the selected profile and subtracts each available model", () => {
  const result = cleanResult();
  const plot = buildProfilePlotData(result, "cutX");
  const residual = buildProfileResidualPlotData(result, "cutX");
  assert.ok(plot !== null, "precondition: the clean result supplies a profile plot");
  assert.ok(residual !== null, "precondition: the clean result supplies profile residuals");
  assert.equal(residual.key, plot.key);
  assert.deepEqual(residual.positions, plot.positions);
  assert.ok(plot.gauss !== null, "precondition: the clean result supplies the Gaussian curve");
  assert.ok(residual.gauss !== null, "precondition: the Gaussian residual curve is present");
  assert.equal(residual.gauss[0], plot.measured[0] - plot.gauss[0]);
  assert.ok(plot.superGauss !== null, "precondition: the clean result supplies the super-Gaussian curve");
  assert.ok(residual.superGauss !== null, "precondition: the super-Gaussian residual curve is present");
  assert.equal(residual.superGauss[0], plot.measured[0] - plot.superGauss[0]);
});

test("VF-42: model comparison and quality box expose existing values without a fit-domain fallback", () => {
  const T = strings("en");
  const result = cleanResult();
  const html = withImageState({ loaded: true, result, width: 32, height: 32 }, () => renderImageTab(T));
  assert.ok(html.includes(T.imgModelComparison), "the comparison panel is present");
  assert.ok(html.includes(T.imgSuperGaussN), "the fitted exponent is prominent");
  assert.ok(html.includes(T.imgFullResRoi), "comparison metrics name their full-resolution domain");
  assert.ok(html.includes(T.imgQualityBox), "the compact quality panel is present");
  for (const label of [
    T.imgSaturated,
    T.imgClippingSuspect,
    T.imgHotPixels,
    T.imgEdgeTouch,
    T.imgGateMultiPeak,
    T.imgUndeterminable,
    T.imgFullFrame,
    T.imgGeometryReleasable,
    T.imgMomentSuppression,
    T.imgResidualSigma,
    T.imgResidualMaxDisplayBlocks,
  ]) {
    assert.ok(html.includes(label), `quality box must retain ${label}`);
  }
  const quality = qualityBox(T, result);
  assert.ok(quality.includes(T.imgPeakToBackground), "quality box keeps the existing peak/sigma measurement");
  assert.ok(
    quality.includes(`${T.imgPass} · ${result.aperture.gates.multiPeak.significantPeakCount}`),
    "single-peak quality output keeps the gate's pass/fail polarity and peak count",
  );
  assert.equal(superGaussInterpretation(1, false), "gaussian");
  assert.equal(superGaussInterpretation(1.3, false), "no-interpretation");
  assert.equal(superGaussInterpretation(2, false), "flat-top");
  assert.equal(superGaussInterpretation(2, true), "boundary");
});

test("VF-43: a non-converged super-Gaussian fit shows only its status, never an n interpretation", () => {
  const T = strings("en");
  const result = cleanResult();
  const superFit = result.fits.superGauss2d;
  assert.ok(superFit?.params !== null && superFit?.params !== undefined, "precondition: the clean result supplies super-Gaussian parameters");
  const variant = {
    ...result,
    fits: {
      ...result.fits,
      superGauss2d: { ...superFit, status: "max_iterations", converged: false },
    },
  } as ImageAnalysisResult;
  const html = modelComparisonBlock(T, variant);
  assert.ok(html.includes("—"), "the unavailable exponent is rendered as an em dash");
  assert.ok(html.includes(T.imgStatusMaxIterations), "the fit status remains visible");
  assert.ok(!html.includes(T.imgGaussianDescription), "a provisional n never receives a Gaussian interpretation");
  assert.ok(!html.includes(T.imgFlatTopDescription), "a provisional n never receives a flat-top interpretation");
});

test("VF-44: a profile residual lane is omitted when every residual sample is non-finite", () => {
  const result = cleanResult();
  const profile = result.profiles.cutX;
  assert.ok(profile !== null, "precondition: the clean result supplies the cut-X profile");
  const variant = {
    ...result,
    profiles: {
      ...result.profiles,
      cutX: { ...profile, values: profile.values.map(() => Number.NaN) },
    },
  } as ImageAnalysisResult;
  assert.equal(buildProfileResidualPlotData(variant, "cutX"), null);
});

function suppressedResult(): ImageAnalysisResult {
  const healthy = cleanResult();
  return withOverrides(healthy, {
    moments: { ...((healthy as unknown as Mutable).moments as Mutable), stageB: null, suppressionReason: "fit_not_converged" },
  });
}

test("VF-45: ungated headline cards render the info glyph and localized long text in both languages", () => {
  const expected = {
    en: "Only D4sigma passes the release checks. The 1/e2 and FWHM values are profile-cut widths, and the fit 4-sigma value is a model width. When D4sigma is suppressed, these values rest on the unreleased fit and are shown for orientation only. The D4sigma release checks cover fit convergence, non-positive amplitude, residual ceiling, the ellipse/ROI clipping gate, alpha consistency, multi-peak, and coverage.",
    de: "Nur D4sigma durchlaeuft die Freigabepruefungen. Die 1/e2- und FWHM-Werte sind Breiten aus Profilschnitten, die Fit-4-sigma-Breite ist eine Modellbreite. Wenn D4sigma unterdrueckt ist, beruhen diese Werte auf dem nicht freigegebenen Fit und dienen nur der Orientierung. Die D4sigma-Freigabepruefungen umfassen Fit-Konvergenz, nicht-positive Amplitude, Residuenobergrenze, das Ellipse/ROI-Clipping-Gate, Alpha-Konsistenz, Mehrfach-Peak und Abdeckung.",
  } as const;
  assert.equal(strings("en").imgUngatedInfo, expected.en, "en long text is pinned in all three i18n places");
  assert.equal(strings("de").imgUngatedInfo, expected.de, "de long text is pinned in all three i18n places");

  const released = withImageState({ loaded: true, result: cleanResult(), width: 32, height: 32 }, () => renderImageTab(strings("en")));
  assert.equal((released.match(/mf-info-glyph/g) ?? []).length, 0, "released D4sigma does not show the ungated info glyph");
  assert.ok(!released.includes(expected.en), "released D4sigma does not show the ungated long text");

  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    const html = withImageState({ loaded: true, result: suppressedResult(), width: 32, height: 32 }, () => renderImageTab(T));
    assert.equal(T.imgUngatedInfo, expected[lang], `${lang}: Strings.imgUngatedInfo matches the pinned long text`);
    assert.equal((html.match(/class="mf-info-glyph"/g) ?? []).length, 3, `${lang}: one glyph on each ungated headline card`);
    assert.equal(html.split(T.imgUngatedInfo).length - 1, 3, `${lang}: long text appears once per ungated card`);
    assert.ok(html.includes(T.imgUngatedHint), `${lang}: short label stays visible`);
    assert.ok(!html.includes('tile-hint" title='), `${lang}: title-attribute tooltip is gone`);
    assert.ok(html.includes('tabindex="0"'), `${lang}: glyph is keyboard-focusable`);
    assert.equal((html.match(/class="mf-info-glyph" tabindex="0" role="button"/g) ?? []).length, 3, `${lang}: glyphs expose button semantics`);
    assert.equal((html.match(/class="mf-info-glyph" tabindex="0" role="button" aria-label="/g) ?? []).length, 3, `${lang}: glyphs have localized accessible names`);
    for (const panelId of ["img-ungated-info-1e2", "img-ungated-info-fwhm", "img-ungated-info-fit"]) {
      assert.ok(html.includes(`aria-describedby="${panelId}"`), `${lang}: glyph describes ${panelId}`);
      assert.ok(html.includes(`<span id="${panelId}" class="mf-info-panel">`), `${lang}: ${panelId} is valid span content`);
    }
  }
});

test("VF-46: localized warning cards retain the raw engine detail below the primary sentence", () => {
  const engineMessage = "Cannot propagate: aperture 0.35 mm is below the 0.50 mm minimum.";
  for (const lang of ["en", "de"] as const) {
    const T = strings(lang);
    const localized = T.warningDescription("INVALID_INPUT", engineMessage);
    const html = warningCard({ code: "INVALID_INPUT", severity: "warning", message: engineMessage }, "", undefined, localized);
    assert.ok(html.includes(localized), `${lang}: localized sentence is shown`);
    assert.ok(html.includes(engineMessage), `${lang}: engine message with its numbers is retained`);
    assert.ok(html.indexOf(localized) < html.indexOf(engineMessage), `${lang}: localized sentence remains primary`);
    assert.ok(html.includes('class="mf-warning-engine-detail"'), `${lang}: raw engine detail has its dimmed detail styling`);
  }
});

test("VF-47: numeric drafts keep S22 prefixes incomplete and preserve historical blank semantics for existing fields", () => {
  assert.equal(completeNumber(""), null, "blank is not a complete decimal");
  assert.equal(completeNumber(" "), null, "whitespace is not a complete decimal");
  assert.equal(completeNumber("1e"), null, "incomplete exponent remains a draft");
  assert.equal(completeNumber("5."), 5, "trailing-decimal input is a complete number");
  assert.equal(completeNumber("0x10"), null, "hexadecimal JavaScript syntax is rejected");
  assert.equal(numericDraftValue(""), 0, "a blank non-optional legacy field still applies zero");
  assert.equal(numericDraftValue(" "), 0, "whitespace-only non-optional legacy input still applies zero");
  assert.equal(numericDraftValue("", { optional: true }), undefined, "an optional blank clears the optional value");
  assert.equal(numericDraftValue("1e"), null, "incomplete entries do not overwrite the committed value");
});

test("VF-48: idle pointer priority prefers ROI resize, then a user background rectangle, then ROI create", () => {
  const roi = { x0: 10, y0: 10, width: 80, height: 80 };
  const userBgRects = [{ x0: 30, y0: 30, width: 20, height: 20 }];
  const base = {
    bgMethod: "rect-median" as const,
    userBgRects,
    roi,
    hitPx: 2,
    imageWidth: 160,
    imageHeight: 128,
  };

  const insideBg = resolveIdleImagePointerAction({ ...base, point: { x: 40, y: 40 } });
  assert.equal(insideBg.kind, "bg-rect", "toggle off: interior of a user bg rect is a bg-rect grab");
  if (insideBg.kind === "bg-rect") {
    assert.equal(insideBg.index, 0);
    assert.equal(insideBg.hit, "move");
  }

  const roiEdge = resolveIdleImagePointerAction({ ...base, point: { x: 10, y: 50 } });
  assert.equal(roiEdge.kind, "roi-resize", "ROI edge/handle wins over a bg rect further inside");
  if (roiEdge.kind === "roi-resize") assert.equal(roiEdge.handle, "w");

  const freeArea = resolveIdleImagePointerAction({ ...base, point: { x: 5, y: 5 } });
  assert.equal(freeArea.kind, "roi-create", "free area still creates a ROI");

  const autoMode = resolveIdleImagePointerAction({
    ...base,
    bgMethod: "auto",
    point: { x: 40, y: 40 },
  });
  assert.equal(autoMode.kind, "roi-move", "auto-mode display rects are not grabbed even if leftover user rects exist");

  const noneMethod = resolveIdleImagePointerAction({
    ...base,
    bgMethod: "none",
    point: { x: 40, y: 40 },
  });
  assert.equal(noneMethod.kind, "roi-move", "non-rectangle methods leave the ROI move path in place");
});
