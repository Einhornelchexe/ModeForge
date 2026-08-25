// S20 repro corpus — what the background stage reports as "the noise scale".
//
// Four findings, all measured against the shipped modules. Stage E closed all
// four; this file now carries BOTH the original measurement (as the reason the
// change exists) and the behaviour that replaced it, plus the pinned truth
// table, the calibration acceptance and the false-positive controls the
// revisions demand.
//
// C2  The robust plane is fitted on its own reference pixels and the scale is
//     then taken from the residuals of that same fit. Degrees of freedom are
//     consumed, so the reported sigma is deflated. Stage E multiplies it by a
//     MEASURED correction c(n) = n / (n - 2.4). See "the correction lands
//     inside 5 percent" below for the calibration and for what the old -24.5
//     percent anchor actually was.
// C3  A 1x1 reference rectangle was accepted; a single hot pixel there became
//     the whole-image offset. Stage E requires 9 finite samples, and below
//     that the METHOD degrades to none - no offset, no plane.
// C4  The noise floor collapses to exactly zero for one and two samples, and a
//     two-sample reference still reported a measured "mad" scale. The same
//     minimum-sample rule removes that: below nine samples the scale is the
//     dtype floor, which raises IMAGE_NOISE_SCALE_SUSPECT.
// C5  Choosing the wrong background method turns deterministic structure into
//     "noise": on a noise-free ramp fixture the reported sigma is 332 counts
//     and every gate relaxes by a factor of about four. The released WIDTH is
//     almost unharmed; the centroid and the exported noise figure are not.
//     Stage E adds the gradient-in-reference statistic, so the list finally
//     says the METHOD was the problem.
//
// Old -> new ledger for every number this stage moved is inline at each pin.
//
// Runtime: about 40 s.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { analyzeImage } from "../../packages/image/src/analyze.ts";
import {
  applyBackground,
  estimateBackgroundNoise,
  type BackgroundConfig,
  type BackgroundRect,
} from "../../packages/image/src/background.ts";
import {
  BACKGROUND_GRADIENT_TREND_K,
  BACKGROUND_MIN_REFERENCE_SAMPLES,
  BACKGROUND_PLANE_SCALE_EFFECTIVE_DF,
} from "../../packages/image/src/thresholds.ts";
import {
  cornerRects,
  gaussianStream,
  lcgGaussianStream,
  relativeErrorPercent,
  roundTo,
  shortWarningCodes,
} from "./lib/scenes.ts";

// ---------------------------------------------------------------------------
// C2 — the plane fit deflates its own noise estimate.
// 64x64, background plane 500 + 0.3x - 0.2y, true noise sigma 10 counts.
// ---------------------------------------------------------------------------
const PLANE_SIZE = 64;
const TRUE_SIGMA = 10;
const REALIZATIONS = 400;

function planeWithNoise(seed: number, stream: (seed: number) => () => number = lcgGaussianStream): number[] {
  const next = stream(seed);
  const pixels: number[] = [];
  for (let y = 0; y < PLANE_SIZE; y += 1) {
    for (let x = 0; x < PLANE_SIZE; x += 1) pixels.push(500 + 0.3 * x - 0.2 * y + TRUE_SIGMA * next());
  }
  return pixels;
}

const CORNER_2X2: BackgroundRect[] = [
  { x0: 0, y0: 0, width: 2, height: 2 },
  { x0: PLANE_SIZE - 2, y0: 0, width: 2, height: 2 },
  { x0: 0, y0: PLANE_SIZE - 2, width: 2, height: 2 },
  { x0: PLANE_SIZE - 2, y0: PLANE_SIZE - 2, width: 2, height: 2 },
];

test("S20 repro: the plane-fit deflation is corrected, and the smallest reference is rejected", () => {
  // Old -> new on THIS ensemble (the LCG seeds 1..400 the repro was written
  // against). Every row is the old mean times the correction c(n), except the
  // first, which is no longer a plane fit at all.
  //
  //   geometry                    n     old mean  old defl   new mean  new defl
  //   single 2x2                    4      5.889   -41.1 %      0.000   rejected
  //   single 3x3                    9      7.402   -26.0 %     10.094    +0.9 %
  //   single 4x4                   16      8.656   -13.4 %     10.183    +1.8 %
  //   2x2 in four corners          16      7.554   -24.5 %      8.887   -11.1 %
  //   8x6 corner boxes            192      9.793    -2.1 %      9.917    -0.8 %
  //   4 px edge ring              960      9.958    -0.4 %      9.983    -0.2 %
  //
  // The four-corner row is the one that does NOT land inside 5 percent, and
  // the reason is this ensemble rather than the estimator: see the calibration
  // test below, which measures the same geometry on a properly mixed ensemble
  // and lands at -0.2 percent.
  const geometries: {
    label: string;
    rects: BackgroundRect[];
    sampleCount: number;
    mean: number;
    deflationPercent: number;
    rejected?: true;
  }[] = [
    {
      label: "single 2x2, n = 4",
      rects: [{ x0: 30, y0: 30, width: 2, height: 2 }],
      sampleCount: 4,
      mean: 0,
      deflationPercent: -100,
      rejected: true,
    },
    { label: "single 3x3, n = 9", rects: [{ x0: 30, y0: 30, width: 3, height: 3 }], sampleCount: 9, mean: 10.094, deflationPercent: 0.9 },
    { label: "single 4x4, n = 16", rects: [{ x0: 30, y0: 30, width: 4, height: 4 }], sampleCount: 16, mean: 10.183, deflationPercent: 1.8 },
    { label: "2x2 in four corners, n = 16", rects: CORNER_2X2, sampleCount: 16, mean: 8.887, deflationPercent: -11.1 },
    {
      label: "8x6 corner boxes, n = 192",
      rects: [
        { x0: 0, y0: 0, width: 8, height: 6 },
        { x0: PLANE_SIZE - 8, y0: 0, width: 8, height: 6 },
        { x0: 0, y0: PLANE_SIZE - 6, width: 8, height: 6 },
        { x0: PLANE_SIZE - 8, y0: PLANE_SIZE - 6, width: 8, height: 6 },
      ],
      sampleCount: 192,
      mean: 9.917,
      deflationPercent: -0.8,
    },
    {
      label: "4 px edge ring, n = 960",
      rects: [
        { x0: 0, y0: 0, width: PLANE_SIZE, height: 4 },
        { x0: 0, y0: PLANE_SIZE - 4, width: PLANE_SIZE, height: 4 },
        { x0: 0, y0: 0, width: 4, height: PLANE_SIZE },
        { x0: PLANE_SIZE - 4, y0: 0, width: 4, height: PLANE_SIZE },
      ],
      sampleCount: 960,
      mean: 9.983,
      deflationPercent: -0.2,
    },
  ];

  for (const geometry of geometries) {
    let sum = 0;
    let method = "";
    let correction = 0;
    for (let seed = 1; seed <= REALIZATIONS; seed += 1) {
      const result = applyBackground(
        { pixels: planeWithNoise(seed), width: PLANE_SIZE, height: PLANE_SIZE, dtype: "float32" },
        { method: "robust-plane", rects: geometry.rects },
      );
      sum += result.noise?.sigmaCounts ?? Number.NaN;
      method = result.method;
      correction = result.noise?.scaleCorrection ?? Number.NaN;
      assert.equal(result.referenceSampleCount, geometry.sampleCount, `sample count for ${geometry.label}`);
    }
    const mean = sum / REALIZATIONS;
    if (geometry.rejected === true) {
      // The float32 quantization floor of four samples spanning ~20 counts is
      // 1e-12 of that span, so the mean rounds to 0 at three decimals.
      assert.equal(method, "none", `${geometry.label} must be rejected`);
      assert.equal(roundTo(mean, 3), 0, `mean reported sigma for ${geometry.label}`);
      assert.equal(correction, 1, `no correction is applied to a floor for ${geometry.label}`);
    } else {
      assert.equal(method, "robust-plane", `${geometry.label} must fit`);
      assert.equal(
        roundTo(correction, 6),
        roundTo(geometry.sampleCount / (geometry.sampleCount - BACKGROUND_PLANE_SCALE_EFFECTIVE_DF), 6),
        `correction for ${geometry.label}`,
      );
      assert.equal(roundTo(mean, 3), geometry.mean, `mean reported sigma for ${geometry.label}`);
    }
    assert.equal(
      roundTo(relativeErrorPercent(mean, TRUE_SIGMA), 1),
      geometry.deflationPercent,
      `deflation for ${geometry.label}`,
    );
  }
});

