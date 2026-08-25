import assert from "node:assert/strict";
import test from "node:test";

import { computeImageDiagnostics } from "../../packages/image/src/diagnostics.ts";

function gaussianField(
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigmaPx: number,
  amplitude: number,
  base = 0,
): number[] {
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      pixels.push(base + amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * sigmaPx * sigmaPx)));
    }
  }
  return pixels;
}

// Deterministic inline LCG for reproducible noise fixtures.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Unit-variance noise from a uniform [0,1) draw: (u - 0.5) * sqrt(12).
function unitGaussian(next: () => number): number {
  return (next() - 0.5) * Math.sqrt(12);
}

function gaussianFieldAnisotropic(
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigmaMajorPx: number,
  sigmaMinorPx: number,
  amplitude: number,
): number[] {
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      pixels.push(
        amplitude * Math.exp(-(dx * dx) / (2 * sigmaMajorPx * sigmaMajorPx) - (dy * dy) / (2 * sigmaMinorPx * sigmaMinorPx)),
      );
    }
  }
  return pixels;
}

test("S18a baseline min/max/zero/negative/dynamicRange on a hand-built 4x4 array are exact", () => {
  const pixels = [0, 1, 2, -1, 3, 10, 4, -2, 5, 6, 7, 8, 9, 1, 1, 1];
  const d = computeImageDiagnostics({ pixels, width: 4, height: 4, dtype: "float32" });
  assert.equal(d.pixelCount, 16);
  assert.equal(d.finiteCount, 16);
  assert.equal(d.nonFiniteCount, 0);
  assert.equal(d.minValue, -2);
  assert.equal(d.maxValue, 10);
  assert.equal(d.dynamicRange, 12);
  assert.equal(d.zeroCount, 1);
  assert.equal(d.negativeCount, 2);
  // sorted finite values: -2,-1,0,1,1,1,1,2,3,4,5,6,7,8,9,10
  // even count -> median = (2 + 3) / 2 = 2.5; MAD median = 2.5
  assert.equal(d.medianValue, 2.5);
  assert.ok(Math.abs(d.madSigmaValue - 1.4826 * 2.5) < 1e-12, String(d.madSigmaValue));
});

test("S18a non-finite values are excluded from all statistics", () => {
  const clean = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8];
  const pixels = clean.slice();
  pixels[0] = Number.NaN;
  pixels[1] = Number.POSITIVE_INFINITY;
  pixels[2] = Number.NEGATIVE_INFINITY;
  const d = computeImageDiagnostics({ pixels, width: 8, height: 8, dtype: "float32" });
  assert.equal(d.pixelCount, 64);
  assert.equal(d.nonFiniteCount, 3);
  assert.equal(d.finiteCount, 61);
  assert.equal(d.minValue, 1);
  assert.equal(d.maxValue, 8);
  assert.equal(d.dynamicRange, 7);
  assert.equal(d.zeroCount, 0);
  assert.equal(d.negativeCount, 0);
  const histogramSum = d.histogram.counts.reduce((sum, count) => sum + count, 0);
  assert.equal(histogramSum, 61);
});

test("S18a saturation counts follow the uint8 limit and the float config limit", () => {
  const uint = new Uint8Array([0, 255, 254, 255, 200, 255, 100, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const d = computeImageDiagnostics({ pixels: uint, width: 4, height: 4, dtype: "uint8" });
  assert.equal(d.saturationLimitCounts, 255);
  assert.equal(d.saturatedCount, 3);
  assert.equal(d.saturatedFraction, 3 / 16);

  const floats = [0.5, 1.0, 1.0, 2.0];
  const withoutLimit = computeImageDiagnostics({ pixels: floats, width: 2, height: 2, dtype: "float32" });
  assert.equal(withoutLimit.saturationLimitCounts, null);
  assert.equal(withoutLimit.saturatedCount, 0);
  assert.equal(withoutLimit.saturatedFraction, 0);

  const withLimit = computeImageDiagnostics({ pixels: floats, width: 2, height: 2, dtype: "float32" }, { floatSaturationLimitCounts: 1.0 });
  assert.equal(withLimit.saturationLimitCounts, 1.0);
  assert.equal(withLimit.saturatedCount, 3);
  assert.equal(withLimit.saturatedFraction, 0.75);
});

test("S18a a single spike on a flat background is a hot-pixel candidate", () => {
  const pixels: number[] = [];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      pixels.push((x + y) % 2 === 0 ? 100 : 101);
    }
  }
  pixels[4 + 4 * 16] = 1000;
  const d = computeImageDiagnostics({ pixels, width: 16, height: 16, dtype: "float32" });
  assert.equal(d.hotPixelCandidateCount, 1);
});

test("S18a a broad smooth gaussian bump yields zero hot-pixel candidates", () => {
  const pixels = gaussianField(32, 32, 15.5, 15.5, 10, 100, 100);
  const d = computeImageDiagnostics({ pixels, width: 32, height: 32, dtype: "float32" });
  assert.equal(d.hotPixelCandidateCount, 0, `hotPixelCandidateCount ${d.hotPixelCandidateCount}, madSigma ${d.madSigmaValue}`);
});

