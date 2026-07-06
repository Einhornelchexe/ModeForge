import { PI, assertPositive, mm2ToCm2, warning, type PulseInput, type PulseResult } from "../../core/src/index.ts";

export function pulseEnergyJ(input: Pick<PulseInput, "averagePowerW" | "pulseEnergyJ" | "repetitionRateHz">): number {
  if (input.pulseEnergyJ !== undefined) {
    assertPositive(input.pulseEnergyJ, "pulseEnergyJ");
    return input.pulseEnergyJ;
  }
  if (input.averagePowerW === undefined || input.repetitionRateHz === undefined) {
    throw new RangeError("pulseEnergyJ or averagePowerW + repetitionRateHz is required");
  }
  assertPositive(input.averagePowerW, "averagePowerW");
  assertPositive(input.repetitionRateHz, "repetitionRateHz");
  return input.averagePowerW / input.repetitionRateHz;
}

export function temporalPeakFactor(shape: PulseInput["shape"]): number {
  if (shape === "gaussian") return Math.sqrt((4 * Math.log(2)) / Math.PI);
  if (shape === "sech2") return 1.762747174039086 / 2;
  if (shape === "rectangular") return 1;
  throw new RangeError("pulse shape must be gaussian, sech2, or rectangular");
}

export function peakPowerW(energyJ: number, durationFwhmS: number, shape: PulseInput["shape"]): number {
  assertPositive(energyJ, "energyJ");
  assertPositive(durationFwhmS, "durationFwhmS");
  return (energyJ / durationFwhmS) * temporalPeakFactor(shape);
}

export function gaussianPeakFluenceJPerCm2(energyJ: number, radiusXmm: number, radiusYmm = radiusXmm): number {
  assertPositive(energyJ, "energyJ");
  assertPositive(radiusXmm, "radiusXmm");
  assertPositive(radiusYmm, "radiusYmm");
  const areaCm2 = mm2ToCm2(PI * radiusXmm * radiusYmm);
  return (2 * energyJ) / areaCm2;
}

export function gaussianPeakIntensityWPerCm2(powerW: number, radiusXmm: number, radiusYmm = radiusXmm): number {
  assertPositive(powerW, "powerW");
  assertPositive(radiusXmm, "radiusXmm");
  assertPositive(radiusYmm, "radiusYmm");
  const areaCm2 = mm2ToCm2(PI * radiusXmm * radiusYmm);
  return (2 * powerW) / areaCm2;
}

export function calculatePulse(
  input: PulseInput,
  spatial?: { radiusXmm?: number; radiusYmm?: number },
): PulseResult {
  const energy = pulseEnergyJ(input);
  const peakPower = peakPowerW(energy, input.durationFwhmS, input.shape);
  const result: PulseResult = { pulseEnergyJ: energy, peakPowerW: peakPower, warnings: [] };
  if (spatial?.radiusXmm !== undefined) {
    result.fluenceJPerCm2 = gaussianPeakFluenceJPerCm2(energy, spatial.radiusXmm, spatial.radiusYmm);
    result.peakIntensityWPerCm2 = gaussianPeakIntensityWPerCm2(peakPower, spatial.radiusXmm, spatial.radiusYmm);
  } else {
    result.warnings.push(warning("INVALID_INPUT", "No spatial radius supplied; fluence and intensity omitted.", "info"));
  }
  return result;
}
