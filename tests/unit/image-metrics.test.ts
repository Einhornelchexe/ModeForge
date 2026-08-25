import assert from "node:assert/strict";
import test from "node:test";

import {
  computeEllipticity,
  computePhysicalEllipticity,
  computeRadialDistribution,
  computeSymmetryErrors,
  encircledPowerRadiusPx,
  type RadialDistribution,
} from "../../packages/image/src/metrics.ts";

function gaussianPixels(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  sigma: number,
  amplitude: number,
  background = 0,
): number[] {
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      pixels[x + y * width] =
        background + amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  return pixels;
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

function interpolateEnclosedFraction(dist: RadialDistribution, radiusPx: number): number {
  const { radiiPx, enclosedFraction } = dist;
  if (radiusPx <= 0) return 0;
  if (radiusPx >= radiiPx[radiiPx.length - 1]) return enclosedFraction[enclosedFraction.length - 1];
  if (radiusPx <= radiiPx[0]) return (radiusPx / radiiPx[0]) * enclosedFraction[0];
  for (let i = 1; i < radiiPx.length; i += 1) {
    if (radiusPx <= radiiPx[i]) {
      const r0 = radiiPx[i - 1];
      const r1 = radiiPx[i];
      const f0 = enclosedFraction[i - 1];
      const f1 = enclosedFraction[i];
      return f0 + ((radiusPx - r0) / (r1 - r0)) * (f1 - f0);
    }
  }
  return enclosedFraction[enclosedFraction.length - 1];
}

test("S18a computeEllipticity returns the unitless sigmaMinor/sigmaMajor ratio in [0, 1]", () => {
  assert.equal(computeEllipticity(9, 5), 5 / 9);
  assert.equal(computeEllipticity(5, 5), 1);
  assert.equal(computeEllipticity(5, 0), 0);
  assert.equal(computeEllipticity(0, 5), null);
  assert.equal(computeEllipticity(Number.NaN, 5), null);
  assert.equal(computeEllipticity(Number.POSITIVE_INFINITY, 5), null);
  assert.equal(computeEllipticity(-5, 5), null);
  assert.equal(computeEllipticity(5, Number.NaN), null);
  assert.equal(computeEllipticity(5, -0.1), null);
});

test("S18 review G1: computeEllipticity is pixel-space only; computePhysicalEllipticity on the same sigma pair mapped to um recovers the true physical ratio under an anisotropic pitch", () => {
  // A beam that is perfectly round IN PIXELS (11, 11) reports ellipticity
  // 1.000 - unchanged, pixel semantics never touched by this fix.
  const sigmaPx = 11;
  assert.equal(computeEllipticity(sigmaPx, sigmaPx), 1);

  // A 3:1 anisotropic pixel pitch (3.45 / 1.15 um, matching the review's
  // repro) maps that SAME pixel-round beam to a physically elliptical one:
  // major axis along X (3.45 um/px) is 3x wider in physical units than the
  // (numerically identical, in px) axis along Y (1.15 um/px). The pixel
  // ratio (1.000) is +200 percent off the true physical ratio (1/3).
  const pixelPitchUmX = 3.45;
  const pixelPitchUmY = 1.15;
  const sigmaMajorUm = sigmaPx * pixelPitchUmX;
  const sigmaMinorUm = sigmaPx * pixelPitchUmY;
  const physical = computePhysicalEllipticity(sigmaMajorUm, sigmaMinorUm);
  assert.notEqual(physical, null);
  assert.ok(Math.abs(physical! - 1 / 3) < 1e-12, `physical ellipticity ${physical} vs 1/3`);

  // The pixel-space function is unaffected: same inputs, same 1.000 output
  // (the bug is that CALLERS must not treat this as the physical answer,
  // not that the function itself is wrong for what it actually computes).
  assert.equal(computeEllipticity(sigmaPx, sigmaPx), 1);

  // computePhysicalEllipticity is a straight pass-through of the same
  // validated ratio computation - null/validation behaviour matches
  // computeEllipticity exactly, just documented for the physical (um) pair.
  assert.equal(computePhysicalEllipticity(0, 5), null);
  assert.equal(computePhysicalEllipticity(5, Number.NaN), null);
  assert.equal(computePhysicalEllipticity(-5, 5), null);
  assert.equal(computePhysicalEllipticity(9, 5), 5 / 9);
});

test("S18a radial distribution of a centred Gaussian matches the analytic half-power radius", () => {
  const width = 64;
  const height = 64;
  const centerX = 32;
  const centerY = 32;
  const sigma = 6;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussianPixels(width, height, centerX, centerY, sigma, 1);
  const dist = computeRadialDistribution(
    { values: pixels, width, height },
    roi,
    centerX,
    centerY,
  );
  assert.notEqual(dist, null);
  assert.equal(dist!.enclosedFraction[dist!.enclosedFraction.length - 1], 1);
  for (let i = 1; i < dist!.enclosedFraction.length; i += 1) {
    assert.ok(
      dist!.enclosedFraction[i] >= dist!.enclosedFraction[i - 1],
      `enclosed fraction not monotone at bin ${i}`,
    );
  }
  const halfPowerRadius = sigma * Math.sqrt(2 * Math.log(2));
  const halfPowerFraction = interpolateEnclosedFraction(dist!, halfPowerRadius);
  assert.ok(Math.abs(halfPowerFraction - 0.5) < 0.03, `fraction ${halfPowerFraction}`);
  const r50 = encircledPowerRadiusPx(dist!, 0.5);
  assert.notEqual(r50, null);
  assert.ok(
    Math.abs(r50! - halfPowerRadius) < 0.35,
    `r50 ${r50} vs ${halfPowerRadius}`,
  );
});

test("S18a negative power is reported as negativePowerRatio and never pollutes the enclosed fraction", () => {
  const width = 64;
  const height = 64;
  const centerX = 32;
  const centerY = 32;
  const roi = { x0: 0, y0: 0, width, height };
  const clean = gaussianPixels(width, height, centerX, centerY, 6, 1);
  const cleanDist = computeRadialDistribution(
    { values: clean, width, height },
    roi,
    centerX,
    centerY,
  );
  assert.notEqual(cleanDist, null);

  // -5-count 8x8 block in the far corner, where the Gaussian tail is
  // numerically zero: 64 * 5 = 320 counts of negative power.
  const dirty = clean.slice();
  const blockPower = 320;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 56; x < 64; x += 1) {
      dirty[x + y * width] -= 5;
    }
  }
  const dirtyDist = computeRadialDistribution(
    { values: dirty, width, height },
    roi,
    centerX,
    centerY,
  );
  assert.notEqual(dirtyDist, null);
  assert.ok(
    relativeError(dirtyDist!.totalPositiveCounts, cleanDist!.totalPositiveCounts) < 1e-9,
    `totalPositive ${dirtyDist!.totalPositiveCounts} vs ${cleanDist!.totalPositiveCounts}`,
  );
  const expectedRatio = blockPower / cleanDist!.totalPositiveCounts;
  assert.ok(
    Math.abs(dirtyDist!.negativePowerRatio - expectedRatio) < 1e-9,
    `negativePowerRatio ${dirtyDist!.negativePowerRatio} vs ${expectedRatio}`,
  );
  for (let i = 1; i < dirtyDist!.enclosedFraction.length; i += 1) {
    assert.ok(dirtyDist!.enclosedFraction[i] >= dirtyDist!.enclosedFraction[i - 1]);
  }
  assert.equal(dirtyDist!.enclosedFraction[dirtyDist!.enclosedFraction.length - 1], 1);
});

