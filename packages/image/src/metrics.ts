import type { BackgroundRect } from "./background.ts";

// S18d beam metrics (Plan v5 section 6): the remaining beam figures of merit
// no other module carries - ellipticity, the enclosed-power radial
// distribution and symmetry errors. Peak-to-background noise, multi-peak,
// clipping, hot-pixel fraction, pedestal and model comparison already live in
// aperture.ts / diagnostics.ts / reporting.ts and are NOT duplicated here;
// the API layer aggregates. The input is never mutated and every result is
// deterministic.
//
// All metrics follow the analyzer's B_eff = 0 convention: only strictly
// POSITIVE finite values carry power. Negative values are a background-
// correction defect that is measured and reported (negativePowerRatio), never
// silently clipped into the power sums.

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

function validateRoiInImage(image: { width: number; height: number }, roi: BackgroundRect): void {
  if (
    !Number.isInteger(roi.x0) ||
    !Number.isInteger(roi.y0) ||
    !Number.isInteger(roi.width) ||
    !Number.isInteger(roi.height)
  ) {
    throw new RangeError("ROI coordinates and sizes must be integers");
  }
  if (roi.width <= 0 || roi.height <= 0) {
    throw new RangeError("ROI width and height must be positive integers");
  }
  if (roi.x0 < 0 || roi.y0 < 0 || roi.x0 + roi.width > image.width || roi.y0 + roi.height > image.height) {
    throw new RangeError("ROI is not fully inside the image");
  }
}

// Unitless beam ellipticity: sigmaMinor / sigmaMajor, evaluated in PIXEL
// units. The "units cancel" argument only holds for SQUARE pixels
// (pixelPitchUmX == pixelPitchUmY) - both sigmas then share one scale factor
// and the ratio is the same in pixels or in physical units. Under
// ANISOTROPIC pixel pitches this is no longer true: a beam that is round IN
// PIXELS (ratio 1.000) is not round physically. Measured (S18 review G1): an
// 11/11 px sigma pair under a 3.45/1.15 um pitch (ratio 3:1) is pixel-round
// (this function returns 1) but the PHYSICAL ellipticity is 1/3 - the pixel
// ratio is +200 percent off. Callers that need the physical ratio must use
// computePhysicalEllipticity below with the PHYSICAL (um) sigma pair, not
// this function. Null whenever the major axis is not finite or not positive,
// or the minor axis is not finite or negative. A zero minor axis (a purely
// line-like beam) is valid and yields 0. Inputs are expected as a
// well-ordered major >= minor pair, so the ratio is in [0, 1].
export function computeEllipticity(sigmaMajor: number, sigmaMinor: number): number | null {
  if (!Number.isFinite(sigmaMajor) || sigmaMajor <= 0) return null;
  if (!Number.isFinite(sigmaMinor) || sigmaMinor < 0) return null;
  return sigmaMinor / sigmaMajor;
}

// Physical-space beam ellipticity: the same unitless sigmaMinor / sigmaMajor
// ratio as computeEllipticity, but the caller MUST pass the PHYSICAL
// (micrometer) sigma pair - e.g. the analyzer's released d4SigmaMajorUm /
// d4SigmaMinorUm - never the pixel pair. This is the honest ellipticity under
// anisotropic pixel pitches (see the comment on computeEllipticity above for
// the measured pixel-space error, +200 percent on a pixel-round beam under a
// 3:1 pitch). The implementation is deliberately identical to
// computeEllipticity: a ratio has no notion of "pixel" vs "physical" once its
// two inputs already share one unit. The separate name and signature exist so
// callers pick the physically-scaled sigma pair by construction and so the
// physical semantics are documented at the call site.
//
// NOT YET WIRED into analyzeImage: analyze.ts is owned by a parallel S18
// review fixer (this fixer's scope is metrics.ts/profiles.ts/diagnostics.ts/
// warnings.ts/thresholds.ts only). This function is delivered standalone here
// for that wiring - the caller should call it with the physical sigma pair
// (major >= minor) wherever computeEllipticity is currently called with the
// pixel pair, whenever a calibration is available.
export function computePhysicalEllipticity(sigmaMajorUm: number, sigmaMinorUm: number): number | null {
  return computeEllipticity(sigmaMajorUm, sigmaMinorUm);
}

