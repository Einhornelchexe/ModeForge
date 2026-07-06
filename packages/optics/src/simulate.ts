import {
  validateBeamlineInput,
  warning,
  type BeamlineComponent,
  type BeamlineInput,
  type BeamlineResult,
  type MatrixResult,
  type SimulationWarning,
  type WaistResult,
} from "../../core/src/index.ts";
import { calculatePulse } from "../../pulses/src/index.ts";
import { gaussianRadiusAtZ, qAtZ, radiusFromQ, transformQ, waistFromQ, type Complex } from "./gaussian.ts";
import { determinant, freeSpaceMatrix, IDENTITY_MATRIX, thinLensMatrix, type AbcdMatrix } from "./matrix.ts";
import { paraxialCard, stackOpticFromComponent, surfaceStackMatrix, thickSphericalLensStack } from "./surface-stack.ts";

type AxisState = {
  q: Complex;
  wavelengthUm: number;
  m2: number;
};

function matrixForComponent(component: BeamlineComponent, axis: "x" | "y"): AbcdMatrix {
  if (component.kind === "free-space") return freeSpaceMatrix(component.lengthMm / (component.refractiveIndex ?? 1));
  if (component.kind === "thin-lens") return thinLensMatrix(component.focalLengthMm);
  if (component.kind === "cylindrical-lens") return component.axis === axis ? thinLensMatrix(component.focalLengthMm) : IDENTITY_MATRIX;
  if (component.kind === "slab") return freeSpaceMatrix(component.thicknessMm / component.refractiveIndex);
  if (component.kind === "thick-lens") {
    const card = paraxialCard(
      thickSphericalLensStack({
        id: component.id,
        radius1Mm: component.radius1Mm,
        radius2Mm: component.radius2Mm,
        thicknessMm: component.thicknessMm,
        refractiveIndex: component.refractiveIndex,
        apertureRadiusMm: component.apertureRadiusMm,
      }),
    );
    return card.matrix;
  }
  if (component.kind === "surface-stack") return surfaceStackMatrix(stackOpticFromComponent(component), 1);
  return { a: 1, b: 0, c: 0, d: 1 };
}

function componentLength(component: BeamlineComponent): number {
  if (component.kind === "free-space") return component.lengthMm;
  if (component.kind === "slab") return component.thicknessMm;
  if (component.kind === "thick-lens") return component.thicknessMm;
  if (component.kind === "surface-stack") return component.surfaces.reduce((sum, surface) => sum + surface.thicknessAfterMm, 0);
  return 0;
}

// effective clear aperture of a component for margin checks: the explicit
// apertureRadiusMm, or for surface stacks the tightest per-surface aperture
function componentApertureForMargin(component: BeamlineComponent): number | undefined {
  if ("apertureRadiusMm" in component && component.apertureRadiusMm !== undefined) return component.apertureRadiusMm;
  if (component.kind === "surface-stack") {
    return component.surfaces.reduce<number | undefined>(
      (min, surface) =>
        surface.apertureRadiusMm !== undefined && (min === undefined || surface.apertureRadiusMm < min) ? surface.apertureRadiusMm : min,
      undefined,
    );
  }
  return undefined;
}

function initialAxisStates(input: BeamlineInput): { x: AxisState; y?: AxisState } {
  const beam = input.beam;
  if (beam.kind === "gaussian") {
    return {
      x: {
        q: qAtZ(-beam.waistPositionMm, beam.waistRadiusMm, beam.wavelengthUm, beam.m2 ?? 1),
        wavelengthUm: beam.wavelengthUm,
        m2: beam.m2 ?? 1,
      },
    };
  }
  if (beam.kind === "elliptical-gaussian") {
    return {
      x: {
        q: qAtZ(-beam.waistPositionXmm, beam.waistRadiusXmm, beam.wavelengthUm, beam.m2x ?? 1),
        wavelengthUm: beam.wavelengthUm,
        m2: beam.m2x ?? 1,
      },
      y: {
        q: qAtZ(-beam.waistPositionYmm, beam.waistRadiusYmm, beam.wavelengthUm, beam.m2y ?? 1),
        wavelengthUm: beam.wavelengthUm,
        m2: beam.m2y ?? 1,
      },
    };
  }
  const radiusXmm = beam.d4SigmaDiameterXmm / 2;
  const radiusYmm = (beam.d4SigmaDiameterYmm ?? beam.d4SigmaDiameterXmm) / 2;
  return {
    x: {
      q: qAtZ(-beam.waistPositionXmm, radiusXmm, beam.wavelengthUm, beam.m2x),
      wavelengthUm: beam.wavelengthUm,
      m2: beam.m2x,
    },
    y: {
      q: qAtZ(-(beam.waistPositionYmm ?? beam.waistPositionXmm), radiusYmm, beam.wavelengthUm, beam.m2y ?? beam.m2x),
      wavelengthUm: beam.wavelengthUm,
      m2: beam.m2y ?? beam.m2x,
    },
  };
}

