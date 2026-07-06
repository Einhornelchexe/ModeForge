import {
  assertFiniteNumber,
  assertPositive,
  warning,
  type BeamInput,
  type BeamlineComponent,
  type BeamlineResult,
  type PulseInput,
  type SimulationWarning,
} from "../../core/src/index.ts";
import { simulateBeamline } from "../../optics/src/index.ts";

export type LensCandidate = {
  id: string;
  focalLengthMm: number;
  apertureRadiusMm?: number;
};

export type TwoLensOptimizationInput = {
  version: "0.1";
  beam: BeamInput;
  pulse?: PulseInput;
  lenses: LensCandidate[];
  search: {
    lens1Zmm: number[];
    lens2Zmm: number[];
    targetZmm: number;
    targetRadiusMm?: number;
    targetDiameterMm?: number;
    targetWaistRadiusMm?: number;
    targetWaistZmm?: number;
    targetFluenceJPerCm2?: number;
    targetPeakIntensityWPerCm2?: number;
    maxFluenceJPerCm2?: number;
    maxPeakIntensityWPerCm2?: number;
    beamlineLengthMaxMm?: number;
    minSeparationMm?: number;
    apertureMarginMin?: number;
    maxResults?: number;
    sensitivityShiftMm?: number;
    sensitivityFocalLengthMm?: number;
    sensitivityM2Delta?: number;
  };
};

export type TwoLensSolution = {
  rank: number;
  score: number;
  lens1: LensCandidate;
  lens2: LensCandidate;
  lens1Zmm: number;
  lens2Zmm: number;
  targetZmm: number;
  targetRadiusMm?: number;
  targetDiameterMm?: number;
  targetWaistRadiusMm?: number;
  targetWaistZmm?: number;
  achievedRadiusMm: number;
  achievedDiameterMm: number;
  achievedWaistRadiusMm?: number;
  achievedWaistZmm?: number;
  beamline: BeamlineResult;
  sensitivity?: {
    positionShiftMm?: number;
    focalLengthShiftMm?: number;
    m2Delta?: number;
    maxRadiusDeltaFromPositionMm?: number;
    maxRadiusDeltaFromFocalLengthMm?: number;
    maxRadiusDeltaFromM2Mm?: number;
    maxRadiusDeltaMm: number;
  };
  warnings: SimulationWarning[];
};

export type TwoLensOptimizationResult = {
  solutions: TwoLensSolution[];
  warnings: SimulationWarning[];
};