test("S20 repro: the correction lands inside 5 percent on a properly mixed ensemble", () => {
  // The step-0 calibration acceptance. The ensemble matters and this is the
  // measurement that shows why.
  //
  // The corpus generator seeds its LCG with the realization index and reads
  // the FIRST Gaussian draw straight out of that seed. For any seed band the
  // first draw is badly distributed - over seeds 1..400 it has a standard
  // deviation of 0.617 instead of 1 and a mean absolute value of 0.553 instead
  // of 0.798. A reference rectangle that contains pixel (0, 0) therefore sees
  // a systematically small first sample; a rectangle at (30, 30) reads its
  // samples from deep inside the stream and does not. That, not the layout, is
  // what made the four-corner geometry look 11 points more deflated than the
  // compact block of the same n: on the same 400 seeds the compact 4x4 sits at
  // -13.4 percent and the four corners at -24.5 percent, while on a mixed
  // ensemble both sit at -14.3 percent.
  //
  // Measured deflation of the RAW estimator (20 000 mixed realizations, before
  // the correction): -27.4 % at n=9, -14.8 % (single) / -14.3 % (four corners)
  // at n=16, -1.2 % at n=192, -0.25 % at n=960. nu_eff = (1 - d) * n is
  // 2.4 +/- 0.15 across all three reference layouts with no resolvable layout
  // term, which is what BACKGROUND_PLANE_SCALE_EFFECTIVE_DF pins.
  const REPS = 4000;
  const rows: { label: string; rects: BackgroundRect[]; residualPercent: number }[] = [
    { label: "single 3x3, n = 9", rects: [{ x0: 30, y0: 30, width: 3, height: 3 }], residualPercent: -0.74 },
    { label: "single 4x4, n = 16", rects: [{ x0: 30, y0: 30, width: 4, height: 4 }], residualPercent: 1.18 },
    { label: "2x2 in four corners, n = 16", rects: CORNER_2X2, residualPercent: -0.22 },
    {
      label: "8x6 corner boxes, n = 192",
      rects: [
        { x0: 0, y0: 0, width: 8, height: 6 },
        { x0: PLANE_SIZE - 8, y0: 0, width: 8, height: 6 },
        { x0: 0, y0: PLANE_SIZE - 6, width: 8, height: 6 },
        { x0: PLANE_SIZE - 8, y0: PLANE_SIZE - 6, width: 8, height: 6 },
      ],
      residualPercent: 0.12,
    },
  ];
  for (const row of rows) {
    let sum = 0;
    for (let seed = 1; seed <= REPS; seed += 1) {
      const result = applyBackground(
        { pixels: planeWithNoise(seed, gaussianStream), width: PLANE_SIZE, height: PLANE_SIZE, dtype: "float32" },
        { method: "robust-plane", rects: row.rects },
      );
      sum += result.noise?.sigmaCounts ?? Number.NaN;
    }
    const residual = relativeErrorPercent(sum / REPS, TRUE_SIGMA);
    assert.equal(roundTo(residual, 2), row.residualPercent, `residual for ${row.label}`);
    assert.ok(Math.abs(residual) <= 5, `${row.label} residual ${residual} exceeds the 5 percent acceptance`);
  }
});

