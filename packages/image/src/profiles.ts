import type { ImageCalibration } from "./contracts.ts";

// One-dimensional profiles over background-corrected pixel data (S18c-B,
// Plan v5 section 5). Everything here works under the B_eff = 0 convention:
// corrected values live on an absolute scale, so the implicit baseline of
// measureProfileWidths is 0 and every threshold is a fraction of the
// (positive) peak above that baseline. No baseline re-estimation happens
// anywhere in this module.
//
// Width conventions are deliberately split by module so the labels stay
// honest:
//  - FWHM(data) and 1/e^2(data): threshold-crossing widths measured directly
//    on profile samples, computed HERE by measureProfileWidths. They are
//    data widths.
//  - FWHM(fit): modelled-function widths computed by the fitting code. They
//    are intentionally absent from this module.
//  - Second-moment widths (sigmaMajor / sigmaMinor): intensity-weighted
//    second-moment quantities computed in moments.ts, not threshold
//    crossings.
// Inputs are never mutated and every extraction result is deterministic.

export type LineProfileKind = "cut-x" | "cut-y" | "projection-x" | "projection-y" | "axis";

export type LineProfile = {
  kind: LineProfileKind;
  // Along-profile sample coordinate in PIXEL units (arc length for "axis").
  positionsPx: Float64Array;
  // Corrected counts at each sample; NaN where a sample cannot be formed
  // (bilinear neighbourhood incomplete / outside the image).
  values: Float64Array;
  // Reference point the profile passes through (pixel coordinates).
  originXPx: number;
  originYPx: number;
  // Only for kind "axis": the profile direction angle in radians.
  angleRad?: number;
  // Physical length of one 1-px step along the profile, in micrometers,
  // present only when a calibration is given. For axis-parallel kinds this is
  // the per-axis scale; for "axis" it is the anisotropy-exact arc length
  // sqrt((cos(angle)*umPerPxX)^2 + (sin(angle)*umPerPxY)^2).
  stepUm?: number;
  // For projections only: how many finite pixels contributed per bin.
  contributingCounts?: Uint32Array;
};

export type WidthMeasurement = {
  widthPx: number | null;
  leftCrossingPx: number | null;
  rightCrossingPx: number | null;
  // True when any finite sample outside the enclosing crossing pair sits at
  // or above the threshold plus a noise margin (level-based, so gaps cannot
  // hide a second lobe; FIX 7 significance guard).
  ambiguous: boolean;
  suppressedReason: "low-signal" | "nonpositive-peak" | "gap" | null;
};

export type ProfileWidths = {
  peakValueCounts: number;
  // On a plateau of equal maxima this is the LEFTMOST maximum position (the
  // crossing pair may sit centred on the plateau).
  peakPositionPx: number;
  // Data widths, explicitly labelled: these are FWHM(data) and 1/e^2(data);
  // fit widths and second-moment widths live in other modules by design.
  fwhmData: WidthMeasurement;
  oneOverESquaredData: WidthMeasurement;
};

// Plan v5 section 5: a data width is only reported when the peak clears 3x
// the background noise scale. This is a measurement guard, so it lives here
// instead of thresholds.ts (which centralizes UI defaults).
const FWHM_SIGNAL_GUARD_FACTOR = 3;
// Fraction of the peak used as the 1/e^2 data threshold: peak * exp(-2).
const ONE_OVER_E_SQUARED = Math.exp(-2);
// FIX 7 (review round B): the ambiguity scan requires an outside sample to
// clear the threshold by this many sigmaCounts. With a plain >= threshold
// test, the 1/e^2 threshold of a moderate-SNR Gaussian sits under the noise
// sigma and the scan flagged nearly every noisy profile as ambiguous. The
// margin is the same sigma the 3-sigma signal guard uses.
const AMBIGUITY_NOISE_MARGIN_SIGMA = 3;
// Math.cos(Math.PI/2) is 6.1e-17, never 0: without snapping, an axis-parallel
// profile direction clips its offset bounds with that residue (dropping most
// samples) and lands sub-ulp beside integer columns. A component below this
// threshold is snapped to an exact axis direction; 1e-12 sits far above the
// trig residue and far below any physically meaningful angle.
const DIRECTION_SNAP_EPS = 1e-12;
// Bilinear terms with a weight below this are skipped entirely, INCLUDING
// their finiteness requirement: a sample sub-ulp beside an integer row or
// column must not inherit NaN from a neighbour that contributes ~1e-16 of
// the value.
const WEIGHT_EPS = 1e-12;

