export const SPEED_OF_LIGHT_M_PER_S = 299_792_458;
export const PI = Math.PI;

export type PositiveNumber = number;

export function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

export function assertPositive(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be > 0`);
  }
}

export function mmToM(valueMm: number): number {
  return valueMm / 1000;
}

export function mToMm(valueM: number): number {
  return valueM * 1000;
}

export function umToM(valueUm: number): number {
  return valueUm * 1e-6;
}

export function umToMm(valueUm: number): number {
  return valueUm / 1000;
}

export function mmToUm(valueMm: number): number {
  return valueMm * 1000;
}

export function mm2ToCm2(valueMm2: number): number {
  return valueMm2 / 100;
}

export function nearlyEqual(a: number, b: number, tolerance = 1e-12): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function relativeError(actual: number, expected: number): number {
  if (expected === 0) {
    return Math.abs(actual);
  }
  return Math.abs((actual - expected) / expected);
}
