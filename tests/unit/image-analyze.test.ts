import assert from "node:assert/strict";
import test from "node:test";

import { analyzeImage } from "../../packages/image/src/analyze.ts";
import { applyBackground, estimateBackgroundNoise } from "../../packages/image/src/background.ts";
import { validateImageAnalyzerInput } from "../../packages/image/src/contracts.ts";
import { WIDTH_SCATTER_WARNING_PERCENT } from "../../packages/image/src/thresholds.ts";

// Deterministic inline LCG for noise fixtures; identical sequence on every run.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// Unit-variance noise from a uniform [0,1) draw: (u - 0.5) * sqrt(12).
function unitGaussian(next: () => number): number {
  return (next() - 0.5) * Math.sqrt(12);
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

// SimulationWarning carries a short code plus a human message; match on the
// code first and fall back to a stable message fragment so the helper works
// regardless of which field name the core package uses.
function hasWarning(warnings: unknown[], code: string, messageFragment: string): boolean {
  return warnings.some((item) => {
    const warning = item as { code?: string; message?: string };
    if (warning.code === code) return true;
    return typeof warning.message === "string" && warning.message.includes(messageFragment);
  });
}

// Strict code lookup used for severity assertions.
function warningsWithCode(warnings: unknown[], code: string): Array<{ code?: string; severity?: string; message?: string }> {
  const found: Array<{ code?: string; severity?: string; message?: string }> = [];
  for (const item of warnings) {
    const record = item as { code?: string; severity?: string; message?: string };
    if (record.code === code) found.push(record);
  }
  return found;
}

// Exact union size of the documented ROI rim frame (thickness
// max(1, round(0.05 * min(w, h)))): four border strips, overlapped pixels
// deduplicated by index. Replicates analyzeImage's buildRimFrame for oracle
// checks without importing the private helper.
function rimFrameUnionSize(width: number, height: number): number {
  const thickness = Math.max(1, Math.round(0.05 * Math.min(width, height)));
  const occupancy = new Array<boolean>(width * height).fill(false);
  const add = (x0: number, y0: number, w: number, h: number): void => {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) occupancy[x + y * width] = true;
    }
  };
  add(0, 0, width, thickness);
  add(0, height - thickness, width, thickness);
  const middleHeight = height - 2 * thickness;
  if (middleHeight > 0) {
    const sideWidth = Math.min(thickness, width);
    add(0, thickness, sideWidth, middleHeight);
    add(width - sideWidth, thickness, sideWidth, middleHeight);
  }
  return occupancy.filter(Boolean).length;
}

// Deterministic isolated single-pixel spikes separated from each other so
// every spike is its own hot-pixel candidate (adjacent spikes would raise
// each other's neighbour maximum and suppress the candidate).
function addIsolatedSpikes(pixels: number[], width: number, height: number, count: number, value: number): void {
  const innerW = width - 2;
  const innerH = height - 2;
  const innerTotal = innerW * innerH;
  const occupied = new Set<number>();
  let j = 0;
  while (occupied.size < count && j < innerTotal * 8) {
    const inner = (j * 7919 + 101) % innerTotal;
    j += 1;
    const x = (inner % innerW) + 1;
    const y = (Math.floor(inner / innerW) % innerH) + 1;
    const flat = x + y * width;
    const neighbors = [flat - 1, flat + 1, flat - width, flat + width];
    if (neighbors.some((n) => occupied.has(n))) continue;
    occupied.add(flat);
    pixels[flat] = value;
  }
  assert.equal(occupied.size, count, "could not place all isolated spikes");
}

// Weak compact Gaussian on a leftover plane. The LM reports a centre far
// outside the frame (and can still claim status "converged"); the analyzer
// must not use that centre for profiles/metrics and must not release
// physical geometry.
function leftoverPlanePedestalPixels(width: number, height: number): number[] {
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      pixels[x + y * width] = 20 + 0.3 * x + Math.exp(-(dx * dx + dy * dy) / (2 * 6 * 6));
    }
  }
  return pixels;
}

test("S18a end-to-end analyze releases the stage-B moments of a rotated Gaussian with constant background", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, 9, 5, 0.6, 100, 5);
  const next = makeLcg(20250417);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "manual-offset", offsetCounts: 5 },
  });

  assert.equal(result.moments.suppressionReason, null);
  const stageB = result.moments.stageB;
  assert.notEqual(stageB, null);
  assert.equal(stageB!.valid, true);
  assert.ok(stageB!.d4SigmaMajorPx !== null && stageB!.d4SigmaMinorPx !== null);
  assert.equal(result.fits.gauss2d.status, "converged");

  // Stage A is present and structurally separate from the released stage-B
  // tier: it carries its own moments object with its own validity fields.
  const stageA = result.momentsRoiDiagnostic.moments;
  assert.equal(stageA.valid, true);
  assert.equal(result.momentsRoiDiagnostic.predicateValid, true);
  assert.ok(stageA.d4SigmaMajorPx !== null);

  // Stability report is present and actually swept.
  assert.ok(Array.isArray(result.stability.variants));
  assert.ok(result.stability.variants.length > 0);
  assert.ok(result.stability.validVariantCount > 0);

  const profileKeys = ["cutX", "cutY", "projectionX", "projectionY", "axisMajor", "axisMinor"] as const;
  for (const key of profileKeys) {
    const profile = result.profiles[key];
    assert.notEqual(profile, null, key);
    assert.notEqual(profile!.widths.fwhmData.widthPx, null, `${key} fwhm`);
    assert.notEqual(profile!.widths.oneOverESquaredData.widthPx, null, `${key} 1/e2`);
  }

  // Ellipticity is exactly sigmaMinor/sigmaMajor of the RELEASED moments.
  const major = stageB!.sigmaMajorPx;
  const minor = stageB!.sigmaMinorPx;
  assert.ok(major !== null && minor !== null);
  assert.notEqual(result.metrics.ellipticity, null);
  assert.ok(Math.abs(result.metrics.ellipticity! - minor! / major!) < 1e-12);

  assert.equal(hasWarning(result.warnings, "IMAGE_APERTURE_SUPPRESSED", "Stage-B aperture moments are suppressed"), false);
});

test("S18a analyzeImage results are JSON-compatible: deep-equal round trip, no typed arrays, no NaN or undefined fields", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, 9, 5, 0.6, 100, 5);
  const next = makeLcg(20250417);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "manual-offset", offsetCounts: 5 },
  });

  const wire = JSON.stringify(result);
  assert.doesNotThrow(() => JSON.parse(wire));
  const parsed = JSON.parse(wire);
  assert.deepStrictEqual(parsed, result);

  // The residual display grid respects the documented 256x256 cell cap.
  assert.notEqual(result.residuals, null);
  assert.ok(result.residuals!.display.width <= 256);
  assert.ok(result.residuals!.display.height <= 256);
});

test("S22 analyzeImage carries additive full-resolution residual diagnostics", () => {
  const width = 64;
  const height = 64;
  const pixels = gaussian2dPixels(width, height, 31.4, 31.8, 7, 4, 0.35, 80, 3);
  const next = makeLcg(22);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.3 * unitGaussian(next);
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "manual-offset", offsetCounts: 3 },
  });
  const residuals = result.residuals;
  assert.notEqual(residuals, null);
  if (residuals === null) throw new Error("unreachable");
  assert.notEqual(residuals.stats, null);
  assert.notEqual(residuals.histogram, null);
  assert.equal(residuals.stats!.finiteCount, width * height);
  assert.equal(residuals.histogram!.binEdgesCounts.length, 66);
  assert.ok(residuals.nrmse !== null && residuals.nrmse >= 0);
  assert.ok(residuals.rmsOverSigmaB !== null && residuals.rmsOverSigmaB >= 0);
  if (result.fits.superGauss2d?.status === "converged") {
    assert.notEqual(residuals.superGauss, null);
  } else {
    assert.equal(residuals.superGauss, null);
  }
});

test("S18a stage separation honesty: a two-lobe scene suppresses stage B but stage A diagnostics stay", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 60.3, 80.4, 6, 6, 0, 100, 0);
  const spike = gaussian2dPixels(width, height, 120.4, 80.3, 2, 2, 0, 20, 0);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += spike[i];

  const result = analyzeImage({ pixels, width, height, dtype: "float32" });

  assert.equal(result.moments.stageB, null);
  assert.notEqual(result.moments.suppressionReason, null);

  // No substitution: the stage-A diagnostic tier is intact even though the
  // released stage-B slot stays null.
  const stageA = result.momentsRoiDiagnostic.moments;
  assert.equal(stageA.valid, true);
  assert.ok(stageA.sigmaMajorPx !== null && stageA.d4SigmaMajorPx !== null);

  assert.equal(hasWarning(result.warnings, "IMAGE_APERTURE_SUPPRESSED", "Stage-B aperture moments are suppressed"), true);
});

test("S18a sigma_B reference cascade: explicit rectangles win, otherwise the ROI rim frame is used", () => {
  // Explicit reference rectangles: the noise estimate must reflect exactly
  // the union of the two given rects (10x10 + 4x4 = 116 finite pixels).
  const rectPixels = new Array<number>(32 * 32).fill(7);
  const withRects = analyzeImage({
    pixels: rectPixels,
    width: 32,
    height: 32,
    dtype: "float32",
    backgroundSigmaRects: [
      { x0: 0, y0: 0, width: 10, height: 10 },
      { x0: 16, y0: 16, width: 4, height: 4 },
    ],
  });
  assert.equal(withRects.noise.sampleCount, 116);

  // No reference rectangles: the documented ROI rim frame with thickness
  // max(1, round(0.05 * min(w, h))) = 8 for a 160x160 frame.
  const fullPixels = new Array<number>(160 * 160).fill(7);
  const fullFrame = analyzeImage({ pixels: fullPixels, width: 160, height: 160, dtype: "float32" });
  assert.equal(fullFrame.noise.sampleCount, rimFrameUnionSize(160, 160));
  assert.equal(fullFrame.noise.sampleCount, 4864);
});

test("S18a M-3 noise wiring: weak-beam profiles suppress as low-signal, a strong beam measures data widths", () => {
  // Weak beam: peak far below 3 * sigma_B on both the cut (sigma_B) and the
  // projection (sigma_B * sqrt(max contributingCount)) noise scales.
  const weakPixels = gaussian2dPixels(12, 16, 6, 8, 6, 6, 0, 0.15, 0);
  const weakNext = makeLcg(77);
  for (let i = 0; i < weakPixels.length; i += 1) weakPixels[i] += 1.5 * unitGaussian(weakNext);
  const weak = analyzeImage({ pixels: weakPixels, width: 12, height: 16, dtype: "float32" });

  const weakKeys = ["cutX", "cutY", "projectionX", "projectionY"] as const;
  for (const key of weakKeys) {
    const profile = weak.profiles[key];
    assert.notEqual(profile, null, key);
    assert.equal(profile!.widths.fwhmData.suppressedReason, "low-signal", `${key} fwhm`);
    assert.equal(profile!.widths.fwhmData.widthPx, null, key);
    assert.equal(profile!.widths.oneOverESquaredData.suppressedReason, "low-signal", `${key} 1/e2`);
    assert.equal(profile!.widths.oneOverESquaredData.widthPx, null, key);
  }

  // Strong beam: both the cut and the projection carry measured data widths.
  const strongPixels = gaussian2dPixels(160, 128, 80, 64, 6, 6, 0, 200, 0);
  const strongNext = makeLcg(909);
  for (let i = 0; i < strongPixels.length; i += 1) strongPixels[i] += 1.0 * unitGaussian(strongNext);
  const strong = analyzeImage({ pixels: strongPixels, width: 160, height: 128, dtype: "float32" });

  for (const key of weakKeys) {
    const profile = strong.profiles[key];
    assert.notEqual(profile, null, key);
    assert.equal(profile!.widths.fwhmData.suppressedReason, null, `${key} fwhm`);
    assert.notEqual(profile!.widths.fwhmData.widthPx, null, `${key} fwhm`);
    assert.equal(profile!.widths.oneOverESquaredData.suppressedReason, null, `${key} 1/e2`);
    assert.notEqual(profile!.widths.oneOverESquaredData.widthPx, null, `${key} 1/e2`);
  }

  // The measured cut width is a real FWHM(data) near 2.3548 * sigma = 14.13 px.
  const fwhmPx = strong.profiles.cutX!.widths.fwhmData.widthPx;
  assert.ok(fwhmPx !== null && fwhmPx >= 12.5 && fwhmPx <= 15.8, `cut-x fwhm ${fwhmPx}`);
});

test("S18a warning thresholds: hot-pixel fractions select the info then the warning severity", () => {
  const width = 200;
  const height = 200;
  const makeFlatWithSpikes = (spikeCount: number): number[] => {
    const pixels = new Array<number>(width * height).fill(10);
    const next = makeLcg(31);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);
    addIsolatedSpikes(pixels, width, height, spikeCount, 40);
    return pixels;
  };

  // 20 spikes over 40000 finite pixels = 0.05 percent: above the 0.01 percent
  // info fraction and below the 0.1 percent warning fraction -> info.
  const infoPixels = makeFlatWithSpikes(20);
  const info = analyzeImage({ pixels: infoPixels, width, height, dtype: "uint8" });
  assert.equal(info.raw.hotPixelCandidateCount, 20);
  const infoWarnings = warningsWithCode(info.warnings, "IMAGE_HOT_PIXELS");
  assert.equal(infoWarnings.length, 1);
  assert.equal(infoWarnings[0].severity, "info");

  // 200 spikes = 0.5 percent: above the warning fraction -> warning.
  const warnPixels = makeFlatWithSpikes(200);
  const warn = analyzeImage({ pixels: warnPixels, width, height, dtype: "uint8" });
  assert.equal(warn.raw.hotPixelCandidateCount, 200);
  const warnWarnings = warningsWithCode(warn.warnings, "IMAGE_HOT_PIXELS");
  assert.equal(warnWarnings.length, 1);
  assert.equal(warnWarnings[0].severity, "warning");
});

