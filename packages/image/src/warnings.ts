import { type SimulationWarning, warning } from "../../core/src/index.ts";
import type { ImageMoments } from "./moments.ts";
import type { ApertureAssessment } from "./aperture.ts";
import type { RoiStabilityReport } from "./stability.ts";
import type { ImageDiagnostics } from "./diagnostics.ts";
import type { BackgroundNoiseEstimate, BackgroundReferenceTrend } from "./background.ts";
import {
  AXIS_RESOLUTION_MIN_SIGMA_PX,
  BACKGROUND_GRADIENT_TREND_K,
  BACKGROUND_MIN_REFERENCE_SAMPLES,
  COVERAGE_BIAS_MAX_PERCENT,
  COVERAGE_LOSS_INFO_PERCENT,
  HOT_PIXELS_INFO_FRACTION,
  HOT_PIXELS_WARNING_FRACTION,
  NEGATIVE_POWER_INFO_RATIO,
  NEGATIVE_POWER_NULL_MARGIN,
  ORIENTATION_UNSTABLE_Q_MAX,
  RADIAL_NOISE_DOMINATED_RATIO,
  ROI_SENSITIVE_NOISE_K,
  ROI_SENSITIVE_WARNING_PERCENT,
  WIDTH_RESOLUTION_INFO_SIGMA_PX,
} from "./thresholds.ts";

// Pure warning computation over the sections computed by analyzeImage (S18e,
// Plan v5 section 7). Every IMAGE_* trigger in the plan lives here with the
// documented severity; the messages are English, honest and carry only the
// numbers the trigger measured - no standards vocabulary anywhere.
//
// S18 gate-calibration spec section 4 (warning recalibration):
// - IMAGE_NEGATIVE_POWER fires iff negativePowerRatio exceeds
//   max(NEGATIVE_POWER_INFO_RATIO, NEGATIVE_POWER_NULL_MARGIN * expectedRatio)
//   with expectedRatio = (roiPixelCount * sigmaB) /
//   (sqrt(2*PI) * totalPositiveCounts). When totalPositiveCounts is missing,
//   non-positive or non-finite (or the ROI pixel count / sigmaB arm cannot be
//   formed), the adaptive arm is skipped and the 0.02 floor alone applies -
//   which still catches a systematic pedestal at sigmaB = 0.
// - IMAGE_ROI_SENSITIVE (revision 9.1) warns on the MAJOR axis
//   d4SigmaMajorPx half-spread only, with an adaptive noise floor of
//   ROI_SENSITIVE_NOISE_K * 100 / peakToBackgroundNoise when the noise scale
//   is available; the minor axis is noise-dominated and no longer warns. On
//   a NON-full-frame base ROI an excess is WARNING severity. On a FULL-FRAME
//   base ROI the sweep is ROI-dependent by construction and
//   IMAGE_ROI_UNDETERMINABLE does NOT cover it (a healthy full-frame sweep
//   yields exactly 3 valid variants), so the same excess is emitted at INFO
//   severity stating the width is ROI-dependent by construction and a
//   beam-tight ROI should be confirmed.

export type ImageProfileWidths = {
  peakValueCounts: number;
  peakPositionPx: number;
  fwhmData: {
    widthPx: number | null;
    leftCrossingPx: number | null;
    rightCrossingPx: number | null;
    ambiguous: boolean;
    suppressedReason: "low-signal" | "nonpositive-peak" | "gap" | null;
  };
  oneOverESquaredData: {
    widthPx: number | null;
    leftCrossingPx: number | null;
    rightCrossingPx: number | null;
    ambiguous: boolean;
    suppressedReason: "low-signal" | "nonpositive-peak" | "gap" | null;
  };
};

export type ImageProfileResult = {
  kind: string;
  positionsPx: number[];
  values: number[];
  widths: ImageProfileWidths;
};

