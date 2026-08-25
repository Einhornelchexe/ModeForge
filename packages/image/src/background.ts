import type { ImageDtype, ImagePixelArray } from "./contracts.ts";
import {
  AUTO_BACKGROUND_CORNER_FRACTION,
  BACKGROUND_GRADIENT_MIN_POOLED_DEVIATIONS,
  BACKGROUND_GRADIENT_MIN_RECTS,
  BACKGROUND_GRADIENT_TREND_K,
  BACKGROUND_MIN_REFERENCE_SAMPLES,
  BACKGROUND_PLANE_SCALE_EFFECTIVE_DF,
  ROBUST_STATS_MAX_EXACT,
} from "./thresholds.ts";

// Background estimation and subtraction for the image analyzer (S18b).
//
// estimateBackgroundNoise is the single noise scale of the analyzer for
// background regions: a robust cascade (MAD, then IQR) guarded by a
// dtype-aware floor over the robust 10th-to-90th percentile span of the
// samples. applyBackground applies one of five background models to an image
// and always returns a fresh Float64Array; the input is never mutated.
// Overlapping background rectangles are deduplicated by pixel index.
//
// The robust-plane fit is an IRLS Huber fit capped at MAX_IRLS_ITERATIONS.
// The cap is reachable: structured contamination that keeps shifting which
// samples are downweighted can oscillate, and the result then reports
// converged = false with finite parameters instead of throwing.
//
// S20 stage E adds three things to the module, all measured rather than
// assumed (see thresholds.ts for the campaigns):
//   - a single minimum-sample regime. A reference carrying fewer than
//     BACKGROUND_MIN_REFERENCE_SAMPLES finite pixels cannot support either
//     model, so the METHOD degrades to "none" - the image is returned
//     uncorrected - and the noise scale falls back to the dtype-aware floor
//     instead of reporting a measured "mad" from two pixels. A RangeError is
//     still reserved for geometry that cannot be fitted at all, and the
//     geometry guards run FIRST so they keep their reach.
//   - the deflation correction of the robust-plane scale. The scale is taken
//     from residuals of a plane fitted on the same samples; the correction is
//     n / (n - BACKGROUND_PLANE_SCALE_EFFECTIVE_DF).
//   - the reference-trend statistic behind the gradient warning: rect-median
//     subtracts one number, which is only defensible when the reference does
//     not tilt across the frame.

export type BackgroundRect = {
  x0: number;
  y0: number;
  width: number;
  height: number;
};

export type BackgroundImage = {
  pixels: ImagePixelArray | number[];
  width: number;
  height: number;
  dtype: ImageDtype;
};

export type BackgroundNoiseEstimate = {
  sigmaCounts: number;
  medianCounts: number;
  meanCounts: number;
  stdCounts: number;
  madCounts: number;
  // Raw interquartile range (P75 - P25) of the samples.
  iqrCounts: number;
  // Which stage produced sigmaCounts: the MAD scale, the IQR fallback, the
  // dtype-aware floor, or zero (robust scale and floor are both 0).
  scaleSource: "mad" | "iqr" | "floor" | "zero";
  floorCounts: number;
  floorApplied: boolean;
  sampleCount: number;
  // S20 stage E (C2): the deflation correction already contained in
  // sigmaCounts. 1 on every path that did not fit a model on these samples;
  // n / (n - BACKGROUND_PLANE_SCALE_EFFECTIVE_DF) on the robust-plane path
  // when the scale rests on a measured robust estimate.
  scaleCorrection: number;
};

// S20 stage E (C5): does the background REFERENCE tilt across the frame?
// Reported for method "rect-median", which subtracts a single number and is
// therefore the method the answer changes. See BACKGROUND_GRADIENT_TREND_K.
export type BackgroundReferenceTrend = {
  // Rects that contributed a median (finite samples, after deduplication of
  // the union is NOT applied here: each rect is measured as drawn).
  rectCount: number;
  // Peak-to-peak of the fitted linear trend across the rect centroids.
  trendCounts: number;
  // What the in-rect scatter allows for the difference of those two medians.
  uncertaintyCounts: number;
  // trendCounts / uncertaintyCounts, for reporting. Null when unavailable.
  ratio: number | null;
  // The pooled in-rect scatter the uncertainty rests on.
  withinScatterCounts: number;
  // True when trendCounts exceeds BACKGROUND_GRADIENT_TREND_K uncertainties.
  detected: boolean;
  // Null when the statistic could be formed; otherwise why it could not.
  unavailableReason: "too-few-rects" | "collinear-rects" | "no-in-rect-scatter" | null;
};

export type BackgroundConfig =
  | { method: "none" }
  | { method: "manual-offset"; offsetCounts: number }
  | { method: "dark-frame"; darkPixels: ImagePixelArray | number[]; darkWidth: number; darkHeight: number; darkDtype: ImageDtype }
  | { method: "rect-median"; rects: BackgroundRect[] }
  | { method: "robust-plane"; rects: BackgroundRect[] };

export type BackgroundResult = {
  corrected: Float64Array;
  method: BackgroundConfig["method"];
  offsetCounts?: number;
  plane?: {
    // The plane is B(x, y) = b0Counts + bxCountsPerPx * (x - xMeanPx)
    // + byCountsPerPx * (y - yMeanPx) expressed in original pixel coordinates:
    // b0Counts is the plane value at the reference centre (xMeanPx, yMeanPx),
    // the arithmetic mean of the pixel coordinates used for the fit.
    b0Counts: number;
    bxCountsPerPx: number;
    byCountsPerPx: number;
    xMeanPx: number;
    yMeanPx: number;
    iterations: number;
    converged: boolean;
    // Huber delta actually in effect at exit (the early-exit path included):
    // 1.345 * robust residual scale.
    huberDeltaCounts: number;
  };
  noise?: BackgroundNoiseEstimate;
  negativeCountAfter: number;
  negativeFractionAfter: number;
  // S20 stage E (C3/C4): the method the CALLER asked for. Equal to `method`
  // except when the minimum-sample rule degraded it.
  requestedMethod: BackgroundConfig["method"];
  // Set only when the reference was too small to support the requested model.
  degradedReason?: "insufficient-reference-samples";
  // Finite samples the reference carried, for the rect-based methods.
  referenceSampleCount?: number;
  // S20 stage E (C5): present for method "rect-median" only.
  referenceTrend?: BackgroundReferenceTrend;
};

