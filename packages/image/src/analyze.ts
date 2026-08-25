// Full analyzer orchestration (S18e): the entire image pipeline as one
// function. analyzeImage validates the input, runs raw diagnostics, the
// chosen background model, the sigma_B reference cascade, the suggested-ROI
// proposal, stage-A ROI moments, the ROI stability sweep, both 2D fits, the
// stage-B aperture assessment, the profile set (M-3 noise wiring) and the
// beam metrics, then assembles a JSON-only result plus the IMAGE_* warning
// layer. Hard stage separation (Plan v5 section 7): stage-A rect moments are
// reported as the diagnostic tier; the released moments section carries ONLY
// the stage-B aperture result - a suppressed stage B is never replaced by
// stage-A numbers.
//
// After input validation every optional sub-step is failure-contained: a
// module RangeError (e.g. degenerate robust-plane background geometry) is
// caught, the affected section degrades to its documented null form and the
// corresponding warning is added. analyzeImage therefore never throws once
// the input has been validated.

import { warning, type SimulationWarning } from "../../core/src/index.ts";
import {
  validateImageAnalyzerInput,
  type ImageAnalyzerConfig,
  type ImageCalibration,
  type ImageDtype,
  type ImagePixelArray,
} from "./contracts.ts";
import {
  applyBackground,
  autoBackgroundCornerRects,
  backgroundPlaneScaleCorrection,
  backgroundRectsCoverSamePixels,
  estimateBackgroundNoise,
  type BackgroundConfig,
  type BackgroundNoiseEstimate,
  type BackgroundRect,
  type BackgroundReferenceTrend,
  type BackgroundResult,
} from "./background.ts";
import { computeImageDiagnostics, type ImageDiagnostics } from "./diagnostics.ts";
import { suggestRoi, type SuggestedRoi } from "./roi.ts";
import { runRoiStabilitySweep, type RoiStabilityReport } from "./stability.ts";
import { computeRectMoments, type ImageMoments } from "./moments.ts";
import {
  computeProjection,
  extractAxisProfile,
  extractCut,
  measureProfileWidths,
  type LineProfile,
  type ProfileWidths,
} from "./profiles.ts";
import {
  fitGauss2d,
  fitSuperGauss2d,
  type FitResult,
  type Gauss2dFitParams,
  type SuperGauss2dFitParams,
} from "./fit.ts";
import {
  assessAperture,
  type ApertureAssessment,
  type ApertureSuppressionReason,
} from "./aperture.ts";
import {
  compareModelResiduals,
  computeResidualOutput,
  mapGauss2dToPhysical,
  mapMomentsToPhysical,
  type PhysicalBeamGeometry,
} from "./reporting.ts";
import {
  computeEllipticity,
  computePhysicalEllipticity,
  computeRadialDistribution,
  computeSymmetryErrors,
  encircledPowerRadiusPx,
  type RadialDistribution,
  type SymmetryErrors,
} from "./metrics.ts";
import {
  ALPHA_CONSISTENCY_MAX_PERCENT,
  ALPHA_GATE_WEAK_PERCENT,
  APERTURE_ALPHA_DEFAULT,
  MULTI_PEAK_EVT_MARGIN,
  MULTI_PEAK_MIN_PEAK_FRACTION,
  SIGMA_REFERENCE_RIM_FRACTION,
  TIER_DISAGREEMENT_MIN_PERCENT,
  TIER_DISAGREEMENT_NOISE_K,
  WIDTH_SCATTER_WARNING_PERCENT,
} from "./thresholds.ts";
import { computeImageWarnings, type ImageProfileResult } from "./warnings.ts";

// S21 stage A: the background model as the CALLER states it. It is the
// existing BackgroundConfig union plus one sentinel, `{ method: "auto" }`,
// which carries no rectangles because the engine generates them (see
// resolveBackgroundConfig below). The sentinel is a separate member rather than
// an "auto" arm on BackgroundConfig so that background.ts keeps a union in
// which every member is directly applicable - applyBackground never sees a
// method it has to resolve first.
export type ImageBackgroundInput = BackgroundConfig | { method: "auto" };

// S21 stage A: the confirmed ROI as the CALLER states it - a rectangle, the
// sentinel "auto", or absent for the full frame. A sentinel rather than a
// separate boolean flag because the three choices are mutually exclusive by
// nature ("this rectangle" / "find one" / "the whole frame"), and a sentinel
// makes the fourth, meaningless state (a rectangle AND a request to find one)
// unrepresentable instead of needing a documented precedence rule.
export type ImageRoiInput = BackgroundRect | "auto";

export type ImageAnalysisInput = {
  pixels: ImagePixelArray | number[];
  width: number;
  height: number;
  dtype: ImageDtype;
  calibration?: ImageCalibration;
  // Alias of `calibration` for the plan JSON lane (`calib`).
  calib?: ImageCalibration;
  config?: ImageAnalyzerConfig;
  // Background model applied before every downstream stage. Since S21 stage A
  // this also accepts { method: "auto" }.
  background?: ImageBackgroundInput;
  // User reference rectangles for sigma_B; when absent, the documented ROI
  // rim frame is used (SIGMA_REFERENCE_RIM_FRACTION).
  backgroundSigmaRects?: BackgroundRect[];
  // Confirmed ROI; default is the full frame. Since S21 stage A this also
  // accepts the sentinel "auto".
  roi?: ImageRoiInput;
  // Aperture alpha, default APERTURE_ALPHA_DEFAULT.
  alpha?: number;
};

// S21 stage A: resolve the caller's background input into a directly
// applicable BackgroundConfig.
//
// "auto" resolves to the robust plane over the four corner reference boxes -
// exactly the configuration a user produces by choosing the plane model and
// clicking the four-corner reference preset. The resolution happens HERE,
// before anything else runs, and everything downstream then sees an ordinary
// rectangle-based configuration. That is deliberate and it is the whole
// correctness argument for the automatic method: there is no second code path
// to keep in step, so every guard the manual path has - the geometry checks,
// the leverage cap, the minimum-sample degradation to "none", the c(n)
// deflation correction, the coupling of the sigma_B reference to the
// background rectangles - applies unchanged and by construction, not by
// resemblance.
function resolveBackgroundConfig(
  background: ImageBackgroundInput,
  width: number,
  height: number,
): { config: BackgroundConfig; autoRects: BackgroundRect[] | null } {
  if (background.method !== "auto") return { config: background, autoRects: null };
  const autoRects = autoBackgroundCornerRects(width, height);
  return { config: { method: "robust-plane", rects: autoRects }, autoRects };
}

// A planar profile as released by analyzeImage: plain JSON only (typed
// arrays already converted), with the measured widths attached.
export type ImagePlanarProfile = {
  kind: string;
  positionsPx: number[];
  values: number[];
  stepUm?: number;
  contributingCounts?: number[];
  widths: ProfileWidths;
};

export type PlainBackgroundSection = {
  // The method actually APPLIED. S20 stage E: it is "none" whenever the
  // reference was too small (degradedReason) or the model threw.
  method: BackgroundConfig["method"];
  // S20 stage E: what the caller asked for, so a degraded run is legible
  // without re-reading the input. S21 stage A widens it by the "auto"
  // sentinel, which is what a caller who asked for the automatic method gets
  // back here.
  requestedMethod?: BackgroundConfig["method"] | "auto";
  // S21 stage A, present ONLY on the automatic path: what "auto" resolved to
  // after the whole cascade ran - "robust-plane", or "none" when the generated
  // reference could not support a plane. It equals `method` by construction
  // (the degradation is the same one a manual run takes); it exists so a
  // consumer reading requestedMethod "auto" can name the resolution without
  // having to know that `method` is the post-degradation field.
  resolvedMethod?: BackgroundConfig["method"];
  // S21 stage A, present ONLY on the automatic path: the reference rectangles
  // the engine generated, in the order it generated them, so the UI can draw
  // exactly what was measured and an export records it.
  resolvedRects?: BackgroundRect[];
  degradedReason?: "insufficient-reference-samples";
  referenceSampleCount?: number;
  referenceTrend?: BackgroundReferenceTrend;
  offsetCounts?: number;
  plane: NonNullable<BackgroundResult["plane"]> | null;
  noise: BackgroundNoiseEstimate | null;
  negativeCountAfter: number;
  negativeFractionAfter: number;
};

export type PlainRadialDistribution = {
  centerXPx: number;
  centerYPx: number;
  radiiPx: number[];
  enclosedFraction: number[];
  totalPositiveCounts: number;
  negativePowerRatio: number;
};

