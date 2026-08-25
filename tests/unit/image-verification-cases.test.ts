import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeImage } from "../../packages/image/src/analyze.ts";
import type { ImageAnalysisResult } from "../../packages/image/src/analyze.ts";

// Image-analyzer verification cases (agents/verification/image_analyzer_cases.json).
// Each case describes a synthetic image (one or more Gaussian beams, optional
// seeded N(0, sigmaB) noise) and pins fields of the analyzeImage result. The
// pixel generator is the deterministic mulberry32 + Box-Muller pair of the
// S18 gate-calibration spec (section 1.5): u1 = 1 - rand() (never ln(0)),
// u2 = rand(), the cos member is returned first and the sin partner is
// cached locally. Iteration is row-major (y outer, x inner) everywhere.

const cases = JSON.parse(
  readFileSync(new URL("../../agents/verification/image_analyzer_cases.json", import.meta.url), "utf8"),
) as { cases: Array<Record<string, unknown>> };

function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussPairFactory(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u1 = 0;
    while (u1 <= 0) u1 = 1 - rand();
    const u2 = rand();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

type GaussParams = {
  amplitudeCounts: number;
  centerXPx: number;
  centerYPx: number;
  sigmaMajorPx: number;
  sigmaMinorPx: number;
  thetaRad: number;
  backgroundCounts: number;
};

function gaussValue(params: GaussParams, x: number, y: number): number {
  const cos = Math.cos(params.thetaRad);
  const sin = Math.sin(params.thetaRad);
  const dx = x - params.centerXPx;
  const dy = y - params.centerYPx;
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;
  const exponent =
    (u * u) / (2 * params.sigmaMajorPx * params.sigmaMajorPx) +
    (v * v) / (2 * params.sigmaMinorPx * params.sigmaMinorPx);
  return params.backgroundCounts + params.amplitudeCounts * Math.exp(-exponent);
}

type CaseInputs = {
  width: number;
  height: number;
  dtype: "float32";
  gaussian?: GaussParams;
  beams?: GaussParams[];
  sigmaB: number;
  seed: number;
  maskBelowCounts?: number;
};

function buildPixels(inputs: CaseInputs): number[] {
  const { width, height } = inputs;
  const count = width * height;
  const pixels = new Array<number>(count).fill(0);
  const beams = inputs.beams ?? (inputs.gaussian !== undefined ? [inputs.gaussian] : []);
  for (const beam of beams) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        pixels[row + x] += gaussValue(beam, x, y);
      }
    }
  }
  if (inputs.sigmaB > 0) {
    const gauss = gaussPairFactory(createRng(inputs.seed));
    for (let i = 0; i < count; i += 1) pixels[i] += inputs.sigmaB * gauss();
  }
  const maskBelowCounts = inputs.maskBelowCounts ?? 0;
  if (maskBelowCounts > 0) {
    for (let i = 0; i < count; i += 1) {
      if (pixels[i] < maskBelowCounts) pixels[i] = 0;
    }
  }
  return pixels;
}

function resolvePath(result: ImageAnalysisResult, path: string): unknown {
  let value: unknown = result;
  for (const segment of path.split(".")) {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function assertExpected(caseId: string, path: string, actual: unknown, expected: unknown, toleranceRel: number): void {
  const message = (detail: string) => `${caseId} :: ${path}: ${detail}`;
  if (expected === null) {
    assert.equal(actual, null, message(`expected null but got ${String(actual)}`));
    return;
  }
  if (typeof expected === "boolean") {
    assert.equal(actual, expected, message(`expected boolean ${String(expected)} but got ${String(actual)}`));
    return;
  }
  if (typeof expected === "string") {
    assert.equal(actual, expected, message(`expected string ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`));
    return;
  }
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", message(`expected number but got ${String(actual)}`));
    const actualNumber = actual as number;
    const expectedNumber = expected as number;
    if (toleranceRel === 0) {
      assert.equal(actualNumber, expectedNumber, message(`expected exact ${expectedNumber} but got ${actualNumber}`));
      return;
    }
    // Absolute comparison for zero and tiny-count pins; relative otherwise.
    const absolute = expectedNumber === 0 || Math.abs(expectedNumber) < 1e-3;
    const tolerance = absolute ? toleranceRel : toleranceRel * Math.abs(expectedNumber);
    const difference = Math.abs(actualNumber - expectedNumber);
    assert.ok(
      difference <= tolerance,
      message(`expected ${expectedNumber} within ${tolerance} but got ${actualNumber} (difference ${difference})`),
    );
    return;
  }
  assert.fail(message(`unsupported expected type ${typeof expected}`));
}

for (const entry of cases.cases) {
  const id = String(entry.id);
  test(`image verification case: ${id}`, () => {
    const inputs = entry.inputs as unknown as CaseInputs;
    const expected = entry.expected as Record<string, unknown>;
    const toleranceRel = Number(entry.toleranceRel);
    const pixels = buildPixels(inputs);
    const result = analyzeImage({
      pixels,
      width: inputs.width,
      height: inputs.height,
      dtype: inputs.dtype,
    });
    for (const [path, expectedValue] of Object.entries(expected)) {
      const actual = resolvePath(result, path);
      assertExpected(id, path, actual, expectedValue, toleranceRel);
    }
  });
}
