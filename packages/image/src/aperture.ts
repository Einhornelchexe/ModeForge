import type { FitResult, Gauss2dFitParams } from "./fit.ts";
import { computeEllipseMoments, type ImageMoments } from "./moments.ts";
import {
  ABSORBED_POWER_MIN_FRACTION,
  ABSORBED_POWER_NOISE_K,
  ABSORBED_POWER_PROBE_ALPHAS,
  ALPHA_CONSISTENCY_MAX_PERCENT,
  ALPHA_MC_K,
  ALPHA_MC_MAX_TOTAL_GRID_PIXELS,
  ALPHA_MC_MIN_DEC_SIGMA_PX,
  ALPHA_MC_MIN_VALID,
  ALPHA_MC_REALIZATIONS,
  ALPHA_MC_SEED,
  ALPHA_MC_SEED_STRIDE,
  ALPHA_MC_TARGET_DEC_SIGMA_PX,
  APERTURE_ALPHA_CHECK,
  APERTURE_ALPHA_DEFAULT,
  COVERAGE_BIAS_MAX_PERCENT,
  COVERAGE_MIN_FINITE_FRACTION,
  MEDIAN_PEAK_MIN_SIGMA,
  MEDIAN_PEAK_MIN_WINDOW_SAMPLES,
  MULTI_PEAK_EVT_MARGIN,
  MULTI_PEAK_MIN_PEAK_FRACTION,
  MULTI_PEAK_SEPARATION_WIDTH_FACTOR,
  PEDESTAL_HINT_FRACTION,
  RESIDUAL_RMS_PEAK_FRACTION,
  RESIDUAL_RMS_SIGMA_FACTOR,
} from "./thresholds.ts";

// Stage-B aperture-moments pipeline (S18d-B, Plan v5 section 4).
//
// assessAperture runs the release gates around a 2D-Gauss fit and, when
// every gate passes, returns the stage-B moments of an ellipse aperture whose
// semi axes are alpha * sigmaMajorPx / alpha * sigmaMinorPx around the fit
// centre. The reported suppressionReason is the FIRST failing gate in the
// documented order fit -> nonpositive_amplitude -> residual ->
// aperture_clipped -> coverage_insufficient -> alpha -> multi_peak. Stage-B
// moments are never substituted by stage-A rect moments: moments is null in
// every suppressed case. The input is never mutated and every result is
// deterministic.
//
// The two ellipse-moment passes and the pedestal scan run on a temporary
// background-subtracted field: the fitted background plane (backgroundCounts
// plus the tilted slopes when present) is removed from the ROI values first.
// Stage-B moments therefore measure the beam over the fit's own residual-
// background estimate (B_eff = 0 semantics restored), which makes the alpha
// gate immune to a residual constant/tilted background the fit already
// accounts for. The residual gate is unaffected: it keeps comparing the
// original values against the full model, background included.
//
// Gate semantics when gate 1 alone fails:
// - fitWidths and moments are null (model-bound widths exist only for a
//   converged fit; the aperture pass has no release-worthy reference).
// - The remaining gates are still evaluated against fit.params where that
//   parameter vector exists (fit.status may be max_iterations with params);
//   where params is null the residual gate reports rmsCounts 0 / high false,
//   the amplitude gate reports positive true, the clipping gate reports the
//   check ellipse inside, the alpha gate reports null deltas / inconsistent
//   false and the multi-peak gate reports 0 maxima / detected false: honest
//   no-data defaults, all NaN-free.
//
// S18 gate self-calibration (S18_GATE_CALIBRATION_SPEC):
// - The alpha-consistency CEILING is per-axis and per-image. For each image
//   the gate runs a deterministic Monte Carlo null that freezes the fitted
//   geometry and adds N(0, sigmaB) noise over a local ellipse bounding box,
//   then sets thresholdMajorPercent = max(3, ALPHA_MC_K * null rms) per axis.
//   sigmaB <= 0 skips the MC entirely (thresholds exactly 3, behaviour
//   identical to the fixed-gate design); fewer than ALPHA_MC_MIN_VALID valid
//   realizations fail closed.
// - The multi-peak candidate threshold is the extreme value of M iid
//   N(0, sigmaB) samples: sigmaB * (sqrt(2 ln M) + MULTI_PEAK_EVT_MARGIN),
//   floored by MULTI_PEAK_MIN_PEAK_FRACTION * the ceiling peak (S20 stage F;
//   the raw peakCorr until then - see ceilingPeak below).
//
// S18-R2 final-review findings (S18_GATE_CALIBRATION_SPEC section 11):
// - F1 (a): the new absorbedPower block. The fitted flat background can
//   absorb a faint WIDE wing whole; the pedestal hint references the PEAK and
//   goes blind, and both alpha passes see the same uniformly subtracted level,
//   so a 41.6 percent width error released with no warning at all. The block
//   measures that in POWER, and triggers on the aperture EXCESS (the residual
//   summed over concentric ellipse probes) rather than on the flat level,
//   because stage B is immune to a flat level by construction.
// - F2: alphaConsistency now also exports d4ScatterMajorPercent /
//   d4ScatterMinorPercent, the per-image noise scatter of the RELEASED width,
//   taken from the same MC realizations the gate threshold is built from.
// - F4: the multi-peak gate reads the stage-B field like every other
//   post-residual gate (it read the raw corrected values, which turned an
//   un-subtracted offset into a field of false peaks).
// - F5: the alpha verdict is withheld (inconsistent = false) when an earlier
//   gate suppressed the frame before the gate could run; the measurements are
//   still exported.
//
// Post-landing cross-review revisions (S18_GATE_CALIBRATION_SPEC section 9):
// - 9.2: an MC realization is usable only when BOTH per-axis deltas are
//   finite (d4 = 0 passes the moments validity predicate but yields 0/0 NaN
//   deltas; the NaN delta must count the realization invalid so the rms and
//   threshold stay finite and the fail-closed path fires).
// - 9.3: hostile/degenerate fit parameters on the public assessAperture
//   surface (non-finite sigmaMajorPx/sigmaMinorPx/thetaRad or a sigma <= 0)
//   skip the MC with floor thresholds - the decimation loop must never
//   iterate on non-finite input (measured non-termination at Infinity). Each
//   MC moment evaluation is exception-contained like ellipseMomentsPass: a
//   throwing realization is an invalid realization, never an escaping
//   exception (measured RangeError escape at sigmaB > 0).
// - 9.4: the MC runs ONLY when gates 1-4 already passed (fit converged,
//   amplitude positive, residual ok, check ellipse inside the ROI). On
//   earlier-gate suppression the alphaConsistency fields carry the observed
//   deltas plus floor thresholds, nullRms null, mcRealizationCount 0,
//   decimationFactor 1.
// - 9.5: SUPERSEDED BY 9.9. The landed rule capped the local grid at
//   32768 pixels by doubling b past the 1.5 px minor guard; that bought
//   bounded runtime with a decimated minor sigma below the documented floor.
// - 9.6: the decimated sub-pixel centre phase IS used for the local
//   model/moment centre: cx' = (cx - (b-1)/2) / b (measured null fidelity
//   0.991x with the phase vs 0.965x snapped to the integer box centre).
// - 9.9 (a): a NON-FINITE OBSERVED delta is reported as null and makes the
//   gate inconsistent, regardless of sigmaB. d4 = 0 on a degenerate axis
//   passes the moments validity predicate and made the observed delta 0/0 =
//   NaN; since NaN > threshold is false, the release check waved it through
//   and a line-degenerate beam RELEASED with a headline d4SigmaMinorPx of 0
//   whenever sigmaB = 0 skipped the MC (the nValid fail-closed path that
//   catches the sigmaB > 0 variant never ran).
// - 9.9 (b): the MC runtime budget counts TOTAL EVALUATED PIXELS (local grid
//   pixels x realizations, ALPHA_MC_MAX_TOTAL_GRID_PIXELS), not grid pixels
//   alone. The decimation factor is fixed by the target rule plus the minor-
//   axis guard and is never raised afterwards; the budget is met by lowering
//   the realization count down to the ALPHA_MC_MIN_VALID floor. A local grid
//   too large to afford that floor fails the gate closed (mcRealizationCount
//   0, thresholds at the floor, nullRms null) instead of running a null the
//   gate cannot trust.
//
// S20 stage A (aperture coverage of non-finite pixels):
// - A new gate sits between clipping and alpha: coverage_insufficient. Non-
//   finite pixels inside the aperture are skipped by every moment
//   accumulation, so the released widths are taken over whatever support
//   survived; the alpha gate is structurally blind to that, because a central
//   dead column cuts BOTH of its apertures alike and leaves their ratio
//   almost unchanged. The discriminator is therefore a model-bias estimator
//   (evaluateCoverage), not a dead-pixel fraction: measured, a scattered mask
//   over half the aperture moves the width by 0.5 percent while a dead column
//   over 5 percent of it moves the width by 6.
// - The gate runs ONLY when the ROI carries non-finite pixels AND gates 1-4
//   passed, so a clean frame is bit-identical to a build without it. The
//   non-finite count is taken on the branch the peak scan already had.
//
// S20 stage F (gate ceilings referenced against a stage-B, robust peak):
// - F4 + V5b: the peak arm of the residual ceiling and the multi-peak
//   candidate floor no longer read the raw ROI maximum. They read ceilingPeak
//   below: the fitted background is removed (so an additive offset can no
//   longer raise a ceiling without raising the signal) and, on beams wide
//   enough for it to mean anything, a 3x3 median filter removes single bright
//   pixels (so one hot pixel can no longer buy a release). peakCorr itself is
//   unchanged and still exported.
// - This CHANGES released behaviour on offset-carrying and hot-pixel scenes by
//   design. Every moved verdict is pinned in tests/repro-s20/
//   s20-gate-interactions.test.ts with its before/after value.