test("S18a encircledPowerRadiusPx validates its fraction and interpolates inside the first bin", () => {
  const width = 64;
  const height = 64;
  const centerX = 32;
  const centerY = 32;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussianPixels(width, height, centerX, centerY, 6, 1);
  const dist = computeRadialDistribution(
    { values: pixels, width, height },
    roi,
    centerX,
    centerY,
  );
  assert.notEqual(dist, null);

  const r999 = encircledPowerRadiusPx(dist!, 0.999999);
  assert.notEqual(r999, null);
  const rMax = dist!.radiiPx[dist!.radiiPx.length - 1];
  assert.ok(r999! <= rMax, `r999 ${r999} vs rMax ${rMax}`);

  assert.throws(() => encircledPowerRadiusPx(dist!, 0), RangeError);
  assert.throws(() => encircledPowerRadiusPx(dist!, 1), RangeError);
  assert.throws(() => encircledPowerRadiusPx(dist!, Number.NaN), RangeError);
  assert.throws(() => encircledPowerRadiusPx(dist!, -0.1), RangeError);
  assert.throws(() => encircledPowerRadiusPx(dist!, 1.1), RangeError);

  const single = new Array<number>(width * height).fill(0);
  single[32 + 32 * width] = 100;
  const singleDist = computeRadialDistribution(
    { values: single, width, height },
    roi,
    centerX,
    centerY,
  );
  assert.notEqual(singleDist, null);
  const rHalfSingle = encircledPowerRadiusPx(singleDist!, 0.5);
  assert.notEqual(rHalfSingle, null);
  assert.ok(
    rHalfSingle! < singleDist!.radiiPx[0],
    `r ${rHalfSingle} vs first bin edge ${singleDist!.radiiPx[0]}`,
  );
});

