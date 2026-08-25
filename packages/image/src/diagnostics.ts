import {
  dtypeSaturationLimit,
  type ImageAnalyzerConfig,
  type ImageDtype,
  type ImagePixelArray,
} from "./contracts.ts";
import {
  CLIPPING_MAX_LIMIT_FRACTION,
  CLIPPING_MIN_COUNT,
  CLIPPING_MIN_FRACTION,
  EDGE_TOUCH_EVT_MARGIN,
  EDGE_TOUCH_FRACTION,
  HISTOGRAM_BIN_COUNT,
  HOT_PIXEL_K,
  LOCAL_MAX_K,
  ROBUST_STATS_MAX_EXACT,
} from "./thresholds.ts";

// Scale factor turning the median absolute deviation into a robust sigma.
const MAD_SCALE = 1.4826;

export type ImageDiagnostics = {
  width: number;
  height: number;
  dtype: ImageDtype;
  pixelCount: number;
  finiteCount: number;
  nonFiniteCount: number;
  minValue: number;
  maxValue: number;
  dynamicRange: number;
  medianValue: number;
  madSigmaValue: number;
  histogram: {
    binCount: number;
    binWidthCounts: number;
    minValue: number;
    maxValue: number;
    counts: number[];
  };
  saturationLimitCounts: number | null;
  saturatedCount: number;
  saturatedFraction: number;
  zeroCount: number;
  negativeCount: number;
  hotPixelCandidateCount: number;
  rimMeanValue: number;
  rimMaxValue: number;
  edgeTouch: boolean;
  localMaximaCount: number;
  // Count of finite pixels exactly equal to maxValue (S18 review G6): a
  // smooth beam has a unique maximum (1), while a clipped plateau (sensor
  // saturation below the dtype limit, e.g. a 12-bit sensor at 4095 stored in
  // uint16) has many pixels tied at the exact same value.
  maxValueCount: number;
  // True when many finite pixels sit exactly at maxValue AND maxValue is
  // well below the dtype saturation limit - a clipped plateau the plain
  // saturatedFraction/IMAGE_SATURATION check (limit-relative) never sees.
  // See the predicate comment at its computation site below.
  clippingSuspect: boolean;
};

function medianOfSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// Greatest common divisor of two non-negative integers; used to keep the
// diagnostics subsample stride coprime with the image width (FIX 3,
// review round B), mirroring background.ts.
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

