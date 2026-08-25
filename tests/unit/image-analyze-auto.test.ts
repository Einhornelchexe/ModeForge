// S21 stage A: the two automatic analyzer inputs.
//
// The stage adds exactly two things to the engine and nothing else:
//   background: { method: "auto" }  resolves to the robust plane over four
//                                   generated corner reference boxes
//   roi: "auto"                     confirms the engine's own ROI suggestion
//
// Both are selectable BEFORE the first run, which is the point: the manual
// route to the same numbers is analyse, read the suggestion, apply it, run
// again.
//
// Every test below is an EQUALITY test against the manual chain, because the
// implementation is not a parallel code path - "auto" is resolved into an
// ordinary input at the top of analyzeImage and the manual path then runs
// verbatim. The tests exist to pin that this stays true, and to pin the one
// thing that is genuinely new: the provenance the automatic run exports.
//
// The absence-regression block at the end is the primary oracle of the stage:
// five existing input shapes, none of them using an automatic method, whose
// serialized results must be byte-identical to the digests measured on the
// pre-stage baseline.

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { analyzeImage, type ImageAnalysisInput, type ImageAnalysisResult } from "../../packages/image/src/analyze.ts";
import { autoBackgroundCornerRects, type BackgroundRect } from "../../packages/image/src/background.ts";
import {
  AUTO_BACKGROUND_CORNER_FRACTION,
  BACKGROUND_MIN_REFERENCE_SAMPLES,
} from "../../packages/image/src/thresholds.ts";

// --- deterministic fixtures -------------------------------------------------

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function gaussianStream(seed: number): () => number {
  const rand = lcg(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u1 = 0;
    while (u1 <= 0) u1 = 1 - rand();
    const u2 = rand();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

function gaussianScene(
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigma1: number,
  sigma2: number,
  thetaRad: number,
  amplitude: number,
  base: number,
): Float32Array {
  const out = new Float32Array(width * height);
  const cos = Math.cos(thetaRad);
  const sin = Math.sin(thetaRad);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      out[x + y * width] = base + amplitude * Math.exp(-((u * u) / (2 * sigma1 * sigma1) + (v * v) / (2 * sigma2 * sigma2)));
    }
  }
  return out;
}

function addNoise(pixels: Float32Array, sigmaB: number, seed: number): void {
  const next = gaussianStream(seed);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += sigmaB * next();
}

// The repository ramp frame, rebuilt in code: 600 + 8x plus a small beam,
// rounded to whole counts. Same geometry as tests/e2e/fixtures/ramp_background.tif.
const RAMP_WIDTH = 64;
const RAMP_HEIGHT = 48;
function rampScene(): number[] {
  const out: number[] = [];
  for (let y = 0; y < RAMP_HEIGHT; y += 1) {
    for (let x = 0; x < RAMP_WIDTH; x += 1) {
      const dx = (x - 31.5) / 3.5;
      const dy = (y - 23.5) / 2.5;
      out.push(Math.round(600 + 8 * x + 20000 * Math.exp(-0.5 * dx * dx - 0.5 * dy * dy)));
    }
  }
  return out;
}

// --- equality helpers -------------------------------------------------------

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

// The result with the S21 provenance removed. Everything an automatic run and
// its manual twin are supposed to share survives this; only the fields that
// exist BECAUSE the run was automatic are stripped. Comparing the stripped
// objects is therefore the strongest available statement of "same analysis",
// stronger than comparing a hand-picked list of released numbers.
function withoutAutoProvenance(result: ImageAnalysisResult): unknown {
  const copy = JSON.parse(JSON.stringify(result)) as {
    background: Record<string, unknown>;
    roi: Record<string, unknown>;
  };
  delete copy.background.requestedMethod;
  delete copy.background.resolvedMethod;
  delete copy.background.resolvedRects;
  delete copy.roi.source;
  delete copy.roi.autoFallbackReason;
  return copy;
}