// Independent pixel-sorted ground truth for a first-bin crossing: gather
// every ROI pixel with a positive value, compute its centre-to-centre
// radius, sort by radius (Array.prototype.sort is stable, matching
// computeRadialDistribution's own row-major tie-break), accumulate power,
// and linearly interpolate the crossing radius between the two bracketing
// PIXEL radii. This is a from-scratch reimplementation (never calls into
// metrics.ts) used purely as an oracle for the S18 first-bin fix.
function pixelSortedRadius(
  pixels: number[],
  width: number,
  roi: { x0: number; y0: number; width: number; height: number },
  centerX: number,
  centerY: number,
  fraction: number,
): number | null {
  const samples: Array<{ r: number; value: number }> = [];
  let total = 0;
  for (let y = roi.y0; y < roi.y0 + roi.height; y += 1) {
    for (let x = roi.x0; x < roi.x0 + roi.width; x += 1) {
      const value = pixels[x + y * width];
      if (value > 0) {
        const dx = x - centerX;
        const dy = y - centerY;
        samples.push({ r: Math.sqrt(dx * dx + dy * dy), value });
        total += value;
      }
    }
  }
  samples.sort((a, b) => a.r - b.r);
  const target = fraction * total;
  let accumulated = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const next = accumulated + samples[i].value;
    if (next >= target) {
      const upper = samples[i].r;
      const lower = i > 0 ? samples[i - 1].r : 0;
      const span = next - accumulated;
      const t = span > 0 ? (target - accumulated) / span : 0;
      return lower + t * (upper - lower);
    }
    accumulated = next;
  }
  return null;
}

test("S18a encircledPowerRadiusPx resolves a first-bin crossing exactly against an independent pixel-sorted ground truth (sigma 2 px, tight beam)", () => {
  // On a 161x161 full-frame ROI the DEFAULT 64-bin partition puts bin 0's
  // outer edge at only rMax/64 ~= 1.77 px (rMax is the corner distance
  // ~113.14 px) - short of the ~2.24 px pixel-sorted 50-percent radius of a
  // sigma-2 beam, so the crossing falls in bin 1 and never exercises the
  // fixed first-bin path (measured: that config gives r50 = 2.507 px, the
  // OLD uniform-growth-from-r=0 value, 12.1 percent off the pixel-sorted
  // truth - unaffected by this fix since the crossing is not in bin 0).
  // binCount is narrowed to 32 (bin0 outer edge 3.54 px) so bin 0
  // genuinely captures more than half the beam's power (measured
  // enclosedFraction[0] 0.7725, comfortably above the 0.5 target, over 37
  // bin-0 pixel samples) and the fix's exact-interpolation branch actually
  // runs.
  const width = 161;
  const height = 161;
  const centerX = 80;
  const centerY = 80;
  const sigma = 2;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussianPixels(width, height, centerX, centerY, sigma, 1);
  const dist = computeRadialDistribution({ values: pixels, width, height }, roi, centerX, centerY, {
    binCount: 32,
  });
  assert.notEqual(dist, null);
  assert.ok(
    dist!.enclosedFraction[0] > 0.5,
    `enclosedFraction[0] ${dist!.enclosedFraction[0]} must exceed the 0.5 target so this actually exercises the first-bin path`,
  );
  assert.ok(
    dist!.firstBinRadiiPx!.length > 1,
    "expected multiple bin-0 pixel samples, not a degenerate single point",
  );

  const r50 = encircledPowerRadiusPx(dist!, 0.5);
  assert.notEqual(r50, null);

  // Primary oracle: an independently computed pixel-sorted ground truth.
  // When the crossing falls inside bin 0 the fix makes this an EXACT
  // computation (sort bin-0 pixels by radius, accumulate to the target
  // fraction of total power, interpolate between the two bracketing pixel
  // radii) - measured bit-identical (relative difference 0) against this
  // from-scratch reimplementation.
  const groundTruth = pixelSortedRadius(pixels, width, roi, centerX, centerY, 0.5);
  assert.notEqual(groundTruth, null);
  assert.ok(
    relativeError(r50!, groundTruth!) < 1e-9,
    `r50 ${r50} vs pixel-sorted ground truth ${groundTruth}`,
  );

  // Secondary, honest sanity pin against the CONTINUOUS analytic half-power
  // radius sigma*sqrt(2*ln2): measured 5.04 percent low even with the exact
  // fix, because a sigma-2 beam is only a few pixels wide and the discrete
  // pixel-centre grid itself does not equal the continuous formula - this is
  // genuine pixelation, not the bug the fix addresses. The bug made the OLD
  // uniform-growth-from-r=0 interpolation land at 2.507 px, 12.1 percent off
  // the pixel-sorted truth of 2.236 px; the fix eliminates exactly that
  // 12.1 percent gap, not the smaller continuum-vs-pixel-grid gap, so the
  // tolerance here is widened past 3 percent to stay honest about what
  // remains.
  const analytic = sigma * Math.sqrt(2 * Math.log(2));
  assert.ok(relativeError(r50!, analytic) < 0.06, `r50 ${r50} vs analytic ${analytic}`);
});