export type ImageAnalysisResult = {
  raw: ImageDiagnostics;
  background: PlainBackgroundSection;
  // The sigma_B noise scale actually used by the analyzer (reference
  // rectangles when given, else the documented ROI rim frame).
  noise: BackgroundNoiseEstimate;
  roi: {
    rect: BackgroundRect;
    // Where the CONFIRMED ROI came from. "input" is a rectangle the caller
    // named, "full-frame" is the default.
    //
    // S21 stage A adds "auto": the caller asked for the automatic ROI and the
    // engine's own suggestion was confirmed as the analysis domain. The two
    // pre-existing values keep their exact spelling - renaming them would move
    // every existing export, and the byte-identity of an unchanged input is the
    // primary regression oracle of this stage - so the vocabulary reads
    // "input" = a rectangle the user set, "full-frame" = the whole frame,
    // "auto" = the engine's suggestion, confirmed.
    source: "input" | "full-frame" | "auto";
    // S21 stage A, present ONLY when the automatic ROI was requested and did
    // NOT produce a rectangle: the run fell back to the full frame, and this
    // says so. Without it a fallback would be indistinguishable in the export
    // from an ordinary full-frame run.
    autoFallbackReason?: "no-suggestion";
    // The suggestion as computed for THIS run's confirmed ROI. Outside the
    // automatic path it is informational only and is never applied on its own.
    suggestion: SuggestedRoi | null;
  };
  stability: RoiStabilityReport;
  // Stage A: honest diagnostic tier, structurally separate from the released
  // stage-B moments below.
  momentsRoiDiagnostic: {
    moments: ImageMoments;
    predicateValid: boolean;
    invalidReason: ImageMoments["invalidReason"];
    // S20 stage F (F7 / R-26): the stage-A orientation contrast q recomputed on
    // the PITCH-SCALED covariance, i.e. the contrast of the beam rather than of
    // the pixel grid. Present only when a calibration was supplied (undefined
    // without one, null when the moments are invalid or the mapping fails). On
    // a square pixel it equals the pixel-space orientationContrastQ exactly.
    orientationContrastQPhysical?: number | null;
  };
  fits: {
    // S20 stage F (R-58): geometryReleasable is the ROI-relative plausibility
    // verdict on the fitted geometry - positive amplitude, centre inside the
    // CONFIRMED ROI, both sigmas positive and smaller than the ROI's longer
    // side. It is the same predicate the physical-geometry release and the
    // IMAGE_FIT_NOT_CONVERGED channel already use, exported as data so a
    // consumer never has to re-derive the physics. False whenever there are no
    // fit parameters at all. It is a statement about the GEOMETRY only: a fit
    // with status max_iterations can still carry a releasable geometry, and a
    // converged one can carry an unreleasable one (a runaway plane fit
    // converges with a centre thousands of pixels off the sensor).
    gauss2d: FitResult<Gauss2dFitParams> & { geometryReleasable: boolean };
    // Always run; null only on invalid_start.
    superGauss2d: FitResult<SuperGauss2dFitParams> | null;
    fitWidths: ApertureAssessment["fitWidths"];
    physical?: PhysicalBeamGeometry;
  };
  // ONLY the stage-B aperture release; stage-A numbers are never
  // substituted into this section.
  moments: {
    stageB: ImageMoments | null;
    suppressionReason: ApertureSuppressionReason | null;
    physical?: PhysicalBeamGeometry | null;
    // S20 stage F (F7 / R-26): the RELEASED orientation contrast q on the
    // pitch-scaled covariance. Present only when a calibration was supplied;
    // null when nothing was released. This is the quantity
    // IMAGE_ORIENTATION_UNSTABLE tests on a calibrated frame, and the warning
    // quotes this field rather than the pixel-space one.
    orientationContrastQPhysical?: number | null;
  };
  aperture: {
    // Gates is the full ApertureAssessment gates object: the S18 self-
    // calibrated fields (alphaConsistency: thresholdMajorPercent,
    // thresholdMinorPercent, nullRmsMajorPercent, nullRmsMinorPercent,
    // mcRealizationCount, decimationFactor, and the S18-R2 F2 fields
    // d4ScatterMajorPercent / d4ScatterMinorPercent; multiPeak:
    // thresholdCounts, evtThresholdCounts, peakFloorCounts,
    // scannedPixelCount) flow through this section unchanged into
    // JSON/CSV/UI via the existing envelope.
    gates: ApertureAssessment["gates"];
    pedestal: ApertureAssessment["pedestal"];
    // S18-R2 F1 (a): the absorbed-power honesty block flows through
    // unchanged, exactly like gates and pedestal.
    absorbedPower: ApertureAssessment["absorbedPower"];
    // S20 stage A: the aperture-coverage block, likewise unchanged.
    coverage: ApertureAssessment["coverage"];
    peakToBackgroundNoise: number | null;
    alphaUsed: number;
  };
  // S20 stage B (C6): the state of the CROSS-TIER check, reported explicitly
  // instead of being inferable only from the absence of a warning. Before this
  // block, "no IMAGE_TIER_DISAGREEMENT" meant either "checked, and the two
  // tiers agree" or "never checked at all", and a released width that had
  // never been cross-checked was indistinguishable from a cross-checked one.
  //
  // The three states are disjoint and exhaustive:
  //   evaluated true                       - the comparison ran; all four
  //                                          numbers below are measurements.
  //   evaluated false, reason non-null     - the stage-A plausibility predicate
  //                                          blocked the check, with the reason
  //                                          named. Reported whether or not the
  //                                          frame released, because it is a
  //                                          property of the diagnostic tier.
  //   evaluated false, reason null         - the predicate was satisfied but
  //                                          there was no released stage-B
  //                                          number to compare against;
  //                                          IMAGE_APERTURE_SUPPRESSED already
  //                                          carries that frame's reason.
  // The INFO notice below is raised only in the second state AND only on a
  // released frame - a suppressed frame has no released width to be unchecked.
  tierCheck: {
    evaluated: boolean;
    unavailableReason: TierCheckUnavailableReason | null;
    // Per-axis relative gap between the stage-A diagnostic d4 and the released
    // stage-B d4, in percent, and the per-axis ceilings this ROI's noise
    // explains. Null unless evaluated.
    gapMajorPercent: number | null;
    gapMinorPercent: number | null;
    thresholdMajorPercent: number | null;
    thresholdMinorPercent: number | null;
  };
  residuals: {
    rmsCounts: number;
    maxAbsCounts: number;
    display: { width: number; height: number; blockSizePx: number; values: number[] };
  } | null;
  profiles: {
    cutX: ImagePlanarProfile | null;
    cutY: ImagePlanarProfile | null;
    projectionX: ImagePlanarProfile | null;
    projectionY: ImagePlanarProfile | null;
    axisMajor: ImagePlanarProfile | null;
    axisMinor: ImagePlanarProfile | null;
  };
  metrics: {
    ellipticity: number | null;
    // Pitch-scaled ellipticity of the RELEASED physical geometry (see
    // metrics.ts computePhysicalEllipticity); null whenever no physical
    // geometry was released (no calibration, or an invalid/suppressed stage
    // B). Never derived from the pixel-space ellipticity above - anisotropic
    // pixel pitches make the two diverge (S18 review G1).
    ellipticityPhysical: number | null;
    radialDistribution: PlainRadialDistribution | null;
    encircledPowerRadiiPx: { fraction: number; radiusPx: number | null }[];
    symmetry: SymmetryErrors | null;
    modelComparison: {
      gaussRmsCounts: number | null;
      superGaussRmsCounts: number | null;
      relativeRmsReduction: number | null;
    } | null;
  };
  warnings: SimulationWarning[];
};

function validateRoiGeometry(roi: BackgroundRect, width: number, height: number): void {
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
  if (roi.x0 < 0 || roi.y0 < 0 || roi.x0 + roi.width > width || roi.y0 + roi.height > height) {
    throw new RangeError("ROI is not fully inside the image");
  }
}

// Documented sigma_B reference fallback (Plan v5 section 4): the four border
// strips of the ROI with thickness max(1, round(0.05 * min(roiW, roiH))).
// Overlapping strips are legal (estimateBackgroundNoise deduplicates), and
// strips are clamped to the ROI extent so tiny ROIs stay valid.
function buildRimFrame(roi: BackgroundRect): BackgroundRect[] {
  const thickness = Math.max(1, Math.round(SIGMA_REFERENCE_RIM_FRACTION * Math.min(roi.width, roi.height)));
  const rects: BackgroundRect[] = [];
  rects.push({ x0: roi.x0, y0: roi.y0, width: roi.width, height: thickness });
  const bottomHeight = roi.height - thickness;
  if (bottomHeight > 0) {
    rects.push({ x0: roi.x0, y0: roi.y0 + bottomHeight, width: roi.width, height: thickness });
  }
  const middleHeight = roi.height - 2 * thickness;
  if (middleHeight > 0) {
    const sideWidth = Math.min(thickness, roi.width);
    rects.push({ x0: roi.x0, y0: roi.y0 + thickness, width: sideWidth, height: middleHeight });
    rects.push({ x0: roi.x0 + roi.width - sideWidth, y0: roi.y0 + thickness, width: sideWidth, height: middleHeight });
  }
  return rects;
}

function zeroNoiseEstimate(): BackgroundNoiseEstimate {
  return {
    sigmaCounts: 0,
    medianCounts: 0,
    meanCounts: 0,
    stdCounts: 0,
    madCounts: 0,
    iqrCounts: 0,
    scaleSource: "zero",
    floorCounts: 0,
    floorApplied: false,
    sampleCount: 0,
    scaleCorrection: 1,
  };
}

function invalidMoments(pixelCount: number, reason: ImageMoments["invalidReason"]): ImageMoments {
  return {
    valid: false,
    invalidReason: reason,
    pixelCount,
    finitePixelCount: 0,
    sumCounts: 0,
    absSumCounts: 0,
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
  };
}

function roiMaxFinite(values: Float64Array | number[], width: number, roi: BackgroundRect): number {
  let peak = 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const row = y * width;
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = values[row + x];
      if (Number.isFinite(value) && value > peak) peak = value;
    }
  }
  return peak;
}

// A single Float64Array copy of the confirmed ROI, built once and reused by
// every profile extractor. extractCut / computeProjection / extractAxisProfile
// (profiles.ts) take a corrected-image object with no ROI parameter of their
// own, so without this subframe they read the FULL corrected frame and pixels
// outside the confirmed ROI silently drive the released profile values,
// widths and downstream warnings. Positions and origins are shifted back to
// image space afterwards by shiftProfileToImageSpace.
function buildRoiSubframe(
  values: Float64Array,
  width: number,
  roi: BackgroundRect,
): { values: Float64Array; width: number; height: number } {
  const sub = new Float64Array(roi.width * roi.height);
  for (let y = 0; y < roi.height; y += 1) {
    const srcStart = (roi.y0 + y) * width + roi.x0;
    sub.set(values.subarray(srcStart, srcStart + roi.width), y * roi.width);
  }
  return { values: sub, width: roi.width, height: roi.height };
}

