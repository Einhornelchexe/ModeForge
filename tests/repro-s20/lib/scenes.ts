// Deterministic scene builders shared by the S20 repro corpus.
//
// Every helper here is a pure function of its arguments plus a literal seed:
// no Date.now, no Math.random, no ambient state. Two runs of the same suite
// therefore produce bit-identical numbers, which is what lets the repro tests
// pin measured values exactly instead of asserting loose bands.
//
// The PRNG is the same mulberry32 + Box-Muller pair the production alpha-MC
// null model and tests/unit/image-aperture.test.ts use, so the noise a repro
// scene carries exercises the same numerics as the shipped code path.

import type { BackgroundRect } from "../../../packages/image/src/background.ts";
import type { ImageAnalysisResult } from "../../../packages/image/src/analyze.ts";

export type PixelBuffer = Float32Array | Float64Array | number[];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard-normal stream: Box-Muller with u1 = 1 - rand() (never ln(0)) and
// the paired spare cached locally.
export function gaussianStream(seed: number): () => number {
  const rand = mulberry32(seed >>> 0);
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

// Second deterministic stream: a linear congruential generator feeding the
// same Box-Muller pair. The background unit tests in tests/unit use this one,
// and the background repros below were measured with it, so it is kept
// separate rather than folded into the mulberry32 lane.
export function lcgGaussianStream(seed: number): () => number {
  let state = seed >>> 0;
  const next = (): number => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u1 = 0;
    while (u1 <= 0) u1 = 1 - next();
    const u2 = next();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

// Adds iid N(0, sigmaB^2) in index order. Consumes exactly one stream value
// per pixel, so the field is reproducible for a given (length, sigmaB, seed).
export function addGaussianNoise(pixels: PixelBuffer, sigmaB: number, seed: number): void {
  const next = gaussianStream(seed);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] += sigmaB * next();
  }
}

// Rotated elliptical Gaussian, pixel-centre sampled (no area integration),
// written into `target` (overwrite).
export function fillGaussian(
  target: PixelBuffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigma1: number,
  sigma2: number,
  thetaRad: number,
  amplitude: number,
  base: number,
): void {
  const cos = Math.cos(thetaRad);
  const sin = Math.sin(thetaRad);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      target[x + y * width] = base + amplitude * Math.exp(-((u * u) / (2 * sigma1 * sigma1) + (v * v) / (2 * sigma2 * sigma2)));
    }
  }
}

// Same geometry, accumulated onto whatever is already in `target`.
export function addGaussian(
  target: PixelBuffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigma1: number,
  sigma2: number,
  thetaRad: number,
  amplitude: number,
): void {
  const cos = Math.cos(thetaRad);
  const sin = Math.sin(thetaRad);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      target[x + y * width] += amplitude * Math.exp(-((u * u) / (2 * sigma1 * sigma1) + (v * v) / (2 * sigma2 * sigma2)));
    }
  }
}

// float32 lane: what analyzeImage consumes on the dtype "float32" path. The
// storage class matters — several pinned numbers below are float32-rounded.
export function gaussianSceneF32(
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigma1: number,
  sigma2: number,
  thetaRad: number,
  amplitude: number,
  base = 0,
): Float32Array {
  const out = new Float32Array(width * height);
  fillGaussian(out, width, height, cx, cy, sigma1, sigma2, thetaRad, amplitude, base);
  return out;
}

// float64 lane: what fitGauss2d / assessAperture / computeRectMoments consume
// directly (they reject Float32Array by type).
export function gaussianFieldF64(
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigma1: number,
  sigma2: number,
  thetaRad: number,
  amplitude: number,
  base = 0,
): Float64Array {
  const out = new Float64Array(width * height);
  fillGaussian(out, width, height, cx, cy, sigma1, sigma2, thetaRad, amplitude, base);
  return out;
}

// Four-sided frame of reference rectangles of thickness `rim`.
export function frameRects(width: number, height: number, rim: number): BackgroundRect[] {
  return [
    { x0: 0, y0: 0, width, height: rim },
    { x0: 0, y0: height - rim, width, height: rim },
    { x0: 0, y0: rim, width: rim, height: height - 2 * rim },
    { x0: width - rim, y0: rim, width: rim, height: height - 2 * rim },
  ];
}

// The four-corner reference preset the workbench writes (rounded fraction of
// each side, at least one pixel).
export function cornerRects(width: number, height: number, fx: number, fy: number): BackgroundRect[] {
  const w = Math.max(1, Math.round(fx * width));
  const h = Math.max(1, Math.round(fy * height));
  return [
    { x0: 0, y0: 0, width: w, height: h },
    { x0: width - w, y0: 0, width: w, height: h },
    { x0: 0, y0: height - h, width: w, height: h },
    { x0: width - w, y0: height - h, width: w, height: h },
  ];
}

export function warningCodes(result: ImageAnalysisResult): string[] {
  return result.warnings.map((w) => w.code);
}

// Warning codes with the shared IMAGE_ prefix stripped: shorter to pin, and
// the prefix carries no information inside this corpus.
export function shortWarningCodes(result: ImageAnalysisResult): string[] {
  return result.warnings.map((w) => w.code.replace("IMAGE_", ""));
}

export function relativeErrorPercent(value: number, reference: number): number {
  return (100 * (value - reference)) / reference;
}

// Half-up rounding to a fixed number of decimals, so an exact pin can be
// written as a short literal without depending on float formatting. Negative
// zero is normalized to zero: assert.equal uses Object.is, under which -0 and
// 0 differ, and the sign of a rounded-away magnitude carries no meaning.
export function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale + 0;
}
