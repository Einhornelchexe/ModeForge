import { PI, assertPositive, warning, type SimulationWarning } from "../../core/src/index.ts";

export type ScalarField = {
  nx: number;
  ny: number;
  dxMm: number;
  dyMm: number;
  wavelengthUm: number;
  real: number[];
  imag: number[];
};

export function fieldIndex(field: Pick<ScalarField, "nx">, x: number, y: number): number {
  return y * field.nx + x;
}

function assertField(field: ScalarField): void {
  assertPositive(field.nx, "nx");
  assertPositive(field.ny, "ny");
  assertPositive(field.dxMm, "dxMm");
  assertPositive(field.dyMm, "dyMm");
  assertPositive(field.wavelengthUm, "wavelengthUm");
  if (!Number.isInteger(field.nx) || !Number.isInteger(field.ny)) throw new RangeError("field dimensions must be integers");
  if (field.real.length !== field.nx * field.ny || field.imag.length !== field.nx * field.ny) {
    throw new RangeError("field arrays must match nx * ny");
  }
}

export function createGaussianField(input: {
  nx: number;
  ny: number;
  dxMm: number;
  dyMm: number;
  wavelengthUm: number;
  waistRadiusMm: number;
}): ScalarField {
  assertPositive(input.waistRadiusMm, "waistRadiusMm");
  const field: ScalarField = {
    nx: input.nx,
    ny: input.ny,
    dxMm: input.dxMm,
    dyMm: input.dyMm,
    wavelengthUm: input.wavelengthUm,
    real: new Array(input.nx * input.ny).fill(0),
    imag: new Array(input.nx * input.ny).fill(0),
  };
  assertField(field);
  const cx = (input.nx - 1) / 2;
  const cy = (input.ny - 1) / 2;
  for (let y = 0; y < input.ny; y += 1) {
    for (let x = 0; x < input.nx; x += 1) {
      const xMm = (x - cx) * input.dxMm;
      const yMm = (y - cy) * input.dyMm;
      field.real[fieldIndex(field, x, y)] = Math.exp(-(xMm * xMm + yMm * yMm) / (input.waistRadiusMm * input.waistRadiusMm));
    }
  }
  return field;
}

// Physicists' Hermite polynomial H_m(u) via the stable recurrence
// H_{k+1} = 2u H_k - 2k H_{k-1}; fine for the supported orders (<= 12).
function hermiteH(order: number, u: number): number {
  if (order <= 0) return 1;
  let hPrev = 1;
  let h = 2 * u;
  for (let k = 1; k < order; k += 1) {
    const next = 2 * u * h - 2 * k * hPrev;
    hPrev = h;
    h = next;
  }
  return h;
}

// Generalized Laguerre L_p^a(x): L_{k+1} = ((2k+1+a-x) L_k - (k+a) L_{k-1}) / (k+1)
function laguerreL(order: number, alpha: number, x: number): number {
  if (order <= 0) return 1;
  let lPrev = 1;
  let l = 1 + alpha - x;
  for (let k = 1; k < order; k += 1) {
    const next = ((2 * k + 1 + alpha - x) * l - (k + alpha) * lPrev) / (k + 1);
    lPrev = l;
    l = next;
  }
  return l;
}

export type TransverseMode = { kind: "HG"; m: number; n: number } | { kind: "LG"; p: number; l: number };