function validateCorrectedImage(corrected: { values: Float64Array | number[]; width: number; height: number }): void {
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

function validateRoi(corrected: { width: number; height: number }, roi: { x0: number; y0: number; width: number; height: number }): void {
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
  if (roi.x0 < 0 || roi.y0 < 0 || roi.x0 + roi.width > corrected.width || roi.y0 + roi.height > corrected.height) {
    throw new RangeError("ROI is not fully inside the image");
  }
}

// S20 stage F (F4 + V5b): the peak the two gate CEILINGS are referenced
// against. It is NOT peakCorr - peakCorr keeps its definition as the raw
// maximum of the corrected ROI and is still what the pedestal block and
// peakToBackgroundNoise export. See MEDIAN_PEAK_MIN_SIGMA in thresholds.ts for
// the calibration; the two arms are:
//
//   median  max of the 3x3-median-filtered corrected field inside the ROI,
//           minus the fitted background - a stage-B peak (F4) that one bright
//           pixel cannot lift (V5b). Used when the fitted minor sigma is at
//           least MEDIAN_PEAK_MIN_SIGMA, i.e. when the median filter removes
//           outliers rather than the beam.
//   model   the fitted amplitude A, which is the model peak A + B_fit read in
//           the same stage-B reference. Deterministic, immune to both defects
//           by construction, and the ONLY fallback: a narrow beam, a hostile
//           sigma and a ROI where no window reaches the minimum finite-sample
//           count all land here. There is no path back to the raw maximum.
//
// The null-params path is the documented exception (I-8 / R-25): with no fitted
// model there is neither a background to subtract nor a sigma to choose an arm
// with, so the RAW peak stands - the same deliberate choice fallbackAperture
// makes in analyze.ts. Those gates report no-data defaults anyway (residual
// high false, zero peaks), so the number is informational there.
//
// Which arm ran is deliberately NOT a new exported field: the two ceilings it
// feeds are already exported (residual.maxAllowedCounts,
// multiPeak.peakFloorCounts), and the arm is fully determined by the exported
// fitted sigmaMinorPx against MEDIAN_PEAK_MIN_SIGMA.

// 3x3 median filter, maximum over the ROI. Semantics (R-39):
// - the window is CLAMPED at the ROI boundary, so a corner pixel sees 4 cells
//   and an edge pixel 6; the ROI is the analysis domain, and reading image
//   pixels outside it would let material the operator excluded set a ceiling.
// - NON-FINITE neighbours are DROPPED from the sample, never substituted by 0
//   or by the centre value: a dead pixel is missing data, not a dark pixel.
// - a pixel whose OWN value is non-finite contributes nothing.
// - a window holding fewer than MEDIAN_PEAK_MIN_WINDOW_SAMPLES finite values
//   contributes nothing either, so a hot pixel surrounded by dead ones cannot
//   carry its own median through.
// - for an even sample count the LOWER median is taken (index floor((n-1)/2)),
//   which is deterministic and never invents a value that is not in the data.
// Returns null when no pixel in the ROI qualified.
function medianFilteredRoiPeak(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  roi: { x0: number; y0: number; width: number; height: number },
): number | null {
  const { values, width } = corrected;
  const xEnd = roi.x0 + roi.width;
  const yEnd = roi.y0 + roi.height;
  const window = new Float64Array(9);
  let best: number | null = null;
  for (let y = roi.y0; y < yEnd; y += 1) {
    const yLow = y > roi.y0 ? y - 1 : roi.y0;
    const yHigh = y + 1 < yEnd ? y + 1 : yEnd - 1;
    for (let x = roi.x0; x < xEnd; x += 1) {
      if (!Number.isFinite(values[y * width + x])) continue;
      const xLow = x > roi.x0 ? x - 1 : roi.x0;
      const xHigh = x + 1 < xEnd ? x + 1 : xEnd - 1;
      let count = 0;
      for (let ny = yLow; ny <= yHigh; ny += 1) {
        const row = ny * width;
        for (let nx = xLow; nx <= xHigh; nx += 1) {
          const value = values[row + nx];
          if (!Number.isFinite(value)) continue;
          // Insertion sort in place: at most nine elements, no allocation and
          // no comparator closure per pixel.
          let i = count;
          while (i > 0 && window[i - 1] > value) {
            window[i] = window[i - 1];
            i -= 1;
          }
          window[i] = value;
          count += 1;
        }
      }
      if (count < MEDIAN_PEAK_MIN_WINDOW_SAMPLES) continue;
      const median = window[(count - 1) >> 1];
      if (best === null || median > best) best = median;
    }
  }
  return best;
}

function ceilingPeak(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  roi: { x0: number; y0: number; width: number; height: number },
  params: Gauss2dFitParams | null,
  rawPeakCorr: number,
): number {
  // RAW arm - the null-params exception documented above.
  if (params === null) return rawPeakCorr;
  const background = Number.isFinite(params.backgroundCounts) ? params.backgroundCounts : 0;
  if (Number.isFinite(params.sigmaMinorPx) && params.sigmaMinorPx >= MEDIAN_PEAK_MIN_SIGMA) {
    const median = medianFilteredRoiPeak(corrected, roi);
    if (median !== null) {
      // MEDIAN arm. Clamped at zero: a fitted background above the robust peak
      // leaves no peak-referenced ceiling at all, and the noise arm alone
      // governs. That is the honest reading, not a reason to fall back to the
      // raw maximum.
      const stageBPeak = median - background;
      return stageBPeak > 0 ? stageBPeak : 0;
    }
    // No window in the ROI reached the minimum finite-sample count: fall
    // THROUGH to the model arm below, never back to rawPeakCorr.
  }
  // MODEL arm: A + B_fit read in stage-B reference is exactly A.
  const amplitude = params.amplitudeCounts;
  return Number.isFinite(amplitude) && amplitude > 0 ? amplitude : 0;
}

function residualMaxAllowed(ceilingPeakCounts: number, sigmaBCounts: number): number {
  return Math.max(RESIDUAL_RMS_SIGMA_FACTOR * sigmaBCounts, RESIDUAL_RMS_PEAK_FRACTION * ceilingPeakCounts);
}

// Fitted background plane removal (stage-B only): the values of the ROI are
// copied into a temporary field and the background the fit already accounts
// for is subtracted. Non-finite pixels stay non-finite. The result is used
// by the two ellipse-moment passes and the pedestal scan; the residual gate
// keeps operating on the original corrected values against the full model.
function subtractFittedBackground(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  roi: { x0: number; y0: number; width: number; height: number },
  params: Gauss2dFitParams,
): Float64Array {
  const backgroundSub = new Float64Array(corrected.values);
  const { width, height } = corrected;
  const slopeX = params.backgroundSlopeXCountsPerPx ?? 0;
  const slopeY = params.backgroundSlopeYCountsPerPx ?? 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    const dy = y - params.centerYPx;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = backgroundSub[row + x];
      if (!Number.isFinite(value)) continue;
      const plane = params.backgroundCounts + slopeX * (x - params.centerXPx) + slopeY * dy;
      backgroundSub[row + x] = Number.isFinite(plane) ? value - plane : value;
    }
  }
  // The confirmed ROI is the analysis domain: ellipse-moment passes must
  // not read image pixels outside it. Non-finite pixels are skipped by
  // computeEllipseMoments, so NaN-masking the exterior is the ROI clip.
  if (roi.x0 !== 0 || roi.y0 !== 0 || roi.width !== width || roi.height !== height) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      if (y < roi.y0 || y >= roi.y0 + roi.height) {
        backgroundSub.fill(Number.NaN, row, row + width);
        continue;
      }
      if (roi.x0 > 0) backgroundSub.fill(Number.NaN, row, row + roi.x0);
      const xEnd = roi.x0 + roi.width;
      if (xEnd < width) backgroundSub.fill(Number.NaN, row + xEnd, row + width);
    }
  }
  return backgroundSub;
}

// Gate 3 (order: fit -> amplitude -> residual -> clipping -> alpha -> multi):
// full-resolution model RMS over the finite ROI pixels. The public 2D-Gauss
// model is I = B [+ bx*(x-cx) + by*(y-cy)]
// + A*exp(-(u^2/(2*s1^2) + v^2/(2*s2^2))) with u/v rotated by theta about
// (cx, cy). A non-finite residual (a model that left the finite range) makes
// the gate conservatively high: no finite RMS can be reported for it.
function evaluateResidualGate(
  corrected: { values: Float64Array | number[]; width: number },
  roi: { x0: number; y0: number; width: number; height: number },
  params: Gauss2dFitParams,
  sigmaBCounts: number,
  ceilingPeakCounts: number,
): ApertureAssessment["gates"]["residual"] {
  const { values, width } = corrected;
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  const s1 = params.sigmaMajorPx;
  const s2 = params.sigmaMinorPx;
  const invTwoS1Sq = s1 > 0 ? 1 / (2 * s1 * s1) : 0;
  const invTwoS2Sq = s2 > 0 ? 1 / (2 * s2 * s2) : 0;
  const slopeX = params.backgroundSlopeXCountsPerPx ?? 0;
  const slopeY = params.backgroundSlopeYCountsPerPx ?? 0;
  let sumSquared = 0;
  let count = 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      const dx = x - params.centerXPx;
      const dy = y - params.centerYPx;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const uTerm = s1 > 0 ? u * u * invTwoS1Sq : u === 0 ? 0 : Number.POSITIVE_INFINITY;
      const vTerm = s2 > 0 ? v * v * invTwoS2Sq : v === 0 ? 0 : Number.POSITIVE_INFINITY;
      const model =
        params.backgroundCounts +
        slopeX * dx +
        slopeY * dy +
        params.amplitudeCounts * Math.exp(-(uTerm + vTerm));
      const residual = value - model;
      if (!Number.isFinite(residual)) {
        return {
          rmsCounts: Number.POSITIVE_INFINITY,
          maxAllowedCounts: residualMaxAllowed(ceilingPeakCounts, sigmaBCounts),
          high: true,
        };
      }
      sumSquared += residual * residual;
      count += 1;
    }
  }
  const rmsCounts = count > 0 ? Math.sqrt(sumSquared / count) : 0;
  const maxAllowedCounts = residualMaxAllowed(ceilingPeakCounts, sigmaBCounts);
  return { rmsCounts, maxAllowedCounts, high: rmsCounts > maxAllowedCounts };
}

