// Self-contained Levenberg-Marquardt core for beam-profile fits (S18d-A,
// Plan v5 section 6). Three models are provided: a 1D Gaussian, a rotated
// elliptical 2D Gaussian with a constant or tilted (affine) background, and
// an exact 2D Super-Gaussian whose radial limit matches the reference in
// packages/beams/src/profiles.ts. This module is the LM core only: aperture
// gates, residual verdicts and calibration mapping belong to a later task.
//
// Conventions documented inline (and tested against central finite
// differences in tests/unit/image-fit.test.ts):
// - Sigmas and widths are fitted unconstrained but enter the model through
//   their absolute value, which keeps them positive. The gradient at an
//   exactly zero scale is taken as 0 (a subgradient of the absolute-value
//   parametrization). Theta is unconstrained during the fit and
//   canonicalized only in the result (major axis first, angle folded into
//   [0, pi) with exact pi mapped back to 0, the same rule as moments.ts).
// - Every parameter is divided by a natural scale before the normal
//   equations are formed: counts-like parameters (amplitude, background,
//   background slopes) by the data span, position/scale parameters by the
//   ROI (or profile) extent, and angles/exponents by 1. The convergence
//   predicate and all step decisions use those scaled parameters so the
//   normal equations stay conditioned.
// - Marquardt damping (lambda, start 1e-3, up and down by fixed factors) is
//   added to the diagonal of the SCALED normal equations.
// - A trial is accepted whenever it does NOT WORSEN the cost
//   (cost_new <= cost_old), not only on strict descent. An accepted
//   equal-cost trial with a tiny scaled parameter change then satisfies the
//   convergence predicate (relative parameter change <= 1e-8 AND relative
//   cost improvement <= 1e-10 on the scaled parameters; an improvement of
//   exactly 0 passes the <= test). The predicate is only evaluated on an
//   accepted trial, so a fit at a numerically exact plateau converges
//   instead of starving.
// - An absolute zero-cost floor is checked at the TOP of every iteration
//   before any trial is built: cost <= COST_FLOOR reports converged, where
//   COST_FLOOR = (1e-12 * dataSpan)^2 * finiteCount and dataSpan is the
//   max-min span of the finite fitted values (computed once). Why: a
//   numerically exact model leaves only rounding residuals of order
//   eps * value, and no descent step can improve on that, so acceptance
//   that refuses strictly-worse trials would loop forever. A zero dataSpan
//   is degenerate and invalid_start semantics already reject it before this
//   engine runs.
// - Wedge exit: when a trial is rejected, lambda grows; once it reaches
//   LAMBDA_MAX = 1e12 the engine is wedged - no damped step can lower the
//   cost at the current point. The fit reports converged there only when it
//   is genuinely at a minimum: either the most recent accepted step already
//   met the relative cost-improvement criterion AND (S20 D2) was itself small
//   in the scaled relative parameter measure (<= 1e-3, a large jump for a
//   negligible cost gain is a flat shelf, not a minimum), or the max absolute
//   SCALED gradient component is below 1e-8 * max(1, dataSpan), or (S18-R2 F3) the
//   remaining cost is at the numerical floor for this data,
//   cost / (dataSpan^2 * nSamples) <= WEDGE_COST_RELATIVE_FLOOR - the
//   gradient arm is a SUM over samples and therefore not sample-count aware,
//   so a large clean ROI sitting exactly at its minimum failed it. An
//   uncertified wedge stop reports singular_normal_equations (the damped
//   system at LAMBDA_MAX is numerically inert), never max_iterations: the
//   ordinary iteration cap is untouched and max_iterations now means exactly
//   "the iteration budget was exhausted" - a maxIterations:1 run still
//   yields max_iterations, never converged.
// - The Super-Gaussian exponent n participates in the fit and is clamped to
//   [0.5, 10] after each accepted trial (and on entry).
// - Decimation: a ROI wider or taller than 512 px is mean-pooled by the
//   smallest power-of-two factor b that brings both extents to <= 512 px.
//   Blocks average finite pixels only; a block with zero finite pixels is
//   skipped like any non-finite sample. Mapped-back positions are
//   x_full = b*x_dec + (b-1)/2. Per-axis sigmas get the correction
//   sigma_full = sqrt((b*sigma_dec)^2 - (b^2-1)/12): mean-pooling b x b
//   DISCRETE pixel centres adds variance (b^2-1)/12 (the continuous box
//   variance b^2/12 overstates the correction; the exact discrete Sheppard
//   term leaves b=1 subtracting exactly 0). The plan's width-level statement
//   w_full = sqrt(w_fit^2 - (b^2-1)/3) is the same correction because
//   w = 2*sigma implies w^2 = 4*sigma^2 and (b^2-1)/3 = 4*((b^2-1)/12).
//   Widths of the Super-Gaussian therefore use
//   w_full = sqrt((b*w_dec)^2 - (b^2-1)/3).
//   Residual statistics are reported on the POOLED grid in this task; the
//   full-resolution residual statistics belong to the later output task.
// - The internal model probe exported below exists solely for the Jacobian
//   oracle test and is NOT part of the public API surface.

export type FitStatus =
  | "converged"
  | "max_iterations"
  | "time_budget_exceeded"
  | "singular_normal_equations"
  | "invalid_start";

export type FitOptions = {
  // Maximum LM iterations; hard cap (Plan v5 section 6). Default 30.
  maxIterations?: number;
  // Optional wall-clock budget in milliseconds; checked once per iteration.
  timeBudgetMs?: number;
  // Clock injection for deterministic tests; defaults to Date.now.
  now?: () => number;
};

export type Gauss2dFitParams = {
  amplitudeCounts: number;
  backgroundCounts: number;
  // Present ONLY when the tilted-background variant was requested:
  backgroundSlopeXCountsPerPx?: number;
  backgroundSlopeYCountsPerPx?: number;
  centerXPx: number;
  centerYPx: number;
  sigmaMajorPx: number; // canonical: sigmaMajorPx >= sigmaMinorPx
  sigmaMinorPx: number;
  thetaRad: number; // canonical: [0, pi), exact pi folded back to 0
};

// The Super-Gaussian result carries its native model parameters w1/w2/n and
// deliberately NO sigma fields: the sigma <-> w conversion needs the Gamma
// function, which Plan v5 section 6 keeps test-only (Lanczos in the tests);
// the reporting layer performs that conversion where it is verified.
export type SuperGauss2dFitParams = Omit<Gauss2dFitParams, "sigmaMajorPx" | "sigmaMinorPx"> & {
  // 1/e^2 half-widths along the principal axes (w = 2*sigma for n = 1).
  w1Px: number;
  w2Px: number;
  superGaussN: number; // clamped to [0.5, 10]
};

export type Gauss1dFitParams = {
  amplitudeCounts: number;
  backgroundCounts: number;
  centerPx: number;
  sigmaPx: number;
};

export type FitResult<P> = {
  status: FitStatus;
  converged: boolean; // status === "converged"
  params: P | null; // null only for "invalid_start" / initial "singular_normal_equations"
  iterations: number;
  costInitial: number; // sum of squared residuals at the start point
  costFinal: number;
  residualRmsCounts: number | null;
  residualMaxAbsCounts: number | null;
  decimated: boolean;
  decimationFactor: number; // 1 when not decimated
  startSource: "half-area" | "moments";
};

type StartMomentsOption = {
  centroidXPx: number;
  centroidYPx: number;
  sigmaMajorPx: number;
  sigmaMinorPx: number;
  thetaRad: number;
};

type Gauss2dFitOptions = FitOptions & {
  tiltedBackground?: boolean;
  startMoments?: StartMomentsOption | null;
};

