import { assertPositive, umToMm, warning, type BeamWidthBasis, type SimulationWarning, type ValidationResult } from "../../core/src/index.ts";
import { beamWidthToOneOverE2RadiusMm } from "./profiles.ts";

export type BeamWidthMeasurement = {
  zMm: number;
  radiusMm: number;
};

export type BeamFitResult = {
  ok: boolean;
  waistPositionMm?: number;
  waistRadiusMm?: number;
  divergenceHalfAngleRad?: number;
  m2?: number;
  residualRmsMm?: number;
  maxRelativeResidual?: number;
  warnings: SimulationWarning[];
};

export function parseBeamWidthMeasurementsCsv(
  text: string,
  widthBasis: BeamWidthBasis = "one_over_e2_radius",
): ValidationResult<BeamWidthMeasurement[]> {
  const measurements: BeamWidthMeasurement[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/[,\s;]+/).filter(Boolean);
    if (index === 0 && parts.some((part) => Number.isNaN(Number(part)))) return;
    if (parts.length < 2) {
      errors.push(`line ${index + 1}: expected z and width columns`);
      return;
    }
    const zMm = Number(parts[0]);
    const width = Number(parts[1]);
    if (!Number.isFinite(zMm) || !Number.isFinite(width)) {
      errors.push(`line ${index + 1}: z and width must be finite numbers`);
      return;
    }
    try {
      measurements.push({ zMm, radiusMm: beamWidthToOneOverE2RadiusMm(width, widthBasis) });
    } catch (error) {
      errors.push(`line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  if (measurements.length === 0) errors.push("no beam-width measurements parsed");
  return errors.length === 0 ? { ok: true, value: measurements, errors: [] } : { ok: false, errors };
}

function solve3x3(matrix: number[][], vector: number[]): number[] | undefined {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(a[row][pivot]) > Math.abs(a[best][pivot])) best = row;
    }
    if (Math.abs(a[best][pivot]) < 1e-15) return undefined;
    [a[pivot], a[best]] = [a[best], a[pivot]];
    const scale = a[pivot][pivot];
    for (let col = pivot; col < 4; col += 1) a[pivot][col] /= scale;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = a[row][pivot];
      for (let col = pivot; col < 4; col += 1) a[row][col] -= factor * a[pivot][col];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

export function fitGaussianBeamFromRadii(measurements: BeamWidthMeasurement[], wavelengthUm: number): BeamFitResult {
  const warnings: SimulationWarning[] = [];
  try {
    assertPositive(wavelengthUm, "wavelengthUm");
    if (measurements.length < 3) {
      return { ok: false, warnings: [warning("INVALID_INPUT", "At least three beam-width measurements are required.", "error")] };
    }
    for (const point of measurements) {
      assertPositive(point.radiusMm, "radiusMm");
      if (!Number.isFinite(point.zMm)) throw new RangeError("zMm must be finite");
    }
  } catch (error) {
    return { ok: false, warnings: [warning("INVALID_INPUT", error instanceof Error ? error.message : String(error), "error")] };
  }

  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let y0 = 0;
  let y1 = 0;
  let y2 = 0;
  for (const point of measurements) {
    const z = point.zMm;
    const y = point.radiusMm * point.radiusMm;
    s0 += 1;
    s1 += z;
    s2 += z * z;
    s3 += z * z * z;
    s4 += z * z * z * z;
    y0 += y;
    y1 += z * y;
    y2 += z * z * y;
  }

  const coefficients = solve3x3(
    [
      [s4, s3, s2],
      [s3, s2, s1],
      [s2, s1, s0],
    ],
    [y2, y1, y0],
  );
  if (!coefficients) return { ok: false, warnings: [warning("INVALID_INPUT", "Beam fit matrix is singular.", "error")] };

  const [a, b, c] = coefficients;
  if (a <= 0) return { ok: false, warnings: [warning("INVALID_INPUT", "Beam fit has nonpositive divergence term.", "error")] };
  const waistPositionMm = -b / (2 * a);
  const waistSquared = c - a * waistPositionMm * waistPositionMm;
  if (waistSquared <= 0) return { ok: false, warnings: [warning("INVALID_INPUT", "Beam fit has nonpositive waist radius.", "error")] };

  const waistRadiusMm = Math.sqrt(waistSquared);
  const divergenceHalfAngleRad = Math.sqrt(a);
  const m2 = (Math.PI * waistRadiusMm * divergenceHalfAngleRad) / umToMm(wavelengthUm);
  if (m2 < 1) warnings.push(warning("INVALID_INPUT", `Fitted M2 ${m2.toFixed(3)} is below the diffraction limit.`, "warning"));
  const residuals = measurements.map((point) => {
    const predictedSquared = a * point.zMm * point.zMm + b * point.zMm + c;
    const predictedRadiusMm = predictedSquared > 0 ? Math.sqrt(predictedSquared) : 0;
    return point.radiusMm - predictedRadiusMm;
  });
  const residualRmsMm = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length);
  const maxRelativeResidual = Math.max(...residuals.map((value, index) => Math.abs(value) / measurements[index].radiusMm));
  if (maxRelativeResidual > 0.02) {
    warnings.push(
      warning(
        "MEASUREMENT_FIT_RESIDUAL_HIGH",
        `Beam fit max relative residual ${(100 * maxRelativeResidual).toFixed(2)}% exceeds 2%.`,
        "warning",
      ),
    );
  }

  return { ok: true, waistPositionMm, waistRadiusMm, divergenceHalfAngleRad, m2, residualRmsMm, maxRelativeResidual, warnings };
}