// Gate 4 (aperture clipping): the LARGER check ellipse
// (APERTURE_ALPHA_CHECK * sigma axes, rotated by theta about the fit centre)
// must lie fully inside the confirmed ROI, not merely the image. Its
// axis-aligned half-extents are ex = sqrt((a*cos)^2 + (b*sin)^2) and
// ey = sqrt((a*sin)^2 + (b*cos)^2) with a = ALPHA_CHECK * sigmaMajorPx and
// b = ALPHA_CHECK * sigmaMinorPx. When the ellipse leaves the ROI both
// alpha passes clip at the analysis boundary, so their RATIO stays stable
// while both are equally wrong: the release must be suppressed instead of
// trusting a ratio between two truncated apertures.
function evaluateClippingGate(
  roi: { x0: number; y0: number; width: number; height: number },
  params: Gauss2dFitParams,
): ApertureAssessment["gates"]["clipping"] {
  const a = APERTURE_ALPHA_CHECK * params.sigmaMajorPx;
  const b = APERTURE_ALPHA_CHECK * params.sigmaMinorPx;
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  const ex = Math.sqrt(a * cos * (a * cos) + b * sin * (b * sin));
  const ey = Math.sqrt(a * sin * (a * sin) + b * cos * (b * cos));
  if (!Number.isFinite(ex) || !Number.isFinite(ey)) return { checkEllipseInside: false };
  const xMin = roi.x0;
  const xMax = roi.x0 + roi.width - 1;
  const yMin = roi.y0;
  const yMax = roi.y0 + roi.height - 1;
  return {
    checkEllipseInside:
      params.centerXPx - ex >= xMin &&
      params.centerXPx + ex <= xMax &&
      params.centerYPx - ey >= yMin &&
      params.centerYPx + ey <= yMax,
  };
}

// One ellipse moment pass. computeEllipseMoments validates its ellipse, so a
// degenerate parameter vector (zero or non-finite semi axes, swapped axes)
// throws; the alpha gate treats that as an invalid pass. Null therefore means
// "no pass could be computed".
function ellipseMomentsPass(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  params: Gauss2dFitParams,
  factor: number,
): ImageMoments | null {
  try {
    return computeEllipseMoments(corrected, {
      centerXPx: params.centerXPx,
      centerYPx: params.centerYPx,
      semiMajorPx: factor * params.sigmaMajorPx,
      semiMinorPx: factor * params.sigmaMinorPx,
      thetaRad: params.thetaRad,
    });
  } catch {
    return null;
  }
}

// Section 1.3 decimation factor of the alpha-MC null: the power-of-two rule
// that targets a decimated major sigma near ALPHA_MC_TARGET_DEC_SIGMA_PX,
// then the minor-axis guard that halves b back until the decimated MINOR
// sigma is at least ALPHA_MC_MIN_DEC_SIGMA_PX.
//
// Revision 9.9 (b): the value this function returns is FINAL. Nothing
// downstream may raise it - the runtime budget is met by lowering the
// realization count instead. The superseded 9.5 grid cap doubled b past the
// guard and pushed the decimated minor sigma under the floor, which detuned
// the minor-axis null by a geometry-dependent factor (measured 0.948x at
// sigma 80x5 / 45 deg, 1.229x at 100x4 / 45 deg, and up to a 100-percent
// null rms at 600x4 / 45 deg, i.e. an effectively disabled minor arm).
//
// Callers must pass finite sigmas > 0 (revision 9.3 guards that on the
// public surface); the loop would not terminate on non-finite input.
function alphaMcDecimationFactor(sigmaMajorPx: number, sigmaMinorPx: number): number {
  let b =
    sigmaMajorPx <= ALPHA_MC_TARGET_DEC_SIGMA_PX
      ? 1
      : Math.pow(2, Math.ceil(Math.log2(sigmaMajorPx / ALPHA_MC_TARGET_DEC_SIGMA_PX)));
  while (b > 1 && sigmaMinorPx / b < ALPHA_MC_MIN_DEC_SIGMA_PX) b = b / 2;
  return b;
}

// S18-R2 F2: relative sample standard deviation (n-1) of a realization set,
// as a percent of a reference value. Null unless there are at least two
// samples and the reference is finite and positive - a scatter without a
// reference is no measurement.
function relativeScatterPercent(samples: number[], reference: number | null): number | null {
  if (samples.length < 2) return null;
  if (reference === null || !Number.isFinite(reference) || reference <= 0) return null;
  let sum = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  const mean = sum / samples.length;
  let sumSq = 0;
  for (const value of samples) sumSq += (value - mean) * (value - mean);
  const std = Math.sqrt(sumSq / (samples.length - 1));
  const percent = (100 * std) / reference;
  return Number.isFinite(percent) ? percent : null;
}