type CorrectedImage = { values: Float64Array | number[]; width: number; height: number };

type Roi = { x0: number; y0: number; width: number; height: number };

type FitSample = { x: number; y: number; value: number };

const MAX_ITERATIONS_DEFAULT = 30;
const DECIMATION_MAX_EXTENT_PX = 512;
const PARAM_REL_TOLERANCE = 1e-8;
const COST_REL_TOLERANCE = 1e-10;
const LAMBDA_START = 1e-3;
const LAMBDA_UP_FACTOR = 10;
const LAMBDA_DOWN_FACTOR = 3;
const LAMBDA_MIN = 1e-12;
const LAMBDA_MAX = 1e12;
const MAX_STEP_ATTEMPTS = 10;
const COST_FLOOR_RELATIVE = 1e-12;
const WEDGE_GRADIENT_TOLERANCE = 1e-8;
// S20 D2: parameter-step guard on the cost arm of the WEDGE exit. That arm
// certifies a wedge stop from the relative COST improvement of the last
// accepted step alone; it never asked whether that step also MOVED the fit
// only a little. A large jump that happens to carry a negligible cost gain -
// a saturated plateau is the natural producer - would therefore be certified
// as a minimum although the parameters were still travelling. The guard adds
// the missing conjunction: the last accepted step must also be small in the
// scaled relative measure the convergence predicate already uses.
//
// Calibration. The threshold sits in the wide empty band between the two
// measured populations. Above it: the largest last-accepted relative
// parameter step measured on a cost-arm certification across the adversarial
// scene sweep is 1.04e-4, so 1e-3 clears every legitimate certification on
// that corpus by about 10x. Below it: the smallest step that would MATTER
// physically is 1.56e-2 - the scaled relative step of a sigma moving from 10
// to 12 px on a 128 px ROI - so 1e-3 sits about 15x under the first step size
// whose certification would hide a real error. Anything the guard rejects is
// therefore nearer the "still travelling" population than the "already
// there" one by more than an order of magnitude on both sides.
//
// The upper population is a corpus bound, not a proof of unreachability. A
// directed search outside that corpus does reach the arm with a large step:
// a hard-clipped, saturated circular beam certifies through the cost arm
// alone with a last accepted relative parameter step of 1.98e-2 - 190x the
// corpus maximum and above the 1.56e-2 "would matter" line. That scene is
// pinned as an oracle in tests/unit/image-fit.test.ts; it is the reason this
// guard is a correction and not only a closed door.
const WEDGE_PARAM_REL_TOLERANCE = 1e-3;
// S18-R2 F3: numerical-floor arm of the WEDGE exit only (the top-of-loop
// COST_FLOOR above is untouched). Measure: cost / (dataSpan^2 * nSamples),
// i.e. the SQUARE of the per-sample residual rms expressed in data spans.
// The scaled gradient the wedge exit tests grows with sqrt(nSamples) and with
// the data span, so on a large clean ROI a fit sitting EXACTLY at its
// minimum still shows a gradient far above WEDGE_GRADIENT_TOLERANCE *
// dataSpan and was reported as max_iterations although its recovered widths
// were exact (measured 18 of 480 noise-free rotated 11x6 scenes on
// 300x80 / 80x300 / 240x120 / 400x100 ROIs at 45 and 60 degrees, worst
// |sigmaMajor| recovery error among them 9.5e-13 percent). Those stalls
// measured 8.5e-24 to 1.9e-22 on this scale (per-sample rms 2.9e-12 to
// 1.4e-11 data spans); a genuinely unconverged fit sits many orders higher
// (a residual rms of one part per million of the span is already 1e-12).
// 1e-20 accepts every measured stall with >= 50x margin while still
// demanding a per-sample rms below 1e-10 data spans, which no fit that has
// anything left to improve can reach.
const WEDGE_COST_RELATIVE_FLOOR = 1e-20;
const SIGMA_FLOOR_PX = 0.5;
const SUPER_GAUSS_N_MIN = 0.5;
const SUPER_GAUSS_N_MAX = 10;
// Area of a Gaussian above half maximum: 2*pi*ln(2)*sigmaX*sigmaY; with an
// isotropic start sigma that equals 2*pi*ln(2)*sigma0^2 pixel counts.
const HALF_AREA_TWO_PI_LN2 = 2 * Math.PI * Math.LN2;
// 1D mirror of the half-area argument: the width of the above-half-maximum
// interval of a 1D Gaussian is 2*sqrt(2*ln(2))*sigma.
const ONE_D_HALF_WIDTH_FACTOR = 2 * Math.sqrt(2 * Math.LN2);
const SCALE_FLOOR = 1e-12;
const EXTENT_FLOOR_PX = 1e-3;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

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
    throw new RangeError(
      `values.length ${corrected.values.length} does not match width*height ${pixelCount}`,
    );
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

function validateProfile(profile: { positionsPx: Float64Array; values: Float64Array }): void {
  if (profile.positionsPx.length !== profile.values.length) {
    throw new RangeError(
      `profile positionsPx.length ${profile.positionsPx.length} does not match values.length ${profile.values.length}`,
    );
  }
}

function validateStartMoments(startMoments: StartMomentsOption): void {
  for (const key of [
    "centroidXPx",
    "centroidYPx",
    "sigmaMajorPx",
    "sigmaMinorPx",
    "thetaRad",
  ] as const) {
    const value = startMoments[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(`startMoments.${key} must be a finite number`);
    }
  }
  if (!(startMoments.sigmaMajorPx > 0) || !(startMoments.sigmaMinorPx > 0)) {
    throw new RangeError("startMoments sigmas must be positive finite numbers");
  }
}

function normalizeOptions(options: FitOptions | undefined): {
  maxIterations: number;
  timeBudgetMs: number | null;
  now: () => number;
} {
  const maxIterations = options?.maxIterations ?? MAX_ITERATIONS_DEFAULT;
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new RangeError("maxIterations must be a positive integer");
  }
  let timeBudgetMs: number | null = null;
  if (options?.timeBudgetMs !== undefined) {
    if (!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs <= 0) {
      throw new RangeError("timeBudgetMs must be a finite number > 0");
    }
    timeBudgetMs = options.timeBudgetMs;
  }
  let now: () => number;
  if (options?.now !== undefined) {
    if (typeof options.now !== "function") {
      throw new RangeError("now must be a function returning a timestamp in milliseconds");
    }
    now = options.now;
  } else {
    now = Date.now;
  }
  return { maxIterations, timeBudgetMs, now };
}

// ---------------------------------------------------------------------------
// Sample collection and decimation
// ---------------------------------------------------------------------------

function collectRoiSamples(corrected: CorrectedImage, roi: Roi): { samples: FitSample[]; b: number } {
  let b = 1;
  while (roi.width / b > DECIMATION_MAX_EXTENT_PX || roi.height / b > DECIMATION_MAX_EXTENT_PX) b *= 2;
  const wD = Math.ceil(roi.width / b);
  const hD = Math.ceil(roi.height / b);
  const samples: FitSample[] = [];
  const src = corrected.values;
  const srcWidth = corrected.width;
  for (let by = 0; by < hD; by += 1) {
    const yStart = roi.y0 + by * b;
    const yEnd = Math.min(yStart + b, roi.y0 + roi.height);
    for (let bx = 0; bx < wD; bx += 1) {
      const xStart = roi.x0 + bx * b;
      const xEnd = Math.min(xStart + b, roi.x0 + roi.width);
      let sum = 0;
      let count = 0;
      for (let y = yStart; y < yEnd; y += 1) {
        const row = y * srcWidth;
        for (let x = xStart; x < xEnd; x += 1) {
          const value = src[row + x];
          if (Number.isFinite(value)) {
            sum += value;
            count += 1;
          }
        }
      }
      if (count > 0) samples.push({ x: roi.x0 / b + bx, y: roi.y0 / b + by, value: sum / count });
    }
  }
  return { samples, b };
}