// Diagnostic statistics for a raw image. Non-finite values (NaN, +Infinity,
// -Infinity) are excluded from every statistic except nonFiniteCount; the
// input pixel array is never mutated and the result is deterministic.
export function computeImageDiagnostics(
  image: {
    pixels: ImagePixelArray | number[];
    width: number;
    height: number;
    dtype: ImageDtype;
  },
  config?: ImageAnalyzerConfig,
): ImageDiagnostics {
  const { pixels, width, height, dtype } = image;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("image width and height must be positive integers");
  }
  const pixelCount = width * height;
  if (pixels.length !== pixelCount) {
    throw new RangeError(`pixels.length ${pixels.length} does not match width*height ${pixelCount}`);
  }

  const saturationLimitCounts = dtypeSaturationLimit(dtype, config);

  // Main pass: per-pixel statistics over finite values only.
  const finiteValues: number[] = [];
  let finiteCount = 0;
  let nonFiniteCount = 0;
  let minValue = Infinity;
  let maxValue = -Infinity;
  let zeroCount = 0;
  let negativeCount = 0;
  let saturatedCount = 0;
  let rimSum = 0;
  let rimCount = 0;
  let rimMax = -Infinity;

  for (let index = 0; index < pixelCount; index += 1) {
    const value = pixels[index];
    if (!Number.isFinite(value)) {
      nonFiniteCount += 1;
      continue;
    }
    finiteCount += 1;
    finiteValues.push(value);
    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;
    if (value === 0) zeroCount += 1;
    if (value < 0) negativeCount += 1;
    if (saturationLimitCounts !== null && value >= saturationLimitCounts) saturatedCount += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
      rimSum += value;
      rimCount += 1;
      if (value > rimMax) rimMax = value;
    }
  }

  const hasFinite = finiteCount > 0;
  minValue = hasFinite ? minValue : 0;
  maxValue = hasFinite ? maxValue : 0;
  const dynamicRange = maxValue - minValue;

  // Clipped-plateau detection (S18 review G6): a sensor that clips below its
  // dtype's full range (e.g. a 12-bit sensor at 4095 stored in a uint16
  // buffer, limit 65535) never trips the plain saturatedFraction check,
  // which only compares against the dtype limit. A plateau instead shows up
  // as many finite pixels tied at the EXACT same (non-limit) maximum value;
  // a smooth beam's maximum is a unique pixel (count 1). CLIPPING_MIN_COUNT
  // and CLIPPING_MIN_FRACTION are calibrated to require BOTH a small
  // absolute count and a small fraction, so a tiny image cannot trip on
  // count alone and a huge image cannot trip on a few coincidental ties;
  // CLIPPING_MAX_LIMIT_FRACTION keeps this predicate disjoint from a proper
  // full-range saturation (maxValue at or near the dtype limit keeps only
  // the existing IMAGE_SATURATION channel).
  let maxValueCount = 0;
  if (hasFinite) {
    for (const value of finiteValues) {
      if (value === maxValue) maxValueCount += 1;
    }
  }

  // Histogram: equal-width bins over [minValue, maxValue]. maxValue always
  // lands in the last bin; when min == max all finite values go to bin 0.
  const binCount = HISTOGRAM_BIN_COUNT;
  const counts = new Array<number>(binCount).fill(0);
  const binWidthCounts = hasFinite && dynamicRange > 0 ? dynamicRange / binCount : 0;
  if (hasFinite) {
    for (const value of finiteValues) {
      let bin = 0;
      if (binWidthCounts > 0) {
        bin = Math.floor((value - minValue) / binWidthCounts);
        if (bin < 0) bin = 0;
        if (bin >= binCount) bin = binCount - 1;
      }
      counts[bin] += 1;
    }
  }

  // Robust median and scaled median absolute deviation from a sorted copy of
  // the finite values. Above the exact limit a deterministic stride subsample
  // (always starting at index 0) keeps the sort bounded. FIX 3 (review round
  // B): the stride is grown until it is coprime with the image width so a
  // column-periodic pattern whose period divides the stride is not aliased
  // out of the sample (same guard as background.ts).
  let medianValue = 0;
  let madSigmaValue = 0;
  if (hasFinite) {
    let sample = finiteValues;
    if (finiteValues.length > ROBUST_STATS_MAX_EXACT) {
      let stride = Math.ceil(finiteValues.length / ROBUST_STATS_MAX_EXACT);
      while (gcd(stride, width) !== 1) stride += 1;
      sample = [];
      for (let i = 0; i < finiteValues.length; i += stride) sample.push(finiteValues[i]);
    }
    const sorted = sample.slice().sort((a, b) => a - b);
    medianValue = medianOfSorted(sorted);
    const deviations = sorted.map((value) => Math.abs(value - medianValue));
    deviations.sort((a, b) => a - b);
    madSigmaValue = MAD_SCALE * medianOfSorted(deviations);
  }

  const saturatedFraction = hasFinite ? saturatedCount / finiteCount : 0;

  // Hot-pixel candidates: a spike whose value exceeds the largest finite
  // 4-neighbour by more than HOT_PIXEL_K robust sigmas. A positive robust
  // sigma is required, so a lone spike on a perfectly flat background never
  // trips (the median absolute deviation is then zero).
  let hotPixelCandidateCount = 0;
  if (madSigmaValue > 0) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = pixels[x + y * width];
        if (!Number.isFinite(value)) continue;
        let maxNeighbor = -Infinity;
        let hasFiniteNeighbor = false;
        if (x > 0) {
          const neighbor = pixels[(x - 1) + y * width];
          if (Number.isFinite(neighbor)) {
            maxNeighbor = neighbor;
            hasFiniteNeighbor = true;
          }
        }
        if (x < width - 1) {
          const neighbor = pixels[(x + 1) + y * width];
          if (Number.isFinite(neighbor)) {
            if (neighbor > maxNeighbor) maxNeighbor = neighbor;
            hasFiniteNeighbor = true;
          }
        }
        if (y > 0) {
          const neighbor = pixels[x + (y - 1) * width];
          if (Number.isFinite(neighbor)) {
            if (neighbor > maxNeighbor) maxNeighbor = neighbor;
            hasFiniteNeighbor = true;
          }
        }
        if (y < height - 1) {
          const neighbor = pixels[x + (y + 1) * width];
          if (Number.isFinite(neighbor)) {
            if (neighbor > maxNeighbor) maxNeighbor = neighbor;
            hasFiniteNeighbor = true;
          }
        }
        if (!hasFiniteNeighbor) continue;
        if (value - maxNeighbor > HOT_PIXEL_K * madSigmaValue) hotPixelCandidateCount += 1;
      }
    }
  }

  // Local maxima: strict 8-neighbour maxima for inner pixels only, with an
  // additional background threshold. With zero robust sigma only the strict
  // maximum plus value > medianValue applies.
  let localMaximaCount = 0;
  if (width >= 3 && height >= 3) {
    for (let y = 1; y <= height - 2; y += 1) {
      for (let x = 1; x <= width - 2; x += 1) {
        const value = pixels[x + y * width];
        if (!Number.isFinite(value)) continue;
        let strictMaximum = true;
        for (let dy = -1; dy <= 1 && strictMaximum; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const neighbor = pixels[(x + dx) + (y + dy) * width];
            if (Number.isFinite(neighbor) && value <= neighbor) {
              strictMaximum = false;
              break;
            }
          }
        }
        if (!strictMaximum) continue;
        const threshold = madSigmaValue > 0 ? medianValue + LOCAL_MAX_K * madSigmaValue : medianValue;
        if (value > threshold) localMaximaCount += 1;
      }
    }
  }

  const rimMeanValue = rimCount > 0 ? rimSum / rimCount : 0;
  const rimMaxValue = rimCount > 0 ? rimMax : 0;
  // FIX 4 (review round B): signal-relative edge-touch test. The LOCAL_MAX_K
  // significance bar rejects pure-noise frames (their max-median span is only
  // a few robust sigmas), and the median-relative rim term restores
  // sensitivity to an interior-peak beam whose truncated flank sits on the
  // border. Both terms must clear their thresholds.
  const signalSignificant = (maxValue - medianValue) > LOCAL_MAX_K * madSigmaValue;
  // S18 review G5 fix: EDGE_TOUCH_FRACTION alone has no noise term, so on a
  // centred beam at moderate SNR the rim ring's own noise fluctuation alone
  // clears 10 percent of (max - median) almost every time (measured: 99.5
  // percent of clean centred beams at SNR 20 falsely touched, with the true
  // beam edge >= 7 sigma from the border). The rim is a ring of rimCount iid
  // (under the null) samples around a smooth background, so its expected
  // MAXIMUM fluctuation above the median scales with the same extreme-value
  // form the multi-peak gate already uses: robust sigma times
  // sqrt(2*ln(rimPixelCount)), plus a margin. The rim only "carries signal"
  // when it clears the LARGER of the plain fraction test and this
  // noise-aware extreme-value floor - a beam genuinely close to the border
  // still clears both easily (its rim values are real signal, not noise
  // extremes).
  const rimNoiseFloor =
    madSigmaValue * (Math.sqrt(2 * Math.log(Math.max(1, rimCount))) + EDGE_TOUCH_EVT_MARGIN);
  const rimSignalThreshold = Math.max(EDGE_TOUCH_FRACTION * (maxValue - medianValue), rimNoiseFloor);
  const rimCarriesSignal = (rimMaxValue - medianValue) > rimSignalThreshold;
  const edgeTouch = signalSignificant && rimCarriesSignal;

  // S18 review G6 fix: a clipped plateau below the dtype limit (e.g. a
  // 12-bit sensor's 4095 ceiling stored in uint16, limit 65535) never trips
  // the plain saturatedFraction/limit check. Flag it only when BOTH a
  // meaningful absolute count and a meaningful fraction of finite pixels sit
  // exactly at the maximum (a smooth beam's unique-pixel maximum, count 1,
  // never trips either arm) AND the maximum sits comfortably below the dtype
  // limit (a maximum at or near the limit is a proper full-range saturation,
  // already covered by IMAGE_SATURATION, and is deliberately excluded here
  // so the two warnings stay disjoint).
  const clippingSuspect =
    hasFinite &&
    saturationLimitCounts !== null &&
    maxValue < CLIPPING_MAX_LIMIT_FRACTION * saturationLimitCounts &&
    maxValueCount > CLIPPING_MIN_COUNT &&
    maxValueCount > CLIPPING_MIN_FRACTION * finiteCount;

  return {
    width,
    height,
    dtype,
    pixelCount,
    finiteCount,
    nonFiniteCount,
    minValue,
    maxValue,
    dynamicRange,
    medianValue,
    madSigmaValue,
    histogram: {
      binCount,
      binWidthCounts,
      minValue,
      maxValue,
      counts,
    },
    saturationLimitCounts,
    saturatedCount,
    saturatedFraction,
    zeroCount,
    negativeCount,
    hotPixelCandidateCount,
    rimMeanValue,
    rimMaxValue,
    edgeTouch,
    localMaximaCount,
    maxValueCount,
    clippingSuspect,
  };
}
