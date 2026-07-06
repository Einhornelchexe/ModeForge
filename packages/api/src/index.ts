import {
  parseProjectJson,
  warning,
  type BeamInput,
  type BeamlineInput,
  type BeamlineComponent,
  type BeamlineResult,
  type BeamWidthBasis,
  type ModeForgeProject,
  type SimulationWarning,
  type ValidationResult,
} from "../../core/src/index.ts";
import {
  fitGaussianBeamFromRadii,
  oneOverE2RadiusToFwhmDiameterMm,
  type BeamFitResult,
  type BeamWidthMeasurement,
} from "../../beams/src/index.ts";
import { parseAgfCatalog, parseZmxSequential, type AgfParseResult, type CatalogImportResult } from "../../catalog/src/index.ts";
import { type MaterialModel } from "../../materials/src/index.ts";
import {
  applyCircularAperture,
  applySphericalSurfacePhase,
  applyThinLensPhase,
  createGaussianField,
  createGaussianFieldAtPlane,
  createModeFieldAtPlane,
  fieldIntensity,
  fieldMomentRadii,
  fieldPower,
  fieldSamplingWarnings,
  propagateAngularSpectrum,
  propagateFresnel,
  surfacePhaseSamplingWarnings,
  type ScalarField,
  type TransverseMode,
} from "../../field/src/index.ts";
import {
  gaussianRadiusAtZ,
  inverseComplex,
  paraxialCard,
  qAtZ,
  radiusFromQ,
  simulateBeamline,
  stackOpticFromComponent,
  thickSphericalLensStack,
  type Complex,
} from "../../optics/src/index.ts";
import { optimizeTwoLensTelescope, type TwoLensOptimizationInput, type TwoLensOptimizationResult } from "../../optimizer/src/index.ts";

// UI-facing surface: apps/web imports exclusively from this module (enforced by
// scripts/check-scope.mjs), so every contract type and display helper the
// workbench needs is re-exported here instead of being imported from the
// physics packages directly.
export { parseProjectJson, relativeError, serializeProject } from "../../core/src/index.ts";
export type {
  BeamInput,
  BeamlineComponent,
  BeamlineInput,
  BeamlineResult,
  BeamWidthBasis,
  ComponentResult,
  ModeForgeProject,
  PulseInput,
  PulseResult,
  SimulationWarning,
  ValidationResult,
  WaistResult,
} from "../../core/src/index.ts";
export {
  hermiteGaussianM2,
  laguerreGaussianM2,
  oneOverE2RadiusToFwhmDiameterMm,
  parseBeamWidthMeasurementsCsv,
} from "../../beams/src/index.ts";
export type { BeamFitResult, BeamWidthMeasurement } from "../../beams/src/index.ts";
export { BUILTIN_MATERIALS, refractiveIndex } from "../../materials/src/index.ts";
export type { MaterialModel } from "../../materials/src/index.ts";
export { divergenceHalfAngleRad, gaussianRadiusAtZ, paraxialCard, thickSphericalLensStack } from "../../optics/src/index.ts";
export type { OpticalSurface, ParaxialCard, SurfaceStackOptic } from "../../optics/src/index.ts";
export type { LensCandidate, TwoLensOptimizationInput, TwoLensOptimizationResult, TwoLensSolution } from "../../optimizer/src/index.ts";
export type { AgfParseResult, CatalogImportResult } from "../../catalog/src/index.ts";
export type { TransverseMode } from "../../field/src/index.ts";

// Paraxial card of a surface-stack beamline component (S15) — UI-facing
// helper so the workbench never builds optic internals itself.
export function surfaceStackComponentCard(component: Extract<BeamlineComponent, { kind: "surface-stack" }>) {
  return paraxialCard(stackOpticFromComponent(component));
}

// Inverse of beamWidthToOneOverE2RadiusMm: converts a 1/e^2 radius from the
// core result into the user-selected display basis. Display conversion only.
export function oneOverE2RadiusToBasisValueMm(radiusMm: number, basis: BeamWidthBasis): number {
  if (basis === "fwhm_diameter") return oneOverE2RadiusToFwhmDiameterMm(radiusMm);
  if (basis === "d4sigma_diameter") return radiusMm * 2;
  if (basis === "rms_radius") return radiusMm / 2;
  return radiusMm;
}

export type HeadlessRunResult = {
  version: "0.1";
  beamline: BeamlineResult;
  warnings: SimulationWarning[];
};

// Progress reporting for the CPU-heavy field jobs: done/total propagation
// segments (each segment is one DFT round trip). The callback is optional,
// synchronous and never serialized — callers running the job in a Web Worker
// wire it to postMessage themselves.
export type FieldProgress = { done: number; total: number };
export type FieldProgressCallback = (progress: FieldProgress) => void;

