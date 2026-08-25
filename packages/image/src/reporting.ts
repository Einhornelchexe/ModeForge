import {
  SUPER_GAUSS_N_MAX,
  SUPER_GAUSS_N_MIN,
  type FitResult,
  type Gauss2dFitParams,
  type SuperGauss2dFitParams,
} from "./fit.ts";
import type { BackgroundNoiseEstimate } from "./background.ts";
import type { ImageMoments } from "./moments.ts";
import type { ImageCalibration } from "./contracts.ts";
import { RESIDUAL_DISPLAY_MAX_SIZE } from "./thresholds.ts";

// Output and comparison layer of the fit stage (S18d-C, Plan v5 section 6).
// Responsibilities:
// - anisotropy-exact mapping of pixel-space fit/moment geometry into
//   physical (micrometer) coordinates;
// - model comparison as relative RMS reduction;
// - fit-vs-moments width comparison (Super-Gaussian second moment via the
//   Gamma function);
// - the residual RMS/max output plus the block-averaged display grid.
// All inputs are validated where the contract requires it; none are mutated.

export type PhysicalBeamGeometry = {
  centerXUm: number;
  centerYUm: number;
  sigmaMajorUm: number;
  sigmaMinorUm: number;
  d4SigmaMajorUm: number;
  d4SigmaMinorUm: number;
  thetaRad: number;
};

type CorrectedImage = { values: Float64Array | number[]; width: number; height: number };

type Roi = { x0: number; y0: number; width: number; height: number };

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

