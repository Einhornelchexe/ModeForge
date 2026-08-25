import assert from "node:assert/strict";
import test from "node:test";

import type { BackgroundRect } from "../../packages/image/src/background.ts";
import {
  computeEllipseMoments,
  computeRectMoments,
  computeSubpixelPeak,
  peakCentroidDistancePx,
  type ImageMoments,
} from "../../packages/image/src/moments.ts";

// Analytical rotated elliptical Gaussian synthesizer (Plan v5 section 5):
// I = exp(-(u^2/(2*sx^2) + v^2/(2*sy^2))) with u/v the coordinates rotated
// by theta about (centerX, centerY).
function gaussianPixels(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  sigmaX: number,
  sigmaY: number,
  theta: number,
): number[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const pixels: number[] = new Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const exponent = (u * u) / (2 * sigmaX * sigmaX) + (v * v) / (2 * sigmaY * sigmaY);
      pixels[x + y * width] = Math.exp(-exponent);
    }
  }
  return pixels;
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

// Only the derived scalar fields are compared here so that the
// finitePixelCount difference itself can be asserted separately.
function comparableFields(m: ImageMoments): Array<number | string | boolean | null> {
  return [
    m.valid,
    m.invalidReason,
    m.pixelCount,
    m.sumCounts,
    m.absSumCounts,
    m.centroidXPx,
    m.centroidYPx,
    m.covXxPx2,
    m.covYyPx2,
    m.covXyPx2,
    m.lambdaMajorPx2,
    m.lambdaMinorPx2,
    m.thetaRad,
    m.sigmaMajorPx,
    m.sigmaMinorPx,
    m.d4SigmaMajorPx,
    m.d4SigmaMinorPx,
    m.orientationContrastQ,
  ];
}

test("S18a rect moments recover centroid, sigmas, theta and q of a rotated elliptical Gaussian", () => {
  const width = 96;
  const height = 96;
  const centerX = 47.3;
  const centerY = 44.8;
  const sigmaX = 6;
  const sigmaY = 3.5;
  const theta = 0.6;
  const pixels = gaussianPixels(width, height, centerX, centerY, sigmaX, sigmaY, theta);
  const rect: BackgroundRect = { x0: 0, y0: 0, width, height };
  const result = computeRectMoments({ values: pixels, width, height }, rect);
  assert.equal(result.valid, true);
  assert.equal(result.invalidReason, null);
  assert.ok(Math.abs(result.centroidXPx! - centerX) < 1e-6, `centroidX ${result.centroidXPx} vs ${centerX}`);
  assert.ok(Math.abs(result.centroidYPx! - centerY) < 1e-6, `centroidY ${result.centroidYPx} vs ${centerY}`);
  assert.ok(relativeError(result.sigmaMajorPx!, sigmaX) < 2e-3, `sigmaMajor ${result.sigmaMajorPx} vs ${sigmaX}`);
  assert.ok(relativeError(result.sigmaMinorPx!, sigmaY) < 2e-3, `sigmaMinor ${result.sigmaMinorPx} vs ${sigmaY}`);
  assert.ok(Math.abs(result.thetaRad! - theta) < 2e-3, `theta ${result.thetaRad} vs ${theta}`);
  const qExpected = (sigmaX * sigmaX - sigmaY * sigmaY) / (sigmaX * sigmaX + sigmaY * sigmaY);
  assert.ok(
    Math.abs(result.orientationContrastQ! - qExpected) < 2e-3,
    `q ${result.orientationContrastQ} vs ${qExpected}`,
  );
});

test("S18a circular Gaussian moments have vanishing q and a theta in [0, pi)", () => {
  const width = 64;
  const height = 64;
  const pixels = gaussianPixels(width, height, 31.5, 31.5, 5, 5, 0.3);
  const rect: BackgroundRect = { x0: 0, y0: 0, width, height };
  const result = computeRectMoments({ values: pixels, width, height }, rect);
  assert.equal(result.valid, true);
  assert.ok(result.orientationContrastQ! < 1e-6, `q ${result.orientationContrastQ}`);
  assert.ok(result.thetaRad! >= 0 && result.thetaRad! < Math.PI, `theta ${result.thetaRad}`);
});

