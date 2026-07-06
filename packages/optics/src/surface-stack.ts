import { assertFiniteNumber, assertPositive, warning, type BeamlineComponent, type SimulationWarning } from "../../core/src/index.ts";
import {
  type AbcdMatrix,
  composeMatrices,
  determinant,
  freeSpaceMatrix,
  refractiveSurfaceMatrix,
} from "./matrix.ts";

export type OpticalSurface = {
  radiusMm: number | "Infinity";
  thicknessAfterMm: number;
  materialAfter: string;
  refractiveIndexAfter: number;
  apertureRadiusMm?: number;
  supportedInFastMode: boolean;
};

export type SurfaceStackOptic = {
  id: string;
  name?: string;
  source: "manual" | "modeforge-json" | "zmx-import" | "catalog-pack";
  surfaces: OpticalSurface[];
  warnings: SimulationWarning[];
};

export type ParaxialCard = {
  matrix: AbcdMatrix;
  determinant: number;
  effectiveFocalLengthMm?: number;
  backFocalLengthMm?: number;
  frontFocalLengthMm?: number;
  warnings: SimulationWarning[];
};

// Map a surface-stack beamline component (S15) onto the optic contract used
// by surfaceStackMatrix / paraxialCard. materialAfter is display metadata and
// falls back to AIR/GLASS by index.
export function stackOpticFromComponent(component: Extract<BeamlineComponent, { kind: "surface-stack" }>): SurfaceStackOptic {
  return {
    id: component.id,
    name: component.name,
    source: "modeforge-json",
    surfaces: component.surfaces.map((surface) => ({
      radiusMm: surface.radiusMm,
      thicknessAfterMm: surface.thicknessAfterMm,
      materialAfter: surface.materialAfter ?? (surface.refractiveIndexAfter === 1 ? "AIR" : "GLASS"),
      refractiveIndexAfter: surface.refractiveIndexAfter,
      apertureRadiusMm: surface.apertureRadiusMm,
      supportedInFastMode: true,
    })),
    warnings: [],
  };
}

export function surfaceStackMatrix(stack: SurfaceStackOptic, nBefore = 1): AbcdMatrix {
  assertPositive(nBefore, "nBefore");
  const matrices: AbcdMatrix[] = [];
  let nCurrent = nBefore;
  for (const surface of stack.surfaces) {
    assertPositive(surface.refractiveIndexAfter, "refractiveIndexAfter");
    assertFiniteNumber(surface.thicknessAfterMm, "thicknessAfterMm");
    if (surface.thicknessAfterMm < 0) throw new RangeError("thicknessAfterMm must be >= 0");
    matrices.push(refractiveSurfaceMatrix(surface.radiusMm, nCurrent, surface.refractiveIndexAfter));
    if (surface.thicknessAfterMm !== 0) {
      matrices.push(freeSpaceMatrix(surface.thicknessAfterMm));
    }
    nCurrent = surface.refractiveIndexAfter;
  }
  return composeMatrices(matrices);
}

export function paraxialCard(stack: SurfaceStackOptic, nBefore = 1): ParaxialCard {
  const matrix = surfaceStackMatrix(stack, nBefore);
  const warnings = [...stack.warnings];
  if (Math.abs(determinant(matrix) - 1) > 0.2) {
    warnings.push(warning("INVALID_INPUT", "Matrix determinant differs strongly from unity; check external media."));
  }
  if (Math.abs(matrix.c) < 1e-15) {
    return { matrix, determinant: determinant(matrix), warnings };
  }
  return {
    matrix,
    determinant: determinant(matrix),
    effectiveFocalLengthMm: -1 / matrix.c,
    backFocalLengthMm: -matrix.a / matrix.c,
    frontFocalLengthMm: matrix.d / matrix.c,
    warnings,
  };
}

export function thickSphericalLensStack(input: {
  id: string;
  radius1Mm: number | "Infinity";
  radius2Mm: number | "Infinity";
  thicknessMm: number;
  refractiveIndex: number;
  apertureRadiusMm?: number;
}): SurfaceStackOptic {
  return {
    id: input.id,
    name: "Thick spherical lens",
    source: "manual",
    warnings: [],
    surfaces: [
      {
        radiusMm: input.radius1Mm,
        thicknessAfterMm: input.thicknessMm,
        materialAfter: "LENS",
        refractiveIndexAfter: input.refractiveIndex,
        apertureRadiusMm: input.apertureRadiusMm,
        supportedInFastMode: true,
      },
      {
        radiusMm: input.radius2Mm,
        thicknessAfterMm: 0,
        materialAfter: "AIR",
        refractiveIndexAfter: 1,
        apertureRadiusMm: input.apertureRadiusMm,
        supportedInFastMode: true,
      },
    ],
  };
}