// True transverse-mode field (S17, live-user report: the mode helper only set
// the envelope M2 while the field always rendered as the fundamental).
// Conventions match createGaussianFieldAtPlane: the fundamental amplitude is
// exp(-r^2/w^2) (w = 1/e^2 intensity radius of the EMBEDDED Gaussian), the
// quadratic wavefront phase is +k r^2/(2R) for a diverging beam, and HG modes
// carry H_m(sqrt(2) x/w). Analytic second moments (test oracles):
// HG_{m,n}: 2 sigma_x = w sqrt(2m+1); LG_{p,l}: 2 sigma_x = w sqrt(2p+|l|+1).
// The field carries the same power as the peak-1 fundamental (pi*wx*wy/2).
export function createModeFieldAtPlane(input: {
  nx: number;
  ny: number;
  dxMm: number;
  dyMm: number;
  wavelengthUm: number;
  radiusXmm: number;
  radiusYmm?: number;
  wavefrontRadiusXmm?: number;
  wavefrontRadiusYmm?: number;
  mode: TransverseMode;
}): ScalarField {
  assertPositive(input.radiusXmm, "radiusXmm");
  if (input.radiusYmm !== undefined) assertPositive(input.radiusYmm, "radiusYmm");
  const orders = input.mode.kind === "HG" ? [input.mode.m, input.mode.n] : [input.mode.p, Math.abs(input.mode.l)];
  for (const order of orders) {
    if (!Number.isInteger(order) || order < 0 || order > 12) throw new RangeError("mode orders must be integers in 0..12");
  }
  // LG modes are rotationally symmetric eigenmodes: force a fully circular
  // construction (envelope AND wavefront) from the x-axis values - an
  // elliptical envelope with a circular Laguerre term would be a hybrid that
  // is no mode at all (S17 cross-review finding).
  const isLg = input.mode.kind === "LG";
  const radiusYmm = isLg ? input.radiusXmm : (input.radiusYmm ?? input.radiusXmm);
  const wavefrontRadiusXmm = input.wavefrontRadiusXmm;
  const wavefrontRadiusYmm = isLg ? input.wavefrontRadiusXmm : input.wavefrontRadiusYmm;
  const field: ScalarField = {
    nx: input.nx,
    ny: input.ny,
    dxMm: input.dxMm,
    dyMm: input.dyMm,
    wavelengthUm: input.wavelengthUm,
    real: new Array(input.nx * input.ny).fill(0),
    imag: new Array(input.nx * input.ny).fill(0),
  };
  assertField(field);
  const lambdaMm = input.wavelengthUm / 1000;
  const cx = (input.nx - 1) / 2;
  const cy = (input.ny - 1) / 2;
  for (let y = 0; y < input.ny; y += 1) {
    for (let x = 0; x < input.nx; x += 1) {
      const xMm = (x - cx) * input.dxMm;
      const yMm = (y - cy) * input.dyMm;
      const gauss = Math.exp(-(xMm * xMm) / (input.radiusXmm * input.radiusXmm) - (yMm * yMm) / (radiusYmm * radiusYmm));
      let amplitude: number;
      let phase = 0;
      if (input.mode.kind === "HG") {
        amplitude =
          gauss *
          hermiteH(input.mode.m, (Math.SQRT2 * xMm) / input.radiusXmm) *
          hermiteH(input.mode.n, (Math.SQRT2 * yMm) / radiusYmm);
      } else {
        // LG modes are rotationally symmetric: use the x radius
        const w = input.radiusXmm;
        const rho2 = (2 * (xMm * xMm + yMm * yMm)) / (w * w);
        const absL = Math.abs(input.mode.l);
        amplitude = gauss * Math.pow(Math.sqrt(rho2), absL) * laguerreL(input.mode.p, absL, rho2);
        phase += input.mode.l * Math.atan2(yMm, xMm);
      }
      const phaseX = wavefrontRadiusXmm === undefined ? 0 : (xMm * xMm) / wavefrontRadiusXmm;
      const phaseY = wavefrontRadiusYmm === undefined ? 0 : (yMm * yMm) / wavefrontRadiusYmm;
      phase += (PI / lambdaMm) * (phaseX + phaseY);
      const idx = fieldIndex(field, x, y);
      field.real[idx] = amplitude * Math.cos(phase);
      field.imag[idx] = amplitude * Math.sin(phase);
    }
  }
  // Power convention: same power as the peak-1 fundamental with this envelope
  // (pi*wx*wy/2), so HG(0,0) matches createGaussianFieldAtPlane exactly and
  // POWER tiles stay comparable across all field sources.
  const power = fieldPower(field);
  if (power > 0) {
    const scale = Math.sqrt((PI * input.radiusXmm * radiusYmm) / 2 / power);
    for (let i = 0; i < field.real.length; i += 1) {
      field.real[i] *= scale;
      field.imag[i] *= scale;
    }
  }
  return field;
}

