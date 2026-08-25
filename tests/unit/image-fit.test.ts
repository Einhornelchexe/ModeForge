import assert from "node:assert/strict";
import test from "node:test";

import { superGaussianRelativeIntensity } from "../../packages/beams/src/profiles.ts";
import {
  fitGauss1d,
  fitGauss2d,
  fitSuperGauss2d,
  internalModelProbe,
  type Gauss2dFitParams,
} from "../../packages/image/src/fit.ts";
import { extractCut } from "../../packages/image/src/profiles.ts";

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

function gaussianRowImage(
  width: number,
  height: number,
  center: number,
  sigma: number,
  amplitude: number,
  background: number,
): number[] {
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - center;
      pixels[x + y * width] = background + amplitude * Math.exp(-(dx * dx) / (2 * sigma * sigma));
    }
  }
  return pixels;
}

test("S18a analytic Jacobians match central finite differences for all four models", () => {
  const FINITE_DIFFERENCE_STEP_RELATIVE = 1e-6;
  const MAX_REL_DEVIATION = 1e-4;

  const assertJacobian = (label: string, raw: number[], points: Array<[number, number]>): void => {
    let probe: (typeof internalModelProbe)[keyof typeof internalModelProbe];
    switch (label) {
      case "gauss2dConstantBackground":
        probe = internalModelProbe.gauss2dConstantBackground;
        break;
      case "gauss2dTiltedBackground":
        probe = internalModelProbe.gauss2dTiltedBackground;
        break;
      case "superGauss2d":
        probe = internalModelProbe.superGauss2d;
        break;
      case "gauss1d":
        probe = internalModelProbe.gauss1d;
        break;
      default:
        throw new Error(`unknown probe ${label}`);
    }
    const nParams = probe.parameterCount;
    for (let column = 0; column < nParams; column += 1) {
      // Load the full column first so deviations are measured against the
      // column's natural magnitude. A derivative component that is
      // legitimately tiny at one sample then cannot blow the relative
      // metric through its own near-zero denominator; cancellation-scale
      // deviations there are still below 1e-4 relative to the column.
      const analyticColumn: number[] = [];
      const numericColumn: number[] = [];
      let columnScale = 1e-6;
      for (const [x, y] of points) {
        const analytic = new Array<number>(nParams).fill(0);
        probe.jacobian(raw, x, y, analytic);
        const h = FINITE_DIFFERENCE_STEP_RELATIVE * Math.max(1, Math.abs(raw[column]));
        const plus = raw.slice();
        const minus = raw.slice();
        plus[column] += h;
        minus[column] -= h;
        const numeric = (probe.value(plus, x, y) - probe.value(minus, x, y)) / (2 * h);
        analyticColumn.push(analytic[column]);
        numericColumn.push(numeric);
        if (Math.abs(analytic[column]) > columnScale) columnScale = Math.abs(analytic[column]);
        if (Math.abs(numeric) > columnScale) columnScale = Math.abs(numeric);
      }
      let maxRelDeviation = 0;
      for (let index = 0; index < points.length; index += 1) {
        const relDeviation = Math.abs(analyticColumn[index] - numericColumn[index]) / columnScale;
        if (relDeviation > maxRelDeviation) maxRelDeviation = relDeviation;
      }
      assert.ok(
        maxRelDeviation < MAX_REL_DEVIATION,
        `${label} column ${column}: max relative deviation ${maxRelDeviation}`,
      );
    }
  };

  // Raw layout of the constant-background 2D Gaussian:
  // [A, B, cx, cy, s1, s2, theta].
  const gaussRaw = [100, 5, 31.3, 32.7, 9, 5, 0.6];
  const sigmaHats: Array<[number, number]> = [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [1.5, 0],
    [2, 0],
    [0, 0.5],
    [0, 1],
    [0, 1.5],
    [0.5, 0.5],
    [1, 1],
    [1.5, 1],
    [1, -0.8],
    [-0.7, 1.3],
  ];
  const gaussCos = Math.cos(0.6);
  const gaussSin = Math.sin(0.6);
  const gaussPoints: Array<[number, number]> = [];
  for (const [uh, vh] of sigmaHats) {
    const u = uh * 9;
    const v = vh * 5;
    gaussPoints.push([31.3 + u * gaussCos - v * gaussSin, 32.7 + u * gaussSin + v * gaussCos]);
  }
  assertJacobian("gauss2dConstantBackground", gaussRaw, gaussPoints);

  // Raw layout of the tilted-background 2D Gaussian:
  // [A, B, bx, by, cx, cy, s1, s2, theta].
  const tiltedRaw = [100, 10.5, 0.05, -0.03, 31.3, 32.7, 9, 5, 0.6];
  assertJacobian("gauss2dTiltedBackground", tiltedRaw, gaussPoints);

  // Raw layout of the Super-Gaussian: [A, B, cx, cy, w1, w2, theta, n].
  // Sample positions sweep the w-scaled principal axes including the
  // intermediate-energy ring where the exponent derivative dg/dn is large.
  const superRaw = [80, 3, 32, 32, 16, 12, 0.4, 2.5];
  const widthHats: Array<[number, number]> = [
    [0, 0],
    [0.5, 0],
    [0.8, 0],
    [1.1, 0],
    [0, 0.5],
    [0, 0.8],
    [0, 1.1],
    [0.5, 0.5],
    [0.85, 0.5],
    [0.3, -0.7],
    [1.2, 0.2],
    [-0.6, 0.9],
  ];
  const superCos = Math.cos(0.4);
  const superSin = Math.sin(0.4);
  const superPoints: Array<[number, number]> = [];
  for (const [uh, vh] of widthHats) {
    const u = uh * 16;
    const v = vh * 12;
    superPoints.push([32 + u * superCos - v * superSin, 32 + u * superSin + v * superCos]);
  }
  assertJacobian("superGauss2d", superRaw, superPoints);

  // Raw layout of the 1D Gaussian: [A, B, c, s]; y is ignored by the probe.
  const gauss1dRaw = [90, 4, 100, 8];
  const gauss1dPoints: Array<[number, number]> = [];
  for (const uh of [0, 0.3, 0.7, 1, 1.5, 2, -0.6, -1.2]) {
    gauss1dPoints.push([100 + uh * 8, 0]);
  }
  assertJacobian("gauss1d", gauss1dRaw, gauss1dPoints);
});