test("S18a edge touch is false for an interior peak and true for a rim peak", () => {
  const centered = gaussianField(32, 32, 15.5, 15.5, 2, 1, 0);
  const dCentered = computeImageDiagnostics({ pixels: centered, width: 32, height: 32, dtype: "float32" });
  assert.equal(dCentered.edgeTouch, false);

  const rim = gaussianField(32, 32, 0, 0, 2, 1, 0);
  const dRim = computeImageDiagnostics({ pixels: rim, width: 32, height: 32, dtype: "float32" });
  assert.equal(dRim.edgeTouch, true);
});

test("S18 review G5: IMAGE_EDGE_TOUCH is no longer a bare noise detector at SNR 20, and still fires for a beam genuinely near the border", () => {
  // Confirmed defect: (rimMax - median) > EDGE_TOUCH_FRACTION * (max -
  // median) has no noise term, so at SNR 20 the rim ring's OWN noise
  // maximum clears 10 percent of (max - median) almost every time - the
  // review measured 99.5 percent of clean centred beams falsely touching
  // (rim >= 7 sigma away). The fix adds an extreme-value floor:
  // robustSigma * (sqrt(2*ln(rimPixelCount)) + margin), so the rim must
  // clear whichever of the fraction test or the noise-aware floor is
  // larger.
  const width = 160;
  const height = 100;
  const sigmaMajor = 11;
  const sigmaMinor = 6;
  const amplitude = 100;
  const noiseSigma = amplitude / 20; // SNR 20
  const seed = 20260819;

  // Clean, centred beam (border >> sigma away on every side): must NOT
  // touch. Verified robust over 50 independent seeds during calibration
  // (0/50 false positives); this test pins one fixed, deterministic seed.
  const centred = gaussianFieldAnisotropic(width, height, 80, 50, sigmaMajor, sigmaMinor, amplitude);
  const centredNext = makeLcg(seed);
  for (let i = 0; i < centred.length; i += 1) centred[i] += noiseSigma * unitGaussian(centredNext);
  const dCentred = computeImageDiagnostics({ pixels: centred, width, height, dtype: "float32" });
  assert.equal(dCentred.edgeTouch, false, `rimMax ${dCentred.rimMaxValue} median ${dCentred.medianValue} max ${dCentred.maxValue}`);

  // The same beam, shifted so its centre sits 2*sigmaMinor (12 px) from the
  // left border: a genuine truncation, not noise. Must still fire. Also
  // verified robust over 50 independent seeds (0/50 misses).
  const nearBorder = gaussianFieldAnisotropic(width, height, 2 * sigmaMinor, 50, sigmaMajor, sigmaMinor, amplitude);
  const nearBorderNext = makeLcg(seed);
  for (let i = 0; i < nearBorder.length; i += 1) nearBorder[i] += noiseSigma * unitGaussian(nearBorderNext);
  const dNearBorder = computeImageDiagnostics({ pixels: nearBorder, width, height, dtype: "float32" });
  assert.equal(dNearBorder.edgeTouch, true, `rimMax ${dNearBorder.rimMaxValue} median ${dNearBorder.medianValue} max ${dNearBorder.maxValue}`);
});

test("S18 review G6: a clipped plateau below the dtype limit is flagged clippingSuspect; a smooth beam and a properly saturated scene are not", () => {
  // A 12-bit sensor clipping at 4095, stored in uint16 (dtype limit 65535):
  // plainSaturatedFraction never sees this (4095 << 65535), but many finite
  // pixels tie at the exact plateau value.
  const width = 64;
  const height = 64;
  const cx = 32;
  const cy = 32;
  const sigma = 8;
  const clipAt = 4095;
  const clipped = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const value = 8000 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      clipped[x + y * width] = Math.min(Math.round(value), clipAt);
    }
  }
  const dClipped = computeImageDiagnostics({ pixels: clipped, width, height, dtype: "uint16" });
  assert.equal(dClipped.maxValue, clipAt);
  assert.ok(dClipped.maxValueCount > 8, `maxValueCount ${dClipped.maxValueCount}`);
  assert.equal(dClipped.clippingSuspect, true);
  assert.equal(dClipped.saturatedFraction, 0, "4095 must not trip the 65535 dtype saturation limit");

  // A clean (float) Gaussian: the maximum is a unique pixel (count 1), so
  // the count floor never trips.
  const clean = gaussianField(width, height, cx, cy, sigma, 1000);
  const dClean = computeImageDiagnostics({ pixels: clean, width, height, dtype: "float32" });
  assert.equal(dClean.maxValueCount, 1);
  assert.equal(dClean.clippingSuspect, false);

  // A scene properly saturated AT the uint16 dtype limit (65535): the
  // disjointness guard (maximum must sit below 90 percent of the limit)
  // keeps this on the plain IMAGE_SATURATION side only - clippingSuspect
  // stays false even though many pixels are tied at the maximum.
  const saturated = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const value = 100000 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      saturated[x + y * width] = Math.min(Math.round(value), 65535);
    }
  }
  const dSaturated = computeImageDiagnostics({ pixels: saturated, width, height, dtype: "uint16" });
  assert.equal(dSaturated.maxValue, 65535);
  assert.ok(dSaturated.maxValueCount > 8, `maxValueCount ${dSaturated.maxValueCount}`);
  assert.ok(dSaturated.saturatedFraction > 0, "must trip the plain saturation check");
  assert.equal(dSaturated.clippingSuspect, false, "a proper full-range saturation must not also carry clippingSuspect");
});

