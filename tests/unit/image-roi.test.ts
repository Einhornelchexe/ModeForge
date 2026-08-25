import assert from "node:assert/strict";
import test from "node:test";

import { suggestRoi } from "../../packages/image/src/roi.ts";
import {
  SUGGESTED_ROI_MIN_PEAK_RATIO,
  SUGGESTED_ROI_NOISE_SUSPECT_FRACTION,
  SUGGESTED_ROI_PADDING_PX,
} from "../../packages/image/src/thresholds.ts";

function makeValues(width: number, height: number, fill = 0): number[] {
  return new Array<number>(width * height).fill(fill);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Rotated elliptical Gaussian, pixel-centre sampled, overwriting the buffer.
function gaussian(
  values: number[],
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigma1: number,
  sigma2: number,
  thetaRad: number,
  amplitude: number,
): void {
  const cos = Math.cos(thetaRad);
  const sin = Math.sin(thetaRad);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      values[x + y * width] =
        amplitude * Math.exp(-((u * u) / (2 * sigma1 * sigma1) + (v * v) / (2 * sigma2 * sigma2)));
    }
  }
}

function stamp(
  values: number[] | Float64Array,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  value: number,
): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      values[x + y * width] = value;
    }
  }
}

test("S18a largest 4-connected component wins when two separate blobs are above threshold", () => {
  const width = 30;
  const height = 20;
  const values = makeValues(width, height, 0);
  stamp(values, width, 4, 3, 8, 5, 10);
  stamp(values, width, 20, 10, 3, 3, 10);

  const result = suggestRoi({ values, width, height }, 1);
  assert.ok(result !== null);
  // S20 D3 re-pin (was { x0: 0, y0: 0, width: 20, height: 16 } under the fixed
  // 8 px border). The winning component is the 8x5 stamp, so halfExtent is
  // 4 / 2.5 and the peak-to-threshold ratio is 10 / 4 = 2.5. The Gaussian
  // inversion reads sigmaEst_x = 4 / sqrt(2*ln 2.5) = 2.9548 and therefore
  // asks for a half side of 1.25 * 6 * 2.9548 = 22.16, i.e. pad_x = 19;
  // pad_y = ceil(1.25*6*1.8468 - 2.5) = 12. Both overrun this 30x20 frame, so
  // the suggestion is the clamped full frame. On a flat stamp the Gaussian
  // inversion over-reads the true uniform sigma of 8/sqrt(12) = 2.31 by 28
  // percent; over-padding is the safe direction here (the clipping gate is
  // served more generously and the background rim moves further from the
  // beam), and this oracle is the deliberate record of it.
  assert.deepStrictEqual(result.rect, { x0: 0, y0: 0, width: 30, height: 20 });
  assert.equal(result.componentPixelCount, 40);
  assert.equal(result.maskPixelCount, 49);
  assert.equal(result.peakValueCounts, 10);
  assert.equal(result.peakX, 4);
  assert.equal(result.peakY, 3);
  assert.equal(result.thresholdCounts, 4);
  assert.equal(result.paddingPx, 8);
  assert.equal(result.paddingXPx, 19);
  assert.equal(result.paddingYPx, 12);
  assert.equal(roundTo(result.sigmaEstXPx ?? Number.NaN, 4), 2.9548);
  assert.equal(roundTo(result.sigmaEstYPx ?? Number.NaN, 4), 1.8468);
  assert.equal(result.clampedToImage, true);
});

test("S18a padding is clamped to the image and clampedToImage flags it", () => {
  const width = 16;
  const height = 16;
  const values = makeValues(width, height, 0);
  stamp(values, width, 0, 0, 3, 3, 20);

  const result = suggestRoi({ values, width, height }, 1, { paddingPx: 5 });
  assert.ok(result !== null);
  assert.deepStrictEqual(result.rect, { x0: 0, y0: 0, width: 8, height: 8 });
  assert.equal(result.clampedToImage, true);
  assert.equal(result.paddingPx, 5);
  assert.equal(result.thresholdCounts, 4);
  assert.equal(result.componentPixelCount, 9);
});