test("S18a encircledPowerRadiusPx regression pin: a resolved sigma-10 Gaussian keeps its 0.5 radius within 1 percent of the analytic half-power radius", () => {
  const width = 161;
  const height = 161;
  const centerX = 80;
  const centerY = 80;
  const sigma = 10;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussianPixels(width, height, centerX, centerY, sigma, 1);
  const dist = computeRadialDistribution({ values: pixels, width, height }, roi, centerX, centerY);
  assert.notEqual(dist, null);
  // At sigma 10 the default 64-bin partition's bin 0 (outer edge ~1.77 px)
  // is far short of the ~11.77 px crossing, so this exercises the ordinary
  // (unchanged) between-bin interpolation - a general accuracy regression
  // pin for a comfortably resolved beam, not the first-bin fix itself.
  assert.ok(dist!.enclosedFraction[0] < 0.5);

  const r50 = encircledPowerRadiusPx(dist!, 0.5);
  assert.notEqual(r50, null);
  // Measured 0.2545 percent low; pinned at 1 percent for margin.
  const analytic = sigma * Math.sqrt(2 * Math.log(2));
  assert.ok(relativeError(r50!, analytic) < 0.01, `r50 ${r50} vs analytic ${analytic}`);
});

test("S18a symmetry errors are small for a centred Gaussian and reflect a dimmed half-plane", () => {
  const width = 64;
  const height = 64;
  const centerX = 32;
  const centerY = 32;
  const roi = { x0: 0, y0: 0, width, height };
  const symmetric = gaussianPixels(width, height, centerX, centerY, 6, 1);
  const symErrors = computeSymmetryErrors(
    { values: symmetric, width, height },
    roi,
    centerX,
    centerY,
  );
  assert.ok(symErrors.rotationAsymmetry !== null);
  assert.ok(symErrors.rotationAsymmetry! < 0.02, `rotation ${symErrors.rotationAsymmetry}`);
  assert.ok(symErrors.axialAsymmetryX !== null);
  assert.ok(symErrors.axialAsymmetryX! < 0.02, `axialX ${symErrors.axialAsymmetryX}`);
  assert.ok(symErrors.axialAsymmetryY !== null);
  assert.ok(symErrors.axialAsymmetryY! < 0.02, `axialY ${symErrors.axialAsymmetryY}`);
  assert.ok(symErrors.comparedPixelCount > 0);

  const asymmetric = symmetric.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > centerX) asymmetric[x + y * width] *= 0.5;
    }
  }
  const asymErrors = computeSymmetryErrors(
    { values: asymmetric, width, height },
    roi,
    centerX,
    centerY,
  );
  assert.ok(asymErrors.axialAsymmetryX !== null);
  assert.ok(
    asymErrors.axialAsymmetryX! >= 0.2 && asymErrors.axialAsymmetryX! <= 0.45,
    `axialX ${asymErrors.axialAsymmetryX}`,
  );
  assert.ok(asymErrors.axialAsymmetryY !== null);
  assert.ok(asymErrors.axialAsymmetryY! < 0.02, `axialY ${asymErrors.axialAsymmetryY}`);
  assert.ok(asymErrors.rotationAsymmetry !== null);
  assert.ok(
    asymErrors.rotationAsymmetry! > 5 * symErrors.rotationAsymmetry!,
    `rotation ${asymErrors.rotationAsymmetry} vs symmetric ${symErrors.rotationAsymmetry}`,
  );
});