test("S20 repro: the corrected scale is the one the analyzer consumes", () => {
  // Not a diagnostic side channel: the top-level noise block carries it, and
  // it carries the SAME correction the background block does, because those
  // reference pixels are the plane's own residuals.
  //
  // Old -> new: the reference was a single 2x2 (n = 4) reporting 10.8857 with
  // scaleSource "mad" from four samples. That geometry is now rejected, so the
  // claim moves to the smallest admissible reference, a 3x3.
  const rects: BackgroundRect[] = [{ x0: 30, y0: 30, width: 3, height: 3 }];
  const pixels = planeWithNoise(7);
  const background = applyBackground(
    { pixels, width: PLANE_SIZE, height: PLANE_SIZE, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  const result = analyzeImage({
    pixels,
    width: PLANE_SIZE,
    height: PLANE_SIZE,
    dtype: "float32",
    background: { method: "robust-plane", rects },
    backgroundSigmaRects: rects,
  });
  assert.equal(roundTo(background.noise?.sigmaCounts ?? Number.NaN, 4), 13.9202);
  assert.equal(roundTo(result.noise.sigmaCounts, 4), 13.9202);
  assert.equal(result.noise.sampleCount, 9, "nine samples carry a three-parameter plane");
  assert.equal(result.noise.scaleSource, "mad");
  assert.equal(roundTo(result.noise.scaleCorrection, 6), roundTo(9 / (9 - 2.4), 6));

  // The 2x2 reference of the original pin, now a reject case.
  const tiny: BackgroundRect[] = [{ x0: 30, y0: 30, width: 2, height: 2 }];
  const rejected = analyzeImage({
    pixels,
    width: PLANE_SIZE,
    height: PLANE_SIZE,
    dtype: "float32",
    background: { method: "robust-plane", rects: tiny },
    backgroundSigmaRects: tiny,
  });
  assert.equal(rejected.background.method, "none");
  assert.equal(rejected.background.requestedMethod, "robust-plane");
  assert.equal(rejected.background.degradedReason, "insufficient-reference-samples");
  assert.equal(rejected.background.referenceSampleCount, 4);
  assert.equal(rejected.background.plane, null);
  assert.equal(rejected.noise.scaleSource, "floor");
  assert.ok(shortWarningCodes(rejected).includes("NOISE_SCALE_SUSPECT"));
});

// ---------------------------------------------------------------------------
// R-47 — the method x sample-count truth table, as a pinned set.
// ---------------------------------------------------------------------------
test("S20 repro: the method x sample-count truth table", () => {
  const size = 32;
  const pixels = planeWithNoise(3).slice(0, size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) pixels[x + y * size] = 500 + 0.3 * x - 0.2 * y + ((x * 7 + y * 13) % 11) - 5;
  }
  const image = { pixels, width: size, height: size, dtype: "float32" as const };

  type Row = {
    method: "rect-median" | "robust-plane";
    rect: BackgroundRect;
    n: number;
    // What comes back.
    resultMethod: "none" | "rect-median" | "robust-plane";
    correctedIsRaw: boolean;
    hasOffset: boolean;
    hasPlane: boolean;
    scaleSource: "mad" | "iqr" | "floor" | "zero";
    degraded: boolean;
    throws: boolean;
  };
  const rows: Row[] = [
    // rect-median has no geometry guard, so every count below the minimum
    // degrades; nothing throws.
    { method: "rect-median", rect: { x0: 4, y0: 4, width: 1, height: 1 }, n: 1, resultMethod: "none", correctedIsRaw: true, hasOffset: false, hasPlane: false, scaleSource: "zero", degraded: true, throws: false },
    { method: "rect-median", rect: { x0: 4, y0: 4, width: 2, height: 1 }, n: 2, resultMethod: "none", correctedIsRaw: true, hasOffset: false, hasPlane: false, scaleSource: "zero", degraded: true, throws: false },
    { method: "rect-median", rect: { x0: 4, y0: 4, width: 2, height: 2 }, n: 4, resultMethod: "none", correctedIsRaw: true, hasOffset: false, hasPlane: false, scaleSource: "floor", degraded: true, throws: false },
    { method: "rect-median", rect: { x0: 4, y0: 4, width: 2, height: 4 }, n: 8, resultMethod: "none", correctedIsRaw: true, hasOffset: false, hasPlane: false, scaleSource: "floor", degraded: true, throws: false },
    { method: "rect-median", rect: { x0: 4, y0: 4, width: 3, height: 3 }, n: 9, resultMethod: "rect-median", correctedIsRaw: false, hasOffset: true, hasPlane: false, scaleSource: "mad", degraded: false, throws: false },
    { method: "rect-median", rect: { x0: 4, y0: 4, width: 4, height: 4 }, n: 16, resultMethod: "rect-median", correctedIsRaw: false, hasOffset: true, hasPlane: false, scaleSource: "mad", degraded: false, throws: false },
    // robust-plane keeps its geometry guards, and they run FIRST: a reference
    // that cannot span two distinct coordinates per axis is still a RangeError,
    // whatever its sample count. Only a fittable-but-tiny reference degrades.
    { method: "robust-plane", rect: { x0: 4, y0: 4, width: 1, height: 1 }, n: 1, resultMethod: "none", correctedIsRaw: true, hasOffset: false, hasPlane: false, scaleSource: "zero", degraded: false, throws: true },
    { method: "robust-plane", rect: { x0: 4, y0: 4, width: 2, height: 1 }, n: 2, resultMethod: "none", correctedIsRaw: true, hasOffset: false, hasPlane: false, scaleSource: "zero", degraded: false, throws: true },
    { method: "robust-plane", rect: { x0: 4, y0: 4, width: 2, height: 2 }, n: 4, resultMethod: "none", correctedIsRaw: true, hasOffset: false, hasPlane: false, scaleSource: "floor", degraded: true, throws: false },
    { method: "robust-plane", rect: { x0: 4, y0: 4, width: 2, height: 4 }, n: 8, resultMethod: "none", correctedIsRaw: true, hasOffset: false, hasPlane: false, scaleSource: "floor", degraded: true, throws: false },
    { method: "robust-plane", rect: { x0: 4, y0: 4, width: 3, height: 3 }, n: 9, resultMethod: "robust-plane", correctedIsRaw: false, hasOffset: false, hasPlane: true, scaleSource: "mad", degraded: false, throws: false },
    { method: "robust-plane", rect: { x0: 4, y0: 4, width: 4, height: 4 }, n: 16, resultMethod: "robust-plane", correctedIsRaw: false, hasOffset: false, hasPlane: true, scaleSource: "mad", degraded: false, throws: false },
  ];

  for (const row of rows) {
    const label = `${row.method} n=${row.n}`;
    const config: BackgroundConfig =
      row.method === "rect-median"
        ? { method: "rect-median", rects: [row.rect] }
        : { method: "robust-plane", rects: [row.rect] };
    if (row.throws) {
      assert.throws(() => applyBackground(image, config), /degenerate background geometry/, `${label} must throw`);
    } else {
      const result = applyBackground(image, config);
      assert.equal(result.method, row.resultMethod, `${label} method`);
      assert.equal(result.requestedMethod, row.method, `${label} requestedMethod`);
      assert.equal(result.referenceSampleCount, row.n, `${label} referenceSampleCount`);
      assert.equal(result.degradedReason, row.degraded ? "insufficient-reference-samples" : undefined, `${label} degradedReason`);
      assert.equal(result.offsetCounts !== undefined, row.hasOffset, `${label} offsetCounts`);
      assert.equal(result.plane !== undefined, row.hasPlane, `${label} plane`);
      assert.equal(result.noise?.scaleSource, row.scaleSource, `${label} scaleSource`);
      assert.equal(result.corrected[0] === pixels[0], row.correctedIsRaw, `${label} corrected field`);
    }

    // The same row through the analyzer: what the operator is told.
    const analysis = analyzeImage({ pixels, width: size, height: size, dtype: "float32", background: config });
    const codes = shortWarningCodes(analysis);
    assert.equal(analysis.background.method, row.resultMethod, `${label} analyzer method`);
    if (row.throws) {
      assert.ok(codes.includes("BACKGROUND_DEGENERATE"), `${label} must report the degenerate geometry`);
      assert.ok(!codes.includes("BACKGROUND_GRADIENT_IN_REFERENCE"), `${label} must not report a gradient`);
    } else {
      assert.ok(!codes.includes("BACKGROUND_DEGENERATE"), `${label} must not report a degenerate geometry`);
    }
    if (row.degraded) {
      assert.ok(codes.includes("NOISE_SCALE_SUSPECT"), `${label} must report the noise scale as suspect`);
      assert.equal(
        codes.filter((code) => code === "NOISE_SCALE_SUSPECT").length,
        1,
        `${label} must report it exactly once`,
      );
      assert.match(
        analysis.warnings.find((item) => item.code === "IMAGE_NOISE_SCALE_SUSPECT")?.message ?? "",
        new RegExp(`only ${row.n} finite pixel`),
      );
    }
  }

  // The rect-free methods are untouched by the rule: no reference, no count.
  for (const config of [
    { method: "none" } as const,
    { method: "manual-offset", offsetCounts: 12 } as const,
  ]) {
    const result = applyBackground(image, config);
    assert.equal(result.method, config.method);
    assert.equal(result.requestedMethod, config.method);
    assert.equal(result.degradedReason, undefined);
    assert.equal(result.referenceSampleCount, undefined);
  }
  const dark = applyBackground(image, {
    method: "dark-frame",
    darkPixels: new Array<number>(size * size).fill(1),
    darkWidth: size,
    darkHeight: size,
    darkDtype: "float32",
  });
  assert.equal(dark.method, "dark-frame");
  assert.equal(dark.degradedReason, undefined);
  assert.equal(dark.referenceSampleCount, undefined);
});

// ---------------------------------------------------------------------------
// C3 — a 1x1 reference rectangle is no longer a valid background reference.
// ---------------------------------------------------------------------------
test("S20 repro: one hot pixel used as the reference no longer offsets the whole image", () => {
  const clean: number[] = new Array<number>(PLANE_SIZE * PLANE_SIZE).fill(100);
  const withDefect = clean.slice();
  withDefect[30 + 30 * PLANE_SIZE] = 1000;
  const rects: BackgroundRect[] = [{ x0: 30, y0: 30, width: 1, height: 1 }];

  // Old -> new: offsetCounts was 100 on the clean field and 1000 on the hot
  // one; corrected[0] was -900 and negativeFractionAfter 0.9998. There is now
  // no offset at all on either.
  const good = applyBackground(
    { pixels: clean, width: PLANE_SIZE, height: PLANE_SIZE, dtype: "float32" },
    { method: "rect-median", rects },
  );
  assert.equal(good.method, "none");
  assert.equal(good.offsetCounts, undefined);
  assert.equal(good.noise?.sampleCount, 1);
  assert.equal(good.noise?.scaleSource, "zero");

  const bad = applyBackground(
    { pixels: withDefect, width: PLANE_SIZE, height: PLANE_SIZE, dtype: "float32" },
    { method: "rect-median", rects },
  );
  assert.equal(bad.method, "none");
  assert.equal(bad.offsetCounts, undefined, "the median of one hot pixel is no longer an offset");
  assert.equal(bad.corrected[0], 100, "the image is returned uncorrected");
  assert.equal(bad.negativeFractionAfter, 0);

  // End to end with a real beam on that field. The finding was that a clean
  // 1x1 reference releases an almost correct width while a hot one destroys
  // the frame; both references are now refused, so the two runs are identical.
  const beam = withDefect.slice();
  for (let y = 0; y < PLANE_SIZE; y += 1) {
    for (let x = 0; x < PLANE_SIZE; x += 1) {
      const dx = (x - 31.5) / 4;
      const dy = (y - 31.5) / 3;
      beam[x + y * PLANE_SIZE] += 5000 * Math.exp(-0.5 * (dx * dx + dy * dy));
    }
  }

  const cleanReference: BackgroundRect[] = [{ x0: 2, y0: 2, width: 1, height: 1 }];
  const released = analyzeImage({
    pixels: beam,
    width: PLANE_SIZE,
    height: PLANE_SIZE,
    dtype: "float32",
    background: { method: "rect-median", rects: cleanReference },
    backgroundSigmaRects: cleanReference,
  });
  assert.equal(released.background.method, "none");
  assert.equal(released.background.offsetCounts, undefined);
  assert.equal(released.noise.sigmaCounts, 0);
  assert.equal(released.noise.scaleSource, "zero");
  assert.equal(released.noise.sampleCount, 1);
  assert.equal(released.moments.suppressionReason, null);
  assert.equal(roundTo(released.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 4), 15.9579);
  assert.equal(roundTo(released.moments.stageB?.d4SigmaMinorPx ?? Number.NaN, 4), 11.9706);
  assert.ok(shortWarningCodes(released).includes("NOISE_SCALE_SUSPECT"));

  // Old -> new: offsetCounts 5112.89, suppressionReason "residual_high",
  // negativeFractionAfter 0.9998. The hot reference is now refused and the
  // frame reads exactly like the clean-reference run above.
  const hotReference = analyzeImage({
    pixels: beam,
    width: PLANE_SIZE,
    height: PLANE_SIZE,
    dtype: "float32",
    background: { method: "rect-median", rects },
    backgroundSigmaRects: rects,
  });
  assert.equal(hotReference.background.method, "none");
  assert.equal(hotReference.background.offsetCounts, undefined);
  assert.equal(hotReference.moments.suppressionReason, null);
  assert.equal(hotReference.background.negativeFractionAfter, 0);
  assert.equal(roundTo(hotReference.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 4), 15.9579);
  assert.equal(roundTo(hotReference.moments.stageB?.d4SigmaMinorPx ?? Number.NaN, 4), 11.9706);
  assert.ok(shortWarningCodes(hotReference).includes("NOISE_SCALE_SUSPECT"));
  assert.deepEqual(shortWarningCodes(hotReference), shortWarningCodes(released));
});

// ---------------------------------------------------------------------------
// C4 — the float32 noise floor collapses at one and two samples.
// ---------------------------------------------------------------------------
test("S20 repro: a sample count below the minimum never reports a measured scale", () => {
  // Samples spanning 0 .. (n-1) * 1e6, so a healthy floor would be huge. The
  // nearest-rank P10/P90 pair collides below three samples and the span is 0.
  //
  // Old -> new sigma: n=2 was 741300 "mad" and is now 0 "zero"; n=3 was
  // 1482600 "mad" and is now 1e-6 "floor"; n=4 was 1482600 "mad" and is now
  // 2e-6 "floor". n >= 9 is unchanged. The madCounts column is unchanged
  // throughout - the raw statistic is still reported, it is just no longer
  // allowed to BE the scale.
  const expected: { n: number; floor: number; mad: number; sigma: number; source: string; floorApplied: boolean }[] = [
    { n: 1, floor: 0, mad: 0, sigma: 0, source: "zero", floorApplied: false },
    { n: 2, floor: 0, mad: 500000, sigma: 0, source: "zero", floorApplied: false },
    { n: 3, floor: 0.000001, mad: 1000000, sigma: 0.000001, source: "floor", floorApplied: true },
    { n: 4, floor: 0.000002, mad: 1000000, sigma: 0.000002, source: "floor", floorApplied: true },
    { n: 8, floor: 0.000006, mad: 2000000, sigma: 0.000006, source: "floor", floorApplied: true },
    { n: 9, floor: 0.000007, mad: 2000000, sigma: 2965200, source: "mad", floorApplied: false },
    { n: 10, floor: 0.000008, mad: 2500000, sigma: 3706500, source: "mad", floorApplied: false },
    { n: 20, floor: 0.000016, mad: 5000000, sigma: 7413000, source: "mad", floorApplied: false },
  ];
  for (const row of expected) {
    const values: number[] = [];
    for (let i = 0; i < row.n; i += 1) values.push(i * 1e6);
    const estimate = estimateBackgroundNoise(
      { pixels: values, width: row.n, height: 1, dtype: "float32" },
      [{ x0: 0, y0: 0, width: row.n, height: 1 }],
    );
    assert.equal(estimate.floorCounts, row.floor, `floor at n = ${row.n}`);
    assert.equal(estimate.madCounts, row.mad, `mad at n = ${row.n}`);
    assert.equal(estimate.sigmaCounts, row.sigma, `sigma at n = ${row.n}`);
    assert.equal(estimate.scaleSource, row.source, `scale source at n = ${row.n}`);
    assert.equal(estimate.floorApplied, row.floorApplied, `floor use at n = ${row.n}`);
  }
  assert.equal(BACKGROUND_MIN_REFERENCE_SAMPLES, 9, "the transition above sits at the pinned minimum");

  // The sharp case: two distinct samples used to report a MEASURED scale of
  // 29.652 counts with scaleSource "mad", with no warning attached to the
  // estimate itself. They now report the floor, which is zero for float32.
  const two = estimateBackgroundNoise(
    { pixels: [100, 140], width: 2, height: 1, dtype: "float32" },
    [{ x0: 0, y0: 0, width: 2, height: 1 }],
  );
  assert.equal(two.sigmaCounts, 0);
  assert.equal(two.scaleSource, "zero");
  assert.equal(two.madCounts, 20, "the raw statistic is still reported");
  assert.equal(two.floorCounts, 0);
  assert.equal(two.floorApplied, false);

  // An integer dtype has a real floor, so the same pair reports 0.5 counts
  // from the quantization floor rather than a measured 29.65.
  const twoInteger = estimateBackgroundNoise(
    { pixels: [100, 140, 100, 140], width: 2, height: 2, dtype: "uint16" },
    [{ x0: 0, y0: 0, width: 2, height: 2 }],
  );
  assert.equal(twoInteger.sigmaCounts, 0.5);
  assert.equal(twoInteger.scaleSource, "floor");
  assert.equal(twoInteger.floorApplied, true);

  const one = estimateBackgroundNoise(
    { pixels: [100], width: 1, height: 1, dtype: "float32" },
    [{ x0: 0, y0: 0, width: 1, height: 1 }],
  );
  assert.equal(one.sigmaCounts, 0);
  assert.equal(one.scaleSource, "zero");
  assert.equal(one.floorCounts, 0);
});

// ---------------------------------------------------------------------------
// C5 — the wrong method turns structure into noise.
// The fixture is the repository's own 64x48 ramp frame:
// 600 + 8x + 20000 * exp(-0.5*((x-31.5)/3.5)^2 - 0.5*((y-23.5)/2.5)^2), noise-free.
// ---------------------------------------------------------------------------
const RAMP_WIDTH = 64;
const RAMP_HEIGHT = 48;
const RAMP_TRUTH_MAJOR = 14;
const RAMP_TRUTH_MINOR = 10;

// Classic layout written by the fixture generator: 8 byte header, then an IFD
// of 2 + 9*12 + 4 bytes, then one raw little-endian uint16 strip.
function readRampFixture(): number[] {
  const bytes = readFileSync(new URL("../e2e/fixtures/ramp_background.tif", import.meta.url));
  const stripOffset = 8 + (2 + 9 * 12 + 4);
  const pixels: number[] = [];
  for (let i = 0; i < RAMP_WIDTH * RAMP_HEIGHT; i += 1) pixels.push(bytes.readUInt16LE(stripOffset + 2 * i));
  return pixels;
}

test("S20 repro: the wrong background method still reports 332 counts of noise, and now says so", () => {
  const pixels = readRampFixture();
  assert.equal(pixels[32 + 24 * RAMP_WIDTH], 20261, "fixture centre value");
  assert.equal(pixels[0], 600, "fixture corner value");

  const rects = cornerRects(RAMP_WIDTH, RAMP_HEIGHT, 0.12, 0.12);
  assert.deepEqual(rects, [
    { x0: 0, y0: 0, width: 8, height: 6 },
    { x0: 56, y0: 0, width: 8, height: 6 },
    { x0: 0, y0: 42, width: 8, height: 6 },
    { x0: 56, y0: 42, width: 8, height: 6 },
  ]);

  const median = applyBackground(
    { pixels, width: RAMP_WIDTH, height: RAMP_HEIGHT, dtype: "float32" },
    { method: "rect-median", rects },
  );
  assert.equal(roundTo(median.offsetCounts ?? Number.NaN, 4), 852);
  assert.equal(roundTo(median.noise?.sigmaCounts ?? Number.NaN, 4), 332.1024);
  assert.equal(roundTo(median.noise?.madCounts ?? Number.NaN, 3), 224);
  assert.equal(median.noise?.sampleCount, 192);

  // The statistic behind the new warning. 448 counts of trend is the ramp
  // itself: 8 counts/px over the 56 px between the left and right corner
  // centroids. The in-rect scatter is what the ramp does INSIDE an 8 px wide
  // box, which is 24 counts of spread, and the median of 48 such samples is
  // good to 6.07 counts - so the trend is 73.8 uncertainties wide.
  const trend = median.referenceTrend;
  assert.equal(trend?.rectCount, 4);
  assert.equal(roundTo(trend?.trendCounts ?? Number.NaN, 4), 448);
  assert.equal(roundTo(trend?.withinScatterCounts ?? Number.NaN, 4), 23.7216);
  assert.equal(roundTo(trend?.uncertaintyCounts ?? Number.NaN, 4), 6.0687);
  assert.equal(roundTo(trend?.ratio ?? Number.NaN, 2), 73.82);
  assert.equal(trend?.unavailableReason, null);
  assert.equal(trend?.detected, true);
  assert.ok((trend?.ratio ?? 0) > BACKGROUND_GRADIENT_TREND_K);

  const wrong = analyzeImage({
    pixels,
    width: RAMP_WIDTH,
    height: RAMP_HEIGHT,
    dtype: "float32",
    background: { method: "rect-median", rects },
    backgroundSigmaRects: rects,
  });
  assert.equal(roundTo(wrong.noise.sigmaCounts, 4), 332.1024);
  assert.equal(roundTo(wrong.aperture.peakToBackgroundNoise ?? Number.NaN, 2), 58.44);
  assert.equal(roundTo(wrong.aperture.gates.residual.maxAllowedCounts, 3), 664.205);
  assert.equal(roundTo(wrong.aperture.gates.alphaConsistency.thresholdMajorPercent, 3), 12.637);
  assert.equal(wrong.moments.suppressionReason, null);
  assert.equal(roundTo(wrong.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 4), 13.984);
  assert.equal(roundTo(wrong.moments.stageB?.d4SigmaMinorPx ?? Number.NaN, 4), 9.9882);

  // The width is almost unharmed: a linear ramp contributes nothing to the
  // central second moment, and the fit's own background absorbs the flat part.
  assert.equal(
    roundTo(relativeErrorPercent(wrong.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, RAMP_TRUTH_MAJOR), 4),
    -0.1142,
  );
  assert.equal(
    roundTo(relativeErrorPercent(wrong.moments.stageB?.d4SigmaMinorPx ?? Number.NaN, RAMP_TRUTH_MINOR), 4),
    -0.1177,
  );

  // What IS wrong: the centroid, and a noise figure invented on a noise-free
  // frame. Every measured number above is unchanged by stage E - the gates are
  // still relaxed by the invented scale, because that is what a single-offset
  // model does to a ramp. What changed is the last line: the list now names
  // the background reference.
  assert.equal(roundTo(wrong.moments.stageB?.centroidXPx ?? Number.NaN, 4), 31.6608);
  assert.equal(roundTo(wrong.moments.stageB?.centroidYPx ?? Number.NaN, 4), 23.5);
  // Old -> new: BACKGROUND_GRADIENT_IN_REFERENCE is inserted in second place
  // (it is emitted from the warnings module, in background order, before the
  // moments block). The other seven codes and their order are unchanged.
  assert.deepEqual(shortWarningCodes(wrong), [
    "ROI_UNDETERMINABLE",
    "BACKGROUND_GRADIENT_IN_REFERENCE",
    "MOMENTS_UNDEFINED",
    "WIDTH_RESOLUTION_LIMIT",
    "RADIAL_NOISE_DOMINATED",
    "WING_PROBE_REDUCED",
    "ALPHA_GATE_WEAK",
    "TIER_CHECK_UNAVAILABLE",
  ]);
});

test("S20 repro: the correct method on the same frame warns while the wrong one does not", () => {
  const pixels = readRampFixture();
  const rects = cornerRects(RAMP_WIDTH, RAMP_HEIGHT, 0.12, 0.12);
  const right = analyzeImage({
    pixels,
    width: RAMP_WIDTH,
    height: RAMP_HEIGHT,
    dtype: "float32",
    background: { method: "robust-plane", rects },
    backgroundSigmaRects: rects,
  });

  // The plane recovers the ramp exactly: 600 + 8x, read as offset 852 at the
  // reference centroid with a slope of 8 counts per pixel.
  assert.equal(right.background.plane?.converged, true);
  assert.equal(roundTo(right.background.plane?.b0Counts ?? Number.NaN, 4), 852);
  assert.equal(roundTo(right.background.plane?.bxCountsPerPx ?? Number.NaN, 5), 8);
  assert.equal(roundTo(right.background.plane?.byCountsPerPx ?? Number.NaN, 5), 0);

  assert.equal(right.noise.sigmaCounts, 0, "a noise-free frame really has no noise");
  assert.equal(right.noise.scaleCorrection, 1, "a zero scale is not deflated and is not corrected");
  assert.equal(right.moments.suppressionReason, null);
  assert.equal(roundTo(right.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 4), 13.9848);
  assert.equal(roundTo(right.moments.stageB?.centroidXPx ?? Number.NaN, 4), 31.5, "centroid recovered exactly");

  // The inversion is closed. The correct method still carries the noise-scale
  // warning (because sigma is genuinely zero); the wrong one no longer gets
  // away with a fiction, it carries the gradient warning instead.
  assert.ok(shortWarningCodes(right).includes("NOISE_SCALE_SUSPECT"));
  assert.ok(!shortWarningCodes(right).includes("BACKGROUND_GRADIENT_IN_REFERENCE"));
  assert.equal(right.background.referenceTrend, undefined, "the statistic is a rect-median instrument");
});

// ---------------------------------------------------------------------------
// R-38 — negative controls and the false-positive budget of the C5 statistic.
// ---------------------------------------------------------------------------
test("S20 repro: the gradient statistic stays silent on every negative control", () => {
  const size = 64;
  const rects = cornerRects(size, size, 0.125, 0.09375); // 8 x 6 boxes
  const build = (fill: (x: number, y: number, noise: () => number) => number, seed: number): number[] => {
    const next = gaussianStream(seed);
    const pixels: number[] = [];
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) pixels.push(fill(x, y, next));
    return pixels;
  };
  const detectRate = (
    fill: (x: number, y: number, noise: () => number) => number,
    reps: number,
    rectList: BackgroundRect[] = rects,
  ): number => {
    let fired = 0;
    for (let seed = 1; seed <= reps; seed += 1) {
      const result = applyBackground(
        { pixels: build(fill, seed), width: size, height: size, dtype: "float32" },
        { method: "rect-median", rects: rectList },
      );
      if (result.referenceTrend?.detected === true) fired += 1;
    }
    return fired / reps;
  };

  const REPS = 2000;
  // (1) flat and noisy - the null the threshold was calibrated on.
  assert.equal(detectRate((_x, _y, next) => 500 + 10 * next(), REPS), 0, "flat-noisy");
  // (2) unequal reference rectangles on the same flat noisy field.
  assert.equal(
    detectRate((_x, _y, next) => 500 + 10 * next(), REPS, [
      { x0: 0, y0: 0, width: 2, height: 2 },
      { x0: 56, y0: 0, width: 8, height: 6 },
      { x0: 0, y0: 60, width: 4, height: 4 },
      { x0: 52, y0: 54, width: 12, height: 10 },
    ]),
    0,
    "unequal rects",
  );
  // (3) a harmless constant offset: a pedestal is not a trend.
  assert.equal(detectRate((_x, _y, next) => 4200 + 10 * next(), REPS), 0, "harmless offset");
  // (4) a centred beam whose tail reaches into every corner equally.
  assert.equal(
    detectRate((x, y, next) => {
      const dx = x - 31.5;
      const dy = y - 31.5;
      return 500 + 20000 * Math.exp(-(dx * dx + dy * dy) / (2 * 14 * 14)) + 10 * next();
    }, REPS),
    0,
    "centred beam tail",
  );
  // A noise-free version of the same tail, where the pooled in-rect scatter is
  // the tail's own curvature rather than noise.
  assert.equal(
    detectRate((x, y) => {
      const dx = x - 31.5;
      const dy = y - 31.5;
      return 500 + 20000 * Math.exp(-(dx * dx + dy * dy) / (2 * 8 * 8));
    }, 1),
    0,
    "noise-free centred beam tail",
  );
  // (5) a true gradient must fire, at 1 count/px against sigma-10 noise.
  assert.equal(detectRate((x, _y, next) => 500 + 1 * x + 10 * next(), REPS), 1, "true gradient");
  // And it must fire on the noise-free ramp of the fixture slope.
  assert.equal(detectRate((x) => 600 + 8 * x, 1), 1, "noise-free ramp");

  // The documented false-positive budget: 0.1 percent per analysis. Measured
  // 0 of 2000 for every geometry above. The smallest admissible reference -
  // four 2x2 boxes, four samples per rect, where the pooled scatter is itself
  // a 16-value estimate - is the worst case at 0.155 percent over 20 000
  // realizations; on this 2000-realization sample it happens not to fire at
  // all, which is why the budget above is the number that governs and not this
  // sample.
  const tinyRate = detectRate((_x, _y, next) => 500 + 10 * next(), REPS, CORNER_2X2);
  assert.equal(tinyRate, 0, "four 2x2 boxes, the worst-case null geometry");
  assert.ok(tinyRate <= 0.002, "even the worst-case null geometry stays inside twice the budget");
});

