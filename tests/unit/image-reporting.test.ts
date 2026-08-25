import assert from "node:assert/strict";
import test from "node:test";

import { assessAperture } from "../../packages/image/src/aperture.ts";
import { fitGauss2d, fitSuperGauss2d, type Gauss2dFitParams } from "../../packages/image/src/fit.ts";
import { computeRectMoments, type ImageMoments } from "../../packages/image/src/moments.ts";
import {
  compareFitToMoments,
  compareModelResiduals,
  computeResidualOutput,
  mapGauss2dToPhysical,
  mapMomentsToPhysical,
  sigmaFromSuperGaussWidth,
} from "../../packages/image/src/reporting.ts";

// Deterministic inline LCG for noise fixtures; identical sequence on every run.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// Unit-variance noise from a uniform [0,1) draw: (u - 0.5) * sqrt(12).
function unitGaussian(next: () => number): number {
  return (next() - 0.5) * Math.sqrt(12);
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

function gaussian2dPixels(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  sigma1: number,
  sigma2: number,
  theta: number,
  amplitude: number,
  background: number,
): number[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      pixels[x + y * width] =
        background + amplitude * Math.exp(-((u * u) / (2 * sigma1 * sigma1) + (v * v) / (2 * sigma2 * sigma2)));
    }
  }
  return pixels;
}

// Plan v5 section 6 exact Super-Gaussian: I = B + A*exp(-2*((u/w1)^2 + (v/w2)^2)^n).
function superGauss2dPixels(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  w1: number,
  w2: number,
  theta: number,
  n: number,
  amplitude: number,
  background: number,
): number[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const energy = (u * u) / (w1 * w1) + (v * v) / (w2 * w2);
      pixels[x + y * width] = background + amplitude * Math.exp(-2 * Math.pow(energy, n));
    }
  }
  return pixels;
}

// Independently computed high-precision Gamma reference for the conversion
// tests. Substitute t = u^3 in the integral definition of Gamma:
//   Gamma(z) = 3 * integral_0^inf u^(3z-1) e^(-u^3) du.
// The integrand is smooth for every z >= 1/3 used here and decays below
// exp(-1000) by u = 10, so composite Simpson with a fine step makes the
// quadrature error negligible. This reference shares NOTHING with the
// production Lanczos approximation and is itself pinned by exact gamma
// identities below, so the production output is verified against an
// independently derived value rather than echoed.
function quadratureGamma(z: number): number {
  const upperBound = 10;
  const stepCount = 400000;
  const h = upperBound / stepCount;
  const f = (u: number): number => Math.pow(u, 3 * z - 1) * Math.exp(-u * u * u);
  let sum = f(0) + f(upperBound);
  for (let i = 1; i < stepCount; i += 1) {
    sum += (i % 2 === 0 ? 2 : 4) * f(i * h);
  }
  return 3 * ((h / 3) * sum);
}

// The sigma/w factor implied by the Plan v5 section 6 conversion, evaluated
// with the independent quadrature reference:
//   sigma = w * sqrt(2^(-1/n) * Gamma(2/n) / (2 * Gamma(1/n))).
function referenceSigmaRatio(n: number): number {
  return Math.sqrt(Math.pow(2, -1 / n) * (quadratureGamma(2 / n) / (2 * quadratureGamma(1 / n))));
}

function validMomentsFixture(): ImageMoments {
  return {
    valid: true,
    invalidReason: null,
    pixelCount: 64,
    finitePixelCount: 64,
    sumCounts: 64,
    absSumCounts: 64,
    centroidXPx: 4,
    centroidYPx: 4,
    covXxPx2: 4,
    covYyPx2: 4,
    covXyPx2: 0,
    lambdaMajorPx2: 4,
    lambdaMinorPx2: 4,
    thetaRad: 0,
    sigmaMajorPx: 2,
    sigmaMinorPx: 2,
    d4SigmaMajorPx: 8,
    d4SigmaMinorPx: 8,
    orientationContrastQ: 0,
  };
}