test("S18a Gaussian with axis ratio 1.3 yields the analytical q", () => {
  const width = 96;
  const height = 96;
  const sigmaY = 5;
  const sigmaX = 1.3 * sigmaY;
  const pixels = gaussianPixels(width, height, 48.2, 47.9, sigmaX, sigmaY, -0.4);
  const rect: BackgroundRect = { x0: 0, y0: 0, width, height };
  const result = computeRectMoments({ values: pixels, width, height }, rect);
  assert.equal(result.valid, true);
  // 0.256637 is (1.3^2 - 1) / (1.3^2 + 1) = 0.69 / 2.69.
  assert.ok(
    Math.abs(result.orientationContrastQ! - 0.256637) < 1e-3,
    `q ${result.orientationContrastQ} vs 0.256637`,
  );
});

test("S18a validity predicate rejects zero sum and background-dominated sets", () => {
  const zero = new Float64Array(4 * 4);
  const zeroResult = computeRectMoments(
    { values: zero, width: 4, height: 4 },
    { x0: 0, y0: 0, width: 4, height: 4 },
  );
  assert.equal(zeroResult.valid, false);
  assert.equal(zeroResult.invalidReason, "nonpositive_sum");
  assert.equal(zeroResult.sumCounts, 0);
  assert.equal(zeroResult.absSumCounts, 0);
  assert.equal(zeroResult.pixelCount, 16);
  assert.equal(zeroResult.finitePixelCount, 16);
  assert.equal(zeroResult.centroidXPx, null);
  assert.equal(zeroResult.covXxPx2, null);
  assert.equal(zeroResult.sigmaMajorPx, null);
  assert.equal(zeroResult.sigmaMinorPx, null);
  assert.equal(zeroResult.d4SigmaMajorPx, null);
  assert.equal(zeroResult.d4SigmaMinorPx, null);
  assert.equal(zeroResult.thetaRad, null);
  assert.equal(zeroResult.lambdaMajorPx2, null);
  assert.equal(zeroResult.lambdaMinorPx2, null);
  assert.equal(zeroResult.orientationContrastQ, null);

  // Net sum positive but far below 1% of the absolute sum, exactly at the
  // spec's background-domination example: large +/- noise, small netto.
  const dominatedValues = new Float64Array([100, -99, 100, -99]);
  const dominated = computeRectMoments(
    { values: dominatedValues, width: 2, height: 2 },
    { x0: 0, y0: 0, width: 2, height: 2 },
  );
  assert.equal(dominated.valid, false);
  assert.equal(dominated.invalidReason, "background_dominated");
  assert.ok(dominated.sumCounts > 0);
  assert.ok(dominated.sumCounts < 0.01 * dominated.absSumCounts);
  assert.equal(dominated.sumCounts, 2);
  assert.equal(dominated.absSumCounts, 398);
  assert.equal(dominated.centroidXPx, null);
  assert.equal(dominated.sigmaMinorPx, null);
});

test("S18a non-finite pixels are skipped and leave every accumulation unchanged", () => {
  const rect: BackgroundRect = { x0: 0, y0: 0, width: 3, height: 3 };
  const base = new Float64Array([
    1, 2, 3, 0,
    5, 6, 7, 8,
    9, 10, 11, 12,
    13, 14, 15, 16,
  ]);
  const withNonFinite = base.slice();
  withNonFinite[0] = Number.NaN;
  withNonFinite[5] = Number.POSITIVE_INFINITY;
  withNonFinite[10] = Number.NEGATIVE_INFINITY;
  const clean = base.slice();
  clean[0] = 0;
  clean[5] = 0;
  clean[10] = 0;

  const dirty = computeRectMoments({ values: withNonFinite, width: 4, height: 4 }, rect);
  const reference = computeRectMoments({ values: clean, width: 4, height: 4 }, rect);
  assert.equal(dirty.valid, true);
  assert.equal(reference.valid, true);
  assert.deepStrictEqual(comparableFields(dirty), comparableFields(reference));
  assert.equal(dirty.finitePixelCount, 6);
  assert.equal(reference.finitePixelCount, 9);
  assert.equal(dirty.pixelCount, 9);
  assert.equal(reference.pixelCount, 9);
});

test("S18a a thin line is valid with sigmaMinor 0, d4SigmaMinor 0 and q 1", () => {
  const width = 8;
  const height = 8;
  const lineImage = new Float64Array(width * height);
  for (let x = 0; x < width; x += 1) lineImage[x + 3 * width] = 5;
  const result = computeRectMoments(
    { values: lineImage, width, height },
    { x0: 0, y0: 0, width, height },
  );
  assert.equal(result.valid, true);
  assert.equal(result.invalidReason, null);
  assert.equal(result.centroidYPx, 3);
  assert.ok(result.sigmaMinorPx !== null && result.sigmaMinorPx === 0);
  assert.equal(result.d4SigmaMinorPx, 0);
  assert.equal(result.orientationContrastQ, 1);
  assert.ok(result.lambdaMinorPx2 !== null && result.lambdaMinorPx2 === 0);
});