export type FieldFresnelJobInput = {
  field?: ScalarField;
  gaussian?: {
    nx: number;
    ny: number;
    dxMm: number;
    dyMm: number;
    wavelengthUm: number;
    waistRadiusMm: number;
  };
  distanceMm: number;
  method?: "fresnel" | "angular-spectrum";
  apertureRadiusMm?: number;
  samplingBeamRadiusMm?: number;
  onProgress?: FieldProgressCallback;
  // S17: true transverse mode instead of the fundamental. ISO semantics: the
  // waist is the mode's MEASURED second-moment waist.
  mode?: TransverseMode;
};

export type FieldFresnelJobResult = {
  inputPower: number;
  outputPower: number;
  momentRadiusXmm: number;
  momentRadiusYmm: number;
  inputImage: FieldImageGrid;
  outputImage: FieldImageGrid;
  warnings: SimulationWarning[];
};

export type FieldGridInput = {
  nx: number;
  ny: number;
  dxMm: number;
  dyMm: number;
};

export type FieldImageGrid = FieldGridInput & {
  values: number[];
  max: number;
};

export type FieldPlaneSummary = {
  zMm: number;
  label: string;
  componentId?: string;
  power: number;
  radiusXmm: number;
  radiusYmm: number;
};

export type FieldBeamlineJobInput = {
  beamline: BeamlineInput;
  grid: FieldGridInput;
  method?: "fresnel" | "angular-spectrum";
  includePlanes?: boolean;
  samplingBeamRadiusMm?: number;
  // S13 part B: physical z positions (mm) at which the propagated field is
  // read out with |E|^2 image and second moments. Positions inside free-space,
  // slab or thick-lens spans split the propagation; positions past the last
  // component continue in free space. Results are sorted by z; a probe exactly
  // at a zero-length element (lens, aperture) samples AFTER that element.
  probesZmm?: number[];
  onProgress?: FieldProgressCallback;
  // S14 option 1: how curved elements imprint their phase. "ideal" (default)
  // keeps the paraxial EFL phase mask; "real-sag" applies the exact spherical
  // sag of each thick-lens surface (thin-element approximation) so sag-driven
  // spherical aberration becomes visible. TEA limitation (documented in
  // docs/theory/field_mode.md): incidence-angle aberration contributions are
  // not modeled, so orientation asymmetry vanishes as thickness -> 0.
  surfacePhase?: "ideal" | "real-sag";
  // S17: render the source as a true HG/LG mode field. ISO semantics: the
  // beam waist is the mode's MEASURED second-moment waist (the embedded
  // Gaussian is smaller by sqrt(M2) per axis); set the beam M2 to the mode M2
  // for a consistent fast-mode cross-check.
  sourceMode?: TransverseMode;
};

export type FieldBeamlineProbeResult = FieldPlaneSummary & { image: FieldImageGrid };

export type FieldBeamlineJobResult = {
  analytical: BeamlineResult;
  finalPlane: FieldPlaneSummary;
  planes: FieldPlaneSummary[];
  probes: FieldBeamlineProbeResult[];
  image: FieldImageGrid;
  warnings: SimulationWarning[];
};

export type HeadlessJobInput =
  | { kind: "modeforge-project"; project: ModeForgeProject }
  | { kind: "two-lens-optimizer"; input: TwoLensOptimizationInput }
  | { kind: "zmx-import"; text: string; wavelengthUm?: number; materials?: MaterialModel[] }
  | { kind: "agf-import"; text: string }
  | { kind: "measured-beam-fit"; wavelengthUm: number; measurements: BeamWidthMeasurement[] }
  | { kind: "field-fresnel"; input: FieldFresnelJobInput }
  | { kind: "field-beamline"; input: FieldBeamlineJobInput };