function assertSameAnalysis(left: ImageAnalysisResult, right: ImageAnalysisResult, label: string): void {
  assert.equal(
    digest(withoutAutoProvenance(left)),
    digest(withoutAutoProvenance(right)),
    `${label}: the automatic run must serialize identically to the manual chain`,
  );
}

// ---------------------------------------------------------------------------
// The generated reference geometry.
// ---------------------------------------------------------------------------

test("S21: the automatic reference is the four-corner preset geometry, engine-side", () => {
  assert.equal(AUTO_BACKGROUND_CORNER_FRACTION, 0.12);
  // The 64 x 48 reference frame, pinned as literals rather than recomputed from
  // the formula: this is the geometry the shipped corner preset writes, and the
  // point of the pin is that the two cannot drift apart silently.
  assert.deepEqual(autoBackgroundCornerRects(RAMP_WIDTH, RAMP_HEIGHT), [
    { x0: 0, y0: 0, width: 8, height: 6 },
    { x0: 56, y0: 0, width: 8, height: 6 },
    { x0: 0, y0: 42, width: 8, height: 6 },
    { x0: 56, y0: 42, width: 8, height: 6 },
  ]);
  assert.deepEqual(autoBackgroundCornerRects(96, 96), [
    { x0: 0, y0: 0, width: 12, height: 12 },
    { x0: 84, y0: 0, width: 12, height: 12 },
    { x0: 0, y0: 84, width: 12, height: 12 },
    { x0: 84, y0: 84, width: 12, height: 12 },
  ]);

  // The sample budget, measured on the generator rather than described.
  const budget = (w: number, h: number): number => {
    const r = autoBackgroundCornerRects(w, h);
    return 4 * r[0].width * r[0].height;
  };
  assert.equal(budget(RAMP_WIDTH, RAMP_HEIGHT), 192);
  assert.equal(budget(13, 13), 16);
  assert.ok(budget(13, 13) >= BACKGROUND_MIN_REFERENCE_SAMPLES, "13 x 13 clears the minimum");
  assert.equal(budget(12, 12), 4);
  assert.ok(budget(12, 12) < BACKGROUND_MIN_REFERENCE_SAMPLES, "12 x 12 does not");

  // Every box stays inside the frame, including the degenerate frames where
  // the four boxes overlap or coincide. A rectangle outside the image is a
  // throw in applyBackground, so this is a real precondition, not decoration.
  for (const [w, h] of [[1, 1], [2, 5], [3, 1], [4, 4], [13, 21], [512, 512], [1024, 7]] as [number, number][]) {
    for (const rect of autoBackgroundCornerRects(w, h)) {
      assert.ok(rect.width > 0 && rect.height > 0, `${w}x${h}: positive extents`);
      assert.ok(rect.x0 >= 0 && rect.y0 >= 0, `${w}x${h}: non-negative origin`);
      assert.ok(rect.x0 + rect.width <= w && rect.y0 + rect.height <= h, `${w}x${h}: inside the frame`);
    }
  }
  assert.throws(() => autoBackgroundCornerRects(0, 8), RangeError);
  assert.throws(() => autoBackgroundCornerRects(8, 1.5), RangeError);
});

// ---------------------------------------------------------------------------
// (a) The automatic background on a clean scene.
// ---------------------------------------------------------------------------

