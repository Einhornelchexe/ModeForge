import type { BackgroundRect } from "./background.ts";

// Beam-image moments on background-corrected data (S18c-A, Plan v5 sections
// 4 and 5). Weights are the signed corrected intensities under the B_eff = 0
// convention - never clipped, never max(0, .). Non-finite pixels are skipped
// in every accumulation and counted separately. The input is never mutated
// and every result is deterministic.

export type MomentInvalidReason =
  | "nonfinite_aggregate"
  | "nonpositive_sum"
  | "background_dominated"
  | "indefinite_covariance"
  | "zero_covariance";

export type ImageMoments = {
  valid: boolean;
  invalidReason: MomentInvalidReason | null;
  pixelCount: number;
  finitePixelCount: number;
  sumCounts: number;
  absSumCounts: number;
  centroidXPx: number | null;
  centroidYPx: number | null;
  covXxPx2: number | null;
  covYyPx2: number | null;
  covXyPx2: number | null;
  lambdaMajorPx2: number | null;
  lambdaMinorPx2: number | null;
  thetaRad: number | null;
  sigmaMajorPx: number | null;
  sigmaMinorPx: number | null;
  d4SigmaMajorPx: number | null;
  d4SigmaMinorPx: number | null;
  orientationContrastQ: number | null;
};

export type SubpixelPeak = {
  xPx: number;
  yPx: number;
};

export type SubpixelPeakResult = {
  peak: SubpixelPeak | null;
  suppressedReason: "edge" | "saturated_neighborhood" | "non_concave" | "shift_too_large" | null;
};

type CorrectedImage = { values: Float64Array | number[]; width: number; height: number };

// A pixel visitor receives the pixel coordinates and its row-major index.
type PixelVisitor = (x: number, y: number, index: number) => void;

// An enumerator walks exactly the pixels of the set, so each moment pass is
// linear in the pixel set size.
type PixelEnumerator = (visit: PixelVisitor) => void;

// A pixel set whose net sum is below this fraction of its absolute sum is
// background-dominated (positive validity predicate, Plan v5 section 4).
const BACKGROUND_DOMINANCE_FRACTION = 0.01;

// Relative tolerance for clamping a slightly negative minor eigenvalue to 0:
// orders of magnitude above the ~1e-16 cancellation noise of mean - disc,
// orders below genuine indefiniteness from signed weights (O(lambdaMajor)).
const EIG_NEGATIVE_TOLERANCE = 1e-9;

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

function validateRectFullyInside(image: CorrectedImage, rect: BackgroundRect): void {
  if (
    !Number.isInteger(rect.x0) ||
    !Number.isInteger(rect.y0) ||
    !Number.isInteger(rect.width) ||
    !Number.isInteger(rect.height)
  ) {
    throw new RangeError("background rectangle coordinates and sizes must be integers");
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new RangeError("background rectangle width and height must be positive integers");
  }
  if (rect.x0 < 0 || rect.y0 < 0 || rect.x0 + rect.width > image.width || rect.y0 + rect.height > image.height) {
    throw new RangeError("background rectangle is not fully inside the image");
  }
}

