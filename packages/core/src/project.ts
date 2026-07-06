import type { ModeForgeProject } from "./contracts.ts";
import { validateBeamInput, validateComponent, validatePulseInput, type ValidationResult } from "./validation.ts";

const widthBasisValues = new Set(["one_over_e2_radius", "fwhm_diameter", "rms_radius", "d4sigma_diameter"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializeProject(project: ModeForgeProject): string {
  return JSON.stringify(project, null, 2);
}

export function parseProjectJson(json: string): ValidationResult<ModeForgeProject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ["project JSON must be an object"] };
  }

  const candidate = parsed as ModeForgeProject;
  const errors: string[] = [];
  if (candidate.version !== "0.1") errors.push("project version must be 0.1");
  if (!candidate.beam) errors.push("project beam is required");
  if (!Array.isArray(candidate.beamline)) errors.push("project beamline must be an array");

  if (candidate.beam) {
    const beam = validateBeamInput(candidate.beam);
    if (!beam.ok) errors.push(...beam.errors);
  }
  if (Array.isArray(candidate.beamline)) {
    for (const component of candidate.beamline) {
      const result = validateComponent(component);
      if (!result.ok) errors.push(...result.errors);
    }
  }
  if (candidate.pulses !== undefined) {
    const pulse = validatePulseInput(candidate.pulses);
    if (!pulse.ok) errors.push(...pulse.errors);
  }
  if (candidate.display !== undefined) {
    if (!isRecord(candidate.display)) {
      errors.push("project display must be an object");
    } else if (candidate.display.widthBasis !== undefined && !widthBasisValues.has(String(candidate.display.widthBasis))) {
      errors.push("display.widthBasis must be one_over_e2_radius, fwhm_diameter, rms_radius, or d4sigma_diameter");
    }
  }

  return errors.length === 0 ? { ok: true, value: candidate, errors: [] } : { ok: false, errors };
}
