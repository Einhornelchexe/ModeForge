import { assertFiniteNumber, assertPositive } from "./units.ts";
import type { BeamInput, BeamlineComponent, BeamlineInput, PulseInput } from "./contracts.ts";

export type ValidationResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; errors: string[] };

const beamKinds = new Set(["gaussian", "elliptical-gaussian", "moment"]);
const componentKinds = new Set(["free-space", "thin-lens", "cylindrical-lens", "slab", "thick-lens", "aperture", "surface-stack"]);
const pulseShapes = new Set(["gaussian", "sech2", "rectangular"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOptionalPositive(value: unknown, name: string, errors: string[]): void {
  if (value === undefined) return;
  try {
    assertPositive(value as number, name);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function validateOptionalFinite(value: unknown, name: string, errors: string[]): void {
  if (value === undefined) return;
  try {
    assertFiniteNumber(value as number, name);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function validateRequiredFinite(value: unknown, name: string, errors: string[]): void {
  try {
    assertFiniteNumber(value as number, name);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function validateM2(value: unknown, name: string, errors: string[]): void {
  if (value === undefined) return;
  validateRequiredM2(value, name, errors);
}

function validateRequiredM2(value: unknown, name: string, errors: string[]): void {
  try {
    assertFiniteNumber(value as number, name);
    if ((value as number) < 1) errors.push(`${name} must be >= 1`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function validateFiniteRadiusOrInfinity(value: unknown, name: string, errors: string[]): void {
  if (value === "Infinity") return;
  try {
    assertFiniteNumber(value as number, name);
    if (value === 0) errors.push(`${name} must be non-zero or "Infinity"`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

export function validateBeamInput(input: BeamInput): ValidationResult<BeamInput> {
  const errors: string[] = [];
  const record = input as unknown;
  if (!isRecord(record)) return { ok: false, errors: ["beam must be an object"] };
  if (!beamKinds.has(String(record.kind))) {
    errors.push("beam kind must be gaussian, elliptical-gaussian, or moment");
    return { ok: false, errors };
  }
  try {
    assertPositive(record.wavelengthUm as number, "wavelengthUm");
    validateOptionalPositive(record.powerW, "powerW", errors);
    if (input.kind === "gaussian") {
      assertPositive(record.waistRadiusMm as number, "waistRadiusMm");
      validateRequiredFinite(record.waistPositionMm, "waistPositionMm", errors);
      validateM2(record.m2, "m2", errors);
    }
    if (input.kind === "elliptical-gaussian") {
      assertPositive(record.waistRadiusXmm as number, "waistRadiusXmm");
      assertPositive(record.waistRadiusYmm as number, "waistRadiusYmm");
      validateRequiredFinite(record.waistPositionXmm, "waistPositionXmm", errors);
      validateRequiredFinite(record.waistPositionYmm, "waistPositionYmm", errors);
      validateM2(record.m2x, "m2x", errors);
      validateM2(record.m2y, "m2y", errors);
    }
    if (input.kind === "moment") {
      assertPositive(record.d4SigmaDiameterXmm as number, "d4SigmaDiameterXmm");
      validateOptionalPositive(record.d4SigmaDiameterYmm, "d4SigmaDiameterYmm", errors);
      validateRequiredFinite(record.waistPositionXmm, "waistPositionXmm", errors);
      validateOptionalFinite(record.waistPositionYmm, "waistPositionYmm", errors);
      validateRequiredM2(record.m2x, "m2x", errors);
      validateM2(record.m2y, "m2y", errors);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors.length === 0 ? { ok: true, value: input, errors: [] } : { ok: false, errors };
}

export function validateComponent(component: BeamlineComponent): ValidationResult<BeamlineComponent> {
  const errors: string[] = [];
  const record = component as unknown;
  if (!isRecord(record)) return { ok: false, errors: ["component must be an object"] };
  if (typeof record.id !== "string" || record.id.length === 0) errors.push("component id is required");
  if (!componentKinds.has(String(record.kind))) {
    errors.push("component kind must be free-space, thin-lens, cylindrical-lens, slab, thick-lens, aperture, or surface-stack");
    return { ok: false, errors };
  }
  validateOptionalPositive(record.apertureRadiusMm, "apertureRadiusMm", errors);
  try {
    if (component.kind === "free-space") {
      assertPositive(record.lengthMm as number, "lengthMm");
      validateOptionalPositive(record.refractiveIndex, "refractiveIndex", errors);
    }
    if (component.kind === "thin-lens") {
      assertFiniteNumber(record.focalLengthMm as number, "focalLengthMm");
      if (record.focalLengthMm === 0) errors.push("focalLengthMm must be non-zero");
    }
    if (component.kind === "cylindrical-lens") {
      assertFiniteNumber(record.focalLengthMm as number, "focalLengthMm");
      if (record.focalLengthMm === 0) errors.push("focalLengthMm must be non-zero");
      if (record.axis !== "x" && record.axis !== "y") errors.push("axis must be x or y");
    }
    if (component.kind === "slab") {
      assertPositive(record.thicknessMm as number, "thicknessMm");
      assertPositive(record.refractiveIndex as number, "refractiveIndex");
    }
    if (component.kind === "thick-lens") {
      validateFiniteRadiusOrInfinity(record.radius1Mm, "radius1Mm", errors);
      validateFiniteRadiusOrInfinity(record.radius2Mm, "radius2Mm", errors);
      assertPositive(record.thicknessMm as number, "thicknessMm");
      assertPositive(record.refractiveIndex as number, "refractiveIndex");
    }
    if (component.kind === "aperture") assertPositive(record.apertureRadiusMm as number, "apertureRadiusMm");
    if (component.kind === "surface-stack") {
      if (!Array.isArray(record.surfaces) || record.surfaces.length < 2) {
        errors.push("surface-stack requires at least 2 surfaces");
      } else {
        component.surfaces.forEach((surface, index) => {
          validateFiniteRadiusOrInfinity(surface.radiusMm, `surfaces[${index}].radiusMm`, errors);
          if (!Number.isFinite(surface.thicknessAfterMm) || surface.thicknessAfterMm < 0) {
            errors.push(`surfaces[${index}].thicknessAfterMm must be finite and >= 0`);
          }
          if (!Number.isFinite(surface.refractiveIndexAfter) || surface.refractiveIndexAfter <= 0) {
            errors.push(`surfaces[${index}].refractiveIndexAfter must be > 0`);
          }
          if (surface.apertureRadiusMm !== undefined && !(surface.apertureRadiusMm > 0)) {
            errors.push(`surfaces[${index}].apertureRadiusMm must be > 0`);
          }
        });
        const last = component.surfaces[component.surfaces.length - 1];
        if (last.refractiveIndexAfter !== 1) errors.push("surface-stack must exit into air: last refractiveIndexAfter must be 1");
        if (last.thicknessAfterMm !== 0) {
          errors.push("surface-stack last thicknessAfterMm must be 0 (trailing gaps belong to a free-space component)");
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors.length === 0 ? { ok: true, value: component, errors: [] } : { ok: false, errors };
}

export function validatePulseInput(input: PulseInput): ValidationResult<PulseInput> {
  const errors: string[] = [];
  const record = input as unknown;
  if (!isRecord(record)) return { ok: false, errors: ["pulse must be an object"] };
  if (!pulseShapes.has(String(record.shape))) {
    errors.push("pulse shape must be gaussian, sech2, or rectangular");
    return { ok: false, errors };
  }
  try {
    assertPositive(record.durationFwhmS as number, "durationFwhmS");
    validateOptionalPositive(record.averagePowerW, "averagePowerW", errors);
    validateOptionalPositive(record.pulseEnergyJ, "pulseEnergyJ", errors);
    validateOptionalPositive(record.repetitionRateHz, "repetitionRateHz", errors);
    if (record.pulseEnergyJ === undefined && (record.averagePowerW === undefined || record.repetitionRateHz === undefined)) {
      errors.push("pulseEnergyJ or averagePowerW + repetitionRateHz is required");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors.length === 0 ? { ok: true, value: input, errors: [] } : { ok: false, errors };
}

export function validateBeamlineInput(input: BeamlineInput): ValidationResult<BeamlineInput> {
  const errors: string[] = [];
  const record = input as unknown;
  if (!isRecord(record)) return { ok: false, errors: ["beamline input must be an object"] };
  if (record.version !== "0.1") errors.push("beamline version must be 0.1");
  if (!Array.isArray(record.components)) errors.push("components must be an array");
  validateOptionalPositive(record.zStepMm, "zStepMm", errors);

  const beam = validateBeamInput(record.beam as BeamInput);
  if (!beam.ok) errors.push(...beam.errors);
  if (Array.isArray(record.components)) {
    for (const component of record.components) {
      const result = validateComponent(component as BeamlineComponent);
      const componentId = isRecord(component) && typeof component.id === "string" ? component.id : "<unknown>";
      if (!result.ok) errors.push(...result.errors.map((message) => `${componentId}: ${message}`));
    }
  }
  if (record.pulse !== undefined) {
    const pulse = validatePulseInput(record.pulse as PulseInput);
    if (!pulse.ok) errors.push(...pulse.errors);
  }
  return errors.length === 0 ? { ok: true, value: input, errors: [] } : { ok: false, errors };
}