// S21 stage A: the reference rectangles the automatic background method
// resolves to - one box in each image corner, each
// max(1, round(AUTO_BACKGROUND_CORNER_FRACTION * side)) pixels on a side, in
// the fixed order top-left, top-right, bottom-left, bottom-right.
//
// This is the geometry of the shipped four-corner reference preset, restated
// here so the engine can generate it without reaching into the workbench. The
// order is part of the contract, not an implementation detail: it is the order
// the preset writes, it is the order the rectangles are exported in
// (background.resolvedRects), and it is what makes an automatic run's reference
// list compare equal to a hand-drawn one rectangle for rectangle instead of
// merely pixel-union equal.
//
// The rectangles may OVERLAP on a frame narrower than twice the box (they
// collapse onto one another at width or height 1). That is legal input
// everywhere downstream - the reference is resolved as a pixel union - and it
// is deliberately not special-cased: a frame that small cannot carry a
// background reference at all, and the existing guards say so (a degenerate
// geometry throws and degrades to the uncorrected image, a fittable but tiny
// reference degrades through the minimum-sample rule). Generating the boxes
// anyway keeps the automatic method's failure modes identical to the manual
// ones instead of inventing a second cascade.
//
// x0 = width - w is never negative: w is at most width for every width >= 1.
export function autoBackgroundCornerRects(width: number, height: number): BackgroundRect[] {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("image width and height must be positive integers");
  }
  const w = Math.max(1, Math.round(AUTO_BACKGROUND_CORNER_FRACTION * width));
  const h = Math.max(1, Math.round(AUTO_BACKGROUND_CORNER_FRACTION * height));
  return [
    { x0: 0, y0: 0, width: w, height: h },
    { x0: width - w, y0: 0, width: w, height: h },
    { x0: 0, y0: height - h, width: w, height: h },
    { x0: width - w, y0: height - h, width: w, height: h },
  ];
}

// S20 stage E (C2): the deflation correction of a scale taken from the
// residuals of a plane fitted on the SAME n samples. Exported so the analyzer
// can apply the identical factor to its own sigma_B estimate when that
// estimate is measured over the fit's own reference rectangles.
export function backgroundPlaneScaleCorrection(sampleCount: number): number {
  if (!Number.isFinite(sampleCount) || sampleCount <= BACKGROUND_PLANE_SCALE_EFFECTIVE_DF) return 1;
  return sampleCount / (sampleCount - BACKGROUND_PLANE_SCALE_EFFECTIVE_DF);
}

const MAD_SCALE = 1.4826;
const IQR_SCALE = 1.349;
// sqrt(pi/2): the standard error of a sample median relative to that of the
// mean, for the S20 stage-E reference-trend statistic.
const MEDIAN_STANDARD_ERROR_FACTOR = 1.2533;
const HUBER_DELTA_FACTOR = 1.345;
const FLOAT_FLOOR_FACTOR = 1e-12;
const FLOAT_ANCHOR_FACTOR = 1e-6;
const INTEGER_FLOOR_COUNTS = 0.5;
const MAX_IRLS_ITERATIONS = 50;
const PARAM_REL_TOLERANCE = 1e-10;
const ROBUST_SPAN_LOW_QUANTILE = 0.1;
const ROBUST_SPAN_HIGH_QUANTILE = 0.9;
// Maximum tolerated OLS leverage of a single background sample. h_i sums to 3
// over the three plane parameters, so h_i close to 1 means sample i alone
// fixes one plane direction and its value becomes the slope. Measured
// well-conditioned layouts sit far below this: a 1-pixel border ring is 0.032,
// four corner boxes 0.050, L-shaped strips 0.272 and a 2x2 block 0.750; a
// 25-sample block plus one off-axis hot pixel reaches 0.9608 and would let one
// pixel turn the slope, so the cap lives at 0.9.
const LEVERAGE_MAX = 0.9;

function validateImage(image: BackgroundImage): void {
  if (!Number.isInteger(image.width) || image.width <= 0 || !Number.isInteger(image.height) || image.height <= 0) {
    throw new RangeError("image width and height must be positive integers");
  }
  if (image.pixels.length !== image.width * image.height) {
    throw new RangeError(`pixels.length ${image.pixels.length} does not match width*height ${image.width * image.height}`);
  }
}

function validateRects(image: BackgroundImage, rects: BackgroundRect[]): void {
  if (rects.length === 0) {
    throw new RangeError("background rectangles are required (rects must not be empty)");
  }
  for (const rect of rects) {
    if (!Number.isInteger(rect.x0) || !Number.isInteger(rect.y0) || !Number.isInteger(rect.width) || !Number.isInteger(rect.height)) {
      throw new RangeError("background rectangle coordinates and sizes must be integers");
    }
    if (rect.width <= 0 || rect.height <= 0) {
      throw new RangeError("background rectangle width and height must be positive integers");
    }
    if (rect.x0 < 0 || rect.y0 < 0 || rect.x0 + rect.width > image.width || rect.y0 + rect.height > image.height) {
      throw new RangeError(
        `background rectangle [${rect.x0}, ${rect.y0}, ${rect.width}, ${rect.height}] is not fully inside the ${image.width}x${image.height} image`,
      );
    }
  }
}

type RectSample = { x: number; y: number; value: number };

type RectUnion = { x0: number; y0: number; boxWidth: number; boxHeight: number; occupancy: Uint8Array };