test("S20 repro: the gradient statistic reports why it is unavailable rather than guessing", () => {
  const size = 32;
  const flat: number[] = new Array<number>(size * size).fill(500);
  for (let i = 0; i < flat.length; i += 1) flat[i] += (i * 7) % 5;
  const image = { pixels: flat, width: size, height: size, dtype: "float32" as const };
  const trendOf = (rects: BackgroundRect[]) =>
    applyBackground(image, { method: "rect-median", rects }).referenceTrend;

  // Fewer than three rects: no plane through the centroids.
  assert.equal(trendOf([{ x0: 0, y0: 0, width: 4, height: 4 }])?.unavailableReason, "too-few-rects");
  assert.equal(
    trendOf([
      { x0: 0, y0: 0, width: 4, height: 4 },
      { x0: 20, y0: 20, width: 4, height: 4 },
    ])?.unavailableReason,
    "too-few-rects",
  );
  // Three rects on one line: the normal equations are singular.
  assert.equal(
    trendOf([
      { x0: 0, y0: 0, width: 3, height: 3 },
      { x0: 10, y0: 0, width: 3, height: 3 },
      { x0: 20, y0: 0, width: 3, height: 3 },
    ])?.unavailableReason,
    "collinear-rects",
  );
  // Pinpricks: no deviation inside any rect, so nothing to normalize against.
  const pinpricks: BackgroundRect[] = [];
  for (let i = 0; i < 9; i += 1) pinpricks.push({ x0: 2 + (i % 3) * 10, y0: 3 + Math.floor(i / 3) * 10, width: 1, height: 1 });
  const pinprickTrend = trendOf(pinpricks);
  assert.equal(pinprickTrend?.unavailableReason, "no-in-rect-scatter");
  assert.equal(pinprickTrend?.detected, false);
});