function validateRoi(corrected: CorrectedImage, roi: Roi): void {
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

function validateCalibration(calibration: ImageCalibration): void {
  if (!Number.isFinite(calibration.pixelPitchUmX) || calibration.pixelPitchUmX <= 0) {
    throw new RangeError("calibration.pixelPitchUmX must be a positive finite number");
  }
  if (!Number.isFinite(calibration.pixelPitchUmY) || calibration.pixelPitchUmY <= 0) {
    throw new RangeError("calibration.pixelPitchUmY must be a positive finite number");
  }
}

// Canonicalize a principal-axis angle to [0, pi); exact pi folds back to 0
// (the same rule as moments.ts).
function canonicalizeTheta(theta: number): number {
  let t = theta % Math.PI;
  if (t < 0) t += Math.PI;
  if (t >= Math.PI) t = 0;
  return t;
}

// Relative tolerance for clamping a slightly negative minor eigenvalue to 0
// in eigen22. This is the same cancellation-noise clamp moments.ts uses on
// the pixel covariance: a rank-1 covariance (sigmaMinor = 0 is production-
// reachable through the decimation-to-half-sigma mapping in fit.ts, and a
// collinear moment set is rank-1 as well) has an exact minor eigenvalue of
// zero, but mean - discriminant can land a few ulp below it. That negative
// number would make Math.sqrt produce NaN in the physical mapping. Orders of
// magnitude above ~1e-16 cancellation noise, orders below genuine
// indefiniteness.
const EIG_NEGATIVE_TOLERANCE = 1e-9;

// Analytic eigen decomposition of a symmetric 2x2 covariance matrix.
// Major is the larger eigenvalue (larger sigma) first. Tiny negative minor
// eigenvalues from rank-1 cancellation (including the pitch-product
// cancellation of the anisotropic scaling below) are clamped to exactly 0 so
// the physical widths stay finite and bit-stable.
function eigen22(cxx: number, cyy: number, cxy: number): {
  lambdaMajor: number;
  lambdaMinor: number;
  thetaRad: number;
} {
  const mean = (cxx + cyy) / 2;
  const halfDifference = (cxx - cyy) / 2;
  const discriminant = Math.sqrt(halfDifference * halfDifference + cxy * cxy);
  const lambdaMajor = mean + discriminant;
  let lambdaMinor = mean - discriminant;
  // lambdaMinor = mean - disc cancels catastrophically for exactly rank-1
  // (collinear) covariances, including a zero pixel-space minor sigma scaled
  // by anisotropic pitches: the exact value is 0 but the rounded result can
  // land a few ulp below zero and NaN the subsequent square root. Genuine
  // indefiniteness is O(lambdaMajor) and is intentionally NOT clamped.
  if (lambdaMinor < 0 && -lambdaMinor <= EIG_NEGATIVE_TOLERANCE * Math.max(lambdaMajor, 0)) {
    lambdaMinor = 0;
  }
  const thetaRad = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  return { lambdaMajor, lambdaMinor, thetaRad };
}

// PART 1 - physical calibration mapping (Plan v5 section 6, anisotropy-exact).
//
// The pixel-space covariance of the fitted Gaussian is
//   C_px = R(theta) * diag(sigmaMajor^2, sigmaMinor^2) * R(theta)^T
// and physical coordinates scale each pixel axis by its own pitch, so the
// physical covariance is C_um = S * C_px * S^T with
// S = diag(pixelPitchUmX, pixelPitchUmY). The physical widths are then the
// square roots of the eigenvalues of C_um and the physical angle comes from
// the major eigenvector.
//
// This is NOT the same as scaling the pixel sigmas per axis: with anisotropic
// pitches the off-diagonal entry picks up both pitches, so the physical angle
// differs from the pixel angle and the physical widths are not simply
// sigmaMajorPx * pitchX / sigmaMinorPx * pitchY. The covariance transform
// captures the cross term exactly.
export function mapGauss2dToPhysical(
  params: Gauss2dFitParams,
  calibration: ImageCalibration,
): PhysicalBeamGeometry {
  validateCalibration(calibration);
  const { pixelPitchUmX: pitchX, pixelPitchUmY: pitchY } = calibration;
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  const major2 = params.sigmaMajorPx * params.sigmaMajorPx;
  const minor2 = params.sigmaMinorPx * params.sigmaMinorPx;
  const cxxPx = cos * cos * major2 + sin * sin * minor2;
  const cyyPx = sin * sin * major2 + cos * cos * minor2;
  const cxyPx = cos * sin * (major2 - minor2);
  const cxxUm = cxxPx * pitchX * pitchX;
  const cyyUm = cyyPx * pitchY * pitchY;
  const cxyUm = cxyPx * pitchX * pitchY;
  const { lambdaMajor, lambdaMinor, thetaRad } = eigen22(cxxUm, cyyUm, cxyUm);
  const sigmaMajorUm = Math.sqrt(lambdaMajor);
  const sigmaMinorUm = Math.sqrt(lambdaMinor);
  return {
    centerXUm: params.centerXPx * pitchX,
    centerYUm: params.centerYPx * pitchY,
    sigmaMajorUm,
    sigmaMinorUm,
    d4SigmaMajorUm: 4 * sigmaMajorUm,
    d4SigmaMinorUm: 4 * sigmaMinorUm,
    thetaRad: canonicalizeTheta(thetaRad),
  };
}

// Same covariance transform applied to stage-A rectangle/ellipse moments:
// the moments' covXx/covYy/covXy (already px^2) are scaled into um^2 and
// re-diagonalized. Returns null whenever the moments are invalid.
export function mapMomentsToPhysical(
  moments: ImageMoments,
  calibration: ImageCalibration,
): PhysicalBeamGeometry | null {
  validateCalibration(calibration);
  if (!moments.valid) return null;
  const { pixelPitchUmX: pitchX, pixelPitchUmY: pitchY } = calibration;
  const cxxUm = (moments.covXxPx2 as number) * pitchX * pitchX;
  const cyyUm = (moments.covYyPx2 as number) * pitchY * pitchY;
  const cxyUm = (moments.covXyPx2 as number) * pitchX * pitchY;
  const { lambdaMajor, lambdaMinor, thetaRad } = eigen22(cxxUm, cyyUm, cxyUm);
  const sigmaMajorUm = Math.sqrt(lambdaMajor);
  const sigmaMinorUm = Math.sqrt(lambdaMinor);
  return {
    centerXUm: (moments.centroidXPx as number) * pitchX,
    centerYUm: (moments.centroidYPx as number) * pitchY,
    sigmaMajorUm,
    sigmaMinorUm,
    d4SigmaMajorUm: 4 * sigmaMajorUm,
    d4SigmaMinorUm: 4 * sigmaMinorUm,
    thetaRad: canonicalizeTheta(thetaRad),
  };
}

// ---------------------------------------------------------------------------
// Model values at full resolution
// ---------------------------------------------------------------------------

// 2D Gauss model evaluated exactly as in aperture.ts:
//   I = B [+ bx*(x-cx) + by*(y-cy)] + A*exp(-(u^2/(2*s1^2) + v^2/(2*s2^2)))
// with u/v rotated by theta about (cx, cy).
function gauss2dValueAt(params: Gauss2dFitParams, x: number, y: number): number {
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  const s1 = params.sigmaMajorPx;
  const s2 = params.sigmaMinorPx;
  const dx = x - params.centerXPx;
  const dy = y - params.centerYPx;
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;
  const uTerm = s1 > 0 ? (u * u) / (2 * s1 * s1) : u === 0 ? 0 : Number.POSITIVE_INFINITY;
  const vTerm = s2 > 0 ? (v * v) / (2 * s2 * s2) : v === 0 ? 0 : Number.POSITIVE_INFINITY;
  const slopeX = params.backgroundSlopeXCountsPerPx ?? 0;
  const slopeY = params.backgroundSlopeYCountsPerPx ?? 0;
  return params.backgroundCounts + slopeX * dx + slopeY * dy + params.amplitudeCounts * Math.exp(-(uTerm + vTerm));
}

// Exact Super-Gaussian of Plan v5 section 6:
//   I = B + A*exp(-2*((u/w1)^2 + (v/w2)^2)^n).
export function superGauss2dValueAt(params: SuperGauss2dFitParams, x: number, y: number): number {
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  const dx = x - params.centerXPx;
  const dy = y - params.centerYPx;
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;
  const w1 = params.w1Px;
  const w2 = params.w2Px;
  let energy: number;
  if (u === 0 && v === 0) {
    energy = 0;
  } else if (!(w1 > 0) || !(w2 > 0)) {
    energy = Number.POSITIVE_INFINITY;
  } else {
    energy = (u * u) / (w1 * w1) + (v * v) / (w2 * w2);
  }
  return params.backgroundCounts + params.amplitudeCounts * Math.exp(-2 * Math.pow(energy, params.superGaussN));
}

export type ResidualStats = {
  meanCounts: number;
  rmsCounts: number;
  sigmaCounts: number;
  skewness: number | null;
  excessKurtosis: number | null;
  finiteCount: number;
};

export type ResidualHistogram = {
  binEdgesCounts: number[];
  counts: number[];
  underflowCount: number;
  overflowCount: number;
};

type ResidualDisplay = { width: number; height: number; blockSizePx: number; values: Float64Array };

type HistogramAccumulator = {
  binEdgesCounts: number[];
  counts: Uint32Array;
  underflowCount: number;
  overflowCount: number;
};

type DisplayAccumulator = {
  width: number;
  height: number;
  blockSizePx: number;
  sums: Float64Array;
  counts: Uint32Array;
};

type ResidualAccumulator = {
  sumSquared: number;
  maxAbsCounts: number;
  finiteCount: number;
  sumCounts: number;
  sumShiftedCounts: number;
  sumShiftedSquared: number;
  sumShiftedCubed: number;
  sumShiftedFourth: number;
  display: DisplayAccumulator | null;
  histogram: HistogramAccumulator | null;
};

export type ModelResidualDiagnostics = {
  rmsCounts: number;
  maxAbsCounts: number;
  nrmse: number | null;
  rmsOverSigmaB: number | null;
  display: ResidualDisplay;
  stats: ResidualStats | null;
  histogram: ResidualHistogram | null;
};

export type ModelResidualComparison = {
  gaussRmsCounts: number | null;
  superGaussRmsCounts: number | null;
  relativeRmsReduction: number | null;
  residualDiagnostics: {
    gauss: ModelResidualDiagnostics;
    superGauss: (ModelResidualDiagnostics & { nAtBoundary: boolean }) | null;
  } | null;
};

type ResidualDiagnosticsOptions = {
  noise?: Pick<BackgroundNoiseEstimate, "sigmaCounts" | "scaleSource" | "floorApplied">;
};

const RESIDUAL_HISTOGRAM_BIN_COUNT = 65;
const RESIDUAL_HISTOGRAM_SIGMA_MULTIPLIER = 8;

function hasUsableSigmaB(noise: ResidualDiagnosticsOptions["noise"]): noise is NonNullable<ResidualDiagnosticsOptions["noise"]> {
  return noise !== undefined && noise.sigmaCounts > 0 && noise.scaleSource !== "zero" && !noise.floorApplied;
}

function createDisplayAccumulator(roi: Roi): DisplayAccumulator {
  let blockSizePx = 1;
  while (
    Math.ceil(roi.width / blockSizePx) > RESIDUAL_DISPLAY_MAX_SIZE ||
    Math.ceil(roi.height / blockSizePx) > RESIDUAL_DISPLAY_MAX_SIZE
  ) {
    blockSizePx += 1;
  }
  const width = Math.ceil(roi.width / blockSizePx);
  const height = Math.ceil(roi.height / blockSizePx);
  return {
    width,
    height,
    blockSizePx,
    sums: new Float64Array(width * height),
    counts: new Uint32Array(width * height),
  };
}

function finishDisplay(accumulator: DisplayAccumulator): ResidualDisplay {
  const values = new Float64Array(accumulator.sums.length);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = accumulator.counts[i] > 0 ? accumulator.sums[i] / accumulator.counts[i] : Number.NaN;
  }
  return {
    width: accumulator.width,
    height: accumulator.height,
    blockSizePx: accumulator.blockSizePx,
    values,
  };
}

function makeHistogramEdges(limit: number): number[] {
  const edges = new Array<number>(RESIDUAL_HISTOGRAM_BIN_COUNT + 1);
  const safeLimit = Number.isFinite(limit) && limit >= 0 ? limit : 0;
  const width = (2 * safeLimit) / RESIDUAL_HISTOGRAM_BIN_COUNT;
  for (let i = 0; i <= RESIDUAL_HISTOGRAM_BIN_COUNT; i += 1) edges[i] = -safeLimit + i * width;
  return edges;
}

function createHistogramAccumulator(binEdgesCounts: number[]): HistogramAccumulator {
  return {
    binEdgesCounts,
    counts: new Uint32Array(RESIDUAL_HISTOGRAM_BIN_COUNT),
    underflowCount: 0,
    overflowCount: 0,
  };
}