// Shared moment engine for rectangle and ellipse pixel sets. Three passes
// over the set: signed sums (and counts), the centroid against those sums,
// then the central second moments against that centroid - a direct second
// pass, never the shift theorem (cancellation risk). The validity predicate
// runs between the first and second pass in its exact short-circuit order.
function computeMomentsCore(corrected: CorrectedImage, enumerate: PixelEnumerator): ImageMoments {
  const { values } = corrected;
  let pixelCount = 0;
  let finitePixelCount = 0;
  let sumCounts = 0;
  let absSumCounts = 0;

  enumerate((_x, _y, index) => {
    pixelCount += 1;
    const value = values[index];
    if (!Number.isFinite(value)) return;
    finitePixelCount += 1;
    sumCounts += value;
    absSumCounts += Math.abs(value);
  });

  const invalid = (reason: MomentInvalidReason): ImageMoments => ({
    valid: false,
    invalidReason: reason,
    pixelCount,
    finitePixelCount,
    sumCounts,
    absSumCounts,
    centroidXPx: null,
    centroidYPx: null,
    covXxPx2: null,
    covYyPx2: null,
    covXyPx2: null,
    lambdaMajorPx2: null,
    lambdaMinorPx2: null,
    thetaRad: null,
    sigmaMajorPx: null,
    sigmaMinorPx: null,
    d4SigmaMajorPx: null,
    d4SigmaMinorPx: null,
    orientationContrastQ: null,
  });

  // Positive-form validity predicate (Plan v5 section 4): non-finite
  // aggregate, then strictly positive sum, then background dominance. The
  // negated formulation would accept NaN and is forbidden.
  if (!Number.isFinite(sumCounts) || !Number.isFinite(absSumCounts)) {
    return invalid("nonfinite_aggregate");
  }
  if (!(sumCounts > 0)) {
    return invalid("nonpositive_sum");
  }
  if (!(sumCounts >= BACKGROUND_DOMINANCE_FRACTION * absSumCounts)) {
    return invalid("background_dominated");
  }

  let weightedX = 0;
  let weightedY = 0;
  enumerate((x, y, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) return;
    weightedX += value * x;
    weightedY += value * y;
  });
  const centroidXPx = weightedX / sumCounts;
  const centroidYPx = weightedY / sumCounts;

  let weightedDxDx = 0;
  let weightedDyDy = 0;
  let weightedDxDy = 0;
  enumerate((x, y, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) return;
    const dx = x - centroidXPx;
    const dy = y - centroidYPx;
    weightedDxDx += value * dx * dx;
    weightedDyDy += value * dy * dy;
    weightedDxDy += value * dx * dy;
  });
  const covXxPx2 = weightedDxDx / sumCounts;
  const covYyPx2 = weightedDyDy / sumCounts;
  const covXyPx2 = weightedDxDy / sumCounts;

  if (!Number.isFinite(covXxPx2) || !Number.isFinite(covYyPx2) || !Number.isFinite(covXyPx2)) {
    return invalid("nonfinite_aggregate");
  }

  // Eigenvalue decomposition of the 2x2 covariance matrix.
  const meanEigen = (covXxPx2 + covYyPx2) / 2;
  const halfDifference = (covXxPx2 - covYyPx2) / 2;
  const discriminant = Math.sqrt(halfDifference * halfDifference + covXyPx2 * covXyPx2);
  const lambdaMajorPx2 = meanEigen + discriminant;
  let lambdaMinorPx2 = meanEigen - discriminant;
  // lambdaMinor = mean - disc cancels catastrophically for exactly rank-1
  // (collinear) pixel sets whose slope is not axis-aligned: the exact value
  // is 0 but the rounded result can land a few ulp below it, which would
  // misreport a contractual line-degenerate case as indefinite. A minor
  // eigenvalue within EIG_NEGATIVE_TOLERANCE of zero relative to the major
  // one is therefore clamped to exactly 0; genuine indefiniteness produced
  // by signed weights is O(lambdaMajor) and still rejected.
  if (lambdaMinorPx2 < 0 && -lambdaMinorPx2 <= EIG_NEGATIVE_TOLERANCE * Math.max(lambdaMajorPx2, 0)) {
    lambdaMinorPx2 = 0;
  }
  if (lambdaMinorPx2 < 0) {
    return invalid("indefinite_covariance");
  }
  if (lambdaMajorPx2 <= 0) {
    return invalid("zero_covariance");
  }

  // Canonicalization: major axis first, angle in [0, pi), d4 sigma = 4*sigma.
  // An exactly degenerate covariance (lambdaMinor == 0, a line) stays valid.
  const sigmaMajorPx = Math.sqrt(lambdaMajorPx2);
  const sigmaMinorPx = Math.sqrt(lambdaMinorPx2);
  let thetaRad = 0.5 * Math.atan2(2 * covXyPx2, covXxPx2 - covYyPx2);
  if (thetaRad < 0) thetaRad += Math.PI;
  // A tiny negative covXy rounding residue makes thetaRad = -eps, and the
  // +pi correction then rounds to exactly pi — outside [0, pi). Pi is 0
  // modulo the axis period, so fold it back.
  if (thetaRad >= Math.PI) thetaRad = 0;

  return {
    valid: true,
    invalidReason: null,
    pixelCount,
    finitePixelCount,
    sumCounts,
    absSumCounts,
    centroidXPx,
    centroidYPx,
    covXxPx2,
    covYyPx2,
    covXyPx2,
    lambdaMajorPx2,
    lambdaMinorPx2,
    thetaRad,
    sigmaMajorPx,
    sigmaMinorPx,
    d4SigmaMajorPx: 4 * sigmaMajorPx,
    d4SigmaMinorPx: 4 * sigmaMinorPx,
    orientationContrastQ: (lambdaMajorPx2 - lambdaMinorPx2) / (lambdaMajorPx2 + lambdaMinorPx2),
  };
}