export function createGaussianFieldAtPlane(input: {
  nx: number;
  ny: number;
  dxMm: number;
  dyMm: number;
  wavelengthUm: number;
  radiusXmm: number;
  radiusYmm?: number;
  wavefrontRadiusXmm?: number;
  wavefrontRadiusYmm?: number;
}): ScalarField {
  assertPositive(input.radiusXmm, "radiusXmm");
  if (input.radiusYmm !== undefined) assertPositive(input.radiusYmm, "radiusYmm");
  const radiusYmm = input.radiusYmm ?? input.radiusXmm;
  const field: ScalarField = {
    nx: input.nx,
    ny: input.ny,
    dxMm: input.dxMm,
    dyMm: input.dyMm,
    wavelengthUm: input.wavelengthUm,
    real: new Array(input.nx * input.ny).fill(0),
    imag: new Array(input.nx * input.ny).fill(0),
  };
  assertField(field);
  const lambdaMm = input.wavelengthUm / 1000;
  const cx = (input.nx - 1) / 2;
  const cy = (input.ny - 1) / 2;
  for (let y = 0; y < input.ny; y += 1) {
    for (let x = 0; x < input.nx; x += 1) {
      const xMm = (x - cx) * input.dxMm;
      const yMm = (y - cy) * input.dyMm;
      const amplitude = Math.exp(-(xMm * xMm) / (input.radiusXmm * input.radiusXmm) - (yMm * yMm) / (radiusYmm * radiusYmm));
      const phaseX = input.wavefrontRadiusXmm === undefined ? 0 : xMm * xMm / input.wavefrontRadiusXmm;
      const phaseY = input.wavefrontRadiusYmm === undefined ? 0 : yMm * yMm / input.wavefrontRadiusYmm;
      // +k r^2/(2R): with the forward-(-1) DFT and H = exp(-i pi lambda z f^2)
      // a DIVERGING wavefront (R > 0) carries POSITIVE quadratic phase — the
      // same convention that makes the thin-lens mask -k r^2/(2f) focus.
      // (S16 Gemini cross-review finding, verified against the analytic
      // envelope for waists both upstream and downstream of the start plane.)
      const phase = (PI / lambdaMm) * (phaseX + phaseY);
      const idx = fieldIndex(field, x, y);
      field.real[idx] = amplitude * Math.cos(phase);
      field.imag[idx] = amplitude * Math.sin(phase);
    }
  }
  return field;
}

export function fieldPower(field: ScalarField): number {
  assertField(field);
  let sum = 0;
  for (let i = 0; i < field.real.length; i += 1) {
    sum += field.real[i] * field.real[i] + field.imag[i] * field.imag[i];
  }
  return sum * field.dxMm * field.dyMm;
}

export function fieldMomentRadii(field: ScalarField): { radiusXmm: number; radiusYmm: number } {
  assertField(field);
  const power = fieldPower(field);
  if (power <= 0) throw new RangeError("field power must be > 0");
  const cx = (field.nx - 1) / 2;
  const cy = (field.ny - 1) / 2;
  let x2 = 0;
  let y2 = 0;
  for (let y = 0; y < field.ny; y += 1) {
    for (let x = 0; x < field.nx; x += 1) {
      const idx = fieldIndex(field, x, y);
      const intensity = field.real[idx] * field.real[idx] + field.imag[idx] * field.imag[idx];
      x2 += ((x - cx) * field.dxMm) ** 2 * intensity * field.dxMm * field.dyMm;
      y2 += ((y - cy) * field.dyMm) ** 2 * intensity * field.dxMm * field.dyMm;
    }
  }
  return {
    radiusXmm: 2 * Math.sqrt(x2 / power),
    radiusYmm: 2 * Math.sqrt(y2 / power),
  };
}