function accumulateHistogram(histogram: HistogramAccumulator, residual: number): void {
  const lower = histogram.binEdgesCounts[0];
  const upper = histogram.binEdgesCounts[histogram.binEdgesCounts.length - 1];
  if (residual < lower) {
    histogram.underflowCount += 1;
    return;
  }
  if (residual > upper) {
    histogram.overflowCount += 1;
    return;
  }
  const width = (upper - lower) / RESIDUAL_HISTOGRAM_BIN_COUNT;
  if (!(width > 0)) {
    histogram.counts[Math.floor(RESIDUAL_HISTOGRAM_BIN_COUNT / 2)] += 1;
    return;
  }
  let index = Math.min(RESIDUAL_HISTOGRAM_BIN_COUNT - 1, Math.floor((residual - lower) / width));
  if (index > 0 && residual < histogram.binEdgesCounts[index]) {
    index -= 1;
  } else if (
    index < RESIDUAL_HISTOGRAM_BIN_COUNT - 1 &&
    residual >= histogram.binEdgesCounts[index + 1]
  ) {
    index += 1;
  }
  histogram.counts[index] += 1;
}

function createResidualAccumulator(display: DisplayAccumulator | null, histogram: HistogramAccumulator | null): ResidualAccumulator {
  return {
    sumSquared: 0,
    maxAbsCounts: 0,
    finiteCount: 0,
    sumCounts: 0,
    sumShiftedCounts: 0,
    sumShiftedSquared: 0,
    sumShiftedCubed: 0,
    sumShiftedFourth: 0,
    display,
    histogram,
  };
}

function residualStats(accumulator: ResidualAccumulator): ResidualStats | null {
  if (accumulator.finiteCount === 0) return null;
  const count = accumulator.finiteCount;
  const meanCounts = accumulator.sumCounts / count;
  const secondMoment = accumulator.sumSquared / count;
  // Population estimator, no bias correction. Higher moments are accumulated
  // around the first finite residual to avoid cancellation in raw power sums.
  const shiftedMean = accumulator.sumShiftedCounts / count;
  const shiftedSecondMoment = accumulator.sumShiftedSquared / count;
  const shiftedThirdMoment = accumulator.sumShiftedCubed / count;
  const shiftedFourthMoment = accumulator.sumShiftedFourth / count;
  const variance = Math.max(0, shiftedSecondMoment - shiftedMean * shiftedMean);
  const thirdCentralMoment =
    shiftedThirdMoment - 3 * shiftedMean * shiftedSecondMoment + 2 * shiftedMean ** 3;
  const fourthCentralMoment = Math.max(
    0,
    shiftedFourthMoment -
      4 * shiftedMean * shiftedThirdMoment +
      6 * shiftedMean * shiftedMean * shiftedSecondMoment -
      3 * shiftedMean ** 4,
  );
  const sigmaCounts = Math.sqrt(variance);
  const skewness = sigmaCounts > 0 ? thirdCentralMoment / Math.pow(sigmaCounts, 3) : null;
  const excessKurtosis = sigmaCounts > 0 ? Math.max(-2, fourthCentralMoment / (variance * variance) - 3) : null;
  return {
    meanCounts,
    rmsCounts: Math.sqrt(secondMoment),
    sigmaCounts,
    skewness,
    excessKurtosis,
    finiteCount: count,
  };
}

function residualHistogram(accumulator: ResidualAccumulator): ResidualHistogram | null {
  if (accumulator.finiteCount === 0 || accumulator.histogram === null) return null;
  return {
    binEdgesCounts: accumulator.histogram.binEdgesCounts,
    counts: Array.from(accumulator.histogram.counts),
    underflowCount: accumulator.histogram.underflowCount,
    overflowCount: accumulator.histogram.overflowCount,
  };
}

function residualRms(accumulator: ResidualAccumulator): number {
  return accumulator.finiteCount > 0 ? Math.sqrt(accumulator.sumSquared / accumulator.finiteCount) : 0;
}

function accumulateFallbackHistograms(
  corrected: CorrectedImage,
  roi: Roi,
  gaussParams: Gauss2dFitParams,
  superGaussParams: SuperGauss2dFitParams | null,
  gaussHistogram: HistogramAccumulator,
  superGaussHistogram: HistogramAccumulator | null,
): void {
  const { values, width } = corrected;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      const gaussResidual = value - gauss2dValueAt(gaussParams, x, y);
      if (Number.isFinite(gaussResidual)) accumulateHistogram(gaussHistogram, gaussResidual);
      if (superGaussParams !== null && superGaussHistogram !== null) {
        const superGaussResidual = value - superGauss2dValueAt(superGaussParams, x, y);
        if (Number.isFinite(superGaussResidual)) accumulateHistogram(superGaussHistogram, superGaussResidual);
      }
    }
  }
}

function buildResidualDiagnostics(
  accumulator: ResidualAccumulator,
  amplitudeCounts: number,
  sigmaBCounts: number | null,
  display: DisplayAccumulator,
): ModelResidualDiagnostics {
  const rmsCounts = residualRms(accumulator);
  const hasFiniteResiduals = accumulator.finiteCount > 0;
  return {
    rmsCounts,
    maxAbsCounts: accumulator.maxAbsCounts,
    nrmse: hasFiniteResiduals && Number.isFinite(amplitudeCounts) && amplitudeCounts > 0 ? rmsCounts / amplitudeCounts : null,
    rmsOverSigmaB: hasFiniteResiduals && sigmaBCounts !== null ? rmsCounts / sigmaBCounts : null,
    display: finishDisplay(display),
    stats: residualStats(accumulator),
    histogram: residualHistogram(accumulator),
  };
}

type DualResidualTotals = {
  gaussSumCounts: number;
  gaussSumSquared: number;
  gaussSumShiftedCounts: number;
  gaussSumShiftedSquared: number;
  gaussSumShiftedCubed: number;
  gaussSumShiftedFourth: number;
  gaussMaxAbsCounts: number;
  gaussFiniteCount: number;
  gaussUnderflowCount: number;
  gaussOverflowCount: number;
  superGaussSumCounts: number;
  superGaussSumSquared: number;
  superGaussSumShiftedCounts: number;
  superGaussSumShiftedSquared: number;
  superGaussSumShiftedCubed: number;
  superGaussSumShiftedFourth: number;
  superGaussMaxAbsCounts: number;
  superGaussFiniteCount: number;
  superGaussUnderflowCount: number;
  superGaussOverflowCount: number;
};

const RESIDUAL_FINITE_VALUE_LIMIT = Number.MAX_VALUE / 4;
const RESIDUAL_FINITE_INTERMEDIATE_LIMIT = 1e150;