// Honest no-data aperture assessment used only when assessAperture itself
// throws; mirrors the documented no-parameter defaults of aperture.ts. The
// gates mirror carries the S18 self-calibrated fields with their no-data
// defaults too (thresholds exactly the 3 floor, zero MC count, EVT arm
// computed from the ROI pixel count like evaluateMultiPeakGate).
//
// S20 stage F (I-8 / R-25) - DELIBERATE, not an oversight: the two ceilings
// below keep the RAW peak formulas even though assessAperture now references
// them against a stage-B, outlier-robust peak. This path is reached only when
// assessAperture THREW, i.e. when there is no fit result to read a background
// or a sigma from; ceilingPeak's own null-params branch makes exactly the same
// choice for the same reason. Both numbers are informational here - the gates
// they belong to report no-data defaults (residual high false, zero peaks,
// suppression fit_not_converged), so nothing is gated on them. The same
// null-params rule is pinned on the reachable public surface in
// tests/unit/image-aperture.test.ts ("S20 stage F: the null-params path keeps
// the raw peak formulas") so the intent cannot be silently "fixed" into a
// divide-by-null.
function fallbackAperture(
  alpha: number,
  sigmaCounts: number,
  peakCorr: number,
  roi: BackgroundRect,
): ApertureAssessment {
  const scannedPixelCount = roi.width * roi.height;
  return {
    moments: null,
    suppressionReason: "fit_not_converged",
    fitWidths: null,
    gates: {
      fitConverged: false,
      amplitudePositive: true,
      residual: {
        rmsCounts: 0,
        // RAW peak by design (see the header note above).
        maxAllowedCounts: Math.max(2 * sigmaCounts, 0.005 * peakCorr),
        high: false,
      },
      clipping: { checkEllipseInside: true },
      alphaConsistency: {
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
      },
      multiPeak: {
        significantPeakCount: 0,
        detected: false,
        thresholdCounts: 0,
        evtThresholdCounts:
          sigmaCounts > 0
            ? sigmaCounts * (Math.sqrt(2 * Math.log(Math.max(2, scannedPixelCount))) + MULTI_PEAK_EVT_MARGIN)
            : 0,
        // RAW peak by design (see the header note above).
        peakFloorCounts: MULTI_PEAK_MIN_PEAK_FRACTION * peakCorr,
        scannedPixelCount,
      },
    },
    pedestal: { meanOutsideRelativeToPeak: null, fittedBackgroundRelativeToPeak: null, hint: false },
    absorbedPower: {
      fittedBackgroundCounts: null,
      roiPixelCount: scannedPixelCount,
      totalPositiveCounts: 0,
      beamPowerCounts: null,
      flatFractionOfBeamPower: null,
      modelPowerCounts: null,
      probeAlpha: null,
      // S20 stage B: no probe was ever tried on this path, so the reach is the
      // empty list - never a claim that all four radii were available.
      availableProbeAlphas: [],
      maxAvailableProbeAlpha: null,
      apertureExcessCounts: null,
      aperturePixelCount: 0,
      apertureExcessFraction: null,
      expectedNoiseFraction: null,
      thresholdFraction: null,
      high: false,
    },
    // S20 stage A: the coverage block's own no-data defaults. Nothing was
    // measured on this path (assessAperture threw before any gate ran), so
    // every number is null and the verdict is false - the honest reading of
    // "not evaluated", never a claim that the aperture was fully covered.
    coverage: {
      aperturePixelCount: 0,
      finitePixelCount: 0,
      finiteFraction: null,
      modelBiasMajorPercent: null,
      modelBiasMinorPercent: null,
      high: false,
    },
    peakToBackgroundNoise: sigmaCounts > 0 && peakCorr > 0 ? peakCorr / sigmaCounts : null,
    alphaUsed: alpha,
  };
}

function gapWidths(): ProfileWidths {
  const gap = {
    widthPx: null,
    leftCrossingPx: null,
    rightCrossingPx: null,
    ambiguous: false,
    suppressedReason: "gap" as const,
  };
  return { peakValueCounts: 0, peakPositionPx: 0, fwhmData: gap, oneOverESquaredData: gap };
}

// Shifts a LineProfile computed on the ROI subframe back to IMAGE space. The
// origin always moves by (roi.x0, roi.y0). A planar profile's positionsPx are
// pixel coordinates along one image axis and move by that axis's ROI offset
// too; an "axis" profile's positionsPx are signed arc-length OFFSETS from its
// own origin, translation-invariant, and are therefore left untouched. This
// must run BEFORE measureProfileWidths (inside profileWithWidths) so
// peakPositionPx / leftCrossingPx / rightCrossingPx are reported in image
// coordinates, not ROI-relative ones.
function shiftProfileToImageSpace(profile: LineProfile, roi: BackgroundRect): LineProfile {
  const originXPx = profile.originXPx + roi.x0;
  const originYPx = profile.originYPx + roi.y0;
  if (profile.kind === "axis") {
    return { ...profile, originXPx, originYPx };
  }
  const axisOffset = profile.kind === "cut-y" || profile.kind === "projection-y" ? roi.y0 : roi.x0;
  const positionsPx = new Float64Array(profile.positionsPx.length);
  for (let i = 0; i < positionsPx.length; i += 1) positionsPx[i] = profile.positionsPx[i] + axisOffset;
  return { ...profile, positionsPx, originXPx, originYPx };
}

function profileWithWidths(profile: LineProfile, sigmaCounts: number): ImagePlanarProfile {
  let widths: ProfileWidths;
  try {
    widths = measureProfileWidths(profile, sigmaCounts);
  } catch {
    widths = gapWidths();
  }
  const result: ImagePlanarProfile = {
    kind: profile.kind,
    positionsPx: Array.from(profile.positionsPx),
    values: Array.from(profile.values),
    widths,
  };
  if (profile.stepUm !== undefined) result.stepUm = profile.stepUm;
  if (profile.contributingCounts !== undefined) result.contributingCounts = Array.from(profile.contributingCounts);
  return result;
}

type StartMomentsOption = {
  centroidXPx: number;
  centroidYPx: number;
  sigmaMajorPx: number;
  sigmaMinorPx: number;
  thetaRad: number;
};

// S20 stage B (C6): why the stage-A plausibility predicate refused, as a
// DISCRIMINATED union rather than a string - each branch carries the numbers
// that produced it, so a consumer can act on the reason without re-deriving
// it. The predicate below is the single source of both this reason and the
// moment-refined fit start, so the two can never drift apart.
export type TierCheckUnavailableReason =
  | {
      // Stage-A moments are unusable as a comparison tier at all: invalid, or
      // valid with a missing / non-finite / non-positive geometry field.
      kind: "stage_a_invalid";
      invalidReason: ImageMoments["invalidReason"];
    }
  | {
      // The stage-A centroid sits outside the confirmed ROI, so the two tiers
      // are not measuring the same beam position.
      kind: "centroid_outside_roi";
      centroidXPx: number;
      centroidYPx: number;
    }
  | {
      // 4 * stage-A sigmaMajor does not fit inside the shorter ROI side: the
      // stage-A moments are truncated by the ROI and a gap against them would
      // measure the truncation, not the beam.
      kind: "sigma_exceeds_roi";
      sigmaMajorPx: number;
      shorterRoiSidePx: number;
    };

// The plausibility predicate itself, reported as its refusal reason (null when
// the stage-A moments ARE usable). Optional moment refinement is only used
// when the stage-A centroid sits inside the ROI and the D4 extent fits in the
// shorter ROI side. A pedestal or leftover plane otherwise produces a "valid"
// full-frame moment start that the LM then reports as converged far outside
// the image (Plan v5: the default start is moment-free). The cross-tier
// disagreement check reuses exactly this predicate, which is why its
// unavailability is reported from here.
function tierCheckUnavailableReason(
  stageA: ImageMoments,
  roi: BackgroundRect,
): TierCheckUnavailableReason | null {
  if (
    !stageA.valid ||
    stageA.centroidXPx === null ||
    stageA.centroidYPx === null ||
    stageA.sigmaMajorPx === null ||
    stageA.sigmaMinorPx === null ||
    stageA.thetaRad === null
  ) {
    return { kind: "stage_a_invalid", invalidReason: stageA.invalidReason };
  }
  const cx = stageA.centroidXPx;
  const cy = stageA.centroidYPx;
  const s1 = stageA.sigmaMajorPx;
  const s2 = stageA.sigmaMinorPx;
  const theta = stageA.thetaRad;
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(s1) ||
    !Number.isFinite(s2) ||
    !Number.isFinite(theta) ||
    !(s1 > 0) ||
    !(s2 > 0)
  ) {
    return { kind: "stage_a_invalid", invalidReason: stageA.invalidReason };
  }
  if (cx < roi.x0 || cx > roi.x0 + roi.width - 1 || cy < roi.y0 || cy > roi.y0 + roi.height - 1) {
    return { kind: "centroid_outside_roi", centroidXPx: cx, centroidYPx: cy };
  }
  if (!(4 * s1 < Math.min(roi.width, roi.height))) {
    return { kind: "sigma_exceeds_roi", sigmaMajorPx: s1, shorterRoiSidePx: Math.min(roi.width, roi.height) };
  }
  return null;
}

function startMomentsIfPlausible(stageA: ImageMoments, roi: BackgroundRect): StartMomentsOption | null {
  if (tierCheckUnavailableReason(stageA, roi) !== null) return null;
  return {
    centroidXPx: stageA.centroidXPx as number,
    centroidYPx: stageA.centroidYPx as number,
    sigmaMajorPx: stageA.sigmaMajorPx as number,
    sigmaMinorPx: stageA.sigmaMinorPx as number,
    thetaRad: stageA.thetaRad as number,
  };
}