export function fieldIntensity(field: ScalarField): number[] {
  assertField(field);
  return field.real.map((real, index) => real * real + field.imag[index] * field.imag[index]);
}

// ── fast unitary 2D transform ────────────────────────────────────────────
// Same contract as the original naive quadruple-loop DFT: forward sign -1,
// inverse sign +1, normalization 1/sqrt(nx*ny) split as 1/sqrt(N) per axis,
// standard [DC, positive, negative] frequency order (matches frequency()).
// Power-of-two lengths run an iterative radix-2 Cooley-Tukey; every other
// length runs a cached-twiddle 1D DFT per row/column (separable, O(N^3) in
// 2D instead of the old O(N^4)).

type AxisTables = { rev: Uint32Array | null; cos: Float64Array; sin: Float64Array };

const axisTableCache = new Map<string, AxisTables>();

function isPowerOfTwo(n: number): boolean {
  return (n & (n - 1)) === 0 && n > 0;
}

function axisTables(n: number, inverse: boolean): AxisTables {
  const key = `${n}:${inverse ? "i" : "f"}`;
  const cached = axisTableCache.get(key);
  if (cached) return cached;
  const sign = inverse ? 1 : -1;
  let tables: AxisTables;
  if (isPowerOfTwo(n)) {
    const rev = new Uint32Array(n);
    let bits = 0;
    while (1 << bits < n) bits += 1;
    for (let i = 0; i < n; i += 1) {
      let r = 0;
      for (let b = 0; b < bits; b += 1) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      rev[i] = r;
    }
    // twiddles for the largest stage; smaller stages stride through them
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i += 1) {
      const angle = (sign * 2 * PI * i) / n;
      cos[i] = Math.cos(angle);
      sin[i] = Math.sin(angle);
    }
    tables = { rev, cos, sin };
  } else {
    const cos = new Float64Array(n);
    const sin = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const angle = (sign * 2 * PI * i) / n;
      cos[i] = Math.cos(angle);
      sin[i] = Math.sin(angle);
    }
    tables = { rev: null, cos, sin };
  }
  axisTableCache.set(key, tables);
  return tables;
}

// in-place transform of one line of length n stored in re/im
function transformLine(re: Float64Array, im: Float64Array, n: number, inverse: boolean, scratchRe: Float64Array, scratchIm: Float64Array): void {
  const tables = axisTables(n, inverse);
  const norm = 1 / Math.sqrt(n);
  if (tables.rev) {
    const rev = tables.rev;
    for (let i = 0; i < n; i += 1) {
      const r = rev[i];
      if (r > i) {
        let tmp = re[i];
        re[i] = re[r];
        re[r] = tmp;
        tmp = im[i];
        im[i] = im[r];
        im[r] = tmp;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const stride = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k += 1) {
          const tCos = tables.cos[k * stride];
          const tSin = tables.sin[k * stride];
          const even = start + k;
          const odd = even + half;
          const oddRe = re[odd] * tCos - im[odd] * tSin;
          const oddIm = re[odd] * tSin + im[odd] * tCos;
          re[odd] = re[even] - oddRe;
          im[odd] = im[even] - oddIm;
          re[even] += oddRe;
          im[even] += oddIm;
        }
      }
    }
    for (let i = 0; i < n; i += 1) {
      re[i] *= norm;
      im[i] *= norm;
    }
    return;
  }
  // arbitrary length: cached-twiddle direct DFT for this line
  for (let k = 0; k < n; k += 1) {
    let sumRe = 0;
    let sumIm = 0;
    for (let x = 0; x < n; x += 1) {
      const idx = (k * x) % n;
      const c = tables.cos[idx];
      const s = tables.sin[idx];
      sumRe += re[x] * c - im[x] * s;
      sumIm += re[x] * s + im[x] * c;
    }
    scratchRe[k] = sumRe * norm;
    scratchIm[k] = sumIm * norm;
  }
  re.set(scratchRe.subarray(0, n));
  im.set(scratchIm.subarray(0, n));
}