test("S18a no mask pixel above the threshold yields null", () => {
  assert.equal(suggestRoi({ values: [1, 1, 1, 1], width: 2, height: 2 }, 1), null);
  assert.equal(suggestRoi({ values: [0, 0, 0, 0], width: 2, height: 2 }, 0), null);
  assert.equal(suggestRoi({ values: [Number.NaN, 1, 2, 3], width: 2, height: 2 }, 1), null);
});

test("S18a non-finite pixels never enter the mask and a NaN island splits a blob into two components", () => {
  const width = 12;
  const height = 6;
  const values = makeValues(width, height, 0);
  stamp(values, width, 1, 1, 4, 2, 10);
  stamp(values, width, 5, 1, 3, 2, Number.NaN);
  stamp(values, width, 8, 1, 2, 2, 10);

  const result = suggestRoi({ values, width, height }, 1, { paddingPx: 0 });
  assert.ok(result !== null);
  assert.equal(result.componentPixelCount, 8);
  assert.equal(result.maskPixelCount, 12);
  assert.deepStrictEqual(result.rect, { x0: 1, y0: 1, width: 4, height: 2 });
  assert.equal(result.clampedToImage, false);
  assert.equal(result.peakValueCounts, 10);
});

test("S18a sigmaCounts 0 gives threshold 0 and only strictly positive finite values count", () => {
  const width = 8;
  const height = 5;
  const values = makeValues(width, height, 0);
  values[1 + 1 * width] = 0.5;
  values[6 + 3 * width] = 2;
  values[4 + 2 * width] = Number.NaN;

  const result = suggestRoi({ values, width, height }, 0);
  assert.ok(result !== null);
  assert.equal(result.thresholdCounts, 0);
  assert.equal(result.maskPixelCount, 2);
  assert.equal(result.componentPixelCount, 1);
  assert.equal(result.peakValueCounts, 2);
  assert.equal(result.peakX, 6);
  assert.equal(result.peakY, 3);
});

test("S18a suggestRoi rejects invalid inputs with RangeError", () => {
  assert.throws(() => suggestRoi({ values: [], width: 0, height: 5 }, 1), /positive integers/);
  assert.throws(
    () => suggestRoi({ values: new Array<number>(15).fill(1), width: 4, height: 4 }, 1),
    /does not match/,
  );
  assert.throws(() => suggestRoi({ values: [0, 0, 0, 0], width: 2, height: 2 }, -1), /sigmaCounts/);
  assert.throws(
    () => suggestRoi({ values: [0, 0, 0, 0], width: 2, height: 2 }, Number.NaN),
    /sigmaCounts/,
  );
  assert.throws(
    () => suggestRoi({ values: [0, 0, 0, 0], width: 2, height: 2 }, 1, { k: 0 }),
    /k must be a finite number > 0/,
  );
  assert.throws(
    () => suggestRoi({ values: [0, 0, 0, 0], width: 2, height: 2 }, 1, { k: -2 }),
    /k must be a finite number > 0/,
  );
  assert.throws(
    () => suggestRoi({ values: [0, 0, 0, 0], width: 2, height: 2 }, 1, { paddingPx: -1 }),
    /paddingPx must be an integer >= 0/,
  );
  assert.throws(
    () => suggestRoi({ values: [0, 0, 0, 0], width: 2, height: 2 }, 1, { paddingPx: 1.5 }),
    /paddingPx must be an integer >= 0/,
  );
});