test("S18a noise-free rotated elliptical Gaussian is recovered within 1e-6 by the moment-free start", () => {
  // The beam sits on a 96x96 canvas at the constant background 20. The fit
  // ROI is the central 64x64 window. At the ROI border the Gaussian has
  // decayed to below 1e-7, so the constant-background model's finite-window
  // background/amplitude trade is below the 1e-6 tolerance the contract
  // demands; the interior pixels at x/y == 0 are background-dominated and
  // the (up to 2x) wider sigma2 axis still decays to ~2e-7 by the edge.
  const canvasWidth = 96;
  const canvasHeight = 96;
  const amplitude = 100;
  const background = 20;
  const sigma1 = 9;
  const sigma2 = 5;
  const theta = 0.6;
  const centerX = 31.3;
  const centerY = 32.7;
  const pixels = gaussian2dPixels(
    canvasWidth,
    canvasHeight,
    centerX,
    centerY,
    sigma1,
    sigma2,
    theta,
    amplitude,
    background,
  );
  const result = fitGauss2d(
    { values: pixels, width: canvasWidth, height: canvasHeight },
    { x0: 0, y0: 0, width: 64, height: 64 },
  );

  assert.equal(result.status, "converged");
  assert.equal(result.converged, true);
  assert.ok(result.iterations <= 30, `iterations ${result.iterations}`);
  assert.equal(result.startSource, "half-area");
  assert.equal(result.decimated, false);
  assert.equal(result.decimationFactor, 1);
  const params = result.params as Gauss2dFitParams;
  assert.ok(relativeError(params.amplitudeCounts, amplitude) < 1e-6, `A ${params.amplitudeCounts}`);
  assert.ok(relativeError(params.backgroundCounts, background) < 1e-6, `B ${params.backgroundCounts}`);
  assert.ok(relativeError(params.centerXPx, centerX) < 1e-6, `cx ${params.centerXPx}`);
  assert.ok(relativeError(params.centerYPx, centerY) < 1e-6, `cy ${params.centerYPx}`);
  assert.ok(relativeError(params.sigmaMajorPx, sigma1) < 1e-6, `sigmaMajor ${params.sigmaMajorPx}`);
  assert.ok(relativeError(params.sigmaMinorPx, sigma2) < 1e-6, `sigmaMinor ${params.sigmaMinorPx}`);
  assert.ok(Math.abs(params.thetaRad - theta) < 1e-6, `theta ${params.thetaRad}`);
  assert.ok(params.sigmaMajorPx >= params.sigmaMinorPx);
  assert.ok(params.thetaRad >= 0 && params.thetaRad < Math.PI);
});

test("S18a noisy rotated elliptical Gaussian is recovered within 1 percent", () => {
  const width = 64;
  const height = 64;
  const amplitude = 100;
  const background = 5;
  const sigma1 = 9;
  const sigma2 = 5;
  const theta = 0.6;
  const centerX = 31.3;
  const centerY = 32.7;
  const next = makeLcg(1234);
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigma1, sigma2, theta, amplitude, background);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += unitGaussian(next);

  // The finite-window background trade is a few 0.001 counts here, far
  // below the injected per-pixel noise scale of 1 count.
  const result = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(result.status, "converged");
  const params = result.params as Gauss2dFitParams;
  assert.ok(relativeError(params.amplitudeCounts, amplitude) < 0.01, `A ${params.amplitudeCounts}`);
  assert.ok(relativeError(params.backgroundCounts, background) < 0.01, `B ${params.backgroundCounts}`);
  assert.ok(Math.abs(params.centerXPx - centerX) < 0.01 * centerX, `cx ${params.centerXPx}`);
  assert.ok(Math.abs(params.centerYPx - centerY) < 0.01 * centerY, `cy ${params.centerYPx}`);
  assert.ok(relativeError(params.sigmaMajorPx, sigma1) < 0.01, `sigmaMajor ${params.sigmaMajorPx}`);
  assert.ok(relativeError(params.sigmaMinorPx, sigma2) < 0.01, `sigmaMinor ${params.sigmaMinorPx}`);
  assert.ok(Math.abs(params.thetaRad - theta) < 0.02, `theta ${params.thetaRad}`);
});