test("S18a warning thresholds: a near-circular beam raises IMAGE_ORIENTATION_UNSTABLE", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 80.2, 79.8, 9, 9, 0, 100, 0);
  const next = makeLcg(4242);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  const result = analyzeImage({ pixels, width, height, dtype: "float32" });
  const orientationWarnings = warningsWithCode(result.warnings, "IMAGE_ORIENTATION_UNSTABLE");
  assert.equal(orientationWarnings.length, 1);
  assert.equal(orientationWarnings[0].severity, "info");
});

test("S18a warning thresholds: non-finite pixels raise IMAGE_FLOAT_SPECIALS", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, 9, 5, 0.6, 100, 5);
  const next = makeLcg(20250417);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);
  for (let k = 0; k < 7; k += 1) pixels[3 * width + 7 + k] = Number.NaN;

  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "manual-offset", offsetCounts: 5 },
  });
  assert.equal(result.raw.nonFiniteCount, 7);
  const specials = warningsWithCode(result.warnings, "IMAGE_FLOAT_SPECIALS");
  assert.equal(specials.length, 1);
  assert.equal(specials[0].severity, "warning");
});

test("S18a robustness: a degenerate robust-plane background degrades to the none path with IMAGE_BACKGROUND_DEGENERATE", () => {
  // All rect pixels on a single row: not enough spread for a plane fit, so
  // applyBackground throws its documented RangeError and analyzeImage
  // continues on the none path.
  const width = 96;
  const height = 96;
  const pixels = gaussian2dPixels(width, height, 48, 48, 8, 8, 0, 100, 3);
  const next = makeLcg(777);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "robust-plane", rects: [{ x0: 0, y0: 0, width: 8, height: 1 }] },
  });

  assert.equal(result.background.plane, null);
  assert.equal(result.background.method, "none");
  const degenerate = warningsWithCode(result.warnings, "IMAGE_BACKGROUND_DEGENERATE");
  assert.equal(degenerate.length, 1);
  assert.equal(degenerate[0].severity, "warning");

  // The corrected frame is the none-path frame: every downstream section
  // must be identical to an explicit none-background run on the same pixels.
  const none = analyzeImage({ pixels, width, height, dtype: "float32", background: { method: "none" } });
  assert.deepStrictEqual(result.fits, none.fits);
  assert.deepStrictEqual(result.moments, none.moments);
  assert.deepStrictEqual(result.momentsRoiDiagnostic, none.momentsRoiDiagnostic);
  assert.deepStrictEqual(result.profiles, none.profiles);
  assert.deepStrictEqual(result.metrics, none.metrics);
});

test("S18a robustness: an all-NaN image returns honest nulls with IMAGE_FLOAT_SPECIALS and IMAGE_MOMENTS_UNDEFINED, never throws", () => {
  const width = 8;
  const height = 8;
  const pixels = new Array<number>(width * height).fill(Number.NaN);

  const result = analyzeImage({ pixels, width, height, dtype: "float32" });

  assert.equal(result.moments.stageB, null);
  assert.notEqual(result.moments.suppressionReason, null);
  assert.equal(result.fits.gauss2d.params, null);
  assert.equal(result.fits.superGauss2d, null);
  assert.equal(result.metrics.ellipticity, null);
  assert.equal(result.metrics.radialDistribution, null);
  assert.equal(result.residuals, null);
  assert.equal(result.profiles.cutX, null);
  assert.equal(result.profiles.cutY, null);

  assert.equal(warningsWithCode(result.warnings, "IMAGE_FLOAT_SPECIALS").length, 1);
  assert.equal(warningsWithCode(result.warnings, "IMAGE_MOMENTS_UNDEFINED").length, 1);

  // JSON-only contract: no NaN and no undefined ever appears in the wire form.
  const wire = JSON.stringify(result);
  assert.equal(wire.includes("NaN"), false);
  assert.equal(wire.includes("undefined"), false);
  assert.doesNotThrow(() => JSON.parse(wire));
});

test("S18a API dispatch: the image-analysis headless job returns the versioned envelope with equal warnings", async () => {
  const { runHeadlessJob } = await import("../../packages/api/src/index.ts");

  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, 9, 5, 0.6, 100, 5);
  const next = makeLcg(20250417);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  const envelope = runHeadlessJob({
    kind: "image-analysis",
    input: { pixels, width, height, dtype: "float32", background: { method: "manual-offset", offsetCounts: 5 } },
  });

  assert.equal(envelope.ok, true);
  const value = envelope.value as {
    version: string;
    kind: string;
    result: { warnings: unknown[] };
    warnings: unknown[];
  };
  assert.equal(value.version, "0.1");
  assert.equal(value.kind, "image-analysis");
  assert.deepStrictEqual(value.warnings, value.result.warnings);
});

test("S18a analyzeImage is deterministic and never mutates its input pixels", () => {
  const width = 96;
  const height = 96;
  const base = gaussian2dPixels(width, height, 47.6, 48.4, 9, 6, 0.4, 90, 3);
  const next = makeLcg(13579);
  for (let i = 0; i < base.length; i += 1) base[i] += 0.7 * unitGaussian(next);

  const pixels = Float32Array.from(base);
  const snapshot = Float32Array.from(pixels);
  const input = { pixels, width, height, dtype: "float32" as const };

  const first = analyzeImage(input);
  const second = analyzeImage(input);

  assert.deepStrictEqual(second, first);
  assert.deepStrictEqual(pixels, snapshot);
});

test("S18a sigma_B is measured on the corrected field, not the raw ramp", () => {
  const width = 80;
  const height = 80;
  const pixels = gaussian2dPixels(width, height, 40, 40, 6, 6, 0, 100, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels[x + y * width] += 0.5 * x;
  }
  const next = makeLcg(18);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 2 * unitGaussian(next);
  const rects = [
    { x0: 0, y0: 0, width: 12, height: 12 },
    { x0: 68, y0: 0, width: 12, height: 12 },
    { x0: 0, y0: 68, width: 12, height: 12 },
    { x0: 68, y0: 68, width: 12, height: 12 },
  ];
  const raw = { pixels, width, height, dtype: "float32" as const };
  const corrected = applyBackground(raw, { method: "robust-plane", rects }).corrected;
  const onCorrected = estimateBackgroundNoise(
    { pixels: Array.from(corrected), width, height, dtype: "float32" },
    rects,
  );
  const onRaw = estimateBackgroundNoise(raw, rects);
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "robust-plane", rects },
    backgroundSigmaRects: rects,
  });
  assert.ok(onRaw.sigmaCounts > 10, `raw sigma ${onRaw.sigmaCounts}`);
  assert.ok(onCorrected.sigmaCounts < 5, `corrected sigma ${onCorrected.sigmaCounts}`);
  // S20 stage E (C2): the analyzer's sigma_B is still the estimate measured on
  // the CORRECTED field over these rectangles - that is what this oracle owns -
  // but those pixels ARE the plane's own residuals, so it now carries the
  // measured deflation correction n / (n - 2.4). A bare estimateBackgroundNoise
  // call knows nothing about the fit and reports the deflated number.
  const referenceSamples = 4 * 12 * 12;
  const correction = referenceSamples / (referenceSamples - 2.4);
  assert.equal(result.noise.sampleCount, referenceSamples);
  assert.equal(result.noise.scaleCorrection, correction);
  assert.ok(Math.abs(result.noise.sigmaCounts - onCorrected.sigmaCounts * correction) < 1e-12);
  assert.equal(result.aperture.gates.residual.high, false);
});

test("S18a invalid calibration is rejected at the door and never leaks into stepUm", () => {
  const width = 32;
  const height = 32;
  const pixels = gaussian2dPixels(width, height, 16, 16, 4, 3, 0, 50, 0);
  const base = { pixels, width, height, dtype: "float32" as const };

  assert.equal(validateImageAnalyzerInput({ ...base, calibration: { pixelPitchUmX: -3, pixelPitchUmY: 5 } }).ok, false);
  assert.equal(validateImageAnalyzerInput({ ...base, calib: { pixelPitchUmX: Number.NaN, pixelPitchUmY: 5 } }).ok, false);
  assert.equal(validateImageAnalyzerInput({ ...base, calibration: { pixelPitchUmX: 0, pixelPitchUmY: 5 } }).ok, false);
  assert.equal(validateImageAnalyzerInput({ ...base, calibration: {} as { pixelPitchUmX: number; pixelPitchUmY: number } }).ok, false);
  assert.equal(validateImageAnalyzerInput({ ...base, calib: { pixelPitchUmX: 2.5, pixelPitchUmY: 2.5 } }).ok, true);

  assert.throws(
    () => analyzeImage({ ...base, calibration: { pixelPitchUmX: -3, pixelPitchUmY: 5 } }),
    /positive finite/,
  );
});

test("S18a mapMomentsToPhysical failure after a valid input is contained", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, 9, 5, 0.6, 100, 0);
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    calibration: { pixelPitchUmX: 5.2, pixelPitchUmY: 5.2 },
  });
  assert.notEqual(result.fits.physical, undefined);
  assert.ok(result.fits.physical!.d4SigmaMajorUm > 0);
  assert.ok(Number.isFinite(result.fits.physical!.d4SigmaMajorUm));
  if (result.moments.physical) {
    assert.ok(Number.isFinite(result.moments.physical.d4SigmaMajorUm));
  }
});

test("S18e-D ellipticityPhysical: a pixel-round beam under an anisotropic 3.45/1.15 um pitch reports a 1:3 physical ellipse", () => {
  const width = 160;
  const height = 160;
  const sigma = 9;
  // Round IN PIXELS (sigmaMajorPx == sigmaMinorPx): pixel-space ellipticity
  // must stay near 1 regardless of calibration. Under the 3.45/1.15 um pitch
  // (ratio 3:1) the PHYSICAL ellipticity is 1/3 - the documented example in
  // metrics.ts computePhysicalEllipticity (S18 review G1: the pixel ratio
  // reads +200 percent off).
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, sigma, sigma, 0, 100, 5);
  const next = makeLcg(20260819);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.3 * unitGaussian(next);

  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "manual-offset", offsetCounts: 5 },
    calibration: { pixelPitchUmX: 3.45, pixelPitchUmY: 1.15 },
  });

  assert.equal(result.moments.suppressionReason, null);
  const stageB = result.moments.stageB;
  assert.notEqual(stageB, null);
  assert.equal(stageB!.valid, true);

  // Pixel-space metrics.ellipticity is untouched by this wiring and stays
  // near 1.
  assert.notEqual(result.metrics.ellipticity, null);
  assert.ok(Math.abs(result.metrics.ellipticity! - 1) < 0.02, `pixel ellipticity ${result.metrics.ellipticity}`);

  // Physical ellipticity is near 1/3, 2 percent relative tolerance.
  assert.notEqual(result.metrics.ellipticityPhysical, null);
  const relativeError = Math.abs(result.metrics.ellipticityPhysical! - 1 / 3) / (1 / 3);
  assert.ok(relativeError < 0.02, `physical ellipticity ${result.metrics.ellipticityPhysical}, relative error ${relativeError}`);
});

test("S18e-D ellipticityPhysical is null without a calibration, even though the pixel ellipticity is released", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 79.3, 79.7, 9, 5, 0.6, 100, 5);
  const next = makeLcg(20250417);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "manual-offset", offsetCounts: 5 },
  });

  assert.equal(result.moments.suppressionReason, null);
  assert.notEqual(result.metrics.ellipticity, null);
  assert.equal(result.moments.physical, undefined);
  assert.equal(result.metrics.ellipticityPhysical, null);
});

test("S18a leftover-plane moments do not start the fit and physical geometry stays in-image", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 80, 80, 8, 8, 0, 10, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels[x + y * width] += 0.02 * x + 0.01 * y;
  }
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    calibration: { pixelPitchUmX: 6.5, pixelPitchUmY: 6.5 },
  });
  assert.equal(result.fits.gauss2d.startSource, "half-area");
  const params = result.fits.gauss2d.params;
  if (result.fits.gauss2d.status === "converged" && params !== null) {
    assert.ok(params.centerXPx >= 0 && params.centerXPx <= width - 1, `cx ${params.centerXPx}`);
    assert.ok(params.centerYPx >= 0 && params.centerYPx <= height - 1, `cy ${params.centerYPx}`);
    assert.ok(params.sigmaMajorPx < width, `sigma ${params.sigmaMajorPx}`);
    if (result.fits.physical !== undefined) {
      assert.ok(result.fits.physical.centerXUm >= 0);
      assert.ok(result.fits.physical.centerXUm <= width * 6.5);
    }
  } else {
    assert.equal(result.fits.physical, undefined);
    assert.equal(hasWarning(result.warnings, "IMAGE_FIT_NOT_CONVERGED", "did not converge"), true);
  }
});