// ---------------------------------------------------------------------------
// C10 — the API and the workbench must read the same sigma_B.
// ---------------------------------------------------------------------------
test("S20 repro: a rectangle background supplies the sigma_B reference on both paths", () => {
  const pixels = planeWithNoise(11);
  const rects: BackgroundRect[] = [
    { x0: 0, y0: 0, width: 8, height: 8 },
    { x0: 56, y0: 0, width: 8, height: 8 },
    { x0: 0, y0: 56, width: 8, height: 8 },
    { x0: 56, y0: 56, width: 8, height: 8 },
  ];
  const base = { pixels, width: PLANE_SIZE, height: PLANE_SIZE, dtype: "float32" as const };

  for (const method of ["robust-plane", "rect-median"] as const) {
    // The workbench path: it has always passed both.
    const ui = analyzeImage({ ...base, background: { method, rects }, backgroundSigmaRects: rects });
    // The API path: background rectangles only. Before stage E this fell back
    // to the ROI rim frame - on this scene a full-frame rim across a tilted
    // background - and reported a different sigma_B for the same picture.
    const api = analyzeImage({ ...base, background: { method, rects } });
    assert.equal(api.noise.sigmaCounts, ui.noise.sigmaCounts, `${method} sigma parity`);
    assert.equal(api.noise.sampleCount, ui.noise.sampleCount, `${method} sample-count parity`);
    assert.equal(api.noise.scaleSource, ui.noise.scaleSource, `${method} source parity`);
    assert.equal(api.noise.scaleCorrection, ui.noise.scaleCorrection, `${method} correction parity`);
    assert.deepEqual(shortWarningCodes(api), shortWarningCodes(ui), `${method} warning parity`);
    assert.equal(api.noise.sampleCount, 256, `${method} reads the four 8x8 boxes`);
  }

  // The rim frame is still the fallback when there is no rectangle background
  // to inherit, and it is measurably different here.
  const rimmed = analyzeImage({ ...base, background: { method: "none" } });
  assert.notEqual(rimmed.noise.sampleCount, 256);
  assert.ok(rimmed.noise.sigmaCounts > 0);

  // An explicit sigma_B reference always wins over the background rectangles.
  const explicit: BackgroundRect[] = [{ x0: 20, y0: 20, width: 12, height: 12 }];
  const overridden = analyzeImage({
    ...base,
    background: { method: "robust-plane", rects },
    backgroundSigmaRects: explicit,
  });
  assert.equal(overridden.noise.sampleCount, 144);
  // Those 144 pixels did not carry the plane fit, so they take no deflation
  // correction - the correction belongs to the fit's own residuals.
  assert.equal(overridden.noise.scaleCorrection, 1);
});