test("S21 (a): the automatic background equals a manual run with the same corner rectangles", () => {
  const pixels = gaussianScene(96, 96, 47.5, 47.5, 7, 5, 0.4, 1000, 120);
  addNoise(pixels, 3, 424242);
  const base = { pixels, width: 96, height: 96, dtype: "float32" } as const;

  const auto = analyzeImage({ ...base, background: { method: "auto" } });
  const manual = analyzeImage({
    ...base,
    background: { method: "robust-plane", rects: autoBackgroundCornerRects(96, 96) },
  });
  assertSameAnalysis(auto, manual, "auto background");

  // The scene really did release, so this is an equality between two ANALYSES,
  // not between two identical refusals.
  assert.equal(auto.moments.suppressionReason, null);
  assert.equal(auto.background.method, "robust-plane");
  assert.ok((auto.moments.stageB?.d4SigmaMajorPx ?? 0) > 0);

  // The pieces the plan calls out one at a time, on the automatic run itself.
  assert.equal(auto.noise.sigmaCounts, manual.noise.sigmaCounts, "sigma_B identical");
  assert.equal(auto.noise.scaleSource, "mad");
  assert.ok(auto.noise.scaleCorrection > 1, "the c(n) plane deflation correction fired");
  assert.equal(auto.noise.scaleCorrection, manual.noise.scaleCorrection, "and it is the same correction");
  assert.deepEqual(
    auto.warnings.map((item) => item.code),
    manual.warnings.map((item) => item.code),
    "warning cascade identical",
  );

  // Provenance: the three additive fields, and the sigma reference identity.
  assert.equal(auto.background.requestedMethod, "auto");
  assert.equal(auto.background.resolvedMethod, "robust-plane");
  assert.deepEqual(auto.background.resolvedRects, autoBackgroundCornerRects(96, 96));
  assert.equal(manual.background.requestedMethod, "robust-plane");
  assert.equal(manual.background.resolvedMethod, undefined, "a manual run carries no auto provenance");
  assert.equal(manual.background.resolvedRects, undefined);

  // The exported rectangles ARE the sigma_B reference: measuring sigma over
  // them explicitly changes nothing, which is what "the sigma reference is
  // those same rects" means operationally.
  const explicitSigma = analyzeImage({
    ...base,
    background: { method: "auto" },
    backgroundSigmaRects: auto.background.resolvedRects,
  });
  assert.equal(digest(explicitSigma), digest(auto), "naming the resolved rects as the sigma reference is a no-op");
});

// ---------------------------------------------------------------------------
// (b) Degradation. The automatic method buys no exemption from any guard.
// ---------------------------------------------------------------------------

test("S21 (b): a frame too small for the generated reference degrades exactly like the manual path", () => {
  // Truth table, one row per failure mode of the reference:
  //
  //   frame   generated boxes        union   verdict
  //   4 x 4   four 1x1, distinct     4 px    fittable, below the minimum ->
  //                                          method "none",
  //                                          degradedReason insufficient-reference-samples,
  //                                          IMAGE_NOISE_SCALE_SUSPECT
  //   3 x 1   four 1x1, two coincide 2 px    not fittable at all -> RangeError
  //                                          inside applyBackground, contained
  //                                          as IMAGE_BACKGROUND_DEGENERATE,
  //                                          method "none"
  const tinyPixels = new Float32Array(16).fill(3);
  const tinyBase = { pixels: tinyPixels, width: 4, height: 4, dtype: "float32" } as const;
  const tinyAuto = analyzeImage({ ...tinyBase, background: { method: "auto" } });
  const tinyManual = analyzeImage({
    ...tinyBase,
    background: { method: "robust-plane", rects: autoBackgroundCornerRects(4, 4) },
  });
  assertSameAnalysis(tinyAuto, tinyManual, "minimum-sample degradation");
  assert.equal(tinyAuto.background.method, "none");
  assert.equal(tinyAuto.background.resolvedMethod, "none", "resolvedMethod reports the DEGRADED outcome");
  assert.equal(tinyAuto.background.requestedMethod, "auto");
  assert.equal(tinyAuto.background.degradedReason, "insufficient-reference-samples");
  assert.equal(tinyAuto.background.referenceSampleCount, 4);
  // The degradation notice shares the IMAGE_NOISE_SCALE_SUSPECT code, and it
  // names the MODEL rather than the sentinel: "auto" is a way of choosing a
  // model, and the actionable statement is which model the reference could not
  // support. This is also why the automatic run's warning layer is identical
  // to the manual one and the equality above can be a whole-object comparison.
  const degradeNotice = tinyAuto.warnings.find((item) => item.code === "IMAGE_NOISE_SCALE_SUSPECT");
  assert.ok(degradeNotice !== undefined, "the noise-scale notice fires on the degraded automatic run");
  assert.ok(
    degradeNotice.message.includes("the requested robust-plane correction was NOT applied"),
    "the notice names the resolved model",
  );
  assert.ok(!degradeNotice.message.includes("auto"), "and never the sentinel");

  const thinPixels = new Float32Array([5, 9, 5]);
  const thinBase = { pixels: thinPixels, width: 3, height: 1, dtype: "float32" } as const;
  const thinAuto = analyzeImage({ ...thinBase, background: { method: "auto" } });
  const thinManual = analyzeImage({
    ...thinBase,
    background: { method: "robust-plane", rects: autoBackgroundCornerRects(3, 1) },
  });
  assertSameAnalysis(thinAuto, thinManual, "degenerate-geometry degradation");
  assert.equal(thinAuto.background.method, "none");
  assert.equal(thinAuto.background.resolvedMethod, "none");
  const degenerate = thinAuto.warnings.find((item) => item.code === "IMAGE_BACKGROUND_DEGENERATE");
  assert.ok(degenerate !== undefined, "the degenerate-geometry channel fires");
  assert.ok(degenerate.message.includes("robust-plane"), "and names the resolved model");
});