test("S18a identity calibration reproduces the pixel geometry exactly", () => {
  const params: Gauss2dFitParams = {
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: 47.3,
    centerYPx: 44.8,
    sigmaMajorPx: 9,
    sigmaMinorPx: 5,
    thetaRad: 0.6,
  };
  const geo = mapGauss2dToPhysical(params, { pixelPitchUmX: 1, pixelPitchUmY: 1 });
  // Multiplying by an exactly-1 pitch is bitwise exact for the centres.
  assert.equal(geo.centerXUm, 47.3);
  assert.equal(geo.centerYUm, 44.8);
  assert.ok(relativeError(geo.sigmaMajorUm, 9) < 1e-12, `sigmaMajor ${geo.sigmaMajorUm}`);
  assert.ok(relativeError(geo.sigmaMinorUm, 5) < 1e-12, `sigmaMinor ${geo.sigmaMinorUm}`);
  assert.ok(relativeError(geo.d4SigmaMajorUm, 36) < 1e-12, `d4Major ${geo.d4SigmaMajorUm}`);
  assert.ok(relativeError(geo.d4SigmaMinorUm, 20) < 1e-12, `d4Minor ${geo.d4SigmaMinorUm}`);
  assert.ok(Math.abs(geo.thetaRad - 0.6) < 1e-12, `theta ${geo.thetaRad}`);
});

test("S18a anisotropy oracle: the covariance transform round-trips micrometer truth while naive per-axis scaling is wrong", () => {
  const pitchX = 2;
  const pitchY = 1;
  // Ground truth in MICROMETER space: a rotated elliptical Gaussian.
  const sigmaMajorUm = 180;
  const sigmaMinorUm = 100;
  const thetaUm = 0.5;
  const cos = Math.cos(thetaUm);
  const sin = Math.sin(thetaUm);
  const major2Um = sigmaMajorUm * sigmaMajorUm;
  const minor2Um = sigmaMinorUm * sigmaMinorUm;
  const cxxUm = cos * cos * major2Um + sin * sin * minor2Um;
  const cyyUm = sin * sin * major2Um + cos * cos * minor2Um;
  const cxyUm = cos * sin * (major2Um - minor2Um);
  // Inverse transform into pixel space: C_px = S^-1 * C_um * S^-T.
  const cxxPx = cxxUm / (pitchX * pitchX);
  const cyyPx = cyyUm / (pitchY * pitchY);
  const cxyPx = cxyUm / (pitchX * pitchY);
  // Analytic eigen decomposition of the pixel covariance (the same 2x2 rule
  // the module documents), so the fixture is derived independently of the
  // implementation under test.
  const meanPx = (cxxPx + cyyPx) / 2;
  const halfDiffPx = (cxxPx - cyyPx) / 2;
  const discPx = Math.sqrt(halfDiffPx * halfDiffPx + cxyPx * cxyPx);
  const sigmaMajorPx = Math.sqrt(meanPx + discPx);
  const sigmaMinorPx = Math.sqrt(meanPx - discPx);
  let thetaPx = 0.5 * Math.atan2(2 * cxyPx, cxxPx - cyyPx);
  if (thetaPx < 0) thetaPx += Math.PI;

  const params: Gauss2dFitParams = {
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: 100,
    centerYPx: 50,
    sigmaMajorPx,
    sigmaMinorPx,
    thetaRad: thetaPx,
  };
  const geo = mapGauss2dToPhysical(params, { pixelPitchUmX: pitchX, pixelPitchUmY: pitchY });
  assert.ok(relativeError(geo.sigmaMajorUm, sigmaMajorUm) < 1e-9, `sigmaMajorUm ${geo.sigmaMajorUm}`);
  assert.ok(relativeError(geo.sigmaMinorUm, sigmaMinorUm) < 1e-9, `sigmaMinorUm ${geo.sigmaMinorUm}`);
  assert.ok(Math.abs(geo.thetaRad - thetaUm) < 1e-9, `thetaUm ${geo.thetaRad} vs ${thetaUm}`);
  assert.ok(relativeError(geo.d4SigmaMajorUm, 720) < 1e-9, `d4Major ${geo.d4SigmaMajorUm}`);
  assert.ok(relativeError(geo.d4SigmaMinorUm, 400) < 1e-9, `d4Minor ${geo.d4SigmaMinorUm}`);
  assert.equal(geo.centerXUm, 200);
  assert.equal(geo.centerYUm, 50);

  // The discriminating check: naive per-axis scaling (each pixel sigma times
  // its own pitch, angle untouched) is visibly wrong for an anisotropic
  // pitch. The physical angle also differs from the pixel angle.
  const naiveMajorUm = sigmaMajorPx * pitchX;
  const naiveMinorUm = sigmaMinorPx * pitchY;
  assert.ok(relativeError(naiveMajorUm, sigmaMajorUm) > 0.01, `naive major ${naiveMajorUm}`);
  assert.ok(relativeError(naiveMinorUm, sigmaMinorUm) > 0.01, `naive minor ${naiveMinorUm}`);
  assert.ok(Math.abs(thetaPx - thetaUm) > 0.01, `pixel angle ${thetaPx} differs from physical ${thetaUm}`);
});