test("S18a ellipse moments equal rect moments when the ellipse generously covers the whole signal", () => {
  const width = 96;
  const height = 96;
  const pixels = gaussianPixels(width, height, 47.3, 44.8, 6, 3.5, 0.6);
  const rect: BackgroundRect = { x0: 0, y0: 0, width, height };
  const rectResult = computeRectMoments({ values: pixels, width, height }, rect);
  const ellipseResult = computeEllipseMoments(
    { values: pixels, width, height },
    { centerXPx: 47.3, centerYPx: 44.8, semiMajorPx: 100, semiMinorPx: 100, thetaRad: 0.6 },
  );
  assert.equal(ellipseResult.valid, true);
  assert.ok(
    relativeError(ellipseResult.centroidXPx!, rectResult.centroidXPx!) < 1e-9,
    `centroidX ${ellipseResult.centroidXPx} vs ${rectResult.centroidXPx}`,
  );
  assert.ok(
    relativeError(ellipseResult.centroidYPx!, rectResult.centroidYPx!) < 1e-9,
    `centroidY ${ellipseResult.centroidYPx} vs ${rectResult.centroidYPx}`,
  );
  assert.ok(
    relativeError(ellipseResult.sigmaMajorPx!, rectResult.sigmaMajorPx!) < 1e-9,
    `sigmaMajor ${ellipseResult.sigmaMajorPx} vs ${rectResult.sigmaMajorPx}`,
  );
  assert.ok(
    relativeError(ellipseResult.sigmaMinorPx!, rectResult.sigmaMinorPx!) < 1e-9,
    `sigmaMinor ${ellipseResult.sigmaMinorPx} vs ${rectResult.sigmaMinorPx}`,
  );
});

test("S18a ellipse moments reproduce the analytical alpha=4 aperture truncation factor", () => {
  const width = 128;
  const height = 128;
  const sigma = 10;
  const pixels = gaussianPixels(width, height, 64, 64, sigma, sigma, 0);
  const result = computeEllipseMoments(
    { values: pixels, width, height },
    { centerXPx: 64, centerYPx: 64, semiMajorPx: 4 * sigma, semiMinorPx: 4 * sigma, thetaRad: 0 },
  );
  assert.equal(result.valid, true);
  // Second-moment ratio of a circular Gaussian truncated at radius 4*sigma.
  // The derived truncation factor is 0.9986568, NOT 1.0 - asserting against
  // 1.0 would miss the aperture suppression this oracle exists for.
  const sigmaTrue = sigma * 0.9986568;
  assert.ok(
    relativeError(result.sigmaMajorPx!, sigmaTrue) < 5e-3,
    `sigmaMajor ${result.sigmaMajorPx} vs ${sigmaTrue}`,
  );
  assert.ok(
    relativeError(result.sigmaMinorPx!, sigmaTrue) < 5e-3,
    `sigmaMinor ${result.sigmaMinorPx} vs ${sigmaTrue}`,
  );
  assert.ok(result.sigmaMajorPx! < sigma, `sigmaMajor ${result.sigmaMajorPx} must sit below the untruncated ${sigma}`);
});

test("S18a an ellipse that overhangs the image counts only image pixels and never throws", () => {
  const width = 16;
  const height = 16;
  const values = new Array<number>(width * height).fill(1);
  const centerXPx = 0;
  const centerYPx = 0;
  const radiusPx = 5;
  let expected = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerXPx;
      const dy = y - centerYPx;
      if (dx * dx + dy * dy <= radiusPx * radiusPx) expected += 1;
    }
  }
  assert.ok(expected < width * height, "test setup: the ellipse must only cover part of the image");
  assert.ok(expected > 0, "test setup: the ellipse must reach into the image");

  const result = computeEllipseMoments(
    { values, width, height },
    { centerXPx, centerYPx, semiMajorPx: radiusPx, semiMinorPx: radiusPx, thetaRad: 0 },
  );
  assert.equal(result.valid, true);
  assert.equal(result.invalidReason, null);
  assert.equal(result.pixelCount, expected);
  assert.equal(result.finitePixelCount, expected);
});

test("S18a subpixel peak fits the exact 3-point parabola (dx = dy = 0.25)", () => {
  const values = new Float64Array([
    0, 1, 0,
    1, 4, 3,
    0, 3, 0,
  ]);
  const result = computeSubpixelPeak({ values, width: 3, height: 3 }, 1, 1);
  assert.deepStrictEqual(result, { peak: { xPx: 1.25, yPx: 1.25 }, suppressedReason: null });
});