export function computeRectMoments(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  rect: BackgroundRect,
): ImageMoments {
  validateCorrectedImage(corrected);
  validateRectFullyInside(corrected, rect);
  const { width } = corrected;
  const x0 = rect.x0;
  const y0 = rect.y0;
  const x1 = rect.x0 + rect.width - 1;
  const y1 = rect.y0 + rect.height - 1;
  return computeMomentsCore(corrected, (visit) => {
    for (let y = y0; y <= y1; y += 1) {
      const row = y * width;
      for (let x = x0; x <= x1; x += 1) visit(x, y, row + x);
    }
  });
}

export function computeEllipseMoments(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  ellipse: { centerXPx: number; centerYPx: number; semiMajorPx: number; semiMinorPx: number; thetaRad: number },
): ImageMoments {
  validateCorrectedImage(corrected);
  if (!Number.isFinite(ellipse.centerXPx)) throw new RangeError("ellipse centerXPx must be a finite number");
  if (!Number.isFinite(ellipse.centerYPx)) throw new RangeError("ellipse centerYPx must be a finite number");
  if (!Number.isFinite(ellipse.semiMajorPx) || ellipse.semiMajorPx <= 0) {
    throw new RangeError("ellipse semiMajorPx must be a positive finite number");
  }
  if (!Number.isFinite(ellipse.semiMinorPx) || ellipse.semiMinorPx <= 0) {
    throw new RangeError("ellipse semiMinorPx must be a positive finite number");
  }
  if (ellipse.semiMajorPx < ellipse.semiMinorPx) {
    throw new RangeError("ellipse semiMajorPx must be >= semiMinorPx (swapped axes are never accepted silently)");
  }
  if (!Number.isFinite(ellipse.thetaRad)) throw new RangeError("ellipse thetaRad must be a finite number");

  const { width, height } = corrected;
  const { centerXPx: cx, centerYPx: cy, semiMajorPx: a, semiMinorPx: b, thetaRad } = ellipse;
  const cosTheta = Math.cos(thetaRad);
  const sinTheta = Math.sin(thetaRad);
  const c2 = cosTheta * cosTheta;
  const s2 = sinTheta * sinTheta;
  const cs = cosTheta * sinTheta;
  const invA2 = 1 / (a * a);
  const invB2 = 1 / (b * b);

  // Membership with u = dx*cos + dy*sin, v = -dx*sin + dy*cos:
  //   u^2/a^2 + v^2/b^2 <= 1
  // For a fixed row offset dy this is a quadratic inequality in dx:
  //   A*dx^2 + 2*Bcoef*dy*dx + (C*dy^2 - 1) <= 0 with
  //   A = c2/a^2 + s2/b^2, Bcoef = cs*(1/a^2 - 1/b^2), C = s2/a^2 + c2/b^2.
  // The quadratic discriminant/4 reduces to A - dy^2/(a^2*b^2), so the row
  // intersects the ellipse exactly when |dy| <= sqrt(b^2*c2 + a^2*s2). This
  // keeps each moment pass linear in the pixel set instead of scanning a
  // bounding box. One padding pixel per side plus the final predicate gate
  // makes the iteration immune to boundary rounding; an ellipse that
  // overhangs the image is clipped because only image pixels are visited.
  const A = c2 * invA2 + s2 * invB2;
  const Bcoef = cs * (invA2 - invB2);
  const invA2B2 = invA2 * invB2;
  const extentY = Math.sqrt(b * b * c2 + a * a * s2);
  const yMin = Math.max(0, Math.ceil(cy - extentY) - 1);
  const yMax = Math.min(height - 1, Math.floor(cy + extentY) + 1);
  const aSquared = a * a;
  const bSquared = b * b;

  return computeMomentsCore(corrected, (visit) => {
    for (let y = yMin; y <= yMax; y += 1) {
      const dy = y - cy;
      let disc4 = A - dy * dy * invA2B2;
      if (disc4 < -1e-12 * A) continue;
      if (disc4 < 0) disc4 = 0;
      const root = Math.sqrt(disc4);
      let xStart = Math.ceil(cx + (-Bcoef * dy - root) / A) - 1;
      let xEnd = Math.floor(cx + (-Bcoef * dy + root) / A) + 1;
      if (xStart < 0) xStart = 0;
      if (xEnd > width - 1) xEnd = width - 1;
      const row = y * width;
      for (let x = xStart; x <= xEnd; x += 1) {
        const dx = x - cx;
        const u = dx * cosTheta + dy * sinTheta;
        const v = -dx * sinTheta + dy * cosTheta;
        // Division form: keeps integer boundary pixels (u^2 == a^2 etc.)
        // exactly inside instead of routing them through 1/25-style rounding.
        if ((u * u) / aSquared + (v * v) / bSquared <= 1) visit(x, y, row + x);
      }
    }
  });
}