test("S18a mapMomentsToPhysical agrees with mapGauss2dToPhysical on the same pixel covariance", () => {
  const width = 96;
  const height = 96;
  const pixels = gaussian2dPixels(width, height, 47.3, 44.8, 9, 5, 0.6, 100, 0);
  const moments = computeRectMoments({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(moments.valid, true);

  const calibration = { pixelPitchUmX: 2, pixelPitchUmY: 1 };
  const fromMoments = mapMomentsToPhysical(moments, calibration);
  assert.notEqual(fromMoments, null);

  // Equivalent fit parameters carrying exactly the moments' own canonical
  // covariance and centroid: the two mapping paths then perform the same
  // covariance transform and must agree on physical sigma/theta.
  const params: Gauss2dFitParams = {
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: moments.centroidXPx as number,
    centerYPx: moments.centroidYPx as number,
    sigmaMajorPx: moments.sigmaMajorPx as number,
    sigmaMinorPx: moments.sigmaMinorPx as number,
    thetaRad: moments.thetaRad as number,
  };
  const fromFit = mapGauss2dToPhysical(params, calibration);
  assert.equal(fromMoments!.centerXUm, fromFit.centerXUm);
  assert.equal(fromMoments!.centerYUm, fromFit.centerYUm);
  assert.ok(
    relativeError(fromMoments!.sigmaMinorUm, fromFit.sigmaMinorUm) < 0.01,
    `sigmaMinor ${fromMoments!.sigmaMinorUm} vs ${fromFit.sigmaMinorUm}`,
  );
  assert.ok(Math.abs(fromMoments!.thetaRad - fromFit.thetaRad) < 0.01, `theta ${fromMoments!.thetaRad}`);
});

test("S18a eigen22 rank-1 clamp: mapGauss2dToPhysical of a zero minor sigma never emits NaN physical widths", () => {
  // sigmaMinorPx = 0 is production-reachable (fit.ts mapSigma maps a decimated
  // sigma <= 1/sqrt(12) to exactly 0). The pixel covariance is then rank 1
  // and mean - discriminant lands a few ulp below zero for many thetas; the
  // sqrt then NaNed sigmaMinorUm even at isotropic pitch (repro thetas
  // 0.4/0.6/1.3 with sigma (10,0)). The 1e-9 clamp in eigen22 turns the
  // cancellation noise into an exact 0; at other pitch pairs the same rank-1
  // spectrum is at worst a finite epsilon above zero, never NaN.
  for (const theta of [0.4, 0.6, 1.3]) {
    const params: Gauss2dFitParams = {
      amplitudeCounts: 100,
      backgroundCounts: 0,
      centerXPx: 7.5,
      centerYPx: 4.25,
      sigmaMajorPx: 10,
      sigmaMinorPx: 0,
      thetaRad: theta,
    };
    for (const calibration of [
      { pixelPitchUmX: 1, pixelPitchUmY: 1 },
      { pixelPitchUmX: 2, pixelPitchUmY: 1 },
      { pixelPitchUmX: 1, pixelPitchUmY: 2 },
      { pixelPitchUmX: 2, pixelPitchUmY: 3 },
    ]) {
      const geo = mapGauss2dToPhysical(params, calibration);
      const context = `theta=${theta} pitch=${calibration.pixelPitchUmX}/${calibration.pixelPitchUmY}`;
      assert.ok(Number.isFinite(geo.sigmaMajorUm) && geo.sigmaMajorUm > 0, `sigmaMajor ${context}`);
      assert.ok(Number.isFinite(geo.sigmaMinorUm), `sigmaMinor NaN ${context}`);
      assert.ok(Number.isFinite(geo.d4SigmaMinorUm), `d4Minor NaN ${context}`);
      assert.ok(Number.isFinite(geo.d4SigmaMajorUm), `d4Major ${context}`);
      assert.ok(Number.isFinite(geo.thetaRad), `theta ${context}`);
      assert.ok(Number.isFinite(geo.centerXUm) && Number.isFinite(geo.centerYUm), `center ${context}`);
      if (calibration.pixelPitchUmX === 1 && calibration.pixelPitchUmY === 1) {
        // The documented isotropic repro: the mean - discriminant
        // cancellation is negative there and the clamp makes it exactly 0.
        assert.equal(geo.sigmaMinorUm, 0, `sigmaMinor ${context}`);
        assert.equal(geo.d4SigmaMinorUm, 0, `d4Minor ${context}`);
      } else {
        // Anisotropic pitch: the same rank-1 spectrum stays a numerically
        // exact zero (negative cancellation clamped) or a finite epsilon
        // above zero - in either case never NaN and effectively zero.
        assert.ok(geo.sigmaMinorUm >= 0 && geo.sigmaMinorUm <= 1e-7, `sigmaMinor ${context} = ${geo.sigmaMinorUm}`);
        assert.ok(
          geo.d4SigmaMinorUm >= 0 && geo.d4SigmaMinorUm <= 4e-7,
          `d4Minor ${context} = ${geo.d4SigmaMinorUm}`,
        );
      }
    }
  }
});

test("S18a eigen22 rank-1 clamp: mapMomentsToPhysical of a collinear moment set never emits NaN physical widths", () => {
  // Four weight-10 pixels on the line y = 2x - 2 form a rank-1 moment set
  // whose minor eigenvalue is exactly 0. The physical covariance inherits
  // that rank and the mean - discriminant cancellation NaNed sigmaMinorUm
  // for a large fraction of pitch pairs; the clamp keeps it exactly 0.
  const width = 16;
  const height = 16;
  const values = new Float64Array(width * height).fill(0);
  values[2 + 2 * width] = 10;
  values[3 + 4 * width] = 10;
  values[4 + 6 * width] = 10;
  values[5 + 8 * width] = 10;
  const moments = computeRectMoments({ values, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(moments.valid, true);
  assert.equal(moments.lambdaMinorPx2, 0);

  for (const calibration of [
    { pixelPitchUmX: 1, pixelPitchUmY: 1 },
    { pixelPitchUmX: 2, pixelPitchUmY: 1 },
    { pixelPitchUmX: 1, pixelPitchUmY: 2 },
    { pixelPitchUmX: 2, pixelPitchUmY: 3 },
    { pixelPitchUmX: 1.5, pixelPitchUmY: 2.5 },
  ]) {
    const geo = mapMomentsToPhysical(moments, calibration);
    const context = `pitch=${calibration.pixelPitchUmX}/${calibration.pixelPitchUmY}`;
    assert.notEqual(geo, null, context);
    assert.equal(geo!.sigmaMinorUm, 0, `sigmaMinor ${context}`);
    assert.equal(geo!.d4SigmaMinorUm, 0, `d4Minor ${context}`);
    assert.ok(Number.isFinite(geo!.sigmaMajorUm) && geo!.sigmaMajorUm > 0, `sigmaMajor ${context}`);
    assert.ok(Number.isFinite(geo!.d4SigmaMajorUm), `d4Major ${context}`);
    assert.ok(Number.isFinite(geo!.thetaRad), `theta ${context}`);
    assert.ok(Number.isFinite(geo!.centerXUm) && Number.isFinite(geo!.centerYUm), `center ${context}`);
  }
});

test("S18a a healthy physical mapping is bit-identical to the unclamped analytic eigen decomposition", () => {
  // The clamp is a no-op whenever the minor eigenvalue is genuinely positive:
  // a well-conditioned case must reproduce the raw mean -+ discriminant
  // decomposition bit for bit, so the fix cannot perturb healthy outputs.
  const params: Gauss2dFitParams = {
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: 47.3,
    centerYPx: 44.8,
    sigmaMajorPx: 9,
    sigmaMinorPx: 5,
    thetaRad: 0.6,
  };
  const pitchX = 2;
  const pitchY = 1;
  const cos = Math.cos(0.6);
  const sin = Math.sin(0.6);
  const major2 = 9 * 9;
  const minor2 = 5 * 5;
  const cxxUm = (cos * cos * major2 + sin * sin * minor2) * pitchX * pitchX;
  const cyyUm = (sin * sin * major2 + cos * cos * minor2) * pitchY * pitchY;
  const cxyUm = cos * sin * (major2 - minor2) * pitchX * pitchY;
  const mean = (cxxUm + cyyUm) / 2;
  const halfDifference = (cxxUm - cyyUm) / 2;
  const discriminant = Math.sqrt(halfDifference * halfDifference + cxyUm * cxyUm);
  const expectedMinor = mean - discriminant;
  assert.ok(expectedMinor > 1e-6);

  const geo = mapGauss2dToPhysical(params, { pixelPitchUmX: pitchX, pixelPitchUmY: pitchY });
  assert.equal(geo.sigmaMajorUm, Math.sqrt(mean + discriminant));
  assert.equal(geo.sigmaMinorUm, Math.sqrt(expectedMinor));
  assert.equal(geo.d4SigmaMajorUm, 4 * Math.sqrt(mean + discriminant));
  assert.equal(geo.d4SigmaMinorUm, 4 * Math.sqrt(expectedMinor));
});

test("S18a sigmaFromSuperGaussWidth matches exactly computable closed forms within 1e-12", () => {
  // n = 1: Gamma(2) = 1 and Gamma(1) = 1, so sigma/w = 0.5 exactly.
  assert.ok(Math.abs(sigmaFromSuperGaussWidth(10, 1) / 10 - 0.5) <= 1e-12);
  // n = 2: Gamma(1) = 1 and the exact identity Gamma(1/2) = sqrt(pi), so
  // sigma/w = sqrt(2^(-1/2) / (2 sqrt(pi))) — computable from Math.PI alone.
  const expectedN2 = Math.sqrt(2 ** -0.5 / (2 * Math.sqrt(Math.PI)));
  assert.ok(
    Math.abs(sigmaFromSuperGaussWidth(1, 2) - expectedN2) <= 1e-12,
    `n=2 ${sigmaFromSuperGaussWidth(1, 2)} vs ${expectedN2}`,
  );
  // The same reference expressed as the documented 12-digit constant
  // (independently derived from the closed form, not echoed from the module).
  assert.ok(Math.abs(sigmaFromSuperGaussWidth(1, 2) - 0.446621920874) <= 1e-8);
  // n = 1/2: Gamma(4) = 6 and Gamma(2) = 1, so sigma/w = sqrt(3)/2 exactly.
  assert.ok(Math.abs(sigmaFromSuperGaussWidth(1, 0.5) - Math.sqrt(3) / 2) <= 1e-12);
  // n = 2/3: Gamma(3) = 2 and Gamma(3/2) = sqrt(pi)/2, so
  // sigma/w = (2*pi)^(-1/4) — an exact identity over the production gammas.
  assert.ok(Math.abs(sigmaFromSuperGaussWidth(1, 2 / 3) - Math.pow(2 * Math.PI, -0.25)) <= 1e-12);
});

test("S18a sigmaFromSuperGaussWidth matches an independent quadrature reference at fractional exponents", () => {
  for (const n of [0.75, 3]) {
    const expected = referenceSigmaRatio(n);
    const actual = sigmaFromSuperGaussWidth(1, n);
    assert.ok(relativeError(actual, expected) < 1e-10, `n=${n}: ${actual} vs ${expected}`);
  }
});

test("S18a the independent quadrature Gamma satisfies exact gamma identities within 1e-12", () => {
  // Gamma reflection identity Gamma(1/3)*Gamma(2/3) = 2*pi/sqrt(3): pins the
  // independent reference itself so the fractional-n comparisons above are
  // not just echoing the production approximation. The integer identities
  // pin the same reference at their exact known values.
  const product = quadratureGamma(1 / 3) * quadratureGamma(2 / 3);
  const identity = (2 * Math.PI) / Math.sqrt(3);
  assert.ok(Math.abs(product - identity) <= 1e-12, `${product} vs ${identity}`);
  assert.ok(Math.abs(quadratureGamma(4) - 6) <= 1e-12);
  assert.ok(Math.abs(quadratureGamma(3) - 2) <= 1e-12);
});

test("S18a model comparison: a flat-top Super-Gaussian is explained only by the super-Gaussian model", () => {
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = superGauss2dPixels(width, height, 48.4, 47.6, 20, 20, 0.3, 3, 100, 0);
  const gauss = fitGauss2d({ values: pixels, width, height }, roi);
  const superGauss = fitSuperGauss2d({ values: pixels, width, height }, roi);
  assert.equal(gauss.status, "converged");
  assert.equal(superGauss.status, "converged");

  const comparison = compareModelResiduals({ values: pixels, width, height }, roi, gauss, superGauss);
  assert.notEqual(comparison.gaussRmsCounts, null);
  assert.notEqual(comparison.superGaussRmsCounts, null);
  assert.ok(
    (comparison.superGaussRmsCounts as number) < (comparison.gaussRmsCounts as number),
    `rms ${comparison.gaussRmsCounts} vs ${comparison.superGaussRmsCounts}`,
  );
  assert.ok(
    (comparison.relativeRmsReduction as number) > 0.3,
    `reduction ${comparison.relativeRmsReduction}`,
  );
});

test("S18a on a pure Gaussian both models explain the data and the relative RMS reduction stays near zero", () => {
  const width = 96;
  const height = 96;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 47.3, 48.1, 9, 9, 0, 100, 0);
  const next = makeLcg(555);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 1 * unitGaussian(next);

  const gauss = fitGauss2d({ values: pixels, width, height }, roi);
  const superGauss = fitSuperGauss2d({ values: pixels, width, height }, roi);
  assert.equal(gauss.status, "converged");
  assert.equal(superGauss.status, "converged");
  const comparison = compareModelResiduals({ values: pixels, width, height }, roi, gauss, superGauss);
  assert.notEqual(comparison.gaussRmsCounts, null);
  assert.notEqual(comparison.superGaussRmsCounts, null);
  assert.ok(
    Math.abs(comparison.relativeRmsReduction as number) < 0.05,
    `reduction ${comparison.relativeRmsReduction}`,
  );
});

test("S18a fit-vs-moments deltas stay within +-1.5 percent on a Gaussian chain and the tail-limited flag follows n", () => {
  // revised: the frame is widened to 160 x 160 with the beam centred at
  // (79.3, 76.5) because the aperture-clipping gate requires the 6-sigma
  // check ellipse to lie fully inside the image (the old 96-px fixture was
  // legitimately clipped and is now suppressed as aperture_clipped). The
  // moments are measured on the fit-background-subtracted field, which is
  // the same field used by the alpha gate.
  const width = 160;
  const height = 160;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussian2dPixels(width, height, 79.3, 76.5, 9, 5, 0.6, 100, 0);
  const next = makeLcg(20240711);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.5 * unitGaussian(next);

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const assessment = assessAperture({ values: pixels, width, height }, roi, fit, 0.5);
  assert.equal(assessment.suppressionReason, null);
  assert.notEqual(assessment.moments, null);
  assert.notEqual(assessment.fitWidths, null);

  const plain = compareFitToMoments(assessment.fitWidths!, assessment.moments!);
  assert.equal(plain.tailLimited, false);
  assert.ok(
    plain.deltaMajorPercent !== null && Math.abs(plain.deltaMajorPercent) < 1.5,
    `deltaMajor ${plain.deltaMajorPercent}`,
  );
  assert.ok(
    plain.deltaMinorPercent !== null && Math.abs(plain.deltaMinorPercent) < 1.5,
    `deltaMinor ${plain.deltaMinorPercent}`,
  );

  const tailLimited = compareFitToMoments(assessment.fitWidths!, assessment.moments!, 0.8);
  assert.equal(tailLimited.tailLimited, true);
  assert.deepStrictEqual(tailLimited.deltaMajorPercent, plain.deltaMajorPercent);
  assert.deepStrictEqual(tailLimited.deltaMinorPercent, plain.deltaMinorPercent);
});

test("S18a invalid moments yield null deltas while the tail-limited flag stays honest", () => {
  const invalid: ImageMoments = {
    valid: false,
    invalidReason: "nonpositive_sum",
    pixelCount: 16,
    finitePixelCount: 16,
    sumCounts: 0,
    absSumCounts: 16,
    centroidXPx: null,
    centroidYPx: null,
    covXxPx2: null,
    covYyPx2: null,
    covXyPx2: null,
    lambdaMajorPx2: null,
    lambdaMinorPx2: null,
    thetaRad: null,
    sigmaMajorPx: null,
    sigmaMinorPx: null,
    d4SigmaMajorPx: null,
    d4SigmaMinorPx: null,
    orientationContrastQ: null,
  };
  const geometry = { d4SigmaMajorPx: 36, d4SigmaMinorPx: 20 };
  assert.deepStrictEqual(compareFitToMoments(geometry, invalid), {
    deltaMajorPercent: null,
    deltaMinorPercent: null,
    tailLimited: false,
  });
  assert.deepStrictEqual(compareFitToMoments(geometry, invalid, 0.8), {
    deltaMajorPercent: null,
    deltaMinorPercent: null,
    tailLimited: true,
  });
});

test("S18a residual display grid block means are exact on a linear field and empty blocks read NaN", () => {
  const width = 30;
  const height = 20;
  const values: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) values.push(x + 2 * y);
  }
  // A constant-zero model makes every residual equal to the field itself.
  const params: Gauss2dFitParams = {
    amplitudeCounts: 0,
    backgroundCounts: 0,
    centerXPx: 15,
    centerYPx: 10,
    sigmaMajorPx: 5,
    sigmaMinorPx: 5,
    thetaRad: 0,
  };
  const corrected = { values, width, height };
  const out = computeResidualOutput(corrected, { x0: 0, y0: 0, width, height }, params, { maxDisplaySize: 8 });
  assert.equal(out.display.blockSizePx, 4);
  assert.equal(out.display.width, 8);
  assert.equal(out.display.height, 5);

  // Hand-computed block means of x + 2*y. Full 4x4 blocks: mean x = 4bx+1.5
  // and mean y = 4by+1.5, so the mean is X + 2Y + 4.5 with X = 4bx,
  // Y = 4by. The last column block (two pixels wide) has mean x = 28.5, so
  // its mean is X + 2Y + 3.5.
  const expected = new Float64Array(40);
  for (let by = 0; by < 5; by += 1) {
    for (let bx = 0; bx < 8; bx += 1) {
      const X = bx * 4;
      const Y = by * 4;
      expected[by * 8 + bx] = X + 2 * Y + (bx === 7 ? 3.5 : 4.5);
    }
  }
  assert.deepStrictEqual(out.display.values, expected);

  // rms and maxAbs against a direct computation of the same residuals.
  let sumSquared = 0;
  let maxAbs = 0;
  for (const value of values) {
    sumSquared += value * value;
    if (value > maxAbs) maxAbs = value;
  }
  assert.equal(out.rmsCounts, Math.sqrt(sumSquared / values.length));
  assert.equal(out.maxAbsCounts, maxAbs);

  // A block with NO finite pixel reports NaN, while every other cell is the
  // exact mean of its 0.5-count residuals.
  const smallValues = new Float64Array(24).fill(1.5);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) smallValues[y * 6 + x] = Number.NaN;
  }
  const constantModel: Gauss2dFitParams = {
    amplitudeCounts: 0,
    backgroundCounts: 1,
    centerXPx: 3,
    centerYPx: 2,
    sigmaMajorPx: 2,
    sigmaMinorPx: 2,
    thetaRad: 0,
  };
  const small = computeResidualOutput(
    { values: smallValues, width: 6, height: 4 },
    { x0: 0, y0: 0, width: 6, height: 4 },
    constantModel,
    { maxDisplaySize: 2 },
  );
  assert.equal(small.display.blockSizePx, 3);
  assert.equal(small.display.width, 2);
  assert.equal(small.display.height, 2);
  assert.deepStrictEqual(small.display.values, Float64Array.from([Number.NaN, 0.5, 0.5, 0.5]));
  assert.equal(small.rmsCounts, 0.5);
  assert.equal(small.maxAbsCounts, 0.5);
});