// Deterministic mulberry32 PRNG used by the alpha-consistency Monte Carlo
// null. Per-realization streams make the first 32 realizations bit-identical
// regardless of N, giving stable prefixes for debugging and regression.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gate 5 (alpha consistency): the observed statistic is unchanged
// (per-axis 100 * |d4(4) - d4(6)| / d4(6) on the fit-background-subtracted
// field), but the CEILING is now per-axis and per-image. With sigmaB > 0 AND
// the earlier gates passed (runMc) the gate freezes the fitted geometry and
// runs up to ALPHA_MC_REALIZATIONS deterministic null realizations (revision
// 9.9: fewer when the runtime budget demands it, never below
// ALPHA_MC_MIN_VALID) on a LOCAL
// bounding box of the 6-sigma check ellipse (gate 4 has already passed, so
// the full check ellipse is inside the ROI). Each realization draws iid
// N(0, sigmaB) noise on the decimated grid, runs both ellipse passes and
// collects the per-axis deltas. The threshold is max(3, ALPHA_MC_K * rms)
// per axis; sigmaB <= 0 skips the MC (thresholds exactly 3, historical
// fixed-gate behaviour); fewer than ALPHA_MC_MIN_VALID valid realizations
// fail closed. Revision 9.3 additionally skips the MC for hostile/degenerate
// fit parameters (non-finite sigmaMajorPx/sigmaMinorPx/thetaRad or a sigma
// <= 0) so the decimation loop never iterates on non-finite input, and each
// MC moment evaluation is exception-contained (a throwing realization is
// invalid, never an escaping exception). Revision 9.2 requires both per-axis
// deltas of a realization to be finite before it is collected - a 0/0 NaN
// delta (d4 = 0 passes the moments predicate) marks the realization invalid.
// Revision 9.9 applies the same finiteness rule to the OBSERVED deltas (the
// MC is not always there to catch a degenerate axis) and replaces the
// grid-pixel cap by a total-evaluated-pixel budget met through the
// realization count, so the minor-axis guard is never traded for runtime.
function evaluateAlphaConsistencyGate(
  stageBField: { values: Float64Array | number[]; width: number; height: number },
  params: Gauss2dFitParams,
  alpha: number,
  sigmaBCounts: number,
  earlyGatesPassed: boolean,
): ApertureAssessment["gates"]["alphaConsistency"] {
  // The gate only REACHES a verdict when the earlier gates let it run
  // (revision 9.4); see the S18-R2 F5 note at the verdict below.
  const gateEvaluated = earlyGatesPassed;
  const alphaPass = ellipseMomentsPass(stageBField, params, alpha);
  const checkPass = ellipseMomentsPass(stageBField, params, APERTURE_ALPHA_CHECK);
  let deltaMajorPercent: number | null = null;
  let deltaMinorPercent: number | null = null;
  if (alphaPass !== null && alphaPass.valid && checkPass !== null && checkPass.valid) {
    // Revision 9.9 (a): the OBSERVED deltas get the same finiteness rule the
    // MC realizations already had. A line-degenerate pass has
    // d4SigmaMinorPx = 0 on BOTH apertures, so the raw quotient is 0/0 = NaN;
    // `NaN > threshold` is false, so a NaN delta used to sail through the
    // release check - and with sigmaB = 0 the MC (whose nValid fail-closed
    // path catches the noisy variant) is skipped entirely. A non-finite
    // delta is no measurement at all: it is reported as null, which is what
    // the envelope sanitizer shows anyway, and null makes the gate
    // inconsistent below for EITHER axis, at any sigmaB.
    const rawMajor =
      (100 * Math.abs((alphaPass.d4SigmaMajorPx as number) - (checkPass.d4SigmaMajorPx as number))) /
      (checkPass.d4SigmaMajorPx as number);
    const rawMinor =
      (100 * Math.abs((alphaPass.d4SigmaMinorPx as number) - (checkPass.d4SigmaMinorPx as number))) /
      (checkPass.d4SigmaMinorPx as number);
    deltaMajorPercent = Number.isFinite(rawMajor) ? rawMajor : null;
    deltaMinorPercent = Number.isFinite(rawMinor) ? rawMinor : null;
  }

  let thresholdMajorPercent = ALPHA_CONSISTENCY_MAX_PERCENT;
  let thresholdMinorPercent = ALPHA_CONSISTENCY_MAX_PERCENT;
  let nullRmsMajorPercent: number | null = null;
  let nullRmsMinorPercent: number | null = null;
  let d4ScatterMajorPercent: number | null = null;
  let d4ScatterMinorPercent: number | null = null;
  let mcRealizationCount = 0;
  let decimationFactor = 1;
  let mcAttempted = false;

  if (sigmaBCounts > 0 && earlyGatesPassed) {
    const sigmaMajorPx = params.sigmaMajorPx;
    const sigmaMinorPx = params.sigmaMinorPx;
    if (
      Number.isFinite(sigmaMajorPx) &&
      Number.isFinite(sigmaMinorPx) &&
      Number.isFinite(params.thetaRad) &&
      sigmaMajorPx > 0 &&
      sigmaMinorPx > 0
    ) {
      mcAttempted = true;
      const b = alphaMcDecimationFactor(sigmaMajorPx, sigmaMinorPx);
      const sigmaMajorDec = sigmaMajorPx / b;
      const sigmaMinorDec = sigmaMinorPx / b;
      const centerXDec = (params.centerXPx - (b - 1) / 2) / b;
      const centerYDec = (params.centerYPx - (b - 1) / 2) / b;
      const sigmaBDec = sigmaBCounts / b;
      const cos = Math.cos(params.thetaRad);
      const sin = Math.sin(params.thetaRad);
      const checkMajor = APERTURE_ALPHA_CHECK * sigmaMajorDec;
      const checkMinor = APERTURE_ALPHA_CHECK * sigmaMinorDec;
      const ex = Math.sqrt(checkMajor * checkMajor * cos * cos + checkMinor * checkMinor * sin * sin);
      const ey = Math.sqrt(checkMajor * checkMajor * sin * sin + checkMinor * checkMinor * cos * cos);
      const halfW = Math.ceil(ex) + 2;
      const halfH = Math.ceil(ey) + 2;
      const gridW = 2 * halfW + 1;
      const gridH = 2 * halfH + 1;
      // The decimation factor is reported even when the budget below refuses
      // to run the MC: it is the geometry the gate WOULD have used, and it is
      // now always the guard's own value.
      decimationFactor = b;
      // Revision 9.9 (b): the runtime budget is on TOTAL EVALUATED PIXELS
      // (local grid pixels x realizations), never on the grid alone, so
      // bounding the runtime can no longer corrupt the null. The realization
      // count is what gives way, down to the ALPHA_MC_MIN_VALID floor; the
      // per-realization streams keep the first N realizations bit-identical
      // to a full N = ALPHA_MC_REALIZATIONS run (section 1.5). A grid that
      // cannot afford even the floor gets NO MC at all: mcRealizationCount
      // stays 0, the fail-closed path below fires, and no oversized model /
      // scratch buffer is ever allocated.
      const realizations = Math.min(
        ALPHA_MC_REALIZATIONS,
        Math.floor(ALPHA_MC_MAX_TOTAL_GRID_PIXELS / (gridW * gridH)),
      );
      if (realizations >= ALPHA_MC_MIN_VALID) {
        // Revision 9.6: the local model/moment centre is the BOX CENTRE
        // carrying ONLY the sub-pixel phase of the decimated centre:
        //   localCx = halfW + (centerXDec - Math.round(centerXDec))
        // The half widths are built around the decimated centre, so using the
        // raw fractional decimated value as the coordinate (as originally
        // landed) put the ellipse mostly OUTSIDE the local box - the measured
        // collapse was mcRealizationCount 4/64 on a healthy SNR-20 Gaussian
        // with the thresholds falling back to the 3 floor. Keeping the phase
        // (rather than snapping to the integer box centre, which measured
        // 0.965x null fidelity vs 0.991x with the phase) is what spec 9.6
        // requires.
        const localCx = halfW + (centerXDec - Math.round(centerXDec));
        const localCy = halfH + (centerYDec - Math.round(centerYDec));
        const invTwoS1Sq = 1 / (2 * sigmaMajorDec * sigmaMajorDec);
        const invTwoS2Sq = 1 / (2 * sigmaMinorDec * sigmaMinorDec);
        const model = new Float64Array(gridW * gridH);
        for (let y = 0; y < gridH; y += 1) {
          const dy = y - localCy;
          for (let x = 0; x < gridW; x += 1) {
            const dx = x - localCx;
            const u = dx * cos + dy * sin;
            const v = -dx * sin + dy * cos;
            model[y * gridW + x] =
              params.amplitudeCounts * Math.exp(-(u * u * invTwoS1Sq + v * v * invTwoS2Sq));
          }
        }
        const scratch = new Float64Array(gridW * gridH);
        const deltaMajorSamples: number[] = [];
        const deltaMinorSamples: number[] = [];
        // S18-R2 F2: the same realizations already produce an alpha-pass d4
        // per realization. Collecting them costs nothing and exports the
        // per-image NOISE SCATTER of the released number, which the gate
        // itself never reports (the alpha gate only asks whether 4-sigma and
        // 6-sigma agree - two apertures on the SAME realization move
        // together, so a beam whose released width is worth +-20 percent can
        // pass the gate). The MC runs on the decimated grid where the
        // geometry is sigma/b, so a decimated d4 maps back as d4_full =
        // b * d4_dec (the model is EVALUATED at sigma/b, not mean-pooled, so
        // the discrete Sheppard term of fit.ts does NOT apply here).
        const d4MajorSamples: number[] = [];
        const d4MinorSamples: number[] = [];
        for (let r = 0; r < realizations; r += 1) {
          const rand = mulberry32((ALPHA_MC_SEED + Math.imul(r, ALPHA_MC_SEED_STRIDE)) >>> 0);
          let spare: number | null = null;
          const gauss = (): number => {
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
          for (let i = 0; i < scratch.length; i += 1) {
            scratch[i] = model[i] + sigmaBDec * gauss();
          }
          // Revision 9.3: each MC moment pass is exception-contained exactly
          // like ellipseMomentsPass - a throwing realization is an invalid
          // realization, never an escaping exception.
          let mcAlpha: ImageMoments | null;
          try {
            mcAlpha = computeEllipseMoments(
              { values: scratch, width: gridW, height: gridH },
              {
                centerXPx: localCx,
                centerYPx: localCy,
                semiMajorPx: alpha * sigmaMajorDec,
                semiMinorPx: alpha * sigmaMinorDec,
                thetaRad: params.thetaRad,
              },
            );
          } catch {
            mcAlpha = null;
          }
          let mcCheck: ImageMoments | null;
          try {
            mcCheck = computeEllipseMoments(
              { values: scratch, width: gridW, height: gridH },
              {
                centerXPx: localCx,
                centerYPx: localCy,
                semiMajorPx: APERTURE_ALPHA_CHECK * sigmaMajorDec,
                semiMinorPx: APERTURE_ALPHA_CHECK * sigmaMinorDec,
                thetaRad: params.thetaRad,
              },
            );
          } catch {
            mcCheck = null;
          }
          if (mcAlpha !== null && mcCheck !== null) {
            const bothValid =
              mcAlpha.valid &&
              mcCheck.valid &&
              mcAlpha.d4SigmaMajorPx !== null &&
              mcAlpha.d4SigmaMinorPx !== null &&
              mcCheck.d4SigmaMajorPx !== null &&
              mcCheck.d4SigmaMinorPx !== null;
            if (bothValid) {
              const dMajor =
                (100 * Math.abs(mcAlpha.d4SigmaMajorPx! - mcCheck.d4SigmaMajorPx!)) / mcCheck.d4SigmaMajorPx!;
              const dMinor =
                (100 * Math.abs(mcAlpha.d4SigmaMinorPx! - mcCheck.d4SigmaMinorPx!)) / mcCheck.d4SigmaMinorPx!;
              // Revision 9.2: a realization is USABLE only when BOTH per-axis
              // deltas are finite. d4 = 0 passes the moments validity predicate
              // and yields 0/0 NaN deltas which would poison the rms and turn
              // the threshold NaN; non-finite deltas mark the realization
              // invalid so the fail-closed path handles degenerate geometry.
              if (Number.isFinite(dMajor) && Number.isFinite(dMinor)) {
                deltaMajorSamples.push(dMajor);
                deltaMinorSamples.push(dMinor);
                d4MajorSamples.push(mcAlpha.d4SigmaMajorPx! * b);
                d4MinorSamples.push(mcAlpha.d4SigmaMinorPx! * b);
              }
            }
          }
        }
        mcRealizationCount = deltaMajorSamples.length;
        if (mcRealizationCount >= ALPHA_MC_MIN_VALID) {
          let sumSqMajor = 0;
          let sumSqMinor = 0;
          for (let i = 0; i < deltaMajorSamples.length; i += 1) {
            sumSqMajor += deltaMajorSamples[i] * deltaMajorSamples[i];
            sumSqMinor += deltaMinorSamples[i] * deltaMinorSamples[i];
          }
          const rmsMajor = Math.sqrt(sumSqMajor / deltaMajorSamples.length);
          const rmsMinor = Math.sqrt(sumSqMinor / deltaMinorSamples.length);
          thresholdMajorPercent = Math.max(ALPHA_CONSISTENCY_MAX_PERCENT, ALPHA_MC_K * rmsMajor);
          thresholdMinorPercent = Math.max(ALPHA_CONSISTENCY_MAX_PERCENT, ALPHA_MC_K * rmsMinor);
          nullRmsMajorPercent = rmsMajor;
          nullRmsMinorPercent = rmsMinor;
          // S18-R2 F2: sample standard deviation (n-1) of the per-realization
          // alpha-pass d4, mapped back to full resolution, expressed as a
          // percent of the OBSERVED alpha-pass d4 (the released number). The
          // observed pass is the right reference: the scatter answers "how
          // much does THIS released number move under this image's own noise",
          // so it is null when no observed pass exists.
          const observedValid = alphaPass !== null && alphaPass.valid;
          d4ScatterMajorPercent = relativeScatterPercent(
            d4MajorSamples,
            observedValid ? alphaPass!.d4SigmaMajorPx : null,
          );
          d4ScatterMinorPercent = relativeScatterPercent(
            d4MinorSamples,
            observedValid ? alphaPass!.d4SigmaMinorPx : null,
          );
        }
      }
    }
  }

  const failClosed = mcAttempted && mcRealizationCount < ALPHA_MC_MIN_VALID;
  // S18-R2 F5 (export honesty): when an EARLIER gate already failed, the
  // self-calibrating null never ran (revision 9.4 skips it), so the only
  // ceiling available is the bare floor - a ceiling this gate was never meant
  // to be judged against on a noisy image. Reporting inconsistent = true from
  // that comparison exports a verdict the gate never reached: a JSON consumer
  // reads "alpha inconsistent" when the truth is "alpha not evaluated". The
  // observed deltas and the floor thresholds are still exported (they are
  // measurements, not verdicts); only the VERDICT is withheld. Release
  // precedence is untouched: the earlier gate already vetoes both
  // suppressionReason and allGatesPass, so a false verdict here can never
  // release anything the old code suppressed.
  const inconsistent =
    !gateEvaluated
      ? false
      : failClosed ||
        deltaMajorPercent === null ||
        deltaMinorPercent === null ||
        deltaMajorPercent > thresholdMajorPercent ||
        deltaMinorPercent > thresholdMinorPercent;

  return {
    deltaMajorPercent,
    deltaMinorPercent,
    inconsistent,
    thresholdMajorPercent,
    thresholdMinorPercent,
    nullRmsMajorPercent,
    nullRmsMinorPercent,
    d4ScatterMajorPercent,
    d4ScatterMinorPercent,
    mcRealizationCount,
    decimationFactor,
  };
}

// Gate 6 (M-4 wiring): count strict 8-neighbour local maxima inside the ROI
// whose value exceeds the self-calibrated candidate threshold. Without the
// S18 extreme-value arm the fixed 4*sigmaB floor sat BELOW the expected
// maximum of ~72000 iid noise samples, so pure noise yielded >= 2 "peaks"
// with ~67 % probability. The new threshold tracks the expected maximum of
// M iid N(0, sigmaB) samples: evt = sigmaB * (sqrt(2 ln M) + margin), floored
// by MULTI_PEAK_MIN_PEAK_FRACTION * the CEILING peak (S20 stage F: the stage-B,
// outlier-robust peak of ceilingPeak, not the raw ROI maximum - an additive
// offset used to raise this floor one for one while the scanned field has the
// fitted background removed, and one hot pixel used to lift it above the real
// beam's own peak). The floor keeps the gate alive
// when sigmaB = 0 (no noise scale): with the threshold collapsed to value > 0
// benign flank noise maxima of a single real beam would saturate the count;
// a secondary structure below the documented 10 percent of the beam
// peak is not a second beam either. Candidates are then filtered with greedy
// separation counting: sorted by value descending, a candidate is accepted
// when it is farther than MULTI_PEAK_SEPARATION_WIDTH_FACTOR * wEst
// (wEst = 2 * sigmaMajorPx) from every already accepted peak. The sort is
// stable, and candidates are collected in row-major order, so exact ties
// keep the deterministic ascending-index order.
function evaluateMultiPeakGate(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  roi: { x0: number; y0: number; width: number; height: number },
  sigmaBCounts: number,
  params: Gauss2dFitParams | null,
  ceilingPeakCounts: number,
): ApertureAssessment["gates"]["multiPeak"] {
  const scannedPixelCount = roi.width * roi.height;
  const evtThresholdCounts =
    sigmaBCounts > 0
      ? sigmaBCounts * (Math.sqrt(2 * Math.log(Math.max(2, scannedPixelCount))) + MULTI_PEAK_EVT_MARGIN)
      : 0;
  const peakFloorCounts = MULTI_PEAK_MIN_PEAK_FRACTION * ceilingPeakCounts;
  if (params === null) {
    return {
      significantPeakCount: 0,
      detected: false,
      thresholdCounts: 0,
      evtThresholdCounts,
      peakFloorCounts,
      scannedPixelCount,
    };
  }
  const { values, width } = corrected;
  const thresholdCounts = Math.max(evtThresholdCounts, peakFloorCounts);
  const candidates: Array<{ x: number; y: number; value: number }> = [];
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      if (!(value > thresholdCounts)) continue;
      let isStrictMax = true;
      for (let dy = -1; dy <= 1 && isStrictMax; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < roi.x0 || nx >= roi.x0 + roi.width || ny < roi.y0 || ny >= roi.y0 + roi.height) continue;
          if (values[ny * width + nx] >= value) {
            isStrictMax = false;
            break;
          }
        }
      }
      if (!isStrictMax) continue;
      candidates.push({ x, y, value });
    }
  }
  candidates.sort((a, b) => b.value - a.value);
  const wEst = 2 * params.sigmaMajorPx;
  const separationPx = MULTI_PEAK_SEPARATION_WIDTH_FACTOR * wEst;
  const accepted: Array<{ x: number; y: number }> = [];
  for (const candidate of candidates) {
    let farFromAll = true;
    for (const other of accepted) {
      const dx = candidate.x - other.x;
      const dy = candidate.y - other.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= separationPx) {
        farFromAll = false;
        break;
      }
    }
    if (farFromAll) accepted.push(candidate);
  }
  return {
    significantPeakCount: accepted.length,
    detected: accepted.length >= 2,
    thresholdCounts,
    evtThresholdCounts,
    peakFloorCounts,
    scannedPixelCount,
  };
}