// S18-R2 F1 (b): the fourth moments of the confirmed ROI along the beam's own
// principal axes about a beam centre. They are the lever arm that sets how far
// zero-mean noise can move a stage-A rect moment: the second-moment numerator
// picks up sigmaB * sqrt(sum u^4) of noise along an axis. The sums are
// SEPARABLE in the pixel coordinates even after the rotation, so this costs
// O(width + height) instead of O(pixels):
//   u = dx*cos + dy*sin  ->  u^4 = c^4 dx^4 + 4c^3 s dx^3 dy + 6 c^2 s^2 dx^2 dy^2
//                                 + 4 c s^3 dx dy^3 + s^4 dy^4
//   v = -dx*sin + dy*cos ->  the same with c <-> s and the odd terms negated
// and every mixed sum factorises, e.g. sum dx^3 dy = (sum_x dx^3)(sum_y dy).
// Per AXIS rather than a single radial figure: the minor axis carries the same
// absolute noise against a much smaller second moment, so a shared radial
// scale under-states the minor arm (measured: a clean 180x120 sigma 12x8 scene
// at SNR 20 shows a 31.7 percent minor-axis gap that a radial scale calls
// 15.2 percent expected).
function roiAxisFourthMoments(
  roi: BackgroundRect,
  centerXPx: number,
  centerYPx: number,
  thetaRad: number,
): { sumU4: number; sumV4: number } {
  let sx1 = 0;
  let sx2 = 0;
  let sx3 = 0;
  let sx4 = 0;
  for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
    const d = x - centerXPx;
    const d2 = d * d;
    sx1 += d;
    sx2 += d2;
    sx3 += d2 * d;
    sx4 += d2 * d2;
  }
  let sy1 = 0;
  let sy2 = 0;
  let sy3 = 0;
  let sy4 = 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    const d = y - centerYPx;
    const d2 = d * d;
    sy1 += d;
    sy2 += d2;
    sy3 += d2 * d;
    sy4 += d2 * d2;
  }
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  const c2 = c * c;
  const s2 = s * s;
  const dx4 = roi.height * sx4;
  const dy4 = roi.width * sy4;
  const dx3dy = sx3 * sy1;
  const dx2dy2 = sx2 * sy2;
  const dxdy3 = sx1 * sy3;
  const sumU4 =
    c2 * c2 * dx4 + 4 * c2 * c * s * dx3dy + 6 * c2 * s2 * dx2dy2 + 4 * c * s2 * s * dxdy3 + s2 * s2 * dy4;
  const sumV4 =
    s2 * s2 * dx4 - 4 * s2 * s * c * dx3dy + 6 * c2 * s2 * dx2dy2 - 4 * s * c2 * c * dxdy3 + c2 * c2 * dy4;
  return { sumU4: Math.max(0, sumU4), sumV4: Math.max(0, sumV4) };
}

function pointIsInsideImage(x: number, y: number, width: number, height: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= width - 1 && y >= 0 && y <= height - 1;
}

function pointIsInsideRoi(x: number, y: number, roi: BackgroundRect): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= roi.x0 &&
    x <= roi.x0 + roi.width - 1 &&
    y >= roi.y0 &&
    y <= roi.y0 + roi.height - 1
  );
}

// Stage-C release plausibility (revised: S18a ROI-bounding fix). Bound by the
// CONFIRMED ROI, not the full image: a leftover-plane LM can converge with a
// centre that still lands inside the image while sitting outside the ROI it
// was fit against (e.g. a beam only partially covered by a small ROI), and a
// sigma the fit stretched past the ROI's own extent is equally not a
// releasable ROI-relative geometry even when both numbers happen to fit
// inside the larger image. Used for both fits.physical release and the
// IMAGE_FIT_NOT_CONVERGED warning below, so both stay consistent with ROI
// semantics.
function fitGeometryIsReleasable(params: Gauss2dFitParams, roi: BackgroundRect): boolean {
  if (!(params.amplitudeCounts > 0)) return false;
  if (!pointIsInsideRoi(params.centerXPx, params.centerYPx, roi)) return false;
  const maxRoiExtentPx = Math.max(roi.width, roi.height);
  if (
    !Number.isFinite(params.sigmaMajorPx) ||
    !(params.sigmaMajorPx > 0) ||
    !(params.sigmaMajorPx < maxRoiExtentPx)
  ) {
    return false;
  }
  if (
    !Number.isFinite(params.sigmaMinorPx) ||
    !(params.sigmaMinorPx > 0) ||
    !(params.sigmaMinorPx < maxRoiExtentPx)
  ) {
    return false;
  }
  return true;
}

// S20 stage F (F7): orientation contrast on a PHYSICALLY mapped geometry.
//
// moments.ts computes q = (lambdaMajor - lambdaMinor) / (lambdaMajor +
// lambdaMinor) on the PIXEL covariance, which answers "is the major axis of
// this pixel-grid ellipse well separated from the minor one". On an
// anisotropic pixel pitch that is not a question about the beam: a beam that
// is perfectly round in micrometres reads as strongly elliptical in pixels
// whenever the pitches differ, so the orientation angle the analyzer releases
// is pure eigen-noise while the pixel-space contrast reports it as rock solid
// (measured on a 2/4 um pitch: q_px 0.600 against q_phys 2e-5).
//
// The physical mapping already re-diagonalizes the pitch-scaled covariance, so
// q_phys is read straight off its two sigmas. On a square pixel both pitches
// scale the covariance by the same factor and q_phys equals q_px exactly.
function orientationContrastQOf(geometry: PhysicalBeamGeometry | null): number | null {
  if (geometry === null) return null;
  const lambdaMajor = geometry.sigmaMajorUm * geometry.sigmaMajorUm;
  const lambdaMinor = geometry.sigmaMinorUm * geometry.sigmaMinorUm;
  const sum = lambdaMajor + lambdaMinor;
  if (!Number.isFinite(lambdaMajor) || !Number.isFinite(lambdaMinor) || !(sum > 0)) return null;
  return (lambdaMajor - lambdaMinor) / sum;
}

// JSON-result sanitiser: non-finite numbers become null so hostile inputs
// cannot leak NaN/Infinity into released depth fields. Undefined keys are
// dropped to match JSON.stringify. Typed arrays are left untouched (the
// result contract is plain JSON; residual display values are number[]).
function sanitizeJsonNumbersUnknown(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeJsonNumbersUnknown);
  if (typeof value === "object") {
    if (ArrayBuffer.isView(value)) return value;
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      const child = record[key];
      if (child === undefined) continue;
      out[key] = sanitizeJsonNumbersUnknown(child);
    }
    return out;
  }
  return value;
}