test("S18a subpixel peak suppresses a peak on the image border as edge", () => {
  const values = new Float64Array(9).fill(1);
  const result = computeSubpixelPeak({ values, width: 3, height: 3 }, 0, 1);
  assert.deepStrictEqual(result, { peak: null, suppressedReason: "edge" });
});

test("S18a subpixel peak suppresses a non-concave plateau", () => {
  const values = new Float64Array(9).fill(1);
  const result = computeSubpixelPeak({ values, width: 3, height: 3 }, 1, 1);
  assert.deepStrictEqual(result, { peak: null, suppressedReason: "non_concave" });
});

test("S18a subpixel peak suppresses a saturated 3x3 neighborhood", () => {
  const width = 5;
  const height = 5;
  const values = new Float64Array(width * height).fill(2);
  values[6] = 4; // discrete peak at index 6 = (x=1, y=1)
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const index = 1 + dx + (1 + dy) * width;
      if (index !== 6 && index !== 0) values[index] = values[index] - 2; // keep the center strictly concave
    }
  }
  values[0] = 0; // 3x3 neighbour at (0, 0) - this pixel is saturated
  const result = computeSubpixelPeak({ values, width, height }, 1, 1, (index) => index === 0);
  assert.deepStrictEqual(result, { peak: null, suppressedReason: "saturated_neighborhood" });
});

test("S18a subpixel peak suppresses a vertex further than half a pixel away", () => {
  // Centered at x=1, the x-samples are left=1, center=3, right=4.
  // Numerator 0.5*(1-4) = -1.5, denominator 1-6+4 = -1 -> shift +1.5 > 0.5.
  const values = new Float64Array([
    0, 1, 0,
    0, 3, 4,
    0, 1, 0,
  ]);
  const result = computeSubpixelPeak({ values, width: 3, height: 3 }, 1, 1);
  assert.deepStrictEqual(result, { peak: null, suppressedReason: "shift_too_large" });
});

test("S18a subpixel peak suppresses a non-finite neighbor as non-concave", () => {
  const values = new Float64Array([
    0, 1, 0,
    Number.NaN, 4, 3,
    0, 3, 0,
  ]);
  const result = computeSubpixelPeak({ values, width: 3, height: 3 }, 1, 1);
  assert.deepStrictEqual(result, { peak: null, suppressedReason: "non_concave" });
});

test("S18a peakCentroidDistancePx computes the exact 3-4-5 distance", () => {
  assert.equal(peakCentroidDistancePx({ xPx: 0, yPx: 0 }, { xPx: 3, yPx: 4 }), 5);
  assert.equal(peakCentroidDistancePx({ xPx: 3, yPx: 4 }, { xPx: 0, yPx: 0 }), 5);
});

test("S18a rect and ellipse moments are deterministic across repeated runs", () => {
  const width = 32;
  const height = 32;
  const pixels = gaussianPixels(width, height, 16.4, 15.1, 5, 3, -0.7);
  const rect: BackgroundRect = { x0: 2, y0: 3, width: 28, height: 26 };
  const rectA = computeRectMoments({ values: pixels, width, height }, rect);
  const rectB = computeRectMoments({ values: pixels, width, height }, rect);
  assert.deepStrictEqual(rectA, rectB);

  const ellipse = { centerXPx: 16.4, centerYPx: 15.1, semiMajorPx: 30, semiMinorPx: 20, thetaRad: -0.7 };
  const ellipseA = computeEllipseMoments({ values: pixels, width, height }, ellipse);
  const ellipseB = computeEllipseMoments({ values: pixels, width, height }, ellipse);
  assert.deepStrictEqual(ellipseA, ellipseB);
});

