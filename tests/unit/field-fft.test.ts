import assert from "node:assert/strict";
import test from "node:test";

import { createGaussianField, fieldPower, propagateFresnel, type ScalarField } from "../../packages/field/src/index.ts";

// deterministic pseudo-random generator so the reference comparison is stable
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomField(n: number, seed: number): ScalarField {
  const base = createGaussianField({ nx: n, ny: n, dxMm: 0.05, dyMm: 0.05, wavelengthUm: 0.633, waistRadiusMm: 0.4 });
  const rand = mulberry32(seed);
  const real = base.real.map(() => rand() * 2 - 1);
  const imag = base.imag.map(() => rand() * 2 - 1);
  return { ...base, real, imag };
}

// independent reference: naive quadruple-loop unitary DFT + Fresnel transfer
// function, coded from the textbook definitions (not from the library source)
function referenceFresnel(field: ScalarField, distanceMm: number): { real: number[]; imag: number[] } {
  const { nx, ny } = field;
  const norm = 1 / Math.sqrt(nx * ny);
  const dftPass = (re: number[], im: number[], sign: number): { re: number[]; im: number[] } => {
    const outRe = new Array(nx * ny).fill(0);
    const outIm = new Array(nx * ny).fill(0);
    for (let ky = 0; ky < ny; ky += 1) {
      for (let kx = 0; kx < nx; kx += 1) {
        let sumRe = 0;
        let sumIm = 0;
        for (let y = 0; y < ny; y += 1) {
          for (let x = 0; x < nx; x += 1) {
            const angle = sign * 2 * Math.PI * ((kx * x) / nx + (ky * y) / ny);
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const idx = y * nx + x;
            sumRe += re[idx] * c - im[idx] * s;
            sumIm += re[idx] * s + im[idx] * c;
          }
        }
        outRe[ky * nx + kx] = sumRe * norm;
        outIm[ky * nx + kx] = sumIm * norm;
      }
    }
    return { re: outRe, im: outIm };
  };
  const spectrum = dftPass(field.real, field.imag, -1);
  const lambdaMm = field.wavelengthUm / 1000;
  const freq = (index: number, count: number, spacing: number): number => {
    const wrapped = index <= count / 2 ? index : index - count;
    return wrapped / (count * spacing);
  };
  for (let ky = 0; ky < ny; ky += 1) {
    const fy = freq(ky, ny, field.dyMm);
    for (let kx = 0; kx < nx; kx += 1) {
      const fx = freq(kx, nx, field.dxMm);
      const phase = -Math.PI * lambdaMm * distanceMm * (fx * fx + fy * fy);
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      const idx = ky * nx + kx;
      const re = spectrum.re[idx];
      const im = spectrum.im[idx];
      spectrum.re[idx] = re * c - im * s;
      spectrum.im[idx] = re * s + im * c;
    }
  }
  const back = dftPass(spectrum.re, spectrum.im, 1);
  return { real: back.re, imag: back.im };
}

function maxRelDiff(a: { real: number[]; imag: number[] }, b: { real: number[]; imag: number[] }): number {
  let scale = 0;
  for (let i = 0; i < a.real.length; i += 1) scale = Math.max(scale, Math.hypot(a.real[i], a.imag[i]));
  let worst = 0;
  for (let i = 0; i < a.real.length; i += 1) {
    worst = Math.max(worst, Math.hypot(a.real[i] - b.real[i], a.imag[i] - b.imag[i]));
  }
  return worst / scale;
}

for (const n of [16, 12, 33]) {
  test(`S14 fast transform matches the independent naive DFT reference (n=${n})`, () => {
    const field = randomField(n, 1234 + n);
    const fast = propagateFresnel(field, 87.3);
    const reference = referenceFresnel(field, 87.3);
    const diff = maxRelDiff(reference, fast);
    assert.ok(diff < 1e-10, `max relative deviation ${diff}`);
  });
}

test("S14 fast transform conserves power on random fields (pow2 and odd)", () => {
  for (const n of [32, 33]) {
    const field = randomField(n, 77 + n);
    const before = fieldPower(field);
    const after = fieldPower(propagateFresnel(field, 250));
    assert.ok(Math.abs(after / before - 1) < 1e-12, `power ratio drift at n=${n}`);
  }
});