// S18-R2 F1 (a): ABSORBED-POWER wing detector.
//
// The pedestal hint compares the fitted background level against the PEAK,
// which is the wrong reference for a faint WIDE wing: a wing at 0.05 percent
// of the peak spread over 8x the core width carries 3.2 percent of the power,
// and a single-Gauss LM absorbs it into the constant background term. The
// fitted level then stays four orders below the pedestal fraction (measured
// backgroundCounts 0.0347 on a peak of 1000) while the released d4 drops
// 41.6 percent below the in-frame truth, with the alpha statistic blind too
// (both aperture passes see the same uniformly subtracted level).
//
// Two statistics are reported, and only the second one triggers.
//
// 1. flatFractionOfBeamPower = fitB * roiPixelCount / beamPower asks the
//    pedestal question in POWER rather than in amplitude: how much count does
//    the flat background hold over the analysis domain, against the beam power
//    actually present there (the positive-count sum de-biased by the expected
//    positive half-sum of zero-mean noise, roiPixelCount * sigmaB /
//    sqrt(2*pi) - the same null the adaptive IMAGE_NEGATIVE_POWER arm uses).
//    It is EXPORTED as a measurement but deliberately does NOT trigger:
//    measured over 74 clean released reference scenes it would fire on 24
//    percent of them, because a genuinely FLAT residual level - a background
//    stage that landed one count off, which stage B is immune to by
//    construction (B_eff = 0 semantics: the flat level is subtracted from the
//    stage-B field) - produces exactly the same number as an absorbed wing.
//    Measured example: a 64x64 camera frame whose corner median landed one
//    count high reports 14 percent absorbed while its released width is
//    accurate to 1.1 percent.
//
// 2. apertureExcessFraction is the statistic that separates them. The
//    residual (corrected - full fitted model, background included) is summed
//    over a concentric ELLIPSE PROBE and referenced against the fitted
//    Gaussian's analytic power 2*pi*A*sigmaMajor*sigmaMinor. A flat level the
//    fit absorbed is part of the model, so it cancels here exactly; a WING the
//    flat term absorbed does not - the wing is concentrated on the beam while
//    its absorbed compensation is spread over the whole ROI, leaving a
//    systematic positive residual inside the aperture and a negative one
//    outside. That is the mechanism which biases the released width, so it is
//    the honest thing to test.
//
// Several probe radii are used (ABSORBED_POWER_PROBE_ALPHAS) because the most
// informative radius depends on how wide the wing is relative to the core,
// which is exactly the unknown: a wing 8x wider than the core is best seen far
// out (measured standardized excess 3.0 at 6 sigma against 4.9 at 12 sigma),
// while a wing only 4x wider is best seen close in (1.9 at 6 sigma against 0.6
// at 12 sigma, because the absorbed compensation grows with the probe area).
// A probe is only used when its ellipse bounding box lies fully inside the
// ROI; the clipping gate already guarantees that for the 4 and 6 sigma probes
// of any released frame. The reported probe is the one with the largest
// excess RELATIVE TO ITS OWN ceiling, and `high` is true when any probe clears
// its ceiling - the multiplicity is paid for in ABSORBED_POWER_NOISE_K.
//
// The ceiling is noise aware: a residual sum over n pixels of iid N(0, sigmaB)
// noise scatters by sigmaB * sqrt(n), so the fraction scatters by
// sigmaB * sqrt(aperturePixelCount) / modelPower. See ABSORBED_POWER_NOISE_K
// and ABSORBED_POWER_MIN_FRACTION for the calibration. Signs are reported as
// measured (a negative excess means the model carries MORE power inside the
// probe than the data does); the trigger is on the magnitude.
function evaluateAbsorbedPower(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  roi: { x0: number; y0: number; width: number; height: number },
  params: Gauss2dFitParams | null,
  sigmaBCounts: number,
  totalPositiveCounts: number,
): ApertureAssessment["absorbedPower"] {
  const roiPixelCount = roi.width * roi.height;
  const fittedBackgroundCounts =
    params !== null && Number.isFinite(params.backgroundCounts) ? params.backgroundCounts : null;
  const noisePositiveCounts = (roiPixelCount * sigmaBCounts) / Math.sqrt(2 * Math.PI);
  const beamPowerRaw = totalPositiveCounts - noisePositiveCounts;
  const beamPowerCounts = Number.isFinite(beamPowerRaw) && beamPowerRaw > 0 ? beamPowerRaw : null;
  const flatRaw =
    fittedBackgroundCounts !== null && beamPowerCounts !== null
      ? (fittedBackgroundCounts * roiPixelCount) / beamPowerCounts
      : Number.NaN;
  const flatFractionOfBeamPower = Number.isFinite(flatRaw) ? flatRaw : null;

  const noMeasurement: ApertureAssessment["absorbedPower"] = {
    fittedBackgroundCounts,
    roiPixelCount,
    totalPositiveCounts,
    beamPowerCounts,
    flatFractionOfBeamPower,
    modelPowerCounts: null,
    probeAlpha: null,
    availableProbeAlphas: [],
    maxAvailableProbeAlpha: null,
    apertureExcessCounts: null,
    aperturePixelCount: 0,
    apertureExcessFraction: null,
    expectedNoiseFraction: null,
    thresholdFraction: null,
    high: false,
  };
  if (
    params === null ||
    !Number.isFinite(params.amplitudeCounts) ||
    !(params.amplitudeCounts > 0) ||
    !Number.isFinite(params.sigmaMajorPx) ||
    !Number.isFinite(params.sigmaMinorPx) ||
    !(params.sigmaMajorPx > 0) ||
    !(params.sigmaMinorPx > 0) ||
    !Number.isFinite(params.thetaRad) ||
    !Number.isFinite(params.centerXPx) ||
    !Number.isFinite(params.centerYPx)
  ) {
    return noMeasurement;
  }
  const modelPowerCounts = 2 * Math.PI * params.amplitudeCounts * params.sigmaMajorPx * params.sigmaMinorPx;
  if (!Number.isFinite(modelPowerCounts) || !(modelPowerCounts > 0)) return noMeasurement;

  const { values, width } = corrected;
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  const invTwoS1Sq = 1 / (2 * params.sigmaMajorPx * params.sigmaMajorPx);
  const invTwoS2Sq = 1 / (2 * params.sigmaMinorPx * params.sigmaMinorPx);
  const slopeX = params.backgroundSlopeXCountsPerPx ?? 0;
  const slopeY = params.backgroundSlopeYCountsPerPx ?? 0;

  let best: ApertureAssessment["absorbedPower"] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  // S20 stage B: every probe that produced a usable measurement, in the
  // ascending order of ABSORBED_POWER_PROBE_ALPHAS. Filled alongside the
  // scoring loop so the reported reach costs nothing extra.
  const availableProbeAlphas: number[] = [];
  for (const probeAlpha of ABSORBED_POWER_PROBE_ALPHAS) {
    const semiMajor = probeAlpha * params.sigmaMajorPx;
    const semiMinor = probeAlpha * params.sigmaMinorPx;
    const ex = Math.sqrt(semiMajor * cos * (semiMajor * cos) + semiMinor * sin * (semiMinor * sin));
    const ey = Math.sqrt(semiMajor * sin * (semiMajor * sin) + semiMinor * cos * (semiMinor * cos));
    if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
    // The probe is only honest when its whole ellipse is inside the analysis
    // domain: a probe clipped by the ROI measures a different region than the
    // one its noise model assumes.
    if (
      params.centerXPx - ex < roi.x0 ||
      params.centerXPx + ex > roi.x0 + roi.width - 1 ||
      params.centerYPx - ey < roi.y0 ||
      params.centerYPx + ey > roi.y0 + roi.height - 1
    ) {
      continue;
    }
    const xStart = Math.max(roi.x0, Math.ceil(params.centerXPx - ex));
    const xEnd = Math.min(roi.x0 + roi.width - 1, Math.floor(params.centerXPx + ex));
    const yStart = Math.max(roi.y0, Math.ceil(params.centerYPx - ey));
    const yEnd = Math.min(roi.y0 + roi.height - 1, Math.floor(params.centerYPx + ey));
    let excess = 0;
    let aperturePixelCount = 0;
    let finite = true;
    for (let y = yStart; y <= yEnd && finite; y += 1) {
      const row = y * width;
      const dy = y - params.centerYPx;
      for (let x = xStart; x <= xEnd; x += 1) {
        const value = values[row + x];
        if (!Number.isFinite(value)) continue;
        const dx = x - params.centerXPx;
        const u = dx * cos + dy * sin;
        const v = -dx * sin + dy * cos;
        if ((u * u) / (semiMajor * semiMajor) + (v * v) / (semiMinor * semiMinor) > 1) continue;
        const model =
          params.backgroundCounts +
          slopeX * dx +
          slopeY * dy +
          params.amplitudeCounts * Math.exp(-(u * u * invTwoS1Sq + v * v * invTwoS2Sq));
        const residual = value - model;
        if (!Number.isFinite(residual)) {
          finite = false;
          break;
        }
        excess += residual;
        aperturePixelCount += 1;
      }
    }
    if (!finite || aperturePixelCount === 0) continue;
    const apertureExcessFraction = excess / modelPowerCounts;
    const expectedNoiseFraction = (sigmaBCounts * Math.sqrt(aperturePixelCount)) / modelPowerCounts;
    if (!Number.isFinite(apertureExcessFraction) || !Number.isFinite(expectedNoiseFraction)) continue;
    availableProbeAlphas.push(probeAlpha);
    const thresholdFraction = Math.max(
      ABSORBED_POWER_MIN_FRACTION,
      ABSORBED_POWER_NOISE_K * expectedNoiseFraction,
    );
    const score = Math.abs(apertureExcessFraction) / thresholdFraction;
    if (score > bestScore) {
      bestScore = score;
      best = {
        fittedBackgroundCounts,
        roiPixelCount,
        totalPositiveCounts,
        beamPowerCounts,
        flatFractionOfBeamPower,
        modelPowerCounts,
        probeAlpha,
        // Filled in below: the list is only complete once every probe has been
        // tried, and a probe wider than the winner may still be available.
        availableProbeAlphas: [],
        maxAvailableProbeAlpha: null,
        apertureExcessCounts: excess,
        aperturePixelCount,
        apertureExcessFraction,
        expectedNoiseFraction,
        thresholdFraction,
        high: score > 1,
      };
    }
  }
  if (best === null) return noMeasurement;
  best.availableProbeAlphas = availableProbeAlphas;
  best.maxAvailableProbeAlpha =
    availableProbeAlphas.length > 0 ? availableProbeAlphas[availableProbeAlphas.length - 1] : null;
  return best;
}