export function computeSubpixelPeak(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  peakXPx: number,
  peakYPx: number,
  isSaturated?: (index: number) => boolean,
): SubpixelPeakResult {
  validateCorrectedImage(corrected);
  if (!Number.isInteger(peakXPx) || !Number.isInteger(peakYPx)) {
    throw new RangeError("peak position must be integer pixel coordinates");
  }
  if (peakXPx < 0 || peakXPx >= corrected.width || peakYPx < 0 || peakYPx >= corrected.height) {
    throw new RangeError("peak position must be inside the image");
  }
  const { values, width, height } = corrected;
  const x = peakXPx;
  const y = peakYPx;

  // Guard 1: the separable three-point parabola needs a full 3x3 area.
  if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
    return { peak: null, suppressedReason: "edge" };
  }

  // Guard 2: any saturated pixel in the 3x3 area vetoes the fit.
  if (isSaturated !== undefined) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (isSaturated(x + dx + (y + dy) * width)) {
          return { peak: null, suppressedReason: "saturated_neighborhood" };
        }
      }
    }
  }

  const center = values[x + y * width];
  const left = values[x - 1 + y * width];
  const right = values[x + 1 + y * width];
  const up = values[x + (y - 1) * width];
  const down = values[x + (y + 1) * width];

  // Guard 3: all five required pixels must be finite and each axis must be
  // strictly concave (second difference < 0, so the vertex is a maximum).
  if (
    !Number.isFinite(center) ||
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !Number.isFinite(up) ||
    !Number.isFinite(down)
  ) {
    return { peak: null, suppressedReason: "non_concave" };
  }
  const denominatorX = left - 2 * center + right;
  const denominatorY = up - 2 * center + down;
  if (denominatorX >= 0 || denominatorY >= 0) {
    return { peak: null, suppressedReason: "non_concave" };
  }

  const shiftX = (0.5 * (left - right)) / denominatorX;
  const shiftY = (0.5 * (up - down)) / denominatorY;

  // Guard 4: a vertex further than half a pixel from the discrete maximum is
  // not believable.
  if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
    return { peak: null, suppressedReason: "shift_too_large" };
  }

  return { peak: { xPx: x + shiftX, yPx: y + shiftY }, suppressedReason: null };
}

export function peakCentroidDistancePx(
  peak: { xPx: number; yPx: number },
  centroid: { xPx: number; yPx: number },
): number {
  const dx = peak.xPx - centroid.xPx;
  const dy = peak.yPx - centroid.yPx;
  return Math.sqrt(dx * dx + dy * dy);
}