export type ImageWarningsParts = {
  diagnostics: ImageDiagnostics;
  noise: BackgroundNoiseEstimate;
  // S20 stage E: the applied background model and what its reference looked
  // like. Two warnings read it: the minimum-sample degradation (folded into
  // IMAGE_NOISE_SCALE_SUSPECT so the code is never emitted twice) and the
  // gradient-in-reference notice.
  background: {
    method: string;
    requestedMethod?: string;
    degradedReason?: "insufficient-reference-samples";
    referenceSampleCount?: number;
    referenceTrend?: BackgroundReferenceTrend;
  };
  stability: RoiStabilityReport;
  aperture: ApertureAssessment;
  momentsRoiDiagnostic: { moments: ImageMoments; predicateValid: boolean; invalidReason: ImageMoments["invalidReason"] };
  // S20 stage F (F7): the orientation contrast recomputed on the pitch-scaled
  // covariance, per tier. Present ONLY when the analysis carried a calibration;
  // without one the orientation warning keeps its pixel-space path unchanged.
  // A null entry means the tier had nothing to map (invalid or unreleased).
  orientationContrastQPhysical?: { stageB: number | null; stageA: number | null };
  suggestion: {
    suspectNoiseDominated: boolean;
  } | null;
  profiles: ImageProfileResult[];
  // Confirmed ROI pixel count, plumbed from analyze.ts for the adaptive
  // negative-power null (S18 section 4.1).
  roiPixelCount?: number;
  radialDistribution: {
    negativePowerRatio: number;
    // S18: total positive counts for the adaptive negative-power null; when
    // absent the adaptive arm is skipped (floor-only).
    totalPositiveCounts?: number;
  } | null;
  gauss2dFit: { status: string };
};

// The confirmed ROI pixel count for the adaptive negative-power null.
// The explicit count is always plumbed by analyze.ts; when it is missing,
// non-finite or non-positive, return null and the caller applies the
// documented floor-only arm.
function roiPixelCountOf(parts: ImageWarningsParts): number | null {
  const explicit = parts.roiPixelCount;
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit;
  return null;
}

