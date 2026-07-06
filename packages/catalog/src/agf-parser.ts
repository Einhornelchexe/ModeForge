import { warning, type SimulationWarning } from "../../core/src/index.ts";
import type { MaterialModel } from "../../materials/src/index.ts";

export type AgfParseResult = {
  materials: MaterialModel[];
  warnings: SimulationWarning[];
};

type PendingMaterial = {
  name: string;
  coefficients?: number[];
};

function materialFromPending(pending: PendingMaterial): MaterialModel {
  if (pending.coefficients && pending.coefficients.length >= 6) {
    return {
      id: pending.name.toLowerCase(),
      displayName: pending.name,
      aliases: [pending.name],
      source: "agf-import",
      formula: "sellmeier",
      coefficients: pending.coefficients.slice(0, 6),
    };
  }
  return {
    id: pending.name.toLowerCase(),
    displayName: pending.name,
    aliases: [pending.name],
    source: "agf-import",
    formula: "constant-n",
    coefficients: [1],
  };
}

export function parseAgfCatalog(text: string): AgfParseResult {
  const materials: MaterialModel[] = [];
  const warnings: SimulationWarning[] = [];
  let pending: PendingMaterial | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "NM") {
      if (pending) materials.push(materialFromPending(pending));
      if (!parts[1]) {
        warnings.push(warning("INVALID_INPUT", "AGF NM line is missing a material name.", "error"));
        pending = undefined;
      } else {
        pending = { name: parts[1] };
      }
    }
    if (parts[0] === "CD" && pending) {
      const coefficients = parts.slice(1).map(Number);
      if (coefficients.length < 6 || coefficients.some((value) => !Number.isFinite(value))) {
        warnings.push(warning("INVALID_INPUT", `AGF CD line for ${pending.name} must contain six finite coefficients.`, "error"));
      } else {
        pending.coefficients = coefficients;
      }
    }
  }

  if (pending) materials.push(materialFromPending(pending));
  if (materials.length === 0) warnings.push(warning("MATERIAL_UNKNOWN", "No AGF materials were parsed.", "warning"));
  return { materials, warnings };
}