export function analyzeImage(input: ImageAnalysisInput): ImageAnalysisResult {
  const validation = validateImageAnalyzerInput(input);
  if (!validation.ok) {
    throw new RangeError(validation.errors.join("; "));
  }

  const width = input.width;
  const height = input.height;
  const fullFrame: BackgroundRect = { x0: 0, y0: 0, width, height };
  // S21 stage A: the ROI input is a rectangle, the "auto" sentinel or absent.
  // A string that is not the sentinel is rejected here rather than being let
  // through to validateRoiGeometry, which would report it as a coordinate
  // problem on an object that is not one.
  const roiInput = input.roi;
  if (typeof roiInput === "string" && roiInput !== "auto") {
    throw new RangeError('roi must be a rectangle or the string "auto"');
  }
  const roiAuto = roiInput === "auto";
  // The CONFIRMED ROI. On the automatic path it starts as the full frame and
  // is replaced below, after the background has been applied and the
  // suggestion has been computed - the same two steps a manual first run takes
  // before the operator can click "apply suggestion".
  let roi: BackgroundRect = roiAuto || roiInput === undefined ? fullFrame : roiInput;
  if (!roiAuto) validateRoiGeometry(roi, width, height);
  const alpha = input.alpha ?? APERTURE_ALPHA_DEFAULT;
  if (!Number.isFinite(alpha) || alpha <= 0) {
    throw new RangeError("alpha must be a finite number > 0");
  }
  const calibration = input.calibration ?? input.calib;

  const rawImage = { pixels: input.pixels, width, height, dtype: input.dtype };
  const raw = computeImageDiagnostics(rawImage, input.config);

  // Background correction: apply the configured model; on any module error
  // (the documented catch site, e.g. degenerate robust-plane geometry) the
  // analysis continues on the none path and records the degenerate warning.
  //
  // S21 stage A: an "auto" request is resolved to its concrete configuration
  // FIRST, so `backgroundConfig` below is an ordinary directly-applicable
  // model and every line after this point is the manual path verbatim.
  const { config: backgroundConfig, autoRects } = resolveBackgroundConfig(
    input.background ?? { method: "none" },
    width,
    height,
  );
  const degenerateWarnings: SimulationWarning[] = [];
  let corrected: Float64Array;
  let backgroundSection: PlainBackgroundSection;
  try {
    const result = applyBackground(rawImage, backgroundConfig);
    corrected = result.corrected;
    backgroundSection = {
      method: result.method,
      negativeCountAfter: result.negativeCountAfter,
      negativeFractionAfter: result.negativeFractionAfter,
      plane: null,
      noise: null,
    };
    backgroundSection.requestedMethod = result.requestedMethod;
    if (result.offsetCounts !== undefined) backgroundSection.offsetCounts = result.offsetCounts;
    if (result.plane !== undefined) backgroundSection.plane = result.plane;
    if (result.noise !== undefined) backgroundSection.noise = result.noise;
    if (result.degradedReason !== undefined) backgroundSection.degradedReason = result.degradedReason;
    if (result.referenceSampleCount !== undefined) backgroundSection.referenceSampleCount = result.referenceSampleCount;
    if (result.referenceTrend !== undefined) backgroundSection.referenceTrend = result.referenceTrend;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    degenerateWarnings.push(
      warning(
        "IMAGE_BACKGROUND_DEGENERATE",
        `Background ${backgroundConfig.method} failed (${message}); analysis continues on the uncorrected (none) data.`,
        "warning",
      ),
    );
    const none = applyBackground(rawImage, { method: "none" });
    corrected = none.corrected;
    backgroundSection = {
      method: "none",
      requestedMethod: backgroundConfig.method,
      plane: null,
      noise: null,
      negativeCountAfter: none.negativeCountAfter,
      negativeFractionAfter: none.negativeFractionAfter,
    };
  }
  const correctedPlainer = { values: corrected, width, height };
  const noiseImage = {
    pixels: corrected as unknown as number[],
    width,
    height,
    dtype: input.dtype,
  };

  // sigma_B reference cascade on the CORRECTED field: user rectangles first,
  // else the documented ROI rim frame; a frame with no finite samples yields
  // the honest zero estimate instead of throwing. Downstream gates (residual
  // 2-sigma, FWHM 3-sigma, multi-peak 4-sigma, PtBN) all live on the
  // corrected domain, so measuring sigma_B on the raw image would leave the
  // subtracted plane inside the noise scale.
  //
  // S20 stage E (C10): when the caller configured a rectangle-based background
  // and gave no separate sigma_B rectangles, the BACKGROUND rectangles are the
  // reference. The workbench has always coupled the two; the API did not, so
  // the same scene analysed through the API fell back to the ROI rim and could
  // report a sigma_B up to 1.9x away from the one the UI showed.
  const configuredSigmaRects =
    input.backgroundSigmaRects !== undefined && input.backgroundSigmaRects.length > 0
      ? input.backgroundSigmaRects
      : (backgroundConfig.method === "rect-median" || backgroundConfig.method === "robust-plane") &&
          backgroundConfig.rects.length > 0
        ? backgroundConfig.rects
        : null;

  // The cascade as a function of the ROI it may have to fall back to. Only the
  // rim-frame arm depends on the ROI at all; the explicit / background-coupled
  // reference does not. S21 stage A needs it twice - once on the full frame to
  // reach the suggestion, once on the confirmed ROI - and calling ONE function
  // twice is what makes the automatic ROI's second stage identical to a manual
  // re-run rather than merely similar to it.
  const measureSigmaB = (
    forRoi: BackgroundRect,
  ): { noise: BackgroundNoiseEstimate; usedRimReference: boolean } => {
    let estimate: BackgroundNoiseEstimate | null = null;
    if (configuredSigmaRects !== null) {
      try {
        estimate = estimateBackgroundNoise(noiseImage, configuredSigmaRects);
      } catch {
        estimate = null;
      }
    }
    // True when the documented ROI rim frame actually supplied sigma_B; the two
    // rim-honesty arms below speak about the rim and must stay silent when an
    // explicit reference was used instead.
    const rimUsed = estimate === null;
    if (estimate === null) {
      try {
        estimate = estimateBackgroundNoise(noiseImage, buildRimFrame(forRoi));
      } catch {
        estimate = zeroNoiseEstimate();
      }
    }

    // S20 stage E (C2): the sigma_B estimate above is measured on the CORRECTED
    // field. When the applied model was a robust plane and the reference resolves
    // to the plane's own reference PIXELS, those samples ARE the fit residuals,
    // so the estimate carries exactly the same deflation the fit's own scale does
    // and takes the same measured correction. The test is over the resolved pixel
    // union rather than over the rectangle list, so an explicit reference that
    // names the same region in another order, with a repeated rectangle or tiled
    // differently is recognised as the same reference and is corrected
    // identically (see backgroundRectsCoverSamePixels).
    //
    // A reference that is merely OVERLAPPING - a subset of the fit rectangles, or
    // partly outside them - is deliberately left alone: those samples carried the
    // fit only in part, so their deflation lies somewhere between zero and the
    // full correction and applying the full one would over-correct.
    if (
      backgroundSection.method === "robust-plane" &&
      !rimUsed &&
      configuredSigmaRects !== null &&
      (backgroundConfig.method === "rect-median" || backgroundConfig.method === "robust-plane") &&
      backgroundRectsCoverSamePixels(configuredSigmaRects, backgroundConfig.rects) &&
      (estimate.scaleSource === "mad" || estimate.scaleSource === "iqr")
    ) {
      const correction = backgroundPlaneScaleCorrection(estimate.sampleCount);
      if (correction > 1) {
        estimate = { ...estimate, sigmaCounts: estimate.sigmaCounts * correction, scaleCorrection: correction };
      }
    }
    return { noise: estimate, usedRimReference: rimUsed };
  };

  const proposeRoi = (sigma: BackgroundNoiseEstimate): SuggestedRoi | null => {
    try {
      return suggestRoi(correctedPlainer, sigma.sigmaCounts, { sigmaScaleSource: sigma.scaleSource });
    } catch {
      return null;
    }
  };

  // S21 stage A: the automatic ROI, which is the manual apply-and-re-run flow
  // collapsed into one call and given the same numbers, not a new proposal
  // rule.
  //
  // The manual flow is two analyses. The first runs on the full frame, and the
  // only thing the operator carries out of it is `roi.suggestion.rect`; the
  // second runs with that rectangle confirmed. Everything the first run
  // computes after the suggestion - the fits, the aperture, the profiles, the
  // warnings - is discarded by the click. So the pre-pass below stops exactly
  // where the suggestion is available: background applied (already done, and
  // ROI-independent), sigma_B measured over the FULL frame, suggestion
  // proposed. That is bit-for-bit what a full first run would have proposed,
  // for less than a full run's work.
  //
  // The consequence worth stating plainly is the TWO-STAGE SIGMA. The
  // suggestion is found under the full-frame sigma_B; the analysis that follows
  // re-measures sigma_B over the CONFIRMED ROI's own reference and uses that
  // one. The two differ whenever the reference is the ROI rim frame, because
  // the rim moves with the ROI. This is not a compromise made here - it is
  // precisely what the manual two-run flow does, and reproducing it is the
  // requirement. (With background rectangles configured, explicitly or by the
  // automatic background method, the reference does not move and the two stages
  // measure the same sigma_B.)
  let roiSource: ImageAnalysisResult["roi"]["source"] = roiAuto
    ? "full-frame"
    : roiInput !== undefined
      ? "input"
      : "full-frame";
  let autoFallbackReason: "no-suggestion" | undefined;
  if (roiAuto) {
    const preRoiSigma = measureSigmaB(fullFrame);
    const preRoiSuggestion = proposeRoi(preRoiSigma.noise);
    if (preRoiSuggestion !== null) {
      roi = preRoiSuggestion.rect;
      roiSource = "auto";
      // suggestRoi clamps its rectangle to the image and never returns an empty
      // one, so this is the same check the confirmed rectangle of a manual
      // re-run passes - kept rather than assumed, because the confirmed ROI is
      // the domain every release gate reads.
      validateRoiGeometry(roi, width, height);
    } else {
      // No component cleared the mask threshold (or the guards refused the
      // proposal outright). The honest answer is the frame the operator would
      // still be looking at: the full one, with the reason recorded.
      autoFallbackReason = "no-suggestion";
    }
  }

  const sigmaMeasurement = measureSigmaB(roi);
  const noise: BackgroundNoiseEstimate = sigmaMeasurement.noise;
  const usedRimReference = sigmaMeasurement.usedRimReference;

  const suggestion: SuggestedRoi | null = proposeRoi(noise);

  // Stage A over the confirmed ROI (diagnostic tier).
  let stageA: ImageMoments;
  try {
    stageA = computeRectMoments(correctedPlainer, roi);
  } catch {
    stageA = invalidMoments(roi.width * roi.height, "nonfinite_aggregate");
  }

  // ROI stability sweep on the statically corrected frame; each variant
  // evaluates stage-A moments and exposes the d4 widths when valid.
  let stability: RoiStabilityReport;
  try {
    stability = runRoiStabilitySweep(roi, width, height, (rect) => {
      try {
        const moments = computeRectMoments(correctedPlainer, rect);
        if (moments.valid && moments.d4SigmaMajorPx !== null && moments.d4SigmaMinorPx !== null) {
          return { d4SigmaMajorPx: moments.d4SigmaMajorPx, d4SigmaMinorPx: moments.d4SigmaMinorPx };
        }
      } catch {
        // Invalid variant.
      }
      return null;
    });
  } catch {
    stability = {
      variants: [],
      sensitivities: null,
      validVariantCount: 0,
      partialSweep: true,
      undeterminable: true,
      fullFrame: roi.x0 === 0 && roi.y0 === 0 && roi.width === width && roi.height === height,
    };
  }

  // Fits: gauss2d always, superGauss2d always (null only on invalid_start).
  // Valid, ROI-plausible stage-A moments may refine the gauss start point.
  const startMoments = startMomentsIfPlausible(stageA, roi);
  let gaussFit: FitResult<Gauss2dFitParams>;
  let superGaussFit: FitResult<SuperGauss2dFitParams> | null = null;
  try {
    gaussFit = fitGauss2d(correctedPlainer, roi, { startMoments });
  } catch {
    gaussFit = {
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
  try {
    const superFit = fitSuperGauss2d(correctedPlainer, roi, { startMoments });
    if (superFit.status !== "invalid_start") superGaussFit = superFit;
  } catch {
    superGaussFit = null;
  }

  // Stage B: aperture-gated moments. A throw here is contained by the same
  // documented no-data defaults aperture.ts uses.
  const peak = roiMaxFinite(corrected, width, roi);
  if (
    usedRimReference &&
    (noise.scaleSource === "mad" || noise.scaleSource === "iqr") &&
    peak > 0 &&
    Number.isFinite(noise.medianCounts) &&
    noise.medianCounts > 0.2 * peak
  ) {
    degenerateWarnings.push(
      warning(
        "IMAGE_NOISE_SCALE_SUSPECT",
        `The ROI rim used for sigma_B is beam-contaminated (rim median ${noise.medianCounts.toFixed(3)} counts is ${((100 * noise.medianCounts) / peak).toFixed(1)} percent of the ROI peak); the noise scale may be inflated.`,
        "warning",
      ),
    );
  }
  // Compact-ROI honesty arm: a confirmed ROI whose shorter side is smaller
  // than 6 times the fitted minor sigma cannot host the documented sigma_B
  // ROI rim frame without the beam's own flanks feeding the noise reference
  // (measured calibration: 5-sigma sides are 2.7x contaminated, 7.5-sigma
  // sides are honest at 1.03x). It fires only when the rim frame ACTUALLY
  // supplied sigma_B - an explicit reference always wins, and since S20 stage
  // E (C10) a rectangle-based background model supplies one implicitly. The
  // rim-median > 0.2*peak arm above stays unchanged; the same
  // IMAGE_NOISE_SCALE_SUSPECT code is never emitted twice.
  if (
    usedRimReference &&
    gaussFit.status === "converged" &&
    gaussFit.params !== null &&
    gaussFit.params.amplitudeCounts > 0 &&
    Number.isFinite(gaussFit.params.sigmaMinorPx) &&
    gaussFit.params.sigmaMinorPx > 0 &&
    Math.min(roi.width, roi.height) < 6 * gaussFit.params.sigmaMinorPx &&
    !degenerateWarnings.some((item) => item.code === "IMAGE_NOISE_SCALE_SUSPECT")
  ) {
    degenerateWarnings.push(
      warning(
        "IMAGE_NOISE_SCALE_SUSPECT",
        `The confirmed ROI (${roi.width}x${roi.height} px) is smaller than 6 times the fitted minor sigma (${gaussFit.params.sigmaMinorPx.toFixed(2)} px) and is too small for an uncontaminated rim noise reference; user background rectangles are recommended.`,
        "warning",
      ),
    );
  }
  let aperture: ApertureAssessment;
  try {
    aperture = assessAperture(correctedPlainer, roi, gaussFit, noise.sigmaCounts, { alpha });
  } catch {
    aperture = fallbackAperture(alpha, noise.sigmaCounts, peak, roi);
  }

  // Centre cascade for the profile cuts, the radial distribution and the
  // symmetry metrics: released stage-B centroid, else a fit centre that
  // actually lies inside the image, else the discrete corrected-RoI peak.
  // A leftover-plane LM can report params far outside the frame (and even
  // status "converged"); extractCut/extractAxisProfile then throw, and the
  // metrics module would happily bin around that exterior point. Skip an
  // unusable centre so the peak fallback can run.
  let centerXPx: number | null = null;
  let centerYPx: number | null = null;
  let thetaRad: number | null = null;
  if (
    aperture.moments !== null &&
    aperture.moments.valid &&
    aperture.moments.centroidXPx !== null &&
    aperture.moments.centroidYPx !== null &&
    pointIsInsideImage(aperture.moments.centroidXPx, aperture.moments.centroidYPx, width, height)
  ) {
    centerXPx = aperture.moments.centroidXPx;
    centerYPx = aperture.moments.centroidYPx;
    thetaRad = aperture.moments.thetaRad;
  } else if (
    gaussFit.params !== null &&
    pointIsInsideImage(gaussFit.params.centerXPx, gaussFit.params.centerYPx, width, height)
  ) {
    centerXPx = gaussFit.params.centerXPx;
    centerYPx = gaussFit.params.centerYPx;
    thetaRad = gaussFit.params.thetaRad;
  } else {
    let peakX = -1;
    let peakY = -1;
    let peakValue = Number.NEGATIVE_INFINITY;
    for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
      const row = y * width;
      for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
        const value = corrected[row + x];
        if (!Number.isFinite(value)) continue;
        if (value > peakValue || (value === peakValue && (y < peakY || (y === peakY && x < peakX)))) {
          peakValue = value;
          peakX = x;
          peakY = y;
        }
      }
    }
    if (peakX >= 0) {
      centerXPx = peakX;
      centerYPx = peakY;
    }
  }

  // The profile lane is bounded to the confirmed ROI (revised: S18a
  // ROI-bounding fix): built once and reused by all six profiles below.
  const roiSubframe = buildRoiSubframe(corrected, width, roi);

  const tryProfile = (build: () => LineProfile, sigmaCounts: number): ImagePlanarProfile | null => {
    try {
      const inImageSpace = shiftProfileToImageSpace(build(), roi);
      return profileWithWidths(inImageSpace, sigmaCounts);
    } catch {
      return null;
    }
  };

  // M-3 wiring: cut/axis widths use sigma_B directly; projection widths use
  // sigma_B * sqrt(max contributingCount), the documented conservative choice
  // for summed profiles with uncorrelated per-pixel noise. contributingCounts
  // is read from the ROI subframe, so a pixel outside the ROI can no longer
  // inflate the projection sum, its contributing count, or the noise scale
  // derived from it - the point of the ROI bound.
  const projectionProfile = (axis: "x" | "y"): ImagePlanarProfile | null => {
    try {
      const profile = computeProjection(roiSubframe, axis, calibration);
      let maxContributing = 0;
      if (profile.contributingCounts !== undefined) {
        for (let i = 0; i < profile.contributingCounts.length; i += 1) {
          if (profile.contributingCounts[i] > maxContributing) maxContributing = profile.contributingCounts[i];
        }
      }
      const inImageSpace = shiftProfileToImageSpace(profile, roi);
      return profileWithWidths(inImageSpace, noise.sigmaCounts * Math.sqrt(maxContributing));
    } catch {
      return null;
    }
  };

  const cutX =
    centerXPx === null || centerYPx === null
      ? null
      : tryProfile(
          () => extractCut(roiSubframe, "x", centerXPx - roi.x0, centerYPx - roi.y0, calibration),
          noise.sigmaCounts,
        );
  const cutY =
    centerXPx === null || centerYPx === null
      ? null
      : tryProfile(
          () => extractCut(roiSubframe, "y", centerXPx - roi.x0, centerYPx - roi.y0, calibration),
          noise.sigmaCounts,
        );
  const projectionX = projectionProfile("x");
  const projectionY = projectionProfile("y");
  const axisMajor =
    centerXPx === null || centerYPx === null || thetaRad === null
      ? null
      : tryProfile(
          () => extractAxisProfile(roiSubframe, centerXPx - roi.x0, centerYPx - roi.y0, thetaRad, calibration),
          noise.sigmaCounts,
        );
  const axisMinor =
    centerXPx === null || centerYPx === null || thetaRad === null
      ? null
      : tryProfile(
          () =>
            extractAxisProfile(
              roiSubframe,
              centerXPx - roi.x0,
              centerYPx - roi.y0,
              thetaRad + Math.PI / 2,
              calibration,
            ),
          noise.sigmaCounts,
        );

  // Metrics.
  const releasedMoments = aperture.moments;
  const ellipticity =
    releasedMoments !== null && releasedMoments.valid && releasedMoments.sigmaMajorPx !== null && releasedMoments.sigmaMinorPx !== null
      ? computeEllipticity(releasedMoments.sigmaMajorPx, releasedMoments.sigmaMinorPx)
      : null;

  let radialDist: RadialDistribution | null = null;
  let radialPlain: PlainRadialDistribution | null = null;
  if (centerXPx !== null && centerYPx !== null) {
    try {
      radialDist = computeRadialDistribution(correctedPlainer, roi, centerXPx, centerYPx);
      if (radialDist !== null) {
        radialPlain = {
          centerXPx: radialDist.centerXPx,
          centerYPx: radialDist.centerYPx,
          radiiPx: Array.from(radialDist.radiiPx),
          enclosedFraction: Array.from(radialDist.enclosedFraction),
          totalPositiveCounts: radialDist.totalPositiveCounts,
          negativePowerRatio: radialDist.negativePowerRatio,
        };
      }
    } catch {
      radialDist = null;
      radialPlain = null;
    }
  }

  const encircledFractions = [0.5, 0.8, 0.95];
  const encircledPowerRadiiPx = encircledFractions.map((fraction) => {
    let radiusPx: number | null = null;
    if (radialDist !== null) {
      try {
        radiusPx = encircledPowerRadiusPx(radialDist, fraction);
      } catch {
        radiusPx = null;
      }
    }
    return { fraction, radiusPx };
  });

  let symmetry: SymmetryErrors | null = null;
  if (centerXPx !== null && centerYPx !== null) {
    try {
      symmetry = computeSymmetryErrors(correctedPlainer, roi, centerXPx, centerYPx);
    } catch {
      symmetry = null;
    }
  }

  let modelComparison: {
    gaussRmsCounts: number | null;
    superGaussRmsCounts: number | null;
    relativeRmsReduction: number | null;
  } | null = null;
  if (gaussFit.params !== null && superGaussFit !== null) {
    try {
      modelComparison = compareModelResiduals(correctedPlainer, roi, gaussFit, superGaussFit);
    } catch {
      modelComparison = null;
    }
  }

  let residuals: ImageAnalysisResult["residuals"] = null;
  if (gaussFit.params !== null) {
    try {
      const residualOutput = computeResidualOutput(correctedPlainer, roi, gaussFit.params);
      residuals = {
        rmsCounts: residualOutput.rmsCounts,
        maxAbsCounts: residualOutput.maxAbsCounts,
        display: {
          width: residualOutput.display.width,
          height: residualOutput.display.height,
          blockSizePx: residualOutput.display.blockSizePx,
          values: Array.from(residualOutput.display.values),
        },
      };
    } catch {
      residuals = null;
    }
  }

  // A leftover-plane LM can report status "converged" with a centre thousands
  // of pixels off the sensor. Physical geometry is withheld above; the
  // IMAGE_FIT_NOT_CONVERGED channel still has to fire because warnings.ts
  // only looks at the LM status string.
  if (
    gaussFit.status === "converged" &&
    gaussFit.params !== null &&
    !fitGeometryIsReleasable(gaussFit.params, roi)
  ) {
    degenerateWarnings.push(
      warning(
        "IMAGE_FIT_NOT_CONVERGED",
        `The 2D Gaussian fit did not converge to a releasable in-image geometry (centre ${gaussFit.params.centerXPx.toFixed(1)}, ${gaussFit.params.centerYPx.toFixed(1)} px).`,
        "warning",
      ),
    );
  }

  let physical: PhysicalBeamGeometry | undefined;
  if (
    calibration !== undefined &&
    gaussFit.status === "converged" &&
    gaussFit.params !== null &&
    fitGeometryIsReleasable(gaussFit.params, roi)
  ) {
    try {
      physical = mapGauss2dToPhysical(gaussFit.params, calibration);
    } catch {
      physical = undefined;
    }
  }

  let physicalMoments: PhysicalBeamGeometry | null | undefined;
  if (calibration !== undefined) {
    try {
      physicalMoments =
        releasedMoments !== null && releasedMoments.valid
          ? mapMomentsToPhysical(releasedMoments, calibration)
          : null;
    } catch {
      physicalMoments = null;
    }
  }

  // S20 stage F (F7): the same covariance mapping applied to the DIAGNOSTIC
  // tier, so the orientation warning can quote a physical contrast on either
  // tier it speaks about. Undefined without a calibration - the pixel path is
  // then unchanged in both directions.
  let physicalStageAMoments: PhysicalBeamGeometry | null | undefined;
  if (calibration !== undefined) {
    try {
      physicalStageAMoments = stageA.valid ? mapMomentsToPhysical(stageA, calibration) : null;
    } catch {
      physicalStageAMoments = null;
    }
  }
  const orientationQPhysicalStageB =
    physicalMoments === undefined ? undefined : orientationContrastQOf(physicalMoments);
  const orientationQPhysicalStageA =
    physicalStageAMoments === undefined ? undefined : orientationContrastQOf(physicalStageAMoments);

  // Physical ellipticity from the RELEASED stage-B physical geometry above
  // (sigmaMajorUm/sigmaMinorUm; d4 would give the identical ratio since both
  // are the same sigma pair scaled by 4 - metrics.ts computePhysicalEllipticity
  // handles the non-finite/degenerate cases and returns null there itself).
  // Undefined physicalMoments (no calibration) and null physicalMoments (no
  // release, or mapMomentsToPhysical failure) both fall through to null.
  const ellipticityPhysical =
    physicalMoments !== undefined && physicalMoments !== null
      ? computePhysicalEllipticity(physicalMoments.sigmaMajorUm, physicalMoments.sigmaMinorUm)
      : null;

  const profileList: ImagePlanarProfile[] = [cutX, cutY, projectionX, projectionY, axisMajor, axisMinor].filter(
    (profile): profile is ImagePlanarProfile => profile !== null,
  );

  // --- S18-R2 final-review honesty instruments (spec section 11) ----------
  //
  // All three speak ONLY about a RELEASED stage-B number: on a suppressed
  // frame IMAGE_APERTURE_SUPPRESSED already names the reason and nothing was
  // released to be wrong about. None of them suppresses anything - they exist
  // so a wrong release can never be a SILENT one.
  const honestyWarnings: SimulationWarning[] = [];
  const releasedStageB =
    releasedMoments !== null &&
    releasedMoments.valid &&
    releasedMoments.d4SigmaMajorPx !== null &&
    releasedMoments.d4SigmaMinorPx !== null &&
    releasedMoments.d4SigmaMajorPx > 0 &&
    releasedMoments.d4SigmaMinorPx > 0
      ? releasedMoments
      : null;

  // F1 (a) absorbed-power wing detector (measured in aperture.ts).
  const absorbed = aperture.absorbedPower;
  if (releasedStageB !== null && absorbed.high && absorbed.apertureExcessFraction !== null) {
    honestyWarnings.push(
      warning(
        "IMAGE_ABSORBED_POWER",
        `The measured power inside the aperture exceeds the fitted beam model by ${(100 * absorbed.apertureExcessFraction).toFixed(2)} percent of the model power, above the ${(100 * (absorbed.thresholdFraction ?? 0)).toFixed(2)} percent this image's noise explains (fitted background ${absorbed.fittedBackgroundCounts === null ? "n/a" : absorbed.fittedBackgroundCounts.toPrecision(3)} counts over ${absorbed.roiPixelCount} ROI pixels). A faint wide wing absorbed into the flat background biases the released widths downward; review the background correction and the ROI.`,
        "warning",
      ),
    );
  }

  // S20 stage B (V6b, arm 1): how far the wing probes actually reached. The
  // detector drops any probe whose ellipse leaves the ROI, and it drops it
  // silently - so on a tight ROI the two long-reach radii simply vanish and
  // the reported excess is the one the innermost radii could still see. This
  // says so, on released frames only (a suppressed frame has no released width
  // for the reach to be a caveat on).
  const probeReach = absorbed.availableProbeAlphas;
  const longProbesLost = !probeReach.includes(9) && !probeReach.includes(12);
  if (releasedStageB !== null && absorbed.probeAlpha !== null && longProbesLost) {
    honestyWarnings.push(
      warning(
        "IMAGE_WING_PROBE_REDUCED",
        `The absorbed-power check ran on the ${probeReach.join(" and ")} sigma probe(s) only; the 9 and 12 sigma probes do not fit inside this ROI. A faint wide wing shows up most strongly far from the core, so this frame's measured excess of ${absorbed.apertureExcessFraction === null ? "n/a" : (100 * absorbed.apertureExcessFraction).toFixed(4)} percent of the model power is a lower bound on what a wider ROI would have seen; the detector's reach, not the beam, may be what limits it.`,
        "info",
      ),
    );
  }

  // S20 stage B (V5a): how wide the alpha-consistency window actually was. The
  // ceiling is self-calibrated from this image's own noise and has no upper
  // bound, so on a noisy frame the test can pass while permitting a width
  // error many times larger than any real defect. That is not a wrong release
  // - a tighter ceiling was measured to kill legitimate low-signal-to-noise
  // releases outright - but it must not read as "checked and consistent".
  const alphaGate = aperture.gates.alphaConsistency;
  const widestThresholdPercent = Math.max(alphaGate.thresholdMajorPercent, alphaGate.thresholdMinorPercent);
  if (releasedStageB !== null && widestThresholdPercent > ALPHA_GATE_WEAK_PERCENT) {
    honestyWarnings.push(
      warning(
        "IMAGE_ALPHA_GATE_WEAK",
        `The aperture-consistency test passed against a ceiling of ${alphaGate.thresholdMajorPercent.toFixed(1)} / ${alphaGate.thresholdMinorPercent.toFixed(1)} percent (major / minor), measured at ${alphaGate.deltaMajorPercent === null ? "n/a" : alphaGate.deltaMajorPercent.toFixed(1)} / ${alphaGate.deltaMinorPercent === null ? "n/a" : alphaGate.deltaMinorPercent.toFixed(1)} percent. This image's noise widens that ceiling past the ${ALPHA_GATE_WEAK_PERCENT} percent reporting level, so at this noise level the test had no discriminating power: it did not find the released widths consistent, it could not have found them inconsistent either.`,
        "info",
      ),
    );
  }

  // F1 (b) cross-tier disagreement: the stage-A diagnostic tier and the
  // released stage-B tier measure the same beam over different domains, so a
  // wing the fitted background absorbed shows up as a gap between them. Only
  // evaluated when stage A is itself trustworthy - the SAME plausibility
  // predicate the moment-refined fit start uses (valid, centroid inside the
  // ROI, 4*sigmaMajor smaller than the shorter ROI side).
  //
  // S20 stage B (C6): that predicate's verdict is now reported rather than
  // merely acted on - see the tierCheck block of the result type.
  const tierUnavailableReason = tierCheckUnavailableReason(stageA, roi);
  let tierCheckSection: ImageAnalysisResult["tierCheck"] = {
    evaluated: false,
    unavailableReason: tierUnavailableReason,
    gapMajorPercent: null,
    gapMinorPercent: null,
    thresholdMajorPercent: null,
    thresholdMinorPercent: null,
  };
  if (releasedStageB !== null && tierUnavailableReason === null) {
    const stageAMajor = stageA.d4SigmaMajorPx;
    const stageAMinor = stageA.d4SigmaMinorPx;
    if (stageAMajor !== null && stageAMinor !== null) {
      const releasedMajor = releasedStageB.d4SigmaMajorPx as number;
      const releasedMinor = releasedStageB.d4SigmaMinorPx as number;
      const gapMajorPercent = (100 * Math.abs(stageAMajor - releasedMajor)) / releasedMajor;
      const gapMinorPercent = (100 * Math.abs(stageAMinor - releasedMinor)) / releasedMinor;
      // Analytic PER-AXIS noise scale of the stage-A tier: the second-moment
      // numerator picks up sigmaB * sqrt(sum u^4) of zero-mean noise against a
      // signal of beamPower * sigma_axis^2, and d4 scales as the square root of
      // the second moment (hence 50, not 100).
      const beamPowerCounts = absorbed.beamPowerCounts;
      const sigmaMajorPx = releasedMajor / 4;
      const sigmaMinorPx = releasedMinor / 4;
      const centroidXPx = releasedStageB.centroidXPx;
      const centroidYPx = releasedStageB.centroidYPx;
      const releasedTheta = releasedStageB.thetaRad;
      let expectedMajorPercent = 0;
      let expectedMinorPercent = 0;
      if (
        beamPowerCounts !== null &&
        beamPowerCounts > 0 &&
        noise.sigmaCounts > 0 &&
        centroidXPx !== null &&
        centroidYPx !== null &&
        releasedTheta !== null &&
        Number.isFinite(releasedTheta)
      ) {
        const { sumU4, sumV4 } = roiAxisFourthMoments(roi, centroidXPx, centroidYPx, releasedTheta);
        const major = (50 * noise.sigmaCounts * Math.sqrt(sumU4)) / (beamPowerCounts * sigmaMajorPx * sigmaMajorPx);
        const minor = (50 * noise.sigmaCounts * Math.sqrt(sumV4)) / (beamPowerCounts * sigmaMinorPx * sigmaMinorPx);
        if (Number.isFinite(major) && major > 0) expectedMajorPercent = major;
        if (Number.isFinite(minor) && minor > 0) expectedMinorPercent = minor;
      }
      const thresholdMajorPercent = Math.max(
        TIER_DISAGREEMENT_MIN_PERCENT,
        TIER_DISAGREEMENT_NOISE_K * expectedMajorPercent,
      );
      const thresholdMinorPercent = Math.max(
        TIER_DISAGREEMENT_MIN_PERCENT,
        TIER_DISAGREEMENT_NOISE_K * expectedMinorPercent,
      );
      // S20 stage B (C6): the check ran, so the block reports what it found -
      // including the ordinary case where the two tiers agree, which used to
      // be reported only as the absence of a warning.
      tierCheckSection = {
        evaluated: true,
        unavailableReason: null,
        gapMajorPercent,
        gapMinorPercent,
        thresholdMajorPercent,
        thresholdMinorPercent,
      };
      if (gapMajorPercent > thresholdMajorPercent || gapMinorPercent > thresholdMinorPercent) {
        honestyWarnings.push(
          warning(
            "IMAGE_TIER_DISAGREEMENT",
            `The released aperture widths disagree with the diagnostic ROI moments beyond this image's noise scale: released d4 ${releasedMajor.toFixed(2)} x ${releasedMinor.toFixed(2)} px against ROI-moment d4 ${stageAMajor.toFixed(2)} x ${stageAMinor.toFixed(2)} px (${gapMajorPercent.toFixed(1)} / ${gapMinorPercent.toFixed(1)} percent apart, against ${thresholdMajorPercent.toFixed(1)} / ${thresholdMinorPercent.toFixed(1)} percent this ROI's noise explains). Power outside the aperture is a possible cause; review the background correction and the ROI.`,
            "warning",
          ),
        );
      }
    }
  }

  // S20 stage B (C6): the released frame whose cross-tier check never ran.
  // The stage-A moments carry their own IMAGE_MOMENTS_UNDEFINED notice when
  // they are invalid, but that speaks about the DIAGNOSTIC tier; it says
  // nothing about the released number, which goes out unchecked by the one
  // instrument that compares two independent measurement domains. Measured on
  // a residual-ramp scene: at ramp slope 1 the check runs and disagrees, at
  // slope 2 and 5 the stage-A covariance turns indefinite and the check simply
  // disappears while the release continues (released major bias -0.21 and
  // -0.49 percent, centroid drift +0.23 and +0.57 px).
  if (releasedStageB !== null && tierCheckSection.unavailableReason !== null) {
    const reason = tierCheckSection.unavailableReason;
    const detail =
      reason.kind === "stage_a_invalid"
        ? `the diagnostic ROI moments are not usable as a comparison tier (${reason.invalidReason ?? "unknown reason"})`
        : reason.kind === "centroid_outside_roi"
          ? `the diagnostic ROI centroid (${reason.centroidXPx.toFixed(2)}, ${reason.centroidYPx.toFixed(2)} px) sits outside the confirmed ROI`
          : `four times the diagnostic major sigma (${(4 * reason.sigmaMajorPx).toFixed(2)} px) does not fit inside the shorter ROI side (${reason.shorterRoiSidePx} px)`;
    honestyWarnings.push(
      warning(
        "IMAGE_TIER_CHECK_UNAVAILABLE",
        `The cross-tier comparison of the released widths could not be evaluated on this frame: ${detail}. The released widths are therefore unchecked against the diagnostic tier - not checked and found to agree.`,
        "info",
      ),
    );
  }

  // F2 per-image noise scatter of the released widths.
  const scatterMajor = aperture.gates.alphaConsistency.d4ScatterMajorPercent;
  const scatterMinor = aperture.gates.alphaConsistency.d4ScatterMinorPercent;
  if (
    releasedStageB !== null &&
    ((scatterMajor !== null && scatterMajor > WIDTH_SCATTER_WARNING_PERCENT) ||
      (scatterMinor !== null && scatterMinor > WIDTH_SCATTER_WARNING_PERCENT))
  ) {
    honestyWarnings.push(
      warning(
        "IMAGE_WIDTH_SCATTER",
        `The released widths carry a per-image noise scatter of ${scatterMajor === null ? "n/a" : scatterMajor.toFixed(1)} / ${scatterMinor === null ? "n/a" : scatterMinor.toFixed(1)} percent (major / minor), above the ${WIDTH_SCATTER_WARNING_PERCENT} percent reporting threshold; a single frame does not pin these widths to better than that.`,
        "warning",
      ),
    );
  }

  const imageWarnings = computeImageWarnings({
    diagnostics: raw,
    noise,
    background: {
      method: backgroundSection.method,
      // S21 stage A: the warning layer speaks about the background MODEL that
      // was attempted, so it is given the RESOLVED method - "robust-plane" on
      // the automatic path, never the "auto" sentinel. Naming the model is what
      // makes the degradation notice actionable ("a plane needs more samples
      // than this reference has"), and it keeps an automatic run's warning
      // layer byte-identical to the manual run with the same rectangles, which
      // is the equality oracle this stage rests on. The "auto" provenance is
      // carried by background.requestedMethod / resolvedMethod / resolvedRects
      // instead.
      requestedMethod: backgroundConfig.method,
      degradedReason: backgroundSection.degradedReason,
      referenceSampleCount: backgroundSection.referenceSampleCount,
      referenceTrend: backgroundSection.referenceTrend,
    },
    stability,
    aperture,
    momentsRoiDiagnostic: { moments: stageA, predicateValid: stageA.valid, invalidReason: stageA.invalidReason },
    // S20 stage F (F7): present only when a calibration exists. Without it the
    // orientation warning keeps its pixel-space path byte for byte.
    ...(calibration === undefined
      ? {}
      : {
          orientationContrastQPhysical: {
            stageB: orientationQPhysicalStageB ?? null,
            stageA: orientationQPhysicalStageA ?? null,
          },
        }),
    suggestion: suggestion === null ? null : { suspectNoiseDominated: suggestion.suspectNoiseDominated },
    profiles: profileList,
    roiPixelCount: roi.width * roi.height,
    radialDistribution: radialPlain,
    gauss2dFit: { status: gaussFit.status },
  });

  // S20 stage F (R-58): the ROI-relative geometry verdict, exported as data.
  // Computed from the SAME module-private predicate the release branches above
  // use, so the field and the behaviour can never drift apart.
  const geometryReleasable = gaussFit.params !== null && fitGeometryIsReleasable(gaussFit.params, roi);

  const fits = {
    gauss2d: { ...gaussFit, geometryReleasable },
    superGauss2d: superGaussFit,
    fitWidths: aperture.fitWidths,
  } as {
    gauss2d: FitResult<Gauss2dFitParams> & { geometryReleasable: boolean };
    superGauss2d: FitResult<SuperGauss2dFitParams> | null;
    fitWidths: ApertureAssessment["fitWidths"];
    physical?: PhysicalBeamGeometry;
  };
  if (physical !== undefined) fits.physical = physical;

  const momentsSection = {
    stageB: releasedMoments,
    suppressionReason: aperture.suppressionReason,
  } as {
    stageB: ImageMoments | null;
    suppressionReason: ApertureSuppressionReason | null;
    physical?: PhysicalBeamGeometry | null;
    orientationContrastQPhysical?: number | null;
  };
  if (physicalMoments !== undefined) momentsSection.physical = physicalMoments;
  if (orientationQPhysicalStageB !== undefined) {
    momentsSection.orientationContrastQPhysical = orientationQPhysicalStageB;
  }

  // S21 stage A: the automatic background method's provenance, appended after
  // the section is otherwise complete so the key order of every other run is
  // untouched. On any non-automatic path autoRects is null and not one key
  // below is written.
  if (autoRects !== null) {
    backgroundSection.requestedMethod = "auto";
    backgroundSection.resolvedMethod = backgroundSection.method;
    backgroundSection.resolvedRects = autoRects;
  }

  const result: ImageAnalysisResult = {
    raw,
    background: backgroundSection,
    noise,
    roi: {
      rect: roi,
      source: roiSource,
      // Present only on an automatic ROI that produced nothing to confirm;
      // sanitizeJsonNumbersUnknown drops the undefined key otherwise, so the
      // exported object of every other run keeps its exact shape and order.
      ...(autoFallbackReason === undefined ? {} : { autoFallbackReason }),
      suggestion,
    },
    stability,
    momentsRoiDiagnostic: {
      moments: stageA,
      predicateValid: stageA.valid,
      invalidReason: stageA.invalidReason,
      ...(orientationQPhysicalStageA === undefined
        ? {}
        : { orientationContrastQPhysical: orientationQPhysicalStageA }),
    },
    fits,
    moments: momentsSection,
    aperture: {
      gates: aperture.gates,
      pedestal: aperture.pedestal,
      absorbedPower: aperture.absorbedPower,
      coverage: aperture.coverage,
      peakToBackgroundNoise: aperture.peakToBackgroundNoise,
      alphaUsed: aperture.alphaUsed,
    },
    tierCheck: tierCheckSection,
    residuals,
    profiles: { cutX, cutY, projectionX, projectionY, axisMajor, axisMinor },
    metrics: {
      ellipticity,
      ellipticityPhysical,
      radialDistribution: radialPlain,
      encircledPowerRadiiPx,
      symmetry,
      modelComparison,
    },
    warnings: [...degenerateWarnings, ...imageWarnings, ...honestyWarnings],
  };
  return sanitizeJsonNumbersUnknown(result) as ImageAnalysisResult;
}
