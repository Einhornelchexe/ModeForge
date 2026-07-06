import { assertFiniteNumber, assertPositive, type ValidationResult } from "../../core/src/index.ts";
import type { MaterialModel } from "../../materials/src/index.ts";
import type { SurfaceStackOptic } from "../../optics/src/index.ts";

export type CatalogSourceMetadata = {
  sourceName: string;
  license?: string;
  citation?: string;
  url?: string;
};

export type MaterialPack = {
  version: "0.1";
  id: string;
  displayName: string;
  source: CatalogSourceMetadata;
  materials: readonly MaterialModel[];
};

export type CatalogLens =
  | {
      kind: "thin-lens";
      id: string;
      displayName: string;
      focalLengthMm: number;
      apertureRadiusMm?: number;
      materialId?: string;
    }
  | {
      kind: "surface-stack";
      id: string;
      displayName: string;
      optic: SurfaceStackOptic;
    };

export type LensPack = {
  version: "0.1";
  id: string;
  displayName: string;
  source: CatalogSourceMetadata;
  lenses: readonly CatalogLens[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePackHeader(record: Record<string, unknown>, errors: string[]): void {
  if (record.version !== "0.1") errors.push("pack version must be 0.1");
  if (typeof record.id !== "string" || record.id.length === 0) errors.push("pack id is required");
  if (typeof record.displayName !== "string" || record.displayName.length === 0) errors.push("pack displayName is required");
  if (!isRecord(record.source)) {
    errors.push("pack source metadata is required");
  } else if (typeof record.source.sourceName !== "string" || record.source.sourceName.length === 0) {
    errors.push("pack source.sourceName is required");
  }
}

function validateMaterial(material: MaterialModel, index: number, errors: string[]): void {
  const prefix = `materials[${index}]`;
  if (!isRecord(material)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  if (!material.id) errors.push(`${prefix}.id is required`);
  if (!material.displayName) errors.push(`${prefix}.displayName is required`);
  if (!Array.isArray(material.aliases)) errors.push(`${prefix}.aliases must be an array`);
  if (material.formula !== "constant-n" && material.formula !== "sellmeier") errors.push(`${prefix}.formula must be constant-n or sellmeier`);
  if (material.formula === "constant-n") {
    try {
      assertPositive(material.coefficients?.[0] as number, `${prefix}.coefficients[0]`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (material.formula === "sellmeier") {
    if (!material.coefficients || material.coefficients.length < 6) errors.push(`${prefix}.coefficients must contain six Sellmeier values`);
    for (const coefficient of material.coefficients ?? []) {
      try {
        assertFiniteNumber(coefficient, `${prefix}.coefficients`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
}

export function validateMaterialPack(pack: MaterialPack): ValidationResult<MaterialPack> {
  const record = pack as unknown;
  if (!isRecord(record)) return { ok: false, errors: ["material pack must be an object"] };
  const errors: string[] = [];
  validatePackHeader(record, errors);
  if (!Array.isArray(record.materials)) {
    errors.push("materials must be an array");
  } else {
    record.materials.forEach((material, index) => validateMaterial(material as MaterialModel, index, errors));
  }
  return errors.length === 0 ? { ok: true, value: pack, errors: [] } : { ok: false, errors };
}

export function validateLensPack(pack: LensPack): ValidationResult<LensPack> {
  const record = pack as unknown;
  if (!isRecord(record)) return { ok: false, errors: ["lens pack must be an object"] };
  const errors: string[] = [];
  validatePackHeader(record, errors);
  if (!Array.isArray(record.lenses)) {
    errors.push("lenses must be an array");
  } else {
    record.lenses.forEach((lens, index) => {
      const prefix = `lenses[${index}]`;
      if (!isRecord(lens)) {
        errors.push(`${prefix} must be an object`);
        return;
      }
      const item = lens as CatalogLens;
      if (!item.id) errors.push(`${prefix}.id is required`);
      if (!item.displayName) errors.push(`${prefix}.displayName is required`);
      if (item.kind === "thin-lens") {
        try {
          assertFiniteNumber(item.focalLengthMm, `${prefix}.focalLengthMm`);
          if (item.focalLengthMm === 0) errors.push(`${prefix}.focalLengthMm must be non-zero`);
          if (item.apertureRadiusMm !== undefined) assertPositive(item.apertureRadiusMm, `${prefix}.apertureRadiusMm`);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      } else if (item.kind === "surface-stack") {
        if (!item.optic || !Array.isArray(item.optic.surfaces)) errors.push(`${prefix}.optic.surfaces must be an array`);
      } else {
        errors.push(`${prefix}.kind must be thin-lens or surface-stack`);
      }
    });
  }
  return errors.length === 0 ? { ok: true, value: pack, errors: [] } : { ok: false, errors };
}

export function materialsFromPacks(packs: readonly MaterialPack[]): MaterialModel[] {
  return packs.flatMap((pack) =>
    pack.materials.map((material) => ({
      ...material,
      license: material.license ?? pack.source.license,
      citation: material.citation ?? pack.source.citation,
    })),
  );
}