export function dft2(field: ScalarField, inverse: boolean): { real: number[]; imag: number[] } {
  const { nx, ny } = field;
  const re = Float64Array.from(field.real);
  const im = Float64Array.from(field.imag);
  const lineMax = Math.max(nx, ny);
  const lineRe = new Float64Array(lineMax);
  const lineIm = new Float64Array(lineMax);
  const scratchRe = new Float64Array(lineMax);
  const scratchIm = new Float64Array(lineMax);
  // rows
  for (let y = 0; y < ny; y += 1) {
    const offset = y * nx;
    lineRe.set(re.subarray(offset, offset + nx));
    lineIm.set(im.subarray(offset, offset + nx));
    transformLine(lineRe, lineIm, nx, inverse, scratchRe, scratchIm);
    re.set(lineRe.subarray(0, nx), offset);
    im.set(lineIm.subarray(0, nx), offset);
  }
  // columns
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      const idx = y * nx + x;
      lineRe[y] = re[idx];
      lineIm[y] = im[idx];
    }
    transformLine(lineRe, lineIm, ny, inverse, scratchRe, scratchIm);
    for (let y = 0; y < ny; y += 1) {
      const idx = y * nx + x;
      re[idx] = lineRe[y];
      im[idx] = lineIm[y];
    }
  }
  return { real: Array.from(re), imag: Array.from(im) };
}

function frequency(index: number, count: number, spacingMm: number): number {
  const wrapped = index <= count / 2 ? index : index - count;
  return wrapped / (count * spacingMm);
}

export function propagateFresnel(field: ScalarField, distanceMm: number): ScalarField {
  assertField(field);
  if (!Number.isFinite(distanceMm)) throw new RangeError("distanceMm must be finite");
  const spectrum = dft2(field, false);
  const lambdaMm = field.wavelengthUm / 1000;
  for (let ky = 0; ky < field.ny; ky += 1) {
    const fy = frequency(ky, field.ny, field.dyMm);
    for (let kx = 0; kx < field.nx; kx += 1) {
      const fx = frequency(kx, field.nx, field.dxMm);
      const phase = -PI * lambdaMm * distanceMm * (fx * fx + fy * fy);
      const cos = Math.cos(phase);
      const sin = Math.sin(phase);
      const idx = fieldIndex(field, kx, ky);
      const real = spectrum.real[idx];
      const imag = spectrum.imag[idx];
      spectrum.real[idx] = real * cos - imag * sin;
      spectrum.imag[idx] = real * sin + imag * cos;
    }
  }
  const propagated = dft2({ ...field, real: spectrum.real, imag: spectrum.imag }, true);
  return { ...field, real: propagated.real, imag: propagated.imag };
}

export function propagateAngularSpectrum(field: ScalarField, distanceMm: number): ScalarField {
  assertField(field);
  if (!Number.isFinite(distanceMm)) throw new RangeError("distanceMm must be finite");
  const spectrum = dft2(field, false);
  const lambdaMm = field.wavelengthUm / 1000;
  const k = (2 * PI) / lambdaMm;
  for (let ky = 0; ky < field.ny; ky += 1) {
    const fy = frequency(ky, field.ny, field.dyMm);
    for (let kx = 0; kx < field.nx; kx += 1) {
      const fx = frequency(kx, field.nx, field.dxMm);
      const rootArg = 1 - lambdaMm * lambdaMm * (fx * fx + fy * fy);
      const idx = fieldIndex(field, kx, ky);
      const real = spectrum.real[idx];
      const imag = spectrum.imag[idx];
      if (rootArg >= 0) {
        const phase = k * distanceMm * (Math.sqrt(rootArg) - 1);
        const cos = Math.cos(phase);
        const sin = Math.sin(phase);
        spectrum.real[idx] = real * cos - imag * sin;
        spectrum.imag[idx] = real * sin + imag * cos;
      } else {
        const decay = Math.exp(-Math.abs(k * distanceMm) * Math.sqrt(-rootArg));
        spectrum.real[idx] = real * decay;
        spectrum.imag[idx] = imag * decay;
      }
    }
  }
  const propagated = dft2({ ...field, real: spectrum.real, imag: spectrum.imag }, true);
  return { ...field, real: propagated.real, imag: propagated.imag };
}