// Enclosed-power radial distribution under the B_eff = 0 convention: positive
// power is binned by the distance of each ROI pixel CENTRE from the given
// centre (a pixel's full power lands in its centre's bin - no sub-pixel
// splitting; the piecewise-linear encircled-power interpolation absorbs the
// granularity). Negative power is tallied separately, zero / non-finite
// values are ignored.
export type RadialDistribution = {
  centerXPx: number;
  centerYPx: number;
  // Bin OUTER radii in px, ascending; bin i covers (radiiPx[i-1], radiiPx[i]]
  // with bin 0 covering [0, radiiPx[0]]. The last bin covers the ROI's max
  // radius rMax.
  radiiPx: Float64Array;
  // Monotone non-decreasing fraction of the total positive power enclosed
  // within each outer radius, in [0, 1]; the last entry is exactly 1 whenever
  // any positive power exists.
  enclosedFraction: Float64Array;
  // Bin-0 pixel samples for the exact sub-bin-0 enclosed-power interpolation
  // (S18a review fix): the (radius, positive power) pairs of EVERY finite
  // positive ROI pixel whose centre sits at radius <= radiiPx[0], sorted by
  // ascending radius (ties keep the deterministic row-major visit order; the
  // sort is stable). Bin 0 holds few pixels, so the exact walk stays cheap.
  // Empty when bin 0 holds no positive pixel; fields are optional so legacy
  // consumers that hand-construct a distribution keep working (the function
  // then falls back to the uniform-growth interpolation).
  firstBinRadiiPx?: Float64Array;
  firstBinPower?: Float64Array;
  totalPositiveCounts: number;
  // sum(|negative|) / sum(positive): the fraction of |negative| power ignored
  // relative to positive power - an honesty indicator for imperfect
  // background correction.
  negativePowerRatio: number;
};

// Computes the radial distribution of positive power inside `roi` about
// (centerXPx, centerYPx). The centre may lie outside the ROI - radii are
// still well-defined. Default binCount is 64 and must be a positive integer.
// Returns null when no strictly positive finite power exists inside the ROI.
export function computeRadialDistribution(
  corrected: CorrectedImage,
  roi: BackgroundRect,
  centerXPx: number,
  centerYPx: number,
  options?: { binCount?: number },
): RadialDistribution | null {
  validateCorrectedImage(corrected);
  validateRoiInImage(corrected, roi);
  if (!Number.isFinite(centerXPx) || !Number.isFinite(centerYPx)) {
    throw new RangeError("radial distribution centre must be finite");
  }
  const binCount = options?.binCount ?? 64;
  if (!Number.isInteger(binCount) || binCount < 1) {
    throw new RangeError("binCount must be a positive integer");
  }

  const { values, width } = corrected;
  const { x0, y0, width: roiWidth, height: roiHeight } = roi;
  const x1 = x0 + roiWidth - 1;
  const y1 = y0 + roiHeight - 1;

  // rMax: the maximum distance from the centre to any ROI pixel centre. The
  // bin edges are linear from 0 to rMax, so the last bin always covers it.
  let rMax = 0;
  for (let y = y0; y <= y1; y += 1) {
    const dy = y - centerYPx;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - centerXPx;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > rMax) rMax = distance;
    }
  }

  const binWidth = rMax / binCount;
  const radiiPx = new Float64Array(binCount);
  for (let i = 0; i < binCount; i += 1) radiiPx[i] = (i + 1) * binWidth;

  const binPower = new Float64Array(binCount);
  let totalPositiveCounts = 0;
  let negativePower = 0;
  // Bin-0 pixel samples for the exact first-bin radius resolution: a tight
  // beam's half-power radius can fall inside bin 0, where the uniform-growth
  // interpolation from r = 0 mismeasured tight beams (measured 12.1 percent
  // off at sigma 2). The samples use the SAME pixel-centre distance as the
  // binning below.
  const firstBinSamples: Array<{ radiusPx: number; power: number }> = [];
  for (let y = y0; y <= y1; y += 1) {
    const dy = y - centerYPx;
    const row = y * width;
    for (let x = x0; x <= x1; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      if (value > 0) {
        totalPositiveCounts += value;
        const dx = x - centerXPx;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= radiiPx[0]) {
          firstBinSamples.push({ radiusPx: distance, power: value });
        }
        // The clamp guards the rMax == 0 case (binWidth 0, every pixel at
        // distance 0) and rounding that could land a distance exactly on the
        // last bin edge.
        const binIndex =
          binWidth <= 0 ? 0 : Math.min(Math.floor(distance / binWidth), binCount - 1);
        binPower[binIndex] += value;
      } else if (value < 0) {
        negativePower += -value;
      }
    }
  }

  if (!(totalPositiveCounts > 0)) return null;

  const enclosedFraction = new Float64Array(binCount);
  let cumulative = 0;
  for (let i = 0; i < binCount; i += 1) {
    cumulative += binPower[i];
    enclosedFraction[i] = cumulative / totalPositiveCounts;
  }
  // The contract pins the last entry at exactly 1 when positive power exists.
  enclosedFraction[binCount - 1] = 1;

  // Sort the bin-0 samples by ascending radius; Array.prototype.sort is
  // stable, so equal-radius pixels keep their deterministic row-major order.
  firstBinSamples.sort((a, b) => a.radiusPx - b.radiusPx);
  const firstBinRadiiPx = new Float64Array(firstBinSamples.length);
  const firstBinPower = new Float64Array(firstBinSamples.length);
  for (let i = 0; i < firstBinSamples.length; i += 1) {
    firstBinRadiiPx[i] = firstBinSamples[i].radiusPx;
    firstBinPower[i] = firstBinSamples[i].power;
  }

  return {
    centerXPx,
    centerYPx,
    radiiPx,
    enclosedFraction,
    firstBinRadiiPx,
    firstBinPower,
    totalPositiveCounts,
    negativePowerRatio: negativePower / totalPositiveCounts,
  };
}