// ---------------------------------------------------------------------------
// (c) The automatic ROI against the manual apply-and-re-run flow.
// ---------------------------------------------------------------------------

test("S21 (c): the automatic ROI equals apply-suggestion-then-run, two-stage sigma included", () => {
  const pixels = gaussianScene(160, 160, 79.5, 79.5, 9, 9, 0, 1000, 0);
  addNoise(pixels, 10, 12345);
  const base = { pixels, width: 160, height: 160, dtype: "float32" } as const;

  // The manual chain, exactly as the workbench performs it.
  const first = analyzeImage(base);
  const suggestion = first.roi.suggestion;
  assert.notEqual(suggestion, null, "the scene must produce a suggestion");
  if (suggestion === null) throw new Error("unreachable");
  const second = analyzeImage({ ...base, roi: suggestion.rect });

  const auto = analyzeImage({ ...base, roi: "auto" });
  assertSameAnalysis(auto, second, "auto ROI");

  assert.equal(auto.roi.source, "auto");
  assert.equal(second.roi.source, "input", "the manual twin still reports the caller's rectangle");
  assert.equal(auto.roi.autoFallbackReason, undefined, "nothing fell back");
  assert.deepEqual(auto.roi.rect, suggestion.rect, "the confirmed rectangle IS the suggestion");
  assert.equal(auto.moments.suppressionReason, null, "and the scene releases inside it");

  // The two-stage sigma made visible. The suggestion is found under the
  // full-frame sigma_B; the analysis then runs on the sigma_B of the confirmed
  // ROI's own rim. The manual flow does exactly this, which is why the numbers
  // agree - and the two stages really are different numbers here, so the
  // equality above is not vacuous.
  assert.notEqual(first.noise.sigmaCounts, second.noise.sigmaCounts, "the rim moved with the ROI");
  assert.equal(auto.noise.sigmaCounts, second.noise.sigmaCounts, "the automatic run uses the SECOND stage");

  // With a rectangle-based reference the two stages coincide, because the
  // reference does not move with the ROI. Stated as a measurement.
  const rects: BackgroundRect[] = autoBackgroundCornerRects(160, 160);
  const pinnedFirst = analyzeImage({ ...base, backgroundSigmaRects: rects });
  const pinnedAuto = analyzeImage({ ...base, backgroundSigmaRects: rects, roi: "auto" });
  assert.equal(pinnedAuto.noise.sigmaCounts, pinnedFirst.noise.sigmaCounts, "a fixed reference does not move");
});

// ---------------------------------------------------------------------------
// (d) The automatic ROI with nothing to suggest.
// ---------------------------------------------------------------------------