export function applyCircularAperture(field: ScalarField, radiusMm: number): ScalarField {
  assertField(field);
  assertPositive(radiusMm, "radiusMm");
  const real = [...field.real];
  const imag = [...field.imag];
  const cx = (field.nx - 1) / 2;
  const cy = (field.ny - 1) / 2;
  for (let y = 0; y < field.ny; y += 1) {
    for (let x = 0; x < field.nx; x += 1) {
      const xMm = (x - cx) * field.dxMm;
      const yMm = (y - cy) * field.dyMm;
      if (Math.hypot(xMm, yMm) > radiusMm) {
        const idx = fieldIndex(field, x, y);
        real[idx] = 0;
        imag[idx] = 0;
      }
    }
  }
  return { ...field, real, imag };
}

export function applyThinLensPhase(field: ScalarField, focalLengthMm: number, axis: "x" | "y" | "both" = "both"): ScalarField {
  assertField(field);
  if (!Number.isFinite(focalLengthMm) || focalLengthMm === 0) throw new RangeError("focalLengthMm must be finite and non-zero");
  const real = [...field.real];
  const imag = [...field.imag];
  const lambdaMm = field.wavelengthUm / 1000;
  const cx = (field.nx - 1) / 2;
  const cy = (field.ny - 1) / 2;
  for (let y = 0; y < field.ny; y += 1) {
    for (let x = 0; x < field.nx; x += 1) {
      const xMm = (x - cx) * field.dxMm;
      const yMm = (y - cy) * field.dyMm;
      const transverse = (axis === "y" ? 0 : xMm * xMm) + (axis === "x" ? 0 : yMm * yMm);
      const phase = (-PI * transverse) / (lambdaMm * focalLengthMm);
      const cos = Math.cos(phase);
      const sin = Math.sin(phase);
      const idx = fieldIndex(field, x, y);
      const currentReal = real[idx];
      const currentImag = imag[idx];
      real[idx] = currentReal * cos - currentImag * sin;
      imag[idx] = currentReal * sin + currentImag * cos;
    }
  }
  return { ...field, real, imag };
}

// Signed spherical sag: z(r) = R - sign(R) * sqrt(R^2 - r^2)  (≈ r^2/(2R)
// paraxially). Radius convention: R > 0 → centre of curvature to the right.
// Beyond the hemisphere edge (r >= |R|) the sag is clamped — such pixels are
// physically outside the lens and are expected to be blocked by an aperture.
function sphericalSagMm(radiusMm: number, rMm: number): number {
  const absR = Math.abs(radiusMm);
  const rc = Math.min(rMm, absR);
  return radiusMm - Math.sign(radiusMm) * Math.sqrt(radiusMm * radiusMm - rc * rc);
}

// Thin-element approximation of a single spherical refracting surface:
// phase(r) = k0 * (nBefore - nAfter) * sag(r). In the paraxial limit the
// two-surface sum reproduces applyThinLensPhase with the lensmaker focal
// length; the higher sag orders carry the (sag-driven) spherical aberration.
export function applySphericalSurfacePhase(
  field: ScalarField,
  radiusMm: number | "Infinity",
  nBefore: number,
  nAfter: number,
): ScalarField {
  assertField(field);
  assertPositive(nBefore, "nBefore");
  assertPositive(nAfter, "nAfter");
  if (radiusMm === "Infinity") return { ...field, real: [...field.real], imag: [...field.imag] };
  if (!Number.isFinite(radiusMm) || radiusMm === 0) throw new RangeError("radiusMm must be finite non-zero or Infinity");
  const real = [...field.real];
  const imag = [...field.imag];
  const k0 = (2 * PI) / (field.wavelengthUm / 1000);
  const deltaN = nBefore - nAfter;
  const cx = (field.nx - 1) / 2;
  const cy = (field.ny - 1) / 2;
  for (let y = 0; y < field.ny; y += 1) {
    for (let x = 0; x < field.nx; x += 1) {
      const xMm = (x - cx) * field.dxMm;
      const yMm = (y - cy) * field.dyMm;
      const phase = k0 * deltaN * sphericalSagMm(radiusMm, Math.hypot(xMm, yMm));
      const cos = Math.cos(phase);
      const sin = Math.sin(phase);
      const idx = fieldIndex(field, x, y);
      const currentReal = real[idx];
      const currentImag = imag[idx];
      real[idx] = currentReal * cos - currentImag * sin;
      imag[idx] = currentReal * sin + currentImag * cos;
    }
  }
  return { ...field, real, imag };
}