export function simulateBeamline(input: BeamlineInput): BeamlineResult {
  const validation = validateBeamlineInput(input);
  if (!validation.ok) {
    return {
      zGridMm: [],
      envelope: { radiusXmm: [], diameterXmm: [] },
      waists: [],
      components: [],
      matrices: [],
      warnings: validation.errors.map((message) => warning("INVALID_INPUT", message, "error")),
    };
  }

  const axis = initialAxisStates(input);
  const zGridMm: number[] = [0];
  const radiusXmm: number[] = [radiusFromQ(axis.x.q, axis.x.wavelengthUm, axis.x.m2)];
  const radiusYmm: number[] = axis.y ? [radiusFromQ(axis.y.q, axis.y.wavelengthUm, axis.y.m2)] : [];
  const componentResults = [];
  const matrices: MatrixResult[] = [];
  const warnings: SimulationWarning[] = [];
  let z = 0;

  for (const component of input.components) {
    const startZmm = z;
    if (component.kind === "cylindrical-lens" && !axis.y) {
      axis.y = { q: { ...axis.x.q }, wavelengthUm: axis.x.wavelengthUm, m2: axis.x.m2 };
      if (radiusYmm.length === 0) radiusYmm.push(...radiusXmm);
    }
    const matrixX = matrixForComponent(component, "x");
    const matrixY = axis.y ? matrixForComponent(component, "y") : undefined;
    // beam size where it ENTERS the component — the aperture check must not
    // miss entry-side clipping of a beam that focuses inside the component
    const entryRadiusX = radiusFromQ(axis.x.q, axis.x.wavelengthUm, axis.x.m2);
    const entryRadiusY = axis.y ? radiusFromQ(axis.y.q, axis.y.wavelengthUm, axis.y.m2) : undefined;
    axis.x.q = transformQ(axis.x.q, matrixX);
    if (axis.y && matrixY) axis.y.q = transformQ(axis.y.q, matrixY);
    if (component.kind === "cylindrical-lens" && matrixY) {
      matrices.push({ componentId: component.id, axis: "x", ...matrixX, determinant: determinant(matrixX) });
      matrices.push({ componentId: component.id, axis: "y", ...matrixY, determinant: determinant(matrixY) });
    } else {
      matrices.push({ componentId: component.id, axis: "both", ...matrixX, determinant: determinant(matrixX) });
    }

    const length = componentLength(component);
    z += length;
    const currentRadiusX = radiusFromQ(axis.x.q, axis.x.wavelengthUm, axis.x.m2);
    const currentRadiusY = axis.y ? radiusFromQ(axis.y.q, axis.y.wavelengthUm, axis.y.m2) : undefined;
    const componentWarnings: SimulationWarning[] = [];
    if (length > 0) {
      zGridMm.push(z);
      radiusXmm.push(currentRadiusX);
      if (axis.y && currentRadiusY !== undefined) radiusYmm.push(currentRadiusY);
    }

    let apertureMargin: number | undefined;
    const marginAperture = componentApertureForMargin(component);
    if (marginAperture !== undefined) {
      const largestRadius = Math.max(currentRadiusX, currentRadiusY ?? currentRadiusX, entryRadiusX, entryRadiusY ?? entryRadiusX);
      apertureMargin = marginAperture / largestRadius;
      if (apertureMargin < 1.5) {
        const apertureWarning = warning("APERTURE_MARGIN_LOW", `Aperture margin ${apertureMargin.toFixed(2)} is below 1.5`, "warning", {
          componentId: component.id,
          zMm: z,
        });
        warnings.push(apertureWarning);
        componentWarnings.push(apertureWarning);
      }
    }

    componentResults.push({
      componentId: component.id,
      kind: component.kind,
      startZmm,
      endZmm: z,
      apertureMargin,
      warnings: componentWarnings,
    });
  }

  const waistX = waistFromQ(axis.x.q, axis.x.wavelengthUm, axis.x.m2);
  const waists: WaistResult[] = [
    {
      axis: "x" as const,
      zMm: z + waistX.waistOffsetMm,
      radiusMm: waistX.waistRadiusMm,
      rayleighRangeMm: waistX.rayleighRangeMm,
      m2: axis.x.m2,
    },
  ];
  if (axis.y) {
    const waistY = waistFromQ(axis.y.q, axis.y.wavelengthUm, axis.y.m2);
    waists.push({
      axis: "y" as const,
      zMm: z + waistY.waistOffsetMm,
      radiusMm: waistY.waistRadiusMm,
      rayleighRangeMm: waistY.rayleighRangeMm,
      m2: axis.y.m2,
    });
  }

  const result: BeamlineResult = {
    zGridMm,
    envelope: {
      radiusXmm,
      radiusYmm: radiusYmm.length > 0 ? radiusYmm : undefined,
      diameterXmm: radiusXmm.map((radius) => 2 * radius),
      diameterYmm: radiusYmm.length > 0 ? radiusYmm.map((radius) => 2 * radius) : undefined,
    },
    waists,
    components: componentResults,
    matrices,
    warnings,
  };

  if (input.pulse) {
    result.pulse = calculatePulse(input.pulse, { radiusXmm: radiusXmm.at(-1) ?? radiusXmm[0], radiusYmm: radiusYmm.at(-1) });
  }

  return result;
}

export { gaussianRadiusAtZ };
