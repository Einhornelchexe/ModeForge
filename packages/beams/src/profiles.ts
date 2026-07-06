import { assertPositive } from "../../core/src/index.ts";
import type { BeamWidthBasis } from "../../core/src/index.ts";
import { gaussianRadiusAtZ, rayleighRangeMm } from "../../optics/src/index.ts";

export function d4SigmaDiameterToMomentRadiusMm(d4SigmaDiameterMm: number): number {
  assertPositive(d4SigmaDiameterMm, "d4SigmaDiameterMm");
  return d4SigmaDiameterMm / 2;
}

export function oneOverE2RadiusToFwhmDiameterMm(radiusMm: number): number {
  assertPositive(radiusMm, "radiusMm");
  return radiusMm * Math.sqrt(2 * Math.log(2));
}

export function fwhmDiameterToOneOverE2RadiusMm(fwhmDiameterMm: number): number {
  assertPositive(fwhmDiameterMm, "fwhmDiameterMm");
  return fwhmDiameterMm / Math.sqrt(2 * Math.log(2));
}

export function beamWidthToOneOverE2RadiusMm(value: number, basis: BeamWidthBasis): number {
  assertPositive(value, "beamWidth");
  if (basis === "one_over_e2_radius") return value;
  if (basis === "fwhm_diameter") return fwhmDiameterToOneOverE2RadiusMm(value);
  if (basis === "rms_radius") return 2 * value;
  return d4SigmaDiameterToMomentRadiusMm(value);
}

export function momentM2FromD4Sigma(d4SigmaDiameterMm: number, divergenceFullAngleRad: number, wavelengthUm: number): number {
  assertPositive(d4SigmaDiameterMm, "d4SigmaDiameterMm");
  assertPositive(divergenceFullAngleRad, "divergenceFullAngleRad");
  assertPositive(wavelengthUm, "wavelengthUm");
  return (Math.PI * d4SigmaDiameterMm * divergenceFullAngleRad) / (4 * (wavelengthUm / 1000));
}

export function ellipticalGaussianRadiiAtZ(input: {
  zMm: number;
  waistRadiusXmm: number;
  waistRadiusYmm: number;
  waistPositionXmm: number;
  waistPositionYmm: number;
  wavelengthUm: number;
  m2x?: number;
  m2y?: number;
}): { radiusXmm: number; radiusYmm: number } {
  return {
    radiusXmm: gaussianRadiusAtZ(input.zMm - input.waistPositionXmm, input.waistRadiusXmm, input.wavelengthUm, input.m2x ?? 1),
    radiusYmm: gaussianRadiusAtZ(input.zMm - input.waistPositionYmm, input.waistRadiusYmm, input.wavelengthUm, input.m2y ?? 1),
  };
}

export function superGaussianRelativeIntensity(radiusMm: number, edgeRadiusMm: number, order: number): number {
  assertPositive(edgeRadiusMm, "edgeRadiusMm");
  assertPositive(order, "order");
  return Math.exp(-2 * Math.abs(radiusMm / edgeRadiusMm) ** (2 * order));
}

export function topHatRelativeIntensity(radiusMm: number, topHatRadiusMm: number): number {
  assertPositive(topHatRadiusMm, "topHatRadiusMm");
  return Math.abs(radiusMm) <= topHatRadiusMm ? 1 : 0;
}

export { gaussianRadiusAtZ, rayleighRangeMm };