function residualsAreProvablyFinite(
  roi: Roi,
  gaussParams: Gauss2dFitParams,
  superGaussParams: SuperGauss2dFitParams,
): boolean {
  const gaussSlopeX = gaussParams.backgroundSlopeXCountsPerPx ?? 0;
  const gaussSlopeY = gaussParams.backgroundSlopeYCountsPerPx ?? 0;
  const finiteGaussParams = [
    gaussParams.amplitudeCounts,
    gaussParams.backgroundCounts,
    gaussParams.centerXPx,
    gaussParams.centerYPx,
    gaussParams.sigmaMajorPx,
    gaussParams.sigmaMinorPx,
    gaussParams.thetaRad,
    gaussSlopeX,
    gaussSlopeY,
  ].every(Number.isFinite);
  const finiteSuperGaussParams = [
    superGaussParams.amplitudeCounts,
    superGaussParams.backgroundCounts,
    superGaussParams.centerXPx,
    superGaussParams.centerYPx,
    superGaussParams.w1Px,
    superGaussParams.w2Px,
    superGaussParams.thetaRad,
    superGaussParams.superGaussN,
  ].every(Number.isFinite);
  if (
    !finiteGaussParams ||
    !finiteSuperGaussParams ||
    !(gaussParams.sigmaMajorPx > 0) ||
    !(gaussParams.sigmaMinorPx > 0) ||
    !(superGaussParams.w1Px > 0) ||
    !(superGaussParams.w2Px > 0)
  ) {
    return false;
  }
  const x1 = roi.x0 + roi.width - 1;
  const y1 = roi.y0 + roi.height - 1;
  const maxAbsDx = Math.max(Math.abs(roi.x0 - gaussParams.centerXPx), Math.abs(x1 - gaussParams.centerXPx));
  const maxAbsDy = Math.max(Math.abs(roi.y0 - gaussParams.centerYPx), Math.abs(y1 - gaussParams.centerYPx));
  const maxAbsSuperGaussDx = Math.max(
    Math.abs(roi.x0 - superGaussParams.centerXPx),
    Math.abs(x1 - superGaussParams.centerXPx),
  );
  const maxAbsSuperGaussDy = Math.max(
    Math.abs(roi.y0 - superGaussParams.centerYPx),
    Math.abs(y1 - superGaussParams.centerYPx),
  );
  const gaussModelBound =
    Math.abs(gaussParams.backgroundCounts) +
    Math.abs(gaussSlopeX) * maxAbsDx +
    Math.abs(gaussSlopeY) * maxAbsDy +
    Math.abs(gaussParams.amplitudeCounts);
  const superGaussModelBound = Math.abs(superGaussParams.backgroundCounts) + Math.abs(superGaussParams.amplitudeCounts);
  return (
    gaussModelBound <= RESIDUAL_FINITE_VALUE_LIMIT &&
    superGaussModelBound <= RESIDUAL_FINITE_VALUE_LIMIT &&
    Math.max(
      maxAbsDx,
      maxAbsDy,
      maxAbsSuperGaussDx,
      maxAbsSuperGaussDy,
      gaussParams.sigmaMajorPx,
      gaussParams.sigmaMinorPx,
      superGaussParams.w1Px,
      superGaussParams.w2Px,
    ) <= RESIDUAL_FINITE_INTERMEDIATE_LIMIT
  );
}