test("S21 (d): an automatic ROI with no reachable suggestion falls back to the full frame", () => {
  // An all-zero float32 frame: sigma_B is zero from a zero-span quantization
  // floor, the mask threshold is zero, and no pixel is strictly above it, so
  // suggestRoi returns null. This is the reachable form of "the guards fired".
  const pixels = new Float32Array(32 * 32);
  const base = { pixels, width: 32, height: 32, dtype: "float32" } as const;

  const auto = analyzeImage({ ...base, roi: "auto" });
  const plain = analyzeImage(base);
  assert.equal(plain.roi.suggestion, null, "there is genuinely nothing to suggest");
  assert.equal(plain.noise.sigmaCounts, 0);
  assert.equal(plain.noise.scaleSource, "zero");

  assert.equal(auto.roi.source, "full-frame", "the fallback keeps the existing full-frame vocabulary");
  assert.equal(auto.roi.autoFallbackReason, "no-suggestion", "and records WHY it is a full frame");
  assert.deepEqual(auto.roi.rect, { x0: 0, y0: 0, width: 32, height: 32 });
  // The run completes: it is a whole analysis, not an early exit.
  assert.ok(Array.isArray(auto.warnings));
  assert.equal(auto.stability.fullFrame, true);
  assertSameAnalysis(auto, plain, "auto ROI fallback");
});

// ---------------------------------------------------------------------------
// (e) Both automations at once.
// ---------------------------------------------------------------------------

test("S21 (e): both automations together equal the manual chain on the ramp scene", () => {
  const pixels = rampScene();
  const rects = autoBackgroundCornerRects(RAMP_WIDTH, RAMP_HEIGHT);
  const base = { pixels, width: RAMP_WIDTH, height: RAMP_HEIGHT, dtype: "float32" } as const;
  const manualBackground = { method: "robust-plane", rects } as const;

  const manualFirst = analyzeImage({ ...base, background: manualBackground });
  const suggestion = manualFirst.roi.suggestion;
  assert.notEqual(suggestion, null);
  if (suggestion === null) throw new Error("unreachable");
  const manualSecond = analyzeImage({ ...base, background: manualBackground, roi: suggestion.rect });

  const both = analyzeImage({ ...base, background: { method: "auto" }, roi: "auto" });
  assertSameAnalysis(both, manualSecond, "auto background + auto ROI");

  assert.equal(both.background.requestedMethod, "auto");
  assert.equal(both.background.resolvedMethod, "robust-plane", "the tilt is fitted, not degraded away");
  assert.deepEqual(both.background.resolvedRects, rects);
  assert.equal(both.roi.source, "auto");

  // The plane recovers the ramp exactly (600 + 8x, read as 852 at the reference
  // centroid), which is the same plane the S20 repro corpus pins for this scene.
  assert.equal(both.background.plane?.converged, true);
  assert.equal(Number((both.background.plane?.b0Counts ?? Number.NaN).toFixed(4)), 852);
  assert.equal(Number((both.background.plane?.bxCountsPerPx ?? Number.NaN).toFixed(5)), 8);
  assert.equal(Number((both.background.plane?.byCountsPerPx ?? Number.NaN).toFixed(5)), 0);

  // The gradient channel must stay SILENT. It is a rect-median instrument -
  // the single-offset model is the one a tilt invalidates - and the automatic
  // method resolves to the plane, which is the answer to a tilt rather than a
  // victim of it. A mis-firing here would mean the automatic path had picked
  // up the wrong model.
  assert.ok(
    !both.warnings.some((item) => item.code === "IMAGE_BACKGROUND_GRADIENT_IN_REFERENCE"),
    "the gradient warning does not mis-fire on the plane path",
  );
  assert.equal(both.background.referenceTrend, undefined, "the trend statistic is a rect-median instrument");

  assert.equal(both.moments.suppressionReason, null);
  assert.equal(Number((both.moments.stageB?.d4SigmaMajorPx ?? Number.NaN).toFixed(4)), 13.9848);
  assert.equal(Number((both.moments.stageB?.d4SigmaMinorPx ?? Number.NaN).toFixed(4)), 9.9863);
});