export function computeImageWarnings(parts: ImageWarningsParts): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];
  const diagnostics = parts.diagnostics;

  if (diagnostics.nonFiniteCount > 0) {
    // The old wording said every downstream statistic "ignores" these pixels,
    // which read as a reassurance where it was a hazard: skipping them means
    // every statistic is computed over whatever support is left, and a
    // structured gap inside the measurement aperture moves the result. The
    // coverage block measures that effect and the release gate acts on it, so
    // this notice now points at it instead of dismissing the question.
    warnings.push(
      warning(
        "IMAGE_FLOAT_SPECIALS",
        `Image data contains ${diagnostics.nonFiniteCount} non-finite pixel value(s). They are skipped by every accumulation, so each statistic is computed over the pixels that remain; where they fall inside the measurement aperture the released widths shift with them. The aperture coverage check reports by how much.`,
        "warning",
      ),
    );
  }

  if (diagnostics.finiteCount > 0) {
    const hotFraction = diagnostics.hotPixelCandidateCount / diagnostics.finiteCount;
    if (hotFraction > HOT_PIXELS_WARNING_FRACTION) {
      warnings.push(
        warning(
          "IMAGE_HOT_PIXELS",
          `${diagnostics.hotPixelCandidateCount} hot-pixel candidate(s) (${(100 * hotFraction).toFixed(3)} percent of finite pixels) exceed the warning fraction ${HOT_PIXELS_WARNING_FRACTION * 100} percent.`,
          "warning",
        ),
      );
    } else if (hotFraction > HOT_PIXELS_INFO_FRACTION) {
      warnings.push(
        warning(
          "IMAGE_HOT_PIXELS",
          `${diagnostics.hotPixelCandidateCount} hot-pixel candidate(s) (${(100 * hotFraction).toFixed(3)} percent of finite pixels) exceed the info fraction ${HOT_PIXELS_INFO_FRACTION * 100} percent.`,
          "info",
        ),
      );
    }
  }

  if (diagnostics.saturatedFraction > 0) {
    warnings.push(
      warning(
        "IMAGE_SATURATION",
        `${(100 * diagnostics.saturatedFraction).toFixed(3)} percent of finite pixels are at or above the saturation limit.`,
        "warning",
      ),
    );
  }

  // IMAGE_CLIPPING_SUSPECT (S18 review G6): a sensor that clips below its
  // dtype's full range (e.g. a 12-bit sensor's 4095 ceiling stored in
  // uint16, limit 65535) never trips the saturatedFraction check above,
  // which only compares against the dtype limit. diagnostics.clippingSuspect
  // already applies the disjointness guard (maximum below
  // CLIPPING_MAX_LIMIT_FRACTION of the dtype limit), so a properly
  // saturated-at-the-limit scene never carries both codes.
  if (diagnostics.clippingSuspect) {
    const fraction = diagnostics.finiteCount > 0 ? (100 * diagnostics.maxValueCount) / diagnostics.finiteCount : 0;
    warnings.push(
      warning(
        "IMAGE_CLIPPING_SUSPECT",
        `${diagnostics.maxValueCount} finite pixels (${fraction.toFixed(3)} percent) sit exactly at the frame maximum (${diagnostics.maxValue}), well below the dtype saturation limit (${diagnostics.saturationLimitCounts}); many pixels sit exactly at the frame maximum below the dtype limit - possible sensor clipping.`,
        "info",
      ),
    );
  }

  if (diagnostics.edgeTouch) {
    warnings.push(warning("IMAGE_EDGE_TOUCH", "The beam profile reaches the image border; out-of-frame power cannot be excluded.", "warning"));
  }

  // IMAGE_ROI_SENSITIVE (S18 section 4.2, revision 9.1): only the major-axis
  // d4SigmaMajorPx half-spread warns, with an adaptive noise floor of
  // ROI_SENSITIVE_NOISE_K * 100 / peakToBackgroundNoise when the noise scale
  // is available (peakToBackgroundNoise may be null -> floor only). A
  // NON-full-frame base ROI that exceeds the threshold warns at WARNING
  // severity. A FULL-FRAME base ROI is ROI-dependent by construction and
  // IMAGE_ROI_UNDETERMINABLE does NOT cover it (a healthy full-frame sweep
  // yields exactly 3 valid variants and never trips undeterminable), so the
  // same excess is emitted at INFO severity with a message stating the width
  // is ROI-dependent by construction on a full-frame base ROI and a
  // beam-tight ROI should be confirmed.
  const peakToBackgroundNoise = parts.aperture.peakToBackgroundNoise;
  const noiseFloorPercent =
    peakToBackgroundNoise !== null && peakToBackgroundNoise > 0
      ? (ROI_SENSITIVE_NOISE_K * 100) / peakToBackgroundNoise
      : 0;
  const roiSensitiveThreshold = Math.max(ROI_SENSITIVE_WARNING_PERCENT, noiseFloorPercent);
  const majorSensitivity = parts.stability.sensitivities?.find(
    (item) => item.metric === "d4SigmaMajorPx",
  );
  if (majorSensitivity !== undefined && majorSensitivity.halfSpreadPercent > roiSensitiveThreshold) {
    if (parts.stability.fullFrame) {
      warnings.push(
        warning(
          "IMAGE_ROI_SENSITIVE",
          `ROI stability sensitivity exceeds ${roiSensitiveThreshold} percent for: ${majorSensitivity.metric}. The width is ROI-dependent by construction on a full-frame base ROI; a beam-tight ROI should be confirmed.`,
          "info",
        ),
      );
    } else {
      warnings.push(
        warning(
          "IMAGE_ROI_SENSITIVE",
          `ROI stability sensitivity exceeds ${roiSensitiveThreshold} percent for: ${majorSensitivity.metric}.`,
          "warning",
        ),
      );
    }
  }

  if (parts.stability.undeterminable) {
    warnings.push(warning("IMAGE_ROI_UNDETERMINABLE", "The ROI stability sweep could not determine a sensitivity spread.", "info"));
  }

  // S20 stage E (C3/C4, R-47): the minimum-sample regime. A reference smaller
  // than BACKGROUND_MIN_REFERENCE_SAMPLES degrades the METHOD to "none" - no
  // offset and no plane is applied - and that must be said out loud, whatever
  // the sigma_B reference happened to be. It shares this code with the scale
  // arms below so IMAGE_NOISE_SCALE_SUSPECT is still emitted at most once.
  const backgroundDegraded = parts.background.degradedReason === "insufficient-reference-samples";
  if (
    backgroundDegraded ||
    (parts.suggestion !== null && parts.suggestion.suspectNoiseDominated) ||
    parts.noise.scaleSource === "floor" ||
    parts.noise.scaleSource === "zero"
  ) {
    warnings.push(
      warning(
        "IMAGE_NOISE_SCALE_SUSPECT",
        backgroundDegraded
          ? `The background reference carries only ${parts.background.referenceSampleCount ?? 0} finite pixel(s); ${BACKGROUND_MIN_REFERENCE_SAMPLES} are needed for a background model to mean anything, so the requested ${parts.background.requestedMethod ?? "background"} correction was NOT applied and the image is analysed uncorrected. The noise scale (${parts.noise.sigmaCounts.toFixed(4).replace(/\.?0+$/, "")} counts) falls back to the quantization floor and may not separate beam from noise.`
          : `The background noise scale (${parts.noise.sigmaCounts.toFixed(4).replace(/\.?0+$/, "")} counts) rests on ${parts.noise.scaleSource === "mad" || parts.noise.scaleSource === "iqr" ? "a measured robust scale" : parts.noise.scaleSource === "floor" ? "a quantization floor" : "zero"} and may not separate beam from noise.`,
        "warning",
      ),
    );
  }

  // S20 stage E (C5, R-38): the reference tilts across the frame while the
  // applied model subtracts a single number. The statistic is the linear trend
  // through the per-rect medians measured against the uncertainty the in-rect
  // scatter allows (see BACKGROUND_GRADIENT_TREND_K); a common pedestal, a
  // symmetric beam tail and unequal rect sizes all cancel out of it. Without
  // this the failure is silent by construction: the between-rect steps enter
  // the pooled MAD and are reported as NOISE, which relaxes every downstream
  // gate instead of raising anything (measured: 332 counts of "noise" and a
  // 4.2x wider consistency ceiling on a noise-free frame).
  // Only for a rect-median model that was actually APPLIED: a reference too
  // small to be applied at all already carries the degradation notice above,
  // which is the more urgent statement about the same rectangles.
  const referenceTrend = parts.background.referenceTrend;
  if (parts.background.method === "rect-median" && referenceTrend !== undefined && referenceTrend.detected) {
    warnings.push(
      warning(
        "IMAGE_BACKGROUND_GRADIENT_IN_REFERENCE",
        `The background reference rectangles are not at one level: a linear trend of ${referenceTrend.trendCounts.toFixed(1)} counts runs across them, ${referenceTrend.ratio === null ? "n/a" : referenceTrend.ratio.toFixed(1)} times what their own in-rect scatter (${referenceTrend.withinScatterCounts.toFixed(2)} counts) allows and past the ${BACKGROUND_GRADIENT_TREND_K}x reporting level. The single-offset model subtracts one number, so that trend stays in the image and is then measured as background noise: the reported noise scale, the peak-to-noise figure and every gate derived from them are read off deterministic structure rather than off noise. A tilted background is what the plane model is for.`,
        "warning",
      ),
    );
  }

  const stageA = parts.momentsRoiDiagnostic.moments;
  if (!stageA.valid) {
    warnings.push(
      warning(
        "IMAGE_MOMENTS_UNDEFINED",
        `Stage-A ROI moments are invalid (${stageA.invalidReason ?? "unknown reason"}).`,
        "info",
      ),
    );
  }

  const stageBMoments = parts.aperture.moments;
  const suppressionReason = parts.aperture.suppressionReason;
  if (suppressionReason !== null) {
    warnings.push(
      warning(
        "IMAGE_APERTURE_SUPPRESSED",
        `Stage-B aperture moments are suppressed (${suppressionReason}).`,
        "warning",
      ),
    );
  }

  if (parts.aperture.gates.residual.high) {
    warnings.push(warning("IMAGE_RESIDUAL_HIGH", "The Gaussian model residual exceeds the release ceiling.", "warning"));
  }

  if (parts.aperture.gates.multiPeak.detected) {
    warnings.push(
      warning("IMAGE_MULTI_PEAK", `${parts.aperture.gates.multiPeak.significantPeakCount} significant peaks were detected.`, "warning"),
    );
  }

  if (parts.aperture.pedestal.hint) {
    warnings.push(warning("IMAGE_PEDESTAL_HINT", "A background pedestal may bias the reported widths; check the background correction.", "info"));
  }

  // S20 stage A: the sub-threshold arm of the coverage gate. A frame whose
  // aperture carries non-finite pixels but whose measured coverage bias stays
  // under the release ceiling is still released - and then says how large the
  // bias it is carrying actually is, rather than leaving the operator to read
  // the dead-pixel count and guess. Above the ceiling the frame is suppressed
  // instead (reason coverage_insufficient), so the two never both speak.
  const coverage = parts.aperture.coverage;
  if (stageBMoments !== null && stageBMoments.valid && coverage.aperturePixelCount > 0) {
    const biasMajor = coverage.modelBiasMajorPercent;
    const biasMinor = coverage.modelBiasMinorPercent;
    const worst = Math.max(biasMajor === null ? 0 : Math.abs(biasMajor), biasMinor === null ? 0 : Math.abs(biasMinor));
    if (worst > COVERAGE_LOSS_INFO_PERCENT) {
      const dead = coverage.aperturePixelCount - coverage.finitePixelCount;
      warnings.push(
        warning(
          "IMAGE_COVERAGE_LOSS",
          `${dead} of the ${coverage.aperturePixelCount} pixels in the measurement aperture carry no data (${(100 * (coverage.finiteFraction ?? 0)).toFixed(1)} percent covered). Rasterizing the fitted beam over the same gap pattern shifts the widths by ${biasMajor === null ? "n/a" : biasMajor.toFixed(2)} percent on the major axis and ${biasMinor === null ? "n/a" : biasMinor.toFixed(2)} percent on the minor one, which is below the ${COVERAGE_BIAS_MAX_PERCENT} percent release ceiling but not zero; the released widths carry that shift.`,
          "warning",
        ),
      );
    }
  }

  // S20 stage F (F7 / R-26): the orientation-stability test runs on the PHYSICAL
  // contrast whenever a calibration is available, because the pixel-space
  // contrast answers a question about the pixel grid rather than about the beam.
  // On an anisotropic pitch the two diverge completely: a beam that is round in
  // micrometres has a physically meaningless orientation angle while its
  // pixel-space contrast reports the axes as well separated (measured on a
  // 2/4 um pitch: q_px 0.600 against q_phys 2e-5, silent before this change).
  // Without a calibration nothing is available but the pixel contrast, and that
  // path is unchanged. The message names the space it tested and quotes the
  // number it tested, never the other one.
  const qPhysical = parts.orientationContrastQPhysical;
  const orientationTest = (
    tier: "released" | "source",
    pixelQ: number,
    physicalQ: number | null | undefined,
  ): void => {
    const q = physicalQ ?? pixelQ;
    if (!(q < ORIENTATION_UNSTABLE_Q_MAX)) return;
    const label = physicalQ === null || physicalQ === undefined ? "orientation contrast q" : "physical orientation contrast q";
    const subject = tier === "released" ? "The released beam orientation" : "The source beam orientation";
    warnings.push(
      warning(
        "IMAGE_ORIENTATION_UNSTABLE",
        `${subject} is unstable (${label} = ${q.toFixed(4)} < ${ORIENTATION_UNSTABLE_Q_MAX}).`,
        "info",
      ),
    );
  };
  if (stageBMoments !== null && stageBMoments.valid && stageBMoments.orientationContrastQ !== null) {
    orientationTest("released", stageBMoments.orientationContrastQ, qPhysical?.stageB);
  } else if (stageA.valid && stageA.orientationContrastQ !== null) {
    orientationTest("source", stageA.orientationContrastQ, qPhysical?.stageA);
  }

  if (stageBMoments !== null && stageBMoments.valid && stageBMoments.sigmaMinorPx !== null && stageBMoments.sigmaMinorPx < AXIS_RESOLUTION_MIN_SIGMA_PX) {
    warnings.push(
      warning(
        "IMAGE_AXIS_NOT_RESOLVED",
        `The released minor axis (sigma ${stageBMoments.sigmaMinorPx.toFixed(3)} px) is below the ${AXIS_RESOLUTION_MIN_SIGMA_PX} px resolution limit; the minor axis is not resolved.`,
        "warning",
      ),
    );
  }

  // IMAGE_WIDTH_RESOLUTION_LIMIT (S18 review G7): a softer, wider companion
  // to IMAGE_AXIS_NOT_RESOLVED above (1 px, "not resolved at all"). Below
  // WIDTH_RESOLUTION_INFO_SIGMA_PX (3 px) a released width still reads
  // systematically HIGH under pixel-area integration even though it remains
  // formally resolved (measured +1.02 percent at sigma 2, +2.83 percent at
  // sigma 1.2, +4 percent at sigma 1.0 px) - can co-fire with
  // IMAGE_AXIS_NOT_RESOLVED for sigma < 1 since that is a stronger, separate
  // statement (not resolved at all, not merely biased).
  if (
    stageBMoments !== null &&
    stageBMoments.valid &&
    stageBMoments.sigmaMinorPx !== null &&
    stageBMoments.sigmaMinorPx < WIDTH_RESOLUTION_INFO_SIGMA_PX
  ) {
    const sigma = stageBMoments.sigmaMinorPx;
    const biasPercent = 100 / (12 * sigma * sigma);
    warnings.push(
      warning(
        "IMAGE_WIDTH_RESOLUTION_LIMIT",
        `The released minor axis (sigma ${sigma.toFixed(3)} px) is below the ${WIDTH_RESOLUTION_INFO_SIGMA_PX} px width-resolution limit; widths this narrow read systematically high under pixel integration, up to about ${biasPercent.toFixed(2)} percent relative (~1/(12*sigma^2)).`,
        "info",
      ),
    );
  }

  for (const profile of parts.profiles) {
    const fwhm = profile.widths.fwhmData;
    const oneOverE2 = profile.widths.oneOverESquaredData;
    if (fwhm.ambiguous || oneOverE2.ambiguous) {
      warnings.push(
        warning("IMAGE_FWHM_AMBIGUOUS", `The ${profile.kind} profile width is ambiguous (a second lobe touches the threshold).`, "info"),
      );
    }
  }

  if (parts.gauss2dFit.status !== "converged") {
    warnings.push(
      warning("IMAGE_FIT_NOT_CONVERGED", `The 2D Gaussian fit did not converge (status ${parts.gauss2dFit.status}).`, "warning"),
    );
  }

  // IMAGE_NEGATIVE_POWER (S18 section 4.1): a correctly corrected scene MUST
  // show negative power (zero-mean background), so the firing ratio adapts to
  // this image's expected zero-mean null ratio. The adaptive arm runs only
  // when totalPositiveCounts is a positive finite number AND the sigmaB/ROI
  // arm is computable; otherwise the documented 0.02 floor remains.
  const radialDistribution = parts.radialDistribution;
  if (radialDistribution !== null) {
    const totalPositiveCounts = radialDistribution.totalPositiveCounts;
    const roiPixelCount = roiPixelCountOf(parts);
    const sigmaBCounts = parts.noise.sigmaCounts;
    // The expected zero-mean null ratio of |negative| power to positive
    // power for a correctly corrected image of this ROI size / noise scale /
    // signal level. This backs BOTH the IMAGE_NEGATIVE_POWER adaptive
    // ceiling below AND the IMAGE_RADIAL_NOISE_DOMINATED predicate (S18
    // review G3): a large expected ratio means the radial distribution's own
    // positive-power sum is itself substantially noise, which inflates the
    // encircled-power radii (measured: r95 +368 percent high for a sigma-6
    // beam on a 121x121 ROI at SNR 20).
    let expectedRatio: number | null = null;
    if (
      totalPositiveCounts !== undefined &&
      Number.isFinite(totalPositiveCounts) &&
      totalPositiveCounts > 0 &&
      roiPixelCount !== null &&
      Number.isFinite(roiPixelCount) &&
      roiPixelCount > 0 &&
      Number.isFinite(sigmaBCounts) &&
      sigmaBCounts > 0
    ) {
      const ratio = (roiPixelCount * sigmaBCounts) / (Math.sqrt(2 * Math.PI) * totalPositiveCounts);
      if (Number.isFinite(ratio) && ratio > 0) {
        expectedRatio = ratio;
      }
    }
    const adaptiveCeiling = expectedRatio === null ? null : NEGATIVE_POWER_NULL_MARGIN * expectedRatio;
    const negativePowerThreshold = Math.max(NEGATIVE_POWER_INFO_RATIO, adaptiveCeiling ?? 0);
    if (radialDistribution.negativePowerRatio > negativePowerThreshold) {
      warnings.push(
        warning(
          "IMAGE_NEGATIVE_POWER",
          `Negative power is ${(100 * radialDistribution.negativePowerRatio).toFixed(2)} percent of the positive power; review the background correction.`,
          "info",
        ),
      );
    }

    if (expectedRatio !== null && expectedRatio > RADIAL_NOISE_DOMINATED_RATIO) {
      warnings.push(
        warning(
          "IMAGE_RADIAL_NOISE_DOMINATED",
          `The expected background-noise contribution to the radial power sum is ${(100 * expectedRatio).toFixed(1)} percent of the positive power; the radial distribution and encircled-power radii are noise-dominated at this signal-to-noise.`,
          "info",
        ),
      );
    }
  }

  return warnings;
}
