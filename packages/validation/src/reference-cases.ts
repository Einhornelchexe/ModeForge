import { N_BK7, refractiveIndex } from "../../materials/src/index.ts";
import { gaussianRadiusAtZ, rayleighRangeMm } from "../../optics/src/index.ts";

export const gaussianReference = {
  wavelengthUm: 1.064,
  waistRadiusMm: 0.5,
  zMm: 100,
  expectedRayleighRangeMm: rayleighRangeMm(0.5, 1.064),
  expectedRadiusAt100Mm: gaussianRadiusAtZ(100, 0.5, 1.064),
};

export const materialReference = {
  materialId: N_BK7.id,
  wavelengthUm: 0.5876,
  expectedN: refractiveIndex(N_BK7, 0.5876),
};
