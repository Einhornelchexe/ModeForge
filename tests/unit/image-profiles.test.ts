import assert from "node:assert/strict";
import test from "node:test";

import {
  computeProjection,
  extractAxisProfile,
  extractCut,
  measureProfileWidths,
  type LineProfile,
} from "../../packages/image/src/profiles.ts";

// Small deterministic LCG for oracle fixtures; same sequence on every run.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function gaussianImage(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  sigma: number,
  amplitude: number,
): number[] {
  const pixels = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      pixels[x + y * width] = amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  return pixels;
}

function gaussianLine(length: number, center: number, sigma: number, amplitude: number): number[] {
  const values = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    const dx = index - center;
    values[index] = amplitude * Math.exp(-(dx * dx) / (2 * sigma * sigma));
  }
  return values;
}

function makeProfile(values: number[]): LineProfile {
  return {
    kind: "cut-x",
    positionsPx: Float64Array.from({ length: values.length }, (_, index) => index),
    values: Float64Array.from(values),
    originXPx: 0,
    originYPx: 0,
  };
}

test("S18a data widths on a Gaussian row cut match FWHM and 1/e^2 within 1%", () => {
  const width = 201;
  const height = 31;
  const sigma = 8;
  const amplitude = 100;
  const center = 100;
  const pixels = gaussianImage(width, height, center, 15, sigma, amplitude);
  const profile = extractCut({ values: pixels, width, height }, "x", 100, 15);
  const measurement = measureProfileWidths(profile, 1);

  assert.equal(measurement.peakValueCounts, amplitude);
  assert.equal(measurement.peakPositionPx, center);
  assert.equal(measurement.fwhmData.suppressedReason, null);
  assert.equal(measurement.oneOverESquaredData.suppressedReason, null);
  assert.equal(measurement.fwhmData.ambiguous, false);
  assert.equal(measurement.oneOverESquaredData.ambiguous, false);

  const fwhmExpected = 2 * Math.sqrt(2 * Math.LN2) * sigma; // 18.8387...
  const e2Expected = 4 * sigma;
  assert.ok(
    Math.abs(measurement.fwhmData.widthPx! - fwhmExpected) / fwhmExpected < 0.01,
    `fwhm ${measurement.fwhmData.widthPx} vs ${fwhmExpected}`,
  );
  assert.ok(
    Math.abs(measurement.oneOverESquaredData.widthPx! - e2Expected) / e2Expected < 0.01,
    `1/e^2 ${measurement.oneOverESquaredData.widthPx} vs ${e2Expected}`,
  );
});

test("S18a bilinear cuts and 45 degree axis samples are exact on a linear field", () => {
  const width = 17;
  const height = 9;
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels.push(2 + 0.5 * x + 0.25 * y);
  }

  const cut = extractCut({ values: pixels, width, height }, "x", 8, 3.5);
  assert.equal(cut.kind, "cut-x");
  assert.equal(cut.values.length, width);
  assert.equal(cut.stepUm, undefined);
  for (let x = 0; x < width; x += 1) {
    const expected = 2 + 0.5 * x + 0.25 * 3.5;
    assert.ok(Math.abs(cut.values[x] - expected) <= 1e-12, `x ${x}: ${cut.values[x]} vs ${expected}`);
  }

  // Axis profile at 45 degrees: bilinear interpolation of a linear field is
  // exact at every sampled offset.
  const cos45 = Math.cos(Math.PI / 4);
  const sin45 = Math.sin(Math.PI / 4);
  const axis = extractAxisProfile({ values: pixels, width, height }, 8, 4, Math.PI / 4);
  assert.equal(axis.kind, "axis");
  assert.equal(axis.angleRad, Math.PI / 4);
  assert.ok(axis.positionsPx.length >= 3);
  for (let i = 0; i < axis.values.length; i += 1) {
    const t = axis.positionsPx[i];
    const x = 8 + t * cos45;
    const y = 4 + t * sin45;
    const expected = 2 + 0.5 * x + 0.25 * y;
    assert.ok(Math.abs(axis.values[i] - expected) <= 1e-12, `t ${t}: ${axis.values[i]} vs ${expected}`);
  }
  const centerIndex = axis.positionsPx.findIndex((position) => position === 0);
  assert.ok(centerIndex >= 0);
  assert.equal(axis.values[centerIndex], 2 + 0.5 * 8 + 0.25 * 4);
});