test("S18a block size 1 reproduces the residual field itself", () => {
  const width = 5;
  const height = 3;
  const params = {
    amplitudeCounts: 100,
    backgroundCounts: 5,
    centerXPx: 2.4,
    centerYPx: 1.1,
    sigmaMajorPx: 2.2,
    sigmaMinorPx: 1.6,
    thetaRad: 0.35,
  };
  const pixels = gaussian2dPixels(width, height, 2.4, 1.1, 2.2, 1.6, 0.35, 100, 5);
  const expectedField = new Float64Array(width * height);
  const cos = Math.cos(0.35);
  const sin = Math.sin(0.35);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - 2.4;
      const dy = y - 1.1;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const model = 5 + 100 * Math.exp(-((u * u) / (2 * 2.2 * 2.2) + (v * v) / (2 * 1.6 * 1.6)));
      expectedField[y * width + x] = pixels[y * width + x] - model;
    }
  }
  const out = computeResidualOutput({ values: pixels, width, height }, { x0: 0, y0: 0, width, height }, params);
  assert.equal(out.display.blockSizePx, 1);
  assert.equal(out.display.width, width);
  assert.equal(out.display.height, height);
  for (let i = 0; i < expectedField.length; i += 1) {
    assert.ok(Math.abs(out.display.values[i] - expectedField[i]) <= 1e-9, `cell ${i}`);
  }
  let sumSquared = 0;
  let maxAbs = 0;
  for (const residual of expectedField) {
    sumSquared += residual * residual;
    if (Math.abs(residual) > maxAbs) maxAbs = Math.abs(residual);
  }
  assert.ok(Math.abs(out.rmsCounts - Math.sqrt(sumSquared / expectedField.length)) <= 1e-9);
  assert.ok(Math.abs(out.maxAbsCounts - maxAbs) <= 1e-9);
});