// The normal analyzer path has both converged models and a usable sigma_B.
// Keep that whole case in a compact, branch-free (apart from finite/bin
// predicates) inner loop. Its scalar update order intentionally matches the
// old model-comparison and Gaussian-display passes: y-major ROI order and one
// accumulator per reported quantity.
function accumulateDualResidualDiagnostics(
  corrected: CorrectedImage,
  roi: Roi,
  gaussParams: Gauss2dFitParams,
  superGaussParams: SuperGauss2dFitParams,
  gaussDisplay: DisplayAccumulator,
  superGaussDisplay: DisplayAccumulator,
  gaussHistogram: HistogramAccumulator,
  superGaussHistogram: HistogramAccumulator,
): DualResidualTotals {
  const { values, width } = corrected;
  const gaussCos = Math.cos(gaussParams.thetaRad);
  const gaussSin = Math.sin(gaussParams.thetaRad);
  const gaussSlopeX = gaussParams.backgroundSlopeXCountsPerPx ?? 0;
  const gaussSlopeY = gaussParams.backgroundSlopeYCountsPerPx ?? 0;
  const gaussSigmaMajor = gaussParams.sigmaMajorPx;
  const gaussSigmaMinor = gaussParams.sigmaMinorPx;
  const superGaussCos = Math.cos(superGaussParams.thetaRad);
  const superGaussSin = Math.sin(superGaussParams.thetaRad);
  const superGaussW1 = superGaussParams.w1Px;
  const superGaussW2 = superGaussParams.w2Px;
  const gaussHistogramLower = gaussHistogram.binEdgesCounts[0];
  const gaussHistogramUpper = gaussHistogram.binEdgesCounts[gaussHistogram.binEdgesCounts.length - 1];
  const gaussHistogramWidth = (gaussHistogramUpper - gaussHistogramLower) / RESIDUAL_HISTOGRAM_BIN_COUNT;
  const superGaussHistogramLower = superGaussHistogram.binEdgesCounts[0];
  const superGaussHistogramUpper = superGaussHistogram.binEdgesCounts[superGaussHistogram.binEdgesCounts.length - 1];
  const superGaussHistogramWidth =
    (superGaussHistogramUpper - superGaussHistogramLower) / RESIDUAL_HISTOGRAM_BIN_COUNT;
  let gaussSumCounts = 0;
  let gaussSumSquared = 0;
  let gaussMomentShiftCounts: number | null = null;
  let gaussSumShiftedCounts = 0;
  let gaussSumShiftedSquared = 0;
  let gaussSumShiftedCubed = 0;
  let gaussSumShiftedFourth = 0;
  let gaussMaxAbsCounts = 0;
  let gaussFiniteCount = 0;
  let gaussUnderflowCount = 0;
  let gaussOverflowCount = 0;
  let superGaussSumCounts = 0;
  let superGaussSumSquared = 0;
  let superGaussMomentShiftCounts: number | null = null;
  let superGaussSumShiftedCounts = 0;
  let superGaussSumShiftedSquared = 0;
  let superGaussSumShiftedCubed = 0;
  let superGaussSumShiftedFourth = 0;
  let superGaussMaxAbsCounts = 0;
  let superGaussFiniteCount = 0;
  let superGaussUnderflowCount = 0;
  let superGaussOverflowCount = 0;
  const skipResidualFiniteChecks = residualsAreProvablyFinite(roi, gaussParams, superGaussParams);

  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    const gaussDisplayRow = Math.floor((y - roi.y0) / gaussDisplay.blockSizePx) * gaussDisplay.width;
    const superGaussDisplayRow = Math.floor((y - roi.y0) / superGaussDisplay.blockSizePx) * superGaussDisplay.width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      const residualsGuaranteedFinite = skipResidualFiniteChecks && Math.abs(value) <= RESIDUAL_FINITE_VALUE_LIMIT;
      // Both grids are made from this ROI, so their block geometry is equal.
      // Calculate the column once; only the row offsets differ by model.
      const displayBlockX = Math.floor((x - roi.x0) / gaussDisplay.blockSizePx);

      const gaussDx = x - gaussParams.centerXPx;
      const gaussDy = y - gaussParams.centerYPx;
      const gaussU = gaussDx * gaussCos + gaussDy * gaussSin;
      const gaussV = -gaussDx * gaussSin + gaussDy * gaussCos;
      const gaussUTerm =
        gaussSigmaMajor > 0
          ? (gaussU * gaussU) / (2 * gaussSigmaMajor * gaussSigmaMajor)
          : gaussU === 0
            ? 0
            : Number.POSITIVE_INFINITY;
      const gaussVTerm =
        gaussSigmaMinor > 0
          ? (gaussV * gaussV) / (2 * gaussSigmaMinor * gaussSigmaMinor)
          : gaussV === 0
            ? 0
            : Number.POSITIVE_INFINITY;
      const gaussResidual =
        value -
        (gaussParams.backgroundCounts +
          gaussSlopeX * gaussDx +
          gaussSlopeY * gaussDy +
          gaussParams.amplitudeCounts * Math.exp(-(gaussUTerm + gaussVTerm)));
      if (residualsGuaranteedFinite || Number.isFinite(gaussResidual)) {
        const squared = gaussResidual * gaussResidual;
        gaussSumCounts += gaussResidual;
        gaussSumSquared += squared;
        if (gaussMomentShiftCounts === null) gaussMomentShiftCounts = gaussResidual;
        const shifted = gaussResidual - gaussMomentShiftCounts;
        const shiftedSquared = shifted * shifted;
        gaussSumShiftedCounts += shifted;
        gaussSumShiftedSquared += shiftedSquared;
        gaussSumShiftedCubed += shiftedSquared * shifted;
        gaussSumShiftedFourth += shiftedSquared * shiftedSquared;
        const absolute = Math.abs(gaussResidual);
        if (absolute > gaussMaxAbsCounts) gaussMaxAbsCounts = absolute;
        gaussFiniteCount += 1;
        if (gaussResidual < gaussHistogramLower) {
          gaussUnderflowCount += 1;
        } else if (gaussResidual > gaussHistogramUpper) {
          gaussOverflowCount += 1;
        } else if (gaussHistogramWidth > 0) {
          let index = Math.min(
            RESIDUAL_HISTOGRAM_BIN_COUNT - 1,
            Math.floor((gaussResidual - gaussHistogramLower) / gaussHistogramWidth),
          );
          if (index > 0 && gaussResidual < gaussHistogram.binEdgesCounts[index]) {
            index -= 1;
          } else if (
            index < RESIDUAL_HISTOGRAM_BIN_COUNT - 1 &&
            gaussResidual >= gaussHistogram.binEdgesCounts[index + 1]
          ) {
            index += 1;
          }
          gaussHistogram.counts[index] += 1;
        } else {
          gaussHistogram.counts[Math.floor(RESIDUAL_HISTOGRAM_BIN_COUNT / 2)] += 1;
        }
        const gaussDisplayIndex = gaussDisplayRow + displayBlockX;
        gaussDisplay.sums[gaussDisplayIndex] += gaussResidual;
        gaussDisplay.counts[gaussDisplayIndex] += 1;
      }

      const superGaussDx = x - superGaussParams.centerXPx;
      const superGaussDy = y - superGaussParams.centerYPx;
      const superGaussU = superGaussDx * superGaussCos + superGaussDy * superGaussSin;
      const superGaussV = -superGaussDx * superGaussSin + superGaussDy * superGaussCos;
      let superGaussEnergy: number;
      if (superGaussU === 0 && superGaussV === 0) {
        superGaussEnergy = 0;
      } else if (!(superGaussW1 > 0) || !(superGaussW2 > 0)) {
        superGaussEnergy = Number.POSITIVE_INFINITY;
      } else {
        superGaussEnergy =
          (superGaussU * superGaussU) / (superGaussW1 * superGaussW1) +
          (superGaussV * superGaussV) / (superGaussW2 * superGaussW2);
      }
      const superGaussResidual =
        value -
        (superGaussParams.backgroundCounts +
          superGaussParams.amplitudeCounts * Math.exp(-2 * Math.pow(superGaussEnergy, superGaussParams.superGaussN)));
      if (residualsGuaranteedFinite || Number.isFinite(superGaussResidual)) {
        const squared = superGaussResidual * superGaussResidual;
        superGaussSumCounts += superGaussResidual;
        superGaussSumSquared += squared;
        if (superGaussMomentShiftCounts === null) superGaussMomentShiftCounts = superGaussResidual;
        const shifted = superGaussResidual - superGaussMomentShiftCounts;
        const shiftedSquared = shifted * shifted;
        superGaussSumShiftedCounts += shifted;
        superGaussSumShiftedSquared += shiftedSquared;
        superGaussSumShiftedCubed += shiftedSquared * shifted;
        superGaussSumShiftedFourth += shiftedSquared * shiftedSquared;
        const absolute = Math.abs(superGaussResidual);
        if (absolute > superGaussMaxAbsCounts) superGaussMaxAbsCounts = absolute;
        superGaussFiniteCount += 1;
        if (superGaussResidual < superGaussHistogramLower) {
          superGaussUnderflowCount += 1;
        } else if (superGaussResidual > superGaussHistogramUpper) {
          superGaussOverflowCount += 1;
        } else if (superGaussHistogramWidth > 0) {
          let index = Math.min(
            RESIDUAL_HISTOGRAM_BIN_COUNT - 1,
            Math.floor((superGaussResidual - superGaussHistogramLower) / superGaussHistogramWidth),
          );
          if (index > 0 && superGaussResidual < superGaussHistogram.binEdgesCounts[index]) {
            index -= 1;
          } else if (
            index < RESIDUAL_HISTOGRAM_BIN_COUNT - 1 &&
            superGaussResidual >= superGaussHistogram.binEdgesCounts[index + 1]
          ) {
            index += 1;
          }
          superGaussHistogram.counts[index] += 1;
        } else {
          superGaussHistogram.counts[Math.floor(RESIDUAL_HISTOGRAM_BIN_COUNT / 2)] += 1;
        }
        const superGaussDisplayIndex = superGaussDisplayRow + displayBlockX;
        superGaussDisplay.sums[superGaussDisplayIndex] += superGaussResidual;
        superGaussDisplay.counts[superGaussDisplayIndex] += 1;
      }
    }
  }

  return {
    gaussSumCounts,
    gaussSumSquared,
    gaussSumShiftedCounts,
    gaussSumShiftedSquared,
    gaussSumShiftedCubed,
    gaussSumShiftedFourth,
    gaussMaxAbsCounts,
    gaussFiniteCount,
    gaussUnderflowCount,
    gaussOverflowCount,
    superGaussSumCounts,
    superGaussSumSquared,
    superGaussSumShiftedCounts,
    superGaussSumShiftedSquared,
    superGaussSumShiftedCubed,
    superGaussSumShiftedFourth,
    superGaussMaxAbsCounts,
    superGaussFiniteCount,
    superGaussUnderflowCount,
    superGaussOverflowCount,
  };
}