test("S18a the 3-sigma signal guard suppresses a weak peak and sigma 0 never suppresses a positive peak", () => {
  const above = measureProfileWidths(makeProfile(gaussianLine(101, 50, 8, 30.1)), 10);
  assert.ok(above.fwhmData.widthPx !== null);
  assert.equal(above.fwhmData.suppressedReason, null);
  assert.ok(above.oneOverESquaredData.widthPx !== null);

  const below = measureProfileWidths(makeProfile(gaussianLine(101, 50, 8, 29.9)), 10);
  assert.equal(below.fwhmData.widthPx, null);
  assert.equal(below.fwhmData.suppressedReason, "low-signal");
  assert.equal(below.oneOverESquaredData.widthPx, null);
  assert.equal(below.oneOverESquaredData.suppressedReason, "low-signal");

  const zeroSigma = measureProfileWidths(makeProfile(gaussianLine(101, 50, 8, 30.1)), 0);
  assert.ok(zeroSigma.fwhmData.widthPx !== null);
  assert.equal(zeroSigma.fwhmData.suppressedReason, null);

  const negative = measureProfileWidths(makeProfile([-1, -2, -3]), 10);
  assert.equal(negative.peakValueCounts, -1);
  assert.equal(negative.peakPositionPx, 0);
  assert.equal(negative.fwhmData.widthPx, null);
  assert.equal(negative.fwhmData.suppressedReason, "nonpositive-peak");

  const nanProfile = measureProfileWidths(makeProfile([Number.NaN, Number.NaN, Number.NaN]), 10);
  assert.ok(Number.isNaN(nanProfile.peakValueCounts));
  assert.ok(Number.isNaN(nanProfile.peakPositionPx));
  assert.equal(nanProfile.fwhmData.widthPx, null);
  assert.equal(nanProfile.fwhmData.suppressedReason, "nonpositive-peak");
});

test("S18a two-lobe profiles are flagged ambiguous while clean single lobes are not", () => {
  const twoLobe: number[] = [];
  for (let index = 0; index < 101; index += 1) {
    const first = 100 * Math.exp(-((index - 30) * (index - 30)) / (2 * 6 * 6));
    const second = 95 * Math.exp(-((index - 70) * (index - 70)) / (2 * 6 * 6));
    twoLobe.push(first + second);
  }
  const twoLobeMeasurement = measureProfileWidths(makeProfile(twoLobe), 1);
  assert.equal(twoLobeMeasurement.peakValueCounts, 100 + 95 * Math.exp(-(40 * 40) / 72));
  assert.equal(twoLobeMeasurement.peakPositionPx, 30);
  assert.ok(twoLobeMeasurement.fwhmData.widthPx !== null);
  assert.equal(twoLobeMeasurement.fwhmData.ambiguous, true);
  assert.equal(twoLobeMeasurement.oneOverESquaredData.ambiguous, true);
  const fwhmExpected = 2 * Math.sqrt(2 * Math.LN2) * 6; // 14.1519...
  assert.ok(
    Math.abs(twoLobeMeasurement.fwhmData.widthPx! - fwhmExpected) / fwhmExpected < 0.02,
    `fwhm ${twoLobeMeasurement.fwhmData.widthPx} vs ${fwhmExpected}`,
  );

  const clean = measureProfileWidths(makeProfile(gaussianLine(101, 50, 8, 100)), 1);
  assert.equal(clean.fwhmData.ambiguous, false);
  assert.equal(clean.oneOverESquaredData.ambiguous, false);
});