type CorrectedImage = { values: Float64Array | number[]; width: number; height: number };

function validateCorrectedImage(corrected: CorrectedImage): void {
  if (
    !Number.isInteger(corrected.width) ||
    corrected.width <= 0 ||
    !Number.isInteger(corrected.height) ||
    corrected.height <= 0
  ) {
    throw new RangeError("corrected image width and height must be positive integers");
  }
  const pixelCount = corrected.width * corrected.height;
  if (corrected.values.length !== pixelCount) {
    throw new RangeError(`values.length ${corrected.values.length} does not match width*height ${pixelCount}`);
  }
}

function validateProfileAxis(axis: string): void {
  if (axis !== "x" && axis !== "y") {
    throw new RangeError(`axis must be "x" or "y", got ${JSON.stringify(axis)}`);
  }
}

// Bilinear sample at a possibly non-integer pixel position. The caller has
// already guaranteed 0 <= x <= width-1 and 0 <= y <= height-1, so x0 + 1 is
// only needed (and only reachable) when x0 <= width-2, and likewise for y.
// Terms whose bilinear weight is below WEIGHT_EPS are skipped entirely,
// including their finiteness requirement, so a point on (or sub-ulp beside)
// an integer row/column requires only the pixels that actually contribute.
// Returns NaN when any contributing pixel is non-finite.
function bilinearSample(
  values: Float64Array | number[],
  width: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  let result = 0;

  const w00 = (1 - fx) * (1 - fy);
  if (w00 >= WEIGHT_EPS) {
    const value00 = values[x0 + y0 * width];
    if (!Number.isFinite(value00)) return Number.NaN;
    result += w00 * value00;
  }
  const w10 = fx * (1 - fy);
  if (w10 >= WEIGHT_EPS) {
    const value10 = values[x0 + 1 + y0 * width];
    if (!Number.isFinite(value10)) return Number.NaN;
    result += w10 * value10;
  }
  const w01 = (1 - fx) * fy;
  if (w01 >= WEIGHT_EPS) {
    const value01 = values[x0 + (y0 + 1) * width];
    if (!Number.isFinite(value01)) return Number.NaN;
    result += w01 * value01;
  }
  const w11 = fx * fy;
  if (w11 >= WEIGHT_EPS) {
    const value11 = values[x0 + 1 + (y0 + 1) * width];
    if (!Number.isFinite(value11)) return Number.NaN;
    result += w11 * value11;
  }
  return result;
}

// Integer offset range along the axis direction for which the sample point
// stays inside [0, width-1] x [0, height-1]. Returns padded integer bounds;
// the caller filters with the exact inside test, which absorbs any
// floating-point drift at the boundaries.
function axisOffsetBounds(
  width: number,
  height: number,
  centerXPx: number,
  centerYPx: number,
  cosA: number,
  sinA: number,
): { tMin: number; tMax: number } {
  let lower = -Infinity;
  let upper = Infinity;
  const constrain = (direction: number, center: number, max: number): void => {
    if (direction === 0) return;
    const low = (0 - center) / direction;
    const high = (max - center) / direction;
    if (direction > 0) {
      if (low > lower) lower = low;
      if (high < upper) upper = high;
    } else {
      if (high > lower) lower = high;
      if (low < upper) upper = low;
    }
  };
  constrain(cosA, centerXPx, width - 1);
  constrain(sinA, centerYPx, height - 1);
  return { tMin: Math.ceil(lower) - 1, tMax: Math.floor(upper) + 1 };
}