test("S18a an exactly collinear slanted pixel set is a valid line despite eigenvalue cancellation", () => {
  // lambdaMinor = mean - disc lands a few ulp below the exact 0 for slanted
  // lines (measured -2.22e-16 on this fixture); the tolerance clamp must
  // rescue the contractual line-degenerate case.
  const width = 3;
  const height = 5;
  const values = new Array<number>(width * height).fill(0);
  values[0 + 0 * width] = 1;
  values[1 + 2 * width] = 1;
  values[2 + 4 * width] = 1;
  const moments = computeRectMoments({ values, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(moments.valid, true);
  assert.equal(moments.invalidReason, null);
  assert.equal(moments.lambdaMinorPx2, 0);
  assert.equal(moments.sigmaMinorPx, 0);
  assert.equal(moments.d4SigmaMinorPx, 0);
  assert.equal(moments.orientationContrastQ, 1);

  // Same property on a longer slanted line with non-uniform weights in a
  // larger frame (the old rejection was frame-position dependent).
  const bigWidth = 128;
  const bigHeight = 128;
  const bigValues = new Array<number>(bigWidth * bigHeight).fill(0);
  for (let t = 0; t < 9; t += 1) {
    bigValues[30 + t + (40 + 2 * t) * bigWidth] = 3 + (t % 3);
  }
  const bigMoments = computeRectMoments(
    { values: bigValues, width: bigWidth, height: bigHeight },
    { x0: 0, y0: 0, width: bigWidth, height: bigHeight },
  );
  assert.equal(bigMoments.valid, true, `reason ${bigMoments.invalidReason}`);
  assert.equal(bigMoments.orientationContrastQ, 1);
});

test("S18a genuinely indefinite covariance from signed weights is still rejected", () => {
  // Checkerboard of signed weights: sum 2 > 0.01*absSum 6 passes the sum
  // gates, but covXy 0.75 against covXx = covYy = 0.25 gives lambdaMinor
  // -0.5, far beyond the cancellation tolerance.
  const values = [2, -1, -1, 2];
  const moments = computeRectMoments({ values, width: 2, height: 2 }, { x0: 0, y0: 0, width: 2, height: 2 });
  assert.equal(moments.valid, false);
  assert.equal(moments.invalidReason, "indefinite_covariance");
});

test("S18a nonfinite aggregates and single-pixel zero covariance report their own reasons", () => {
  const overflow = computeRectMoments(
    { values: [1e308, 1e308, 0, 0], width: 2, height: 2 },
    { x0: 0, y0: 0, width: 2, height: 2 },
  );
  assert.equal(overflow.valid, false);
  assert.equal(overflow.invalidReason, "nonfinite_aggregate");

  const single = new Array<number>(9).fill(0);
  single[4] = 5;
  const zeroCov = computeRectMoments({ values: single, width: 3, height: 3 }, { x0: 1, y0: 1, width: 1, height: 1 });
  assert.equal(zeroCov.valid, false);
  assert.equal(zeroCov.invalidReason, "zero_covariance");
});

test("S18a the background-dominance gate is exactly inclusive at sum == 0.01*absSum", () => {
  // a = 101, b = -99: sum = 2 exactly, absSum = 200 exactly, and in floating
  // point 0.01 * 200 === 2, so the >= gate passes exactly AT the boundary
  // (the fixture then fails later as indefinite, which proves the order);
  // lowering a to 100.9 puts the sum below the boundary => dominated.
  const atBoundary = computeRectMoments(
    { values: [101, -99], width: 2, height: 1 },
    { x0: 0, y0: 0, width: 2, height: 1 },
  );
  assert.notEqual(atBoundary.invalidReason, "background_dominated");
  assert.equal(atBoundary.invalidReason, "indefinite_covariance");

  const below = computeRectMoments(
    { values: [100.9, -99], width: 2, height: 1 },
    { x0: 0, y0: 0, width: 2, height: 1 },
  );
  assert.equal(below.valid, false);
  assert.equal(below.invalidReason, "background_dominated");
});

test("S18a axis-aligned Gaussians produce exactly canonical theta 0 and pi/2", () => {
  const wide = computeRectMoments(
    { values: gaussianPixels(41, 41, 20, 20, 6, 3, 0), width: 41, height: 41 },
    { x0: 0, y0: 0, width: 41, height: 41 },
  );
  assert.equal(wide.valid, true);
  assert.equal(wide.thetaRad, 0);

  const tall = computeRectMoments(
    { values: gaussianPixels(41, 41, 20, 20, 3, 6, 0), width: 41, height: 41 },
    { x0: 0, y0: 0, width: 41, height: 41 },
  );
  assert.equal(tall.valid, true);
  assert.equal(tall.thetaRad, Math.PI / 2);
  assert.ok(wide.thetaRad! >= 0 && wide.thetaRad! < Math.PI);
  assert.ok(tall.thetaRad! >= 0 && tall.thetaRad! < Math.PI);
});

test("S18a computeEllipseMoments rejects swapped semi-axes", () => {
  const values = new Array<number>(64).fill(1);
  assert.throws(
    () =>
      computeEllipseMoments(
        { values, width: 8, height: 8 },
        { centerXPx: 4, centerYPx: 4, semiMajorPx: 2, semiMinorPx: 5, thetaRad: 0 },
      ),
    /semiMajorPx must be >= semiMinorPx/,
  );
});