function evaluatePedestal(
  corrected: { values: Float64Array | number[]; width: number },
  roi: { x0: number; y0: number; width: number; height: number },
  params: Gauss2dFitParams | null,
  alpha: number,
  peakCorr: number,
): ApertureAssessment["pedestal"] {
  const fittedBackgroundRelativeToPeak =
    params !== null && peakCorr > 0 && Number.isFinite(params.backgroundCounts)
      ? Math.abs(params.backgroundCounts) / peakCorr
      : null;
  if (
    params === null ||
    !(peakCorr > 0) ||
    !Number.isFinite(params.centerXPx) ||
    !Number.isFinite(params.centerYPx) ||
    !Number.isFinite(params.thetaRad) ||
    !Number.isFinite(params.sigmaMajorPx) ||
    !Number.isFinite(params.sigmaMinorPx)
  ) {
    // No meaningful outside-mean geometry: the fitted-background level alone
    // still raises the hint when it clears the documented fraction.
    return {
      meanOutsideRelativeToPeak: null,
      fittedBackgroundRelativeToPeak,
      hint: fittedBackgroundRelativeToPeak !== null && fittedBackgroundRelativeToPeak > PEDESTAL_HINT_FRACTION,
    };
  }
  const { values, width } = corrected;
  const semiMajor = alpha * params.sigmaMajorPx;
  const semiMinor = alpha * params.sigmaMinorPx;
  // A degenerate zero-width aperture covers no pixels, so every finite ROI
  // pixel counts as outside; the normal path uses the rotated-ellipse
  // quadratic membership without rounding loss.
  const hasArea = semiMajor > 0 && semiMinor > 0;
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  let sumOutside = 0;
  let countOutside = 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      if (hasArea) {
        const dx = x - params.centerXPx;
        const dy = y - params.centerYPx;
        const u = dx * cos + dy * sin;
        const v = -dx * sin + dy * cos;
        if ((u * u) / (semiMajor * semiMajor) + (v * v) / (semiMinor * semiMinor) <= 1) continue;
      }
      sumOutside += value;
      countOutside += 1;
    }
  }
  const meanOutsideRelativeToPeak = countOutside > 0 ? sumOutside / countOutside / peakCorr : null;
  return {
    meanOutsideRelativeToPeak,
    fittedBackgroundRelativeToPeak,
    hint:
      (meanOutsideRelativeToPeak !== null && meanOutsideRelativeToPeak > PEDESTAL_HINT_FRACTION) ||
      (fittedBackgroundRelativeToPeak !== null && fittedBackgroundRelativeToPeak > PEDESTAL_HINT_FRACTION),
  };
}