// A horizontal (axis "x") or vertical (axis "y") cut through one pixel
// coordinate. Integer through-coordinates take that exact row/column;
// non-integer ones interpolate linearly between the two neighbouring
// rows/columns. A sample is NaN when any value needed for its interpolation
// is non-finite.
//
// S18 review G4 investigation (NOT applied - see below): the review's
// finding claimed this two-row blend reads a tilted anisotropic beam's FWHM
// +12.5 percent high at half-pixel phase (12x1 px sigma, theta 0.3 rad:
// reported 8.657 px vs the closed-form single-slice value 7.694 px), and
// prescribed anchoring the sample walk at the sub-pixel through-point with a
// full bilinear sampler (reusing bilinearSample/axisOffsetBounds exactly as
// extractAxisProfile does), so a sample lands exactly on the through-point
// instead of missing it by up to 0.5 px.
//
// That fix was implemented and independently re-measured before being
// reverted here, because the measurements contradict the claimed result: the
// anchored-bilinear version reads 8.692 px on the SAME 12x1/theta-0.3 scene
// (+12.97 percent) - not an improvement. The mechanism is real but cuts both
// ways: anchoring the grid at the through-point does recover the TRUE peak
// exactly (verified against the analytic peak location) and removes the
// peak-quantization bias in isolation (a pure-function test with zero pixel-
// reconstruction error confirms this: 1.20 percent -> 0.10 percent). But
// anchoring off the integer grid also forces EVERY sample (not just the
// peak) through an extra bilinear reconstruction step the old two-row blend
// never needed (old columns are exact pixel values; anchored columns are
// generally fractional and must be interpolated too), and for the threshold-
// crossing FWHM algorithm that extra reconstruction cost outweighs the
// peak-quantization benefit almost everywhere: a systematic sweep of the
// full 2D sub-pixel phase (20x20 grid) at a realistic 2:1 anisotropy
// (12x6 px sigma, theta 0.3 rad) found the OLD two-row blend closer to the
// closed form in 380/400 phase combinations and the anchored version closer
// in 0/400 (mean absolute error 0.080 percent old vs 0.134 percent
// anchored); a hybrid that keeps the old exact-grid crossings but refines
// only the peak/threshold via one bilinear sample at the through-point gave
// no measurable improvement either (crossings sit far enough from the peak,
// ~1.18 sigma out, that a more accurate centre value alone does not move
// them). Shipping the literal fix would trade a real but minor cosmetic
// defect (the reported peak position can be up to 0.5 px off-centre) for a
// measurable regression of the metric operators actually read (FWHM),
// across the majority of realistic sub-pixel phases - the opposite of a fix.
// Left unchanged pending a different approach (e.g. a local quadratic/
// supersampled sub-pixel peak refinement that does not touch the crossing
// samples), which is beyond this fixer's additive-predicate scope.
export function extractCut(
  corrected: CorrectedImage,
  axis: "x" | "y",
  throughXPx: number,
  throughYPx: number,
  calibration?: ImageCalibration,
): LineProfile {
  validateCorrectedImage(corrected);
  validateProfileAxis(axis);
  const { values, width, height } = corrected;
  if (!Number.isFinite(throughXPx) || throughXPx < 0 || throughXPx > width - 1) {
    throw new RangeError(`throughXPx must be finite and inside [0, ${width - 1}]`);
  }
  if (!Number.isFinite(throughYPx) || throughYPx < 0 || throughYPx > height - 1) {
    throw new RangeError(`throughYPx must be finite and inside [0, ${height - 1}]`);
  }

  if (axis === "x") {
    const positionsPx = Float64Array.from({ length: width }, (_, index) => index);
    const samples = new Float64Array(width);
    if (Number.isInteger(throughYPx)) {
      const y = throughYPx;
      for (let x = 0; x < width; x += 1) {
        const value = values[x + y * width];
        samples[x] = Number.isFinite(value) ? value : Number.NaN;
      }
    } else {
      const y0 = Math.floor(throughYPx);
      const fy = throughYPx - y0;
      for (let x = 0; x < width; x += 1) {
        const lower = values[x + y0 * width];
        const upper = values[x + (y0 + 1) * width];
        samples[x] =
          Number.isFinite(lower) && Number.isFinite(upper) ? (1 - fy) * lower + fy * upper : Number.NaN;
      }
    }
    return {
      kind: "cut-x",
      positionsPx,
      values: samples,
      originXPx: throughXPx,
      originYPx: throughYPx,
      ...(calibration !== undefined ? { stepUm: calibration.pixelPitchUmX } : {}),
    };
  }

  const positionsPx = Float64Array.from({ length: height }, (_, index) => index);
  const samples = new Float64Array(height);
  if (Number.isInteger(throughXPx)) {
    const x = throughXPx;
    for (let y = 0; y < height; y += 1) {
      const value = values[x + y * width];
      samples[y] = Number.isFinite(value) ? value : Number.NaN;
    }
  } else {
    const x0 = Math.floor(throughXPx);
    const fx = throughXPx - x0;
    for (let y = 0; y < height; y += 1) {
      const left = values[x0 + y * width];
      const right = values[x0 + 1 + y * width];
      samples[y] =
        Number.isFinite(left) && Number.isFinite(right) ? (1 - fx) * left + fx * right : Number.NaN;
    }
  }
  return {
    kind: "cut-y",
    positionsPx,
    values: samples,
    originXPx: throughXPx,
    originYPx: throughYPx,
    ...(calibration !== undefined ? { stepUm: calibration.pixelPitchUmY } : {}),
  };
}