test("S18a profile gaps and truncation suppress the width as gap instead of inventing a crossing", () => {
  const width = 201;
  const height = 31;
  const pixels = gaussianImage(width, height, 100, 15, 8, 100);
  // Destroy the whole right half-crossing region with NaNs.
  for (let x = 102; x < 111; x += 1) pixels[x + 15 * width] = Number.NaN;
  const cut = extractCut({ values: pixels, width, height }, "x", 100, 15);
  const measurement = measureProfileWidths(cut, 1);
  assert.equal(measurement.fwhmData.widthPx, null);
  assert.equal(measurement.fwhmData.suppressedReason, "gap");
  assert.equal(measurement.oneOverESquaredData.widthPx, null);
  assert.equal(measurement.oneOverESquaredData.suppressedReason, "gap");
  assert.equal(measurement.fwhmData.leftCrossingPx, null);
  assert.equal(measurement.fwhmData.rightCrossingPx, null);

  // Truncated profile: peak on the last sample, the right side never drops
  // below the threshold, so the right crossing is unobserved.
  const truncatedValues: number[] = [];
  for (let index = 0; index < 16; index += 1) truncatedValues.push(index < 15 ? index * 5 : 100);
  const truncated = measureProfileWidths(makeProfile(truncatedValues), 1);
  assert.equal(truncated.fwhmData.widthPx, null);
  assert.equal(truncated.fwhmData.suppressedReason, "gap");
  assert.equal(truncated.oneOverESquaredData.widthPx, null);
  assert.equal(truncated.oneOverESquaredData.suppressedReason, "gap");
});

test("S18a projections sum only finite pixels and carry exact contributing counts", () => {
  const values = [
    1, 2, Number.NaN,
    3, Number.POSITIVE_INFINITY, Number.NaN,
    Number.NaN, 5, Number.NaN,
    7, 8, Number.NaN,
  ];
  const width = 3;
  const height = 4;
  const projectionX = computeProjection({ values, width, height }, "x", {
    pixelPitchUmX: 2,
    pixelPitchUmY: 3,
  });
  assert.equal(projectionX.kind, "projection-x");
  assert.equal(projectionX.stepUm, 2);
  assert.equal(projectionX.values[0], 11);
  assert.equal(projectionX.values[1], 15);
  assert.ok(Number.isNaN(projectionX.values[2]));
  assert.deepStrictEqual(Array.from(projectionX.contributingCounts!), [3, 3, 0]);
  assert.deepStrictEqual(Array.from(projectionX.positionsPx), [0, 1, 2]);

  const projectionY = computeProjection({ values, width, height }, "y", {
    pixelPitchUmX: 2,
    pixelPitchUmY: 3,
  });
  assert.equal(projectionY.kind, "projection-y");
  assert.equal(projectionY.stepUm, 3);
  assert.deepStrictEqual(Array.from(projectionY.values), [3, 3, 5, 15]);
  assert.deepStrictEqual(Array.from(projectionY.contributingCounts!), [2, 1, 1, 2]);
  assert.deepStrictEqual(Array.from(projectionY.positionsPx), [0, 1, 2, 3]);
});