test("S18a pure LCG noise frame with no beam is not an edge touch", () => {
  const width = 100;
  const height = 100;
  const next = makeLcg(42);
  const pixels: number[] = [];
  for (let i = 0; i < width * height; i += 1) {
    pixels.push(10 + next() * 10);
  }
  const d = computeImageDiagnostics({ pixels, width, height, dtype: "float32" });
  assert.equal(d.edgeTouch, false);
});

test("S18a interior-peak truncated beam reports edgeTouch true", () => {
  const pixels = gaussianField(64, 64, 5, 32, 10, 100, 0);
  const d = computeImageDiagnostics({ pixels, width: 64, height: 64, dtype: "float32" });
  assert.equal(d.edgeTouch, true);
});

test("S18a peak directly on the border reports edgeTouch true", () => {
  const pixels = gaussianField(64, 64, 0, 32, 10, 100, 0);
  const d = computeImageDiagnostics({ pixels, width: 64, height: 64, dtype: "float32" });
  assert.equal(d.edgeTouch, true);
});

test("S18a clean interior beam reports edgeTouch false", () => {
  const pixels = gaussianField(64, 64, 32, 32, 6, 100, 0);
  const d = computeImageDiagnostics({ pixels, width: 64, height: 64, dtype: "float32" });
  assert.equal(d.edgeTouch, false);
});

test("S18a column-periodic pattern wider than the exact robust-stats limit reports the pattern MAD scale", () => {
  const width = 2048;
  const height = 1024;
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[x + y * width] = 100 + (x % 4) * 50;
    }
  }
  const d = computeImageDiagnostics({ pixels, width, height, dtype: "float32" });
  // Four-level distribution values: 100, 150, 200, 250. The MAD of the four
  // levels is 50, so the scaled robust sigma is 1.4826 * 50. The coprime-stride
  // subsample retains the pattern's MAD instead of aliasing it to zero.
  assert.ok(Math.abs(d.madSigmaValue - 1.4826 * 50) < 1e-9, String(d.madSigmaValue));
  assert.ok(d.madSigmaValue > 0, "pattern robust sigma must not collapse to zero");
});

test("S18a two well-separated peaks are counted as local maxima", () => {
  const first = gaussianField(32, 32, 8, 16, 2, 100, 0);
  const second = gaussianField(32, 32, 24, 16, 2, 100, 0);
  const pixels = first.map((value, index) => value + second[index]);
  const d = computeImageDiagnostics({ pixels, width: 32, height: 32, dtype: "float32" });
  assert.equal(d.localMaximaCount, 2, String(d.localMaximaCount));
});

test("S18a histogram counts sum to finiteCount and maxValue lands in the last bin", () => {
  const pixels = [0, 1, Number.NaN, 10, 5.5, 2, -4, 7];
  const d = computeImageDiagnostics({ pixels, width: 4, height: 2, dtype: "float32" });
  const histogramSum = d.histogram.counts.reduce((sum, count) => sum + count, 0);
  assert.equal(histogramSum, d.finiteCount);
  assert.equal(d.histogram.binCount, 256);
  assert.equal(d.histogram.minValue, -4);
  assert.equal(d.histogram.maxValue, 10);
  const binWidth = d.histogram.binWidthCounts;
  const maxBin = Math.min(255, Math.floor((d.maxValue - d.minValue) / binWidth));
  assert.equal(maxBin, 255);
  assert.ok(d.histogram.counts[255] >= 1, String(d.histogram.counts[255]));
});

test("S18a repeated computation on the same input is deterministic", () => {
  const pixels = [1, Number.NaN, 3, 4, 0, -2, 7, Number.POSITIVE_INFINITY, 9, 2, 2, 8, 5, 6, 3, 4];
  const first = computeImageDiagnostics({ pixels, width: 4, height: 4, dtype: "float32" });
  const second = computeImageDiagnostics({ pixels, width: 4, height: 4, dtype: "float32" });
  assert.deepEqual(first, second);
});

test("S18a pixel count mismatch raises a RangeError", () => {
  assert.throws(
    () => computeImageDiagnostics({ pixels: [1, 2, 3], width: 2, height: 2, dtype: "uint8" }),
    /does not match width\*height/,
  );
});