// Perpendicular sum profile: for each column (axis "x") or row (axis "y"),
// the sum of every finite value along the perpendicular axis. A projection is
// a SUM, never a mean, so a width measured on it is a width of the summed
// distribution. Lines with zero finite pixels get NaN. Non-finite pixels are
// excluded from both the sum and contributingCounts. The reference anchor is
// the image centre: a projection covers the full extent of the perpendicular
// axis, so no single through-point exists.
export function computeProjection(
  corrected: CorrectedImage,
  axis: "x" | "y",
  calibration?: ImageCalibration,
): LineProfile {
  validateCorrectedImage(corrected);
  validateProfileAxis(axis);
  const { values, width, height } = corrected;

  if (axis === "x") {
    const positionsPx = Float64Array.from({ length: width }, (_, index) => index);
    const samples = new Float64Array(width);
    const contributingCounts = new Uint32Array(width);
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        const value = values[x + y * width];
        if (Number.isFinite(value)) {
          sum += value;
          count += 1;
        }
      }
      samples[x] = count > 0 ? sum : Number.NaN;
      contributingCounts[x] = count;
    }
    return {
      kind: "projection-x",
      positionsPx,
      values: samples,
      originXPx: (width - 1) / 2,
      originYPx: (height - 1) / 2,
      ...(calibration !== undefined ? { stepUm: calibration.pixelPitchUmX } : {}),
      contributingCounts,
    };
  }

  const positionsPx = Float64Array.from({ length: height }, (_, index) => index);
  const samples = new Float64Array(height);
  const contributingCounts = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      const value = values[x + y * width];
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    samples[y] = count > 0 ? sum : Number.NaN;
    contributingCounts[y] = count;
  }
  return {
    kind: "projection-y",
    positionsPx,
    values: samples,
    originXPx: (width - 1) / 2,
    originYPx: (height - 1) / 2,
    ...(calibration !== undefined ? { stepUm: calibration.pixelPitchUmY } : {}),
    contributingCounts,
  };
}