test("S18a suggestRoi is deterministic across repeated runs", () => {
  const width = 24;
  const height = 18;
  const values = makeValues(width, height, 0);
  stamp(values, width, 2, 2, 6, 4, 7);
  stamp(values, width, 14, 8, 4, 5, 7);
  values[5 + 6 * width] = Number.NaN;
  values[16 + 12 * width] = Number.NaN;

  const first = suggestRoi({ values, width, height }, 1);
  const second = suggestRoi({ values, width, height }, 1);
  assert.ok(first !== null);
  assert.deepStrictEqual(first, second);
});

test("S18a peak position is reported exactly", () => {
  const width = 10;
  const height = 10;
  const values = makeValues(width, height, 0);
  stamp(values, width, 2, 3, 4, 3, 5);
  values[4 + 4 * width] = 9;

  const result = suggestRoi({ values, width, height }, 1, { paddingPx: 0 });
  assert.ok(result !== null);
  assert.equal(result.peakValueCounts, 9);
  assert.equal(result.peakX, 4);
  assert.equal(result.peakY, 4);
  assert.deepStrictEqual(result.rect, { x0: 2, y0: 3, width: 4, height: 3 });
  assert.equal(result.componentPixelCount, 12);
  assert.equal(result.clampedToImage, false);
});

test("S18a M9 smoke: large-frame two-component scan reuses one queue and keeps exact results", () => {
  const width = 512;
  const height = 512;
  const values = makeValues(width, height, 0);
  stamp(values, width, 200, 150, 40, 40, 10);
  stamp(values, width, 400, 400, 10, 10, 10);

  const result = suggestRoi({ values, width, height }, 1);
  assert.ok(result !== null);
  // S20 D3 re-pin (was { x0: 192, y0: 142, width: 56, height: 56 } under the
  // fixed border). Same 2.5 ratio as the two-blob oracle, on a 40x40 stamp:
  // sigmaEst = 20 / 1.3537 = 14.774, so the derived padding is
  // ceil(1.25*6*14.774 - 20) = 91 per axis. The frame is large enough to hold
  // it, so nothing clamps.
  assert.deepStrictEqual(result.rect, { x0: 109, y0: 59, width: 222, height: 222 });
  assert.equal(result.componentPixelCount, 1600);
  assert.equal(result.maskPixelCount, 1700);
  assert.equal(result.peakValueCounts, 10);
  assert.equal(result.peakX, 200);
  assert.equal(result.peakY, 150);
  assert.equal(result.paddingXPx, 91);
  assert.equal(result.paddingYPx, 91);
  assert.equal(result.clampedToImage, false);
});

test("S18a M11 oracle: sigma 0 with a noise-dominated mask flags suspectNoiseDominated", () => {
  const width = 100;
  const height = 100;
  const values = makeValues(width, height, 0);
  // 60x50 = 3000 of 10000 pixels, above the 0.25 suspect fraction.
  stamp(values, width, 0, 0, 60, 50, 1);

  const result = suggestRoi({ values, width, height }, 0);
  assert.ok(result !== null);
  assert.equal(result.thresholdCounts, 0);
  assert.equal(result.maskPixelCount, 3000);
  assert.equal(result.maskFraction, 0.3);
  assert.ok(result.maskFraction > SUGGESTED_ROI_NOISE_SUSPECT_FRACTION);
  assert.equal(result.suspectNoiseDominated, true);
});

test("S18a M11 oracle: sigma 0 with a compact clean beam is not flagged as noise-dominated", () => {
  const width = 100;
  const height = 100;
  const values = makeValues(width, height, 0);
  // 10x10 = 100 of 10000 pixels, well under the 0.25 suspect fraction.
  stamp(values, width, 45, 45, 10, 10, 1);

  const result = suggestRoi({ values, width, height }, 0);
  assert.ok(result !== null);
  assert.equal(result.maskPixelCount, 100);
  assert.equal(result.maskFraction, 0.01);
  assert.equal(result.suspectNoiseDominated, false);
});