test("S18a a 45 degree axis profile peaks at the centre and uses the anisotropy-exact step length", () => {
  const width = 64;
  const height = 64;
  const centerX = 31;
  const centerY = 31;
  // Strictly peaked diagonal ridge: the field is a quadratic along the
  // 45-degree coordinate. The axis extractor samples the exact centre
  // (t = 0), and bilinear interpolation reproduces a line-cut of a
  // coordinate-aligned quadratic exactly. An integer pixel centre keeps the
  // sampled peak (and the mirror-symmetric cell phases on both sides of
  // t = 0) exact under floating-point jitter.
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x - centerX + (y - centerY)) / Math.sqrt(2);
      pixels.push(100 - (u * u) / 18);
    }
  }
  const angleRad = Math.PI / 4;

  // Reference: a flat field must produce value 1 at every in-bounds offset
  // (bilinear weights sum to one on any grid).
  const flat = new Array<number>(width * height).fill(1);
  const flatAxis = extractAxisProfile({ values: flat, width, height }, centerX, centerY, angleRad);
  for (const value of flatAxis.values) {
    assert.ok(Math.abs(value - 1) <= 1e-12, `flat sample ${value}`);
  }

  const axis = extractAxisProfile(
    { values: pixels, width, height },
    centerX,
    centerY,
    angleRad,
    { pixelPitchUmX: 2, pixelPitchUmY: 1 },
  );
  assert.equal(axis.kind, "axis");
  assert.equal(axis.angleRad, angleRad);
  assert.ok(axis.positionsPx[0] < 0, `first position ${axis.positionsPx[0]}`);
  assert.ok(axis.positionsPx[axis.positionsPx.length - 1] > 0);
  for (let i = 1; i < axis.positionsPx.length; i += 1) {
    assert.ok(axis.positionsPx[i] > axis.positionsPx[i - 1], "positions must be strictly ascending");
  }
  const measurement = measureProfileWidths(axis, 0);
  assert.ok(measurement.peakValueCounts > 99, `peak ${measurement.peakValueCounts}`);
  assert.ok(Math.abs(measurement.peakPositionPx) <= 0.75, `peak position ${measurement.peakPositionPx}`);

  const cos45 = Math.cos(angleRad);
  const sin45 = Math.sin(angleRad);
  const expectedStepUm = Math.sqrt((cos45 * 2) * (cos45 * 2) + (sin45 * 1) * (sin45 * 1));
  assert.equal(axis.stepUm, expectedStepUm);
});

test("S18a profile extraction validates geometry and the width measurement validates sigma", () => {
  const image = { values: new Array<number>(16).fill(1), width: 4, height: 4 };
  assert.throws(() => extractCut(image, "x", 4, 0), RangeError);
  assert.throws(() => extractCut(image, "x", 0, 4), RangeError);
  assert.throws(() => extractCut(image, "x", 0, -0.1), RangeError);
  assert.throws(() => extractCut(image, "x", Number.NaN, 0), RangeError);
  assert.throws(() => extractAxisProfile(image, 4, 0, 0.2), RangeError);
  assert.throws(() => extractAxisProfile(image, 0, 4, 0.2), RangeError);
  assert.throws(() => extractAxisProfile(image, 1, 1, Number.NaN), RangeError);
  assert.throws(() => extractAxisProfile(image, 1, 1, Number.POSITIVE_INFINITY), RangeError);
  assert.throws(
    () => extractCut({ values: new Array<number>(5).fill(1), width: 4, height: 4 }, "x", 0, 0),
    RangeError,
  );

  const profile = extractCut(image, "x", 1, 1);
  assert.throws(() => measureProfileWidths(profile, -1), RangeError);
  assert.throws(() => measureProfileWidths(profile, Number.NaN), RangeError);
  assert.throws(() => measureProfileWidths(profile, Number.POSITIVE_INFINITY), RangeError);
});