// Smallest radius at which `distribution` encloses `fraction` of the total
// positive power. fraction must be strictly between 0 and 1; the caller
// passes plain numbers - there are deliberately no named fraction constants,
// so the naming stays product-neutral. When the target fraction is reached
// inside bin 0 the radius is resolved EXACTLY from the bin-0 pixel samples:
// the samples are sorted by radius, their power is accumulated to
// fraction * totalPositiveCounts, and the answer is linearly interpolated
// between the two bracketing pixel radii. This replaces the old
// uniform-growth interpolation from r = 0, which mismeasured tight beams
// (measured: sigma 2 px on a 161^2 ROI gave 2.507 px vs the pixel-sorted
// ground truth 2.236 px, 12.1 percent off). Outside bin 0 the
// piecewise-linear interpolation between bin outer radii is unchanged. Null
// when the fraction is never reached (impossible for a distribution with
// positive total power and fraction < 1, kept as an honest guard).
export function encircledPowerRadiusPx(distribution: RadialDistribution, fraction: number): number | null {
  if (!Number.isFinite(fraction) || !(fraction > 0) || !(fraction < 1)) {
    throw new RangeError("fraction must be a finite number strictly between 0 and 1");
  }
  if (!(distribution.totalPositiveCounts > 0)) return null;

  const { radiiPx, enclosedFraction, totalPositiveCounts } = distribution;
  // Bin 0 already enclosing the fraction: exact first-bin path. Walk the
  // bin-0 pixel samples sorted by radius and accumulate each pixel's full
  // power (a point mass at its centre) until the target fraction of the
  // TOTAL positive power is reached, then linearly interpolate between the
  // two bracketing pixel radii. Several pixels on the same ring interpolate
  // to that ring's radius, which is exactly the pixel-sorted ground truth.
  if (enclosedFraction[0] >= fraction) {
    const samples = distribution.firstBinRadiiPx;
    const samplePower = distribution.firstBinPower;
    if (samples !== undefined && samplePower !== undefined && samples.length > 0 && samples.length === samplePower.length) {
      // Clamp the walk target to the exact sum of the bin-0 sample powers.
      // IEEE arithmetic rounds (enclosedFraction[0] * totalPositiveCounts)
      // one ulp ABOVE that sum when the requested fraction equals
      // enclosedFraction[0] exactly, which made the cumulative walk fall
      // through to the legacy uniform interpolation and return the bin
      // OUTER EDGE instead of the last sample radius. With the clamp an
      // exact-boundary fraction resolves to the last bin-0 sample radius;
      // the legacy fallback remains for legacy distributions without
      // first-bin samples.
      let binZeroPowerTotal = 0;
      for (let i = 0; i < samplePower.length; i += 1) {
        binZeroPowerTotal += samplePower[i];
      }
      const target = Math.min(fraction * totalPositiveCounts, binZeroPowerTotal);
      let accumulated = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const next = accumulated + samplePower[i];
        if (!(next < target)) {
          const upperRadius = samples[i];
          const lowerRadius = i > 0 ? samples[i - 1] : 0;
          const span = next - accumulated;
          const t = span > 0 ? (target - accumulated) / span : 0;
          return lowerRadius + t * (upperRadius - lowerRadius);
        }
        accumulated = next;
      }
    }
    // Fallback for legacy distributions without bin-0 samples: interpolate
    // linearly from (radius 0, fraction 0); the division is safe because
    // fraction > 0 implies enclosedFraction[0] > 0.
    return (fraction / enclosedFraction[0]) * radiiPx[0];
  }
  for (let i = 1; i < radiiPx.length; i += 1) {
    if (enclosedFraction[i] >= fraction) {
      const r0 = radiiPx[i - 1];
      const r1 = radiiPx[i];
      const f0 = enclosedFraction[i - 1];
      const f1 = enclosedFraction[i];
      // The first crossing found: f0 < fraction <= f1, so f1 - f0 > 0.
      return r0 + ((fraction - f0) / (f1 - f0)) * (r1 - r0);
    }
  }
  return null;
}