test("S18a M11 oracle: a tiny float32-floor sigma still flags a noise-dominated mask", () => {
  // revised: FIX 6 removed the 1e-9 peak heuristic, so provenance must be
  // explicit — the float32 floor is now signalled via sigmaScaleSource.
  const width = 100;
  const height = 100;
  const values = makeValues(width, height, 0);
  stamp(values, width, 0, 0, 60, 50, 1e-3);

  const result = suggestRoi({ values, width, height }, 1e-15, { sigmaScaleSource: "floor" });
  assert.ok(result !== null);
  assert.equal(result.maskPixelCount, 3000);
  assert.ok(result.thresholdCounts > 0);
  assert.equal(result.suspectNoiseDominated, true);
});

test("S18a M11 oracle: an HDR beam with measured-sigma provenance is not flagged as noise-dominated", () => {
  // revised: FIX 6 couples the flag to sigma provenance instead of the peak
  // magnitude. A mad/iqr-sourced sigma is a real noise measurement, so a
  // clean high-dynamic-range beam may legitimately cover above the suspect
  // fraction without being flagged.
  const width = 100;
  const height = 100;
  const values = makeValues(width, height, 0);
  // 60x60 = 3600 of 10000 pixels = 0.36 mask fraction with peak 1e8.
  stamp(values, width, 5, 5, 60, 60, 1e8);

  const result = suggestRoi({ values, width, height }, 0.01, { sigmaScaleSource: "mad" });
  assert.ok(result !== null);
  assert.equal(result.maskPixelCount, 3600);
  assert.equal(result.maskFraction, 0.36);
  assert.ok(result.maskFraction > SUGGESTED_ROI_NOISE_SUSPECT_FRACTION);
  assert.equal(result.peakValueCounts, 1e8);
  assert.equal(result.suspectNoiseDominated, false);
});

test("S18a M11 oracle: a huge beam with sigma > 0 is never flagged as noise-dominated", () => {
  const width = 100;
  const height = 100;
  const values = makeValues(width, height, 0);
  // 80x80 = 6400 of 10000 pixels, far above the fraction, but a positive
  // measured sigma means a real beam, so the flag never fires.
  stamp(values, width, 0, 0, 80, 80, 10);

  const result = suggestRoi({ values, width, height }, 1);
  assert.ok(result !== null);
  assert.equal(result.maskPixelCount, 6400);
  assert.equal(result.maskFraction, 0.64);
  assert.equal(result.suspectNoiseDominated, false);
});

// ── S20 stage D3: sigma-derived padding ───────────────────────────────────
//
// The padding is no longer a fixed border. Per axis it is
//   pad = max(base,
//             ceil(SUGGESTED_ROI_PAD_MARGIN * APERTURE_ALPHA_CHECK * sigmaEst - halfExtent),
//             ceil(SUGGESTED_ROI_PAD_MASK_FLOOR * halfExtent))
// with sigmaEst = halfExtent / sqrt(2 * ln(peakRobust / threshold)) and
// halfExtent = (max - min + 1) / 2 of the winning component's bounding box.
// The fixtures below pin the exact rectangle each mechanism produces.