function collectProfileSamples(profile: { positionsPx: Float64Array; values: Float64Array }): FitSample[] {
  const samples: FitSample[] = [];
  for (let i = 0; i < profile.positionsPx.length; i += 1) {
    const x = profile.positionsPx[i];
    const value = profile.values[i];
    if (Number.isFinite(x) && Number.isFinite(value)) samples.push({ x, y: 0, value });
  }
  return samples;
}

function medianOfNumbers(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Moment-free starting values (Plan v5 section 6)
// ---------------------------------------------------------------------------

type HalfAreaStart = { A0: number; B0: number; cx0: number; cy0: number; sigma0: number } | null;

function halfAreaStart(samples: FitSample[]): HalfAreaStart {
  if (samples.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  let cx0 = Number.NaN;
  let cy0 = Number.NaN;
  for (const sample of samples) {
    if (sample.x < minX) minX = sample.x;
    if (sample.x > maxX) maxX = sample.x;
    if (sample.y < minY) minY = sample.y;
    if (sample.y > maxY) maxY = sample.y;
    if (sample.value > maxValue) {
      maxValue = sample.value;
      cx0 = sample.x;
      cy0 = sample.y;
    }
  }
  const borderValues: number[] = [];
  for (const sample of samples) {
    if (sample.x === minX || sample.x === maxX || sample.y === minY || sample.y === maxY) {
      borderValues.push(sample.value);
    }
  }
  const B0 = medianOfNumbers(borderValues);
  const A0 = maxValue - B0;
  if (!(A0 > 0)) return null;
  let halfCount = 0;
  const threshold = B0 + A0 / 2;
  for (const sample of samples) {
    if (sample.value > threshold) halfCount += 1;
  }
  let sigma0 = Math.sqrt(halfCount / HALF_AREA_TWO_PI_LN2);
  if (sigma0 < SIGMA_FLOOR_PX) sigma0 = SIGMA_FLOOR_PX;
  return { A0, B0, cx0, cy0, sigma0 };
}

function makeGauss2dStartRaw(
  samples: FitSample[],
  b: number,
  startMoments: StartMomentsOption | null,
  tilted: boolean,
): { raw: number[]; startSource: FitResult<Gauss2dFitParams>["startSource"] } | null {
  const halfArea = halfAreaStart(samples);
  if (halfArea === null) return null;
  const { A0, B0 } = halfArea;
  let cx = halfArea.cx0;
  let cy = halfArea.cy0;
  let s1 = halfArea.sigma0;
  let s2 = halfArea.sigma0;
  let theta = 0;
  let startSource: FitResult<Gauss2dFitParams>["startSource"] = "half-area";
  if (startMoments !== null) {
    validateStartMoments(startMoments);
    // Decimated coordinates relate to full-resolution coordinates by
    // x_full = b*x_dec + (b-1)/2, so a full-resolution centroid maps back
    // as x_dec = (x_full - (b-1)/2)/b and sigmas shrink by one factor of b.
    cx = (startMoments.centroidXPx - (b - 1) / 2) / b;
    cy = (startMoments.centroidYPx - (b - 1) / 2) / b;
    s1 = startMoments.sigmaMajorPx / b;
    s2 = startMoments.sigmaMinorPx / b;
    theta = startMoments.thetaRad;
    startSource = "moments";
  }
  return tilted
    ? { raw: [A0, B0, 0, 0, cx, cy, s1, s2, theta], startSource }
    : { raw: [A0, B0, cx, cy, s1, s2, theta], startSource };
}

function makeSuperGaussStartRaw(
  samples: FitSample[],
  b: number,
  startMoments: StartMomentsOption | null,
): { raw: number[]; startSource: FitResult<Gauss2dFitParams>["startSource"] } | null {
  const halfArea = halfAreaStart(samples);
  if (halfArea === null) return null;
  const { A0, B0 } = halfArea;
  let cx = halfArea.cx0;
  let cy = halfArea.cy0;
  let sigma0 = halfArea.sigma0;
  let theta = 0;
  let startSource: FitResult<Gauss2dFitParams>["startSource"] = "half-area";
  if (startMoments !== null) {
    validateStartMoments(startMoments);
    cx = (startMoments.centroidXPx - (b - 1) / 2) / b;
    cy = (startMoments.centroidYPx - (b - 1) / 2) / b;
    sigma0 = startMoments.sigmaMajorPx / b;
    theta = startMoments.thetaRad;
    startSource = "moments";
  }
  // For n = 1 the 1/e^2 half-width of a Gaussian is w = 2*sigma.
  const w0 = 2 * sigma0;
  return { raw: [A0, B0, cx, cy, w0, w0, theta, 1], startSource };
}

function makeGauss1dStartRaw(samples: FitSample[]): number[] | null {
  if (samples.length === 0) return null;
  let minPx = Number.POSITIVE_INFINITY;
  let maxPx = Number.NEGATIVE_INFINITY;
  let firstValue = Number.NaN;
  let lastValue = Number.NaN;
  let maxValue = Number.NEGATIVE_INFINITY;
  let centerPx = Number.NaN;
  for (const sample of samples) {
    if (sample.x < minPx) {
      minPx = sample.x;
      firstValue = sample.value;
    }
    if (sample.x > maxPx) {
      maxPx = sample.x;
      lastValue = sample.value;
    }
    if (sample.value > maxValue) {
      maxValue = sample.value;
      centerPx = sample.x;
    }
  }
  // The 1D mirror of the ROI border ring: the first and last finite samples.
  const B0 = (firstValue + lastValue) / 2;
  const A0 = maxValue - B0;
  if (!(A0 > 0)) return null;
  let halfCount = 0;
  const threshold = B0 + A0 / 2;
  for (const sample of samples) {
    if (sample.value > threshold) halfCount += 1;
  }
  let sigma0 = halfCount / ONE_D_HALF_WIDTH_FACTOR;
  if (sigma0 < SIGMA_FLOOR_PX) sigma0 = SIGMA_FLOOR_PX;
  return [A0, B0, centerPx, sigma0];
}

// ---------------------------------------------------------------------------
// Model functions (raw-parameter layouts)
//
// gauss2dConstantBackground: [A, B, cx, cy, s1, s2, theta]
// gauss2dTiltedBackground:   [A, B, bx, by, cx, cy, s1, s2, theta]
// superGauss2d:              [A, B, cx, cy, w1, w2, theta, n]
// gauss1d:                   [A, B, c, s]
//
// All scale parameters enter the models through their absolute value; the
// per-parameter derivatives account for the sign of the raw value (0 at
// exactly zero), which is the documented positivity convention of the LM.
// ---------------------------------------------------------------------------

type Gauss2dKernel = {
  g: number;
  u: number;
  v: number;
  ca: number;
  sa: number;
  a1: number;
  a2: number;
  inv1Sq: number;
  inv2Sq: number;
};

function gauss2dKernelAt(raw: number[], tilted: boolean, x: number, y: number): Gauss2dKernel {
  const cx = tilted ? raw[4] : raw[2];
  const cy = tilted ? raw[5] : raw[3];
  const s1raw = tilted ? raw[6] : raw[4];
  const s2raw = tilted ? raw[7] : raw[5];
  const theta = tilted ? raw[8] : raw[6];
  const dx = x - cx;
  const dy = y - cy;
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const u = dx * ca + dy * sa;
  const v = -dx * sa + dy * ca;
  const a1 = Math.abs(s1raw);
  const a2 = Math.abs(s2raw);
  const inv1Sq = a1 > 0 ? 1 / (a1 * a1) : 0;
  const inv2Sq = a2 > 0 ? 1 / (a2 * a2) : 0;
  let half: number;
  if (a1 > 0 && a2 > 0) {
    half = 0.5 * (u * u * inv1Sq + v * v * inv2Sq);
  } else if (u !== 0 && !(a1 > 0)) {
    half = Number.POSITIVE_INFINITY;
  } else if (v !== 0 && !(a2 > 0)) {
    half = Number.POSITIVE_INFINITY;
  } else {
    half = 0.5 * (u * u * inv1Sq + v * v * inv2Sq);
  }
  const g = Math.exp(-half);
  return { g, u, v, ca, sa, a1, a2, inv1Sq, inv2Sq };
}

function gauss2dConstantValue(raw: number[], x: number, y: number): number {
  return raw[1] + raw[0] * gauss2dKernelAt(raw, false, x, y).g;
}

function gauss2dTiltedValue(raw: number[], x: number, y: number): number {
  const kernel = gauss2dKernelAt(raw, true, x, y);
  const dx = x - raw[4];
  const dy = y - raw[5];
  return raw[1] + raw[2] * dx + raw[3] * dy + raw[0] * kernel.g;
}

function gauss2dConstantJacobian(raw: number[], x: number, y: number, out: number[]): void {
  const A = raw[0];
  const kernel = gauss2dKernelAt(raw, false, x, y);
  const { g, u, v, ca, sa, a1, a2, inv1Sq, inv2Sq } = kernel;
  const inv1Cb = a1 > 0 ? 1 / (a1 * a1 * a1) : 0;
  const inv2Cb = a2 > 0 ? 1 / (a2 * a2 * a2) : 0;
  out[0] = g;
  out[1] = 1;
  // dg/dcx = g*(u*cos/s1^2 - v*sin/s2^2); dg/dcy = g*(u*sin/s1^2 + v*cos/s2^2).
  out[2] = A * g * (u * ca * inv1Sq - v * sa * inv2Sq);
  out[3] = A * g * (u * sa * inv1Sq + v * ca * inv2Sq);
  out[4] = A * g * u * u * inv1Cb * Math.sign(raw[4]);
  out[5] = A * g * v * v * inv2Cb * Math.sign(raw[5]);
  // dg/dtheta = u*v*g*(1/s2^2 - 1/s1^2).
  out[6] = A * g * u * v * (inv2Sq - inv1Sq);
}

function gauss2dTiltedJacobian(raw: number[], x: number, y: number, out: number[]): void {
  const A = raw[0];
  const kernel = gauss2dKernelAt(raw, true, x, y);
  const { g, u, v, ca, sa, a1, a2, inv1Sq, inv2Sq } = kernel;
  const inv1Cb = a1 > 0 ? 1 / (a1 * a1 * a1) : 0;
  const inv2Cb = a2 > 0 ? 1 / (a2 * a2 * a2) : 0;
  out[0] = g;
  out[1] = 1;
  out[2] = x - raw[4];
  out[3] = y - raw[5];
  out[4] = A * g * (u * ca * inv1Sq - v * sa * inv2Sq) - raw[2];
  out[5] = A * g * (u * sa * inv1Sq + v * ca * inv2Sq) - raw[3];
  out[6] = A * g * u * u * inv1Cb * Math.sign(raw[6]);
  out[7] = A * g * v * v * inv2Cb * Math.sign(raw[7]);
  out[8] = A * g * u * v * (inv2Sq - inv1Sq);
}

function clampSuperGaussN(raw: number[]): void {
  if (!Number.isFinite(raw[7])) {
    raw[7] = 1;
    return;
  }
  if (raw[7] < SUPER_GAUSS_N_MIN) raw[7] = SUPER_GAUSS_N_MIN;
  if (raw[7] > SUPER_GAUSS_N_MAX) raw[7] = SUPER_GAUSS_N_MAX;
}

// The exact Super-Gaussian of Plan v5 section 6:
//   I(x, y) = B + A*exp(-2*((u/w1)^2 + (v/w2)^2)^n).
// For w1 = w2 the elliptical energy reduces to (r/w)^2, so
// exp(-2*((r/w)^2)^n) = exp(-2*(r/w)^(2n)), which is exactly the radial
// reference model in packages/beams/src/profiles.ts.
function superGaussValue(raw: number[], x: number, y: number): number {
  return raw[1] + raw[0] * superGaussKernel(raw, x, y).g;
}

type SuperGaussKernel = {
  g: number;
  dgdE: number;
  E: number;
  u: number;
  v: number;
  ca: number;
  sa: number;
  invW1Sq: number;
  invW2Sq: number;
  invW1Cb: number;
  invW2Cb: number;
  w1: number;
  w2: number;
};

function superGaussKernel(raw: number[], x: number, y: number): SuperGaussKernel {
  const cx = raw[2];
  const cy = raw[3];
  const w1raw = raw[4];
  const w2raw = raw[5];
  const theta = raw[6];
  const n = raw[7];
  const dx = x - cx;
  const dy = y - cy;
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const u = dx * ca + dy * sa;
  const v = -dx * sa + dy * ca;
  const w1 = Math.abs(w1raw);
  const w2 = Math.abs(w2raw);
  const invW1Sq = w1 > 0 ? 1 / (w1 * w1) : 0;
  const invW2Sq = w2 > 0 ? 1 / (w2 * w2) : 0;
  const invW1Cb = w1 > 0 ? 1 / (w1 * w1 * w1) : 0;
  const invW2Cb = w2 > 0 ? 1 / (w2 * w2 * w2) : 0;
  let E: number;
  if (u === 0 && v === 0) {
    E = 0;
  } else if (!(w1 > 0) || !(w2 > 0)) {
    E = Number.POSITIVE_INFINITY;
  } else {
    E = u * u * invW1Sq + v * v * invW2Sq;
  }
  const g = Math.exp(-2 * Math.pow(E, n));
  let dgdE = 0;
  if (Number.isFinite(E) && E > 0) dgdE = -2 * n * Math.pow(E, n - 1) * g;
  return { g, dgdE, E, u, v, ca, sa, invW1Sq, invW2Sq, invW1Cb, invW2Cb, w1, w2 };
}

function superGaussJacobian(raw: number[], x: number, y: number, out: number[]): void {
  const A = raw[0];
  const n = raw[7];
  const kernel = superGaussKernel(raw, x, y);
  const { g, dgdE, E, u, v, ca, sa, invW1Sq, invW2Sq, invW1Cb, invW2Cb } = kernel;
  out[0] = g;
  out[1] = 1;
  // dE/dcx = -2*u*cos/w1^2 + 2*v*sin/w2^2
  // dE/dcy = -2*u*sin/w1^2 - 2*v*cos/w2^2
  // dE/dw1 = -2*u^2/w1^3 (raw sign), dE/dw2 = -2*v^2/w2^3 (raw sign)
  // dE/dtheta = 2*u*v*(1/w1^2 - 1/w2^2)
  out[2] = A * dgdE * (-2 * u * ca * invW1Sq + 2 * v * sa * invW2Sq);
  out[3] = A * dgdE * (-2 * u * sa * invW1Sq - 2 * v * ca * invW2Sq);
  out[4] = A * dgdE * (-2 * u * u * invW1Cb) * Math.sign(raw[4]);
  out[5] = A * dgdE * (-2 * v * v * invW2Cb) * Math.sign(raw[5]);
  out[6] = A * dgdE * (2 * u * v * (invW1Sq - invW2Sq));
  // dg/dn = -2*g*E^n*ln(E); the E -> 0+ limit of E^n*ln(E) is 0 for n > 0.
  out[7] = E === 0 || !Number.isFinite(E) ? 0 : -2 * A * g * Math.pow(E, n) * Math.log(E);
}

function gauss1dValue(raw: number[], x: number, _y: number): number {
  const c = raw[2];
  const s = raw[3];
  const sAbs = Math.abs(s);
  const d = x - c;
  const half = sAbs > 0 ? (0.5 * d * d) / (sAbs * sAbs) : d === 0 ? 0 : Number.POSITIVE_INFINITY;
  return raw[1] + raw[0] * Math.exp(-half);
}

function gauss1dJacobian(raw: number[], x: number, _y: number, out: number[]): void {
  const A = raw[0];
  const c = raw[2];
  const s = raw[3];
  const sAbs = Math.abs(s);
  const d = x - c;
  const invS2 = sAbs > 0 ? 1 / (sAbs * sAbs) : 0;
  const invS3 = sAbs > 0 ? 1 / (sAbs * sAbs * sAbs) : 0;
  const half = sAbs > 0 ? 0.5 * d * d * invS2 : d === 0 ? 0 : Number.POSITIVE_INFINITY;
  const g = Math.exp(-half);
  out[0] = g;
  out[1] = 1;
  out[2] = A * g * d * invS2;
  out[3] = A * g * d * d * invS3 * Math.sign(s);
}

function noClamp(_raw: number[]): void {}

// ---------------------------------------------------------------------------
// Parameter scaling
// ---------------------------------------------------------------------------

function sampleExtents(samples: FitSample[]): {
  span: number;
  xExtent: number;
  yExtent: number;
} {
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (sample.value < minV) minV = sample.value;
    if (sample.value > maxV) maxV = sample.value;
    if (sample.x < minX) minX = sample.x;
    if (sample.x > maxX) maxX = sample.x;
    if (sample.y < minY) minY = sample.y;
    if (sample.y > maxY) maxY = sample.y;
  }
  const span = Math.max(maxV - minV, SCALE_FLOOR);
  const xExtent = Math.max(maxX - minX, EXTENT_FLOOR_PX);
  const yExtent = Math.max(maxY - minY, EXTENT_FLOOR_PX);
  return { span, xExtent, yExtent };
}

function gauss2dScales(samples: FitSample[], tilted: boolean): Float64Array {
  const { span, xExtent, yExtent } = sampleExtents(samples);
  const sigmaExtent = Math.max(Math.min(xExtent, yExtent), EXTENT_FLOOR_PX);
  if (tilted) {
    return Float64Array.from([
      span,
      span,
      span / xExtent,
      span / yExtent,
      xExtent,
      yExtent,
      sigmaExtent,
      sigmaExtent,
      1,
    ]);
  }
  return Float64Array.from([span, span, xExtent, yExtent, sigmaExtent, sigmaExtent, 1]);
}

function superGaussScales(samples: FitSample[]): Float64Array {
  const { span, xExtent, yExtent } = sampleExtents(samples);
  const sigmaExtent = Math.max(Math.min(xExtent, yExtent), EXTENT_FLOOR_PX);
  return Float64Array.from([span, span, xExtent, yExtent, sigmaExtent, sigmaExtent, 1, 1]);
}

function gauss1dScales(samples: FitSample[]): Float64Array {
  const { span, xExtent } = sampleExtents(samples);
  return Float64Array.from([span, span, xExtent, xExtent]);
}

// ---------------------------------------------------------------------------
// Dense damped normal-equation solver (Gauss elimination, partial pivoting)
// ---------------------------------------------------------------------------

// Solve (normal + lambda*I) delta = gradient on the SCALED normal matrix.
// With residuals defined as r = data - model and J = d(model)/d(param), the
// Gauss-Newton step that descends the least-squares cost is
// delta = (J^T J + lambda I)^-1 J^T r: the RHS carries the PLUS sign of the
// accumulated J^T r, not its negation (the negation is the cost gradient and
// would ascend the cost, which the diagnostics showed: no trial was ever
// accepted and every fit froze at its starting cost).
// The solver is dense Gauss elimination with partial pivoting; a singular
// or numerically dead system reports null so the caller can raise the
// damping (Marquardt semantics).
function solveDampedNormalEquations(
  normal: Float64Array,
  gradient: Float64Array,
  nParams: number,
  lambda: number,
): Float64Array | null {
  const cols = nParams + 1;
  const matrix = new Float64Array(nParams * cols);
  for (let i = 0; i < nParams; i += 1) {
    const row = i * cols;
    for (let j = 0; j < nParams; j += 1) {
      matrix[row + j] = i === j ? normal[i * nParams + j] + lambda : normal[i * nParams + j];
    }
    matrix[row + nParams] = gradient[i];
  }
  for (let col = 0; col < nParams; col += 1) {
    let pivotRow = col;
    let pivotAbs = Math.abs(matrix[pivotRow * cols + col]);
    for (let r = col + 1; r < nParams; r += 1) {
      const absValue = Math.abs(matrix[r * cols + col]);
      if (absValue > pivotAbs) {
        pivotAbs = absValue;
        pivotRow = r;
      }
    }
    if (!Number.isFinite(pivotAbs) || pivotAbs <= 1e-300) return null;
    if (pivotRow !== col) {
      for (let c = 0; c < cols; c += 1) {
        const tmp = matrix[pivotRow * cols + c];
        matrix[pivotRow * cols + c] = matrix[col * cols + c];
        matrix[col * cols + c] = tmp;
      }
    }
    const pivot = matrix[col * cols + col];
    for (let r = col + 1; r < nParams; r += 1) {
      const factor = matrix[r * cols + col] / pivot;
      for (let c = col; c < cols; c += 1) {
        matrix[r * cols + c] -= factor * matrix[col * cols + c];
      }
      matrix[r * cols + col] = 0;
    }
  }
  const delta = new Float64Array(nParams);
  for (let i = nParams - 1; i >= 0; i -= 1) {
    const row = i * cols;
    let sum = matrix[row + nParams];
    for (let c = i + 1; c < nParams; c += 1) sum -= matrix[row + c] * delta[c];
    delta[i] = sum / matrix[row + i];
  }
  return delta;
}

// ---------------------------------------------------------------------------
// Shared Levenberg-Marquardt engine
// ---------------------------------------------------------------------------

type ModelSpec = {
  parameterCount: number;
  scales: Float64Array;
  valueAt: (raw: number[], x: number, y: number) => number;
  jacobianAt: (raw: number[], x: number, y: number, out: number[]) => void;
  clamp: (raw: number[]) => void;
};

type ResidualState = { residuals: Float64Array; cost: number; maxAbs: number };

type EngineOutcome = {
  status: FitStatus;
  raw: number[] | null;
  iterations: number;
  costInitial: number;
  costFinal: number;
  residualRmsCounts: number | null;
  residualMaxAbsCounts: number | null;
};

function computeResiduals(samples: FitSample[], model: ModelSpec, raw: number[]): ResidualState {
  const residuals = new Float64Array(samples.length);
  let cost = 0;
  let maxAbs = 0;
  for (let k = 0; k < samples.length; k += 1) {
    const sample = samples[k];
    const residual = sample.value - model.valueAt(raw, sample.x, sample.y);
    residuals[k] = residual;
    cost += residual * residual;
    const absResidual = Math.abs(residual);
    if (absResidual > maxAbs) maxAbs = absResidual;
  }
  return { residuals, cost, maxAbs };
}

function runLM(
  samples: FitSample[],
  model: ModelSpec,
  rawStart: number[],
  options: { maxIterations: number; timeBudgetMs: number | null; now: () => number },
): EngineOutcome {
  const nParams = model.parameterCount;
  const nSamples = samples.length;
  const scales = model.scales;

  let raw: number[] | null = rawStart.slice();
  model.clamp(raw);
  let residualState = computeResiduals(samples, model, raw);
  let cost = residualState.cost;
  const costInitial = cost;
  let lambda = LAMBDA_START;
  let iterations = 0;
  let status: FitStatus | null = null;
  const startWall = options.now();

  // Absolute zero-cost floor (follow-up design): a numerically exact model
  // leaves only rounding residuals of order eps*value and no descent step
  // can improve on that, so trial acceptance alone would never progress the
  // fit any further. The floor is scale-aware and deterministic:
  // COST_FLOOR = (1e-12 * dataSpan)^2 * finiteCount with dataSpan the
  // max-min span of the finite fitted values, computed ONCE below. A zero
  // dataSpan is degenerate and invalid_start semantics already reject such
  // data before this engine runs.
  let dataMin = Number.POSITIVE_INFINITY;
  let dataMax = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (sample.value < dataMin) dataMin = sample.value;
    if (sample.value > dataMax) dataMax = sample.value;
  }
  const dataSpan = dataMax - dataMin;
  const costFloor = (COST_FLOOR_RELATIVE * dataSpan) ** 2 * nSamples;

  // Relative size of a SCALED-space step against the current scaled
  // parameters; this is the contract's convergence measure. Delta is in
  // scaled units, so the threshold means exactly what the contract states.
  const scaledRelativeStep = (delta: Float64Array): number => {
    // Only called from the iteration loop, which breaks before any further
    // use once the singular path sets raw to null.
    const current = raw as number[];
    let maxRel = 0;
    for (let i = 0; i < nParams; i += 1) {
      const scaledAfter = current[i] / scales[i];
      const denominator = Math.max(1, Math.abs(scaledAfter));
      const rel = Math.abs(delta[i]) / denominator;
      if (rel > maxRel) maxRel = rel;
    }
    return maxRel;
  };

  // Relative cost improvement of the most recently ACCEPTED trial; used by
  // the wedge exit to decide whether the fit already met the cost criterion
  // before the damping ceiling was reached. null means no trial accepted.
  let lastAcceptedRelCost: number | null = null;
  // Companion of the above (S20 D2): the scaled relative PARAMETER step of
  // that same accepted trial. The two are written together in the accepted
  // branch below and are therefore always both null or both set; the wedge
  // exit reads them as one pair.
  let lastAcceptedRelParam: number | null = null;

  for (let iter = 1; iter <= options.maxIterations; iter += 1) {
    // Absolute floor FIRST: below it only rounding residuals remain and no
    // step can do better, so the fit is converged before any trial is built.
    if (cost <= costFloor) {
      status = "converged";
      iterations = iter - 1;
      break;
    }

    // The budget is checked once per iteration, before any trial work.
    if (options.timeBudgetMs !== null && options.now() - startWall > options.timeBudgetMs) {
      status = "time_budget_exceeded";
      iterations = iter - 1;
      break;
    }

    // Accumulate J^T J and J^T r directly (no full Jacobian allocation) with
    // the columns scaled: d(model)/d(s_i) = scale_i * d(model)/d(raw_i).
    const normal = new Float64Array(nParams * nParams);
    const gradient = new Float64Array(nParams);
    const scratch = new Array<number>(nParams);
    for (let k = 0; k < nSamples; k += 1) {
      const sample = samples[k];
      model.jacobianAt(raw, sample.x, sample.y, scratch);
      const residual = residualState.residuals[k];
      for (let i = 0; i < nParams; i += 1) {
        const scaled = scratch[i] * scales[i];
        scratch[i] = scaled;
        const row = i * nParams;
        for (let j = 0; j <= i; j += 1) normal[row + j] += scaled * scratch[j];
        gradient[i] += scaled * residual;
      }
    }
    // The accumulation above only fills the LOWER triangle (j <= i), so the
    // mirror must copy lower -> upper. Copying the other way silently zeroed
    // every off-diagonal entry, which reduced the normal equations to
    // diag(J^T J) and turned every step into a Jacobi-scaled gradient step:
    // correlated parameters (A/B/sigma) then zig-zagged, lambda ratcheted up
    // and the fits crawled past the 30-iteration cap.
    for (let i = 0; i < nParams; i += 1) {
      for (let j = i + 1; j < nParams; j += 1) normal[i * nParams + j] = normal[j * nParams + i];
    }

    // Stationarity measure for the wedge exit: the max absolute SCALED
    // gradient component. At a genuine minimum this collapses below the
    // threshold even when no damped step can strictly lower the cost.
    let maxAbsScaledGradient = 0;
    for (let i = 0; i < nParams; i += 1) {
      const absValue = Math.abs(gradient[i]);
      if (absValue > maxAbsScaledGradient) maxAbsScaledGradient = absValue;
    }

    let solvedAny = false;
    let accepted = false;
    let trialRaw: number[] | null = null;
    let trialCost = Number.POSITIVE_INFINITY;
    let trialResiduals: Float64Array | null = null;
    let trialDelta: Float64Array | null = null;
    let trialMaxAbs = 0;

    for (let attempt = 0; attempt < MAX_STEP_ATTEMPTS; attempt += 1) {
      const delta = solveDampedNormalEquations(normal, gradient, nParams, lambda);
      if (delta === null) {
        // Singular system: increase damping and retry. On the very first
        // iteration this path ends in the singular_normal_equations status
        // below; mid-fit it stays in the loop and keeps iterating.
        lambda = Math.min(lambda * LAMBDA_UP_FACTOR, LAMBDA_MAX);
        continue;
      }
      solvedAny = true;
      const candidate = new Array<number>(nParams);
      for (let i = 0; i < nParams; i += 1) candidate[i] = raw[i] + scales[i] * delta[i];
      model.clamp(candidate);
      const candidateState = computeResiduals(samples, model, candidate);
      // Non-worsening acceptance (follow-up design): cost_new <= cost_old
      // is applied, not only strict descent. On an exact-cost plateau a
      // trial with equal cost carries the (tiny) scaled parameter change
      // that then satisfies the convergence predicate below; strict
      // descent would reject every such trial and never converge.
      if (Number.isFinite(candidateState.cost) && candidateState.cost <= cost) {
        trialRaw = candidate;
        trialCost = candidateState.cost;
        trialResiduals = candidateState.residuals;
        trialDelta = delta;
        trialMaxAbs = candidateState.maxAbs;
        accepted = true;
        break;
      }
      lambda = Math.min(lambda * LAMBDA_UP_FACTOR, LAMBDA_MAX);
    }

    if (!solvedAny && iter === 1) {
      // A singular system before any step ever succeeded is reported
      // honestly with null params (contract).
      status = "singular_normal_equations";
      raw = null;
      iterations = 0;
      break;
    }

    iterations = iter;

    if (accepted && trialRaw !== null && trialDelta !== null && trialResiduals !== null) {
      const relParam = scaledRelativeStep(trialDelta);
      const relCost = cost > 0 ? (cost - trialCost) / cost : 0;
      lastAcceptedRelCost = relCost;
      lastAcceptedRelParam = relParam;
      raw = trialRaw;
      cost = trialCost;
      residualState = { residuals: trialResiduals, cost: trialCost, maxAbs: trialMaxAbs };
      lambda = Math.max(lambda / LAMBDA_DOWN_FACTOR, LAMBDA_MIN);
      if (
        relParam <= PARAM_REL_TOLERANCE &&
        relCost <= COST_REL_TOLERANCE
      ) {
        status = "converged";
        break;
      }
    } else if (lambda >= LAMBDA_MAX) {
      // Wedge exit (follow-up design): every trial of this iteration was
      // rejected, the damping grew to LAMBDA_MAX and no damped step can
      // lower the cost from the current point. The fit may still BE at a
      // minimum, so converged is reported when the evidence says so: the
      // most recent accepted step already satisfied the relative
      // cost-improvement criterion, or the scaled gradient has collapsed
      // below a scale-aware floor. The gradient is J^T r with columns
      // multiplied by the parameter scales, so counts-like entries grow
      // with the data span; an absolute 1e-8 floor then falsely reports
      // max_iterations on a perfect high-amplitude beam. Multiply by
      // max(1, dataSpan) to keep the same relative stationarity test.
      //
      // S18-R2 F3 adds the two honesty arms below.
      // (1) The gradient arm alone is not sample-count aware: the scaled
      //     gradient is a SUM over nSamples, so a large clean ROI at its
      //     exact minimum still shows |g| far above the limit (measured 0.42
      //     to 7.87 against a limit of 1e-4 to 2e-4 on 24000-sample ROIs
      //     whose recovered widths were exact to 1e-13 percent). The
      //     numerical-floor arm certifies those honestly: when the residual
      //     rms is below 1e-10 data spans per sample there is nothing left to
      //     fit. A Gauss-Newton "predicted decrease" test was measured and
      //     REJECTED for this job - at the rounding floor the linearized
      //     model predicts it can remove essentially the whole remaining cost
      //     (measured predicted relative decrease 0.9999999999 on exactly the
      //     stalls this arm must accept), so it certifies nothing.
      // (2) max_iterations now means exactly one thing: the iteration cap was
      //     exhausted. A wedge stop happens with iterations < cap, so an
      //     UNCERTIFIED wedge stop reports singular_normal_equations - at
      //     LAMBDA_MAX the damped system is diagonal-dominated, its step is
      //     numerically inert and the local quadratic model carries no usable
      //     information; that, not an exhausted budget, is what happened.
      //
      // S20 D2 adds the parameter-step guard to arm 1. The cost criterion on
      // its own certifies "the last step barely lowered the cost", which is
      // the SAME two-sided statement the ordinary convergence predicate makes
      // only in conjunction with a small parameter step (see
      // PARAM_REL_TOLERANCE above): a fit crossing a flat shelf takes large
      // steps for negligible cost gain and is not at a minimum. The guard
      // restores that conjunction with the calibrated, deliberately looser
      // WEDGE_PARAM_REL_TOLERANCE. Null semantics: the two last-accepted
      // values are written as a pair, so lastAcceptedRelParam is null exactly
      // when lastAcceptedRelCost is null - a case the arm already rejects on
      // the cost side. The guard is therefore written to PASS on null, which
      // keeps arm 1 behaving exactly as it did before this change whenever no
      // step was ever accepted.
      const wedgeGradientLimit = WEDGE_GRADIENT_TOLERANCE * Math.max(1, dataSpan);
      const wedgeRelativeCost =
        dataSpan > 0 && nSamples > 0 ? cost / (dataSpan * dataSpan * nSamples) : Number.POSITIVE_INFINITY;
      if (
        (lastAcceptedRelCost !== null &&
          lastAcceptedRelCost <= COST_REL_TOLERANCE &&
          (lastAcceptedRelParam === null || lastAcceptedRelParam <= WEDGE_PARAM_REL_TOLERANCE)) ||
        maxAbsScaledGradient < wedgeGradientLimit ||
        wedgeRelativeCost <= WEDGE_COST_RELATIVE_FLOOR
      ) {
        status = "converged";
      } else {
        status = "singular_normal_equations";
      }
      break;
    }
  }

  if (status === null) status = "max_iterations";
  const residualRmsCounts = raw !== null ? Math.sqrt(cost / nSamples) : null;
  const residualMaxAbsCounts = raw !== null ? residualState.maxAbs : null;
  return {
    status,
    raw,
    iterations,
    costInitial,
    costFinal: cost,
    residualRmsCounts,
    residualMaxAbsCounts,
  };
}

