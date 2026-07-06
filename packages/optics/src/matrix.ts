import { assertFiniteNumber, assertPositive } from "../../core/src/index.ts";

export type AbcdMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
};

export const IDENTITY_MATRIX: AbcdMatrix = { a: 1, b: 0, c: 0, d: 1 };

function assertMatrixFinite(matrix: AbcdMatrix, name: string): void {
  assertFiniteNumber(matrix.a, `${name}.a`);
  assertFiniteNumber(matrix.b, `${name}.b`);
  assertFiniteNumber(matrix.c, `${name}.c`);
  assertFiniteNumber(matrix.d, `${name}.d`);
}

export function determinant(matrix: AbcdMatrix): number {
  assertMatrixFinite(matrix, "matrix");
  return matrix.a * matrix.d - matrix.b * matrix.c;
}

export function multiplyMatrices(left: AbcdMatrix, right: AbcdMatrix): AbcdMatrix {
  assertMatrixFinite(left, "left");
  assertMatrixFinite(right, "right");
  return {
    a: left.a * right.a + left.b * right.c,
    b: left.a * right.b + left.b * right.d,
    c: left.c * right.a + left.d * right.c,
    d: left.c * right.b + left.d * right.d,
  };
}

export function composeMatrices(matrices: AbcdMatrix[]): AbcdMatrix {
  return matrices.reduce((total, next) => multiplyMatrices(next, total), IDENTITY_MATRIX);
}

export function freeSpaceMatrix(lengthMm: number): AbcdMatrix {
  assertFiniteNumber(lengthMm, "lengthMm");
  return { a: 1, b: lengthMm, c: 0, d: 1 };
}

export function thinLensMatrix(focalLengthMm: number): AbcdMatrix {
  assertFiniteNumber(focalLengthMm, "focalLengthMm");
  if (focalLengthMm === 0) throw new RangeError("focalLengthMm must be non-zero");
  return { a: 1, b: 0, c: -1 / focalLengthMm, d: 1 };
}

export function refractiveSurfaceMatrix(radiusMm: number | "Infinity", nBefore: number, nAfter: number): AbcdMatrix {
  assertPositive(nBefore, "nBefore");
  assertPositive(nAfter, "nAfter");
  if (radiusMm === "Infinity" || !Number.isFinite(radiusMm)) {
    return { a: 1, b: 0, c: 0, d: nBefore / nAfter };
  }
  if (radiusMm === 0) throw new RangeError('radiusMm must be non-zero or "Infinity"');
  return {
    a: 1,
    b: 0,
    c: (nBefore - nAfter) / (radiusMm * nAfter),
    d: nBefore / nAfter,
  };
}
