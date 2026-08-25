export type {
  DecodedImage,
  ImageAnalyzerConfig,
  ImageAnalyzerInput,
  ImageCalibration,
  ImageChannel,
  ImageDtype,
  ImagePixelArray,
} from "./contracts.ts";
export { dtypeSaturationLimit, sanitizeMetadataText, validateImageAnalyzerInput } from "./contracts.ts";
export { decodeImageFile } from "./decode.ts";
export type { DecodeOptions } from "./decode.ts";
export { computeImageDiagnostics } from "./diagnostics.ts";
export type { ImageDiagnostics } from "./diagnostics.ts";
export { applyBackground, autoBackgroundCornerRects, estimateBackgroundNoise } from "./background.ts";
export type {
  BackgroundConfig,
  BackgroundImage,
  BackgroundNoiseEstimate,
  BackgroundRect,
  BackgroundResult,
} from "./background.ts";
export {
  computeEllipseMoments,
  computeRectMoments,
  computeSubpixelPeak,
  peakCentroidDistancePx,
} from "./moments.ts";
export type {
  ImageMoments,
  MomentInvalidReason,
  SubpixelPeak,
  SubpixelPeakResult,
} from "./moments.ts";
export { analyzeImage } from "./analyze.ts";
export type {
  ImageAnalysisInput,
  ImageAnalysisResult,
  ImageBackgroundInput,
  ImageRoiInput,
} from "./analyze.ts";
export { computeImageWarnings } from "./warnings.ts";
export { assessAperture } from "./aperture.ts";
export type { ApertureAssessment, ApertureSuppressionReason } from "./aperture.ts";
export { fitGauss1d, fitGauss2d, fitSuperGauss2d } from "./fit.ts";
export type {
  FitOptions,
  FitResult,
  FitStatus,
  Gauss1dFitParams,
  Gauss2dFitParams,
  SuperGauss2dFitParams,
} from "./fit.ts";
export {
  computeEllipticity,
  computeRadialDistribution,
  computeSymmetryErrors,
  encircledPowerRadiusPx,
} from "./metrics.ts";
export type { RadialDistribution, SymmetryErrors } from "./metrics.ts";
export {
  computeProjection,
  extractAxisProfile,
  extractCut,
  measureProfileWidths,
} from "./profiles.ts";
export type {
  LineProfile,
  LineProfileKind,
  ProfileWidths,
  WidthMeasurement,
} from "./profiles.ts";
export {
  compareFitToMoments,
  compareModelResiduals,
  computeResidualOutput,
  mapGauss2dToPhysical,
  mapMomentsToPhysical,
  sigmaFromSuperGaussWidth,
} from "./reporting.ts";
export type { PhysicalBeamGeometry } from "./reporting.ts";
export { suggestRoi } from "./roi.ts";
export type { SuggestedRoi } from "./roi.ts";
export { buildSweepVariants, runRoiStabilitySweep } from "./stability.ts";
export type {
  RoiStabilityReport,
  SweepSensitivity,
  SweepVariant,
  SweepVariantResult,
} from "./stability.ts";
export {
  ALPHA_CONSISTENCY_MAX_PERCENT,
  APERTURE_ALPHA_CHECK,
  APERTURE_ALPHA_DEFAULT,
  AUTO_BACKGROUND_CORNER_FRACTION,
  EDGE_TOUCH_FRACTION,
  HISTOGRAM_BIN_COUNT,
  HOT_PIXEL_K,
  LOCAL_MAX_K,
  MAX_DECODE_PIXELS,
  METADATA_CAP_CHARS,
  MULTI_PEAK_MIN_PEAK_FRACTION,
  MULTI_PEAK_SEPARATION_WIDTH_FACTOR,
  PEDESTAL_HINT_FRACTION,
  RESIDUAL_DISPLAY_MAX_SIZE,
  RESIDUAL_RMS_PEAK_FRACTION,
  RESIDUAL_RMS_SIGMA_FACTOR,
  ROBUST_STATS_MAX_EXACT,
  ROI_SWEEP_SHIFT_FRACTION,
  ROI_SWEEP_SIZE_FACTORS,
  SUGGESTED_ROI_K,
  SUGGESTED_ROI_NOISE_SUSPECT_FRACTION,
  SUGGESTED_ROI_PADDING_PX,
} from "./thresholds.ts";