export type HeadlessJobResult =
  | { version: "0.1"; kind: "modeforge-project"; result: HeadlessRunResult; warnings: SimulationWarning[] }
  | { version: "0.1"; kind: "two-lens-optimizer"; result: TwoLensOptimizationResult; warnings: SimulationWarning[] }
  | { version: "0.1"; kind: "zmx-import"; result: CatalogImportResult<unknown>; warnings: SimulationWarning[] }
  | { version: "0.1"; kind: "agf-import"; result: AgfParseResult; warnings: SimulationWarning[] }
  | { version: "0.1"; kind: "measured-beam-fit"; result: BeamFitResult; warnings: SimulationWarning[] }
  | { version: "0.1"; kind: "field-fresnel"; result: FieldFresnelJobResult; warnings: SimulationWarning[] }
  | { version: "0.1"; kind: "field-beamline"; result: FieldBeamlineJobResult; warnings: SimulationWarning[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function projectToBeamlineInput(project: ModeForgeProject): BeamlineInput {
  return {
    version: project.version,
    beam: project.beam,
    components: project.beamline,
    pulse: project.pulses,
  };
}

export function runModeForgeProject(project: ModeForgeProject): HeadlessRunResult {
  const beamline = simulateBeamline(projectToBeamlineInput(project));
  return {
    version: project.version,
    beamline,
    warnings: beamline.warnings,
  };
}

export function runModeForgeProjectJson(json: string): ValidationResult<HeadlessRunResult> {
  const project = parseProjectJson(json);
  if (!project.ok) return project;
  try {
    const result = runModeForgeProject(project.value);
    if (result.beamline.warnings.some((item) => item.severity === "error")) {
      return { ok: false, errors: result.beamline.warnings.filter((item) => item.severity === "error").map((item) => item.message) };
    }
    return { ok: true, value: result, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function runFieldFresnelJob(input: FieldFresnelJobInput): FieldFresnelJobResult {
  let field =
    input.field ??
    (input.gaussian
      ? input.mode
        ? createModeFieldAtPlane({
            ...input.gaussian,
            // ISO semantics like the beamline path: the waist is the measured
            // second-moment waist; the embedded Gaussian is smaller per axis
            radiusXmm:
              input.gaussian.waistRadiusMm /
              Math.sqrt(input.mode.kind === "HG" ? 2 * input.mode.m + 1 : 2 * input.mode.p + Math.abs(input.mode.l) + 1),
            radiusYmm:
              input.gaussian.waistRadiusMm /
              Math.sqrt(input.mode.kind === "HG" ? 2 * input.mode.n + 1 : 2 * input.mode.p + Math.abs(input.mode.l) + 1),
            mode: input.mode,
          })
        : createGaussianField(input.gaussian)
      : undefined);
  if (!field) throw new RangeError("field-fresnel job requires field or gaussian input");
  input.onProgress?.({ done: 0, total: 1 });
  const inputPower = fieldPower(field);
  if (input.apertureRadiusMm !== undefined) field = applyCircularAperture(field, input.apertureRadiusMm);
  const inputImage = fieldImage(field);
  const propagated =
    input.method === "angular-spectrum" ? propagateAngularSpectrum(field, input.distanceMm) : propagateFresnel(field, input.distanceMm);
  input.onProgress?.({ done: 1, total: 1 });
  const outputPower = fieldPower(propagated);
  const radii = fieldMomentRadii(propagated);
  const warnings = input.samplingBeamRadiusMm !== undefined ? fieldSamplingWarnings(field, input.samplingBeamRadiusMm) : [];
  return {
    inputPower,
    outputPower,
    momentRadiusXmm: radii.radiusXmm,
    momentRadiusYmm: radii.radiusYmm,
    inputImage,
    outputImage: fieldImage(propagated),
    warnings,
  };
}

function wavefrontRadiusFromQ(q: Complex): number | undefined {
  const inverse = inverseComplex(q);
  if (Math.abs(inverse.re) < 1e-12) return undefined;
  return 1 / inverse.re;
}

function initialQs(beam: BeamInput): { qx: Complex; qy: Complex; wavelengthUm: number; m2Warning?: SimulationWarning } {
  if (beam.kind === "gaussian") {
    const m2 = beam.m2 ?? 1;
    return {
      qx: qAtZ(-beam.waistPositionMm, beam.waistRadiusMm, beam.wavelengthUm, m2),
      qy: qAtZ(-beam.waistPositionMm, beam.waistRadiusMm, beam.wavelengthUm, m2),
      wavelengthUm: beam.wavelengthUm * m2,
      m2Warning:
        m2 === 1
          ? undefined
          : warning("UNSUPPORTED_PROFILE_PROPAGATION", "Field beamline uses effective wavelength to approximate Gaussian M2 propagation.", "warning"),
    };
  }
  if (beam.kind === "elliptical-gaussian") {
    const m2x = beam.m2x ?? 1;
    const m2y = beam.m2y ?? 1;
    // equal per-axis M2 admits the same exact effective-wavelength trick as
    // the symmetric Gaussian; unequal M2 cannot be modeled in a single scalar
    // run - say so honestly instead of silently propagating with M2 = 1
    // divergence (S17 cross-review finding)
    return {
      qx: qAtZ(-beam.waistPositionXmm, beam.waistRadiusXmm, beam.wavelengthUm, m2x),
      qy: qAtZ(-beam.waistPositionYmm, beam.waistRadiusYmm, beam.wavelengthUm, m2y),
      wavelengthUm: m2x === m2y ? beam.wavelengthUm * m2x : beam.wavelengthUm,
      m2Warning:
        m2x === 1 && m2y === 1
          ? undefined
          : m2x === m2y
            ? warning("UNSUPPORTED_PROFILE_PROPAGATION", "Field beamline uses effective wavelength to approximate Gaussian M2 propagation.", "warning")
            : warning(
                "UNSUPPORTED_PROFILE_PROPAGATION",
                `Different x/y M2 values (${m2x}/${m2y}) cannot be modeled in a single scalar run: the field propagates with M2 = 1 divergence. Treat field results as qualitative for this beam.`,
                "warning",
              ),
    };
  }
  return {
    qx: qAtZ(-beam.waistPositionXmm, beam.d4SigmaDiameterXmm / 2, beam.wavelengthUm, beam.m2x),
    qy: qAtZ(-(beam.waistPositionYmm ?? beam.waistPositionXmm), (beam.d4SigmaDiameterYmm ?? beam.d4SigmaDiameterXmm) / 2, beam.wavelengthUm, beam.m2y ?? beam.m2x),
    wavelengthUm: beam.m2x === (beam.m2y ?? beam.m2x) ? beam.wavelengthUm * beam.m2x : beam.wavelengthUm,
    m2Warning: warning(
      "UNSUPPORTED_PROFILE_PROPAGATION",
      beam.m2x === (beam.m2y ?? beam.m2x)
        ? "Field beamline approximates the moment beam as a Gaussian field (effective-wavelength M2 propagation)."
        : `Moment beam with different x/y M2 (${beam.m2x}/${beam.m2y}) cannot be modeled in a single scalar run: the field propagates with M2 = 1 divergence. Treat field results as qualitative.`,
      "warning",
    ),
  };
}

function embeddedWaists(beam: BeamInput): { w0xMm: number; w0yMm: number; z0xMm: number; z0yMm: number } {
  if (beam.kind === "gaussian")
    return { w0xMm: beam.waistRadiusMm, w0yMm: beam.waistRadiusMm, z0xMm: beam.waistPositionMm, z0yMm: beam.waistPositionMm };
  if (beam.kind === "elliptical-gaussian")
    return { w0xMm: beam.waistRadiusXmm, w0yMm: beam.waistRadiusYmm, z0xMm: beam.waistPositionXmm, z0yMm: beam.waistPositionYmm };
  return {
    w0xMm: beam.d4SigmaDiameterXmm / 2,
    w0yMm: (beam.d4SigmaDiameterYmm ?? beam.d4SigmaDiameterXmm) / 2,
    z0xMm: beam.waistPositionXmm,
    z0yMm: beam.waistPositionYmm ?? beam.waistPositionXmm,
  };
}

function fieldFromBeam(beam: BeamInput, grid: FieldGridInput, mode?: TransverseMode): { field: ScalarField; warnings: SimulationWarning[] } {
  if (mode) {
    // true mode source: the user waist is the EMBEDDED-Gaussian waist, so the
    // plane geometry (w, R) comes from the M2=1 embedded q at the true
    // wavelength; the mode structure carries its own M2 under propagation.
    const { w0xMm, w0yMm, z0xMm, z0yMm } = embeddedWaists(beam);
    // ISO-style semantics: the beam waist is the MEASURED second-moment waist
    // of the mode; the embedded Gaussian is smaller by sqrt(M2) per axis
    const m2xMode = mode.kind === "HG" ? 2 * mode.m + 1 : 2 * mode.p + Math.abs(mode.l) + 1;
    const m2yMode = mode.kind === "HG" ? 2 * mode.n + 1 : m2xMode;
    const qx = qAtZ(-z0xMm, w0xMm / Math.sqrt(m2xMode), beam.wavelengthUm, 1);
    const qy = qAtZ(-z0yMm, w0yMm / Math.sqrt(m2yMode), beam.wavelengthUm, 1);
    const label = mode.kind === "HG" ? `HG(${mode.m},${mode.n})` : `LG(${mode.p},${mode.l})`;
    const modeWarnings: SimulationWarning[] = [];
    if (mode.kind === "LG" && (Math.abs(w0xMm - w0yMm) > 1e-12 || Math.abs(z0xMm - z0yMm) > 1e-12)) {
      modeWarnings.push(
        warning(
          "UNSUPPORTED_PROFILE_PROPAGATION",
          `LG modes are rotationally symmetric: the elliptical source was circularized using the x-axis waist ${w0xMm} mm.`,
          "warning",
        ),
      );
    }
    const m2Hint =
      m2xMode === m2yMode
        ? `Set the beam M2 to ${m2xMode} for a consistent fast-mode cross-check.`
        : `Set M2x = ${m2xMode} and M2y = ${m2yMode} (elliptical beam) for a consistent per-axis cross-check.`;
    return {
      field: createModeFieldAtPlane({
        ...grid,
        wavelengthUm: beam.wavelengthUm,
        radiusXmm: radiusFromQ(qx, beam.wavelengthUm, 1),
        radiusYmm: radiusFromQ(qy, beam.wavelengthUm, 1),
        wavefrontRadiusXmm: wavefrontRadiusFromQ(qx),
        wavefrontRadiusYmm: wavefrontRadiusFromQ(qy),
        mode,
      }),
      warnings: [
        ...modeWarnings,
        warning(
          "UNSUPPORTED_PROFILE_PROPAGATION",
          `Mode source ${label}: the beam waist is read as the mode's measured second-moment waist (embedded Gaussian w0/sqrt(M2) per axis). ${m2Hint}`,
          "info",
        ),
      ],
    };
  }
  const { qx, qy, wavelengthUm, m2Warning } = initialQs(beam);
  const warnings = m2Warning ? [m2Warning] : [];
  return {
    field: createGaussianFieldAtPlane({
      ...grid,
      wavelengthUm,
      radiusXmm: radiusFromQ(qx, beam.wavelengthUm, beam.kind === "gaussian" ? beam.m2 ?? 1 : beam.kind === "elliptical-gaussian" ? beam.m2x ?? 1 : beam.m2x),
      radiusYmm: radiusFromQ(qy, beam.wavelengthUm, beam.kind === "gaussian" ? beam.m2 ?? 1 : beam.kind === "elliptical-gaussian" ? beam.m2y ?? 1 : beam.m2y ?? beam.m2x),
      wavefrontRadiusXmm: wavefrontRadiusFromQ(qx),
      wavefrontRadiusYmm: wavefrontRadiusFromQ(qy),
    }),
    warnings,
  };
}

function propagateField(field: ScalarField, distanceMm: number, method: FieldBeamlineJobInput["method"]): ScalarField {
  return method === "angular-spectrum" ? propagateAngularSpectrum(field, distanceMm) : propagateFresnel(field, distanceMm);
}

function componentLength(component: BeamlineComponent): number {
  if (component.kind === "free-space") return component.lengthMm;
  if (component.kind === "slab") return component.thicknessMm;
  if (component.kind === "thick-lens") return component.thicknessMm;
  return 0;
}

function componentApertureRadius(component: BeamlineComponent): number | undefined {
  return "apertureRadiusMm" in component ? component.apertureRadiusMm : undefined;
}

type FieldStep =
  | { kind: "propagate"; physicalMm: number; opticalMm: number }
  | { kind: "transform"; apply: (field: ScalarField) => ScalarField };

// Field-domain interpretation of a component: zero-length phase/aperture
// transforms plus propagation spans (physical length vs. reduced optical path).
function componentFieldSteps(component: BeamlineComponent, surfacePhase: "ideal" | "real-sag" = "ideal"): FieldStep[] {
  const steps: FieldStep[] = [];
  if (component.kind === "free-space")
    steps.push({ kind: "propagate", physicalMm: component.lengthMm, opticalMm: component.lengthMm / (component.refractiveIndex ?? 1) });
  if (component.kind === "slab")
    steps.push({ kind: "propagate", physicalMm: component.thicknessMm, opticalMm: component.thicknessMm / component.refractiveIndex });
  if (component.kind === "thin-lens") steps.push({ kind: "transform", apply: (field) => applyThinLensPhase(field, component.focalLengthMm) });
  if (component.kind === "cylindrical-lens")
    steps.push({ kind: "transform", apply: (field) => applyThinLensPhase(field, component.focalLengthMm, component.axis) });
  if (component.kind === "thick-lens" && surfacePhase === "real-sag") {
    // real surface geometry: exact sag phase per surface + internal reduced path
    steps.push({ kind: "transform", apply: (field) => applySphericalSurfacePhase(field, component.radius1Mm, 1, component.refractiveIndex) });
    steps.push({ kind: "propagate", physicalMm: component.thicknessMm, opticalMm: component.thicknessMm / component.refractiveIndex });
    steps.push({ kind: "transform", apply: (field) => applySphericalSurfacePhase(field, component.radius2Mm, component.refractiveIndex, 1) });
  } else if (component.kind === "thick-lens") {
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
    const focal = card.effectiveFocalLengthMm;
    if (focal !== undefined) steps.push({ kind: "transform", apply: (field) => applyThinLensPhase(field, focal) });
    steps.push({ kind: "propagate", physicalMm: component.thicknessMm, opticalMm: component.thicknessMm / component.refractiveIndex });
  }
  if (component.kind === "surface-stack") {
    if (surfacePhase === "real-sag") {
      // surface-by-surface: exact sag phase (glass-glass included via deltaN),
      // per-surface apertures, reduced path per gap
      let nCurrent = 1;
      for (const surface of component.surfaces) {
        const nBefore = nCurrent;
        const nAfter = surface.refractiveIndexAfter;
        steps.push({ kind: "transform", apply: (field) => applySphericalSurfacePhase(field, surface.radiusMm, nBefore, nAfter) });
        if (surface.apertureRadiusMm !== undefined) {
          const aperture = surface.apertureRadiusMm;
          steps.push({ kind: "transform", apply: (field) => applyCircularAperture(field, aperture) });
        }
        if (surface.thicknessAfterMm > 0) {
          steps.push({ kind: "propagate", physicalMm: surface.thicknessAfterMm, opticalMm: surface.thicknessAfterMm / nAfter });
        }
        nCurrent = nAfter;
      }
    } else {
      // ideal mode mirrors the thick-lens crudeness: one EFL phase up front,
      // one reduced-path span, tightest aperture at the exit
      const card = paraxialCard(stackOpticFromComponent(component));
      const focal = card.effectiveFocalLengthMm;
      if (focal !== undefined) steps.push({ kind: "transform", apply: (field) => applyThinLensPhase(field, focal) });
      const physicalMm = component.surfaces.reduce((sum, surface) => sum + surface.thicknessAfterMm, 0);
      const opticalMm = component.surfaces.reduce((sum, surface) => sum + surface.thicknessAfterMm / surface.refractiveIndexAfter, 0);
      if (physicalMm > 0) steps.push({ kind: "propagate", physicalMm, opticalMm });
      const minAperture = component.surfaces.reduce<number | undefined>(
        (min, surface) =>
          surface.apertureRadiusMm !== undefined && (min === undefined || surface.apertureRadiusMm < min) ? surface.apertureRadiusMm : min,
        undefined,
      );
      if (minAperture !== undefined) steps.push({ kind: "transform", apply: (field) => applyCircularAperture(field, minAperture) });
    }
    return steps;
  }
  const apertureRadius = component.kind === "aperture" ? component.apertureRadiusMm : componentApertureRadius(component);
  if (apertureRadius !== undefined) steps.push({ kind: "transform", apply: (field) => applyCircularAperture(field, apertureRadius) });
  return steps;
}

function summarizeFieldPlane(field: ScalarField, zMm: number, label: string, componentId?: string): FieldPlaneSummary {
  const radii = fieldMomentRadii(field);
  return {
    zMm,
    label,
    componentId,
    power: fieldPower(field),
    radiusXmm: radii.radiusXmm,
    radiusYmm: radii.radiusYmm,
  };
}

function fieldImage(field: ScalarField): FieldImageGrid {
  const values = fieldIntensity(field);
  const max = Math.max(...values);
  return { nx: field.nx, ny: field.ny, dxMm: field.dxMm, dyMm: field.dyMm, values: max > 0 ? values.map((value) => value / max) : values, max };
}

function runFieldBeamlineJob(input: FieldBeamlineJobInput): FieldBeamlineJobResult {
  const analytical = simulateBeamline(input.beamline);
  if (analytical.warnings.some((item) => item.severity === "error")) {
    return {
      analytical,
      finalPlane: { zMm: 0, label: "invalid", power: 0, radiusXmm: 0, radiusYmm: 0 },
      planes: [],
      probes: [],
      image: { ...input.grid, values: [], max: 0 },
      warnings: analytical.warnings,
    };
  }
  const { field: initialField, warnings } = fieldFromBeam(input.beamline.beam, input.grid, input.sourceMode);

  const requestedProbes = input.probesZmm ?? [];
  const probeQueue = requestedProbes.filter((z) => Number.isFinite(z) && z >= 0).sort((a, b) => a - b);
  const invalidProbeCount = requestedProbes.length - probeQueue.length;
  const probeWarnings =
    invalidProbeCount > 0
      ? [warning("INVALID_INPUT", `${invalidProbeCount} probe position(s) ignored: probesZmm entries must be finite and >= 0.`, "warning")]
      : [];
  const probes: FieldBeamlineProbeResult[] = [];
  const probeSamplingWarnings: SimulationWarning[] = [];
  let probeIndex = 0;

  // exact propagation-segment count for progress reporting — mirrors the
  // split arithmetic of the real walk below (probe splits + beyond-end runs)
  const totalSegments = (() => {
    let z = 0;
    let qi = 0;
    let count = 0;
    const countSpan = (physicalMm: number): void => {
      const spanEnd = z + physicalMm;
      // strictly inside only: a probe AT the span end samples after the
      // zero-length transforms that follow (spec: sample-after-element)
      while (qi < probeQueue.length && probeQueue[qi] < spanEnd - 1e-9) {
        const step = Math.max(0, Math.min(probeQueue[qi], spanEnd) - z);
        if (step > 0) {
          count += 1;
          z += step;
        }
        qi += 1;
      }
      if (spanEnd - z > 0) {
        count += 1;
        z = spanEnd;
      }
    };
    for (const component of input.beamline.components) {
      for (const step of componentFieldSteps(component, input.surfacePhase)) if (step.kind === "propagate") countSpan(step.physicalMm);
    }
    while (qi < probeQueue.length) {
      if (probeQueue[qi] - z > 1e-9) {
        count += 1;
        z = probeQueue[qi];
      }
      qi += 1;
    }
    return count;
  })();
  let doneSegments = 0;
  input.onProgress?.({ done: 0, total: totalSegments });

  let field = initialField;
  let zMm = 0;
  const capture = (probeZ: number): void => {
    const summary = summarizeFieldPlane(field, probeZ, "probe");
    probes.push({ ...summary, image: fieldImage(field) });
    // sampling check at the probe plane itself, using the field's own moments
    const probeRadius = Math.max(summary.radiusXmm, summary.radiusYmm);
    if (Number.isFinite(probeRadius) && probeRadius > 0) {
      probeSamplingWarnings.push(...fieldSamplingWarnings(field, probeRadius).map((item) => ({ ...item, zMm: probeZ })));
    }
  };
  // Propagate one span, splitting it at every probe position that falls inside.
  // opticalMm is the reduced path actually propagated (t/n inside glass) while
  // probe positions are expressed in physical z.
  const propagateSpan = (physicalMm: number, opticalMm: number): void => {
    const spanEnd = zMm + physicalMm;
    const opticalPerPhysical = physicalMm > 0 ? opticalMm / physicalMm : 0;
    // Probes exactly AT the span end are deliberately NOT consumed here: they
    // are captured at the start of the next span (or in the beyond-end loop),
    // i.e. AFTER any zero-length transforms sitting at that z — this is the
    // documented sample-after-element convention and matters for apertures
    // (S16 final audit finding F14).
    while (probeIndex < probeQueue.length && probeQueue[probeIndex] < spanEnd - 1e-9) {
      const probeZ = Math.min(probeQueue[probeIndex], spanEnd);
      const stepMm = Math.max(0, probeZ - zMm);
      if (stepMm > 0) {
        field = propagateField(field, stepMm * opticalPerPhysical, input.method);
        doneSegments += 1;
        input.onProgress?.({ done: doneSegments, total: totalSegments });
      }
      zMm += stepMm;
      capture(probeQueue[probeIndex]);
      probeIndex += 1;
    }
    const restMm = spanEnd - zMm;
    if (restMm > 0) {
      field = propagateField(field, restMm * opticalPerPhysical, input.method);
      doneSegments += 1;
      input.onProgress?.({ done: doneSegments, total: totalSegments });
      zMm = spanEnd;
    }
  };

  // Honest focus check (first live-user report): if an analytic waist inside
  // the propagated range is smaller than ~2 grid cells, the focal field is
  // unrepresentable on this grid - the DFT aliases the lens chirp into a
  // periodic dot pattern. Say so explicitly instead of letting a soothing
  // "diffraction expected" note stand next to a 6000% deviation.
  const focusWarnings: SimulationWarning[] = [];
  {
    const dxMax = Math.max(input.grid.dxMm, input.grid.dyMm);
    const zEndOfWalk = Math.max(analytical.zGridMm.at(-1) ?? 0, ...probeQueue, 0);
    const extentMm = Math.max(input.grid.nx * input.grid.dxMm, input.grid.ny * input.grid.dyMm);
    for (const waist of analytical.waists) {
      if (!(waist.zMm >= 0) || !(waist.radiusMm > 0)) continue;
      // smallest analytic radius the walk actually reaches: the waist itself
      // if it lies inside the walk, else the radius at the walk end
      const distBeyondMm = Math.max(0, waist.zMm - zEndOfWalk);
      const minReachedRadiusMm =
        distBeyondMm === 0
          ? waist.radiusMm
          : gaussianRadiusAtZ(distBeyondMm, waist.radiusMm, input.beamline.beam.wavelengthUm, waist.m2 ?? 1);
      if (minReachedRadiusMm >= 2 * dxMax) continue;
      const neededN = Math.ceil(extentMm / (waist.radiusMm / 3));
      focusWarnings.push(
        warning(
          "FIELD_SAMPLING_LOW",
          `Analytic focus w = ${(waist.radiusMm * 1000).toFixed(2)} um (${waist.axis}) at z = ${waist.zMm.toFixed(2)} mm is smaller than the grid cell dx = ${(dxMax * 1000).toFixed(1)} um: the focal field CANNOT be resolved on this grid and aliasing artifacts are expected near the focus. Resolving it would need roughly N >= ${neededN} at this extent - probe away from the focus or reduce the numerical aperture.`,
          "warning",
          { zMm: waist.zMm },
        ),
      );
      break;
    }
  }

  // real-sag mode: per-surface mask sampling guards against the actual grid
  const surfaceWarnings: SimulationWarning[] = [];
  if (input.surfacePhase === "real-sag") {
    const fallbackAperture = (Math.min(input.grid.nx * input.grid.dxMm, input.grid.ny * input.grid.dyMm) / 2) * 0.999;
    for (const component of input.beamline.components) {
      if (component.kind !== "thick-lens" && component.kind !== "surface-stack") continue;
      // beam-relevant radius = analytic envelope where the beam ENTERS this lens
      const componentResult = analytical.components.find((item) => item.componentId === component.id);
      const zIndex = componentResult ? analytical.zGridMm.indexOf(componentResult.startZmm) : -1;
      const beamRadius =
        zIndex >= 0
          ? Math.max(analytical.envelope.radiusXmm[zIndex] ?? 0, analytical.envelope.radiusYmm?.[zIndex] ?? 0) || undefined
          : undefined;
      if (component.kind === "thick-lens") {
        const aperture = component.apertureRadiusMm ?? fallbackAperture;
        surfaceWarnings.push(
          ...surfacePhaseSamplingWarnings(initialField, component.radius1Mm, 1, component.refractiveIndex, aperture, beamRadius).map(
            (item) => ({ ...item, componentId: component.id }),
          ),
          ...surfacePhaseSamplingWarnings(initialField, component.radius2Mm, component.refractiveIndex, 1, aperture, beamRadius).map(
            (item) => ({ ...item, componentId: component.id }),
          ),
        );
      } else {
        let nCurrent = 1;
        for (const surface of component.surfaces) {
          const aperture = surface.apertureRadiusMm ?? fallbackAperture;
          surfaceWarnings.push(
            ...surfacePhaseSamplingWarnings(initialField, surface.radiusMm, nCurrent, surface.refractiveIndexAfter, aperture, beamRadius).map(
              (item) => ({ ...item, componentId: component.id }),
            ),
          );
          nCurrent = surface.refractiveIndexAfter;
        }
      }
    }
  }

  const planes: FieldPlaneSummary[] = [summarizeFieldPlane(field, zMm, "input")];
  for (const component of input.beamline.components) {
    for (const step of componentFieldSteps(component, input.surfacePhase)) {
      if (step.kind === "transform") field = step.apply(field);
      else propagateSpan(step.physicalMm, step.opticalMm);
    }
    if (input.includePlanes !== false) planes.push(summarizeFieldPlane(field, zMm, component.kind, component.id));
  }
  const finalPlane = summarizeFieldPlane(field, zMm, "output");
  const finalImage = fieldImage(field);
  const samplingRadius = input.samplingBeamRadiusMm ?? analytical.envelope.radiusXmm.at(-1);
  const samplingWarnings = samplingRadius === undefined ? [] : fieldSamplingWarnings(field, samplingRadius);
  // probes at or past the end of the beamline: continue in free space
  while (probeIndex < probeQueue.length) {
    const stepMm = probeQueue[probeIndex] - zMm;
    if (stepMm > 1e-9) {
      field = propagateField(field, stepMm, input.method);
      doneSegments += 1;
      input.onProgress?.({ done: doneSegments, total: totalSegments });
      zMm = probeQueue[probeIndex];
    }
    capture(probeQueue[probeIndex]);
    probeIndex += 1;
  }
  return {
    analytical,
    finalPlane,
    planes,
    probes,
    image: finalImage,
    warnings: [...analytical.warnings, ...warnings, ...focusWarnings, ...surfaceWarnings, ...probeWarnings, ...samplingWarnings, ...probeSamplingWarnings],
  };
}

export function runHeadlessJob(input: HeadlessJobInput): ValidationResult<HeadlessJobResult> {
  try {
    if (input.kind === "modeforge-project") {
      const result = runModeForgeProject(input.project);
      return { ok: true, value: { version: "0.1", kind: input.kind, result, warnings: result.warnings }, errors: [] };
    }
    if (input.kind === "two-lens-optimizer") {
      const result = optimizeTwoLensTelescope(input.input);
      return { ok: true, value: { version: "0.1", kind: input.kind, result, warnings: result.warnings }, errors: [] };
    }
    if (input.kind === "zmx-import") {
      const result = parseZmxSequential(input.text, { wavelengthUm: input.wavelengthUm, materials: input.materials });
      return { ok: true, value: { version: "0.1", kind: input.kind, result, warnings: result.warnings }, errors: [] };
    }
    if (input.kind === "agf-import") {
      const result = parseAgfCatalog(input.text);
      return { ok: true, value: { version: "0.1", kind: input.kind, result, warnings: result.warnings }, errors: [] };
    }
    if (input.kind === "measured-beam-fit") {
      const result = fitGaussianBeamFromRadii(input.measurements, input.wavelengthUm);
      return { ok: true, value: { version: "0.1", kind: input.kind, result, warnings: result.warnings }, errors: [] };
    }
    if (input.kind === "field-fresnel") {
      const result = runFieldFresnelJob(input.input);
      return { ok: true, value: { version: "0.1", kind: input.kind, result, warnings: result.warnings }, errors: [] };
    }
    if (input.kind === "field-beamline") {
      const result = runFieldBeamlineJob(input.input);
      return { ok: true, value: { version: "0.1", kind: input.kind, result, warnings: result.warnings }, errors: [] };
    }
    return { ok: false, errors: ["unknown headless job kind"] };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function runHeadlessJobJson(json: string): ValidationResult<HeadlessJobResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
  if (!isRecord(parsed)) return { ok: false, errors: ["headless job JSON must be an object"] };
  if (typeof parsed.kind !== "string") return { ok: false, errors: ["headless job kind is required"] };
  return runHeadlessJob(parsed as HeadlessJobInput);
}