// PART 2 - model comparison as relative RMS reduction.
//
// relativeRmsReduction = (gaussRms - superRms) / gaussRms. The value is null
// unless BOTH RMS values exist and gaussRms > 0. A negative reduction is
// honest: the super-Gaussian model can be a worse description than the plain
// Gaussian (e.g. on a plain Gaussian with a noisy extra parameter), and that
// is reported rather than clipped.
export function compareModelResiduals(
  corrected: CorrectedImage,
  roi: Roi,
  gauss: FitResult<Gauss2dFitParams>,
  superGauss: FitResult<SuperGauss2dFitParams> | null,
  options?: ResidualDiagnosticsOptions,
): ModelResidualComparison {
  validateCorrectedImage(corrected);
  validateRoi(corrected, roi);
  const gaussParams = gauss.params;
  const superGaussParams = superGauss?.params ?? null;
  const usableSigmaB = hasUsableSigmaB(options?.noise);
  const histogramEdges = usableSigmaB
    ? makeHistogramEdges(RESIDUAL_HISTOGRAM_SIGMA_MULTIPLIER * (options?.noise?.sigmaCounts as number))
    : null;
  const gaussAccumulator =
    gaussParams === null
      ? null
      : createResidualAccumulator(
          createDisplayAccumulator(roi),
          histogramEdges === null ? null : createHistogramAccumulator(histogramEdges.slice()),
        );
  const superGaussDiagnosticsEnabled = superGauss?.status === "converged" && superGaussParams !== null;
  const superGaussAccumulator =
    superGaussParams === null
      ? null
      : createResidualAccumulator(
          superGaussDiagnosticsEnabled ? createDisplayAccumulator(roi) : null,
          superGaussDiagnosticsEnabled && histogramEdges !== null ? createHistogramAccumulator(histogramEdges.slice()) : null,
        );

  const { values, width } = corrected;
  const gaussCos = gaussParams === null ? 0 : Math.cos(gaussParams.thetaRad);
  const gaussSin = gaussParams === null ? 0 : Math.sin(gaussParams.thetaRad);
  const gaussSlopeX = gaussParams?.backgroundSlopeXCountsPerPx ?? 0;
  const gaussSlopeY = gaussParams?.backgroundSlopeYCountsPerPx ?? 0;
  const gaussSigmaMajor = gaussParams?.sigmaMajorPx ?? 0;
  const gaussSigmaMinor = gaussParams?.sigmaMinorPx ?? 0;
  const superGaussCos = superGaussParams === null ? 0 : Math.cos(superGaussParams.thetaRad);
  const superGaussSin = superGaussParams === null ? 0 : Math.sin(superGaussParams.thetaRad);
  const superGaussW1 = superGaussParams?.w1Px ?? 0;
  const superGaussW2 = superGaussParams?.w2Px ?? 0;
  const gaussDisplay = gaussAccumulator?.display ?? null;
  const gaussHistogram = gaussAccumulator?.histogram ?? null;
  const gaussHistogramLower = gaussHistogram?.binEdgesCounts[0] ?? 0;
  const gaussHistogramUpper = gaussHistogram?.binEdgesCounts.at(-1) ?? 0;
  const gaussHistogramWidth = (gaussHistogramUpper - gaussHistogramLower) / RESIDUAL_HISTOGRAM_BIN_COUNT;
  let gaussSumCounts = 0;
  let gaussSumSquared = 0;
  let gaussMomentShiftCounts: number | null = null;
  let gaussSumShiftedCounts = 0;
  let gaussSumShiftedSquared = 0;
  let gaussSumShiftedCubed = 0;
  let gaussSumShiftedFourth = 0;
  let gaussMaxAbsCounts = 0;
  let gaussFiniteCount = 0;
  let gaussUnderflowCount = 0;
  let gaussOverflowCount = 0;
  const superGaussDisplay = superGaussAccumulator?.display ?? null;
  const superGaussHistogram = superGaussAccumulator?.histogram ?? null;
  const superGaussHistogramLower = superGaussHistogram?.binEdgesCounts[0] ?? 0;
  const superGaussHistogramUpper = superGaussHistogram?.binEdgesCounts.at(-1) ?? 0;
  const superGaussHistogramWidth =
    (superGaussHistogramUpper - superGaussHistogramLower) / RESIDUAL_HISTOGRAM_BIN_COUNT;
  let superGaussSumCounts = 0;
  let superGaussSumSquared = 0;
  let superGaussMomentShiftCounts: number | null = null;
  let superGaussSumShiftedCounts = 0;
  let superGaussSumShiftedSquared = 0;
  let superGaussSumShiftedCubed = 0;
  let superGaussSumShiftedFourth = 0;
  let superGaussMaxAbsCounts = 0;
  let superGaussFiniteCount = 0;
  let superGaussUnderflowCount = 0;
  let superGaussOverflowCount = 0;
  if (
    gaussParams !== null &&
    superGaussParams !== null &&
    gaussAccumulator !== null &&
    superGaussAccumulator !== null &&
    gaussDisplay !== null &&
    superGaussDisplay !== null &&
    gaussHistogram !== null &&
    superGaussHistogram !== null
  ) {
    const totals = accumulateDualResidualDiagnostics(
      corrected,
      roi,
      gaussParams,
      superGaussParams,
      gaussDisplay,
      superGaussDisplay,
      gaussHistogram,
      superGaussHistogram,
    );
    gaussSumCounts = totals.gaussSumCounts;
    gaussSumSquared = totals.gaussSumSquared;
    gaussSumShiftedCounts = totals.gaussSumShiftedCounts;
    gaussSumShiftedSquared = totals.gaussSumShiftedSquared;
    gaussSumShiftedCubed = totals.gaussSumShiftedCubed;
    gaussSumShiftedFourth = totals.gaussSumShiftedFourth;
    gaussMaxAbsCounts = totals.gaussMaxAbsCounts;
    gaussFiniteCount = totals.gaussFiniteCount;
    gaussUnderflowCount = totals.gaussUnderflowCount;
    gaussOverflowCount = totals.gaussOverflowCount;
    superGaussSumCounts = totals.superGaussSumCounts;
    superGaussSumSquared = totals.superGaussSumSquared;
    superGaussSumShiftedCounts = totals.superGaussSumShiftedCounts;
    superGaussSumShiftedSquared = totals.superGaussSumShiftedSquared;
    superGaussSumShiftedCubed = totals.superGaussSumShiftedCubed;
    superGaussSumShiftedFourth = totals.superGaussSumShiftedFourth;
    superGaussMaxAbsCounts = totals.superGaussMaxAbsCounts;
    superGaussFiniteCount = totals.superGaussFiniteCount;
    superGaussUnderflowCount = totals.superGaussUnderflowCount;
    superGaussOverflowCount = totals.superGaussOverflowCount;
  } else {
    for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      if (gaussParams !== null && gaussAccumulator !== null) {
        const dx = x - gaussParams.centerXPx;
        const dy = y - gaussParams.centerYPx;
        const u = dx * gaussCos + dy * gaussSin;
        const v = -dx * gaussSin + dy * gaussCos;
        const uTerm =
          gaussSigmaMajor > 0
            ? (u * u) / (2 * gaussSigmaMajor * gaussSigmaMajor)
            : u === 0
              ? 0
              : Number.POSITIVE_INFINITY;
        const vTerm =
          gaussSigmaMinor > 0
            ? (v * v) / (2 * gaussSigmaMinor * gaussSigmaMinor)
            : v === 0
              ? 0
              : Number.POSITIVE_INFINITY;
        const residual =
          value -
          (gaussParams.backgroundCounts +
            gaussSlopeX * dx +
            gaussSlopeY * dy +
            gaussParams.amplitudeCounts * Math.exp(-(uTerm + vTerm)));
        if (Number.isFinite(residual)) {
          const squared = residual * residual;
          gaussSumCounts += residual;
          gaussSumSquared += squared;
          if (gaussMomentShiftCounts === null) gaussMomentShiftCounts = residual;
          const shifted = residual - gaussMomentShiftCounts;
          const shiftedSquared = shifted * shifted;
          gaussSumShiftedCounts += shifted;
          gaussSumShiftedSquared += shiftedSquared;
          gaussSumShiftedCubed += shiftedSquared * shifted;
          gaussSumShiftedFourth += shiftedSquared * shiftedSquared;
          const absolute = Math.abs(residual);
          if (absolute > gaussMaxAbsCounts) gaussMaxAbsCounts = absolute;
          gaussFiniteCount += 1;
          if (gaussHistogram !== null) {
            if (residual < gaussHistogramLower) {
              gaussUnderflowCount += 1;
            } else if (residual > gaussHistogramUpper) {
              gaussOverflowCount += 1;
            } else if (gaussHistogramWidth > 0) {
              let index = Math.min(
                RESIDUAL_HISTOGRAM_BIN_COUNT - 1,
                Math.floor((residual - gaussHistogramLower) / gaussHistogramWidth),
              );
              if (index > 0 && residual < gaussHistogram.binEdgesCounts[index]) {
                index -= 1;
              } else if (
                index < RESIDUAL_HISTOGRAM_BIN_COUNT - 1 &&
                residual >= gaussHistogram.binEdgesCounts[index + 1]
              ) {
                index += 1;
              }
              gaussHistogram.counts[index] += 1;
            } else {
              gaussHistogram.counts[Math.floor(RESIDUAL_HISTOGRAM_BIN_COUNT / 2)] += 1;
            }
          }
          if (gaussDisplay !== null) {
            const index =
              Math.floor((y - roi.y0) / gaussDisplay.blockSizePx) * gaussDisplay.width +
              Math.floor((x - roi.x0) / gaussDisplay.blockSizePx);
            gaussDisplay.sums[index] += residual;
            gaussDisplay.counts[index] += 1;
          }
        }
      }
      if (superGaussParams !== null && superGaussAccumulator !== null) {
        const dx = x - superGaussParams.centerXPx;
        const dy = y - superGaussParams.centerYPx;
        const u = dx * superGaussCos + dy * superGaussSin;
        const v = -dx * superGaussSin + dy * superGaussCos;
        let energy: number;
        if (u === 0 && v === 0) {
          energy = 0;
        } else if (!(superGaussW1 > 0) || !(superGaussW2 > 0)) {
          energy = Number.POSITIVE_INFINITY;
        } else {
          energy =
            (u * u) / (superGaussW1 * superGaussW1) + (v * v) / (superGaussW2 * superGaussW2);
        }
        const residual =
          value -
          (superGaussParams.backgroundCounts +
            superGaussParams.amplitudeCounts * Math.exp(-2 * Math.pow(energy, superGaussParams.superGaussN)));
        if (Number.isFinite(residual)) {
          const squared = residual * residual;
          superGaussSumCounts += residual;
          superGaussSumSquared += squared;
          if (superGaussMomentShiftCounts === null) superGaussMomentShiftCounts = residual;
          const shifted = residual - superGaussMomentShiftCounts;
          const shiftedSquared = shifted * shifted;
          superGaussSumShiftedCounts += shifted;
          superGaussSumShiftedSquared += shiftedSquared;
          superGaussSumShiftedCubed += shiftedSquared * shifted;
          superGaussSumShiftedFourth += shiftedSquared * shiftedSquared;
          const absolute = Math.abs(residual);
          if (absolute > superGaussMaxAbsCounts) superGaussMaxAbsCounts = absolute;
          superGaussFiniteCount += 1;
          if (superGaussHistogram !== null) {
            if (residual < superGaussHistogramLower) {
              superGaussUnderflowCount += 1;
            } else if (residual > superGaussHistogramUpper) {
              superGaussOverflowCount += 1;
            } else if (superGaussHistogramWidth > 0) {
              let index = Math.min(
                RESIDUAL_HISTOGRAM_BIN_COUNT - 1,
                Math.floor((residual - superGaussHistogramLower) / superGaussHistogramWidth),
              );
              if (index > 0 && residual < superGaussHistogram.binEdgesCounts[index]) {
                index -= 1;
              } else if (
                index < RESIDUAL_HISTOGRAM_BIN_COUNT - 1 &&
                residual >= superGaussHistogram.binEdgesCounts[index + 1]
              ) {
                index += 1;
              }
              superGaussHistogram.counts[index] += 1;
            } else {
              superGaussHistogram.counts[Math.floor(RESIDUAL_HISTOGRAM_BIN_COUNT / 2)] += 1;
            }
          }
          if (superGaussDisplay !== null) {
            const index =
              Math.floor((y - roi.y0) / superGaussDisplay.blockSizePx) * superGaussDisplay.width +
              Math.floor((x - roi.x0) / superGaussDisplay.blockSizePx);
            superGaussDisplay.sums[index] += residual;
            superGaussDisplay.counts[index] += 1;
          }
        }
      }
    }
    }
  }

  if (gaussAccumulator !== null) {
    gaussAccumulator.sumCounts = gaussSumCounts;
    gaussAccumulator.sumSquared = gaussSumSquared;
    gaussAccumulator.sumShiftedCounts = gaussSumShiftedCounts;
    gaussAccumulator.sumShiftedSquared = gaussSumShiftedSquared;
    gaussAccumulator.sumShiftedCubed = gaussSumShiftedCubed;
    gaussAccumulator.sumShiftedFourth = gaussSumShiftedFourth;
    gaussAccumulator.maxAbsCounts = gaussMaxAbsCounts;
    gaussAccumulator.finiteCount = gaussFiniteCount;
    if (gaussHistogram !== null) {
      gaussHistogram.underflowCount = gaussUnderflowCount;
      gaussHistogram.overflowCount = gaussOverflowCount;
    }
  }
  if (superGaussAccumulator !== null) {
    superGaussAccumulator.sumCounts = superGaussSumCounts;
    superGaussAccumulator.sumSquared = superGaussSumSquared;
    superGaussAccumulator.sumShiftedCounts = superGaussSumShiftedCounts;
    superGaussAccumulator.sumShiftedSquared = superGaussSumShiftedSquared;
    superGaussAccumulator.sumShiftedCubed = superGaussSumShiftedCubed;
    superGaussAccumulator.sumShiftedFourth = superGaussSumShiftedFourth;
    superGaussAccumulator.maxAbsCounts = superGaussMaxAbsCounts;
    superGaussAccumulator.finiteCount = superGaussFiniteCount;
    if (superGaussHistogram !== null) {
      superGaussHistogram.underflowCount = superGaussUnderflowCount;
      superGaussHistogram.overflowCount = superGaussOverflowCount;
    }
  }

  if (gaussParams !== null && gaussAccumulator !== null && histogramEdges === null && gaussAccumulator.finiteCount > 0) {
    const fallbackLimit = Math.max(
      gaussAccumulator.maxAbsCounts,
      superGaussDiagnosticsEnabled && superGaussAccumulator !== null ? superGaussAccumulator.maxAbsCounts : 0,
    );
    const fallbackEdges = makeHistogramEdges(fallbackLimit);
    gaussAccumulator.histogram = createHistogramAccumulator(fallbackEdges.slice());
    if (superGaussDiagnosticsEnabled && superGaussAccumulator !== null) {
      superGaussAccumulator.histogram = createHistogramAccumulator(fallbackEdges.slice());
    }
    accumulateFallbackHistograms(
      corrected,
      roi,
      gaussParams,
      superGaussDiagnosticsEnabled ? superGaussParams : null,
      gaussAccumulator.histogram,
      superGaussAccumulator?.histogram ?? null,
    );
  }

  const gaussRmsCounts = gaussAccumulator === null ? null : residualRms(gaussAccumulator);
  const superGaussRmsCounts = superGaussAccumulator === null ? null : residualRms(superGaussAccumulator);
  const relativeRmsReduction =
    gaussRmsCounts !== null && superGaussRmsCounts !== null && gaussRmsCounts > 0
      ? (gaussRmsCounts - superGaussRmsCounts) / gaussRmsCounts
      : null;
  const sigmaBCounts = usableSigmaB ? options?.noise?.sigmaCounts ?? null : null;
  const residualDiagnostics =
    gaussAccumulator === null || gaussParams === null || gaussAccumulator.display === null
      ? null
      : {
          gauss: buildResidualDiagnostics(gaussAccumulator, gaussParams.amplitudeCounts, sigmaBCounts, gaussAccumulator.display),
          superGauss:
            superGaussDiagnosticsEnabled &&
            superGaussAccumulator !== null &&
            superGaussParams !== null &&
            superGaussAccumulator.display !== null
              ? {
                  ...buildResidualDiagnostics(
                    superGaussAccumulator,
                    gaussParams.amplitudeCounts,
                    sigmaBCounts,
                    superGaussAccumulator.display,
                  ),
                  nAtBoundary:
                    superGaussParams.superGaussN === SUPER_GAUSS_N_MIN ||
                    superGaussParams.superGaussN === SUPER_GAUSS_N_MAX,
                }
              : null,
        };
  return { gaussRmsCounts, superGaussRmsCounts, relativeRmsReduction, residualDiagnostics };
}