// ---------------------------------------------------------------------------
// Result mapping and canonicalization
// ---------------------------------------------------------------------------

function canonicalizeTheta(theta: number): number {
  let t = theta % Math.PI;
  if (t < 0) t += Math.PI;
  // Exact pi is 0 modulo the axis period: fold it back (moments.ts rule).
  if (t >= Math.PI) t = 0;
  return t;
}

function mapCenter(coord: number, b: number): number {
  return b > 1 ? b * coord + (b - 1) / 2 : coord;
}

// Discrete Sheppard correction for mean-pooled DECIMATION: the b x b block
// average over integer pixel centres adds variance (b*b - 1)/12 (the
// continuous box variance b*b/12 overstates the correction). b = 1 then
// subtracts exactly 0.
function mapSigma(sigma: number, b: number): number {
  if (b <= 1) return sigma;
  const correctedSquared = b * b * sigma * sigma - (b * b - 1) / 12;
  return Math.sqrt(Math.max(0, correctedSquared));
}

// Width counterpart of mapSigma: w = 2*sigma implies the variance term is
// scaled by 4, so the discrete correction is (b*b - 1)/3.
function mapWidth(width: number, b: number): number {
  if (b <= 1) return width;
  const correctedSquared = b * b * width * width - (b * b - 1) / 3;
  return Math.sqrt(Math.max(0, correctedSquared));
}