test("S20 D3 a hot pixel welded to the component does not shrink the padding", () => {
  // The inversion divides by sqrt(2*ln(peak/threshold)), so a peak that is too
  // HIGH shrinks sigmaEst and shrinks the padding with it. This scene is sized
  // so the aperture term is the binding one (ratio 10, halfExtent 10.5:
  // sigmaEst 4.8929, aperture term 27, mask floor 21), which is exactly where
  // a raw-peak inversion would be visible: at a raw peak of 1e6 the ratio is
  // 250000, sigmaEst drops to 2.106, the aperture term collapses to 6 and the
  // padding would fall back to the floor of 21 - 6 px per side short.
  const width = 128;
  const height = 128;
  const clean = makeValues(width, height, 0);
  stamp(clean, width, 54, 54, 21, 21, 40);
  const cleanResult = suggestRoi({ values: clean, width, height }, 1);
  assert.ok(cleanResult !== null);
  assert.deepStrictEqual(cleanResult.rect, { x0: 27, y0: 27, width: 75, height: 75 });
  assert.equal(cleanResult.paddingXPx, 27);
  assert.equal(cleanResult.paddingYPx, 27);
  assert.equal(cleanResult.peakValueCounts, 40);
  assert.equal(roundTo(cleanResult.sigmaEstXPx ?? Number.NaN, 4), 4.8929);

  const hot = makeValues(width, height, 0);
  stamp(hot, width, 54, 54, 21, 21, 40);
  hot[64 + 64 * width] = 1e6;
  const hotResult = suggestRoi({ values: hot, width, height }, 1);
  assert.ok(hotResult !== null);
  // Identical geometry: the robust component peak outvotes the single spike.
  assert.deepStrictEqual(hotResult.rect, cleanResult.rect);
  assert.equal(hotResult.paddingXPx, 27);
  assert.equal(hotResult.paddingYPx, 27);
  assert.equal(hotResult.sigmaEstXPx, cleanResult.sigmaEstXPx);
  assert.equal(hotResult.sigmaEstYPx, cleanResult.sigmaEstYPx);
  // peakValueCounts still reports what is actually in the data.
  assert.equal(hotResult.peakValueCounts, 1e6);
  assert.equal(hotResult.peakX, 64);
  assert.equal(hotResult.peakY, 64);

  // A spike on the rim of the component, where the 3x3 window is asymmetric,
  // and two adjacent spikes (2 of 9 samples) are both still outvoted.
  const onRim = makeValues(width, height, 0);
  stamp(onRim, width, 54, 54, 21, 21, 40);
  onRim[74 + 54 * width] = 1e6;
  const rimResult = suggestRoi({ values: onRim, width, height }, 1);
  assert.ok(rimResult !== null);
  assert.deepStrictEqual(rimResult.rect, cleanResult.rect);
  assert.equal(rimResult.sigmaEstXPx, cleanResult.sigmaEstXPx);

  const pair = makeValues(width, height, 0);
  stamp(pair, width, 54, 54, 21, 21, 40);
  pair[64 + 64 * width] = 1e6;
  pair[65 + 64 * width] = 1e6;
  const pairResult = suggestRoi({ values: pair, width, height }, 1);
  assert.ok(pairResult !== null);
  assert.deepStrictEqual(pairResult.rect, cleanResult.rect);
  assert.equal(pairResult.sigmaEstXPx, cleanResult.sigmaEstXPx);
});

test("S20 D3 the peak-ratio guard is exact at sqrt(e) and falls back to the base border", () => {
  const width = 64;
  const height = 64;
  // threshold = 4 * 1 = 4, so this plateau puts the ratio exactly on the
  // guard. The comparison is strict, so the guard denies it.
  const atRatio = 4 * SUGGESTED_ROI_MIN_PEAK_RATIO;

  const onBoundary = makeValues(width, height, 0);
  stamp(onBoundary, width, 30, 30, 5, 5, atRatio);
  const denied = suggestRoi({ values: onBoundary, width, height }, 1);
  assert.ok(denied !== null);
  assert.equal(denied.thresholdCounts, 4);
  assert.equal(denied.peakValueCounts / denied.thresholdCounts, SUGGESTED_ROI_MIN_PEAK_RATIO);
  assert.equal(denied.sigmaEstXPx, null);
  assert.equal(denied.sigmaEstYPx, null);
  assert.equal(denied.paddingXPx, SUGGESTED_ROI_PADDING_PX);
  assert.equal(denied.paddingYPx, SUGGESTED_ROI_PADDING_PX);
  assert.deepStrictEqual(denied.rect, { x0: 22, y0: 22, width: 21, height: 21 });

  const above = makeValues(width, height, 0);
  stamp(above, width, 30, 30, 5, 5, atRatio * 1.01);
  const derived = suggestRoi({ values: above, width, height }, 1);
  assert.ok(derived !== null);
  // One percent past the guard the denominator is barely above 1, so sigmaEst
  // is close to the half extent itself - the largest estimate the guard still
  // admits. It is a padding of 17 px, not a full frame: the guard is placed
  // where the inversion stops amplifying, not where it starts being useful.
  assert.equal(roundTo(derived.sigmaEstXPx ?? Number.NaN, 4), 2.4755);
  assert.equal(derived.paddingXPx, 17);
  assert.equal(derived.paddingYPx, 17);
  assert.deepStrictEqual(derived.rect, { x0: 13, y0: 13, width: 39, height: 39 });
  assert.equal(derived.clampedToImage, false);

  // Well below the guard the fallback is the same fixed border.
  const below = makeValues(width, height, 0);
  stamp(below, width, 30, 30, 5, 5, 4.5);
  const belowResult = suggestRoi({ values: below, width, height }, 1);
  assert.ok(belowResult !== null);
  assert.equal(belowResult.sigmaEstXPx, null);
  assert.deepStrictEqual(belowResult.rect, { x0: 22, y0: 22, width: 21, height: 21 });
});