test("S18a full-frame ROI converges from the moment-free start on a constant background", () => {
  const width = 96;
  const height = 96;
  const amplitude = 60;
  const background = 20;
  const sigma = 9;
  const centerX = 45.7;
  const centerY = 50.2;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigma, sigma, 0.3, amplitude, background);
  const result = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(result.status, "converged");
  assert.equal(result.startSource, "half-area");
  const params = result.params as Gauss2dFitParams;
  assert.ok(Math.abs(params.centerXPx - centerX) < 0.5, `cx ${params.centerXPx}`);
  assert.ok(Math.abs(params.centerYPx - centerY) < 0.5, `cy ${params.centerYPx}`);
  assert.ok(relativeError(params.sigmaMajorPx, sigma) < 0.05, `sigmaMajor ${params.sigmaMajorPx}`);
});

test("S18a tilted-background Gaussian recovers slopes within 5 percent and sigmas within 1 percent", () => {
  const width = 64;
  const height = 64;
  const amplitude = 100;
  const slopeX = 0.05;
  const slopeY = -0.03;
  const sigma1 = 8;
  const sigma2 = 5;
  const theta = 0.4;
  const centerX = 30;
  const centerY = 31;
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      pixels[x + y * width] =
        10 +
        slopeX * x +
        slopeY * y +
        amplitude * Math.exp(-((u * u) / (2 * sigma1 * sigma1) + (v * v) / (2 * sigma2 * sigma2)));
    }
  }

  const result = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height }, {
    tiltedBackground: true,
  });
  assert.equal(result.status, "converged");
  assert.equal(result.startSource, "half-area");
  const params = result.params as Gauss2dFitParams;
  assert.ok(params.backgroundSlopeXCountsPerPx !== undefined);
  assert.ok(params.backgroundSlopeYCountsPerPx !== undefined);
  assert.ok(
    relativeError(params.backgroundSlopeXCountsPerPx as number, slopeX) < 0.05,
    `bx ${params.backgroundSlopeXCountsPerPx}`,
  );
  assert.ok(
    relativeError(params.backgroundSlopeYCountsPerPx as number, slopeY) < 0.05,
    `by ${params.backgroundSlopeYCountsPerPx}`,
  );
  assert.ok(relativeError(params.sigmaMajorPx, sigma1) < 0.01, `sigmaMajor ${params.sigmaMajorPx}`);
  assert.ok(relativeError(params.sigmaMinorPx, sigma2) < 0.01, `sigmaMinor ${params.sigmaMinorPx}`);
  // The tilted model parametrizes the plane around the fitted centre:
  // B_fit = 10 + bx*cx + by*cy.
  const expectedB = 10 + slopeX * centerX + slopeY * centerY;
  assert.ok(relativeError(params.backgroundCounts, expectedB) < 0.05, `B ${params.backgroundCounts}`);
});

test("S18a super-Gaussian fit recovers n within 5 percent and w within 1 percent", () => {
  // A 64x64 frame keeps the n=3, w=16 wings below 1e-7 at the border, so
  // the constant-background trade cannot pull the exponent down.
  const width = 64;
  const height = 64;
  const amplitude = 80;
  const background = 2;
  const w = 16;
  const n = 3;
  const centerX = 32;
  const centerY = 32;
  const pixels = superGauss2dPixels(width, height, centerX, centerY, w, w, 0.25, n, amplitude, background);
  const result = fitSuperGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(result.status, "converged");
  assert.equal(result.startSource, "half-area");
  const params = result.params!;
  assert.ok(relativeError(params.superGaussN, n) < 0.05, `n ${params.superGaussN}`);
  assert.ok(relativeError(params.w1Px, w) < 0.01, `w1 ${params.w1Px}`);
  assert.ok(relativeError(params.w2Px, w) < 0.01, `w2 ${params.w2Px}`);
  assert.ok(params.superGaussN >= 0.5 && params.superGaussN <= 10);
});

test("S18a super-Gaussian fit on a plain Gaussian lands at n near 1 and w near 2*sigma", () => {
  const width = 64;
  const height = 64;
  const amplitude = 100;
  const background = 3;
  const sigma = 6;
  const centerX = 31.4;
  const centerY = 32.2;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigma, sigma, 0, amplitude, background);
  const result = fitSuperGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(result.status, "converged");
  const params = result.params!;
  assert.ok(Math.abs(params.superGaussN - 1) < 0.1, `n ${params.superGaussN}`);
  assert.ok(relativeError(params.w1Px, 2 * sigma) < 0.02, `w1 ${params.w1Px}`);
  assert.ok(relativeError(params.w2Px, 2 * sigma) < 0.02, `w2 ${params.w2Px}`);
});

test("S18a super-Gaussian model equals the beams radial reference when w1 equals w2", () => {
  const probe = internalModelProbe.superGauss2d;
  const w = 16;
  const n = 2.5;
  const amplitude = 7;
  const background = 1;
  const raw = [amplitude, background, 0, 0, w, w, 0.3, n];
  const points: Array<[number, number]> = [
    [0, 0],
    [3, 4],
    [10, 7],
    [-5, 12],
    [-14, -6],
  ];
  for (const [x, y] of points) {
    const radius = Math.hypot(x, y);
    const expected = background + amplitude * superGaussianRelativeIntensity(radius, w, n);
    const actual = probe.value(raw, x, y);
    // Both paths compute exp(-2*(r/w)^(2n)); the beams reference routes the
    // radius through sqrt and division, so equality holds to floating-point
    // rounding of the final value.
    assert.ok(Math.abs(actual - expected) <= 1e-12, `point ${x},${y}: ${actual} vs ${expected}`);
  }
});