// ---------------------------------------------------------------------------
// Gamma function (module-internal Lanczos approximation)
// ---------------------------------------------------------------------------

// Lanczos gamma approximation, g = 7 with the classic 15-digit coefficient
// set (Numerical Recipes shape). For z < 0.5 the reflection formula routes
// the argument above 0.5 first. The approximation is module-internal: the
// public surface exposes only sigmaFromSuperGaussWidth, whose output the
// tests pin against independently computed high-precision references AND
// against exact gamma identities, so the approximation itself is verified
// rather than echoed.
const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS: readonly number[] = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function lanczosGamma(z: number): number {
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * lanczosGamma(1 - z));
  }
  const shifted = z - 1;
  let x = LANCZOS_COEFFICIENTS[0];
  const t = shifted + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i += 1) {
    x += LANCZOS_COEFFICIENTS[i] / (shifted + i);
  }
  return Math.sqrt(2 * Math.PI) * Math.pow(t, shifted + 0.5) * Math.exp(-t) * x;
}

// PART 3 - fit-vs-moments width comparison.
//
// The exact second-moment sigma of a Super-Gaussian half-width w and
// exponent n is (Plan v5 section 6):
//   sigma = w * sqrt(2^(-1/n) * Gamma(2/n) / (2 * Gamma(1/n))).
// This conversion needs the Gamma function, which lives here in production
// only; the fit module stays Gamma-free.
export function sigmaFromSuperGaussWidth(wPx: number, n: number): number {
  const factor = Math.pow(2, -1 / n) * (lanczosGamma(2 / n) / (2 * lanczosGamma(1 / n)));
  return wPx * Math.sqrt(factor);
}