test("S20 D3 a zero threshold cannot be inverted and keeps the base border", () => {
  const width = 64;
  const height = 64;
  const values = makeValues(width, height, 0);
  stamp(values, width, 29, 29, 6, 6, 25);

  const result = suggestRoi({ values, width, height }, 0);
  assert.ok(result !== null);
  assert.equal(result.thresholdCounts, 0);
  // ln(peak / 0) is not a number the inversion can use; the guard catches it
  // before any Infinity or NaN can reach the rectangle.
  assert.equal(result.sigmaEstXPx, null);
  assert.equal(result.sigmaEstYPx, null);
  assert.equal(result.paddingXPx, SUGGESTED_ROI_PADDING_PX);
  assert.equal(result.paddingYPx, SUGGESTED_ROI_PADDING_PX);
  assert.deepStrictEqual(result.rect, { x0: 21, y0: 21, width: 22, height: 22 });
});

test("S20 D3 an explicit paddingPx overrides the derivation exactly", () => {
  const width = 128;
  const height = 128;
  const values = makeValues(width, height, 0);
  stamp(values, width, 54, 54, 21, 21, 40);

  // Same scene as the hot-pixel fixture: the derivation would ask for 27.
  const derived = suggestRoi({ values, width, height }, 1);
  assert.ok(derived !== null);
  assert.equal(derived.paddingXPx, 27);

  for (const paddingPx of [0, 3, 8, 40]) {
    const forced = suggestRoi({ values, width, height }, 1, { paddingPx });
    assert.ok(forced !== null);
    assert.equal(forced.paddingPx, paddingPx, `base for ${paddingPx}`);
    assert.equal(forced.paddingXPx, paddingPx, `x padding for ${paddingPx}`);
    assert.equal(forced.paddingYPx, paddingPx, `y padding for ${paddingPx}`);
    assert.equal(forced.sigmaEstXPx, null, `x sigma for ${paddingPx}`);
    assert.equal(forced.sigmaEstYPx, null, `y sigma for ${paddingPx}`);
    assert.deepStrictEqual(
      forced.rect,
      { x0: 54 - paddingPx, y0: 54 - paddingPx, width: 21 + 2 * paddingPx, height: 21 + 2 * paddingPx },
      `rect for ${paddingPx}`,
    );
  }
});