test("S18a super-Gaussian exponent n is clamped to [0.5, 10] and the fit still runs", () => {
  const clamp = internalModelProbe.superGauss2d.clamp!;
  const highRaw = [80, 2, 16, 16, 10, 10, 0.3, 20];
  clamp(highRaw);
  assert.equal(highRaw[7], 10);
  const lowRaw = [80, 2, 16, 16, 10, 10, 0.3, 0.1];
  clamp(lowRaw);
  assert.equal(lowRaw[7], 0.5);

  const width = 48;
  const height = 48;
  const pixels = superGauss2dPixels(width, height, 24, 24, 10, 10, 0.2, 2.5, 70, 2);
  const result = fitSuperGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(result.status, "converged");
  assert.ok(result.params!.superGaussN >= 0.5 && result.params!.superGaussN <= 10);
});

test("S18a fitGauss1d recovers the sigma of an extractCut profile within 1 percent", () => {
  // A 481-px canvas puts the Gaussian tails at ~6e-6 at the cut ends, so
  // the finite-window background trade is below 0.1% of the amplitude and
  // cannot bias the recovered sigma.
  const canvasWidth = 481;
  const height = 9;
  const amplitude = 85;
  const background = 3;
  const sigma = 8;
  const center = 240;
  const pixels = gaussianRowImage(canvasWidth, height, center, sigma, amplitude, background);
  const cut = extractCut({ values: pixels, width: canvasWidth, height }, "x", 240, 4);
  const result = fitGauss1d(cut);
  assert.equal(result.status, "converged");
  assert.equal(result.startSource, "half-area");
  const params = result.params!;
  assert.ok(relativeError(params.sigmaPx, sigma) < 0.01, `sigma ${params.sigmaPx}`);
  assert.ok(Math.abs(params.centerPx - center) < 0.5, `center ${params.centerPx}`);
  assert.ok(relativeError(params.amplitudeCounts, amplitude) < 0.02, `A ${params.amplitudeCounts}`);
  assert.ok(relativeError(params.backgroundCounts, background) < 0.02, `B ${params.backgroundCounts}`);
});

test("S18a a 1024x1024 Gaussian is decimated by 2 and mapped back with the b^2/12 correction", () => {
  const width = 1024;
  const height = 1024;
  const amplitude = 80;
  const background = 6;
  const sigma = 40;
  const centerX = 514.3;
  const centerY = 510.7;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigma, sigma, 0.15, amplitude, background);
  const result = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(result.status, "converged");
  assert.equal(result.decimated, true);
  assert.equal(result.decimationFactor, 2);
  const params = result.params as Gauss2dFitParams;
  assert.ok(Math.abs(params.centerXPx - centerX) < 0.5, `cx ${params.centerXPx}`);
  assert.ok(Math.abs(params.centerYPx - centerY) < 0.5, `cy ${params.centerYPx}`);
  assert.ok(relativeError(params.sigmaMajorPx, sigma) < 0.01, `sigmaMajor ${params.sigmaMajorPx}`);
  assert.ok(relativeError(params.sigmaMinorPx, sigma) < 0.01, `sigmaMinor ${params.sigmaMinorPx}`);
});

test("S18a a 600x300 ROI is pooled by b=2 in both extents when only the width exceeds 512", () => {
  const imageWidth = 640;
  const imageHeight = 340;
  const roi = { x0: 20, y0: 20, width: 600, height: 300 };
  const amplitude = 80;
  const background = 4;
  const sigma = 25;
  const centerX = roi.x0 + roi.width / 2 - 3.2;
  const centerY = roi.y0 + roi.height / 2 + 2.1;
  const pixels = gaussian2dPixels(imageWidth, imageHeight, centerX, centerY, sigma, sigma, 0.35, amplitude, background);
  const result = fitGauss2d({ values: pixels, width: imageWidth, height: imageHeight }, roi);
  assert.equal(result.status, "converged");
  assert.equal(result.decimated, true);
  assert.equal(result.decimationFactor, 2);
  const params = result.params as Gauss2dFitParams;
  assert.ok(Math.abs(params.centerXPx - centerX) < 0.75, `cx ${params.centerXPx}`);
  assert.ok(Math.abs(params.centerYPx - centerY) < 0.75, `cy ${params.centerYPx}`);
  assert.ok(relativeError(params.sigmaMajorPx, sigma) < 0.01, `sigmaMajor ${params.sigmaMajorPx}`);
  assert.ok(relativeError(params.sigmaMinorPx, sigma) < 0.01, `sigmaMinor ${params.sigmaMinorPx}`);
});