// Profile along a rotated axis through the centre of the image. Samples are
// taken at 1-px arc steps t (signed, negative side first, ascending) along
// the unit direction (cos(angle), sin(angle)), covering every integer offset
// whose sample point stays inside the image bounds. Bilinear interpolation
// with a NaN whenever a needed neighbour is non-finite; weight-zero terms
// (points exactly on an integer row/column) are skipped, including their
// finiteness requirement.
export function extractAxisProfile(
  corrected: CorrectedImage,
  centerXPx: number,
  centerYPx: number,
  angleRad: number,
  calibration?: ImageCalibration,
): LineProfile {
  validateCorrectedImage(corrected);
  const { values, width, height } = corrected;
  if (!Number.isFinite(centerXPx) || centerXPx < 0 || centerXPx > width - 1) {
    throw new RangeError(`centerXPx must be finite and inside [0, ${width - 1}]`);
  }
  if (!Number.isFinite(centerYPx) || centerYPx < 0 || centerYPx > height - 1) {
    throw new RangeError(`centerYPx must be finite and inside [0, ${height - 1}]`);
  }
  if (!Number.isFinite(angleRad)) {
    throw new RangeError("angleRad must be a finite number");
  }

  let cosA = Math.cos(angleRad);
  let sinA = Math.sin(angleRad);
  // Snap almost-axis-parallel directions to exact ones: the analyzer feeds
  // exactly pi/2-style angles whose trig residues (~1e-16) would otherwise
  // clip the offset bounds and drag near-zero-weight neighbours into the
  // bilinear finiteness requirement.
  if (Math.abs(cosA) < DIRECTION_SNAP_EPS) {
    cosA = 0;
    sinA = Math.sign(sinA);
  } else if (Math.abs(sinA) < DIRECTION_SNAP_EPS) {
    sinA = 0;
    cosA = Math.sign(cosA);
  }
  const { tMin, tMax } = axisOffsetBounds(width, height, centerXPx, centerYPx, cosA, sinA);
  const positions: number[] = [];
  const samples: number[] = [];
  for (let t = tMin; t <= tMax; t += 1) {
    const x = centerXPx + t * cosA;
    const y = centerYPx + t * sinA;
    if (x < 0 || x > width - 1 || y < 0 || y > height - 1) continue;
    positions.push(t);
    samples.push(bilinearSample(values, width, x, y));
  }

  return {
    kind: "axis",
    positionsPx: Float64Array.from(positions),
    values: Float64Array.from(samples),
    originXPx: centerXPx,
    originYPx: centerYPx,
    angleRad,
    ...(calibration !== undefined
      ? {
          stepUm: Math.sqrt(
            (cosA * calibration.pixelPitchUmX) * (cosA * calibration.pixelPitchUmX) +
              (sinA * calibration.pixelPitchUmY) * (sinA * calibration.pixelPitchUmY),
          ),
        }
      : {}),
  };
}

type WalkResult = { crossingPx: number | null; pairStart: number | null };

// Walk outward from the peak in one direction until the profile first drops
// to <= threshold between two consecutive finite samples; the crossing
// position is linearly interpolated between them. Hitting a non-finite sample
// before the crossing, or running off the profile end while still above the
// threshold, both report a null crossing (an unobserved crossing is a gap).
function walkOutward(
  positionsPx: Float64Array,
  values: Float64Array,
  peakIndex: number,
  threshold: number,
  direction: -1 | 1,
): WalkResult {
  let closerIndex = peakIndex;
  for (let index = peakIndex + direction; index >= 0 && index < values.length; index += direction) {
    const farther = values[index];
    if (!Number.isFinite(farther)) {
      return { crossingPx: null, pairStart: null };
    }
    const closer = values[closerIndex];
    if (farther <= threshold) {
      const positionFarther = positionsPx[index];
      const positionCloser = positionsPx[closerIndex];
      const crossingPx =
        positionFarther + ((threshold - farther) / (closer - farther)) * (positionCloser - positionFarther);
      return { crossingPx, pairStart: Math.min(index, closerIndex) };
    }
    closerIndex = index;
  }
  return { crossingPx: null, pairStart: null };
}

// After the enclosing crossing pair is known, scan every FINITE sample
// strictly outside the pair's span: any sample at or above threshold +
// AMBIGUITY_NOISE_MARGIN_SIGMA * sigmaCounts flags the measurement as
// ambiguous. The noise margin (FIX 7) prevents bare noise excursions under a
// low 1/e^2 threshold from firing the flag on nearly every noisy profile; a
// lobe that merely touches the threshold exactly still counts when measured
// with sigma 0. Level-based (not transition-based) so a lobe that touches the
// margin and a lobe fenced off by NaN gaps are both visible. This never
// nullifies the width itself.
function hasLevelOutside(
  values: Float64Array,
  threshold: number,
  leftPairStart: number,
  rightPairStart: number,
  sigmaCounts: number,
): boolean {
  const significanceThreshold = threshold + AMBIGUITY_NOISE_MARGIN_SIGMA * sigmaCounts;
  for (let i = 0; i < values.length; i += 1) {
    // The span covers the lobe AND both crossing pairs: a sample sitting
    // exactly at the threshold as part of the enclosing pair is not an
    // additional feature.
    if (i >= leftPairStart && i <= rightPairStart + 1) continue;
    const value = values[i];
    if (Number.isFinite(value) && value >= significanceThreshold) return true;
  }
  return false;
}