test("S20 D3 the padding is derived per axis on a rotated anisotropic beam", () => {
  const width = 256;
  const height = 256;
  const rotated = makeValues(width, height, 0);
  gaussian(rotated, width, height, 128, 128, 9, 3, Math.PI / 6, 1000);

  const result = suggestRoi({ values: rotated, width, height }, 1);
  assert.ok(result !== null);
  // The clipping gate tests the AXIS-ALIGNED half extents of the rotated check
  // ellipse, so the inversion has to be axis-wise too: a single scalar sigma
  // would over-pad one axis and under-pad the other.
  assert.equal(roundTo(result.sigmaEstXPx ?? Number.NaN, 3), 7.988);
  assert.equal(roundTo(result.sigmaEstYPx ?? Number.NaN, 3), 5.275);
  assert.equal(result.paddingXPx, 53);
  assert.equal(result.paddingYPx, 35);
  assert.deepStrictEqual(result.rect, { x0: 49, y0: 76, width: 159, height: 105 });
  assert.equal(result.clampedToImage, false);

  // The same beam without rotation: the anisotropy is now fully on the axes,
  // and the two paddings separate further.
  const axisAligned = makeValues(width, height, 0);
  gaussian(axisAligned, width, height, 128, 128, 9, 3, 0, 1000);
  const aligned = suggestRoi({ values: axisAligned, width, height }, 1);
  assert.ok(aligned !== null);
  assert.equal(roundTo(aligned.sigmaEstXPx ?? Number.NaN, 3), 8.922);
  assert.equal(roundTo(aligned.sigmaEstYPx ?? Number.NaN, 3), 2.873);
  assert.equal(aligned.paddingXPx, 59);
  assert.equal(aligned.paddingYPx, 19);
  assert.deepStrictEqual(aligned.rect, { x0: 40, y0: 100, width: 177, height: 57 });
});

test("S20 D3 a subpixel centre shift moves the box without destabilising the padding", () => {
  const width = 128;
  const height = 128;
  const onPixel = makeValues(width, height, 0);
  gaussian(onPixel, width, height, 64, 64, 4, 4, 0, 1000);
  const centred = suggestRoi({ values: onPixel, width, height }, 1);
  assert.ok(centred !== null);
  assert.equal(roundTo(centred.sigmaEstXPx ?? Number.NaN, 3), 4.074);
  assert.equal(centred.paddingXPx, 27);
  assert.equal(centred.paddingYPx, 27);
  assert.deepStrictEqual(centred.rect, { x0: 24, y0: 24, width: 81, height: 81 });

  const halfPixel = makeValues(width, height, 0);
  gaussian(halfPixel, width, height, 64.5, 64.5, 4, 4, 0, 1000);
  const shifted = suggestRoi({ values: halfPixel, width, height }, 1);
  assert.ok(shifted !== null);
  // A half-pixel shift costs the mask one column and one row of reach, so the
  // half extent, the estimate and the padding each move by one step. The
  // suggestion tracks the beam instead of jumping.
  assert.equal(roundTo(shifted.sigmaEstXPx ?? Number.NaN, 3), 3.94);
  assert.equal(shifted.paddingXPx, 26);
  assert.equal(shifted.paddingYPx, 26);
  assert.deepStrictEqual(shifted.rect, { x0: 26, y0: 26, width: 78, height: 78 });
});

test("S20 D3 the mask floor is the binding term on a flat top at high dynamic range", () => {
  const width = 192;
  const height = 192;
  const values = makeValues(width, height, 0);
  stamp(values, width, 76, 76, 41, 41, 4e6);

  const result = suggestRoi({ values, width, height }, 1);
  assert.ok(result !== null);
  // ratio 1e6 -> sqrt(2*ln 1e6) = 5.256, so the Gaussian inversion reads only
  // sigmaEst = 20.5 / 5.256 = 3.9 for a lit half width of 20.5 px. An edge
  // steeper than a Gaussian's is exactly what the inversion cannot see: the
  // aperture term would ask for ceil(7.5*3.9 - 20.5) = 9 px, a fraction of
  // what the fit will need. The mask floor ceil(2 * 20.5) = 41 takes over,
  // because it scales with the lit area instead of with a shape assumption.
  assert.equal(roundTo(result.sigmaEstXPx ?? Number.NaN, 4), 3.8999);
  assert.equal(result.paddingXPx, 41);
  assert.equal(result.paddingYPx, 41);
  assert.deepStrictEqual(result.rect, { x0: 35, y0: 35, width: 123, height: 123 });
  assert.equal(result.clampedToImage, false);
});