test("S18a hostile Infinity pixels never leak non-finite numbers into the JSON result", () => {
  const width = 8;
  const height = 8;
  const pixels = new Array<number>(width * height).fill(Number.POSITIVE_INFINITY);
  pixels[0] = Number.NaN;
  pixels[1] = Number.NEGATIVE_INFINITY;
  const result = analyzeImage({ pixels, width, height, dtype: "float32" });

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "number") {
      assert.equal(Number.isFinite(value), true, `non-finite at ${path}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    }
  };
  walk(result, "result");
  const wire = JSON.stringify(result);
  assert.equal(wire.includes("NaN"), false);
  assert.equal(wire.includes("Infinity"), false);
});

test("S18a a compact beam still uses plausible stage-A moments as an optional start", () => {
  const width = 96;
  const height = 96;
  const pixels = gaussian2dPixels(width, height, 47.5, 48.2, 7, 5, 0.3, 80, 0);
  const result = analyzeImage({ pixels, width, height, dtype: "float32" });
  assert.equal(result.fits.gauss2d.startSource, "moments");
  assert.equal(result.fits.gauss2d.status, "converged");
  const params = result.fits.gauss2d.params;
  assert.notEqual(params, null);
  assert.ok(Math.abs(params!.centerXPx - 47.5) < 0.5, `cx ${params!.centerXPx}`);
});

test("S18a a frame-filling beam flags the rim noise scale as suspect", () => {
  const width = 64;
  const height = 64;
  const pixels = gaussian2dPixels(width, height, 32, 32, 28, 28, 0, 100, 0);
  const result = analyzeImage({ pixels, width, height, dtype: "float32" });
  assert.equal(hasWarning(result.warnings, "IMAGE_NOISE_SCALE_SUSPECT", "beam-contaminated"), true);
  assert.ok(result.noise.medianCounts > 0.2 * 100);
});

test("S18 warning recalibration: a compact user ROI (5x fitted minor sigma) fires IMAGE_NOISE_SCALE_SUSPECT even when stage-B aperture is clipped-suppressed", () => {
  const width = 200;
  const height = 140;
  const sigmaMajor = 11;
  const sigmaMinor = 6;
  const centerX = 100;
  const centerY = 70;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigmaMajor, sigmaMinor, 0, 100, 0);
  const next = makeLcg(20260819);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 2 * unitGaussian(next);
  // Rectangular ROI: generous on the major axis (90 px, roomy relative to
  // sigmaMajor 11) but compact on the minor axis (30 px = 5*sigmaMinor).
  // The trigger reads Math.min(roi.width, roi.height), so only the short
  // side needs to be compact for it to fire.
  const roi = { x0: 55, y0: 55, width: 90, height: 30 };
  const result = analyzeImage({ pixels, width, height, dtype: "float32", roi });

  assert.equal(result.fits.gauss2d.status, "converged");
  const params = result.fits.gauss2d.params!;
  assert.ok(params.amplitudeCounts > 0);
  assert.ok(
    Math.min(roi.width, roi.height) < 6 * params.sigmaMinorPx,
    `roi ${roi.width}x${roi.height} vs 6*sigmaMinor ${6 * params.sigmaMinorPx}`,
  );

  // The gate is FIT-based, not release-based: measured stage-B is
  // suppressed here (aperture_clipped - the 6-sigma check ellipse does not
  // fit inside this compact ROI) yet the warning still fires, because the
  // trigger reads gaussFit directly and never the released aperture
  // moments.
  assert.equal(result.moments.stageB, null);
  assert.notEqual(result.moments.suppressionReason, null);

  const suspects = warningsWithCode(result.warnings, "IMAGE_NOISE_SCALE_SUSPECT");
  assert.equal(suspects.length, 1);
  assert.equal(suspects[0].severity, "warning");
  assert.equal(
    hasWarning(result.warnings, "IMAGE_NOISE_SCALE_SUSPECT", "smaller than 6 times the fitted minor sigma"),
    true,
  );
});

test("S18 warning recalibration: a roomy user ROI (>= 7.5x fitted minor sigma) stays silent on IMAGE_NOISE_SCALE_SUSPECT", () => {
  const width = 220;
  const height = 220;
  const sigmaMajor = 11;
  const sigmaMinor = 6;
  const centerX = 110;
  const centerY = 110;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigmaMajor, sigmaMinor, 0.3, 100, 0);
  const next = makeLcg(20260819);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 2 * unitGaussian(next);
  // 48 px = 8*sigmaMinor, comfortably above the 7.5x honesty threshold
  // documented in analyze.ts (measured calibration: 5-sigma sides are 2.7x
  // rim-contaminated, 7.5-sigma sides are honest at 1.03x).
  const roi = { x0: 86, y0: 86, width: 48, height: 48 };
  const result = analyzeImage({ pixels, width, height, dtype: "float32", roi });

  assert.equal(result.fits.gauss2d.status, "converged");
  const params = result.fits.gauss2d.params!;
  assert.ok(
    Math.min(roi.width, roi.height) >= 6 * params.sigmaMinorPx,
    `roi ${roi.width}x${roi.height} vs 6*sigmaMinor ${6 * params.sigmaMinorPx}`,
  );

  assert.equal(warningsWithCode(result.warnings, "IMAGE_NOISE_SCALE_SUSPECT").length, 0);
});

test("S18 warning recalibration: the same compact ROI stays silent when the user supplies backgroundSigmaRects", () => {
  const width = 200;
  const height = 140;
  const sigmaMajor = 11;
  const sigmaMinor = 6;
  const centerX = 100;
  const centerY = 70;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigmaMajor, sigmaMinor, 0, 100, 0);
  const next = makeLcg(20260819);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 2 * unitGaussian(next);
  const roi = { x0: 55, y0: 55, width: 90, height: 30 };
  // Four small corner rects inside the compact ROI, clear of the beam
  // (sigmaMinor 6 in the ROI's short/y direction; the corners sit >2 sigma
  // away vertically and far off-centre horizontally).
  const sigmaRects = [
    { x0: roi.x0 + 2, y0: roi.y0 + 2, width: 6, height: 6 },
    { x0: roi.x0 + roi.width - 8, y0: roi.y0 + 2, width: 6, height: 6 },
    { x0: roi.x0 + 2, y0: roi.y0 + roi.height - 8, width: 6, height: 6 },
    { x0: roi.x0 + roi.width - 8, y0: roi.y0 + roi.height - 8, width: 6, height: 6 },
  ];
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    roi,
    backgroundSigmaRects: sigmaRects,
  });

  assert.equal(result.fits.gauss2d.status, "converged");
  // Same fit geometry as the "fires" test above (same pixels/ROI), so the
  // compact-ROI condition itself is still true - only the presence of user
  // reference rectangles must silence the arm.
  const params = result.fits.gauss2d.params!;
  assert.ok(Math.min(roi.width, roi.height) < 6 * params.sigmaMinorPx);
  assert.equal(warningsWithCode(result.warnings, "IMAGE_NOISE_SCALE_SUSPECT").length, 0);
});

test("S18 warning recalibration: IMAGE_NOISE_SCALE_SUSPECT never fires twice when both the rim-median and compact-ROI arms would independently trigger", () => {
  // A 50x50 full-frame beam wide enough (sigma 22) that BOTH raw conditions
  // hold at once: the ROI rim is beam-contaminated (measured rim median
  // 48.7 percent of peak, over the 20 percent floor of the rim-median arm)
  // AND the full-frame ROI (50 px) is far smaller than 6 times the fitted
  // minor sigma (6*22 = 132 px, the compact-ROI arm). Without the
  // double-emission guard this would push the same code twice.
  const width = 50;
  const height = 50;
  const pixels = gaussian2dPixels(width, height, 25, 25, 22, 22, 0, 100, 0);
  const result = analyzeImage({ pixels, width, height, dtype: "float32" });

  assert.equal(result.fits.gauss2d.status, "converged");
  const params = result.fits.gauss2d.params!;
  assert.ok(result.noise.medianCounts > 0.2 * 100, `rim median ${result.noise.medianCounts}`);
  assert.ok(
    Math.min(result.roi.rect.width, result.roi.rect.height) < 6 * params.sigmaMinorPx,
    `roi vs 6*sigmaMinor ${6 * params.sigmaMinorPx}`,
  );

  const suspects = warningsWithCode(result.warnings, "IMAGE_NOISE_SCALE_SUSPECT");
  assert.equal(suspects.length, 1);
});

test("S18a an out-of-image leftover-plane fit centre falls back to the discrete ROI peak", () => {
  const width = 96;
  const height = 80;
  const pixels = leftoverPlanePedestalPixels(width, height);
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    calibration: { pixelPitchUmX: 5.5, pixelPitchUmY: 5.5 },
  });

  const params = result.fits.gauss2d.params;
  assert.notEqual(params, null);
  assert.equal(params!.centerXPx >= 0 && params!.centerXPx <= width - 1 && params!.centerYPx >= 0 && params!.centerYPx <= height - 1, false);

  // Cuts must not stay null just because extractCut rejects the LM centre.
  assert.notEqual(result.profiles.cutX, null);
  assert.notEqual(result.profiles.cutY, null);
  assert.ok(result.profiles.cutX!.positionsPx.length > 0);
  assert.ok(result.profiles.cutY!.positionsPx.length > 0);

  // Radial / symmetry must not bin around the exterior LM centre.
  assert.notEqual(result.metrics.radialDistribution, null);
  const cx = result.metrics.radialDistribution!.centerXPx;
  const cy = result.metrics.radialDistribution!.centerYPx;
  assert.ok(cx >= 0 && cx <= width - 1, `radial cx ${cx}`);
  assert.ok(cy >= 0 && cy <= height - 1, `radial cy ${cy}`);
  assert.notEqual(result.metrics.symmetry, null);
});

test("S18a a converged leftover-plane fit outside the image withholds physical geometry and raises IMAGE_FIT_NOT_CONVERGED", () => {
  const width = 96;
  const height = 80;
  const pixels = leftoverPlanePedestalPixels(width, height);
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    calibration: { pixelPitchUmX: 5.5, pixelPitchUmY: 5.5 },
  });

  const params = result.fits.gauss2d.params;
  assert.notEqual(params, null);
  assert.equal(params!.centerXPx >= 0 && params!.centerXPx <= width - 1, false);
  assert.equal(result.fits.physical, undefined);
  const fitWarnings = warningsWithCode(result.warnings, "IMAGE_FIT_NOT_CONVERGED");
  assert.equal(fitWarnings.length, 1);
  assert.equal(fitWarnings[0].severity, "warning");
  assert.equal(hasWarning(result.warnings, "IMAGE_FIT_NOT_CONVERGED", "did not converge"), true);
});

test("S18a profiles are bounded by the confirmed ROI: pixels outside the ROI never drive profile values or positions", () => {
  const width = 160;
  const height = 140;
  const centerX = 99;
  const centerY = 79;
  const sigma1 = 9;
  const sigma2 = 6;
  const amplitude = 1000;
  const clean = gaussian2dPixels(width, height, centerX, centerY, sigma1, sigma2, 0, amplitude, 0);
  // Poisoned copy: every pixel OUTSIDE the confirmed ROI (x < 40 or y < 30)
  // is set to a huge value. extractCut / computeProjection / extractAxisProfile
  // take a corrected-image object with no ROI parameter of their own, so
  // before the fix these poisoned pixels leaked straight into the released
  // profile values (e.g. cutX peakValueCounts jumping from ~1000 to 1e6).
  const poisoned = clean.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < 40 || y < 30) poisoned[x + y * width] = 1e6;
    }
  }
  const roi = { x0: 40, y0: 30, width: 120, height: 100 };

  const cleanResult = analyzeImage({ pixels: clean, width, height, dtype: "float32", roi });
  const poisonedResult = analyzeImage({ pixels: poisoned, width, height, dtype: "float32", roi });

  // Every profile is actually present, so the deep-equal below is not vacuous.
  const profileKeys = ["cutX", "cutY", "projectionX", "projectionY", "axisMajor", "axisMinor"] as const;
  for (const key of profileKeys) {
    assert.notEqual(cleanResult.profiles[key], null, key);
  }

  // The poisoned pixels all sit outside the confirmed ROI: the two profiles
  // sections must be byte-for-byte identical.
  assert.deepStrictEqual(poisonedResult.profiles, cleanResult.profiles);

  // Positions stay in IMAGE coordinates: the cut through the beam peaks near
  // the true image-space centre (99, 79), never near the ROI-relative
  // artefact (59, 49) an un-shifted fix would leave behind.
  const cutX = cleanResult.profiles.cutX;
  assert.ok(Math.abs(cutX!.widths.peakValueCounts - amplitude) < 1e-6, `peak ${cutX!.widths.peakValueCounts}`);
  assert.equal(cutX!.widths.peakPositionPx, centerX);

  const cutY = cleanResult.profiles.cutY;
  assert.ok(Math.abs(cutY!.widths.peakValueCounts - amplitude) < 1e-6, `peak ${cutY!.widths.peakValueCounts}`);
  assert.equal(cutY!.widths.peakPositionPx, centerY);
});

test("S18a fits.physical release is bound by the confirmed ROI, not the image: a beam truncated by a small ROI withholds physical geometry", () => {
  const width = 160;
  const height = 140;
  const pixels = gaussian2dPixels(width, height, 99, 79, 9, 6, 0, 1000, 0);
  const next = makeLcg(20250417);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);
  const calibration = { pixelPitchUmX: 5, pixelPitchUmY: 5 };

  // Clean case: full-frame ROI, the fit converges well inside it and
  // physical geometry is released as usual.
  const clean = analyzeImage({ pixels, width, height, dtype: "float32", calibration });
  assert.equal(clean.fits.gauss2d.status, "converged");
  assert.notEqual(clean.fits.physical, undefined);

  // A small ROI whose rectangle does not contain the beam centre: enough of
  // the beam's tail is still visible inside the ROI for the LM to recover
  // the true (~99, ~79) centre - a converged, IN-IMAGE geometry whose centre
  // nonetheless sits outside the confirmed ROI rectangle.
  const truncatedRoi = { x0: 40, y0: 30, width: 55, height: 45 };
  const truncated = analyzeImage({ pixels, width, height, dtype: "float32", calibration, roi: truncatedRoi });
  assert.equal(truncated.fits.gauss2d.status, "converged");
  const params = truncated.fits.gauss2d.params;
  assert.notEqual(params, null);
  assert.ok(params!.centerXPx >= 0 && params!.centerXPx <= width - 1, `cx ${params!.centerXPx}`);
  assert.ok(params!.centerYPx >= 0 && params!.centerYPx <= height - 1, `cy ${params!.centerYPx}`);
  const insideRoi =
    params!.centerXPx >= truncatedRoi.x0 &&
    params!.centerXPx <= truncatedRoi.x0 + truncatedRoi.width - 1 &&
    params!.centerYPx >= truncatedRoi.y0 &&
    params!.centerYPx <= truncatedRoi.y0 + truncatedRoi.height - 1;
  assert.equal(insideRoi, false, `centre ${params!.centerXPx}, ${params!.centerYPx} unexpectedly inside the ROI`);

  // The fit geometry is releasable-by-image but not releasable-by-ROI:
  // physical must stay withheld and the same IMAGE_FIT_NOT_CONVERGED channel
  // that flags an out-of-image centre must also fire for an out-of-ROI one.
  assert.equal(truncated.fits.physical, undefined);
  assert.equal(hasWarning(truncated.warnings, "IMAGE_FIT_NOT_CONVERGED", "did not converge"), true);
});

test("S18 warning recalibration: correctly corrected SNR-20 Gaussian emits no IMAGE_NEGATIVE_POWER on a tight or a loose ROI", () => {
  const width = 160;
  const height = 128;
  const pixels = gaussian2dPixels(width, height, 80, 64, 11, 6, 0.3, 100, 0);
  const next = makeLcg(20260818);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 5 * unitGaussian(next);
  const sigmaRects = [
    { x0: 4, y0: 4, width: 16, height: 16 },
    { x0: width - 20, y0: 4, width: 16, height: 16 },
    { x0: 4, y0: height - 20, width: 16, height: 16 },
    { x0: width - 20, y0: height - 20, width: 16, height: 16 },
  ];

  const tight = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    roi: { x0: 30, y0: 20, width: 100, height: 88 },
    backgroundSigmaRects: sigmaRects,
  });
  const loose = analyzeImage({ pixels, width, height, dtype: "float32", backgroundSigmaRects: sigmaRects });

  assert.ok(tight.noise.sigmaCounts > 0, `tight sigma ${tight.noise.sigmaCounts}`);
  assert.equal(warningsWithCode(tight.warnings, "IMAGE_NEGATIVE_POWER").length, 0);
  assert.equal(warningsWithCode(loose.warnings, "IMAGE_NEGATIVE_POWER").length, 0);
});

test("S18 warning recalibration: 1*sigmaB over-subtraction fires IMAGE_NEGATIVE_POWER", () => {
  const width = 160;
  const height = 128;
  const pixels = gaussian2dPixels(width, height, 80, 64, 11, 6, 0.3, 100, 0);
  const next = makeLcg(20260818);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 5 * unitGaussian(next);
  const sigmaRects = [
    { x0: 4, y0: 4, width: 16, height: 16 },
    { x0: width - 20, y0: 4, width: 16, height: 16 },
    { x0: 4, y0: height - 20, width: 16, height: 16 },
    { x0: width - 20, y0: height - 20, width: 16, height: 16 },
  ];

  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "manual-offset", offsetCounts: 5 },
    backgroundSigmaRects: sigmaRects,
  });

  assert.equal(warningsWithCode(result.warnings, "IMAGE_NEGATIVE_POWER").length, 1);
});

test("S18 warning recalibration: a full-frame stability sweep never emits warning-severity IMAGE_ROI_SENSITIVE (spec 9.1)", () => {
  const width = 160;
  const height = 128;
  const pixels = gaussian2dPixels(width, height, 80, 64, 11, 6, 0.3, 100, 0);
  const next = makeLcg(20260818);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 5 * unitGaussian(next);
  const sigmaRects = [
    { x0: 4, y0: 4, width: 16, height: 16 },
    { x0: width - 20, y0: 4, width: 16, height: 16 },
    { x0: 4, y0: height - 20, width: 16, height: 16 },
    { x0: width - 20, y0: height - 20, width: 16, height: 16 },
  ];

  const result = analyzeImage({ pixels, width, height, dtype: "float32", backgroundSigmaRects: sigmaRects });

  assert.equal(result.stability.fullFrame, true);
  // Spec section 9.1: a full-frame base ROI never emits WARNING-severity
  // IMAGE_ROI_SENSITIVE - the width is ROI-dependent by construction and a
  // beam-tight ROI should be confirmed instead. INFO severity is permitted
  // for the full-frame hole; this clean scene emits no IMAGE_ROI_SENSITIVE
  // at all.
  const roiSensitive = warningsWithCode(result.warnings, "IMAGE_ROI_SENSITIVE");
  for (const item of roiSensitive) {
    assert.equal(item.severity, "info");
  }
});

test("S18 warning recalibration: sigmaB=0 with a constant pedestal left in still fires IMAGE_NEGATIVE_POWER via the 0.02 floor", () => {
  const width = 160;
  const height = 128;
  // No noise: a constant -1.5 pedestal is left in the corrected field, so a
  // large negative halo surrounds the beam and the floor-only arm must fire.
  const pixels = gaussian2dPixels(width, height, 80, 64, 11, 6, 0.3, 100, -1.5);
  const sigmaRects = [
    { x0: 4, y0: 4, width: 16, height: 16 },
    { x0: width - 20, y0: 4, width: 16, height: 16 },
    { x0: 4, y0: height - 20, width: 16, height: 16 },
    { x0: width - 20, y0: height - 20, width: 16, height: 16 },
  ];

  const result = analyzeImage({ pixels, width, height, dtype: "float32", backgroundSigmaRects: sigmaRects });

  // The corner rects see the pedestal plus femto-scale float residue of the
  // gaussian tails, so sigmaCounts is zero only up to float rounding; the
  // floor-only arm is what the oracle pins, not an exact zero.
  assert.ok(result.noise.sigmaCounts < 1e-9, `sigmaCounts ${result.noise.sigmaCounts}`);
  assert.equal(warningsWithCode(result.warnings, "IMAGE_NEGATIVE_POWER").length, 1);
});

test("S18 warning recalibration: 0.5*sigmaB over-subtraction fires IMAGE_NEGATIVE_POWER (spec 9.7 oracle)", () => {
  const width = 160;
  const height = 128;
  const pixels = gaussian2dPixels(width, height, 80, 64, 11, 6, 0.3, 100, 0);
  const next = makeLcg(20260818);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 5 * unitGaussian(next);
  const sigmaRects = [
    { x0: 4, y0: 4, width: 16, height: 16 },
    { x0: width - 20, y0: 4, width: 16, height: 16 },
    { x0: 4, y0: height - 20, width: 16, height: 16 },
    { x0: width - 20, y0: height - 20, width: 16, height: 16 },
  ];

  // Spec-9.7 oracle: the same deterministic scene as the 1*sigmaB
  // over-subtraction test with the excess halved (offsetCounts 2.5 at
  // sigmaB 5). The measured predicate margin is only ~11 percent, so 0.5
  // sigmaB of over-subtraction must still fire IMAGE_NEGATIVE_POWER.
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "manual-offset", offsetCounts: 2.5 },
    backgroundSigmaRects: sigmaRects,
  });

  assert.equal(warningsWithCode(result.warnings, "IMAGE_NEGATIVE_POWER").length, 1);
});

test("S18 warning recalibration: a contained 8-sigma user ROI at SNR 100 stays silent on the major axis (spec 9.7 oracle)", () => {
  const width = 300;
  const height = 240;
  const pixels = gaussian2dPixels(width, height, 150, 120, 11, 6, 0.3, 100, 0);
  const next = makeLcg(202608182);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += unitGaussian(next);
  // Contained 8-sigma user ROI on a 300x240 frame (beam centre well inside,
  // full 8-sigma check ellipse and every sweep variant inside the image).
  // Spec pin: at SNR 100 the major-axis half-spread is ~4.2 percent, below
  // the 8 percent adaptive floor, so no IMAGE_ROI_SENSITIVE may be emitted
  // at any severity.
  const roi = { x0: 40, y0: 30, width: 220, height: 180 };
  const sigmaRects = [
    { x0: roi.x0 + 4, y0: roi.y0 + 4, width: 16, height: 16 },
    { x0: roi.x0 + roi.width - 20, y0: roi.y0 + 4, width: 16, height: 16 },
    { x0: roi.x0 + 4, y0: roi.y0 + roi.height - 20, width: 16, height: 16 },
    { x0: roi.x0 + roi.width - 20, y0: roi.y0 + roi.height - 20, width: 16, height: 16 },
  ];

  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    roi,
    backgroundSigmaRects: sigmaRects,
  });

  assert.equal(result.stability.fullFrame, false);
  assert.ok(result.stability.sensitivities !== null, "ROI stability spread must be determinable");
  assert.ok(result.noise.sigmaCounts > 0, `sigmaB ${result.noise.sigmaCounts}`);
  assert.equal(warningsWithCode(result.warnings, "IMAGE_ROI_SENSITIVE").length, 0);
});

test("S18 warning recalibration: a full-frame sweep with high major-axis half-spread emits info IMAGE_ROI_SENSITIVE (spec 9.1)", () => {
  const width = 300;
  const height = 240;
  // Off-centre beam near the top-right edge plus a corner blob: the 0.8
  // full-frame shrink variant cuts both structures while the baseline keeps
  // them, so the major-axis d4 half-spread is high (tens of percent at
  // SNR 100). On a full-frame base ROI the width is ROI-dependent by
  // construction, so the same excess is emitted at INFO severity - never
  // warning severity - stating a beam-tight ROI should be confirmed.
  // Centre 250 keeps the beam inside the 0.8 shrink variant (x 30..269) so
  // the sweep stays determinable while the corner blob drives the spread.
  const beam = gaussian2dPixels(width, height, 250, 50, 11, 6, 0.3, 100, 0);
  const blob = gaussian2dPixels(width, height, 290, 225, 4, 4, 0, 40, 0);
  const pixels = new Array<number>(width * height);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = beam[i] + blob[i];
  const next = makeLcg(202608183);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += unitGaussian(next);

  const result = analyzeImage({ pixels, width, height, dtype: "float32" });

  assert.equal(result.stability.fullFrame, true);
  assert.ok(result.stability.sensitivities !== null, "ROI stability spread must be determinable");
  const majorSensitivity = result.stability.sensitivities.find((item) => item.metric === "d4SigmaMajorPx");
  assert.notEqual(majorSensitivity, undefined);
  assert.ok(majorSensitivity!.halfSpreadPercent > 8, `half-spread ${majorSensitivity!.halfSpreadPercent}`);
  const roiSensitive = warningsWithCode(result.warnings, "IMAGE_ROI_SENSITIVE");
  assert.equal(roiSensitive.length, 1);
  assert.equal(roiSensitive[0].severity, "info");
});

test("S18 review G3: a noise-dominated radial distribution warns IMAGE_RADIAL_NOISE_DOMINATED; a well-contained one stays silent", () => {
  // Confirmed defect: encircled-power radii can inflate hugely under noise
  // (measured +368 percent on r95) with no warning anywhere. The fix reuses
  // IMAGE_NEGATIVE_POWER's expected zero-mean null ratio (roiPixelCount *
  // sigmaB / (sqrt(2*pi) * totalPositiveCounts)) and warns above a
  // calibrated fraction (RADIAL_NOISE_DOMINATED_RATIO = 0.15).

  // Dominated scene: sigma 6 beam, 121x121 full-frame ROI, SNR 20. Measured
  // r95 = 68.78 px against the analytic 14.69 px (+368 percent, matching the
  // review's own repro number almost exactly) - expectedRatio measured
  // 0.68, comfortably over the 0.15 threshold.
  const dominatedWidth = 121;
  const dominatedHeight = 121;
  const dominatedSigma = 6;
  const dominatedAmplitude = 100;
  const dominatedPixels = gaussian2dPixels(
    dominatedWidth,
    dominatedHeight,
    60,
    60,
    dominatedSigma,
    dominatedSigma,
    0,
    dominatedAmplitude,
    0,
  );
  const dominatedNext = makeLcg(20260819);
  for (let i = 0; i < dominatedPixels.length; i += 1) {
    dominatedPixels[i] += (dominatedAmplitude / 20) * unitGaussian(dominatedNext);
  }
  const dominated = analyzeImage({ pixels: dominatedPixels, width: dominatedWidth, height: dominatedHeight, dtype: "float32" });
  const dominatedR95 = dominated.metrics.encircledPowerRadiiPx.find((f) => f.fraction === 0.95);
  assert.notEqual(dominatedR95, undefined);
  assert.notEqual(dominatedR95!.radiusPx, null);
  const analyticR95 = dominatedSigma * Math.sqrt(-2 * Math.log(1 - 0.95));
  assert.ok(
    dominatedR95!.radiusPx! > 3 * analyticR95,
    `dominated r95 ${dominatedR95!.radiusPx} must be grossly inflated over the analytic ${analyticR95}`,
  );
  const dominatedWarnings = warningsWithCode(dominated.warnings, "IMAGE_RADIAL_NOISE_DOMINATED");
  assert.equal(dominatedWarnings.length, 1);
  assert.equal(dominatedWarnings[0].severity, "info");

  // Healthy scene: sigma 11 beam at SNR 100, on a tight (~3.3 sigma
  // half-side) confirmed ROI so few background pixels sit far from the
  // beam. Measured r95 = 27.28 px against the analytic 26.93 px (+1.3
  // percent, "within ~2 percent") - expectedRatio measured 0.032, well
  // under the 0.15 threshold.
  const healthyWidth = 400;
  const healthyHeight = 400;
  const healthySigma = 11;
  const healthyAmplitude = 100;
  const healthyCenter = 200;
  const healthyPixels = gaussian2dPixels(
    healthyWidth,
    healthyHeight,
    healthyCenter,
    healthyCenter,
    healthySigma,
    healthySigma,
    0,
    healthyAmplitude,
    0,
  );
  const healthyNext = makeLcg(31415);
  for (let i = 0; i < healthyPixels.length; i += 1) {
    healthyPixels[i] += (healthyAmplitude / 100) * unitGaussian(healthyNext);
  }
  const healthyRoi = { x0: healthyCenter - 36, y0: healthyCenter - 36, width: 72, height: 72 };
  const healthy = analyzeImage({ pixels: healthyPixels, width: healthyWidth, height: healthyHeight, dtype: "float32", roi: healthyRoi });
  const healthyR95 = healthy.metrics.encircledPowerRadiiPx.find((f) => f.fraction === 0.95);
  assert.notEqual(healthyR95, undefined);
  assert.notEqual(healthyR95!.radiusPx, null);
  const healthyAnalyticR95 = healthySigma * Math.sqrt(-2 * Math.log(1 - 0.95));
  const healthyRelError = Math.abs(healthyR95!.radiusPx! - healthyAnalyticR95) / healthyAnalyticR95;
  assert.ok(healthyRelError < 0.1, `healthy r95 relative error ${healthyRelError} must stay small`);
  assert.equal(warningsWithCode(healthy.warnings, "IMAGE_RADIAL_NOISE_DOMINATED").length, 0);
});

test("S18 review G6: a 12-bit sensor clipped at 4095 (stored uint16) raises IMAGE_CLIPPING_SUSPECT; a clean beam and a proper 65535 saturation do not carry it", () => {
  const width = 64;
  const height = 64;
  const cx = 32;
  const cy = 32;
  const sigma = 8;
  const clipAt = 4095;

  const clippedPixels = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const value = 8000 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      clippedPixels[x + y * width] = Math.min(Math.round(value), clipAt);
    }
  }
  const clipped = analyzeImage({ pixels: clippedPixels, width, height, dtype: "uint16" });
  const clippingWarnings = warningsWithCode(clipped.warnings, "IMAGE_CLIPPING_SUSPECT");
  assert.equal(clippingWarnings.length, 1);
  assert.equal(clippingWarnings[0].severity, "info");
  assert.equal(warningsWithCode(clipped.warnings, "IMAGE_SATURATION").length, 0);

  const cleanPixels = gaussian2dPixels(width, height, cx, cy, sigma, sigma, 0, 1000, 0);
  const clean = analyzeImage({ pixels: cleanPixels, width, height, dtype: "float32" });
  assert.equal(warningsWithCode(clean.warnings, "IMAGE_CLIPPING_SUSPECT").length, 0);

  const saturatedPixels = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const value = 100000 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      saturatedPixels[x + y * width] = Math.min(Math.round(value), 65535);
    }
  }
  const saturated = analyzeImage({ pixels: saturatedPixels, width, height, dtype: "uint16" });
  assert.equal(warningsWithCode(saturated.warnings, "IMAGE_CLIPPING_SUSPECT").length, 0);
  const saturationWarnings = warningsWithCode(saturated.warnings, "IMAGE_SATURATION");
  assert.equal(saturationWarnings.length, 1);
  assert.equal(saturationWarnings[0].severity, "warning");
});

test("S18 review G7: a released sigma-2 minor axis carries IMAGE_WIDTH_RESOLUTION_LIMIT; a released sigma-5 minor axis does not", () => {
  const width = 80;
  const height = 80;
  const cx = 40;
  const cy = 40;
  const amplitude = 200;

  const narrowPixels = gaussian2dPixels(width, height, cx, cy, 2, 2, 0, amplitude, 0);
  const narrowNext = makeLcg(555);
  for (let i = 0; i < narrowPixels.length; i += 1) narrowPixels[i] += unitGaussian(narrowNext);
  const narrow = analyzeImage({ pixels: narrowPixels, width, height, dtype: "float32" });
  assert.notEqual(narrow.moments.stageB, null);
  assert.ok(narrow.moments.stageB!.sigmaMinorPx! < 3, `sigmaMinorPx ${narrow.moments.stageB!.sigmaMinorPx}`);
  const narrowWarnings = warningsWithCode(narrow.warnings, "IMAGE_WIDTH_RESOLUTION_LIMIT");
  assert.equal(narrowWarnings.length, 1);
  assert.equal(narrowWarnings[0].severity, "info");

  const widePixels = gaussian2dPixels(width, height, cx, cy, 5, 5, 0, amplitude, 0);
  const wideNext = makeLcg(555);
  for (let i = 0; i < widePixels.length; i += 1) widePixels[i] += unitGaussian(wideNext);
  const wide = analyzeImage({ pixels: widePixels, width, height, dtype: "float32" });
  assert.notEqual(wide.moments.stageB, null);
  assert.ok(wide.moments.stageB!.sigmaMinorPx! >= 3, `sigmaMinorPx ${wide.moments.stageB!.sigmaMinorPx}`);
  assert.equal(warningsWithCode(wide.warnings, "IMAGE_WIDTH_RESOLUTION_LIMIT").length, 0);
});

// S18-R2 final-review honesty instruments (F1 a/b, F2).
//
// A core Gaussian plus a faint WIDE halo on the same centre. The halo of the
// review scene is 0.05 percent of the peak at 8x the core width, which is
// 3.2 percent of the power - enough to move the in-frame truth by 71 percent
// and little enough that the single-Gauss LM absorbs all of it into the
// constant background term.
function coreAndHaloPixels(
  size: number,
  coreSigmaX: number,
  coreSigmaY: number,
  amplitude: number,
  haloAmplitude: number,
  haloScale: number,
  offsetCounts: number,
): number[] {
  const centre = size / 2 - 0.5;
  const haloSigmaX = coreSigmaX * haloScale;
  const haloSigmaY = coreSigmaY * haloScale;
  const pixels = new Array<number>(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      const core =
        amplitude *
        Math.exp(-((dx * dx) / (2 * coreSigmaX * coreSigmaX) + (dy * dy) / (2 * coreSigmaY * coreSigmaY)));
      const halo =
        haloAmplitude *
        Math.exp(-((dx * dx) / (2 * haloSigmaX * haloSigmaX) + (dy * dy) / (2 * haloSigmaY * haloSigmaY)));
      pixels[x + y * size] = offsetCounts + core + halo;
    }
  }
  return pixels;
}

// Second-moment d4 widths of a noise-free reference field over the full frame:
// the in-frame TRUTH the released aperture number is judged against.
function inFrameTruthD4Major(pixels: number[], size: number): number {
  let sum = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = pixels[x + y * size];
      sum += value;
      sumX += value * x;
      sumY += value * y;
    }
  }
  const cx = sumX / sum;
  const cy = sumY / sum;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = pixels[x + y * size];
      xx += value * (x - cx) * (x - cx);
      yy += value * (y - cy) * (y - cy);
      xy += value * (x - cx) * (y - cy);
    }
  }
  xx /= sum;
  yy /= sum;
  xy /= sum;
  const mean = (xx + yy) / 2;
  const disc = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
  return 4 * Math.sqrt(mean + disc);
}

test("S18-R2 F1: a faint wide wing absorbed into the fitted background still releases, but no longer silently", () => {
  // Final-review finding F1. The review scene is 512x512 with a core sigma of
  // 8x6 and a halo of amplitude 0.5 at 8x the core width; it releases a
  // d4SigmaMajorPx of 32.12 against an in-frame truth of 54.98 (-41.6 percent)
  // with ZERO warnings. This oracle uses the same scene at half the linear
  // scale (256x256, core sigma 4x3, same halo amplitude and width ratio),
  // which reproduces the failure to three digits (measured released error
  // -41.57 vs -41.58 percent, aperture excess 1.731 vs 1.730 percent) at a
  // sixth of the runtime.
  const size = 256;
  const wingPixels = coreAndHaloPixels(size, 4, 3, 1000, 0.5, 8, 0);
  const cleanPixels = coreAndHaloPixels(size, 4, 3, 1000, 0, 8, 0);

  const wing = analyzeImage({ pixels: wingPixels, width: size, height: size, dtype: "float32" });
  const clean = analyzeImage({ pixels: cleanPixels, width: size, height: size, dtype: "float32" });

  // The released number is still released - and still wrong by 41 percent.
  assert.notEqual(wing.moments.stageB, null);
  assert.equal(wing.moments.suppressionReason, null);
  const truth = inFrameTruthD4Major(wingPixels, size);
  const releasedError = (100 * ((wing.moments.stageB!.d4SigmaMajorPx as number) - truth)) / truth;
  assert.ok(releasedError < -35, `released error ${releasedError} percent against truth ${truth}`);

  // Red state, pinned: the two channels that could have caught it stay blind.
  assert.equal(wing.aperture.pedestal.hint, false);
  assert.equal(wing.aperture.gates.alphaConsistency.inconsistent, false);
  assert.equal(warningsWithCode(wing.warnings, "IMAGE_PEDESTAL_HINT").length, 0);

  // Green state: both honesty instruments name it.
  const absorbed = warningsWithCode(wing.warnings, "IMAGE_ABSORBED_POWER");
  assert.equal(absorbed.length, 1);
  assert.equal(absorbed[0].severity, "warning");
  const tier = warningsWithCode(wing.warnings, "IMAGE_TIER_DISAGREEMENT");
  assert.equal(tier.length, 1);
  assert.equal(tier[0].severity, "warning");
  // The measurements behind the verdicts are exported, not just the verdict.
  assert.equal(wing.aperture.absorbedPower.high, true);
  assert.ok((wing.aperture.absorbedPower.apertureExcessFraction as number) > 0);
  assert.notEqual(wing.aperture.absorbedPower.flatFractionOfBeamPower, null);
  assert.notEqual(wing.aperture.absorbedPower.modelPowerCounts, null);

  // The same beam WITHOUT the halo releases an accurate width and stays
  // silent on both instruments: the instruments answer the wing, not the
  // geometry.
  assert.notEqual(clean.moments.stageB, null);
  const cleanTruth = inFrameTruthD4Major(cleanPixels, size);
  const cleanError = (100 * ((clean.moments.stageB!.d4SigmaMajorPx as number) - cleanTruth)) / cleanTruth;
  assert.ok(Math.abs(cleanError) < 1, `clean released error ${cleanError} percent`);
  assert.equal(clean.aperture.absorbedPower.high, false);
  assert.equal(warningsWithCode(clean.warnings, "IMAGE_ABSORBED_POWER").length, 0);
  assert.equal(warningsWithCode(clean.warnings, "IMAGE_TIER_DISAGREEMENT").length, 0);
});

test("S18-R2 F1: the camera-realistic wing scene (uint16, bias, read noise, corner background) raises IMAGE_ABSORBED_POWER", () => {
  // The same wing at the review scale, run through a realistic acquisition
  // chain: 16-bit integers, a bias of 100 counts, read noise of 8 counts and a
  // four-corner rect-median background stage. Measured released error
  // -41.9 percent, and silent before this change.
  const size = 512;
  const ideal = coreAndHaloPixels(size, 8, 6, 1000, 0.5, 8, 100);
  const next = makeLcg(1234);
  const pixels = new Uint16Array(size * size);
  for (let i = 0; i < pixels.length; i += 1) {
    const value = Math.round(ideal[i] + 8 * unitGaussian(next));
    pixels[i] = value < 0 ? 0 : value > 65535 ? 65535 : value;
  }
  const corner = 51;
  const result = analyzeImage({
    pixels,
    width: size,
    height: size,
    dtype: "uint16",
    background: {
      method: "rect-median",
      rects: [
        { x0: 0, y0: 0, width: corner, height: corner },
        { x0: size - corner, y0: 0, width: corner, height: corner },
        { x0: 0, y0: size - corner, width: corner, height: corner },
        { x0: size - corner, y0: size - corner, width: corner, height: corner },
      ],
    },
  });

  assert.notEqual(result.moments.stageB, null);
  const truth = inFrameTruthD4Major(coreAndHaloPixels(size, 8, 6, 1000, 0.5, 8, 0), size);
  const releasedError = (100 * ((result.moments.stageB!.d4SigmaMajorPx as number) - truth)) / truth;
  assert.ok(releasedError < -35, `released error ${releasedError} percent against truth ${truth}`);
  assert.equal(result.aperture.absorbedPower.high, true);
  assert.equal(warningsWithCode(result.warnings, "IMAGE_ABSORBED_POWER").length, 1);
  // The noise-aware ceiling is what makes this honest rather than lucky: the
  // excess has to clear the scatter this image own noise can produce.
  assert.ok(
    Math.abs(result.aperture.absorbedPower.apertureExcessFraction as number) >
      (result.aperture.absorbedPower.thresholdFraction as number),
    `excess ${result.aperture.absorbedPower.apertureExcessFraction} vs ceiling ${result.aperture.absorbedPower.thresholdFraction}`,
  );
});

test("S18-R2 F2: a marginal released width carries IMAGE_WIDTH_SCATTER and its measured scatter; a well-resolved one carries neither", () => {
  // Final-review finding F2. The alpha gate compares two apertures on the same
  // realization, so it never reports how far the released number itself moves
  // under this image own noise. Measured: well-resolved beams at SNR 100 sit
  // at 0.34-0.42 percent, the same beams at SNR 20 at 1.43-2.14 percent, and
  // the marginal sigma 3x1.5 family at SNR 20 at 6.43-7.60 percent with true
  // released errors reaching 18 percent.
  const marginalSize = 64;
  const marginalPixels = gaussian2dPixels(marginalSize, marginalSize, 31.5, 31.5, 3, 1.5, 0, 1000, 0);
  const marginalNext = makeLcg(90000);
  for (let i = 0; i < marginalPixels.length; i += 1) marginalPixels[i] += 50 * unitGaussian(marginalNext);
  const marginal = analyzeImage({
    pixels: marginalPixels,
    width: marginalSize,
    height: marginalSize,
    dtype: "float32",
  });
  assert.notEqual(marginal.moments.stageB, null);
  const marginalScatter = marginal.aperture.gates.alphaConsistency.d4ScatterMajorPercent;
  assert.notEqual(marginalScatter, null);
  assert.ok((marginalScatter as number) > WIDTH_SCATTER_WARNING_PERCENT, `scatter ${marginalScatter}`);
  const scatterWarnings = warningsWithCode(marginal.warnings, "IMAGE_WIDTH_SCATTER");
  assert.equal(scatterWarnings.length, 1);
  assert.equal(scatterWarnings[0].severity, "warning");

  const wellResolvedSize = 160;
  const wellResolvedPixels = gaussian2dPixels(wellResolvedSize, wellResolvedSize, 79.5, 79.5, 11, 6, 0, 1000, 0);
  const wellResolvedNext = makeLcg(90000);
  for (let i = 0; i < wellResolvedPixels.length; i += 1) wellResolvedPixels[i] += 10 * unitGaussian(wellResolvedNext);
  const wellResolved = analyzeImage({
    pixels: wellResolvedPixels,
    width: wellResolvedSize,
    height: wellResolvedSize,
    dtype: "float32",
  });
  assert.notEqual(wellResolved.moments.stageB, null);
  const wellResolvedScatter = wellResolved.aperture.gates.alphaConsistency.d4ScatterMajorPercent;
  assert.notEqual(wellResolvedScatter, null);
  assert.ok((wellResolvedScatter as number) < 1, `scatter ${wellResolvedScatter}`);
  assert.equal(warningsWithCode(wellResolved.warnings, "IMAGE_WIDTH_SCATTER").length, 0);
  // The scatter is a released-number uncertainty, never a gate: the
  // well-resolved beam and the marginal one both release.
  assert.equal(marginal.moments.suppressionReason, null);
  assert.equal(wellResolved.moments.suppressionReason, null);
});

// ---------------------------------------------------------------------------
// S20 stage A: the aperture-coverage gate, end to end through analyzeImage.
// Same scene family as the aperture-level oracles: 240 x 200, sigma 11 x 6 at
// 0.6 rad, amplitude 100, sigma_B 0.5, masked only inside the 6-sigma check
// ellipse so a dead fraction is a fraction of the measurement support.
// ---------------------------------------------------------------------------
const S20_W = 240;
const S20_H = 200;
const S20_CX = 120.3;
const S20_CY = 99.7;
const S20_S1 = 11;
const S20_S2 = 6;
const S20_THETA = 0.6;

function s20CoverageScene(kill: ((x: number, y: number) => boolean) | null): number[] {
  const pixels = gaussian2dPixels(S20_W, S20_H, S20_CX, S20_CY, S20_S1, S20_S2, S20_THETA, 100, 0);
  // Same mulberry32 + Box-Muller stream the aperture oracles use, inlined so
  // this file keeps its own fixtures.
  let a = 0x5eed21 >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    pixels[i] += 0.5 * value;
  }
  if (kill === null) return pixels;
  const cos = Math.cos(S20_THETA);
  const sin = Math.sin(S20_THETA);
  for (let y = 0; y < S20_H; y += 1) {
    for (let x = 0; x < S20_W; x += 1) {
      const dx = x - S20_CX;
      const dy = y - S20_CY;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if ((u * u) / (6 * S20_S1) ** 2 + (v * v) / (6 * S20_S2) ** 2 > 1) continue;
      if (kill(x, y)) pixels[x + y * S20_W] = Number.NaN;
    }
  }
  return pixels;
}

function s20Analyze(pixels: number[]) {
  return analyzeImage({ pixels, width: S20_W, height: S20_H, dtype: "float32" });
}

test("S20 coverage: a clean frame carries the coverage block's no-data defaults through the analyze envelope", () => {
  const result = s20Analyze(s20CoverageScene(null));
  assert.equal(result.raw.nonFiniteCount, 0);
  assert.equal(result.moments.suppressionReason, null);

  // Nothing was measured, and the block says so rather than claiming full
  // coverage: counts 0, numbers null, verdict false.
  const coverage = result.aperture.coverage;
  assert.equal(coverage.aperturePixelCount, 0);
  assert.equal(coverage.finitePixelCount, 0);
  assert.equal(coverage.finiteFraction, null);
  assert.equal(coverage.modelBiasMajorPercent, null);
  assert.equal(coverage.modelBiasMinorPercent, null);
  assert.equal(coverage.high, false);

  // A clean frame has nothing to say about coverage at all.
  assert.equal(warningsWithCode(result.warnings, "IMAGE_FLOAT_SPECIALS").length, 0);
  assert.equal(warningsWithCode(result.warnings, "IMAGE_COVERAGE_LOSS").length, 0);
});

test("S20 coverage: a dead column suppresses end to end, and the non-finite notice stops reassuring", () => {
  const result = s20Analyze(s20CoverageScene((x) => Math.abs(x - Math.round(S20_CX)) < 2));

  assert.equal(result.moments.suppressionReason, "coverage_insufficient");
  assert.equal(result.moments.stageB, null);
  const coverage = result.aperture.coverage;
  assert.equal(coverage.aperturePixelCount, 3312);
  assert.equal(coverage.finitePixelCount, 3148);
  assert.equal(coverage.high, true);
  assert.ok(
    (coverage.modelBiasMajorPercent as number) > 5.9 && (coverage.modelBiasMajorPercent as number) < 6.0,
    `major bias ${coverage.modelBiasMajorPercent}`,
  );

  // The suppression is reported with the new reason in the usual place.
  const suppressed = warningsWithCode(result.warnings, "IMAGE_APERTURE_SUPPRESSED");
  assert.equal(suppressed.length, 1);
  assert.ok(
    (suppressed[0].message as string).includes("coverage_insufficient"),
    `suppression message ${suppressed[0].message}`,
  );

  // The float-specials notice used to end with "every downstream statistic
  // ignores them", which read as a reassurance on exactly the frames where the
  // number was already wrong. It must not say that any more.
  const specials = warningsWithCode(result.warnings, "IMAGE_FLOAT_SPECIALS");
  assert.equal(specials.length, 1);
  const message = specials[0].message as string;
  assert.equal(message.includes("ignores them"), false, message);
  assert.ok(message.includes("skipped by every accumulation"), message);
  assert.ok(message.includes("measurement aperture"), message);

  // A suppressed frame must not also carry the released-frame notice.
  assert.equal(warningsWithCode(result.warnings, "IMAGE_COVERAGE_LOSS").length, 0);
});

test("S20 coverage: a released frame with a measurable sub-threshold coverage bias reports it", () => {
  // A narrow dead column 18 px off the beam centre. It costs 156 aperture
  // pixels and shifts the released major width by -1.63 percent: under the
  // 2-percent release ceiling, so the frame ships - and says what it is
  // shipping instead of leaving the operator to read a dead-pixel count.
  const result = s20Analyze(s20CoverageScene((x) => x - Math.round(S20_CX) >= 18 && x - Math.round(S20_CX) < 20));

  assert.equal(result.moments.suppressionReason, null);
  assert.notEqual(result.moments.stageB, null);
  const coverage = result.aperture.coverage;
  assert.equal(coverage.aperturePixelCount, 3312);
  assert.equal(coverage.finitePixelCount, 3215);
  assert.equal(coverage.high, false);
  assert.ok(
    (coverage.modelBiasMajorPercent as number) < -1.6 && (coverage.modelBiasMajorPercent as number) > -1.7,
    `major bias ${coverage.modelBiasMajorPercent}`,
  );

  const notice = warningsWithCode(result.warnings, "IMAGE_COVERAGE_LOSS");
  assert.equal(notice.length, 1);
  assert.equal(notice[0].severity, "warning");
  const message = notice[0].message as string;
  assert.ok(message.includes("3312"), message);
  assert.ok(message.includes("-1.63"), message);

  // Further out the same column stops mattering and the notice goes quiet, so
  // this is a measurement and not a standing complaint about dead pixels.
  const faint = s20Analyze(s20CoverageScene((x) => x - Math.round(S20_CX) >= 30 && x - Math.round(S20_CX) < 32));
  assert.equal(faint.moments.suppressionReason, null);
  assert.ok(
    Math.abs(faint.aperture.coverage.modelBiasMajorPercent as number) < 0.3,
    `faint bias ${faint.aperture.coverage.modelBiasMajorPercent}`,
  );
  assert.equal(warningsWithCode(faint.warnings, "IMAGE_COVERAGE_LOSS").length, 0);
  assert.equal(warningsWithCode(faint.warnings, "IMAGE_FLOAT_SPECIALS").length, 1);
});

// ---------------------------------------------------------------------------
// S20 stage B: the honesty floor.
//
// Three additive INFO instruments about a RELEASED width - how wide the
// consistency window was, how far the wing probes reached, and whether the
// cross-tier check ran at all. None of them suppresses anything; the tests
// below therefore pin the release verdict alongside every notice.
// ---------------------------------------------------------------------------

// The core-plus-halo attack scene: a 1-percent halo at 4x the core width. The
// single-Gauss fit absorbs the halo, and the self-calibrated consistency
// ceiling grows with sigma_B until the real 12-percent defect walks through.
function s20bHaloScene(sigmaB: number): number[] {
  const size = 192;
  const pixels = new Array<number>(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - 95.5;
      const dy = y - 95.5;
      const r2 = dx * dx + dy * dy;
      pixels[y * size + x] = 1000 * Math.exp(-r2 / (2 * 64)) + 10 * Math.exp(-r2 / (2 * 1024));
    }
  }
  if (sigmaB > 0) {
    const next = makeLcg(4242);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] += sigmaB * unitGaussian(next);
  }
  return pixels;
}

// A beam plus a uniform pedestal the FIT absorbs into its constant term. Stage
// A sees the pedestal spread over the whole ROI and reports a ROI-sized sigma;
// stage B, which works on the fit-subtracted field, does not.
function s20bPedestalScene(pedestal: number): number[] {
  const size = 100;
  const pixels = new Array<number>(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - 49.5;
      const dy = y - 49.5;
      pixels[x + y * size] = pedestal + 1000 * Math.exp(-(dx * dx + dy * dy) / (2 * 36));
    }
  }
  return pixels;
}

test("S20 stage B: a released width whose consistency ceiling exceeded the reporting level says so", () => {
  // sigma_B = 100 on a peak of 1000. The alpha-consistency test passes, but
  // only because its ceiling has grown to tens of percent: a pass there is not
  // evidence of a consistent width, and the notice says exactly that.
  const noisy = analyzeImage({ pixels: s20bHaloScene(100), width: 192, height: 192, dtype: "float32" });
  assert.equal(noisy.moments.suppressionReason, null, "the frame still releases - this is not a gate");
  const gate = noisy.aperture.gates.alphaConsistency;
  const ceiling = Math.max(gate.thresholdMajorPercent, gate.thresholdMinorPercent);
  assert.ok(ceiling > 10, `ceiling ${ceiling}`);
  const weak = warningsWithCode(noisy.warnings, "IMAGE_ALPHA_GATE_WEAK");
  assert.equal(weak.length, 1);
  assert.equal(weak[0].severity, "info");
  const message = weak[0].message as string;
  // The text carries BOTH ceilings and BOTH measured deltas, so the reader can
  // see the size of the window that was passed and by how much.
  assert.ok(message.includes(gate.thresholdMajorPercent.toFixed(1)), message);
  assert.ok(message.includes(gate.thresholdMinorPercent.toFixed(1)), message);
  assert.ok(message.includes((gate.deltaMajorPercent as number).toFixed(1)), message);
  assert.ok(message.includes((gate.deltaMinorPercent as number).toFixed(1)), message);
  assert.ok(message.includes("no discriminating power"), message);

  // The same scene at low noise is SUPPRESSED, so there is no released width
  // for the notice to qualify and it must stay away.
  const quiet = analyzeImage({ pixels: s20bHaloScene(0.5), width: 192, height: 192, dtype: "float32" });
  assert.equal(quiet.moments.suppressionReason, "alpha_inconsistent");
  assert.equal(warningsWithCode(quiet.warnings, "IMAGE_ALPHA_GATE_WEAK").length, 0);

  // A clean, well-resolved beam at a floor-level ceiling stays silent too.
  const clean = analyzeImage({
    pixels: gaussian2dPixels(192, 192, 95.5, 95.5, 11, 6, 0.4, 1000, 0),
    width: 192,
    height: 192,
    dtype: "float32",
  });
  assert.equal(clean.moments.suppressionReason, null);
  assert.equal(clean.aperture.gates.alphaConsistency.thresholdMajorPercent, 3);
  assert.equal(warningsWithCode(clean.warnings, "IMAGE_ALPHA_GATE_WEAK").length, 0);
});

test("S20 stage B: a released frame whose wing probes were cut short by the ROI says so", () => {
  const size = 512;
  const centre = 255.5;
  const pixels = new Array<number>(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      pixels[x + y * size] =
        1000 * Math.exp(-((dx * dx) / (2 * 64) + (dy * dy) / (2 * 36))) +
        0.5 * Math.exp(-((dx * dx) / (2 * 4096) + (dy * dy) / (2 * 2304)));
    }
  }
  const centredRoi = (side: number) => {
    const x0 = Math.round(centre - side / 2);
    return { x0, y0: x0, width: side, height: side };
  };

  const wide = analyzeImage({ pixels, width: size, height: size, dtype: "float32", roi: centredRoi(160) });
  assert.equal(wide.moments.suppressionReason, null);
  assert.deepEqual(wide.aperture.absorbedPower.availableProbeAlphas, [4, 6, 9]);
  assert.equal(
    warningsWithCode(wide.warnings, "IMAGE_WING_PROBE_REDUCED").length,
    0,
    "one long probe survives, so the reach is not reduced",
  );

  const tight = analyzeImage({ pixels, width: size, height: size, dtype: "float32", roi: centredRoi(140) });
  assert.equal(tight.moments.suppressionReason, null, "the reach notice is not a gate");
  assert.deepEqual(tight.aperture.absorbedPower.availableProbeAlphas, [4, 6]);
  assert.equal(tight.aperture.absorbedPower.maxAvailableProbeAlpha, 6);
  const reduced = warningsWithCode(tight.warnings, "IMAGE_WING_PROBE_REDUCED");
  assert.equal(reduced.length, 1);
  assert.equal(reduced[0].severity, "info");
  assert.ok((reduced[0].message as string).includes("lower bound"), String(reduced[0].message));

  // The lowered floor is what turns this frame's 0.1792 percent excess into a
  // statement instead of a silence: it used to sit under a 0.3 percent floor.
  assert.equal(tight.aperture.absorbedPower.high, true);
  assert.equal(warningsWithCode(tight.warnings, "IMAGE_ABSORBED_POWER").length, 1);
});

test("S20 stage B: tierCheck reports agreement, disagreement and the reachable unavailable branches", () => {
  // (1) EVALUATED, below threshold. A clean noise-free beam: the two tiers
  // agree, and the block now says so instead of leaving the reader to infer
  // agreement from a missing warning.
  const agree = analyzeImage({
    pixels: gaussian2dPixels(160, 160, 79.5, 79.5, 8, 6, 0.3, 1000, 0),
    width: 160,
    height: 160,
    dtype: "float32",
  });
  assert.equal(agree.moments.suppressionReason, null);
  assert.equal(agree.tierCheck.evaluated, true);
  assert.equal(agree.tierCheck.unavailableReason, null);
  assert.ok((agree.tierCheck.gapMajorPercent as number) < (agree.tierCheck.thresholdMajorPercent as number));
  assert.ok((agree.tierCheck.gapMinorPercent as number) < (agree.tierCheck.thresholdMinorPercent as number));
  assert.equal(warningsWithCode(agree.warnings, "IMAGE_TIER_DISAGREEMENT").length, 0);
  assert.equal(warningsWithCode(agree.warnings, "IMAGE_TIER_CHECK_UNAVAILABLE").length, 0);

  // (2) EVALUATED, above threshold. The absorbed-wing scene: the released
  // aperture width and the diagnostic ROI moments are far apart, the check
  // runs, and the block carries both the gap and the ceiling it cleared.
  const size = 512;
  const centre = 255.5;
  const wingPixels = new Array<number>(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      wingPixels[x + y * size] =
        1000 * Math.exp(-((dx * dx) / (2 * 64) + (dy * dy) / (2 * 36))) +
        0.5 * Math.exp(-((dx * dx) / (2 * 4096) + (dy * dy) / (2 * 2304)));
    }
  }
  const disagree = analyzeImage({ pixels: wingPixels, width: size, height: size, dtype: "float32" });
  assert.equal(disagree.moments.suppressionReason, null);
  assert.equal(disagree.tierCheck.evaluated, true);
  assert.equal(disagree.tierCheck.unavailableReason, null);
  assert.ok(
    (disagree.tierCheck.gapMajorPercent as number) > (disagree.tierCheck.thresholdMajorPercent as number),
    `gap ${disagree.tierCheck.gapMajorPercent} against ${disagree.tierCheck.thresholdMajorPercent}`,
  );
  assert.equal(warningsWithCode(disagree.warnings, "IMAGE_TIER_DISAGREEMENT").length, 1);
  assert.equal(warningsWithCode(disagree.warnings, "IMAGE_TIER_CHECK_UNAVAILABLE").length, 0);

  // (3) UNAVAILABLE, stage_a_invalid, on a RELEASED frame. A residual ramp
  // that leaves the stage-A covariance indefinite: the release continues, the
  // check disappears, and only the new notice says the released number went
  // out unchecked.
  const corners = [
    { x0: 0, y0: 0, width: 12, height: 9 },
    { x0: 96 - 12, y0: 0, width: 12, height: 9 },
    { x0: 0, y0: 72 - 9, width: 12, height: 9 },
    { x0: 96 - 12, y0: 72 - 9, width: 12, height: 9 },
  ];
  const ramp: number[] = new Array<number>(96 * 72);
  for (let y = 0; y < 72; y += 1) {
    for (let x = 0; x < 96; x += 1) {
      const dx = (x - 47.5) / 6;
      const dy = (y - 35.5) / 4;
      ramp[x + y * 96] = 1000 + 10000 * Math.exp(-0.5 * (dx * dx + dy * dy)) + 5 * (x - 47.5);
    }
  }
  const invalid = analyzeImage({
    pixels: ramp,
    width: 96,
    height: 72,
    dtype: "float32",
    background: { method: "rect-median", rects: corners },
    backgroundSigmaRects: corners,
  });
  assert.equal(invalid.moments.suppressionReason, null);
  assert.equal(invalid.tierCheck.evaluated, false);
  assert.equal(invalid.tierCheck.unavailableReason?.kind, "stage_a_invalid");
  assert.equal(
    (invalid.tierCheck.unavailableReason as { kind: "stage_a_invalid"; invalidReason: string | null }).invalidReason,
    "indefinite_covariance",
  );
  const unavailable = warningsWithCode(invalid.warnings, "IMAGE_TIER_CHECK_UNAVAILABLE");
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].severity, "info");
  assert.ok((unavailable[0].message as string).includes("indefinite_covariance"), String(unavailable[0].message));
  assert.ok(
    (unavailable[0].message as string).includes("not checked and found to agree"),
    String(unavailable[0].message),
  );

  // (4) UNAVAILABLE, sigma_exceeds_roi, on a RELEASED frame. A pedestal of 10
  // percent of the peak: the fit absorbs it, stage A does not, and 4 times the
  // stage-A major sigma no longer fits inside the 100 px ROI side.
  const wideStageA = analyzeImage({
    pixels: s20bPedestalScene(100),
    width: 100,
    height: 100,
    dtype: "float32",
  });
  assert.equal(wideStageA.moments.suppressionReason, null);
  assert.equal(wideStageA.momentsRoiDiagnostic.moments.valid, true);
  assert.equal(wideStageA.tierCheck.evaluated, false);
  assert.equal(wideStageA.tierCheck.unavailableReason?.kind, "sigma_exceeds_roi");
  const exceeds = wideStageA.tierCheck.unavailableReason as {
    kind: "sigma_exceeds_roi";
    sigmaMajorPx: number;
    shorterRoiSidePx: number;
  };
  assert.equal(exceeds.shorterRoiSidePx, 100);
  assert.ok(4 * exceeds.sigmaMajorPx >= 100, `4*sigma ${4 * exceeds.sigmaMajorPx}`);
  assert.equal(warningsWithCode(wideStageA.warnings, "IMAGE_TIER_CHECK_UNAVAILABLE").length, 1);

  // The same scene with a smaller pedestal keeps the check available, so this
  // is a measurement of the frame and not a standing property of the ROI size.
  const narrowStageA = analyzeImage({
    pixels: s20bPedestalScene(20),
    width: 100,
    height: 100,
    dtype: "float32",
  });
  assert.equal(narrowStageA.moments.suppressionReason, null);
  assert.equal(narrowStageA.tierCheck.evaluated, true);
  assert.equal(warningsWithCode(narrowStageA.warnings, "IMAGE_TIER_CHECK_UNAVAILABLE").length, 0);
});

test("S20 stage B: the centroid_outside_roi branch is reachable, and never on a released frame", () => {
  // A positive beam plus a narrow negative sink carrying 97.8 percent of its
  // power, about 1.2 px off centre: the signed weights drag the stage-A
  // centroid past the right edge of a 120 px frame while the covariance stays
  // positive definite, so the predicate refuses on the CENTROID branch rather
  // than the validity one, and the block reports that refusal.
  const width = 120;
  const height = 120;
  const sigma = 8;
  const xb = 71;
  const yb = 59.5;
  const sigmaN = 1;
  const n = 0.978;
  const margin = width - 1 - xb;
  const g = (margin * (1 - n) * 1.1) / n;
  const xn = xb - g;
  const amp = (n * 1000 * sigma * sigma) / (sigmaN * sigmaN);
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dy = y - yb;
      const dxb = x - xb;
      const dxn = x - xn;
      pixels[x + y * width] =
        1000 * Math.exp(-(dxb * dxb + dy * dy) / (2 * sigma * sigma)) -
        amp * Math.exp(-(dxn * dxn + dy * dy) / (2 * sigmaN * sigmaN));
    }
  }
  const result = analyzeImage({ pixels, width, height, dtype: "float32" });

  assert.equal(result.momentsRoiDiagnostic.moments.valid, true, "stage A is valid, so the branch is the centroid one");
  assert.ok((result.momentsRoiDiagnostic.moments.centroidXPx as number) > width - 1);
  assert.equal(result.tierCheck.evaluated, false);
  assert.equal(result.tierCheck.unavailableReason?.kind, "centroid_outside_roi");

  // And why this branch cannot appear on a RELEASED frame. A positive-weighted
  // centroid always lies inside its own bounding rectangle, so leaving the ROI
  // needs negative weights; pushing the centroid past an edge that the release
  // gates keep at least 6 fitted sigmas away needs a negative mass within a
  // few percent of the beam's own power, and that same mass leaves a residual
  // orders of magnitude above the release ceiling. Measured over 180 targeted
  // configurations of this family (sigma_n 0.5 to 5, mass fraction 0.9 to
  // 0.98, offset factor 1.02 to 4): 12 produce a valid stage A with the
  // centroid outside the ROI, and every one of the 12 is suppressed before it
  // can release. The notice is therefore correctly absent here.
  assert.notEqual(result.moments.suppressionReason, null);
  assert.equal(result.moments.stageB, null);
  assert.equal(warningsWithCode(result.warnings, "IMAGE_TIER_CHECK_UNAVAILABLE").length, 0);
});

test("S20 stage B: the three new codes are info severity and none of them moves a release", () => {
  // The whole stage in one assertion: take frames that carry the new codes and
  // confirm that not one of them changed a suppression decision, and that
  // every new code ships at info severity.
  const codes = new Set(["IMAGE_ALPHA_GATE_WEAK", "IMAGE_TIER_CHECK_UNAVAILABLE", "IMAGE_WING_PROBE_REDUCED"]);
  const frames = [
    analyzeImage({ pixels: s20bHaloScene(100), width: 192, height: 192, dtype: "float32" }),
    analyzeImage({ pixels: s20bPedestalScene(100), width: 100, height: 100, dtype: "float32" }),
    analyzeImage({
      // A wide beam on a frame that fits its 6-sigma release ellipse but not
      // the 9 and 12 sigma wing probes: the probe-reach notice with nothing
      // else wrong.
      pixels: gaussian2dPixels(300, 300, 149.5, 149.5, 20, 12, 0.3, 1000, 0),
      width: 300,
      height: 300,
      dtype: "float32",
    }),
  ];
  const seen = new Set<string>();
  for (const frame of frames) {
    assert.equal(frame.moments.suppressionReason, null, "every frame in this set releases");
    for (const item of frame.warnings) {
      const record = item as { code?: string; severity?: string };
      if (record.code !== undefined && codes.has(record.code)) {
        seen.add(record.code);
        assert.equal(record.severity, "info", `${record.code} must be info severity`);
      }
    }
  }
  assert.equal(seen.size, 3, `expected all three new codes across the set, saw ${[...seen].join(", ")}`);
});

function roundToF(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// S20 stage F — the physical orientation contrast (F7) and the exported
// ROI-geometry verdict (R-58).
// ---------------------------------------------------------------------------

test("S20 stage F: on an anisotropic pixel pitch the orientation test runs on the PHYSICAL contrast", () => {
  // The scene is a 12 x 6 px ellipse: q on the PIXEL covariance is
  // (4-1)/(4+1) = 0.6, which reads as a perfectly well determined major axis.
  // At a 2 / 4 um pitch the same beam is physically round (12*2 = 6*4), so its
  // released orientation angle is pure eigen-noise. The pixel-space test was
  // silent on exactly that frame.
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 80.2, 79.8, 12, 6, 0, 100, 0);
  const next = makeLcg(4242);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  // (a) no calibration: the pixel path, unchanged - the contrast is 0.60 and
  //     nothing is said.
  const uncalibrated = analyzeImage({ pixels, width, height, dtype: "float32" });
  assert.equal(uncalibrated.moments.suppressionReason, null);
  assert.equal(roundToF(uncalibrated.moments.stageB?.orientationContrastQ ?? Number.NaN, 4), 0.602);
  assert.equal(uncalibrated.moments.orientationContrastQPhysical, undefined);
  assert.equal(uncalibrated.momentsRoiDiagnostic.orientationContrastQPhysical, undefined);
  assert.equal(warningsWithCode(uncalibrated.warnings, "IMAGE_ORIENTATION_UNSTABLE").length, 0);

  // (b) 2 / 4 um pitch: physically round, and the warning now fires and quotes
  //     the number it actually tested.
  const anisotropic = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    calibration: { pixelPitchUmX: 2, pixelPitchUmY: 4 },
  });
  assert.equal(roundToF(anisotropic.moments.stageB?.orientationContrastQ ?? Number.NaN, 4), 0.602);
  assert.equal(roundToF(anisotropic.moments.orientationContrastQPhysical ?? Number.NaN, 5), 0.00367);
  const fired = warningsWithCode(anisotropic.warnings, "IMAGE_ORIENTATION_UNSTABLE");
  assert.equal(fired.length, 1);
  assert.equal(fired[0].severity, "info");
  assert.ok(
    String(fired[0].message).includes("physical orientation contrast q = 0.0037"),
    `message must quote the physical number it tested: ${fired[0].message}`,
  );
  assert.ok(!String(fired[0].message).includes("0.6019"), `message must not quote the pixel number: ${fired[0].message}`);

  // (c) a SQUARE pitch scales both covariance axes by the same factor, so the
  //     physical contrast equals the pixel one exactly and the verdict is the
  //     same as without a calibration. This is what makes the change a pure
  //     anisotropy fix rather than a new threshold.
  const square = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    calibration: { pixelPitchUmX: 5.2, pixelPitchUmY: 5.2 },
  });
  assert.equal(square.moments.orientationContrastQPhysical, square.moments.stageB?.orientationContrastQ);
  assert.equal(warningsWithCode(square.warnings, "IMAGE_ORIENTATION_UNSTABLE").length, 0);
});

test("S20 stage F: a physically round beam on a square pitch still fires, with the pixel wording", () => {
  // The pixel path must stay exactly as it was where nothing anisotropic is
  // going on: same trigger, same severity, same wording.
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 80.2, 79.8, 9, 9, 0, 100, 0);
  const next = makeLcg(4242);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);
  const result = analyzeImage({ pixels, width, height, dtype: "float32" });
  const fired = warningsWithCode(result.warnings, "IMAGE_ORIENTATION_UNSTABLE");
  assert.equal(fired.length, 1);
  assert.ok(
    String(fired[0].message).includes("(orientation contrast q ="),
    `uncalibrated wording must be unchanged: ${fired[0].message}`,
  );
});

test("S20 stage F: fits.gauss2d.geometryReleasable reports the ROI geometry verdict", () => {
  // Healthy released beam: the geometry is releasable and the physical block
  // exists, which is the same predicate seen from the other side.
  const width = 128;
  const height = 128;
  const healthy = gaussian2dPixels(width, height, 63.5, 63.5, 9, 6, 0.2, 2000, 0);
  const next = makeLcg(20260823);
  for (let i = 0; i < healthy.length; i += 1) healthy[i] += 5 * unitGaussian(next);
  const released = analyzeImage({
    pixels: healthy,
    width,
    height,
    dtype: "float32",
    calibration: { pixelPitchUmX: 5.2, pixelPitchUmY: 5.2 },
  });
  assert.equal(released.moments.suppressionReason, null);
  assert.equal(released.fits.gauss2d.geometryReleasable, true);
  assert.ok(released.fits.physical, "a releasable geometry yields the physical block");

  // Beam-free frame whose LM runs away: status "converged", a negative
  // amplitude and a centre far off the sensor. The verdict is false, and the
  // field is what a consumer reads instead of re-deriving the physics.
  const beamFree = new Array<number>(width * height).fill(100);
  const noise = makeLcg(18 * 7919);
  for (let i = 0; i < beamFree.length; i += 1) beamFree[i] += 20 * unitGaussian(noise);
  const degenerate = analyzeImage({ pixels: beamFree, width, height, dtype: "float32" });
  if (degenerate.fits.gauss2d.params !== null) {
    const params = degenerate.fits.gauss2d.params;
    const inside =
      params.amplitudeCounts > 0 &&
      params.centerXPx >= 0 &&
      params.centerXPx <= width - 1 &&
      params.centerYPx >= 0 &&
      params.centerYPx <= height - 1 &&
      params.sigmaMajorPx > 0 &&
      params.sigmaMajorPx < Math.max(width, height) &&
      params.sigmaMinorPx > 0 &&
      params.sigmaMinorPx < Math.max(width, height);
    assert.equal(degenerate.fits.gauss2d.geometryReleasable, inside);
  } else {
    assert.equal(degenerate.fits.gauss2d.geometryReleasable, false);
  }
});

// Deterministic mulberry32 + Box-Muller noise, bit-identical to the S20 repro
// corpus helper, so the runaway-fit scene below reproduces the archived one
// exactly rather than approximately.
function addBoxMullerNoise(pixels: number[], sigmaB: number, seed: number): void {
  let a = seed >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

test("S20 stage F: a runaway converged fit reports geometryReleasable false", () => {
  // The V3 scene class (archived as tests/repro-s20/s20-roi-from-fit.test.ts):
  // a beam whose centre sits far outside the sensor. The LM converges on a
  // plane-like solution with a NEGATIVE amplitude and a centre thousands of
  // pixels away - status "converged" is true and the geometry is still not
  // releasable, which is exactly the pair the new field separates. A consumer
  // that reads `converged` alone applies this geometry; one that reads
  // geometryReleasable does not.
  const size = 128;
  const pixels = new Array<number>(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 140;
      const dy = y - 64;
      pixels[y * size + x] = 5000 * Math.exp(-(dx * dx + dy * dy) / (2 * 144));
    }
  }
  addBoxMullerNoise(pixels, 5, 900 + 140 + 12);
  const result = analyzeImage({ pixels, width: size, height: size, dtype: "float32" });
  assert.equal(result.fits.gauss2d.status, "converged");
  assert.equal(result.fits.gauss2d.converged, true);
  const params = result.fits.gauss2d.params as { centerXPx: number; amplitudeCounts: number };
  assert.ok(params.centerXPx < -1000, `runaway centre ${params.centerXPx}`);
  assert.ok(params.amplitudeCounts < 0, `runaway amplitude ${params.amplitudeCounts}`);
  assert.equal(result.fits.gauss2d.geometryReleasable, false);
  assert.ok(!result.fits.physical, "no physical geometry is derived from an unreleasable geometry");
});

// ---------------------------------------------------------------------------
// S23 — background-reference overlap visibility.
// ---------------------------------------------------------------------------

test("S23: an applied background reference rectangle that overlaps the D4sigma beam ellipse is reported", () => {
  const width = 160;
  const height = 160;
  // A 44 px top-left reference box reaches the D4sigma ellipse of this beam;
  // the six-sigma release check still fits inside the full image, so this is a
  // released stage-B case rather than only a fit fallback.
  const pixels = gaussian2dPixels(width, height, 50, 50, 8, 5, 0, 1000, 10);
  const cornerRects = [
    { x0: 0, y0: 0, width: 44, height: 44 },
    { x0: 116, y0: 0, width: 44, height: 44 },
    { x0: 0, y0: 116, width: 44, height: 44 },
    { x0: 116, y0: 116, width: 44, height: 44 },
  ];
  const result = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "rect-median", rects: cornerRects },
  });

  assert.equal(result.background.method, "rect-median");
  assert.equal(result.moments.suppressionReason, null);
  const overlap = warningsWithCode(result.warnings, "IMAGE_BEAM_IN_BACKGROUND_REFERENCE");
  assert.equal(overlap.length, 1);
  assert.equal(overlap[0].severity, "info");
  assert.equal(
    overlap[0].message,
    "A background reference rectangle intersects the beam's 4-sigma ellipse; the background model may contain beam power.",
  );

  // The automatic method resolves to robust-plane corner boxes before the
  // check, and those resolved boxes are the reference geometry it must use.
  const autoPixels = gaussian2dPixels(width, height, 20, 20, 3, 2, 0, 1000, 10);
  const automatic = analyzeImage({ pixels: autoPixels, width, height, dtype: "float32", background: { method: "auto" } });
  assert.equal(automatic.background.method, "robust-plane");
  assert.ok(automatic.background.resolvedRects !== undefined);
  assert.equal(warningsWithCode(automatic.warnings, "IMAGE_BEAM_IN_BACKGROUND_REFERENCE").length, 1);
});

test("S23: background-reference overlap stays silent for clean, non-rectangle, and no-fit cases", () => {
  const width = 160;
  const height = 160;
  const cleanPixels = gaussian2dPixels(width, height, 80, 80, 9, 6, 0, 1000, 10);
  const cleanCornerRects = [
    { x0: 0, y0: 0, width: 16, height: 16 },
    { x0: 144, y0: 0, width: 16, height: 16 },
    { x0: 0, y0: 144, width: 16, height: 16 },
    { x0: 144, y0: 144, width: 16, height: 16 },
  ];

  for (const method of ["rect-median", "robust-plane"] as const) {
    const result = analyzeImage({
      pixels: cleanPixels,
      width,
      height,
      dtype: "float32",
      background: { method, rects: cleanCornerRects },
    });
    assert.equal(result.background.method, method);
    assert.equal(warningsWithCode(result.warnings, "IMAGE_BEAM_IN_BACKGROUND_REFERENCE").length, 0, method);
  }

  const darkPixels = new Array<number>(width * height).fill(10);
  const noReferenceConfigs = [
    { method: "none" } as const,
    { method: "manual-offset", offsetCounts: 10 } as const,
    { method: "dark-frame", darkPixels, darkWidth: width, darkHeight: height, darkDtype: "float32" } as const,
  ];
  for (const background of noReferenceConfigs) {
    const result = analyzeImage({ pixels: cleanPixels, width, height, dtype: "float32", background });
    assert.equal(warningsWithCode(result.warnings, "IMAGE_BEAM_IN_BACKGROUND_REFERENCE").length, 0, background.method);
  }

  // The rectangle model really applies, but a flat scene suppresses stage B
  // and the Gaussian fit does not converge. With no reliable ellipse, the
  // reference-overlap warning must not guess.
  const flat = analyzeImage({
    pixels: new Array<number>(width * height).fill(10),
    width,
    height,
    dtype: "float32",
    background: { method: "rect-median", rects: cleanCornerRects },
  });
  assert.equal(flat.background.method, "rect-median");
  assert.notEqual(flat.moments.suppressionReason, null);
  assert.notEqual(flat.fits.gauss2d.status, "converged");
  assert.equal(warningsWithCode(flat.warnings, "IMAGE_BEAM_IN_BACKGROUND_REFERENCE").length, 0);
});

test("S23: background-reference overlap follows the rotated major axis and catches a long-edge crossing", () => {
  const width = 160;
  const height = 160;
  const pixels = gaussian2dPixels(width, height, 80, 80, 10, 3, Math.PI / 4, 1000, 10);

  // At theta = pi/4 this box lies on the positive rotated major axis. Its
  // counterpart reflected across the horizontal image centre lies beyond the
  // narrow rotated minor axis, pinning pointIsInsideEllipse's sign convention.
  const alongMajor = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "rect-median", rects: [{ x0: 92, y0: 92, width: 4, height: 4 }] },
  });
  assert.equal(warningsWithCode(alongMajor.warnings, "IMAGE_BEAM_IN_BACKGROUND_REFERENCE").length, 1);
  const mirroredMinor = analyzeImage({
    pixels,
    width,
    height,
    dtype: "float32",
    background: { method: "rect-median", rects: [{ x0: 92, y0: 64, width: 4, height: 4 }] },
  });
  assert.equal(warningsWithCode(mirroredMinor.warnings, "IMAGE_BEAM_IN_BACKGROUND_REFERENCE").length, 0);

  // This one-pixel-high reference edge crosses a small, horizontal ellipse in
  // its middle. Eight fixed samples land at x = 57, 114, ..., 455 and all
  // miss its x = 238..262 crossing; the exact segment quadratic must fire.
  const longPixels = gaussian2dPixels(512, height, 250, 80, 12, 4, 0, 1000, 10);
  const longEdge = analyzeImage({
    pixels: longPixels,
    width: 512,
    height,
    dtype: "float32",
    background: { method: "rect-median", rects: [{ x0: 0, y0: 87, width: 512, height: 1 }] },
  });
  assert.equal(warningsWithCode(longEdge.warnings, "IMAGE_BEAM_IN_BACKGROUND_REFERENCE").length, 1);
});