test("S18a profile extraction is deterministic and never mutates its input", () => {
  const width = 41;
  const height = 41;
  const next = makeLcg(99);
  const pixels = gaussianImage(width, height, 20.4, 19.8, 6, 90);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] += 0.4 * (next() - 0.5);
  const original = pixels.slice();
  const image = { values: pixels, width, height };
  const calibration = { pixelPitchUmX: 2, pixelPitchUmY: 1 };

  const cutA = extractCut(image, "x", 20.7, 12.3, calibration);
  const cutB = extractCut(image, "x", 20.7, 12.3, calibration);
  assert.deepStrictEqual(cutA, cutB);
  assert.equal(cutA.stepUm, 2);

  const projectionA = computeProjection(image, "y", calibration);
  const projectionB = computeProjection(image, "y", calibration);
  assert.deepStrictEqual(projectionA, projectionB);

  const axisA = extractAxisProfile(image, 20.4, 19.8, 0.9, calibration);
  const axisB = extractAxisProfile(image, 20.4, 19.8, 0.9, calibration);
  assert.deepStrictEqual(axisA, axisB);

  const widthA = measureProfileWidths(cutA, 1);
  const widthB = measureProfileWidths(cutA, 1);
  assert.deepStrictEqual(widthA, widthB);

  assert.deepStrictEqual(pixels, original);
});

test("S18a axis-parallel axis profiles match extractCut sample by sample at full length", () => {
  // cos(pi/2) is 6.1e-17, never 0: without direction snapping these angles
  // clipped most samples and inherited NaN from ~1e-16-weight neighbours.
  const width = 7;
  const height = 5;
  const values: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) values.push(10 + 3 * x + 7 * y);
  }
  const image = { values, width, height };

  const vertical = extractAxisProfile(image, 3, 2, Math.PI / 2);
  const cutY = extractCut(image, "y", 3, 2);
  assert.equal(vertical.values.length, height);
  for (let i = 0; i < vertical.positionsPx.length; i += 1) {
    const y = 2 + vertical.positionsPx[i];
    assert.equal(vertical.values[i], cutY.values[y]);
  }

  const horizontalPi = extractAxisProfile(image, 3, 2, Math.PI);
  const cutX = extractCut(image, "x", 3, 2);
  assert.equal(horizontalPi.values.length, width);
  for (let i = 0; i < horizontalPi.positionsPx.length; i += 1) {
    const x = 3 - horizontalPi.positionsPx[i];
    assert.equal(horizontalPi.values[i], cutX.values[x]);
  }

  const zero = extractAxisProfile(image, 3, 2, 0);
  assert.equal(zero.values.length, width);
  const negativeHalfPi = extractAxisProfile(image, 3, 2, -Math.PI / 2);
  assert.equal(negativeHalfPi.values.length, height);

  // Corner centre with angle pi used to keep 1 of width samples.
  const corner = extractAxisProfile(image, 0, 0, Math.PI);
  assert.equal(corner.values.length, width);
});

test("S18a a NaN in an adjacent column never contaminates an axis-parallel profile", () => {
  const width = 9;
  const height = 5;
  const values = new Array<number>(width * height).fill(2);
  for (let y = 0; y < height; y += 1) values[2 + y * width] = Number.NaN;
  const axis = extractAxisProfile({ values, width, height }, 3, 2, Math.PI / 2);
  assert.equal(axis.values.length, height);
  for (const value of axis.values) assert.equal(value, 2);
});

test("S18a a lobe that only touches the threshold flags the width as ambiguous", () => {
  // revised: FIX 7 adds a 3-sigma noise margin to the ambiguity scan, so this
  // oracle measured with sigmaCounts 0 keeps the margin at 0 and the
  // exact-threshold touch still counts.
  const profile = makeProfile([0, 0, 20, 60, 100, 60, 20, 0, 0, 30, 50, 30, 0, 0]);
  const measurement = measureProfileWidths(profile, 0);
  // FWHM threshold is exactly 50; the secondary lobe reaches it without
  // crossing, which the level-based scan must still flag.
  assert.ok(measurement.fwhmData.widthPx !== null);
  assert.equal(measurement.fwhmData.ambiguous, true);
});

test("S18a a NaN-fenced secondary lobe is visible to the ambiguity scan", () => {
  // 95 clears the FWHM threshold plus the 3-sigma margin (50 + 3 * 1 = 53),
  // so the FIX 7 significance guard does not hide this lobe.
  const profile = makeProfile([0, 20, 60, 100, 60, 20, 0, Number.NaN, 95, Number.NaN, 0]);
  const measurement = measureProfileWidths(profile, 1);
  assert.equal(measurement.fwhmData.widthPx, 2.5);
  assert.equal(measurement.fwhmData.ambiguous, true);
  assert.equal(measurement.fwhmData.suppressedReason, null);
});