test("S18a reporting validation rejects non-positive or non-finite pitches and out-of-image ROIs", () => {
  const params: Gauss2dFitParams = {
    amplitudeCounts: 100,
    backgroundCounts: 0,
    centerXPx: 4,
    centerYPx: 4,
    sigmaMajorPx: 2,
    sigmaMinorPx: 2,
    thetaRad: 0,
  };
  for (const pitch of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => mapGauss2dToPhysical(params, { pixelPitchUmX: pitch, pixelPitchUmY: 1 }), RangeError);
    assert.throws(() => mapGauss2dToPhysical(params, { pixelPitchUmX: 1, pixelPitchUmY: pitch }), RangeError);
    assert.throws(
      () => mapMomentsToPhysical(validMomentsFixture(), { pixelPitchUmX: pitch, pixelPitchUmY: 1 }),
      RangeError,
    );
  }

  const pixels = gaussian2dPixels(8, 8, 4, 4, 2, 2, 0, 50, 1);
  const corrected = { values: pixels, width: 8, height: 8 };
  const roi = { x0: 0, y0: 0, width: 8, height: 8 };
  const gauss = fitGauss2d(corrected, roi);
  const superGauss = fitSuperGauss2d(corrected, roi);
  const badRoi = { x0: 7, y0: 0, width: 2, height: 2 };
  assert.throws(() => compareModelResiduals(corrected, badRoi, gauss, superGauss), RangeError);
  assert.throws(() => computeResidualOutput(corrected, badRoi, params), RangeError);
  assert.throws(() => computeResidualOutput(corrected, roi, params, { maxDisplaySize: 0 }), RangeError);
  assert.throws(() => computeResidualOutput(corrected, roi, params, { maxDisplaySize: 2.5 }), RangeError);
});