// S20 stage A: the model-bias coverage estimator.
//
// Non-finite pixels inside the measurement aperture are skipped by every
// moment accumulation, so a released width is computed over whatever support
// survived. The damage depends on the SHAPE of the mask, not on its size: a
// random mask thins the support evenly and moves the second moment barely at
// all, while a structured one (a dead sensor column, a masked flank) removes
// one side of the beam and moves it bodily. This function measures that
// difference directly instead of guessing at it from a dead-pixel fraction.
//
// Method: the fitted model is rasterized over the alpha aperture - the BEAM
// TERM ONLY, because stage-B moments are taken on the fit-background-
// subtracted field (B_eff = 0 semantics; including the background term would
// measure a pedestal the released numbers never see). Its ellipse moments are
// then computed twice: once over the full aperture, once with exactly the
// observed non-finite mask applied. The relative d4 difference between the
// two passes is the bias this coverage pattern induces on this beam.
//
// The mask and the trigger both read the CORRECTED field, never the stage-B
// field: the stage-B field NaN-masks everything outside the ROI, so reading
// it would make every ROI smaller than the frame look like a coverage defect.
//
// Work and allocation are bounded by the aperture bounding box (clipped to
// the ROI, which is the analysis domain), not by the image: the whole block
// is entered only when the ROI actually carries non-finite pixels AND gates
// 1-4 passed, so a clean frame pays exactly nothing and its output is
// bit-identical to a build without this block.
function evaluateCoverage(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  roi: { x0: number; y0: number; width: number; height: number },
  params: Gauss2dFitParams,
  alpha: number,
): ApertureAssessment["coverage"] {
  const unmeasured: ApertureAssessment["coverage"] = {
    aperturePixelCount: 0,
    finitePixelCount: 0,
    finiteFraction: null,
    modelBiasMajorPercent: null,
    modelBiasMinorPercent: null,
    high: false,
  };

  // The `unmeasured` bail-outs below are all shapes on which the aperture
  // itself is degenerate: the same parameter vector makes ellipseMomentsPass
  // throw or produce an invalid pass, so the frame has no stage-B moments to
  // release either way and cannot leak past a false `high: false`. That is the
  // difference between them and the fail-closed arm at the end, which fires on
  // an aperture that is known to be damaged but cannot be quantified.
  const semiMajor = alpha * params.sigmaMajorPx;
  const semiMinor = alpha * params.sigmaMinorPx;
  if (!Number.isFinite(semiMajor) || !Number.isFinite(semiMinor) || semiMajor <= 0 || semiMinor <= 0) {
    return unmeasured;
  }
  if (!Number.isFinite(params.amplitudeCounts)) return unmeasured;
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  const ex = Math.sqrt(semiMajor * cos * (semiMajor * cos) + semiMinor * sin * (semiMinor * sin));
  const ey = Math.sqrt(semiMajor * sin * (semiMajor * sin) + semiMinor * cos * (semiMinor * cos));
  if (!Number.isFinite(ex) || !Number.isFinite(ey)) return unmeasured;
  if (!Number.isFinite(params.centerXPx) || !Number.isFinite(params.centerYPx)) return unmeasured;

  // The aperture bounding box, padded by one pixel per side like
  // computeEllipseMoments' own row scan and clipped to the ROI.
  const bx0 = Math.max(roi.x0, Math.floor(params.centerXPx - ex) - 1);
  const bx1 = Math.min(roi.x0 + roi.width - 1, Math.ceil(params.centerXPx + ex) + 1);
  const by0 = Math.max(roi.y0, Math.floor(params.centerYPx - ey) - 1);
  const by1 = Math.min(roi.y0 + roi.height - 1, Math.ceil(params.centerYPx + ey) + 1);
  if (!(bx1 >= bx0) || !(by1 >= by0)) return unmeasured;
  const boxWidth = bx1 - bx0 + 1;
  const boxHeight = by1 - by0 + 1;

  const { values, width } = corrected;
  const s1 = params.sigmaMajorPx;
  const s2 = params.sigmaMinorPx;
  const invTwoS1Sq = s1 > 0 ? 1 / (2 * s1 * s1) : 0;
  const invTwoS2Sq = s2 > 0 ? 1 / (2 * s2 * s2) : 0;
  const full = new Float64Array(boxWidth * boxHeight);
  const masked = new Float64Array(boxWidth * boxHeight);
  for (let y = by0; y <= by1; y += 1) {
    const row = y * width;
    const outRow = (y - by0) * boxWidth;
    const dy = y - params.centerYPx;
    for (let x = bx0; x <= bx1; x += 1) {
      const dx = x - params.centerXPx;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const uTerm = s1 > 0 ? u * u * invTwoS1Sq : u === 0 ? 0 : Number.POSITIVE_INFINITY;
      const vTerm = s2 > 0 ? v * v * invTwoS2Sq : v === 0 ? 0 : Number.POSITIVE_INFINITY;
      const model = params.amplitudeCounts * Math.exp(-(uTerm + vTerm));
      const out = outRow + (x - bx0);
      full[out] = model;
      masked[out] = Number.isFinite(values[row + x]) ? model : Number.NaN;
    }
  }

  const box = { width: boxWidth, height: boxHeight };
  const ellipse = {
    centerXPx: params.centerXPx - bx0,
    centerYPx: params.centerYPx - by0,
    semiMajorPx: semiMajor,
    semiMinorPx: semiMinor,
    thetaRad: params.thetaRad,
  };
  // Exception-contained exactly like ellipseMomentsPass: computeEllipseMoments
  // validates its own ellipse, and it is handed the same semi axes and angle
  // the release pass uses, so anything that throws here throws there too.
  let fullMoments: ImageMoments | null = null;
  let maskedMoments: ImageMoments | null = null;
  try {
    fullMoments = computeEllipseMoments({ values: full, ...box }, ellipse);
    maskedMoments = computeEllipseMoments({ values: masked, ...box }, ellipse);
  } catch {
    return unmeasured;
  }

  // The full model raster is finite on exactly the aperture pixels that lie
  // inside the ROI; the masked one is finite on exactly those of them that
  // carry data. Both counts therefore come out of the passes themselves.
  const aperturePixelCount = fullMoments.finitePixelCount;
  const finitePixelCount = maskedMoments.finitePixelCount;
  const finiteFraction = aperturePixelCount > 0 ? finitePixelCount / aperturePixelCount : null;

  const relativePercent = (maskedValue: number | null, fullValue: number | null): number | null => {
    if (maskedValue === null || fullValue === null) return null;
    if (!Number.isFinite(maskedValue) || !Number.isFinite(fullValue) || fullValue <= 0) return null;
    return (100 * (maskedValue - fullValue)) / fullValue;
  };
  const modelBiasMajorPercent =
    fullMoments.valid && maskedMoments.valid
      ? relativePercent(maskedMoments.d4SigmaMajorPx, fullMoments.d4SigmaMajorPx)
      : null;
  const modelBiasMinorPercent =
    fullMoments.valid && maskedMoments.valid
      ? relativePercent(maskedMoments.d4SigmaMinorPx, fullMoments.d4SigmaMinorPx)
      : null;

  // Two arms plus a fail-closed one. The bias arm is the discriminator; the
  // finite-fraction arm covers the regime in which the masked model moments
  // themselves stop being trustworthy (a support that sparse no longer pins
  // the second moment); the fail-closed arm fires when the aperture is known
  // to be damaged (non-finite pixels are why this block ran at all) but no
  // bias number could be formed - measuring nothing is not the same as
  // measuring zero.
  const biasHigh =
    (modelBiasMajorPercent !== null && Math.abs(modelBiasMajorPercent) > COVERAGE_BIAS_MAX_PERCENT) ||
    (modelBiasMinorPercent !== null && Math.abs(modelBiasMinorPercent) > COVERAGE_BIAS_MAX_PERCENT);
  const fractionLow = finiteFraction !== null && finiteFraction < COVERAGE_MIN_FINITE_FRACTION;
  const unmeasurable = modelBiasMajorPercent === null || modelBiasMinorPercent === null || finiteFraction === null;

  return {
    aperturePixelCount,
    finitePixelCount,
    finiteFraction,
    modelBiasMajorPercent,
    modelBiasMinorPercent,
    high: biasHigh || fractionLow || unmeasurable,
  };
}

export type ApertureSuppressionReason =
  | "fit_not_converged"
  | "nonpositive_amplitude"
  | "residual_high"
  | "aperture_clipped"
  | "coverage_insufficient"
  | "alpha_inconsistent"
  | "multi_peak";

export type ApertureAssessment = {
  // Stage B: ellipse moments inside the alpha*sigmaFit aperture around the
  // 2D-Gauss fit centre, measured on the fit-background-subtracted field.
  // Null unless ALL gates pass - never substituted by stage-A rect moments
  // (contract).
  moments: ImageMoments | null;
  suppressionReason: ApertureSuppressionReason | null;
  // Stage C: the model-bound fit widths, always reported when the fit
  // converged AND the amplitude is positive (independent of the later
  // gates). A non-positive amplitude makes the model-bound widths
  // meaningless, so fitWidths is null then.
  fitWidths: { d4SigmaMajorPx: number; d4SigmaMinorPx: number } | null;
  gates: {
    fitConverged: boolean;
    amplitudePositive: boolean;
    residual: { rmsCounts: number; maxAllowedCounts: number; high: boolean };
    clipping: { checkEllipseInside: boolean };
    alphaConsistency: {
      deltaMajorPercent: number | null;
      deltaMinorPercent: number | null;
      inconsistent: boolean;
      thresholdMajorPercent: number;
      thresholdMinorPercent: number;
      nullRmsMajorPercent: number | null;
      nullRmsMinorPercent: number | null;
      // S18-R2 F2: per-image NOISE SCATTER of the released d4 widths, in
      // percent of the released value - the sample standard deviation (n-1)
      // of the alpha-pass d4 over the SAME Monte-Carlo realizations the gate
      // threshold is built from, mapped back from the decimated grid by the
      // decimation factor. Null whenever the MC did not run (sigmaB = 0, an
      // earlier gate failed, degenerate geometry, too few valid realizations)
      // or no observed alpha pass exists to reference. This is a released-
      // number uncertainty, NOT a gate: it never suppresses anything.
      d4ScatterMajorPercent: number | null;
      d4ScatterMinorPercent: number | null;
      mcRealizationCount: number;
      decimationFactor: number;
    };
    multiPeak: {
      significantPeakCount: number;
      detected: boolean;
      thresholdCounts: number;
      evtThresholdCounts: number;
      peakFloorCounts: number;
      scannedPixelCount: number;
    };
  };
  // Mean corrected intensity OUTSIDE the aperture ellipse but inside the ROI,
  // relative to the corrected peak, measured on the fit-background-
  // subtracted field; the fitted background level itself is reported
  // separately as |backgroundCounts| / peakCorr. The pedestal hint fires when
  // EITHER exceeds the documented PEDESTAL_HINT_FRACTION (R4 series: a
  // 1 percent pedestal biases D4sigma by +10.4 percent), so a background the
  // fit has already absorbed still raises the "check your background
  // correction" flag.
  pedestal: {
    meanOutsideRelativeToPeak: number | null;
    fittedBackgroundRelativeToPeak: number | null;
    hint: boolean;
  };
  // S18-R2 F1 (a): the POWER the fitted flat background holds over the ROI,
  // referenced against the beam power actually present there. This is the
  // pedestal question asked in power rather than in amplitude, which is what
  // a faint WIDE wing absorbed by the constant background term shows up in.
  // Every field is a measurement; `high` is the calibrated verdict. It is an
  // honesty instrument, NOT a gate: nothing here suppresses a release.
  absorbedPower: {
    fittedBackgroundCounts: number | null;
    roiPixelCount: number;
    totalPositiveCounts: number;
    // totalPositiveCounts de-biased by the expected positive half-sum of
    // zero-mean noise; null when the de-biased power is not positive.
    beamPowerCounts: number | null;
    // fittedBackgroundCounts * roiPixelCount / beamPowerCounts, signed.
    // MEASUREMENT ONLY - it cannot tell a harmless flat residual level from an
    // absorbed wing, so it never triggers (see evaluateAbsorbedPower).
    flatFractionOfBeamPower: number | null;
    // 2*pi*A*sigmaMajor*sigmaMinor of the fitted Gaussian.
    modelPowerCounts: number | null;
    // Which ellipse probe (in units of the fitted sigmas) the reported numbers
    // below belong to: the probe with the largest excess relative to its own
    // ceiling among the probes that fit inside the ROI.
    probeAlpha: number | null;
    // S20 stage B: WHICH probes were available at all, in ascending order, and
    // the widest of them. A probe whose ellipse leaves the ROI is dropped
    // silently, so a tight ROI can leave the detector with only its innermost
    // radii - and a faint wide wing is exactly what those radii see least of
    // (measured on one wing scene: 1.7296 percent excess at the 12 sigma probe
    // against 0.0735 percent at the 6 sigma one). Without these two fields the
    // reported probeAlpha alone cannot tell "this radius was the most
    // informative" from "this radius was the only one left".
    availableProbeAlphas: number[];
    maxAvailableProbeAlpha: number | null;
    // Sum of (corrected - full fitted model) over that probe ellipse, and the
    // pixel count that sum ran over.
    apertureExcessCounts: number | null;
    aperturePixelCount: number;
    // apertureExcessCounts / modelPowerCounts, signed. This is the triggering
    // statistic: a flat level the fit absorbed cancels here, an absorbed wing
    // does not.
    apertureExcessFraction: number | null;
    // sigmaB * sqrt(aperturePixelCount) / modelPowerCounts: the scatter the
    // excess fraction inherits from this image's noise alone.
    expectedNoiseFraction: number | null;
    thresholdFraction: number | null;
    high: boolean;
  };
  // S20 stage A: how much of the measurement aperture actually carries data,
  // and what the observed non-finite pattern does to the released widths.
  // Measured ONLY when the ROI carries non-finite pixels AND gates 1-4
  // passed; otherwise every field is its no-data default (counts 0, numbers
  // null, high false) and nothing was computed. `high` is the verdict that
  // suppresses the release with reason "coverage_insufficient"; the bias
  // numbers are the estimate of the error the coverage pattern induces on
  // this beam, in percent of the unmasked model width, signed.
  coverage: {
    aperturePixelCount: number;
    finitePixelCount: number;
    finiteFraction: number | null;
    modelBiasMajorPercent: number | null;
    modelBiasMinorPercent: number | null;
    high: boolean;
  };
  // I_peak_corr / sigma_B, ONLY when sigma_B > 0 AND I_peak_corr > 0, else null.
  peakToBackgroundNoise: number | null;
  alphaUsed: number;
};