// Symmetry errors about (centerXPx, centerYPx): the point-reflection (180
// degree) asymmetry and the two axial half-plane imbalances. A perfectly
// centred symmetric beam gives 0; a half-blocked beam approaches 1 on the
// affected axis.
export type SymmetryErrors = {
  // Point-reflection (180-degree) asymmetry about the centre:
  // sum(|I(p) - I(mirror(p))|) / (2 * sum(|I(p)|)) over all ROI pixels whose
  // mirror pixel also lies inside the ROI and both values are finite; in
  // [0, 1]. Each unordered pair contributes twice to the numerator, which the
  // denominator's factor 2 accounts for (a half-blocked beam reaches 1).
  rotationAsymmetry: number | null;
  // |P_left - P_right| / (P_left + P_right) over strictly positive finite
  // values. A pixel whose centre sits within 0.5 px of the axis (the X axis
  // is the vertical line x = centerXPx; the Y axis is the horizontal line
  // y = centerYPx) contributes HALF its power to each side - see the S18
  // review G2 fix note below computeSymmetryErrors for why the old
  // exactly-on-axis exclusion fabricated asymmetry on symmetric beams.
  axialAsymmetryX: number | null;
  axialAsymmetryY: number | null;
  // Number of ROI pixels that take part in a rotation comparison (each pixel
  // whose mirror lies in the ROI with both values finite, counted once).
  comparedPixelCount: number;
};