// Compare model-bound fit widths against measured aperture moments, per axis.
//
// deltas = 100 * (d4_fit - d4_moments) / d4_moments, SIGNED (not absolute):
// the sign says which width is wider, which matters for interpreting a
// tail-limited profile. The deltas are null when the moments are invalid or
// when either d4 value is null/zero. tailLimited only flags (no correction)
// when superGaussN is provided and below 1: such profiles carry significant
// wings outside any finite aperture, so the aperture moments underestimate
// the true second moment.
export function compareFitToMoments(
  fitGeometry: { d4SigmaMajorPx: number; d4SigmaMinorPx: number },
  moments: ImageMoments,
  superGaussN?: number,
): { deltaMajorPercent: number | null; deltaMinorPercent: number | null; tailLimited: boolean } {
  const tailLimited = superGaussN !== undefined && superGaussN < 1;
  if (
    !moments.valid ||
    moments.d4SigmaMajorPx === null ||
    moments.d4SigmaMinorPx === null ||
    moments.d4SigmaMajorPx === 0 ||
    moments.d4SigmaMinorPx === 0
  ) {
    return { deltaMajorPercent: null, deltaMinorPercent: null, tailLimited };
  }
  const deltaMajorPercent =
    (100 * (fitGeometry.d4SigmaMajorPx - (moments.d4SigmaMajorPx as number))) / (moments.d4SigmaMajorPx as number);
  const deltaMinorPercent =
    (100 * (fitGeometry.d4SigmaMinorPx - (moments.d4SigmaMinorPx as number))) / (moments.d4SigmaMinorPx as number);
  return { deltaMajorPercent, deltaMinorPercent, tailLimited };
}

// PART 4 - residual display grid.
//
// Reference implementation retained as the additivity oracle for the shared
// residual walk in compareModelResiduals; it is intentionally still exported.
export function computeResidualOutput(
  corrected: CorrectedImage,
  roi: Roi,
  params: Gauss2dFitParams,
  options?: { maxDisplaySize?: number },
): {
  rmsCounts: number;
  maxAbsCounts: number;
  display: { width: number; height: number; blockSizePx: number; values: Float64Array };
} {
  validateCorrectedImage(corrected);
  validateRoi(corrected, roi);
  const maxDisplaySize = options?.maxDisplaySize ?? RESIDUAL_DISPLAY_MAX_SIZE;
  if (!Number.isInteger(maxDisplaySize) || maxDisplaySize <= 0) {
    throw new RangeError("maxDisplaySize must be a positive integer");
  }

  // Smallest positive integer block size so both displayed extents fit the
  // cap. blockSizePx = 1 reproduces the residual field exactly.
  let blockSizePx = 1;
  while (
    Math.ceil(roi.width / blockSizePx) > maxDisplaySize ||
    Math.ceil(roi.height / blockSizePx) > maxDisplaySize
  ) {
    blockSizePx += 1;
  }
  const displayWidth = Math.ceil(roi.width / blockSizePx);
  const displayHeight = Math.ceil(roi.height / blockSizePx);
  const cellCount = displayWidth * displayHeight;
  const cellSums = new Float64Array(cellCount);
  const cellCounts = new Uint32Array(cellCount);

  const { values, width } = corrected;
  let sumSquared = 0;
  let finiteCount = 0;
  let maxAbs = 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      const residual = value - gauss2dValueAt(params, x, y);
      if (!Number.isFinite(residual)) continue;
      sumSquared += residual * residual;
      finiteCount += 1;
      const absResidual = Math.abs(residual);
      if (absResidual > maxAbs) maxAbs = absResidual;
      const blockX = Math.floor((x - roi.x0) / blockSizePx);
      const blockY = Math.floor((y - roi.y0) / blockSizePx);
      const cellIndex = blockY * displayWidth + blockX;
      cellSums[cellIndex] += residual;
      cellCounts[cellIndex] += 1;
    }
  }

  const displayValues = new Float64Array(cellCount);
  for (let i = 0; i < cellCount; i += 1) {
    displayValues[i] = cellCounts[i] > 0 ? cellSums[i] / cellCounts[i] : Number.NaN;
  }

  return {
    rmsCounts: finiteCount > 0 ? Math.sqrt(sumSquared / finiteCount) : 0,
    maxAbsCounts: maxAbs,
    display: { width: displayWidth, height: displayHeight, blockSizePx, values: displayValues },
  };
}