test("S18a a sample exactly at the threshold pins the crossing and stays unambiguous", () => {
  const measurement = measureProfileWidths(makeProfile([0, 50, 100, 50, 0]), 1);
  assert.equal(measurement.fwhmData.leftCrossingPx, 1);
  assert.equal(measurement.fwhmData.rightCrossingPx, 3);
  assert.equal(measurement.fwhmData.widthPx, 2);
  // The crossing samples themselves belong to the enclosing pair and must
  // not count as additional at-threshold structure.
  assert.equal(measurement.fwhmData.ambiguous, false);
});

test("S18a measureProfileWidths validates sample-position consistency", () => {
  const mismatched: LineProfile = {
    kind: "cut-x",
    positionsPx: Float64Array.from([0, 1, 2]),
    values: Float64Array.from([0, 1]),
    originXPx: 0,
    originYPx: 0,
  };
  assert.throws(() => measureProfileWidths(mismatched, 1), /does not match/);

  const descending: LineProfile = {
    kind: "cut-x",
    positionsPx: Float64Array.from([3, 2, 1, 0]),
    values: Float64Array.from([0, 10, 10, 0]),
    originXPx: 0,
    originYPx: 0,
  };
  assert.throws(() => measureProfileWidths(descending, 1), /strictly ascending/);
});

test("S18a documented behaviour: a projection peak is measured against the sigma the caller passes", () => {
  // The 3-sigma guard compares the profile's own peak against the sigma the
  // caller provides. A projection SUMS ~contributingCount pixels, so passing
  // the per-pixel background sigma will practically never suppress it — the
  // wiring layer is obligated to scale sigma (uncorrelated noise:
  // sigma_perPixel * sqrt(contributingCount)) before measuring projections.
  const width = 41;
  const height = 21;
  const values: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - 20;
      values.push(2.9 * Math.exp(-(dx * dx) / (2 * 36)));
    }
  }
  const image = { values, width, height };
  const sigmaPerPixel = 1;

  const cut = measureProfileWidths(extractCut(image, "x", 20, 10), sigmaPerPixel);
  assert.equal(cut.fwhmData.suppressedReason, "low-signal");

  const projection = measureProfileWidths(computeProjection(image, "x"), sigmaPerPixel);
  assert.equal(projection.fwhmData.suppressedReason, null);
  assert.ok(projection.fwhmData.widthPx !== null);
});

test("S18a FIX 7 anti-false-positive: a noisy single-lobe Gaussian is not ambiguous", () => {
  // Peak 10, beam sigma 5 px, uniform LCG noise with sigma 1.5. The FIX 7
  // significance guard (threshold + 3 * sigmaCounts) must keep the flag off;
  // uniform noise caps the excursion at 2.6 counts, below both margins.
  const next = makeLcg(4242);
  const values = gaussianLine(101, 50, 5, 10);
  const noiseHalfWidth = 1.5 * Math.sqrt(3);
  for (let index = 0; index < values.length; index += 1) {
    values[index] += (next() - 0.5) * 2 * noiseHalfWidth;
  }
  const measurement = measureProfileWidths(makeProfile(values), 1.5);
  assert.equal(measurement.fwhmData.suppressedReason, null);
  assert.equal(measurement.oneOverESquaredData.suppressedReason, null);
  assert.ok(measurement.fwhmData.widthPx !== null);
  assert.ok(measurement.oneOverESquaredData.widthPx !== null);
  assert.equal(measurement.fwhmData.ambiguous, false);
  assert.equal(measurement.oneOverESquaredData.ambiguous, false);
});