// Occupancy bitmap of the rect union over the union's BOUNDING BOX. The bitmap
// is offset-indexed, so a few small rects allocate a few small rows instead of
// a structure over the whole frame; one byte per bounding-box pixel bounds the
// dedup cost at 1 byte where an index Set plus its sorted array cost tens of
// bytes per union pixel. Scanning the box row-major reproduces the ascending
// pixel-index order of the union exactly.
function rectUnionOccupancy(rects: BackgroundRect[]): RectUnion {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    if (rect.x0 < minX) minX = rect.x0;
    if (rect.y0 < minY) minY = rect.y0;
    if (rect.x0 + rect.width - 1 > maxX) maxX = rect.x0 + rect.width - 1;
    if (rect.y0 + rect.height - 1 > maxY) maxY = rect.y0 + rect.height - 1;
  }
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const occupancy = new Uint8Array(boxWidth * boxHeight);
  for (const rect of rects) {
    for (let y = rect.y0; y < rect.y0 + rect.height; y += 1) {
      const rowOffset = (y - minY) * boxWidth - minX;
      for (let x = rect.x0; x < rect.x0 + rect.width; x += 1) occupancy[rowOffset + x] = 1;
    }
  }
  return { x0: minX, y0: minY, boxWidth, boxHeight, occupancy };
}

// Collect finite samples from the union of the rectangles. Overlapping
// rectangles are deduplicated by pixel index (overlap is legal input, never a
// throw), and the union is visited in ascending pixel-index order so the
// iteration order is deterministic row-major.
function collectRectSamples(image: BackgroundImage, rects: BackgroundRect[]): RectSample[] {
  // A single rectangle cannot overlap itself: iterate it row-major directly
  // so one large rect never pays for the occupancy bitmap. The ordering is
  // identical to the union path below.
  if (rects.length === 1) {
    const rect = rects[0];
    const samples: RectSample[] = [];
    for (let y = rect.y0; y < rect.y0 + rect.height; y += 1) {
      for (let x = rect.x0; x < rect.x0 + rect.width; x += 1) {
        const value = image.pixels[x + y * image.width];
        if (Number.isFinite(value)) samples.push({ x, y, value });
      }
    }
    return samples;
  }
  const union = rectUnionOccupancy(rects);
  const samples: RectSample[] = [];
  for (let y = union.y0; y < union.y0 + union.boxHeight; y += 1) {
    const boxRow = (y - union.y0) * union.boxWidth - union.x0;
    const imageRow = y * image.width;
    for (let x = union.x0; x < union.x0 + union.boxWidth; x += 1) {
      if (union.occupancy[boxRow + x] === 0) continue;
      const value = image.pixels[imageRow + x];
      if (Number.isFinite(value)) samples.push({ x, y, value });
    }
  }
  return samples;
}