test("S18 review G2: axial asymmetry no longer fabricates on a symmetric beam at integer-phase centres, and stays stable on a genuinely asymmetric beam across phase", () => {
  // Confirmed defect: the OLD axial split excluded pixels exactly ON the
  // axis from BOTH sides. Since the centroid is essentially never exactly
  // integer, no pixel ever landed exactly on the axis - instead the single
  // column/row nearest the axis flipped entirely to one side, fabricating
  // asymmetry on a PERFECTLY symmetric beam whenever the centre sits at an
  // integer-phase pixel coordinate (measured: axialAsymmetryX =
  // 1/(sigmaProj*sqrt(2*pi)), e.g. ~0.310 at sigma 1.5, ~0.042 at sigma 11).
  // The fix (axis band: a pixel within 0.5 px of the axis splits its power
  // half/half) is verified here at BOTH integer phase (the worst case for
  // the old bug) and half-pixel phase (where the old bug happened to
  // self-cancel already).
  for (const sigma of [1.5, 11]) {
    const gridSize = sigma < 5 ? 41 : 161;
    const roi = { x0: 0, y0: 0, width: gridSize, height: gridSize };
    const centreInt = (gridSize - 1) / 2;
    for (const phase of [0, 0.5]) {
      const cx = Math.floor(centreInt) + phase;
      const cy = Math.floor(centreInt) + phase;
      const pixels = gaussianPixels(gridSize, gridSize, cx, cy, sigma, 100);
      const errs = computeSymmetryErrors({ values: pixels, width: gridSize, height: gridSize }, roi, cx, cy);
      assert.notEqual(errs.axialAsymmetryX, null);
      assert.notEqual(errs.axialAsymmetryY, null);
      assert.ok(
        Math.abs(errs.axialAsymmetryX!) < 1e-3,
        `sigma ${sigma} phase ${phase}: axialAsymmetryX ${errs.axialAsymmetryX} must be < 1e-3`,
      );
      assert.ok(
        Math.abs(errs.axialAsymmetryY!) < 1e-3,
        `sigma ${sigma} phase ${phase}: axialAsymmetryY ${errs.axialAsymmetryY} must be < 1e-3`,
      );
    }
  }

  // Genuinely asymmetric beam: two half-planes (1000 left of centre, 500
  // right of centre) on a 64x64 canvas. The measured asymmetry stays STABLE
  // (moves less than 20 percent relative) between integer phase (centre
  // 32.0) and half-pixel phase (centre 32.5) - i.e. the fix reports a real,
  // reproducible signal rather than a phase-dependent artefact. Measured:
  // phase 0 -> 0.34375, phase 0.5 -> 0.36082, relative move ~4.97 percent.
  function twoHalfPlanes(size: number, centre: number, leftAmplitude: number, rightAmplitude: number): number[] {
    const pixels = new Array<number>(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        pixels[x + y * size] = x < centre ? leftAmplitude : rightAmplitude;
      }
    }
    return pixels;
  }
  const size = 64;
  const roiHalf = { x0: 0, y0: 0, width: size, height: size };
  const phase0 = computeSymmetryErrors(
    { values: twoHalfPlanes(size, 32, 1000, 500), width: size, height: size },
    roiHalf,
    32,
    32,
  );
  const phase5 = computeSymmetryErrors(
    { values: twoHalfPlanes(size, 32.5, 1000, 500), width: size, height: size },
    roiHalf,
    32.5,
    32,
  );
  assert.notEqual(phase0.axialAsymmetryX, null);
  assert.notEqual(phase5.axialAsymmetryX, null);
  // Both readings must be a real, substantial signal (not accidentally
  // washed out), and the relative move between phases must stay under the
  // 20 percent ceiling the review calibrated for a stable, phase-continuous
  // reading of a genuine asymmetry.
  assert.ok(phase0.axialAsymmetryX! > 0.2, `phase0 axialAsymmetryX ${phase0.axialAsymmetryX}`);
  assert.ok(phase5.axialAsymmetryX! > 0.2, `phase5 axialAsymmetryX ${phase5.axialAsymmetryX}`);
  const relativeMove = Math.abs(phase0.axialAsymmetryX! - phase5.axialAsymmetryX!) / Math.abs(phase0.axialAsymmetryX!);
  assert.ok(relativeMove < 0.2, `relative move ${relativeMove} must be < 0.2`);
});