// mirror(p) for the rotation asymmetry is the rounded nearest pixel centre of
// (2*center - p); Math.round is deterministic and mirror(mirror(p)) == p, so
// every unordered pair is visited twice. This implementation lets the
// lexicographically smaller member compare each pair once and doubles the
// difference there, matching the all-pixel numerator of the documented
// formula.
export function computeSymmetryErrors(
  corrected: CorrectedImage,
  roi: BackgroundRect,
  centerXPx: number,
  centerYPx: number,
): SymmetryErrors {
  validateCorrectedImage(corrected);
  validateRoiInImage(corrected, roi);
  if (!Number.isFinite(centerXPx) || !Number.isFinite(centerYPx)) {
    throw new RangeError("symmetry centre must be finite");
  }

  const { values, width } = corrected;
  const { x0, y0, width: roiWidth, height: roiHeight } = roi;
  const x1 = x0 + roiWidth - 1;
  const y1 = y0 + roiHeight - 1;

  let rotationNumerator = 0;
  let rotationDenominator = 0;
  let comparedPixelCount = 0;
  let leftPowerX = 0;
  let rightPowerX = 0;
  let leftPowerY = 0;
  let rightPowerY = 0;

  for (let y = y0; y <= y1; y += 1) {
    const row = y * width;
    for (let x = x0; x <= x1; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;

      const mirrorX = Math.round(2 * centerXPx - x);
      const mirrorY = Math.round(2 * centerYPx - y);
      if (mirrorX >= x0 && mirrorX <= x1 && mirrorY >= y0 && mirrorY <= y1) {
        const mirrorValue = values[mirrorY * width + mirrorX];
        if (Number.isFinite(mirrorValue)) {
          comparedPixelCount += 1;
          rotationDenominator += Math.abs(value);
          // mirror(mirror(p)) == p under Math.round, so each unordered pair is
          // visited twice; the lexicographically smaller member adds the
          // doubled difference once, which is exactly the sum over all pixels
          // of |I(p) - I(mirror(p))|. Self-mirror pixels (exactly on the
          // centre) contribute 0 to the numerator.
          if (x < mirrorX || (x === mirrorX && y < mirrorY)) {
            rotationNumerator += 2 * Math.abs(value - mirrorValue);
          }
        }
      }

      // Axial half-plane power over strictly positive finite values (S18
      // review G2 fix): the OLD partition (x < centerXPx / x > centerXPx,
      // pixels exactly on the axis excluded from both sides) looks
      // symmetric, but the centroid is essentially never exactly integer, so
      // in practice no pixel ever lands exactly on the axis - instead the
      // SINGLE column (or row) nearest the axis flips entirely to one side
      // depending on which side of the real-valued centre it falls, and that
      // one near-peak pixel dominates the sum. This fabricated asymmetry on
      // a perfectly symmetric beam (measured: axialAsymmetryX =
      // 1/(sigmaProj*sqrt(2*pi)) at integer-phase centres, e.g. 0.310 at
      // sigma 1.5, 0.042 at sigma 11) vanishes only by accident at exactly
      // half-pixel phase. The fix is an axis BAND: any pixel whose distance
      // to the axis is < 0.5 px sits astride it at the pixel-grid
      // resolution and contributes HALF its power to each side, which is
      // deterministic and phase-continuous (the split degrades smoothly as
      // the centre phase moves, instead of an entire pixel's power flipping
      // sides at a phase threshold).
      if (value > 0) {
        const axisDistanceX = Math.abs(x - centerXPx);
        if (axisDistanceX < 0.5) {
          leftPowerX += 0.5 * value;
          rightPowerX += 0.5 * value;
        } else if (x < centerXPx) {
          leftPowerX += value;
        } else {
          rightPowerX += value;
        }

        const axisDistanceY = Math.abs(y - centerYPx);
        if (axisDistanceY < 0.5) {
          leftPowerY += 0.5 * value;
          rightPowerY += 0.5 * value;
        } else if (y < centerYPx) {
          leftPowerY += value;
        } else {
          rightPowerY += value;
        }
      }
    }
  }

  const rotationAsymmetry =
    comparedPixelCount > 0 && rotationDenominator > 0
      ? rotationNumerator / (2 * rotationDenominator)
      : null;

  const axialDenominatorX = leftPowerX + rightPowerX;
  const axialAsymmetryX =
    axialDenominatorX > 0 ? Math.abs(leftPowerX - rightPowerX) / axialDenominatorX : null;

  const axialDenominatorY = leftPowerY + rightPowerY;
  const axialAsymmetryY =
    axialDenominatorY > 0 ? Math.abs(leftPowerY - rightPowerY) / axialDenominatorY : null;

  return {
    rotationAsymmetry,
    axialAsymmetryX,
    axialAsymmetryY,
    comparedPixelCount,
  };
}