test("S18a decimated-fit sigma recovery tightens under the discrete (b^2-1)/12 Sheppard correction (tightening companion)", () => {
  // b=2 decimation forced by a 700x700 ROI (DECIMATION_MAX_EXTENT_PX is
  // 512). sigmaMajor/sigmaMinor are comfortably above 10 so decimation pools
  // many finite pixels per block, and the two axes differ so both corrected
  // sigmas are pinned independently.
  //
  // The discrete Sheppard term (b*b-1)/12 subtracted by mapSigma differs
  // from the superseded CONTINUOUS b*b/12 term by a CONSTANT 1/12 in
  // sigma^2, regardless of b (b*b/12 - (b*b-1)/12 = 1/12 always), because
  // mapSigma runs strictly AFTER the LM converges on the SAME decimated-
  // space fit - so for a fixed underlying fit the superseded formula's
  // recovered sigma is exactly sqrt(new^2 - 1/12).
  //
  // Measured on this exact fixture: NEW recovers sigmaMajorPx/sigmaMinorPx
  // to 1.3e-5 / 6.8e-5 percent relative error (essentially the LM's own
  // convergence floor). The superseded continuous formula would have
  // recovered sqrt(new^2 - 1/12) = 19.99792 / 11.99654, i.e. 0.0104 /
  // 0.0289 percent LOW - about 800x / 400x this test's tolerance, so a
  // regression back to the continuous correction fails this pin while the
  // existing 1-percent decimation oracles above would not have noticed.
  const width = 700;
  const height = 700;
  const amplitude = 90;
  const background = 7;
  const sigmaMajor = 20;
  const sigmaMinor = 12;
  const theta = 0.3;
  const centerX = width / 2 + 4.1;
  const centerY = height / 2 - 3.4;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigmaMajor, sigmaMinor, theta, amplitude, background);
  const result = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(result.status, "converged");
  assert.equal(result.decimated, true);
  assert.equal(result.decimationFactor, 2);
  const params = result.params as Gauss2dFitParams;
  assert.ok(Math.abs(params.centerXPx - centerX) < 1e-6, `cx ${params.centerXPx}`);
  assert.ok(Math.abs(params.centerYPx - centerY) < 1e-6, `cy ${params.centerYPx}`);
  assert.ok(relativeError(params.sigmaMajorPx, sigmaMajor) < 1e-5, `sigmaMajor ${params.sigmaMajorPx}`);
  assert.ok(relativeError(params.sigmaMinorPx, sigmaMinor) < 1e-5, `sigmaMinor ${params.sigmaMinorPx}`);
});

test("S18a honest statuses: max iterations, time budget, and invalid starts", () => {
  const width = 32;
  const height = 32;
  const pixels = gaussian2dPixels(width, height, 16, 16, 6, 4, 0.4, 90, 5);

  const capped = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height }, {
    maxIterations: 1,
  });
  assert.equal(capped.status, "max_iterations");
  assert.equal(capped.converged, false);
  assert.notEqual(capped.params, null);
  assert.equal(capped.iterations, 1);

  // The budget is checked once per iteration after the clock injection
  // starts; two early reads return 0 so iteration 1 runs, then the clock
  // jumps past the budget before iteration 2.
  let clockCalls = 0;
  const jumpingNow = (): number => {
    clockCalls += 1;
    return clockCalls <= 2 ? 0 : 1000;
  };
  const timedOut = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height }, {
    timeBudgetMs: 100,
    now: jumpingNow,
  });
  assert.equal(timedOut.status, "time_budget_exceeded");
  assert.equal(timedOut.converged, false);
  assert.equal(timedOut.iterations, 1);
  assert.notEqual(timedOut.params, null);

  const allNaN = new Float64Array(8 * 8).fill(Number.NaN);
  const nanFit = fitGauss2d({ values: allNaN, width: 8, height: 8 }, { x0: 0, y0: 0, width: 8, height: 8 });
  assert.equal(nanFit.status, "invalid_start");
  assert.equal(nanFit.converged, false);
  assert.equal(nanFit.params, null);
  assert.equal(nanFit.iterations, 0);

  const flat = new Float64Array(8 * 8).fill(5);
  const flatFit = fitGauss2d({ values: flat, width: 8, height: 8 }, { x0: 0, y0: 0, width: 8, height: 8 });
  assert.equal(flatFit.status, "invalid_start");
  assert.equal(flatFit.params, null);
  const zeroFlat = new Float64Array(8 * 8);
  const zeroFit = fitGauss2d({ values: zeroFlat, width: 8, height: 8 }, { x0: 0, y0: 0, width: 8, height: 8 });
  assert.equal(zeroFit.status, "invalid_start");
  assert.equal(zeroFit.params, null);
});