test("S18a symmetry with the centre off the ROI reports no rotation pairs", () => {
  const width = 64;
  const height = 64;
  const roi = { x0: 0, y0: 0, width: 16, height: 16 };
  const values = new Array<number>(width * height).fill(0);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      values[x + y * width] = 10;
    }
  }
  const errors = computeSymmetryErrors({ values, width, height }, roi, 40, 40);
  assert.equal(errors.comparedPixelCount, 0);
  assert.equal(errors.rotationAsymmetry, null);
});

test("S18a metric inputs are validated and the computations are deterministic and never mutate", () => {
  const width = 32;
  const height = 32;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussianPixels(width, height, 16, 16, 5, 1);
  const image = { values: pixels, width, height };

  assert.throws(() => computeRadialDistribution(image, { x0: -1, y0: 0, width, height }, 16, 16), RangeError);
  assert.throws(() => computeRadialDistribution(image, { x0: 0, y0: 0, width: 33, height }, 16, 16), RangeError);
  assert.throws(() => computeRadialDistribution(image, roi, Number.NaN, 16), RangeError);
  assert.throws(() => computeRadialDistribution(image, roi, 16, Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => computeRadialDistribution(image, roi, 16, 16, { binCount: 0 }), RangeError);
  assert.throws(() => computeRadialDistribution(image, roi, 16, 16, { binCount: -3 }), RangeError);
  assert.throws(() => computeRadialDistribution(image, roi, 16, 16, { binCount: 2.5 }), RangeError);

  assert.throws(() => computeSymmetryErrors(image, { x0: -1, y0: 0, width, height }, 16, 16), RangeError);
  assert.throws(() => computeSymmetryErrors(image, roi, Number.NaN, 16), RangeError);
  assert.throws(() => computeSymmetryErrors(image, roi, 16, Number.NEGATIVE_INFINITY), RangeError);

  const original = pixels.slice();
  const first = computeRadialDistribution(image, roi, 16, 16);
  const second = computeRadialDistribution(image, roi, 16, 16);
  assert.deepStrictEqual(second, first);
  assert.deepStrictEqual(pixels, original);

  const firstSym = computeSymmetryErrors(image, roi, 16, 16);
  const secondSym = computeSymmetryErrors(image, roi, 16, 16);
  assert.deepStrictEqual(secondSym, firstSym);
  assert.deepStrictEqual(pixels, original);
});

test("S18b encircledPowerRadiusPx resolves a fraction equal to enclosedFraction[0] exactly to the last first-bin sample radius", () => {
  // The confirmed LOW defect: IEEE arithmetic makes
  // enclosedFraction[0] * totalPositiveCounts come out one ulp ABOVE the
  // exact sum of the firstBinPower samples, so the cumulative walk with that
  // target never reaches it and the function fell through to the legacy
  // uniform interpolation, returning the bin OUTER EDGE (measured 3.536 px
  // for this beam vs the pixel-sorted ground truth 3.162 px - 11.8 percent
  // high). The fix clamps the walk target to the exact bin-0 sample-power
  // sum, so an exact-boundary fraction resolves to the LAST first-bin sample
  // radius.
  const width = 161;
  const height = 161;
  const centerX = 80;
  const centerY = 80;
  const sigma = 2;
  const roi = { x0: 0, y0: 0, width, height };
  const pixels = gaussianPixels(width, height, centerX, centerY, sigma, 1);
  const dist = computeRadialDistribution({ values: pixels, width, height }, roi, centerX, centerY, {
    binCount: 32,
  });
  assert.notEqual(dist, null);
  const boundaryFraction = dist!.enclosedFraction[0];
  assert.ok(boundaryFraction > 0.5, `enclosedFraction[0] ${boundaryFraction}`);
  assert.ok(
    dist!.firstBinRadiiPx!.length > 1,
    "expected multiple bin-0 pixel samples, not a degenerate single point",
  );

  const boundaryRadius = encircledPowerRadiusPx(dist!, boundaryFraction);
  assert.notEqual(boundaryRadius, null);
  const lastSampleRadius = dist!.firstBinRadiiPx![dist!.firstBinRadiiPx!.length - 1];
  assert.equal(boundaryRadius, lastSampleRadius);
  assert.ok(
    boundaryRadius! < dist!.radiiPx[0],
    `boundary radius ${boundaryRadius} must stay strictly inside the bin outer edge ${dist!.radiiPx[0]}`,
  );
});