test("S20 repro: the plane correction follows the reference PIXELS, not the rectangle list", () => {
  // The correction belongs to samples that carried the fit. Whether a caller
  // names those samples in the fit's order, in another order, with a rectangle
  // repeated, or tiled into different rectangles is a spelling difference: all
  // four resolve to the same pixel union and therefore to literally the same
  // sample vector. Comparing rectangle TUPLES (even sorted) would catch the
  // first three and miss the fourth.
  //
  // Measured before the pixel-union comparison, on this scene: the inherited
  // path reported sigma 15.56994 with c = 1.3636 while the same reference
  // listed in reverse reported 11.41796 with c = 1 - the whole correction
  // silently dropped, which is a 26.7 percent error in every downstream
  // sigma_B consumer.
  const pixels = planeWithNoise(11, gaussianStream);
  const base = { pixels, width: PLANE_SIZE, height: PLANE_SIZE, dtype: "float32" as const };
  // Nine samples in three separated 1x3 columns: leverage-healthy, exactly at
  // the admissibility minimum, so the correction is at its largest (1.3636).
  const rects: BackgroundRect[] = [
    { x0: 10, y0: 10, width: 1, height: 3 },
    { x0: 14, y0: 12, width: 1, height: 3 },
    { x0: 18, y0: 15, width: 1, height: 3 },
  ];
  const inherited = analyzeImage({ ...base, background: { method: "robust-plane", rects } });
  assert.equal(roundTo(inherited.noise.sigmaCounts, 5), 15.56994);
  assert.equal(inherited.noise.sampleCount, 9);
  assert.equal(roundTo(inherited.noise.scaleCorrection, 6), roundTo(9 / (9 - 2.4), 6));

  const sameReference: { label: string; sigmaRects: BackgroundRect[] }[] = [
    { label: "same order", sigmaRects: rects },
    { label: "reversed order", sigmaRects: [...rects].reverse() },
    { label: "with a repeated rectangle", sigmaRects: [...rects, rects[0]] },
    { label: "shuffled with two repeats", sigmaRects: [rects[1], rects[2], rects[1], rects[0], rects[2]] },
  ];
  for (const variant of sameReference) {
    const result = analyzeImage({ ...base, background: { method: "robust-plane", rects }, backgroundSigmaRects: variant.sigmaRects });
    assert.equal(result.noise.sigmaCounts, inherited.noise.sigmaCounts, `${variant.label}: sigma`);
    assert.equal(result.noise.scaleSource, inherited.noise.scaleSource, `${variant.label}: source`);
    assert.equal(result.noise.scaleCorrection, inherited.noise.scaleCorrection, `${variant.label}: correction`);
    assert.equal(result.noise.sampleCount, inherited.noise.sampleCount, `${variant.label}: sample count`);
    assert.deepEqual(shortWarningCodes(result), shortWarningCodes(inherited), `${variant.label}: warnings`);
  }

  // Re-tiling: one 2x3 rectangle against two 1x3 rectangles over the same six
  // pixels. This is the case a sorted-tuple comparison cannot see.
  const tiled: BackgroundRect[] = [
    { x0: 10, y0: 10, width: 2, height: 3 },
    { x0: 14, y0: 12, width: 1, height: 3 },
  ];
  const split: BackgroundRect[] = [
    { x0: 10, y0: 10, width: 1, height: 3 },
    { x0: 11, y0: 10, width: 1, height: 3 },
    { x0: 14, y0: 12, width: 1, height: 3 },
  ];
  const tiledInherited = analyzeImage({ ...base, background: { method: "robust-plane", rects: tiled } });
  const tiledSplit = analyzeImage({ ...base, background: { method: "robust-plane", rects: tiled }, backgroundSigmaRects: split });
  assert.equal(roundTo(tiledInherited.noise.sigmaCounts, 5), 16.02946);
  assert.equal(tiledSplit.noise.sigmaCounts, tiledInherited.noise.sigmaCounts, "re-tiled reference: sigma");
  assert.equal(tiledSplit.noise.scaleCorrection, tiledInherited.noise.scaleCorrection, "re-tiled reference: correction");
  assert.deepEqual(shortWarningCodes(tiledSplit), shortWarningCodes(tiledInherited), "re-tiled reference: warnings");

  // A genuinely different reference takes NO plane correction - those pixels
  // did not carry the fit.
  const elsewhere = analyzeImage({
    ...base,
    background: { method: "robust-plane", rects },
    backgroundSigmaRects: [{ x0: 40, y0: 40, width: 4, height: 4 }],
  });
  assert.equal(elsewhere.noise.sampleCount, 16);
  assert.equal(elsewhere.noise.scaleCorrection, 1);
  assert.equal(roundTo(elsewhere.noise.sigmaCounts, 5), 7.95427);

  // And so does a strict SUBSET of the fit rectangles: those samples carried
  // the fit only in part, so the full correction would over-correct. Left
  // uncorrected on purpose.
  const subset = analyzeImage({
    ...base,
    background: { method: "robust-plane", rects },
    backgroundSigmaRects: [rects[0], rects[1]],
  });
  assert.equal(subset.noise.sampleCount, 6);
  assert.equal(subset.noise.scaleCorrection, 1);

  // A superset is equally not the fit's own sample set.
  const superset = analyzeImage({
    ...base,
    background: { method: "robust-plane", rects },
    backgroundSigmaRects: [...rects, { x0: 30, y0: 30, width: 2, height: 2 }],
  });
  assert.equal(superset.noise.sampleCount, 13);
  assert.equal(superset.noise.scaleCorrection, 1);
});
