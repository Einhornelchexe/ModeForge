import type { FitResult, Gauss2dFitParams, SuperGauss2dFitParams } from "./fit.ts";
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
function superGauss2dValueAt(params: SuperGauss2dFitParams, x: number, y: number): number {
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

// RMS of the full-resolution residuals over the FINITE ROI pixels. Non-finite
// residuals are skipped so the reported number is never NaN. An empty finite
// set reports 0 (honest no-data default).
function fullResolutionRms(
  corrected: CorrectedImage,
  roi: Roi,
  modelAt: (x: number, y: number) => number,
): number {
  const { values, width } = corrected;
  let sumSquared = 0;
  let count = 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (!Number.isFinite(value)) continue;
      const residual = value - modelAt(x, y);
      if (!Number.isFinite(residual)) continue;
      sumSquared += residual * residual;
      count += 1;
    }
  }
  return count > 0 ? Math.sqrt(sumSquared / count) : 0;
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
  superGauss: FitResult<SuperGauss2dFitParams>,
): { gaussRmsCounts: number | null; superGaussRmsCounts: number | null; relativeRmsReduction: number | null } {
  validateCorrectedImage(corrected);
  validateRoi(corrected, roi);
  const gaussParams = gauss.params;
  const superGaussParams = superGauss.params;
  const gaussRmsCounts =
    gaussParams === null ? null : fullResolutionRms(corrected, roi, (x, y) => gauss2dValueAt(gaussParams, x, y));
  const superGaussRmsCounts =
    superGaussParams === null
      ? null
      : fullResolutionRms(corrected, roi, (x, y) => superGauss2dValueAt(superGaussParams, x, y));
  const relativeRmsReduction =
    gaussRmsCounts !== null && superGaussRmsCounts !== null && gaussRmsCounts > 0
      ? (gaussRmsCounts - superGaussRmsCounts) / gaussRmsCounts
      : null;
  return { gaussRmsCounts, superGaussRmsCounts, relativeRmsReduction };
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