// The precondition backgroundRectsCoverSamePixels below enforces on its own
// input: the same positive-integer geometry validateRects demands, minus the
// in-image bound it cannot check without an image. Non-finite and fractional
// extents are refused here rather than reaching the occupancy bitmap, whose
// bounding-box arithmetic is only meaningful on integers.
function hasUsableExtents(rect: BackgroundRect): boolean {
  return (
    Number.isInteger(rect.x0) &&
    Number.isInteger(rect.y0) &&
    Number.isInteger(rect.width) &&
    Number.isInteger(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

// S20 stage E (C2/C10): do two rectangle lists resolve to the SAME reference
// pixels? This is the identity that decides whether a sigma_B estimate was
// measured over the very samples a robust plane consumed, and therefore
// whether it carries the plane's deflation.
//
// The comparison is over the resolved PIXEL UNION, not over the rectangle
// tuples, because the pixel union is what both the fit and the estimate
// actually read: two lists that cover the same pixels produce literally the
// same sample vector however they are ordered, however often a rectangle is
// repeated (the union deduplicates), and however the region is tiled. A
// sorted-tuple comparison would catch reordering and duplication but not
// re-tiling - one 2x3 rectangle against two 1x3 rectangles over the same six
// pixels is the same reference and compares unequal as tuples.
//
// Equal unions also imply equal FINITE-sample sets: the background models
// preserve finiteness pixel by pixel, so the same pixels carry the same
// finite/non-finite pattern before and after correction.
//
// Rectangles must already be validated (positive integer extents); an
// unvalidated extent returns false rather than allocating on nonsense. That
// check runs BEFORE every shortcut, the alias case included: a degenerate list
// compared against itself must answer the same way it answers against a copy
// of itself, or the guard would only hold for callers who happened not to pass
// the same array twice.
export function backgroundRectsCoverSamePixels(left: BackgroundRect[], right: BackgroundRect[]): boolean {
  for (const rect of left) if (!hasUsableExtents(rect)) return false;
  for (const rect of right) if (!hasUsableExtents(rect)) return false;
  if (left === right) return true;
  if (left.length === 0 || right.length === 0) return left.length === right.length;
  // Fast path for the overwhelmingly common case - the same rectangles in the
  // same order - so the ordinary call allocates nothing.
  if (left.length === right.length) {
    let ordered = true;
    for (let i = 0; i < left.length; i += 1) {
      if (
        left[i].x0 !== right[i].x0 ||
        left[i].y0 !== right[i].y0 ||
        left[i].width !== right[i].width ||
        left[i].height !== right[i].height
      ) {
        ordered = false;
        break;
      }
    }
    if (ordered) return true;
  }
  const a = rectUnionOccupancy(left);
  const b = rectUnionOccupancy(right);
  // Every rectangle contributes pixels, so the rect-derived bounding box IS
  // the pixel-set bounding box: different boxes cannot be the same pixel set.
  if (a.x0 !== b.x0 || a.y0 !== b.y0 || a.boxWidth !== b.boxWidth || a.boxHeight !== b.boxHeight) return false;
  for (let i = 0; i < a.occupancy.length; i += 1) {
    if (a.occupancy[i] !== b.occupancy[i]) return false;
  }
  return true;
}

// Value-only variant of collectRectSamples for the noise-estimate path: the
// noise statistics never need pixel coordinates, so large rects skip the
// per-sample object materialization. Same union, dedup and ordering rules.
function collectRectValues(image: BackgroundImage, rects: BackgroundRect[]): number[] {
  const values: number[] = [];
  if (rects.length === 1) {
    const rect = rects[0];
    for (let y = rect.y0; y < rect.y0 + rect.height; y += 1) {
      for (let x = rect.x0; x < rect.x0 + rect.width; x += 1) {
        const value = image.pixels[x + y * image.width];
        if (Number.isFinite(value)) values.push(value);
      }
    }
    return values;
  }
  const union = rectUnionOccupancy(rects);
  for (let y = union.y0; y < union.y0 + union.boxHeight; y += 1) {
    const boxRow = (y - union.y0) * union.boxWidth - union.x0;
    const imageRow = y * image.width;
    for (let x = union.x0; x < union.x0 + union.boxWidth; x += 1) {
      if (union.occupancy[boxRow + x] === 0) continue;
      const value = image.pixels[imageRow + x];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

function sortedCopy(values: number[]): number[] {
  const copy = values.slice();
  copy.sort((a, b) => a - b);
  return copy;
}

// Quantile with linear interpolation (type 7). Returns 0 for an empty input.
// Deterministic: the input must already be sorted.
function quantileOfSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const h = p * (n - 1);
  const i = Math.floor(h);
  if (i + 1 > n - 1) return sorted[i];
  return sorted[i] + (h - i) * (sorted[i + 1] - sorted[i]);
}

function medianOfSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function populationStats(values: number[]): { mean: number; std: number } {
  let sum = 0;
  for (const value of values) sum += value;
  const mean = values.length === 0 ? 0 : sum / values.length;
  let sumSquares = 0;
  for (const value of values) {
    const deviation = value - mean;
    sumSquares += deviation * deviation;
  }
  return { mean, std: values.length === 0 ? 0 : Math.sqrt(sumSquares / values.length) };
}

// Greatest common divisor of two non-negative integers; used to keep the
// subsample stride coprime with the image width.
function gcd(a: number, b: number): number {
  let left = a;
  let right = b;
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

function minMax(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

// Quantization floor for a noise scale: 0.5 counts for integer dtypes and a
// tiny relative floor for float32: FLOAT_FLOOR_FACTOR times the robust
// P90-P10 span of the samples. The span uses nearest-rank quantiles so a
// field with exactly 90% of its samples at one level (and a perfectly flat
// field) still floors at exactly zero.
function noiseFloor(dtype: ImageDtype, values: number[]): number {
  if (dtype !== "float32") return INTEGER_FLOOR_COUNTS;
  if (values.length === 0) return 0;
  const sorted = sortedCopy(values);
  const lowIndex = Math.floor(ROBUST_SPAN_LOW_QUANTILE * (sorted.length - 1));
  const highIndex = Math.floor(ROBUST_SPAN_HIGH_QUANTILE * (sorted.length - 1));
  const span = sorted[highIndex] - sorted[lowIndex];
  return span > 0 ? FLOAT_FLOOR_FACTOR * span : 0;
}

function computeNoiseScale(values: number[], dtype: ImageDtype): BackgroundNoiseEstimate {
  const { mean, std } = populationStats(values);
  const sorted = sortedCopy(values);
  const medianCounts = values.length === 0 ? 0 : medianOfSorted(sorted);
  const deviations = sorted.map((value) => Math.abs(value - medianCounts));
  deviations.sort((a, b) => a - b);
  const madCounts = values.length === 0 ? 0 : medianOfSorted(deviations);
  const iqrCounts =
    values.length === 0
      ? 0
      : quantileOfSorted(sorted, 0.75) - quantileOfSorted(sorted, 0.25);
  const floorCounts = noiseFloor(dtype, values);

  // Robust sigma cascade: MAD scale, then the IQR fallback for all dtypes
  // when MAD is exactly zero. There is no std fallback. A zero robust sigma
  // leaves the floor decisive.
  let robustSigma = 0;
  let robustSource: "mad" | "iqr" | null = null;
  if (madCounts > 0) {
    robustSigma = MAD_SCALE * madCounts;
    robustSource = "mad";
  } else if (iqrCounts > 0) {
    robustSigma = iqrCounts / IQR_SCALE;
    robustSource = "iqr";
  }

  let sigmaCounts: number;
  let scaleSource: BackgroundNoiseEstimate["scaleSource"];
  let floorApplied: boolean;
  if (values.length < BACKGROUND_MIN_REFERENCE_SAMPLES) {
    // S20 stage E (C3/C4), the single minimum-sample regime: a reference this
    // small cannot support a measured robust scale at all. Two float32 samples
    // used to report a "mad" scale of 29.65 counts from the pair [100, 140]
    // with the quantization floor collapsed to exactly zero (the nearest-rank
    // P10/P90 pair coincides below three samples), and nothing said so. The
    // dtype-aware floor is what is left that is honestly measurable, and both
    // "floor" and "zero" raise IMAGE_NOISE_SCALE_SUSPECT downstream. The raw
    // madCounts / iqrCounts stay in the estimate as diagnostics; they are just
    // no longer allowed to BE the scale.
    sigmaCounts = floorCounts;
    scaleSource = floorCounts > 0 ? "floor" : "zero";
    floorApplied = floorCounts > 0;
  } else if (robustSigma === 0 && floorCounts === 0) {
    sigmaCounts = 0;
    scaleSource = "zero";
    floorApplied = false;
  } else if (floorCounts > 0 && floorCounts > robustSigma) {
    sigmaCounts = floorCounts;
    scaleSource = "floor";
    floorApplied = true;
  } else {
    sigmaCounts = robustSigma;
    scaleSource = robustSource as "mad" | "iqr";
    floorApplied = floorCounts > 0 && floorCounts >= robustSigma;
  }

  return {
    sigmaCounts,
    medianCounts,
    meanCounts: mean,
    stdCounts: std,
    madCounts,
    iqrCounts,
    scaleSource,
    floorCounts,
    floorApplied,
    sampleCount: values.length,
    scaleCorrection: 1,
  };
}

// S20 stage E (C2): re-express an estimate with the plane-fit deflation
// correction applied. Only a MEASURED robust scale is corrected - a
// quantization floor is not a fit residual and carries no deflation - so a
// noise-free plane fit keeps reporting exactly zero.
function withPlaneScaleCorrection(estimate: BackgroundNoiseEstimate): BackgroundNoiseEstimate {
  if (estimate.scaleSource !== "mad" && estimate.scaleSource !== "iqr") return estimate;
  const correction = backgroundPlaneScaleCorrection(estimate.sampleCount);
  if (!(correction > 1)) return estimate;
  return { ...estimate, sigmaCounts: estimate.sigmaCounts * correction, scaleCorrection: correction };
}

export function estimateBackgroundNoise(image: BackgroundImage, rects: BackgroundRect[]): BackgroundNoiseEstimate {
  validateImage(image);
  validateRects(image, rects);
  let values = collectRectValues(image, rects);
  if (values.length === 0) {
    throw new RangeError("background rectangles contain no finite pixel values");
  }
  // Deterministic stride subsample above the documented exact-statistics cap;
  // sampleCount then reports the subsampled count actually used. The stride is
  // grown until it is coprime with BOTH the image width and the row period of
  // the collected sample list (see below): a stride sharing a factor with
  // either period hits the same columns in every sampled row, so
  // column-fixed-pattern noise (a periodic readout pattern) is aliased out of
  // the sample and the reported sigma collapses to 0. A stride coprime with
  // both keeps the sample phase drifting across rows. Growing the stride only
  // lowers the sampled count floor((n-1)/stride)+1, so it stays under the cap.
  if (values.length > ROBUST_STATS_MAX_EXACT) {
    // The sample list is rect-row-major, so a stride sharing a factor with the
    // ROW PERIOD repeats the same columns in every sampled row just as surely
    // as a stride sharing a factor with the image width does. The period is
    // the rect width on the single-rect fast path (collectRectValues visits the
    // rect row-major directly) and the occupancy bounding-box width for the
    // multi-rect union path (the same order collectRectValues walks).
    let rowPeriodPx: number;
    if (rects.length === 1) {
      rowPeriodPx = rects[0].width;
    } else {
      let periodMinX = Infinity;
      let periodMaxX = -Infinity;
      for (const rect of rects) {
        if (rect.x0 < periodMinX) periodMinX = rect.x0;
        if (rect.x0 + rect.width - 1 > periodMaxX) periodMaxX = rect.x0 + rect.width - 1;
      }
      rowPeriodPx = periodMaxX - periodMinX + 1;
    }
    let stride = Math.ceil(values.length / ROBUST_STATS_MAX_EXACT);
    while (gcd(stride, rowPeriodPx) !== 1 || gcd(stride, image.width) !== 1) stride += 1;
    const subsampled: number[] = [];
    for (let i = 0; i < values.length; i += stride) subsampled.push(values[i]);
    values = subsampled;
  }
  return computeNoiseScale(values, image.dtype);
}

function solveWeightedPlane(
  X: number[],
  Y: number[],
  values: number[],
  weights: number[],
  singularMessage: string,
): { b0: number; bx: number; by: number } {
  const n = values.length;
  let sumW = 0;
  let weightedSumX = 0;
  let weightedSumY = 0;
  let weightedSumV = 0;
  for (let i = 0; i < n; i += 1) {
    const w = weights[i];
    sumW += w;
    weightedSumX += w * X[i];
    weightedSumY += w * Y[i];
    weightedSumV += w * values[i];
  }
  if (!(sumW > 0)) {
    throw new RangeError("degenerate background geometry: all Huber weights vanished (weight collapse)");
  }
  const meanX = weightedSumX / sumW;
  const meanY = weightedSumY / sumW;
  const meanV = weightedSumV / sumW;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxv = 0;
  let syv = 0;
  for (let i = 0; i < n; i += 1) {
    const w = weights[i];
    const xc = X[i] - meanX;
    const yc = Y[i] - meanY;
    const vc = values[i] - meanV;
    sxx += w * xc * xc;
    sxy += w * xc * yc;
    syy += w * yc * yc;
    sxv += w * xc * vc;
    syv += w * yc * vc;
  }
  const detScale = sxx * syy;
  const det = detScale - sxy * sxy;
  if (!Number.isFinite(det) || det <= 0 || det <= 1e-12 * Math.max(detScale, 1e-300)) {
    throw new RangeError(singularMessage);
  }
  const bx = (sxv * syy - syv * sxy) / det;
  const by = (syv * sxx - sxv * sxy) / det;
  const b0 = meanV - bx * meanX - by * meanY;
  return { b0, bx, by };
}

type PlaneFitOutcome =
  // S20 stage E: the geometry was fittable but the reference is too small for
  // the model to mean anything; the caller degrades the method to "none".
  | { degraded: true; sampleCount: number; values: number[] }
  | {
      degraded: false;
      sampleCount: number;
      plane: NonNullable<BackgroundResult["plane"]>;
      xMean: number;
      yMean: number;
      noise: BackgroundNoiseEstimate;
    };

function fitRobustPlane(image: BackgroundImage, rects: BackgroundRect[]): PlaneFitOutcome {
  validateImage(image);
  validateRects(image, rects);
  const samples = collectRectSamples(image, rects);
  const n = samples.length;
  if (n < 3) {
    throw new RangeError("degenerate background geometry: robust-plane needs at least 3 finite samples");
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const values: number[] = [];
  for (const sample of samples) {
    xs.push(sample.x);
    ys.push(sample.y);
    values.push(sample.value);
  }
  const distinctX = new Set(xs).size;
  const distinctY = new Set(ys).size;
  if (distinctX < 2 || distinctY < 2) {
    throw new RangeError(
      "degenerate background geometry: finite rect pixels must cover at least 2 distinct x and at least 2 distinct y coordinates",
    );
  }

  const xMean = xs.reduce((sum, v) => sum + v, 0) / n;
  const yMean = ys.reduce((sum, v) => sum + v, 0) / n;
  const X = xs.map((v) => v - xMean);
  const Y = ys.map((v) => v - yMean);

  // OLS leverage guard: h_i = 1/n + [xc_i, yc_i] * M^-1 * [xc_i, yc_i]^T with
  // M = [[sxx, sxy], [sxy, syy]] over the UNWEIGHTED centred coordinates. This
  // is now the only geometry guard beyond the distinct-coordinate check above:
  // an isolated off-axis pixel (or a 3-sample exactly determined fit) carries
  // h_i = 1 and its own value becomes a slope, so it is rejected even when
  // most samples keep a healthy layout. A non-positive determinant is left to
  // the normal-equation solve below, which reports the singular geometry.
  let leverageSxx = 0;
  let leverageSxy = 0;
  let leverageSyy = 0;
  for (let i = 0; i < n; i += 1) {
    leverageSxx += X[i] * X[i];
    leverageSxy += X[i] * Y[i];
    leverageSyy += Y[i] * Y[i];
  }
  const leverageDet = leverageSxx * leverageSyy - leverageSxy * leverageSxy;
  if (Number.isFinite(leverageDet) && leverageDet > 0) {
    let maxLeverage = 0;
    for (let i = 0; i < n; i += 1) {
      const leverage =
        1 / n +
        (leverageSyy * X[i] * X[i] - 2 * leverageSxy * X[i] * Y[i] + leverageSxx * Y[i] * Y[i]) / leverageDet;
      if (leverage > maxLeverage) maxLeverage = leverage;
    }
    if (maxLeverage > LEVERAGE_MAX) {
      throw new RangeError(
        `degenerate background geometry: a single sample dominates the plane fit (max leverage ${maxLeverage.toFixed(2)})`,
      );
    }
  }

  // S20 stage E (R-47): the minimum-sample rule sits AFTER the geometry
  // guards, so a genuinely unfittable layout still reports itself as such -
  // a three-sample exactly-determined fit, a column plus one off-axis pixel
  // and a single-column reference all keep throwing - while a fittable but
  // statistically empty reference (the 2x2 block, leverage 0.75 everywhere)
  // degrades quietly to the uncorrected image plus a noise-scale notice.
  if (n < BACKGROUND_MIN_REFERENCE_SAMPLES) {
    return { degraded: true, sampleCount: n, values };
  }

  const { min: minValue, max: maxValue } = minMax(values);
  const dataSpan = maxValue - minValue;
  const { min: minX, max: maxX } = minMax(xs);
  const { min: minY, max: maxY } = minMax(ys);
  const xExtent = maxX - minX;
  const yExtent = maxY - minY;
  const scaleB0 = Math.max(dataSpan, 1);
  const scaleBx = Math.max(dataSpan / xExtent, 1e-12);
  const scaleBy = Math.max(dataSpan / yExtent, 1e-12);

  // IRLS residual-scale anchor: 0.5 counts for integer dtypes (unchanged) and
  // FLOAT_ANCHOR_FACTOR * (IQR + |median|) of the fit values for float32, so
  // rounding-level residuals of a numerically exact fit stay inside delta
  // (B1/B2). The IQR is used rather than the 10th-to-90th decile span because
  // the decile span already imports the scale of bright contamination covering
  // more than 10% of the samples, which inflates delta until a real gradient
  // step is no longer downweighted; the IQR survives up to 25%. The |median|
  // term ties the anchor to the value LEVEL because float32 rounding residuals
  // scale with |value|, not with the spread, so a high-offset low-contrast
  // background keeps a usable anchor. When both terms are 0 the fallback is
  // FLOAT_ANCHOR_FACTOR times the smallest positive |value| of the samples: a
  // single-spike field anchors on the outlier's magnitude (which reproduces
  // the old behaviour and prevents the weight-collapse throw), while a
  // secondary 100-count feature anchors at 1e-4 and is genuinely downweighted.
  // All terms are linear in the values, so scale equivariance is exact. If
  // every sample is exactly 0 the anchor is 0 and the 0 <= 0 residual check
  // exits on the first iteration.
  let anchorFloor = INTEGER_FLOOR_COUNTS;
  if (image.dtype === "float32") {
    const sortedValues = sortedCopy(values);
    const valueIqr = quantileOfSorted(sortedValues, 0.75) - quantileOfSorted(sortedValues, 0.25);
    const valueLevelAnchor = FLOAT_ANCHOR_FACTOR * (valueIqr + Math.abs(medianOfSorted(sortedValues)));
    let smallestPositiveMagnitude = Infinity;
    for (const sample of values) {
      const magnitude = Math.abs(sample);
      if (magnitude > 0 && magnitude < smallestPositiveMagnitude) smallestPositiveMagnitude = magnitude;
    }
    const magnitudeAnchor = Number.isFinite(smallestPositiveMagnitude)
      ? FLOAT_ANCHOR_FACTOR * smallestPositiveMagnitude
      : 0;
    anchorFloor = valueLevelAnchor > 0 ? valueLevelAnchor : magnitudeAnchor;
  }

  // Start point: ordinary least squares on the centred normal equations.
  let params = solveWeightedPlane(
    X,
    Y,
    values,
    new Array<number>(n).fill(1),
    "degenerate background geometry: normal equations are singular",
  );

  let iterations = 0;
  let converged = false;
  let huberDeltaCounts = 0;
  for (let iter = 1; iter <= MAX_IRLS_ITERATIONS; iter += 1) {
    const residuals: number[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      residuals[i] = values[i] - (params.b0 + params.bx * X[i] + params.by * Y[i]);
    }
    const sortedResiduals = sortedCopy(residuals);
    const medianResidual = medianOfSorted(sortedResiduals);
    const deviations = sortedResiduals.map((r) => Math.abs(r - medianResidual));
    deviations.sort((a, b) => a - b);
    const madResidual = medianOfSorted(deviations);
    const sigmaScale = Math.max(MAD_SCALE * madResidual, anchorFloor);
    const { min: minResidual, max: maxResidual } = minMax(residuals);
    const residualsInsideFloor = maxResidual <= anchorFloor && minResidual >= -anchorFloor;
    if (residualsInsideFloor) {
      converged = true;
      huberDeltaCounts = HUBER_DELTA_FACTOR * sigmaScale;
      break;
    }
    const delta = HUBER_DELTA_FACTOR * sigmaScale;
    huberDeltaCounts = delta;
    const weights: number[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const absResidual = Math.abs(residuals[i]);
      weights[i] = absResidual <= delta ? 1 : delta / absResidual;
    }
    const next = solveWeightedPlane(
      X,
      Y,
      values,
      weights,
      "degenerate background geometry: weighted normal equations became singular during IRLS",
    );
    const relativeChange = Math.max(
      Math.abs(next.b0 - params.b0) / scaleB0,
      Math.abs(next.bx - params.bx) / scaleBx,
      Math.abs(next.by - params.by) / scaleBy,
    );
    params = next;
    iterations = iter;
    if (relativeChange <= PARAM_REL_TOLERANCE) {
      converged = true;
      break;
    }
  }

  const finalResiduals: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    finalResiduals[i] = values[i] - (params.b0 + params.bx * X[i] + params.by * Y[i]);
  }
  // S20 stage E (C2): the residuals of a plane fitted on these same samples
  // are deflated; the measured correction is applied here so every consumer of
  // result.noise sees the same number.
  const noise = withPlaneScaleCorrection(computeNoiseScale(finalResiduals, image.dtype));
  return {
    degraded: false,
    sampleCount: n,
    plane: {
      b0Counts: params.b0,
      bxCountsPerPx: params.bx,
      byCountsPerPx: params.by,
      xMeanPx: xMean,
      yMeanPx: yMean,
      iterations,
      converged,
      huberDeltaCounts,
    },
    xMean,
    yMean,
    noise,
  };
}

// S20 stage E (C5): the reference-trend statistic. Each rect is measured as
// drawn (no union deduplication - overlapping rects are legal but a
// deliberately duplicated rect simply contributes the same median twice, which
// cannot create a trend), and the normalizer is the POOLED in-rect scatter, so
// a common pedestal, a symmetric beam tail and unequal rect sizes all drop out.
function computeReferenceTrend(image: BackgroundImage, rects: BackgroundRect[]): BackgroundReferenceTrend {
  const unavailable = (
    reason: NonNullable<BackgroundReferenceTrend["unavailableReason"]>,
    rectCount: number,
    withinScatterCounts = 0,
  ): BackgroundReferenceTrend => ({
    rectCount,
    trendCounts: 0,
    uncertaintyCounts: 0,
    ratio: null,
    withinScatterCounts,
    detected: false,
    unavailableReason: reason,
  });

  const stats: { x: number; y: number; median: number; count: number }[] = [];
  const pooledDeviations: number[] = [];
  for (const rect of rects) {
    const values: number[] = [];
    let sumX = 0;
    let sumY = 0;
    for (let y = rect.y0; y < rect.y0 + rect.height; y += 1) {
      const row = y * image.width;
      for (let x = rect.x0; x < rect.x0 + rect.width; x += 1) {
        const value = image.pixels[row + x];
        if (!Number.isFinite(value)) continue;
        values.push(value);
        sumX += x;
        sumY += y;
      }
    }
    if (values.length === 0) continue;
    const sorted = sortedCopy(values);
    const rectMedian = medianOfSorted(sorted);
    // A one-sample rect has no deviation to contribute; it still carries a
    // median and takes part in the trend.
    if (values.length >= 2) {
      for (const value of values) pooledDeviations.push(Math.abs(value - rectMedian));
    }
    stats.push({ x: sumX / values.length, y: sumY / values.length, median: rectMedian, count: values.length });
  }

  const rectCount = stats.length;
  if (rectCount < BACKGROUND_GRADIENT_MIN_RECTS) return unavailable("too-few-rects", rectCount);
  if (pooledDeviations.length < BACKGROUND_GRADIENT_MIN_POOLED_DEVIATIONS) {
    return unavailable("no-in-rect-scatter", rectCount);
  }
  pooledDeviations.sort((a, b) => a - b);
  const withinScatterCounts = MAD_SCALE * medianOfSorted(pooledDeviations);
  if (!(withinScatterCounts > 0)) return unavailable("no-in-rect-scatter", rectCount, withinScatterCounts);

  const xMean = stats.reduce((sum, s) => sum + s.x, 0) / rectCount;
  const yMean = stats.reduce((sum, s) => sum + s.y, 0) / rectCount;
  const medianMean = stats.reduce((sum, s) => sum + s.median, 0) / rectCount;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxv = 0;
  let syv = 0;
  for (const s of stats) {
    const xc = s.x - xMean;
    const yc = s.y - yMean;
    const vc = s.median - medianMean;
    sxx += xc * xc;
    sxy += xc * yc;
    syy += yc * yc;
    sxv += xc * vc;
    syv += yc * vc;
  }
  const detScale = sxx * syy;
  const det = detScale - sxy * sxy;
  if (!Number.isFinite(det) || det <= 0 || det <= 1e-12 * Math.max(detScale, 1e-300)) {
    return unavailable("collinear-rects", rectCount, withinScatterCounts);
  }
  const bx = (sxv * syy - syv * sxy) / det;
  const by = (syv * sxx - sxv * sxy) / det;

  let highValue = -Infinity;
  let lowValue = Infinity;
  let highCount = 0;
  let lowCount = 0;
  for (const s of stats) {
    const fitted = medianMean + bx * (s.x - xMean) + by * (s.y - yMean);
    if (fitted > highValue) {
      highValue = fitted;
      highCount = s.count;
    }
    if (fitted < lowValue) {
      lowValue = fitted;
      lowCount = s.count;
    }
  }
  const trendCounts = highValue - lowValue;
  const uncertaintyCounts = MEDIAN_STANDARD_ERROR_FACTOR * withinScatterCounts * Math.sqrt(1 / highCount + 1 / lowCount);
  return {
    rectCount,
    trendCounts,
    uncertaintyCounts,
    ratio: uncertaintyCounts > 0 ? trendCounts / uncertaintyCounts : null,
    withinScatterCounts,
    detected: trendCounts > BACKGROUND_GRADIENT_TREND_K * uncertaintyCounts,
    unavailableReason: null,
  };
}

export function applyBackground(image: BackgroundImage, config: BackgroundConfig): BackgroundResult {
  validateImage(image);
  const { pixels, width, height } = image;
  const count = width * height;
  let corrected: Float64Array;
  let offsetCounts: number | undefined;
  let plane: NonNullable<BackgroundResult["plane"]> | undefined;
  let noise: BackgroundNoiseEstimate | undefined;
  // S20 stage E: the method actually applied, which is "none" whenever the
  // reference was too small to support the requested one.
  let appliedMethod: BackgroundConfig["method"] = config.method;
  let degradedReason: BackgroundResult["degradedReason"];
  let referenceSampleCount: number | undefined;
  let referenceTrend: BackgroundReferenceTrend | undefined;

  switch (config.method) {
    case "none": {
      corrected = Float64Array.from(pixels as ArrayLike<number>);
      break;
    }
    case "manual-offset": {
      if (!Number.isFinite(config.offsetCounts)) {
        throw new RangeError("manual-offset offsetCounts must be a finite number");
      }
      offsetCounts = config.offsetCounts;
      corrected = new Float64Array(count);
      for (let i = 0; i < count; i += 1) corrected[i] = pixels[i] - offsetCounts;
      break;
    }
    case "dark-frame": {
      const dark = config.darkPixels;
      if (dark.length !== config.darkWidth * config.darkHeight) {
        throw new RangeError(
          `dark frame pixels.length ${dark.length} does not match darkWidth*darkHeight ${config.darkWidth * config.darkHeight}`,
        );
      }
      if (config.darkWidth !== width || config.darkHeight !== height) {
        throw new RangeError(
          `dark frame dimensions ${config.darkWidth}x${config.darkHeight} do not match image dimensions ${width}x${height}`,
        );
      }
      if (config.darkDtype !== image.dtype) {
        throw new RangeError(`dark frame dtype ${config.darkDtype} does not match image dtype ${image.dtype}`);
      }
      corrected = new Float64Array(count);
      for (let i = 0; i < count; i += 1) {
        const value = pixels[i];
        const darkValue = dark[i];
        if (!Number.isFinite(value)) {
          // A non-finite image value passes through unchanged only when the
          // dark pixel is finite; two non-finite values cannot be subtracted
          // meaningfully and produce NaN instead of a spurious +Infinity.
          corrected[i] = Number.isFinite(darkValue) ? value : Number.NaN;
        } else if (!Number.isFinite(darkValue)) {
          corrected[i] = Number.NaN;
        } else {
          corrected[i] = value - darkValue;
        }
      }
      break;
    }
    case "rect-median": {
      noise = estimateBackgroundNoise(image, config.rects);
      referenceSampleCount = noise.sampleCount;
      referenceTrend = computeReferenceTrend(image, config.rects);
      if (noise.sampleCount < BACKGROUND_MIN_REFERENCE_SAMPLES) {
        // S20 stage E (C3/R-47): the offset is not applied at all. A 1x1
        // reference on a hot defect used to become the whole-image offset and
        // over-subtract every pixel; the honest answer is the uncorrected
        // image plus a noise-scale notice, not a plausible-looking wrong one.
        appliedMethod = "none";
        degradedReason = "insufficient-reference-samples";
        corrected = Float64Array.from(pixels as ArrayLike<number>);
        break;
      }
      offsetCounts = noise.medianCounts;
      corrected = new Float64Array(count);
      for (let i = 0; i < count; i += 1) {
        const value = pixels[i];
        corrected[i] = Number.isFinite(value) ? value - offsetCounts : value;
      }
      break;
    }
    case "robust-plane": {
      const fit = fitRobustPlane(image, config.rects);
      referenceSampleCount = fit.sampleCount;
      if (fit.degraded) {
        // Same regime as rect-median: no plane is applied. R-17's "the plane
        // correction survives" clause is struck - a plane carried by fewer
        // than BACKGROUND_MIN_REFERENCE_SAMPLES samples is not a background
        // model, it is three numbers read off the noise.
        appliedMethod = "none";
        degradedReason = "insufficient-reference-samples";
        noise = computeNoiseScale(fit.values, image.dtype);
        corrected = Float64Array.from(pixels as ArrayLike<number>);
        break;
      }
      const fittedPlane = fit.plane;
      const center = { xMean: fit.xMean, yMean: fit.yMean };
      plane = fittedPlane;
      noise = fit.noise;
      corrected = new Float64Array(count);
      for (let y = 0; y < height; y += 1) {
        const row = y * width;
        for (let x = 0; x < width; x += 1) {
          const i = row + x;
          const value = pixels[i];
          if (!Number.isFinite(value)) {
            corrected[i] = value;
          } else {
            corrected[i] =
              value -
              (fittedPlane.b0Counts +
                fittedPlane.bxCountsPerPx * (x - center.xMean) +
                fittedPlane.byCountsPerPx * (y - center.yMean));
          }
        }
      }
      break;
    }
  }

  let negativeCountAfter = 0;
  let finiteCount = 0;
  for (let i = 0; i < count; i += 1) {
    const value = corrected[i];
    if (!Number.isFinite(value)) continue;
    finiteCount += 1;
    if (value < 0) negativeCountAfter += 1;
  }
  const negativeFractionAfter = finiteCount > 0 ? negativeCountAfter / finiteCount : 0;

  const result: BackgroundResult = {
    corrected,
    method: appliedMethod,
    requestedMethod: config.method,
    negativeCountAfter,
    negativeFractionAfter,
  };
  if (offsetCounts !== undefined) result.offsetCounts = offsetCounts;
  if (plane !== undefined) result.plane = plane;
  if (noise !== undefined) result.noise = noise;
  if (degradedReason !== undefined) result.degradedReason = degradedReason;
  if (referenceSampleCount !== undefined) result.referenceSampleCount = referenceSampleCount;
  if (referenceTrend !== undefined) result.referenceTrend = referenceTrend;
  return result;
}