test("S18a reporting outputs are deterministic and never mutate the input pixel array", () => {
  const width = 40;
  const height = 40;
  const roi = { x0: 0, y0: 0, width, height };
  const next = makeLcg(77);
  const pixels = gaussian2dPixels(width, height, 20.3, 19.4, 7, 4, -0.6, 80, 4);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.3 * unitGaussian(next);
  const original = pixels.slice();

  const fit = fitGauss2d({ values: pixels, width, height }, roi);
  assert.equal(fit.status, "converged");
  const superFit = fitSuperGauss2d({ values: pixels, width, height }, roi);
  const first = compareModelResiduals({ values: pixels, width, height }, roi, fit, superFit);
  const second = compareModelResiduals({ values: pixels, width, height }, roi, fit, superFit);
  assert.deepStrictEqual(second, first);

  const params = fit.params as Gauss2dFitParams;
  const firstGrid = computeResidualOutput({ values: pixels, width, height }, roi, params, { maxDisplaySize: 12 });
  const secondGrid = computeResidualOutput({ values: pixels, width, height }, roi, params, { maxDisplaySize: 12 });
  assert.deepStrictEqual(secondGrid, firstGrid);

  const calibration = { pixelPitchUmX: 2, pixelPitchUmY: 1 };
  assert.deepStrictEqual(mapGauss2dToPhysical(params, calibration), mapGauss2dToPhysical(params, calibration));
  assert.deepStrictEqual(pixels, original);
});