function measureWidthData(
  positionsPx: Float64Array,
  values: Float64Array,
  peakIndex: number,
  threshold: number,
  sigmaCounts: number,
): WidthMeasurement {
  const left = walkOutward(positionsPx, values, peakIndex, threshold, -1);
  const right = walkOutward(positionsPx, values, peakIndex, threshold, 1);
  if (left.crossingPx === null || right.crossingPx === null) {
    return { widthPx: null, leftCrossingPx: null, rightCrossingPx: null, ambiguous: false, suppressedReason: "gap" };
  }
  const ambiguous = hasLevelOutside(
    values,
    threshold,
    left.pairStart as number,
    right.pairStart as number,
    sigmaCounts,
  );
  return {
    widthPx: right.crossingPx - left.crossingPx,
    leftCrossingPx: left.crossingPx,
    rightCrossingPx: right.crossingPx,
    ambiguous,
    suppressedReason: null,
  };
}

// Data FWHM and data 1/e^2 width of a profile, measured by threshold
// crossings on the samples themselves. Baseline is exactly 0 (corrected data
// under B_eff = 0), so the thresholds are peak/2 and peak*exp(-2). A peak
// must first clear the 3-sigma signal guard; a non-positive peak (or no
// finite samples at all) suppresses both measurements.
//
// sigmaCounts must be the noise scale OF THE PROFILE'S OWN VALUES. For cut
// and axis profiles that is the per-pixel background sigma; for PROJECTION
// profiles (sums over ~contributingCount pixels) the per-pixel sigma is NOT
// that scale — the wiring layer must scale it (uncorrelated noise:
// sigma_perPixel * sqrt(contributingCount)) before calling this function.
// The same sigma also sets the ambiguity noise margin (FIX 7).
export function measureProfileWidths(profile: LineProfile, sigmaCounts: number): ProfileWidths {
  if (!Number.isFinite(sigmaCounts) || sigmaCounts < 0) {
    throw new RangeError("sigmaCounts must be a finite number >= 0");
  }
  const { positionsPx, values } = profile;
  if (positionsPx.length !== values.length) {
    throw new RangeError(
      `profile positionsPx.length ${positionsPx.length} does not match values.length ${values.length}`,
    );
  }
  for (let i = 1; i < positionsPx.length; i += 1) {
    if (!(positionsPx[i] > positionsPx[i - 1])) {
      throw new RangeError("profile positionsPx must be strictly ascending");
    }
  }

  let peakIndex = -1;
  let peakValueCounts = Number.NaN;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (
      peakIndex === -1 ||
      value > peakValueCounts ||
      (value === peakValueCounts && positionsPx[i] < positionsPx[peakIndex])
    ) {
      peakIndex = i;
      peakValueCounts = value;
    }
  }

  const suppressed = (reason: "low-signal" | "nonpositive-peak" | "gap"): ProfileWidths => ({
    peakValueCounts,
    peakPositionPx: peakIndex === -1 ? Number.NaN : positionsPx[peakIndex],
    fwhmData: {
      widthPx: null,
      leftCrossingPx: null,
      rightCrossingPx: null,
      ambiguous: false,
      suppressedReason: reason,
    },
    oneOverESquaredData: {
      widthPx: null,
      leftCrossingPx: null,
      rightCrossingPx: null,
      ambiguous: false,
      suppressedReason: reason,
    },
  });

  if (peakIndex === -1) return suppressed("nonpositive-peak");
  const peakPositionPx = positionsPx[peakIndex];
  if (!(peakValueCounts > 0)) return suppressed("nonpositive-peak");
  if (!(peakValueCounts > FWHM_SIGNAL_GUARD_FACTOR * sigmaCounts)) return suppressed("low-signal");

  const fwhmData = measureWidthData(positionsPx, values, peakIndex, peakValueCounts / 2, sigmaCounts);
  const oneOverESquaredData = measureWidthData(
    positionsPx,
    values,
    peakIndex,
    peakValueCounts * ONE_OVER_E_SQUARED,
    sigmaCounts,
  );
  return { peakValueCounts, peakPositionPx, fwhmData, oneOverESquaredData };
}