// Sampling guard for the real-sag mask: the local phase step per grid cell,
// |dphi/dr| * dx with dphi/dr = k0*|dn|*r/sqrt(R^2-r^2), must stay below pi.
// The guard is evaluated at the BEAM-relevant radius (2x the beam's 1/e^2
// radius — beyond that less than ~0.03% of the power lives): aliasing there
// is a real problem (warning). Aliasing only between the beam and the
// aperture edge corrupts a nearly empty region and is reported as info.
export function surfacePhaseSamplingWarnings(
  field: ScalarField,
  radiusMm: number | "Infinity",
  nBefore: number,
  nAfter: number,
  apertureRadiusMm: number,
  beamRadiusMm?: number,
): SimulationWarning[] {
  assertField(field);
  if (radiusMm === "Infinity") return [];
  const absR = Math.abs(radiusMm);
  const k0 = (2 * PI) / (field.wavelengthUm / 1000);
  const deltaN = Math.abs(nBefore - nAfter);
  const dx = Math.max(field.dxMm, field.dyMm);
  const stepAt = (r: number): number => {
    const rc = Math.min(r, absR * 0.999999);
    return ((k0 * deltaN * rc) / Math.sqrt(absR * absR - rc * rc)) * dx;
  };
  const radii = fieldMomentRadii(field);
  const beamEdge = Math.min(apertureRadiusMm, 2 * (beamRadiusMm ?? Math.max(radii.radiusXmm, radii.radiusYmm)));
  const stepBeam = stepAt(beamEdge);
  const stepAperture = stepAt(apertureRadiusMm);
  const warnings: SimulationWarning[] = [];
  if (apertureRadiusMm >= absR) {
    warnings.push(
      warning("FIELD_SAMPLING_LOW", "Aperture reaches the hemisphere edge of the spherical surface; sag is clamped beyond r = |R|.", "warning"),
    );
  }
  if (stepBeam > PI) {
    warnings.push(
      warning(
        "FIELD_SAMPLING_LOW",
        `Real-sag surface phase is undersampled inside the beam (${stepBeam.toFixed(2)} rad per cell > pi at r = ${beamEdge.toFixed(3)} mm); reduce dx.`,
        "warning",
      ),
    );
  } else if (stepAperture > PI) {
    warnings.push(
      warning(
        "FIELD_SAMPLING_LOW",
        `Real-sag surface phase is undersampled only beyond ~2x the beam radius (${stepAperture.toFixed(2)} rad per cell at the aperture edge); negligible power lives there.`,
        "info",
      ),
    );
  }
  return warnings;
}

export function fieldSamplingWarnings(field: ScalarField, beamRadiusMm: number): SimulationWarning[] {
  assertField(field);
  assertPositive(beamRadiusMm, "beamRadiusMm");
  const warnings: SimulationWarning[] = [];
  if (Math.max(field.dxMm, field.dyMm) > beamRadiusMm / 4) {
    warnings.push(warning("FIELD_SAMPLING_LOW", "Grid spacing is coarse relative to the beam radius.", "warning"));
  }
  if ((field.nx * field.dxMm) / 2 < 3 * beamRadiusMm || (field.ny * field.dyMm) / 2 < 3 * beamRadiusMm) {
    warnings.push(warning("FIELD_SAMPLING_LOW", "Grid extent is small relative to the beam radius.", "warning"));
  }
  return warnings;
}
