import { PI, assertPositive, umToMm } from "../../core/src/index.ts";
import type { AbcdMatrix } from "./matrix.ts";

export type Complex = {
  re: number;
  im: number;
};

export function complex(re: number, im: number): Complex {
  return { re, im };
}

export function addComplex(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function multiplyComplex(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function divideComplex(a: Complex, b: Complex): Complex {
  const den = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / den, im: (a.im * b.re - a.re * b.im) / den };
}

export function rayleighRangeMm(waistRadiusMm: number, wavelengthUm: number, m2 = 1): number {
  assertPositive(waistRadiusMm, "waistRadiusMm");
  assertPositive(wavelengthUm, "wavelengthUm");
  assertPositive(m2, "m2");
  return PI * waistRadiusMm * waistRadiusMm / (m2 * umToMm(wavelengthUm));
}

export function divergenceHalfAngleRad(waistRadiusMm: number, wavelengthUm: number, m2 = 1): number {
  assertPositive(waistRadiusMm, "waistRadiusMm");
  return (m2 * umToMm(wavelengthUm)) / (PI * waistRadiusMm);
}

export function qAtWaist(waistRadiusMm: number, wavelengthUm: number, m2 = 1): Complex {
  return complex(0, rayleighRangeMm(waistRadiusMm, wavelengthUm, m2));
}

export function qAtZ(zFromWaistMm: number, waistRadiusMm: number, wavelengthUm: number, m2 = 1): Complex {
  return complex(zFromWaistMm, rayleighRangeMm(waistRadiusMm, wavelengthUm, m2));
}

export function transformQ(q: Complex, matrix: AbcdMatrix): Complex {
  const numerator = addComplex(multiplyComplex(complex(matrix.a, 0), q), complex(matrix.b, 0));
  const denominator = addComplex(multiplyComplex(complex(matrix.c, 0), q), complex(matrix.d, 0));
  return divideComplex(numerator, denominator);
}

export function inverseComplex(q: Complex): Complex {
  return divideComplex(complex(1, 0), q);
}

export function radiusFromQ(q: Complex, wavelengthUm: number, m2 = 1): number {
  const inv = inverseComplex(q);
  const lambdaEffMm = m2 * umToMm(wavelengthUm);
  if (inv.im >= 0) {
    throw new RangeError("q parameter does not encode a physical Gaussian beam radius");
  }
  return Math.sqrt(-lambdaEffMm / (PI * inv.im));
}

export function gaussianRadiusAtZ(
  zFromWaistMm: number,
  waistRadiusMm: number,
  wavelengthUm: number,
  m2 = 1,
): number {
  const zR = rayleighRangeMm(waistRadiusMm, wavelengthUm, m2);
  return waistRadiusMm * Math.sqrt(1 + (zFromWaistMm / zR) ** 2);
}

export function waistFromQ(q: Complex, wavelengthUm: number, m2 = 1): { waistRadiusMm: number; waistOffsetMm: number; rayleighRangeMm: number } {
  const waistOffsetMm = -q.re;
  const zR = q.im;
  const waistRadiusMm = Math.sqrt((m2 * umToMm(wavelengthUm) * zR) / PI);
  return { waistRadiusMm, waistOffsetMm, rayleighRangeMm: zR };
}
