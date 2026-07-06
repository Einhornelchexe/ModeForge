import { assertPositive } from "../../core/src/index.ts";

export type HermiteGaussianMode = {
  kind: "HG";
  m: number;
  n: number;
  waistRadiusMm: number;
};

export type LaguerreGaussianMode = {
  kind: "LG";
  p: number;
  l: number;
  waistRadiusMm: number;
};

export function hermiteGaussianM2(mode: HermiteGaussianMode): { m2x: number; m2y: number } {
  if (!Number.isInteger(mode.m) || mode.m < 0) throw new RangeError("HG m must be a non-negative integer");
  if (!Number.isInteger(mode.n) || mode.n < 0) throw new RangeError("HG n must be a non-negative integer");
  assertPositive(mode.waistRadiusMm, "waistRadiusMm");
  return { m2x: 2 * mode.m + 1, m2y: 2 * mode.n + 1 };
}

export function laguerreGaussianM2(mode: LaguerreGaussianMode): number {
  if (!Number.isInteger(mode.p) || mode.p < 0) throw new RangeError("LG p must be a non-negative integer");
  if (!Number.isInteger(mode.l)) throw new RangeError("LG l must be an integer");
  assertPositive(mode.waistRadiusMm, "waistRadiusMm");
  return 2 * mode.p + Math.abs(mode.l) + 1;
}

export function gouyPhaseRad(zMm: number, rayleighRangeMm: number, modeOrder = 0): number {
  assertPositive(rayleighRangeMm, "rayleighRangeMm");
  return (modeOrder + 1) * Math.atan(zMm / rayleighRangeMm);
}