test("S20 D3 a beam against the frame edge reports the clamp instead of inventing room", () => {
  const width = 128;
  const height = 128;
  const values = makeValues(width, height, 0);
  gaussian(values, width, height, 10, 64, 4, 4, 0, 1000);

  const result = suggestRoi({ values, width, height }, 1);
  assert.ok(result !== null);
  // The mask box itself is cut by the frame on the left, so the x half extent
  // is smaller than the y one and the derived x padding is smaller with it.
  assert.equal(roundTo(result.sigmaEstXPx ?? Number.NaN, 4), 3.6214);
  assert.equal(roundTo(result.sigmaEstYPx ?? Number.NaN, 3), 4.074);
  assert.equal(result.paddingXPx, 24);
  assert.equal(result.paddingYPx, 27);
  assert.deepStrictEqual(result.rect, { x0: 0, y0: 24, width: 48, height: 81 });
  // The padded box asked for x from -14; the frame could not give it. That is
  // what clampedToImage says after D3, and it is the honest signal that no
  // rectangle inside this frame can serve the aperture the beam needs.
  assert.equal(result.clampedToImage, true);
});

test("S20 D3 a threshold that overflows to Infinity yields no suggestion at all", () => {
  // k and sigmaCounts are each finite by the input guards, but their PRODUCT
  // can still round to Infinity. The stated policy is that this yields null:
  // if the exact product exceeds Number.MAX_VALUE it exceeds every
  // representable pixel value too, so the mask really is empty. The
  // consequence worth pinning is that a non-finite threshold never reaches the
  // padding guards, which is why those only test for a positive threshold.
  const width = 40;
  const height = 40;
  const values = makeValues(width, height, 0);
  stamp(values, width, 16, 16, 8, 8, 1e308);

  // A threshold that is merely huge still works, and works exactly: 1e308 over
  // 4e307 is the same ratio 2.5 as the two-blob oracle 307 orders of magnitude
  // further down, and it produces the same sigmaEst. The inversion is
  // scale-free, so the only thing the extreme end changes is the overflow.
  const huge = suggestRoi({ values, width, height }, 1e307);
  assert.ok(huge !== null);
  assert.equal(huge.thresholdCounts, 4e307);
  assert.equal(huge.peakValueCounts, 1e308);
  assert.equal(roundTo(huge.sigmaEstXPx ?? Number.NaN, 4), 2.9548);
  assert.equal(huge.paddingXPx, 19);
  assert.equal(huge.paddingYPx, 19);
  assert.deepStrictEqual(huge.rect, { x0: 0, y0: 0, width: 40, height: 40 });

  // Overflow through sigmaCounts, with the default k = 4.
  assert.equal(Number.MAX_VALUE / 2, 8.988465674311579e307, "the sigma below is finite");
  assert.ok(!Number.isFinite((Number.MAX_VALUE / 2) * 4), "but four times it is not");
  assert.equal(suggestRoi({ values, width, height }, Number.MAX_VALUE / 2), null);
  assert.equal(suggestRoi({ values, width, height }, Number.MAX_VALUE), null);
  // Overflow through k instead: the product is what matters, not either factor.
  assert.equal(suggestRoi({ values, width, height }, 1e300, { k: 1e100 }), null);

  // The boundary from the other side: the largest finite threshold this input
  // can produce is Number.MAX_VALUE itself, and it excludes every finite pixel
  // anyway. The overflow return and the empty-mask return agree there, which
  // is what makes the policy a description of the arithmetic rather than a
  // special case bolted onto it.
  assert.ok(Number.isFinite((Number.MAX_VALUE / 4) * 4));
  assert.equal(suggestRoi({ values, width, height }, Number.MAX_VALUE / 4), null);
});
