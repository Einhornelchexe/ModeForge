export type WarningSeverity = "info" | "warning" | "error";

export type SimulationWarningCode =
  | "PARAXIAL_ANGLE_HIGH"
  | "APERTURE_MARGIN_LOW"
  | "MATERIAL_CONSTANT_N"
  | "MATERIAL_OUTSIDE_RANGE"
  | "MATERIAL_UNKNOWN"
  | "DISPERSION_UNAVAILABLE"
  | "FIELD_PROPAGATION_UNAVAILABLE"
  | "FIELD_SAMPLING_LOW"
  | "MEASUREMENT_FIT_RESIDUAL_HIGH"
  | "UNSUPPORTED_PROFILE_PROPAGATION"
  | "INVALID_INPUT"
  // Image-analyzer orchestration warnings (S18e).
  | "IMAGE_APERTURE_SUPPRESSED"
  | "IMAGE_AXIS_NOT_RESOLVED"
  | "IMAGE_BACKGROUND_DEGENERATE"
  | "IMAGE_EDGE_TOUCH"
  | "IMAGE_FIT_NOT_CONVERGED"
  | "IMAGE_FLOAT_SPECIALS"
  | "IMAGE_FWHM_AMBIGUOUS"
  | "IMAGE_HOT_PIXELS"
  | "IMAGE_MOMENTS_UNDEFINED"
  | "IMAGE_MULTI_PEAK"
  | "IMAGE_NEGATIVE_POWER"
  | "IMAGE_NOISE_SCALE_SUSPECT"
  | "IMAGE_ORIENTATION_UNSTABLE"
  | "IMAGE_PEDESTAL_HINT"
  | "IMAGE_RESIDUAL_HIGH"
  | "IMAGE_ROI_SENSITIVE"
  | "IMAGE_ROI_UNDETERMINABLE"
  | "IMAGE_SATURATION"
  // S18 final-review additions (G3, G6, G7): additive only, no existing
  // code's meaning changes.
  | "IMAGE_CLIPPING_SUSPECT"
  | "IMAGE_RADIAL_NOISE_DOMINATED"
  | "IMAGE_WIDTH_RESOLUTION_LIMIT"
  // S18-R2 final-review honesty instruments (F1 a/b, F2): additive only, no
  // existing code's meaning changes. All three speak about a RELEASED width.
  | "IMAGE_ABSORBED_POWER"
  | "IMAGE_TIER_DISAGREEMENT"
  | "IMAGE_WIDTH_SCATTER"
  // S20 stage A (aperture coverage of non-finite pixels): additive only, no
  // existing code's meaning changes.
  | "IMAGE_COVERAGE_LOSS"
  // S20 stage B (honesty floor): three INFO-severity visibility notices about
  // a RELEASED width. Additive only - none of them suppresses anything and no
  // existing code's meaning changes.
  | "IMAGE_ALPHA_GATE_WEAK"
  | "IMAGE_TIER_CHECK_UNAVAILABLE"
  | "IMAGE_WING_PROBE_REDUCED"
  // S20 stage E (background statistics): the background REFERENCE carries a
  // linear trend while the applied model subtracts a single number. Additive
  // only; no existing code's meaning changes.
  | "IMAGE_BACKGROUND_GRADIENT_IN_REFERENCE"
  // S23: a background reference rectangle overlaps the beam geometry used for
  // the released result or its converged fit fallback. Additive only.
  | "IMAGE_BEAM_IN_BACKGROUND_REFERENCE";

export type SimulationWarning = {
  severity: WarningSeverity;
  code: SimulationWarningCode;
  message: string;
  componentId?: string;
  zMm?: number;
};

export function warning(
  code: SimulationWarningCode,
  message: string,
  severity: WarningSeverity = "warning",
  extra: Partial<SimulationWarning> = {},
): SimulationWarning {
  return { severity, code, message, ...extra };
}