function validateInput(input: TwoLensOptimizationInput): string[] {
  const errors: string[] = [];
  try {
    if (input.version !== "0.1") errors.push("optimizer version must be 0.1");
    if (input.lenses.length === 0) errors.push("at least one lens candidate is required");
    for (const lens of input.lenses) {
      if (!lens.id) errors.push("lens id is required");
      assertFiniteNumber(lens.focalLengthMm, "focalLengthMm");
      if (lens.focalLengthMm === 0) errors.push("focalLengthMm must be non-zero");
      if (lens.apertureRadiusMm !== undefined) assertPositive(lens.apertureRadiusMm, "apertureRadiusMm");
    }
    if (input.search.lens1Zmm.length === 0) errors.push("lens1Zmm search grid must not be empty");
    if (input.search.lens2Zmm.length === 0) errors.push("lens2Zmm search grid must not be empty");
    for (const z of input.search.lens1Zmm) assertPositive(z, "lens1Zmm");
    for (const z of input.search.lens2Zmm) assertPositive(z, "lens2Zmm");
    assertPositive(input.search.targetZmm, "targetZmm");
    const hasSpatialTarget =
      input.search.targetRadiusMm !== undefined ||
      input.search.targetDiameterMm !== undefined ||
      input.search.targetWaistRadiusMm !== undefined ||
      input.search.targetWaistZmm !== undefined ||
      input.search.targetFluenceJPerCm2 !== undefined ||
      input.search.targetPeakIntensityWPerCm2 !== undefined;
    if (!hasSpatialTarget) errors.push("at least one target radius, diameter, waist, fluence, or peak-intensity value is required");
    if (input.search.targetRadiusMm !== undefined && input.search.targetDiameterMm !== undefined) {
      errors.push("targetRadiusMm and targetDiameterMm are mutually exclusive");
    }
    if (input.search.targetRadiusMm !== undefined) assertPositive(input.search.targetRadiusMm, "targetRadiusMm");
    if (input.search.targetDiameterMm !== undefined) assertPositive(input.search.targetDiameterMm, "targetDiameterMm");
    if (input.search.targetWaistRadiusMm !== undefined) assertPositive(input.search.targetWaistRadiusMm, "targetWaistRadiusMm");
    if (input.search.targetWaistZmm !== undefined) assertFiniteNumber(input.search.targetWaistZmm, "targetWaistZmm");
    if (input.search.beamlineLengthMaxMm !== undefined) assertPositive(input.search.beamlineLengthMaxMm, "beamlineLengthMaxMm");
    if (input.search.minSeparationMm !== undefined) assertPositive(input.search.minSeparationMm, "minSeparationMm");
    if (input.search.apertureMarginMin !== undefined) assertPositive(input.search.apertureMarginMin, "apertureMarginMin");
    if (input.search.maxResults !== undefined) assertPositive(input.search.maxResults, "maxResults");
    if (input.search.sensitivityShiftMm !== undefined) assertPositive(input.search.sensitivityShiftMm, "sensitivityShiftMm");
    if (input.search.sensitivityFocalLengthMm !== undefined) assertPositive(input.search.sensitivityFocalLengthMm, "sensitivityFocalLengthMm");
    if (input.search.sensitivityM2Delta !== undefined) assertPositive(input.search.sensitivityM2Delta, "sensitivityM2Delta");
    if (input.search.maxFluenceJPerCm2 !== undefined) assertPositive(input.search.maxFluenceJPerCm2, "maxFluenceJPerCm2");
    if (input.search.maxPeakIntensityWPerCm2 !== undefined) assertPositive(input.search.maxPeakIntensityWPerCm2, "maxPeakIntensityWPerCm2");
    if (input.search.targetFluenceJPerCm2 !== undefined) assertPositive(input.search.targetFluenceJPerCm2, "targetFluenceJPerCm2");
    if (input.search.targetPeakIntensityWPerCm2 !== undefined) assertPositive(input.search.targetPeakIntensityWPerCm2, "targetPeakIntensityWPerCm2");
    if (
      !input.pulse &&
      (input.search.maxFluenceJPerCm2 !== undefined ||
        input.search.maxPeakIntensityWPerCm2 !== undefined ||
        input.search.targetFluenceJPerCm2 !== undefined ||
        input.search.targetPeakIntensityWPerCm2 !== undefined)
    ) {
      errors.push("pulse is required for fluence or peak-intensity optimizer constraints");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

function targetRadiusMm(input: TwoLensOptimizationInput): number | undefined {
  if (input.search.targetRadiusMm !== undefined) return input.search.targetRadiusMm;
  if (input.search.targetDiameterMm !== undefined) return input.search.targetDiameterMm / 2;
  return undefined;
}

function beamlineFor(input: TwoLensOptimizationInput, lens1: LensCandidate, lens2: LensCandidate, lens1Zmm: number, lens2Zmm: number): BeamlineComponent[] | undefined {
  const minSeparation = input.search.minSeparationMm ?? 0;
  if (lens2Zmm <= lens1Zmm) return undefined;
  if (lens2Zmm - lens1Zmm < minSeparation) return undefined;
  if (input.search.targetZmm <= lens2Zmm) return undefined;
  if (input.search.beamlineLengthMaxMm !== undefined && input.search.targetZmm > input.search.beamlineLengthMaxMm) return undefined;
  return [
    { id: "pre-lens-1", kind: "free-space", lengthMm: lens1Zmm },
    { id: lens1.id, kind: "thin-lens", focalLengthMm: lens1.focalLengthMm, apertureRadiusMm: lens1.apertureRadiusMm },
    { id: "between-lenses", kind: "free-space", lengthMm: lens2Zmm - lens1Zmm },
    { id: lens2.id, kind: "thin-lens", focalLengthMm: lens2.focalLengthMm, apertureRadiusMm: lens2.apertureRadiusMm },
    { id: "to-target", kind: "free-space", lengthMm: input.search.targetZmm - lens2Zmm },
  ];
}

function runAt(input: TwoLensOptimizationInput, lens1: LensCandidate, lens2: LensCandidate, lens1Zmm: number, lens2Zmm: number): BeamlineResult | undefined {
  const components = beamlineFor(input, lens1, lens2, lens1Zmm, lens2Zmm);
  if (!components) return undefined;
  return simulateBeamline({ version: "0.1", beam: input.beam, components, pulse: input.pulse });
}

function radiusAtTarget(result: BeamlineResult): number | undefined {
  return result.envelope.radiusXmm.at(-1);
}

function relativeErrorScore(actual: number, target: number): number {
  return Math.abs(actual - target) / target;
}

function pulseScoreAndConstraintPass(input: TwoLensOptimizationInput, result: BeamlineResult): { pass: boolean; score: number } {
  let score = 0;
  const pulse = result.pulse;
  if (input.search.maxFluenceJPerCm2 !== undefined && (pulse?.fluenceJPerCm2 === undefined || pulse.fluenceJPerCm2 > input.search.maxFluenceJPerCm2)) {
    return { pass: false, score };
  }
  if (
    input.search.maxPeakIntensityWPerCm2 !== undefined &&
    (pulse?.peakIntensityWPerCm2 === undefined || pulse.peakIntensityWPerCm2 > input.search.maxPeakIntensityWPerCm2)
  ) {
    return { pass: false, score };
  }
  if (input.search.targetFluenceJPerCm2 !== undefined) {
    if (pulse?.fluenceJPerCm2 === undefined) return { pass: false, score };
    score += relativeErrorScore(pulse.fluenceJPerCm2, input.search.targetFluenceJPerCm2);
  }
  if (input.search.targetPeakIntensityWPerCm2 !== undefined) {
    if (pulse?.peakIntensityWPerCm2 === undefined) return { pass: false, score };
    score += relativeErrorScore(pulse.peakIntensityWPerCm2, input.search.targetPeakIntensityWPerCm2);
  }
  return { pass: true, score };
}

function waistScore(input: TwoLensOptimizationInput, result: BeamlineResult): { score: number; radiusMm?: number; zMm?: number } {
  const waist = result.waists.find((item) => item.axis === "x") ?? result.waists[0];
  if (!waist) return { score: 0 };
  let score = 0;
  if (input.search.targetWaistRadiusMm !== undefined) score += relativeErrorScore(waist.radiusMm, input.search.targetWaistRadiusMm);
  if (input.search.targetWaistZmm !== undefined) {
    score += Math.abs(waist.zMm - input.search.targetWaistZmm) / Math.max(1, Math.abs(input.search.targetWaistZmm));
  }
  return { score, radiusMm: waist.radiusMm, zMm: waist.zMm };
}

function gaussianWithM2(beam: BeamInput, m2Delta: number): BeamInput[] {
  if (beam.kind === "gaussian") {
    const baseM2 = beam.m2 ?? 1;
    return [Math.max(1, baseM2 - m2Delta), baseM2 + m2Delta].map((m2) => ({ ...beam, m2 }));
  }
  if (beam.kind === "elliptical-gaussian") {
    const baseX = beam.m2x ?? 1;
    const baseY = beam.m2y ?? 1;
    return [
      { ...beam, m2x: Math.max(1, baseX - m2Delta), m2y: Math.max(1, baseY - m2Delta) },
      { ...beam, m2x: baseX + m2Delta, m2y: baseY + m2Delta },
    ];
  }
  return [
    { ...beam, m2x: Math.max(1, beam.m2x - m2Delta), m2y: Math.max(1, (beam.m2y ?? beam.m2x) - m2Delta) },
    { ...beam, m2x: beam.m2x + m2Delta, m2y: (beam.m2y ?? beam.m2x) + m2Delta },
  ];
}

function maxRadiusDelta(results: Array<BeamlineResult | undefined>, achievedRadiusMm: number): number | undefined {
  const radii = results
    .map((result) => (result ? radiusAtTarget(result) : undefined))
    .filter((value): value is number => value !== undefined);
  if (radii.length === 0) return undefined;
  return Math.max(...radii.map((radius) => Math.abs(radius - achievedRadiusMm)));
}

function sensitivity(input: TwoLensOptimizationInput, lens1: LensCandidate, lens2: LensCandidate, lens1Zmm: number, lens2Zmm: number, achievedRadiusMm: number): TwoLensSolution["sensitivity"] {
  const shift = input.search.sensitivityShiftMm;
  const focalShift = input.search.sensitivityFocalLengthMm;
  const m2Delta = input.search.sensitivityM2Delta;
  const positionDelta =
    shift === undefined
      ? undefined
      : maxRadiusDelta(
          [
            runAt(input, lens1, lens2, lens1Zmm - shift, lens2Zmm),
            runAt(input, lens1, lens2, lens1Zmm + shift, lens2Zmm),
            runAt(input, lens1, lens2, lens1Zmm, lens2Zmm - shift),
            runAt(input, lens1, lens2, lens1Zmm, lens2Zmm + shift),
          ],
          achievedRadiusMm,
        );
  const focalDelta =
    focalShift === undefined
      ? undefined
      : maxRadiusDelta(
          [
            runAt(input, { ...lens1, focalLengthMm: lens1.focalLengthMm - focalShift }, lens2, lens1Zmm, lens2Zmm),
            runAt(input, { ...lens1, focalLengthMm: lens1.focalLengthMm + focalShift }, lens2, lens1Zmm, lens2Zmm),
            runAt(input, lens1, { ...lens2, focalLengthMm: lens2.focalLengthMm - focalShift }, lens1Zmm, lens2Zmm),
            runAt(input, lens1, { ...lens2, focalLengthMm: lens2.focalLengthMm + focalShift }, lens1Zmm, lens2Zmm),
          ],
          achievedRadiusMm,
        );
  const m2SensitivityDelta =
    m2Delta === undefined
      ? undefined
      : maxRadiusDelta(
          gaussianWithM2(input.beam, m2Delta).map((beam) => runAt({ ...input, beam }, lens1, lens2, lens1Zmm, lens2Zmm)),
          achievedRadiusMm,
        );
  const deltas = [positionDelta, focalDelta, m2SensitivityDelta].filter((value): value is number => value !== undefined);
  if (deltas.length === 0) return undefined;
  return {
    positionShiftMm: shift,
    focalLengthShiftMm: focalShift,
    m2Delta,
    maxRadiusDeltaFromPositionMm: positionDelta,
    maxRadiusDeltaFromFocalLengthMm: focalDelta,
    maxRadiusDeltaFromM2Mm: m2SensitivityDelta,
    maxRadiusDeltaMm: Math.max(...deltas),
  };
}

export function optimizeTwoLensTelescope(input: TwoLensOptimizationInput): TwoLensOptimizationResult {
  const errors = validateInput(input);
  if (errors.length > 0) {
    return { solutions: [], warnings: errors.map((message) => warning("INVALID_INPUT", message, "error")) };
  }

  const apertureMarginMin = input.search.apertureMarginMin ?? 0;
  const targetRadius = targetRadiusMm(input);
  const candidates: TwoLensSolution[] = [];
  for (const lens1 of input.lenses) {
    for (const lens2 of input.lenses) {
      for (const lens1Zmm of input.search.lens1Zmm) {
        for (const lens2Zmm of input.search.lens2Zmm) {
          const result = runAt(input, lens1, lens2, lens1Zmm, lens2Zmm);
          if (!result) continue;
          if (result.components.some((component) => (component.apertureMargin ?? Number.POSITIVE_INFINITY) < apertureMarginMin)) continue;
          const achievedRadiusMm = radiusAtTarget(result);
          if (achievedRadiusMm === undefined) continue;
          const pulseScore = pulseScoreAndConstraintPass(input, result);
          if (!pulseScore.pass) continue;
          const waist = waistScore(input, result);
          const radiusScore = targetRadius === undefined ? 0 : relativeErrorScore(achievedRadiusMm, targetRadius);
          const score = radiusScore + waist.score + pulseScore.score;
          candidates.push({
            rank: 0,
            score,
            lens1,
            lens2,
            lens1Zmm,
            lens2Zmm,
            targetZmm: input.search.targetZmm,
            targetRadiusMm: targetRadius,
            targetDiameterMm: targetRadius === undefined ? undefined : 2 * targetRadius,
            targetWaistRadiusMm: input.search.targetWaistRadiusMm,
            targetWaistZmm: input.search.targetWaistZmm,
            achievedRadiusMm,
            achievedDiameterMm: 2 * achievedRadiusMm,
            achievedWaistRadiusMm: waist.radiusMm,
            achievedWaistZmm: waist.zMm,
            beamline: result,
            sensitivity: sensitivity(input, lens1, lens2, lens1Zmm, lens2Zmm, achievedRadiusMm),
            warnings: result.warnings,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const solutions = candidates.slice(0, input.search.maxResults ?? 10).map((solution, index) => ({ ...solution, rank: index + 1 }));
  const warnings = solutions.length === 0 ? [warning("INVALID_INPUT", "No two-lens solution satisfied the search constraints.", "warning")] : [];
  return { solutions, warnings };
}