test("S18a scale equivariance: counts scale with the data, geometry is unchanged", () => {
  const width = 48;
  const height = 48;
  const amplitude = 90;
  const background = 7;
  const sigma1 = 8;
  const sigma2 = 4;
  const theta = 0.5;
  const centerX = 24.1;
  const centerY = 23.6;
  const base = gaussian2dPixels(width, height, centerX, centerY, sigma1, sigma2, theta, amplitude, background);
  const scaled = base.map((value) => value * 3.7);

  const baseFit = fitGauss2d({ values: base, width, height }, { x0: 0, y0: 0, width, height });
  const scaledFit = fitGauss2d({ values: scaled, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(baseFit.status, "converged");
  assert.equal(scaledFit.status, "converged");
  const baseParams = baseFit.params as Gauss2dFitParams;
  const scaledParams = scaledFit.params as Gauss2dFitParams;
  assert.ok(
    relativeError(scaledParams.amplitudeCounts, 3.7 * baseParams.amplitudeCounts) < 1e-6,
    `A ${scaledParams.amplitudeCounts} vs ${3.7 * baseParams.amplitudeCounts}`,
  );
  assert.ok(
    relativeError(scaledParams.backgroundCounts, 3.7 * baseParams.backgroundCounts) < 1e-6,
    `B ${scaledParams.backgroundCounts} vs ${3.7 * baseParams.backgroundCounts}`,
  );
  assert.ok(Math.abs(scaledParams.centerXPx - baseParams.centerXPx) < 1e-9, "cx");
  assert.ok(Math.abs(scaledParams.centerYPx - baseParams.centerYPx) < 1e-9, "cy");
  assert.ok(Math.abs(scaledParams.sigmaMajorPx - baseParams.sigmaMajorPx) < 1e-9, "sigmaMajor");
  assert.ok(Math.abs(scaledParams.sigmaMinorPx - baseParams.sigmaMinorPx) < 1e-9, "sigmaMinor");
  assert.ok(Math.abs(scaledParams.thetaRad - baseParams.thetaRad) < 1e-9, "theta");
});

test("S18a a fit landing pre-canonicalization with s1 < s2 still reports major-first theta in [0, pi)", () => {
  const width = 64;
  const height = 64;
  const amplitude = 70;
  const background = 2;
  const sigmaMajor = 7.5;
  const sigmaMinor = 3.2;
  const theta = 1.2;
  const centerX = 32;
  const centerY = 32;
  const pixels = gaussian2dPixels(width, height, centerX, centerY, sigmaMajor, sigmaMinor, theta, amplitude, background);
  const result = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.equal(result.status, "converged");
  const params = result.params as Gauss2dFitParams;
  assert.ok(params.sigmaMajorPx >= params.sigmaMinorPx);
  assert.ok(params.thetaRad >= 0 && params.thetaRad < Math.PI, `theta ${params.thetaRad}`);
  assert.ok(relativeError(params.sigmaMajorPx, sigmaMajor) < 0.02, `sigmaMajor ${params.sigmaMajorPx}`);
  assert.ok(relativeError(params.sigmaMinorPx, sigmaMinor) < 0.02, `sigmaMinor ${params.sigmaMinorPx}`);
  assert.ok(Math.abs(params.thetaRad - theta) < 0.02, `theta ${params.thetaRad}`);
});

test("S18a fits are deterministic and never mutate the input pixel array", () => {
  const width = 40;
  const height = 40;
  const next = makeLcg(77);
  const pixels = gaussian2dPixels(width, height, 20.3, 19.4, 7, 4, -0.6, 80, 4);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.3 * unitGaussian(next);
  const original = pixels.slice();

  const first = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  const second = fitGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.deepStrictEqual(second, first);

  const firstSuper = fitSuperGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  const secondSuper = fitSuperGauss2d({ values: pixels, width, height }, { x0: 0, y0: 0, width, height });
  assert.deepStrictEqual(secondSuper, firstSuper);

  assert.deepStrictEqual(pixels, original);
});

test("S18a a perfect high-amplitude Gaussian still converges (scale-aware wedge floor)", () => {
  const canvasWidth = 96;
  const canvasHeight = 96;
  for (const amplitude of [1000, 65535]) {
    const pixels = gaussian2dPixels(canvasWidth, canvasHeight, 31.3, 32.7, 9, 5, 0.6, amplitude, 20);
    const result = fitGauss2d(
      { values: pixels, width: canvasWidth, height: canvasHeight },
      { x0: 0, y0: 0, width: 64, height: 64 },
    );
    assert.equal(result.status, "converged", `amp ${amplitude}`);
    assert.equal(result.converged, true, `amp ${amplitude}`);
    const params = result.params as Gauss2dFitParams;
    assert.ok(relativeError(params.amplitudeCounts, amplitude) < 1e-6, `A ${params.amplitudeCounts} amp ${amplitude}`);
    assert.ok(relativeError(params.centerXPx, 31.3) < 1e-6, `cx ${params.centerXPx}`);
    assert.ok(relativeError(params.sigmaMajorPx, 9) < 1e-6, `sigmaMajor ${params.sigmaMajorPx}`);
  }
});

test("S18-R2 F3: a large clean ROI stalled at its exact minimum reports converged, not max_iterations", () => {
  // Final-review finding F3. The wedge exit certified stationarity only
  // through the max absolute SCALED gradient against
  // WEDGE_GRADIENT_TOLERANCE * max(1, dataSpan). That gradient is a SUM over
  // the samples, so it grows with sqrt(nSamples) while the limit does not: a
  // large clean ROI sitting EXACTLY at its minimum failed the test and the fit
  // reported max_iterations after ~10 of 30 iterations, which suppressed the
  // whole release chain (fit_not_converged) on a perfect beam.
  //
  // Measured pre-fix on this very sweep: 7 of 20 sub-pixel phases reported
  // max_iterations, every one of them with a sigmaMajor recovery error of
  // 3.5e-11 percent - i.e. exactly right and called unconverged. Across a
  // wider grid (300x80 / 80x300 / 240x120 / 400x100 rotated 11x6 beams at 45
  // and 60 degrees, amplitudes 1000 / 10000 / 20000) it was 18 of 480, worst
  // recovery error among them 9.5e-13 percent. Post-fix: 0 of 480.
  const width = 80;
  const height = 300;
  const sigmaMajor = 11;
  const sigmaMinor = 6;
  const theta = Math.PI / 4;
  const amplitude = 20000;
  const roi = { x0: 0, y0: 0, width, height };
  for (let phaseIndex = 0; phaseIndex < 20; phaseIndex += 1) {
    const phase = phaseIndex / 20;
    const pixels = gaussian2dPixels(
      width,
      height,
      width / 2 + phase,
      height / 2 + phase,
      sigmaMajor,
      sigmaMinor,
      theta,
      amplitude,
      0,
    );
    const result = fitGauss2d({ values: pixels, width, height }, roi);
    assert.equal(result.status, "converged", `phase ${phase}: status ${result.status}`);
    assert.equal(result.converged, true, `phase ${phase}`);
    const params = result.params as Gauss2dFitParams;
    // The status is only honest if the widths really are at the minimum.
    assert.ok(
      relativeError(params.sigmaMajorPx, sigmaMajor) < 1e-9,
      `phase ${phase}: sigmaMajor ${params.sigmaMajorPx}`,
    );
    assert.ok(
      relativeError(params.sigmaMinorPx, sigmaMinor) < 1e-9,
      `phase ${phase}: sigmaMinor ${params.sigmaMinorPx}`,
    );
    // A wedge stop happens well inside the cap; max_iterations must mean the
    // budget was exhausted, and nothing else.
    assert.ok(result.iterations < 30, `phase ${phase}: iterations ${result.iterations}`);
  }
});

test("S18-R2 F3: the iteration cap still reports max_iterations and a genuinely non-converged fit is never called converged", () => {
  // The numerical-floor arm must not weaken the honest cap path: an explicit
  // one-iteration budget is an exhausted budget, not a certified minimum.
  const width = 80;
  const height = 300;
  const pixels = gaussian2dPixels(width, height, 40.5, 150.5, 11, 6, Math.PI / 4, 20000, 0);
  const roi = { x0: 0, y0: 0, width, height };
  for (const maxIterations of [1, 2, 3]) {
    const capped = fitGauss2d({ values: pixels, width, height }, roi, { maxIterations });
    assert.equal(capped.status, "max_iterations", `maxIterations ${maxIterations}`);
    assert.equal(capped.converged, false, `maxIterations ${maxIterations}`);
    assert.equal(capped.iterations, maxIterations, `maxIterations ${maxIterations}`);
  }

  // A ROI holding no beam at all cannot be certified either: the numerical
  // floor is on the RELATIVE cost, so a fit whose residual is a real fraction
  // of the data span never reaches it.
  const noisy = new Array<number>(64 * 64);
  const next = makeLcg(99001);
  for (let i = 0; i < noisy.length; i += 1) noisy[i] = 1000 * unitGaussian(next);
  const noiseOnly = fitGauss2d({ values: noisy, width: 64, height: 64 }, { x0: 0, y0: 0, width: 64, height: 64 });
  if (noiseOnly.status === "converged" && noiseOnly.params !== null) {
    // A converged verdict on pure noise is only acceptable when the engine
    // genuinely reached a stationary point of the cost, never through the
    // numerical-floor arm: the residual there is of the order of the data.
    assert.ok(
      noiseOnly.costFinal > 1e-20 * (64 * 64),
      `pure-noise costFinal ${noiseOnly.costFinal} must stay far above the numerical floor`,
    );
  }
});

test("S20 D2: a wedge reached after a large accepted parameter step is not certified converged", () => {
  // The cost arm of the wedge exit used to certify a minimum from the relative
  // COST improvement of the last accepted step alone. It never asked whether
  // that step had also been SMALL, so a fit still travelling across a flat
  // shelf - a large parameter move that buys a negligible cost gain - could be
  // reported as converged. WEDGE_PARAM_REL_TOLERANCE restores the conjunction
  // the ordinary convergence predicate has always required.
  //
  // The scene below is the constructed witness: a circular Gaussian saturated
  // by a hard clip, which turns the beam core into a flat plateau that no
  // single Gaussian can fit. 22.4 percent of the frame sits on the clip.
  //
  // Measured on this exact scene. The engine reaches the wedge at iteration 29
  // and the cost arm was the ONLY arm that fired: last accepted relative cost
  // improvement 4.578e-13 (comfortably under the 1e-10 cost tolerance), while
  // the last accepted relative PARAMETER step was 1.982e-2 - twenty times the
  // 1e-3 guard, and 190 times the largest step measured on a cost-arm
  // certification anywhere in the adversarial scene sweep (1.04e-4). Neither
  // the gradient arm nor the numerical-floor arm was anywhere near firing.
  //
  // That certification was not harmless. At the wedge point the residual rms
  // is 31.64 counts against a data span of 300.08 - over ten percent of the
  // span still unexplained - and the fitted background lands at -69.6 counts
  // on data whose floor is -0.08. Calling that a converged minimum released a
  // verdict the evidence did not support.
  const size = 128;
  const clipCounts = 300;
  const pixels = gaussian2dPixels(size, size, 63.5, 63.5, 22, 22, 0, 1000, 0);
  const next = makeLcg(4242);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] += 0.2 * unitGaussian(next);
  for (let i = 0; i < pixels.length; i += 1) if (pixels[i] > clipCounts) pixels[i] = clipCounts;

  const result = fitGauss2d({ values: pixels, width: size, height: size }, { x0: 0, y0: 0, width: size, height: size });

  // The guard changes the VERDICT only; the reported numbers at the wedge
  // point are bit-identical to what the unguarded engine reported. Pinning
  // them keeps this oracle honest: it proves the fit still lands on the very
  // wedge the guard was built for, so the non-certification below is the
  // guard speaking and not some unrelated drift in the trajectory.
  assert.notEqual(result.params, null);
  const params = result.params as Gauss2dFitParams;
  assert.ok(
    relativeError(params.sigmaMajorPx, 35.86067578086578) < 1e-9,
    `constructed wedge point moved (sigmaMajor ${params.sigmaMajorPx}); re-measure the case`,
  );
  assert.ok(
    Math.abs(params.backgroundCounts - -69.59110781661418) < 1e-6,
    `constructed wedge point moved (background ${params.backgroundCounts}); re-measure the case`,
  );

  // The load-bearing claim. Before the guard this scene reported converged;
  // after it, the wedge stop is not certified. Which uncertified status it
  // carries is deliberately NOT pinned - an uncertified wedge stop reports
  // singular_normal_equations (S18-R2 F3) and an exhausted budget reports
  // max_iterations, and either is an honest answer here.
  assert.equal(result.converged, false, `status ${result.status}`);
  assert.notEqual(result.status, "converged");

  // ...and the non-certification is honest, not merely mechanical: a real
  // fraction of the data is still unexplained at this point.
  assert.ok(
    (result.residualRmsCounts as number) > 0.1 * clipCounts,
    `residual rms ${result.residualRmsCounts} should be a real fraction of the data span`,
  );
});

test("S20 D2: the 1D and super-Gaussian fits keep their statuses under the wedge parameter guard", () => {
  // R-20. The adversarial status sweep that pins the guard as behaviour-free
  // covers the 2D Gaussian entry point. These are the compact companions for
  // the other two entry points: clean and noisy representatives whose statuses
  // must be exactly what they were before the guard. The oracles above already
  // pin the pre-change accuracy of both fits, so a status check is what is
  // missing here; the widths are re-checked loosely so a status that survived
  // for the wrong reason cannot pass.
  function gaussProfile(
    count: number,
    sigma: number,
    amplitude: number,
    background: number,
    noiseCounts: number,
    seed: number,
  ): { positionsPx: Float64Array; values: Float64Array } {
    const positionsPx = new Float64Array(count);
    const values = new Float64Array(count);
    const next = makeLcg(seed);
    for (let i = 0; i < count; i += 1) {
      const d = i - (count - 1) / 2;
      positionsPx[i] = i;
      values[i] =
        background +
        amplitude * Math.exp(-(d * d) / (2 * sigma * sigma)) +
        (noiseCounts > 0 ? noiseCounts * unitGaussian(next) : 0);
    }
    return { positionsPx, values };
  }

  const oneDCases = [
    { label: "clean narrow", profile: gaussProfile(121, 8, 1000, 5, 0, 0), sigma: 8, tolerance: 1e-6 },
    { label: "clean wide high-amplitude", profile: gaussProfile(241, 20, 65535, 0, 0, 0), sigma: 20, tolerance: 1e-6 },
    { label: "noisy narrow", profile: gaussProfile(121, 8, 1000, 5, 20, 12345), sigma: 8, tolerance: 0.02 },
    { label: "noisy wide low-amplitude", profile: gaussProfile(241, 20, 500, 100, 50, 99001), sigma: 20, tolerance: 0.05 },
  ];
  for (const oneD of oneDCases) {
    const result = fitGauss1d(oneD.profile);
    assert.equal(result.status, "converged", `1D ${oneD.label}: status ${result.status}`);
    const params = result.params!;
    assert.ok(
      relativeError(params.sigmaPx, oneD.sigma) < oneD.tolerance,
      `1D ${oneD.label}: sigma ${params.sigmaPx}`,
    );
  }

  const superSize = 96;
  const superCases = [
    { label: "clean n=1 circular", w1: 18, w2: 18, theta: 0, n: 1, amplitude: 1000, background: 10, noise: 0, seed: 0, tolerance: 1e-5 },
    { label: "clean n=4 rotated flat-top", w1: 20, w2: 12, theta: 0.4, n: 4, amplitude: 20000, background: 0, noise: 0, seed: 0, tolerance: 1e-5 },
    { label: "noisy n=1 circular", w1: 18, w2: 18, theta: 0, n: 1, amplitude: 1000, background: 10, noise: 20, seed: 12345, tolerance: 0.01 },
    { label: "noisy n=4 rotated flat-top", w1: 20, w2: 12, theta: 0.4, n: 4, amplitude: 1000, background: 50, noise: 30, seed: 99001, tolerance: 0.01 },
  ];
  for (const superCase of superCases) {
    const pixels = superGauss2dPixels(
      superSize,
      superSize,
      superSize / 2 - 0.5,
      superSize / 2 - 0.5,
      superCase.w1,
      superCase.w2,
      superCase.theta,
      superCase.n,
      superCase.amplitude,
      superCase.background,
    );
    if (superCase.noise > 0) {
      const next = makeLcg(superCase.seed);
      for (let i = 0; i < pixels.length; i += 1) pixels[i] += superCase.noise * unitGaussian(next);
    }
    const result = fitSuperGauss2d(
      { values: pixels, width: superSize, height: superSize },
      { x0: 0, y0: 0, width: superSize, height: superSize },
    );
    assert.equal(result.status, "converged", `superGauss ${superCase.label}: status ${result.status}`);
    const params = result.params!;
    assert.ok(
      relativeError(params.w1Px, superCase.w1) < superCase.tolerance,
      `superGauss ${superCase.label}: w1 ${params.w1Px}`,
    );
    assert.ok(
      relativeError(params.superGaussN, superCase.n) < superCase.tolerance,
      `superGauss ${superCase.label}: n ${params.superGaussN}`,
    );
  }
});