function gauss2dParamsFromRaw(raw: number[], tilted: boolean, b: number): Gauss2dFitParams {
  let A: number;
  let B: number;
  let cx: number;
  let cy: number;
  let s1: number;
  let s2: number;
  let theta: number;
  let bx: number | undefined;
  let by: number | undefined;
  if (tilted) {
    A = raw[0];
    B = raw[1];
    bx = raw[2];
    by = raw[3];
    cx = raw[4];
    cy = raw[5];
    s1 = raw[6];
    s2 = raw[7];
    theta = raw[8];
  } else {
    A = raw[0];
    B = raw[1];
    cx = raw[2];
    cy = raw[3];
    s1 = raw[4];
    s2 = raw[5];
    theta = raw[6];
  }
  let major = Math.abs(s1);
  let minor = Math.abs(s2);
  let th = theta;
  if (major < minor) {
    const tmp = major;
    major = minor;
    minor = tmp;
    th += Math.PI / 2;
  }
  th = canonicalizeTheta(th);
  const result: Gauss2dFitParams = {
    amplitudeCounts: A,
    backgroundCounts: B,
    centerXPx: mapCenter(cx, b),
    centerYPx: mapCenter(cy, b),
    sigmaMajorPx: mapSigma(major, b),
    sigmaMinorPx: mapSigma(minor, b),
    thetaRad: th,
  };
  if (tilted) {
    result.backgroundSlopeXCountsPerPx = bx! / b;
    result.backgroundSlopeYCountsPerPx = by! / b;
  }
  return result;
}