export function assessAperture(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  roi: { x0: number; y0: number; width: number; height: number },
  fit: FitResult<Gauss2dFitParams>,
  sigmaBCounts: number,
  options?: { alpha?: number },
): ApertureAssessment {
  validateCorrectedImage(corrected);
  validateRoi(corrected, roi);
  if (!Number.isFinite(sigmaBCounts) || sigmaBCounts < 0) {
    throw new RangeError("sigmaBCounts must be a finite number >= 0");
  }
  const alpha = options?.alpha ?? APERTURE_ALPHA_DEFAULT;
  if (!Number.isFinite(alpha) || alpha <= 0) {
    throw new RangeError("alpha must be a finite number > 0");
  }

  const { values, width } = corrected;
  let peakCorr = 0;
  let totalPositiveCounts = 0;
  // S20 stage A: the non-finite count inside the ROI is folded into the scan
  // that was already walking every ROI pixel, on the branch that already
  // existed - it costs one increment on pixels the loop was skipping anyway.
  let roiNonFiniteCount = 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) {
        roiNonFiniteCount += 1;
        continue;
      }
      if (value > peakCorr) peakCorr = value;
      if (value > 0) totalPositiveCounts += value;
    }
  }

  const params = fit.params;
  const fitConverged = fit.status === "converged" && params !== null;
  const amplitudePositive = params === null || params.amplitudeCounts > 0;

  // S20 stage F: both gate ceilings below are referenced against this peak, not
  // against the raw peakCorr above. peakCorr stays the raw measured export.
  const ceilingPeakCounts = ceilingPeak(corrected, roi, params, peakCorr);

  let residual: ApertureAssessment["gates"]["residual"];
  if (params === null) {
    residual = { rmsCounts: 0, maxAllowedCounts: residualMaxAllowed(ceilingPeakCounts, sigmaBCounts), high: false };
  } else {
    residual = evaluateResidualGate(corrected, roi, params, sigmaBCounts, ceilingPeakCounts);
  }

  const clipping: ApertureAssessment["gates"]["clipping"] =
    params === null ? { checkEllipseInside: true } : evaluateClippingGate(roi, params);

  // Revision 9.4: the alpha-consistency Monte Carlo runs ONLY when gates 1-4
  // already passed. On earlier-gate suppression the alphaConsistency fields
  // carry the observed deltas plus floor thresholds, nullRms null,
  // mcRealizationCount 0, decimationFactor 1 - honouring the section-1.2
  // premise (the local box assumes an unclipped ellipse) and removing wasted
  // MC cost on already-suppressed frames (measured up to 11.9 s).
  const earlyGatesPassed =
    fitConverged &&
    amplitudePositive &&
    !residual.high &&
    clipping.checkEllipseInside;

  // Stage-B field: remove the fitted background plane from the ROI values
  // before the ellipse-moment passes and the pedestal scan.
  const stageBField =
    params === null
      ? corrected
      : {
          values: subtractFittedBackground(corrected, roi, params),
          width: corrected.width,
          height: corrected.height,
        };

  let alphaPass: ImageMoments | null = null;
  let alphaConsistency: ApertureAssessment["gates"]["alphaConsistency"];
  if (params === null) {
    alphaConsistency = {
      deltaMajorPercent: null,
      deltaMinorPercent: null,
      inconsistent: false,
      thresholdMajorPercent: ALPHA_CONSISTENCY_MAX_PERCENT,
      thresholdMinorPercent: ALPHA_CONSISTENCY_MAX_PERCENT,
      nullRmsMajorPercent: null,
      nullRmsMinorPercent: null,
      d4ScatterMajorPercent: null,
      d4ScatterMinorPercent: null,
      mcRealizationCount: 0,
      decimationFactor: 1,
    };
  } else {
    alphaPass = ellipseMomentsPass(stageBField, params, alpha);
    alphaConsistency = evaluateAlphaConsistencyGate(stageBField, params, alpha, sigmaBCounts, earlyGatesPassed);
  }

  // S18-R2 F4: the multi-peak scan runs on the STAGE-B FIELD like every other
  // post-residual gate, not on the raw corrected values. Reading `corrected`
  // contradicted the documented stage-B semantics and made the gate offset-
  // dependent: with an un-subtracted background above ~10 percent of the peak
  // the 0.1 * peakCorr candidate floor sits BELOW background + a few sigmaB,
  // so ordinary background noise maxima were counted as beams (measured:
  // 11x6 amp 20000 with offset 2000 at SNR 100 -> 9 "peaks"; the same scene
  // on the fit-background-subtracted field -> 1 peak).
  //
  // S20 stage F (F4) completes that move: the candidate FLOOR is now referenced
  // against the stage-B ceiling peak too, so the field being scanned and the
  // floor being scanned against finally live in the same reference. peakCorr
  // keeps its corrected-field definition and stays the pedestal reference and
  // the exported measurement.
  const multiPeak = evaluateMultiPeakGate(stageBField, roi, sigmaBCounts, params, ceilingPeakCounts);

  // S20 stage A (gate 5, between clipping and alpha): the aperture coverage
  // block. Entered ONLY when the ROI carries non-finite pixels AND gates 1-4
  // passed - the first condition keeps every clean frame bit-identical, the
  // second is the point at which the check ellipse is known to lie inside the
  // ROI, so an aperture-bound computation is meaningful at all. The mask is
  // read off the CORRECTED field, never the stage-B field: that one NaN-masks
  // the whole ROI exterior, which would read as a total coverage loss on any
  // ROI smaller than the frame.
  const coverage =
    params !== null && earlyGatesPassed && roiNonFiniteCount > 0
      ? evaluateCoverage(corrected, roi, params, alpha)
      : {
          aperturePixelCount: 0,
          finitePixelCount: 0,
          finiteFraction: null,
          modelBiasMajorPercent: null,
          modelBiasMinorPercent: null,
          high: false,
        };

  // Release precedence: the FIRST failing gate in the documented order is the
  // reported reason, even when later gates would also fail.
  let suppressionReason: ApertureSuppressionReason | null;
  if (!fitConverged) {
    suppressionReason = "fit_not_converged";
  } else if (!amplitudePositive) {
    suppressionReason = "nonpositive_amplitude";
  } else if (residual.high) {
    suppressionReason = "residual_high";
  } else if (!clipping.checkEllipseInside) {
    suppressionReason = "aperture_clipped";
  } else if (coverage.high) {
    suppressionReason = "coverage_insufficient";
  } else if (alphaConsistency.inconsistent) {
    suppressionReason = "alpha_inconsistent";
  } else if (multiPeak.detected) {
    suppressionReason = "multi_peak";
  } else {
    suppressionReason = null;
  }

  const allGatesPass =
    fitConverged &&
    amplitudePositive &&
    !residual.high &&
    clipping.checkEllipseInside &&
    !coverage.high &&
    !alphaConsistency.inconsistent &&
    !multiPeak.detected;
  const moments = allGatesPass && alphaPass !== null && alphaPass.valid ? alphaPass : null;

  const fitWidths =
    fitConverged && params !== null && amplitudePositive
      ? { d4SigmaMajorPx: 4 * params.sigmaMajorPx, d4SigmaMinorPx: 4 * params.sigmaMinorPx }
      : null;

  const pedestal = evaluatePedestal(stageBField, roi, params, alpha, peakCorr);
  const absorbedPower = evaluateAbsorbedPower(corrected, roi, params, sigmaBCounts, totalPositiveCounts);

  const peakToBackgroundNoise = sigmaBCounts > 0 && peakCorr > 0 ? peakCorr / sigmaBCounts : null;

  return {
    moments,
    suppressionReason,
    fitWidths,
    gates: {
      fitConverged,
      amplitudePositive,
      residual,
      clipping,
      alphaConsistency,
      multiPeak,
    },
    pedestal,
    absorbedPower,
    coverage,
    peakToBackgroundNoise,
    alphaUsed: alpha,
  };
}