// ---------------------------------------------------------------------------
// The input contract itself.
// ---------------------------------------------------------------------------

test("S21: the automatic inputs are opt-in and validated", () => {
  const pixels = new Float32Array(16);
  const base = { pixels, width: 4, height: 4, dtype: "float32" } as const;
  assert.throws(
    () => analyzeImage({ ...base, roi: "full" as unknown as "auto" }),
    /roi must be a rectangle or the string "auto"/,
  );
  // An explicit rectangle is still validated exactly as before.
  assert.throws(() => analyzeImage({ ...base, roi: { x0: 0, y0: 0, width: 9, height: 2 } }), RangeError);
  // The default really is "neither automation".
  const plain = analyzeImage(base);
  assert.equal(plain.roi.source, "full-frame");
  assert.equal(plain.roi.autoFallbackReason, undefined);
  assert.equal(plain.background.requestedMethod, "none");
  assert.equal(plain.background.resolvedMethod, undefined);
  assert.equal(plain.background.resolvedRects, undefined);
  assert.equal("autoFallbackReason" in plain.roi, false, "the key is absent, not undefined-valued");
  assert.equal("resolvedMethod" in plain.background, false);
});

// ---------------------------------------------------------------------------
// The absence regression: the primary oracle of this stage.
// ---------------------------------------------------------------------------

test("S21: existing input shapes serialize byte-identically to the pre-stage baseline", () => {
  // Digests of JSON.stringify(analyzeImage(input)) - the full released object
  // including every warning message - measured on the commit BEFORE this stage
  // and re-measured after it. Nothing below uses an automatic input, so any
  // movement here is an unintended behaviour change, not a new feature.
  const cleanPixels = gaussianScene(96, 96, 47.5, 47.5, 7, 5, 0.4, 1000, 0);
  const noisyPixels = gaussianScene(128, 128, 63.5, 63.5, 9, 6, 0, 800, 50);
  addNoise(noisyPixels, 4, 20260824);
  const ramp = rampScene();
  const rampRects = autoBackgroundCornerRects(RAMP_WIDTH, RAMP_HEIGHT);

  const cases: { label: string; digest: string; input: ImageAnalysisInput }[] = [
    {
      label: "clean-full-frame-float32",
      digest: "d8413a43963675598208956b4edeb1c3",
      input: { pixels: cleanPixels, width: 96, height: 96, dtype: "float32" },
    },
    {
      label: "noisy-manual-offset-with-roi",
      digest: "83c022c2680d3b042906b15053acf4ae",
      input: {
        pixels: noisyPixels,
        width: 128,
        height: 128,
        dtype: "float32",
        background: { method: "manual-offset", offsetCounts: 50 },
        roi: { x0: 20, y0: 20, width: 88, height: 88 },
      },
    },
    {
      label: "ramp-rect-median-corners",
      digest: "25fabaa426d1e915b71b4a12494599c0",
      input: {
        pixels: ramp,
        width: RAMP_WIDTH,
        height: RAMP_HEIGHT,
        dtype: "float32",
        background: { method: "rect-median", rects: rampRects },
        backgroundSigmaRects: rampRects,
      },
    },
    {
      label: "ramp-robust-plane-corners",
      digest: "ee833730210c5432adf2e01b94836847",
      input: {
        pixels: ramp,
        width: RAMP_WIDTH,
        height: RAMP_HEIGHT,
        dtype: "float32",
        background: { method: "robust-plane", rects: rampRects },
      },
    },
    {
      label: "calibrated-clean-alpha",
      digest: "cf28481abeb87898e90e946f69a677fe",
      input: {
        pixels: cleanPixels,
        width: 96,
        height: 96,
        dtype: "float32",
        calibration: { pixelPitchUmX: 3.45, pixelPitchUmY: 5.2 },
        alpha: 3,
      },
    },
  ];

  for (const item of cases) {
    assert.equal(digest(analyzeImage(item.input)), item.digest, `${item.label} must be byte-identical`);
  }
});
