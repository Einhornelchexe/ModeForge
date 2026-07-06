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
  | "INVALID_INPUT";

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