function superGaussParamsFromRaw(raw: number[], b: number): SuperGauss2dFitParams {
  const A = raw[0];
  const B = raw[1];
  const cx = raw[2];
  const cy = raw[3];
  let w1 = Math.abs(raw[4]);
  let w2 = Math.abs(raw[5]);
  let th = raw[6];
  const n = clampNValue(raw[7]);
  if (w1 < w2) {
    const tmp = w1;
    w1 = w2;
    w2 = tmp;
    th += Math.PI / 2;
  }
  th = canonicalizeTheta(th);
  return {
    amplitudeCounts: A,
    backgroundCounts: B,
    centerXPx: mapCenter(cx, b),
    centerYPx: mapCenter(cy, b),
    w1Px: mapWidth(w1, b),
    w2Px: mapWidth(w2, b),
    thetaRad: th,
    superGaussN: n,
  };
}

function clampNValue(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < SUPER_GAUSS_N_MIN) return SUPER_GAUSS_N_MIN;
  if (n > SUPER_GAUSS_N_MAX) return SUPER_GAUSS_N_MAX;
  return n;
}

function gauss1dParamsFromRaw(raw: number[]): Gauss1dFitParams {
  return {
    amplitudeCounts: raw[0],
    backgroundCounts: raw[1],
    centerPx: raw[2],
    sigmaPx: Math.abs(raw[3]),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function fitGauss2d(
  corrected: CorrectedImage,
  roi: Roi,
  options?: Gauss2dFitOptions,
): FitResult<Gauss2dFitParams> {
  const tilted = options?.tiltedBackground === true;
  const normalized = normalizeOptions(options);
  validateCorrectedImage(corrected);
  validateRoi(corrected, roi);
  const { samples, b } = collectRoiSamples(corrected, roi);
  const start = makeGauss2dStartRaw(samples, b, options?.startMoments ?? null, tilted);
  const startSource: FitResult<Gauss2dFitParams>["startSource"] =
    options?.startMoments != null ? "moments" : "half-area";
  if (start === null) {
    return {
      status: "invalid_start",
      converged: false,
      params: null,
      iterations: 0,
      costInitial: 0,
      costFinal: 0,
      residualRmsCounts: null,
      residualMaxAbsCounts: null,
      decimated: b > 1,
      decimationFactor: b,
      startSource,
    };
  }

  const model: ModelSpec = {
    parameterCount: tilted ? 9 : 7,
    scales: gauss2dScales(samples, tilted),
    valueAt: tilted ? gauss2dTiltedValue : gauss2dConstantValue,
    jacobianAt: tilted ? gauss2dTiltedJacobian : gauss2dConstantJacobian,
    clamp: noClamp,
  };
  const outcome = runLM(samples, model, start.raw, normalized);
  return {
    status: outcome.status,
    converged: outcome.status === "converged",
    params: outcome.raw !== null ? gauss2dParamsFromRaw(outcome.raw, tilted, b) : null,
    iterations: outcome.iterations,
    costInitial: outcome.costInitial,
    costFinal: outcome.costFinal,
    residualRmsCounts: outcome.residualRmsCounts,
    residualMaxAbsCounts: outcome.residualMaxAbsCounts,
    decimated: b > 1,
    decimationFactor: b,
    startSource: start.startSource,
  };
}

export function fitSuperGauss2d(
  corrected: CorrectedImage,
  roi: Roi,
  options?: Gauss2dFitOptions,
): FitResult<SuperGauss2dFitParams> {
  const normalized = normalizeOptions(options);
  validateCorrectedImage(corrected);
  validateRoi(corrected, roi);
  const { samples, b } = collectRoiSamples(corrected, roi);
  const start = makeSuperGaussStartRaw(samples, b, options?.startMoments ?? null);
  const startSource: FitResult<Gauss2dFitParams>["startSource"] =
    options?.startMoments != null ? "moments" : "half-area";
  if (start === null) {
    return {
      status: "invalid_start",
      converged: false,
      params: null,
      iterations: 0,
      costInitial: 0,
      costFinal: 0,
      residualRmsCounts: null,
      residualMaxAbsCounts: null,
      decimated: b > 1,
      decimationFactor: b,
      startSource,
    };
  }

  const model: ModelSpec = {
    parameterCount: 8,
    scales: superGaussScales(samples),
    valueAt: superGaussValue,
    jacobianAt: superGaussJacobian,
    clamp: clampSuperGaussN,
  };
  const outcome = runLM(samples, model, start.raw, normalized);
  return {
    status: outcome.status,
    converged: outcome.status === "converged",
    params: outcome.raw !== null ? superGaussParamsFromRaw(outcome.raw, b) : null,
    iterations: outcome.iterations,
    costInitial: outcome.costInitial,
    costFinal: outcome.costFinal,
    residualRmsCounts: outcome.residualRmsCounts,
    residualMaxAbsCounts: outcome.residualMaxAbsCounts,
    decimated: b > 1,
    decimationFactor: b,
    startSource: start.startSource,
  };
}

export function fitGauss1d(
  profile: { positionsPx: Float64Array; values: Float64Array },
  options?: FitOptions,
): FitResult<Gauss1dFitParams> {
  const normalized = normalizeOptions(options);
  validateProfile(profile);
  const samples = collectProfileSamples(profile);
  const rawStart = makeGauss1dStartRaw(samples);
  if (rawStart === null) {
    return {
      status: "invalid_start",
      converged: false,
      params: null,
      iterations: 0,
      costInitial: 0,
      costFinal: 0,
      residualRmsCounts: null,
      residualMaxAbsCounts: null,
      decimated: false,
      decimationFactor: 1,
      startSource: "half-area",
    };
  }

  const model: ModelSpec = {
    parameterCount: 4,
    scales: gauss1dScales(samples),
    valueAt: gauss1dValue,
    jacobianAt: gauss1dJacobian,
    clamp: noClamp,
  };
  const outcome = runLM(samples, model, rawStart, normalized);
  return {
    status: outcome.status,
    converged: outcome.status === "converged",
    params: outcome.raw !== null ? gauss1dParamsFromRaw(outcome.raw) : null,
    iterations: outcome.iterations,
    costInitial: outcome.costInitial,
    costFinal: outcome.costFinal,
    residualRmsCounts: outcome.residualRmsCounts,
    residualMaxAbsCounts: outcome.residualMaxAbsCounts,
    decimated: false,
    decimationFactor: 1,
    startSource: "half-area",
  };
}

// ---------------------------------------------------------------------------
// Internal model probe (test-only surface; NOT public API)
// ---------------------------------------------------------------------------

export type InternalModelProbe = {
  readonly parameterCount: number;
  readonly value: (raw: number[], x: number, y: number) => number;
  readonly jacobian: (raw: number[], x: number, y: number, out: number[]) => void;
  readonly clamp?: (raw: number[]) => void;
};

// Exposed solely so tests/unit/image-fit.test.ts can verify the analytic
// Jacobians against central finite differences. Raw parameter layouts are
// documented in the model section above. The 1D probe ignores y.
export const internalModelProbe: {
  gauss2dConstantBackground: InternalModelProbe;
  gauss2dTiltedBackground: InternalModelProbe;
  superGauss2d: InternalModelProbe;
  gauss1d: InternalModelProbe;
} = {
  gauss2dConstantBackground: {
    parameterCount: 7,
    value: gauss2dConstantValue,
    jacobian: gauss2dConstantJacobian,
  },
  gauss2dTiltedBackground: {
    parameterCount: 9,
    value: gauss2dTiltedValue,
    jacobian: gauss2dTiltedJacobian,
  },
  superGauss2d: {
    parameterCount: 8,
    value: superGaussValue,
    jacobian: superGaussJacobian,
    clamp: clampSuperGaussN,
  },
  gauss1d: {
    parameterCount: 4,
    value: gauss1dValue,
    jacobian: gauss1dJacobian,
  },
};
