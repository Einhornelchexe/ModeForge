import { SPEED_OF_LIGHT_M_PER_S, warning, type SimulationWarning } from "../../core/src/index.ts";

export type MaterialModel = {
  id: string;
  displayName: string;
  aliases: string[];
  source: "builtin" | "agf-import" | "manual" | "optional-pack";
  formula: "constant-n" | "sellmeier";
  coefficients?: number[];
  wavelengthRangeUm?: [number, number];
  citation?: string;
  license?: string;
};

export type MaterialResolution = {
  material?: MaterialModel;
  warnings: SimulationWarning[];
};

export const AIR: MaterialModel = {
  id: "air",
  displayName: "Air",
  aliases: ["AIR"],
  source: "builtin",
  formula: "constant-n",
  coefficients: [1],
  wavelengthRangeUm: [0.2, 20],
};

export const N_BK7: MaterialModel = {
  id: "schott_n_bk7",
  displayName: "N-BK7",
  aliases: ["N-BK7", "BK7"],
  source: "builtin",
  formula: "sellmeier",
  coefficients: [1.03961212, 0.00600069867, 0.231792344, 0.0200179144, 1.01046945, 103.560653],
  wavelengthRangeUm: [0.3, 2.5],
  citation: "Schott N-BK7 Sellmeier coefficients",
};

export const FUSED_SILICA: MaterialModel = {
  id: "fused_silica",
  displayName: "Fused Silica",
  aliases: ["FUSED SILICA", "UVFS", "F_SILICA", "SILICA"],
  source: "builtin",
  formula: "sellmeier",
  coefficients: [0.6961663, 0.00467914826, 0.4079426, 0.0135120631, 0.8974794, 97.9340025],
  wavelengthRangeUm: [0.21, 3.7],
  citation: "Malitson fused silica coefficients",
};

export const BUILTIN_MATERIALS = [AIR, N_BK7, FUSED_SILICA] as const;

export function resolveMaterial(name: string, materials: readonly MaterialModel[] = BUILTIN_MATERIALS): MaterialResolution {
  const normalized = name.trim().toUpperCase();
  for (const material of materials) {
    if (material.id.toUpperCase() === normalized || material.displayName.toUpperCase() === normalized) {
      return { material, warnings: [] };
    }
    if (material.aliases.some((alias) => alias.toUpperCase() === normalized)) {
      return { material, warnings: [] };
    }
  }
  return { warnings: [warning("MATERIAL_UNKNOWN", `Material ${name} is not in the active resolver.`, "error")] };
}

export function refractiveIndex(material: MaterialModel, wavelengthUm: number): number {
  if (material.wavelengthRangeUm && (wavelengthUm < material.wavelengthRangeUm[0] || wavelengthUm > material.wavelengthRangeUm[1])) {
    // Caller can surface a warning via materialWarnings; n(lambda) is still evaluated for continuity.
  }
  if (material.formula === "constant-n") {
    return material.coefficients?.[0] ?? 1;
  }
  const [b1, c1, b2, c2, b3, c3] = material.coefficients ?? [];
  const l2 = wavelengthUm * wavelengthUm;
  const n2 = 1 + (b1 * l2) / (l2 - c1) + (b2 * l2) / (l2 - c2) + (b3 * l2) / (l2 - c3);
  return Math.sqrt(n2);
}

export function materialWarnings(material: MaterialModel, wavelengthUm: number): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];
  if (material.formula === "constant-n") {
    warnings.push(warning("MATERIAL_CONSTANT_N", `${material.displayName} uses constant n; dispersion is unavailable.`, "info"));
    warnings.push(warning("DISPERSION_UNAVAILABLE", `${material.displayName} has no dispersion coefficients.`, "warning"));
  }
  if (material.wavelengthRangeUm && (wavelengthUm < material.wavelengthRangeUm[0] || wavelengthUm > material.wavelengthRangeUm[1])) {
    warnings.push(
      warning(
        "MATERIAL_OUTSIDE_RANGE",
        `${wavelengthUm} um is outside ${material.displayName} range ${material.wavelengthRangeUm[0]}-${material.wavelengthRangeUm[1]} um.`,
      ),
    );
  }
  return warnings;
}

export function dnDlambda(material: MaterialModel, wavelengthUm: number): number {
  const h = Math.max(1e-5, wavelengthUm * 1e-5);
  return (refractiveIndex(material, wavelengthUm + h) - refractiveIndex(material, wavelengthUm - h)) / (2 * h);
}

export function d2nDlambda2(material: MaterialModel, wavelengthUm: number): number {
  const h = Math.max(1e-4, wavelengthUm * 1e-4);
  return (
    refractiveIndex(material, wavelengthUm + h) -
    2 * refractiveIndex(material, wavelengthUm) +
    refractiveIndex(material, wavelengthUm - h)
  ) / (h * h);
}

export function gvdFs2PerMm(material: MaterialModel, wavelengthUm: number): number {
  if (material.formula === "constant-n") return 0;
  const lambdaM = wavelengthUm * 1e-6;
  const d2PerM2 = d2nDlambda2(material, wavelengthUm) * 1e12;
  const gvdS2PerM = (lambdaM ** 3 / (2 * Math.PI * SPEED_OF_LIGHT_M_PER_S ** 2)) * d2PerM2;
  return gvdS2PerM * 1e27;
}

export function gddFs2(material: MaterialModel, wavelengthUm: number, thicknessMm: number): number {
  return gvdFs2PerMm(material, wavelengthUm) * thicknessMm;
}
