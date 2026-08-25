import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBackground,
  backgroundRectsCoverSamePixels,
  estimateBackgroundNoise,
  type BackgroundRect,
} from "../../packages/image/src/background.ts";
import { suggestRoi } from "../../packages/image/src/roi.ts";

// Plane B(x, y) = b0 + bx * x + by * y evaluated in pixel coordinates with
// the origin at the top-left corner (x = 0, y = 0).
function makePlane(
  width: number,
  height: number,
  b0: number,
  bx: number,
  by: number,
): number[] {
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.push(b0 + bx * x + by * y);
    }
  }
  return pixels;
}

// Four border strips used as background regions in the robust-plane fits.
function edgeRects(width: number, height: number, thickness: number): BackgroundRect[] {
  return [
    { x0: 0, y0: 0, width, height: thickness },
    { x0: 0, y0: height - thickness, width, height: thickness },
    { x0: 0, y0: 0, width: thickness, height },
    { x0: width - thickness, y0: 0, width: thickness, height },
  ];
}

// Small deterministic LCG for oracle fixtures; same sequence on every run.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function maxAbs(values: ArrayLike<number>): number {
  let result = 0;
  for (let index = 0; index < values.length; index += 1) {
    result = Math.max(result, Math.abs(values[index]));
  }
  return result;
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), Number.MIN_VALUE);
}

// Independent median for oracles that pin a collected sample set.
function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

test("S18a robust-plane reconstructs a noise-free tilted plane to below 1e-9 counts", () => {
  const width = 32;
  const height = 32;
  const pixels = makePlane(width, height, 12.4, 0.031, -0.017);
  const result = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: edgeRects(width, height, 3) },
  );
  const residual = maxAbs(result.corrected);
  assert.ok(residual < 1e-9, `max |corrected| = ${residual}`);
});

test("S18a robust-plane parameters scale exactly by 8 when the whole scene is scaled by 8", () => {
  const width = 40;
  const height = 40;
  const base = makePlane(width, height, 6.28, 0.05, -0.03);
  const scaled = base.map((value) => 8 * value);
  const rects = edgeRects(width, height, 4);
  const first = applyBackground(
    { pixels: base, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  const second = applyBackground(
    { pixels: scaled, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  const p1 = first.plane!;
  const p2 = second.plane!;
  assert.ok(relativeError(p2.b0Counts, 8 * p1.b0Counts) <= 1e-12, `b0 ${p2.b0Counts} vs ${8 * p1.b0Counts}`);
  assert.ok(
    relativeError(p2.bxCountsPerPx, 8 * p1.bxCountsPerPx) <= 1e-12,
    `bx ${p2.bxCountsPerPx} vs ${8 * p1.bxCountsPerPx}`,
  );
  assert.ok(
    relativeError(p2.byCountsPerPx, 8 * p1.byCountsPerPx) <= 1e-12,
    `by ${p2.byCountsPerPx} vs ${8 * p1.byCountsPerPx}`,
  );
});

test("S18a robust-plane parameters scale by a non-power-of-two factor within relative 1e-6", () => {
  // 3.7 is not representable as a power of two, so every product in the fit
  // rounds differently from the x8 oracle above; the anchor is linear in the
  // values, so equivariance must still hold. Measured worst relative error:
  // 1.8e-15 on the clean plane and 9.0e-16 on the contaminated one, both far
  // inside the 1e-6 bound.
  const width = 40;
  const height = 40;
  const rects = edgeRects(width, height, 4);
  const factor = 3.7;
  const base = makePlane(width, height, 6.28, 0.05, -0.03);
  // Contaminated variant so the IRLS loop and the anchor actually run instead
  // of exiting on the first residual check.
  const next = makeLcg(5);
  const dirty = base.slice();
  for (let index = 0; index < dirty.length; index += 1) if (next() < 0.12) dirty[index] += 25;

  for (const [label, pixels] of [["clean", base], ["contaminated", dirty]] as const) {
    const scaled = pixels.map((value) => factor * value);
    const first = applyBackground(
      { pixels, width, height, dtype: "float32" },
      { method: "robust-plane", rects },
    ).plane!;
    const second = applyBackground(
      { pixels: scaled, width, height, dtype: "float32" },
      { method: "robust-plane", rects },
    ).plane!;
    assert.ok(
      relativeError(second.b0Counts, factor * first.b0Counts) <= 1e-6,
      `${label} b0 ${second.b0Counts} vs ${factor * first.b0Counts}`,
    );
    assert.ok(
      relativeError(second.bxCountsPerPx, factor * first.bxCountsPerPx) <= 1e-6,
      `${label} bx ${second.bxCountsPerPx} vs ${factor * first.bxCountsPerPx}`,
    );
    assert.ok(
      relativeError(second.byCountsPerPx, factor * first.byCountsPerPx) <= 1e-6,
      `${label} by ${second.byCountsPerPx} vs ${factor * first.byCountsPerPx}`,
    );
  }
});

test("S18a 8-bit-style and 16-bit-style rounding keep normalized plane slopes within rel 2e-2", () => {
  const width = 64;
  const height = 64;
  const bx = 1.1;
  const by = -0.6;
  const continuous = makePlane(width, height, 17.3, bx, by);
  const coarse = continuous.map((value) => Math.round(value));
  const fine = continuous.map((value) => Math.round(value * 257));
  const rects = edgeRects(width, height, 4);
  const coarseFit = applyBackground(
    { pixels: coarse, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  const fineFit = applyBackground(
    { pixels: fine, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  const pCoarse = coarseFit.plane!;
  const pFine = fineFit.plane!;
  const normalizedBx = pFine.bxCountsPerPx / 257;
  const normalizedBy = pFine.byCountsPerPx / 257;
  assert.ok(
    relativeError(pCoarse.bxCountsPerPx, normalizedBx) < 2e-2,
    `normalized bx ${normalizedBx} vs ${pCoarse.bxCountsPerPx}`,
  );
  assert.ok(
    relativeError(pCoarse.byCountsPerPx, normalizedBy) < 2e-2,
    `normalized by ${normalizedBy} vs ${pCoarse.byCountsPerPx}`,
  );
});

test("S18a three +1000 hot pixels do not move the robust-plane slopes beyond 1e-3 counts/px", () => {
  const width = 48;
  const height = 48;
  const bx = 0.04;
  const by = 0.03;
  const pixels = makePlane(width, height, 50, bx, by);
  const rects = edgeRects(width, height, 5);
  pixels[10 + 1 * width] += 1000;
  pixels[1 + 20 * width] += 1000;
  pixels[30 + 46 * width] += 1000;
  const result = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  const plane = result.plane!;
  assert.ok(Math.abs(plane.bxCountsPerPx - bx) < 1e-3, `bx error ${plane.bxCountsPerPx - bx}`);
  assert.ok(Math.abs(plane.byCountsPerPx - by) < 1e-3, `by error ${plane.byCountsPerPx - by}`);
});

test("S18a estimateBackgroundNoise selects the scale source via the MAD-IQR cascade and the dtype floor", () => {
  const flatUint = new Uint16Array(16 * 16).fill(100);
  const uintNoise = estimateBackgroundNoise(
    { pixels: flatUint, width: 16, height: 16, dtype: "uint16" },
    [{ x0: 0, y0: 0, width: 16, height: 16 }],
  );
  assert.equal(uintNoise.madCounts, 0);
  assert.equal(uintNoise.iqrCounts, 0);
  assert.equal(uintNoise.sigmaCounts, 0.5);
  assert.equal(uintNoise.floorCounts, 0.5);
  assert.equal(uintNoise.scaleSource, "floor");
  assert.equal(uintNoise.floorApplied, true);
  assert.equal(uintNoise.sampleCount, 256);

  const flatFloat = new Array<number>(8 * 8).fill(1.5);
  const flatNoise = estimateBackgroundNoise(
    { pixels: flatFloat, width: 8, height: 8, dtype: "float32" },
    [{ x0: 0, y0: 0, width: 8, height: 8 }],
  );
  assert.equal(flatNoise.madCounts, 0);
  assert.equal(flatNoise.iqrCounts, 0);
  assert.equal(flatNoise.stdCounts, 0);
  assert.equal(flatNoise.sigmaCounts, 0);
  assert.equal(flatNoise.floorCounts, 0);
  assert.equal(flatNoise.scaleSource, "zero");
  assert.equal(flatNoise.floorApplied, false);

  // The 90/10 two-level float32 fixture has MAD=0 AND IQR=0, so the revised
  // cascade reports sigma 0 with scaleSource "zero" even though the
  // informational stdCounts is positive: the std fallback no longer exists.
  const mixed: number[] = [];
  for (let index = 0; index < 100; index += 1) mixed.push(index < 90 ? 5.0 : 6.0);
  const mixedNoise = estimateBackgroundNoise(
    { pixels: mixed, width: 10, height: 10, dtype: "float32" },
    [{ x0: 0, y0: 0, width: 10, height: 10 }],
  );
  assert.equal(mixedNoise.madCounts, 0);
  assert.equal(mixedNoise.iqrCounts, 0);
  assert.ok(mixedNoise.stdCounts > 0);
  assert.equal(mixedNoise.sigmaCounts, 0);
  assert.equal(mixedNoise.scaleSource, "zero");
  assert.equal(mixedNoise.floorCounts, 0);
  assert.equal(mixedNoise.floorApplied, false);
});

test("S18a the IQR fallback fires for all dtypes when MAD is exactly zero", () => {
  // 60% of the samples sit exactly at the median (MAD = 0) while 40% are
  // spread, so the IQR fallback - not the removed std fallback - produces
  // the reported scale.
  const pixels: number[] = [];
  for (let index = 0; index < 100; index += 1) {
    if (index < 60) pixels.push(5.0);
    else if (index < 80) pixels.push(5.02);
    else pixels.push(5.04);
  }
  const noise = estimateBackgroundNoise(
    { pixels, width: 10, height: 10, dtype: "float32" },
    [{ x0: 0, y0: 0, width: 10, height: 10 }],
  );
  assert.equal(noise.madCounts, 0);
  assert.ok(noise.iqrCounts > 0);
  assert.ok(noise.sigmaCounts < noise.stdCounts + 1e-12);
  assert.equal(noise.scaleSource, "iqr");
  assert.equal(noise.floorApplied, false);
});

test("S18a oracle B1/B2 a sparse two-column geometry fits the tilted plane without IRLS collapse", () => {
  const width = 20;
  const height = 20;
  const b0 = 7.3;
  const bx = 0.11;
  const by = -0.07;
  const pixels = makePlane(width, height, b0, bx, by);
  // Leverage-healthy sparse geometry: three boxes on one column and two on a
  // second, staggered in y. No single sample can carry a slope on its own and
  // the fit is a legitimate task. The old delta collapse turned the Huber loop
  // into a hard rejector on exactly this kind of sparse geometry and threw a
  // spurious singular-normal-equations error.
  //
  // S20 stage E re-pin: the original oracle used five 1x1 rects (n = 5). That
  // geometry is now rejected by the minimum-sample rule, not by anything the
  // IRLS loop does, and it is pinned as such at the end of this test. The
  // sparse-geometry claim itself is unchanged and is carried here by the same
  // staggered two-column pattern in 2x2 boxes (n = 20), whose centres are the
  // original five coordinates.
  const rects: BackgroundRect[] = [
    { x0: 9, y0: 2, width: 2, height: 2 },
    { x0: 9, y0: 6, width: 2, height: 2 },
    { x0: 9, y0: 10, width: 2, height: 2 },
    { x0: 13, y0: 4, width: 2, height: 2 },
    { x0: 13, y0: 8, width: 2, height: 2 },
  ];
  const result = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  assert.equal(result.plane !== undefined, true);
  const plane = result.plane!;
  const xMean = (3 * 2 * (9 + 10) + 2 * 2 * (13 + 14)) / 20;
  const yMean = 2 * (2 + 3 + 6 + 7 + 10 + 11 + 4 + 5 + 8 + 9) / 20;
  assert.equal(plane.converged, true);
  assert.ok(Math.abs(plane.xMeanPx - xMean) < 1e-12, `xMeanPx ${plane.xMeanPx}`);
  assert.ok(Math.abs(plane.yMeanPx - yMean) < 1e-12, `yMeanPx ${plane.yMeanPx}`);
  // b0Counts is anchored at the reference centre, so the true plane value
  // there is b0 + bx*xMean + by*yMean.
  assert.ok(
    Math.abs(plane.b0Counts - (b0 + bx * xMean + by * yMean)) < 1e-9,
    `b0 ${plane.b0Counts}`,
  );
  assert.ok(Math.abs(plane.bxCountsPerPx - bx) < 1e-9, `bx ${plane.bxCountsPerPx}`);
  assert.ok(Math.abs(plane.byCountsPerPx - by) < 1e-9, `by ${plane.byCountsPerPx}`);
  assert.ok(Number.isFinite(plane.huberDeltaCounts));

  // S20 stage E (C3, R-47): the original five 1x1 rects. The geometry clears
  // every guard - its leverages are {0.733, 0.333, 0.733, 0.600, 0.600}, well
  // inside the cap - and is rejected only because five samples cannot carry a
  // three-parameter background model. No plane, no offset, the image comes
  // back uncorrected, and the noise scale falls back to the float32 floor.
  const sparse = applyBackground(
    { pixels, width, height, dtype: "float32" },
    {
      method: "robust-plane",
      rects: [
        { x0: 9, y0: 2, width: 1, height: 1 },
        { x0: 9, y0: 6, width: 1, height: 1 },
        { x0: 9, y0: 10, width: 1, height: 1 },
        { x0: 13, y0: 4, width: 1, height: 1 },
        { x0: 13, y0: 8, width: 1, height: 1 },
      ],
    },
  );
  assert.equal(sparse.method, "none");
  assert.equal(sparse.requestedMethod, "robust-plane");
  assert.equal(sparse.degradedReason, "insufficient-reference-samples");
  assert.equal(sparse.referenceSampleCount, 5);
  assert.equal(sparse.plane, undefined);
  assert.equal(sparse.offsetCounts, undefined);
  assert.equal(sparse.noise?.scaleSource, "floor");
  assert.equal(sparse.corrected[0], pixels[0]);
  assert.equal(sparse.corrected[width * height - 1], pixels[width * height - 1]);
});

// A robust-plane call that must be rejected by the leverage guard; returns the
// message so the caller can pin the wording.
function expectLeverageError(
  pixels: number[] | Uint16Array,
  width: number,
  height: number,
  dtype: "float32" | "uint16",
  rects: BackgroundRect[],
): string {
  let message = "";
  try {
    applyBackground({ pixels, width, height, dtype }, { method: "robust-plane", rects });
    assert.fail("expected the leverage guard to throw");
  } catch (error) {
    message = String((error as Error).message);
  }
  assert.match(message, /^degenerate background geometry:/);
  assert.match(message, /leverage/);
  return message;
}

test("S18a oracle H2 single-sample leverage geometries are rejected even when they pass the decile guard", () => {
  const width = 20;
  const height = 20;
  const pixels = makePlane(width, height, 7.3, 0.11, -0.07);
  // Four collinear samples plus one off-axis pixel: the off-axis pixel has
  // leverage exactly 1, so its value alone fixes the x slope. The geometry
  // clears the distinct-coordinate check and it used to be accepted; it is
  // now correctly rejected.
  const message = expectLeverageError(pixels, width, height, "float32", [
    { x0: 9, y0: 2, width: 1, height: 1 },
    { x0: 9, y0: 5, width: 1, height: 1 },
    { x0: 9, y0: 8, width: 1, height: 1 },
    { x0: 9, y0: 11, width: 1, height: 1 },
    { x0: 13, y0: 6, width: 1, height: 1 },
  ]);
  assert.match(message, /max leverage 1\.00/);

  // Nine-pixel column plus one off-column pixel, n = 10: the old code returned
  // bx = 1000.8 with converged = true for the spiked variant; the off-column
  // sample has leverage exactly 1 and is caught by the same guard.
  const columnRects: BackgroundRect[] = [
    { x0: 5, y0: 2, width: 1, height: 9 },
    { x0: 6, y0: 10, width: 1, height: 1 },
  ];
  const counts = new Uint16Array(makePlane(width, height, 100, 0.5, 0.25).map((value) => Math.round(value)));
  expectLeverageError(counts, width, height, "uint16", columnRects);
  const spiked = counts.slice();
  spiked[6 + 10 * width] += 1000;
  expectLeverageError(spiked, width, height, "uint16", columnRects);

  // Three samples determine a plane exactly, so all three leverages are 1 and
  // any one of them alone sets the slopes: rejected as well.
  expectLeverageError(pixels, width, height, "float32", [
    { x0: 2, y0: 2, width: 1, height: 1 },
    { x0: 9, y0: 2, width: 1, height: 1 },
    { x0: 4, y0: 9, width: 1, height: 1 },
  ]);
  // The smallest geometry the LEVERAGE cap accepts is still a 2x2 block
  // (leverage 0.75 everywhere) - but S20 stage E no longer lets four samples
  // carry a three-parameter plane, so the block is degraded, not thrown. The
  // two rules are disjoint and the truth table below names which one spoke.
  const block2x2 = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: [{ x0: 3, y0: 3, width: 2, height: 2 }] },
  );
  assert.equal(block2x2.method, "none");
  assert.equal(block2x2.degradedReason, "insufficient-reference-samples");
  assert.equal(block2x2.referenceSampleCount, 4);
  assert.equal(block2x2.plane, undefined);

  // The smallest ACCEPTED geometry is now a 3x3 block (n = 9, max leverage
  // 0.444); the plane it recovers is exact, as the 2x2 block's was.
  const smallest = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: [{ x0: 3, y0: 3, width: 3, height: 3 }] },
  ).plane!;
  assert.equal(smallest.converged, true);
  assert.ok(Math.abs(smallest.bxCountsPerPx - 0.11) < 1e-9, `bx ${smallest.bxCountsPerPx}`);
  assert.ok(Math.abs(smallest.byCountsPerPx + 0.07) < 1e-9, `by ${smallest.byCountsPerPx}`);
});

test("S18a oracle H3 a 25-sample block plus one hot pixel exceeds the tightened leverage cap and is rejected", () => {
  // 25 flat samples at value 10 plus a single 1x1 hot pixel at value 110:
  // the two-cluster geometry makes MAD(residuals) 0, so Huber cannot
  // separate the clusters, and the off-axis pixel alone (leverage 0.9608)
  // used to drag the x slope to ~2.7 counts/px with converged = true. The cap
  // now sits at 0.9, below that leverage, and the call is rejected up front.
  const width = 50;
  const height = 50;
  const pixels = new Array<number>(width * height).fill(10);
  pixels[45 + 10 * width] = 110;
  const message = expectLeverageError(pixels, width, height, "float32", [
    { x0: 8, y0: 8, width: 5, height: 5 },
    { x0: 45, y0: 10, width: 1, height: 1 },
  ]);
  assert.match(message, /max leverage 0\.96/);
});

test("S18a oracle H4 L-shaped strips and a lone small block still fit under the tightened leverage cap", () => {
  // Realistic layouts stay far below the cap: L-shaped strips measure 0.272
  // and a 3x3 block 0.444, so both must keep fitting exactly after the cap
  // moves from 0.99 down to 0.9. S20 stage E re-pin: the block used to be 2x2
  // (leverage 0.750, also inside the cap) and is now stopped one rule later,
  // by the minimum-sample rule - see oracle H2. The claim this oracle owns is
  // about the LEVERAGE cap, so it moves to the smallest block that clears
  // both rules.
  const width = 24;
  const height = 24;
  const bx = 0.02;
  const by = -0.01;
  const pixels = makePlane(width, height, 5, bx, by);

  const lFit = applyBackground(
    { pixels, width, height, dtype: "float32" },
    {
      method: "robust-plane",
      rects: [
        { x0: 2, y0: 2, width: 10, height: 1 },
        { x0: 2, y0: 2, width: 1, height: 10 },
      ],
    },
  ).plane!;
  assert.equal(lFit.converged, true);
  assert.ok(Math.abs(lFit.bxCountsPerPx - bx) < 1e-9, `L bx ${lFit.bxCountsPerPx}`);
  assert.ok(Math.abs(lFit.byCountsPerPx - by) < 1e-9, `L by ${lFit.byCountsPerPx}`);

  const blockFit = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: [{ x0: 8, y0: 8, width: 3, height: 3 }] },
  ).plane!;
  assert.equal(blockFit.converged, true);
  assert.ok(Math.abs(blockFit.bxCountsPerPx - bx) < 1e-9, `3x3 bx ${blockFit.bxCountsPerPx}`);
  assert.ok(Math.abs(blockFit.byCountsPerPx - by) < 1e-9, `3x3 by ${blockFit.byCountsPerPx}`);
});

test("S18a oracle B3 a column-plus-off-axis-pixel geometry is rejected by the leverage guard", () => {
  const width = 16;
  const height = 16;
  const pixels = makePlane(width, height, 3, 0.1, 0.2);
  const column: BackgroundRect = { x0: 7, y0: 2, width: 1, height: 12 };
  const single: BackgroundRect = { x0: 10, y0: 5, width: 1, height: 1 };

  // The removed decile support pre-filter used to fire first on this geometry
  // (100/110-style coordinate concentration); the leverage guard now rejects
  // it: the 12-sample column plus the lone off-column pixel carries leverage
  // exactly 1 on the off-axis sample.
  expectLeverageError(pixels, width, height, "float32", [column, single]);

  // The same geometry with +1000 on the lone off-column pixel must be just
  // as impossible: the old code silently returned bx = 1000.1, converged.
  const spikePixels = pixels.slice();
  spikePixels[10 + 5 * width] += 1000;
  expectLeverageError(spikePixels, width, height, "float32", [column, single]);
});

test("S18a oracle B3b a two-column 110-sample layout with coincident coordinate deciles fits", () => {
  // 100 samples on one column plus 10 on a second: P10(x) = P90(x) = 0, so
  // the removed decile support pre-filter used to reject this layout even
  // though the max OLS leverage is only ~0.11. It now fits: a flat field
  // must come back with zero slopes.
  const width = 100;
  const height = 100;
  const pixels = new Array<number>(width * height).fill(7);
  const result = applyBackground(
    { pixels, width, height, dtype: "float32" },
    {
      method: "robust-plane",
      rects: [
        { x0: 0, y0: 0, width: 1, height: 100 },
        { x0: 50, y0: 0, width: 1, height: 10 },
      ],
    },
  );
  assert.equal(result.plane !== undefined, true);
  const plane = result.plane!;
  assert.equal(plane.converged, true);
  assert.ok(Math.abs(plane.b0Counts - 7) < 1e-6, `b0 ${plane.b0Counts}`);
  assert.ok(Math.abs(plane.bxCountsPerPx) < 1e-6, `bx ${plane.bxCountsPerPx}`);
  assert.ok(Math.abs(plane.byCountsPerPx) < 1e-6, `by ${plane.byCountsPerPx}`);
});

test("S18a robust-plane rejects fewer than 2 distinct coordinates per axis", () => {
  const pixels = makePlane(16, 16, 3, 0.1, 0.2);
  const singleColumn: BackgroundRect[] = [{ x0: 7, y0: 2, width: 1, height: 4 }];
  assert.throws(
    () =>
      applyBackground(
        { pixels, width: 16, height: 16, dtype: "float32" },
        { method: "robust-plane", rects: singleColumn },
      ),
    /degenerate background geometry/,
  );
  const collinearStrips: BackgroundRect[] = [
    { x0: 5, y0: 0, width: 1, height: 8 },
    { x0: 5, y0: 8, width: 1, height: 8 },
  ];
  assert.throws(
    () =>
      applyBackground(
        { pixels, width: 16, height: 16, dtype: "float32" },
        { method: "robust-plane", rects: collinearStrips },
      ),
    /degenerate background geometry/,
  );
});

test("S18a oracle M2 unstructured high-contamination sweeps converge under the value-scale anchor", () => {
  // Unstructured (LCG-placed) bimodal +/-40 contamination up to 48%: every one
  // of these nine configurations converges, in 1 to 18 iterations, far below
  // MAX_IRLS_ITERATIONS. This is a convergence assertion, not the old
  // "converged || iterations === 50" tautology - the loop can only exit those
  // two ways, so that form asserted nothing. Structured contamination CAN
  // exhaust the cap; the oracle below pins one such case.
  const width = 24;
  const height = 24;
  const rects = edgeRects(width, height, 4);
  const fractions = [0.1, 0.3, 0.48];
  for (const fraction of fractions) {
    for (const seed of [7, 13, 21]) {
      const next = makeLcg(seed);
      const pixels = makePlane(width, height, 3.2, 0.07, -0.04);
      for (let index = 0; index < pixels.length; index += 1) {
        if (next() < fraction) pixels[index] += index % 2 === 0 ? 40 : -40;
      }
      const result = applyBackground(
        { pixels, width, height, dtype: "float32" },
        { method: "robust-plane", rects },
      );
      assert.equal(result.plane !== undefined, true, `fraction ${fraction} seed ${seed}`);
      const plane = result.plane!;
      assert.equal(plane.converged, true, `fraction ${fraction} seed ${seed} iterations ${plane.iterations}`);
      assert.ok(plane.iterations < 50, `fraction ${fraction} seed ${seed} iterations ${plane.iterations}`);
      assert.ok(Number.isFinite(plane.b0Counts), `fraction ${fraction} seed ${seed}`);
      assert.ok(Number.isFinite(plane.bxCountsPerPx), `fraction ${fraction} seed ${seed}`);
      assert.ok(Number.isFinite(plane.byCountsPerPx), `fraction ${fraction} seed ${seed}`);
    }
  }
});

test("S18a oracle M1 structured contamination exhausts the IRLS cap and reports converged false", () => {
  // The iteration cap is reachable, so it must be reported honestly instead of
  // being documented away. A ramp added to the first 20% of the pixels in
  // row-major order (the top rows of the frame, so the perturbation is
  // asymmetric in both axes) keeps shifting which samples the Huber weights
  // downweight, and the parameters oscillate instead of settling: the fit stops
  // at exactly MAX_IRLS_ITERATIONS with converged = false and finite, still
  // roughly correct parameters (measured bx 0.32617, by -0.28199).
  const width = 24;
  const height = 24;
  const trueBx = 0.3;
  const trueBy = -0.2;
  const pixels = makePlane(width, height, 1000, trueBx, trueBy);
  const contaminated = Math.floor(0.2 * pixels.length);
  for (let index = 0; index < contaminated; index += 1) pixels[index] += 5 * ((index % width) / width);
  const result = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: edgeRects(width, height, 4) },
  );
  const plane = result.plane!;
  assert.equal(plane.iterations, 50, `iterations ${plane.iterations}`);
  assert.equal(plane.converged, false);
  assert.ok(Number.isFinite(plane.b0Counts) && Number.isFinite(plane.huberDeltaCounts));
  assert.ok(Math.abs(plane.bxCountsPerPx - trueBx) < 0.2, `bx ${plane.bxCountsPerPx}`);
  assert.ok(Math.abs(plane.byCountsPerPx - trueBy) < 0.2, `by ${plane.byCountsPerPx}`);
});

test("S18a oracle H1 an exactly centred hot pixel on a flat float32 field fits the background level", () => {
  // Point-symmetric contamination: the hot pixel sits at the centroid, so OLS
  // returns bx = by = 0 exactly, every inlier carries the identical residual
  // and MAD(residuals) is 0. A residual-spread-only anchor is 0 here (>=80% of
  // the values are identical, so the decile span vanishes too), delta becomes 0
  // and every Huber weight vanishes - the fit used to throw "all Huber weights
  // vanished". The |median| term of the anchor keeps delta positive at the
  // value level, so the inliers stay at equal weight.
  const pixels = new Float32Array(81).fill(100);
  pixels[4 + 4 * 9] = 5000;
  const result = applyBackground(
    { pixels, width: 9, height: 9, dtype: "float32" },
    { method: "robust-plane", rects: [{ x0: 0, y0: 0, width: 9, height: 9 }] },
  );
  const plane = result.plane!;
  assert.equal(plane.converged, true);
  assert.ok(plane.huberDeltaCounts > 0, `delta ${plane.huberDeltaCounts}`);
  assert.ok(Math.abs(plane.bxCountsPerPx) < 1e-6, `bx ${plane.bxCountsPerPx}`);
  assert.ok(Math.abs(plane.byCountsPerPx) < 1e-6, `by ${plane.byCountsPerPx}`);
  // Measured 1.7e-6 above the flat level of 100; an outlier-dominated fit would
  // sit at the contaminated mean 160.5.
  assert.ok(Math.abs(plane.b0Counts - 100) < 1e-4, `b0 ${plane.b0Counts}`);

  // Same fixture at level 0: the median term is 0 too, so the
  // smallest-positive-magnitude fallback (the 5000 spike magnitude) is what
  // keeps the anchor positive. Measured b0 error 8.4e-5.
  const atZero = new Float32Array(81);
  atZero[4 + 4 * 9] = 5000;
  const zeroPlane = applyBackground(
    { pixels: atZero, width: 9, height: 9, dtype: "float32" },
    { method: "robust-plane", rects: [{ x0: 0, y0: 0, width: 9, height: 9 }] },
  ).plane!;
  assert.equal(zeroPlane.converged, true);
  assert.ok(Math.abs(zeroPlane.b0Counts) < 1e-3, `b0 ${zeroPlane.b0Counts}`);
  assert.ok(Math.abs(zeroPlane.bxCountsPerPx) < 1e-6, `bx ${zeroPlane.bxCountsPerPx}`);

  // A truly constant field has no positive anchor term left: the anchor is 0
  // and the 0 <= 0 residual check exits on the first iteration.
  const constant = applyBackground(
    { pixels: new Float32Array(81).fill(7), width: 9, height: 9, dtype: "float32" },
    { method: "robust-plane", rects: [{ x0: 0, y0: 0, width: 9, height: 9 }] },
  ).plane!;
  assert.equal(constant.converged, true);
  assert.equal(constant.iterations, 0);
  assert.equal(constant.b0Counts, 7);
  assert.equal(constant.bxCountsPerPx, 0);
  assert.equal(constant.byCountsPerPx, 0);
});

test("S18a oracle F4 a 1e9 spike plus a +100-count block anchors at the block magnitude and does not tilt", () => {
  // Zero background, one 1e9 spike and a +100-count 10-pixel block inside the
  // rects: median and IQR are both 0, so the old dataSpan fallback anchored
  // at 1e9 * 1e-6 = 1000 (delta ~1345), the block sat inside delta at full
  // weight and the plane tilted. The smallest-positive-magnitude fallback
  // anchors at 100 * 1e-6 = 1e-4 instead, so the block is downweighted and
  // the plane stays flat.
  const width = 20;
  const height = 20;
  const pixels = new Float32Array(width * height);
  pixels[5 + 5 * width] = 1e9;
  for (let y = 5; y < 10; y += 1) {
    pixels[15 + y * width] = 100;
    pixels[16 + y * width] = 100;
  }
  const result = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: [{ x0: 0, y0: 0, width, height }] },
  );
  const plane = result.plane!;
  assert.equal(plane.converged, true);
  assert.ok(Math.abs(plane.bxCountsPerPx) < 1e-3, `bx ${plane.bxCountsPerPx}`);
  assert.ok(Math.abs(plane.byCountsPerPx) < 1e-3, `by ${plane.byCountsPerPx}`);
});

test("S18a oracle M4 bright contamination above 10% does not inflate the anchor and unmask a 0.5-count block", () => {
  // 15% of the samples at 1e6 pushes the 90th percentile of the values to the
  // contamination level, so a decile-span anchor jumps to 1e6 * 1e-6 = 1 count
  // and delta to 1.345 counts: a localized +0.5-count block then sits inside
  // delta, keeps weight 1 and drags the slope. The IQR is untouched by 15%
  // contamination, so the anchor stays at the background level (1e-4) and the
  // block is downweighted. Measured bx error: 4.4e-3 with the decile anchor,
  // 2.6e-6 with the IQR anchor - a factor of 1700.
  const width = 24;
  const height = 24;
  const trueBx = 0.05;
  const trueBy = -0.03;
  const rects = edgeRects(width, height, 4);
  const pixels = makePlane(width, height, 100, trueBx, trueBy);
  const inBlock = (index: number): boolean => {
    const x = index % width;
    const y = (index - x) / width;
    return x >= 20 && y >= 8 && y <= 15;
  };
  const rectIndices: number[] = [];
  for (const rect of rects) {
    for (let y = rect.y0; y < rect.y0 + rect.height; y += 1) {
      for (let x = rect.x0; x < rect.x0 + rect.width; x += 1) {
        const index = x + y * width;
        if (!rectIndices.includes(index)) rectIndices.push(index);
      }
    }
  }
  rectIndices.sort((a, b) => a - b);
  // 32 of the 320 samples carry a +0.5-count block; 48 (15%) are contaminated
  // at 1e6, placed on the remaining samples at an even stride.
  for (const index of rectIndices) if (inBlock(index)) pixels[index] += 0.5;
  const clean = rectIndices.filter((index) => !inBlock(index));
  const contaminated = Math.round(0.15 * rectIndices.length);
  const step = clean.length / contaminated;
  for (let k = 0; k < contaminated; k += 1) pixels[clean[Math.floor(k * step)]] = 1e6;
  assert.equal(rectIndices.length, 320);
  assert.equal(contaminated, 48);

  const plane = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  ).plane!;
  assert.equal(plane.converged, true);
  // delta must stay well below the 0.5-count block so the block is genuinely
  // downweighted (measured 1.4e-4).
  assert.ok(plane.huberDeltaCounts < 0.05, `delta ${plane.huberDeltaCounts}`);
  assert.ok(Math.abs(plane.bxCountsPerPx - trueBx) < 1e-4, `bx ${plane.bxCountsPerPx}`);
  assert.ok(Math.abs(plane.byCountsPerPx - trueBy) < 1e-4, `by ${plane.byCountsPerPx}`);
});

test("S18a oracle M8 the plane result carries the reference centre", () => {
  const width = 20;
  const height = 20;
  const pixels = makePlane(width, height, 5, 0.02, -0.01);
  const result = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: edgeRects(width, height, 2) },
  );
  assert.equal(result.plane !== undefined, true);
  const plane = result.plane!;
  // The edge strips are symmetric around the image centre, so the reference
  // centre is exactly (9.5, 9.5).
  assert.ok(Math.abs(plane.xMeanPx - 9.5) < 1e-12);
  assert.ok(Math.abs(plane.yMeanPx - 9.5) < 1e-12);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const reconstructed =
        plane.b0Counts + plane.bxCountsPerPx * (x - plane.xMeanPx) + plane.byCountsPerPx * (y - plane.yMeanPx);
      assert.ok(Math.abs(reconstructed - (5 + 0.02 * x - 0.01 * y)) < 1e-9);
    }
  }
});

test("S18a oracle B4 hot pixels no longer inflate the noise scale and the beam survives ROI suggestion", () => {
  const width = 64;
  const height = 64;
  const pixels: number[] = new Array<number>(width * height).fill(10);
  pixels[2 + 2 * width] += 500;
  pixels[30 + 2 * width] += 500;
  pixels[2 + 30 * width] += 500;
  for (let y = 29; y <= 34; y += 1) {
    for (let x = 29; x <= 34; x += 1) pixels[x + y * width] += 100;
  }
  const rects = edgeRects(width, height, 4);
  const noise = estimateBackgroundNoise(
    { pixels, width, height, dtype: "uint16" },
    rects,
  );
  assert.ok(noise.sigmaCounts < 1, `sigma should be < 1, got ${noise.sigmaCounts}`);
  const corrected = applyBackground(
    { pixels, width, height, dtype: "uint16" },
    { method: "rect-median", rects },
  );
  const roi = suggestRoi({ values: corrected.corrected, width, height }, noise.sigmaCounts, { k: 4 });
  assert.ok(roi !== null, "expected a suggested ROI");
  assert.ok(
    roi.rect.x0 <= 31 && 31 <= roi.rect.x0 + roi.rect.width - 1,
    `beam x 31 not inside [${roi.rect.x0}, ${roi.rect.x0 + roi.rect.width - 1}]`,
  );
  assert.ok(
    roi.rect.y0 <= 31 && 31 <= roi.rect.y0 + roi.rect.height - 1,
    `beam y 31 not inside [${roi.rect.y0}, ${roi.rect.y0 + roi.rect.height - 1}]`,
  );
});

test("S18a oracle B5 float32 robust floor ignores one huge outlier and integer MAD stays outlier-proof", () => {
  const next = makeLcg(42);
  const floatPixels: number[] = [];
  for (let index = 0; index < 400; index += 1) {
    floatPixels.push(5.0 + 0.15 * Math.sin(index * 0.13) + 0.12 * (next() - 0.5));
  }
  floatPixels[0] = 1e6;
  const floatNoise = estimateBackgroundNoise(
    { pixels: floatPixels, width: 20, height: 20, dtype: "float32" },
    [{ x0: 0, y0: 0, width: 20, height: 20 }],
  );
  assert.ok(floatNoise.sigmaCounts >= 0.05 && floatNoise.sigmaCounts <= 0.3, `sigma ${floatNoise.sigmaCounts}`);
  assert.ok(floatNoise.floorCounts < 1e-9, `floor ${floatNoise.floorCounts}`);

  // 19x21 alternating 300/100 gives 199 samples of each level after the
  // 65535 replacement; the median is 300 and the median absolute deviation
  // is exactly 200, so the reported madCounts is 200 and the MAD scale wins
  // over the floor. An outlier-dominated estimate would exceed 4000.
  const intPixels: number[] = [];
  for (let index = 0; index < 19 * 21; index += 1) intPixels.push(index % 2 === 0 ? 300 : 100);
  intPixels[0] = 65535;
  const intNoise = estimateBackgroundNoise(
    { pixels: intPixels, width: 19, height: 21, dtype: "uint16" },
    [{ x0: 0, y0: 0, width: 19, height: 21 }],
  );
  assert.equal(intNoise.madCounts, 200);
  assert.equal(intNoise.sigmaCounts, 1.4826 * 200);
  assert.equal(intNoise.scaleSource, "mad");
});

test("S18a oracle M7 overlapping rectangles count each pixel once", () => {
  const width = 10;
  const height = 10;
  const pixels: number[] = [];
  for (let index = 0; index < width * height; index += 1) pixels.push(2 + (index % 5));
  const single = estimateBackgroundNoise(
    { pixels, width, height, dtype: "uint16" },
    [{ x0: 0, y0: 0, width, height }],
  );
  const duplicate = estimateBackgroundNoise(
    { pixels, width, height, dtype: "uint16" },
    [
      { x0: 0, y0: 0, width, height },
      { x0: 0, y0: 0, width, height },
    ],
  );
  assert.deepStrictEqual(duplicate, single);
  assert.equal(single.sampleCount, width * height);

  // 4-edge strips of thickness 2 on a 10x10 image: the per-rect sum is 80,
  // but the four 2x2 corners are visited twice; the deduplicated union is
  // exactly 64 pixels.
  const strips = estimateBackgroundNoise(
    { pixels, width, height, dtype: "uint16" },
    edgeRects(width, height, 2),
  );
  assert.equal(strips.sampleCount, 64);
});

test("S18a oracle M5 a rect union collected through the occupancy bitmap matches the single covering rect", () => {
  // The multi-rect union is collected through a Uint8Array occupancy bitmap
  // over the union's bounding box instead of an index Set plus a sorted array.
  // Two rects tiling the frame must therefore produce bit-identical results to
  // the one covering rect, non-finite pixels and all.
  const width = 9;
  const height = 8;
  const pixels: number[] = [];
  for (let index = 0; index < width * height; index += 1) pixels.push(3 + ((index * 7) % 11));
  pixels[13] = Number.NaN;
  const covering: BackgroundRect[] = [{ x0: 0, y0: 0, width, height }];
  const tiling: BackgroundRect[] = [
    { x0: 0, y0: 0, width, height: 3 },
    { x0: 0, y0: 3, width, height: height - 3 },
  ];
  const single = estimateBackgroundNoise({ pixels, width, height, dtype: "float32" }, covering);
  const tiled = estimateBackgroundNoise({ pixels, width, height, dtype: "float32" }, tiling);
  assert.deepStrictEqual(tiled, single);
  assert.equal(single.sampleCount, width * height - 1);
  const singlePlane = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: covering },
  );
  const tiledPlane = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects: tiling },
  );
  assert.deepStrictEqual(tiledPlane.plane, singlePlane.plane);
  assert.deepStrictEqual(tiledPlane.corrected, singlePlane.corrected);

  // Offset, overlapping rects: the bitmap is indexed relative to the bounding
  // box, so the offset must not shift a single sample. The union of
  // [4,2,4x3] and [5,3,4x4] is 12 + 16 - 6 shared = 22 pixels.
  const offsetUnion = estimateBackgroundNoise({ pixels, width, height, dtype: "float32" }, [
    { x0: 4, y0: 2, width: 4, height: 3 },
    { x0: 5, y0: 3, width: 4, height: 4 },
  ]);
  const expected: number[] = [];
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 4; x <= 8; x += 1) {
      const inFirst = x <= 7 && y <= 4;
      const inSecond = x >= 5 && y >= 3;
      if (inFirst || inSecond) expected.push(pixels[x + y * width]);
    }
  }
  assert.equal(expected.length, 22);
  assert.equal(offsetUnion.sampleCount, 22);
  assert.equal(offsetUnion.medianCounts, medianOf(expected));
});

test("S18a oracle M2b the subsample stride stays coprime with the width so column patterns survive", () => {
  // 2048x2048 float32 exceeds ROBUST_STATS_MAX_EXACT (1<<20), so the noise
  // estimate subsamples with stride ceil(4194304 / 1048576) = 4. Stride 4
  // divides the width, hits x = 0 mod 4 in every row and aliases the
  // four-level column pattern away: the old code reported sigma exactly 0.
  // The stride is grown to 5 (coprime with 2048), the sample phase drifts
  // across rows and all four levels appear.
  const width = 2048;
  const height = 2048;
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) pixels[row + x] = 100 + (x % 4) * 2;
  }
  const noise = estimateBackgroundNoise(
    { pixels, width, height, dtype: "float32" },
    [{ x0: 0, y0: 0, width, height }],
  );
  // Stride 5 over 4194304 values yields floor(4194303/5)+1 = 838861 samples
  // (5.9% under the cap, never above it): 209716 at level 100 and 209715 each
  // at 102, 104 and 106. The median is 102, so the sorted absolute deviations
  // are 209715 zeros followed by 419431 twos: the MAD is exactly 2.
  assert.equal(noise.sampleCount, 838861);
  assert.equal(noise.medianCounts, 102);
  assert.equal(noise.madCounts, 2);
  assert.equal(noise.iqrCounts, 4);
  assert.equal(noise.scaleSource, "mad");
  assert.equal(noise.sigmaCounts, 1.4826 * 2);
});

test("S18a oracle F3 the subsample stride stays coprime with the RECT width when the rect is narrower than the image", () => {
  // One 1100x1000 rect inside a 2048-wide image: the collected sample list is
  // rect-row-major with row period 1100, NOT image-row-major with period 2048.
  // 1100 * 1000 = 1.1M samples exceeds ROBUST_STATS_MAX_EXACT, so the initial
  // stride is ceil(1.1M / 1<<20) = 2; gcd(2, 2048) = 2 already rejects it, but
  // a stride-based guard on the image width only would have accepted 4,
  // leaving the x % 5 column pattern aliased to a single level. The stride
  // must be coprime with both 2048 AND the rect row period 1100: it becomes 3.
  // Stride 3 over 1100000 values yields 366667 samples; each of the 1100
  // columns appears 333 times plus 367 columns (x divisible by 3) once more,
  // so the levels 100/110/120/130/140 appear 73334/73333/73333/73334/73333
  // times: median 120, MAD 10, IQR 20 and sigma = 1.4826 * 10.
  const width = 2048;
  const height = 1000;
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) pixels[row + x] = 100 + (x % 5) * 10;
  }
  const noise = estimateBackgroundNoise(
    { pixels, width, height, dtype: "float32" },
    [{ x0: 0, y0: 0, width: 1100, height: 1000 }],
  );
  assert.equal(noise.sampleCount, 366667);
  assert.equal(noise.medianCounts, 120);
  assert.equal(noise.madCounts, 10);
  assert.equal(noise.iqrCounts, 20);
  assert.equal(noise.scaleSource, "mad");
  assert.equal(noise.sigmaCounts, 1.4826 * 10);
});

test("S18a dark-frame subtraction demands matching dimensions and dtype and handles NaN dark pixels", () => {
  const image = new Uint8Array([10, 20, 30, 40]);
  assert.throws(
    () =>
      applyBackground(
        { pixels: image, width: 2, height: 2, dtype: "uint8" },
        { method: "dark-frame", darkPixels: new Uint8Array([1, 2, 3, 4]), darkWidth: 4, darkHeight: 1, darkDtype: "uint8" },
      ),
    /dark frame dimensions/,
  );
  assert.throws(
    () =>
      applyBackground(
        { pixels: image, width: 2, height: 2, dtype: "uint8" },
        { method: "dark-frame", darkPixels: new Uint16Array([1, 2, 3, 4]), darkWidth: 2, darkHeight: 2, darkDtype: "uint16" },
      ),
    /dtype/,
  );
  const exact = applyBackground(
    { pixels: image, width: 2, height: 2, dtype: "uint8" },
    { method: "dark-frame", darkPixels: new Uint8Array([1, 2, 3, 4]), darkWidth: 2, darkHeight: 2, darkDtype: "uint8" },
  );
  assert.deepStrictEqual(Array.from(exact.corrected), [9, 18, 27, 36]);

  const floatImage = new Float32Array([10, 2, 30, 40]);
  const nanDark = new Float32Array([Number.NaN, 3, 3, 4]);
  const nanResult = applyBackground(
    { pixels: floatImage, width: 2, height: 2, dtype: "float32" },
    { method: "dark-frame", darkPixels: nanDark, darkWidth: 2, darkHeight: 2, darkDtype: "float32" },
  );
  assert.ok(Number.isNaN(nanResult.corrected[0]));
  assert.equal(nanResult.corrected[1], -1);
  assert.equal(nanResult.corrected[2], 27);
  assert.equal(nanResult.corrected[3], 36);
  assert.equal(nanResult.negativeCountAfter, 1);
  assert.equal(nanResult.negativeFractionAfter, 1 / 3);
});

test("S18a dark-frame turns a non-finite image pixel with a non-finite dark pixel into NaN", () => {
  const passThrough = applyBackground(
    { pixels: new Float32Array([Infinity, 2, NaN, 40]), width: 2, height: 2, dtype: "float32" },
    { method: "dark-frame", darkPixels: new Float32Array([7, 1, 3, 4]), darkWidth: 2, darkHeight: 2, darkDtype: "float32" },
  );
  assert.equal(passThrough.corrected[0], Infinity);
  assert.equal(passThrough.corrected[1], 1);
  assert.ok(Number.isNaN(passThrough.corrected[2]));
  assert.equal(passThrough.corrected[3], 36);

  const bothNonFinite = applyBackground(
    { pixels: new Float32Array([Infinity, 2, NaN, 40]), width: 2, height: 2, dtype: "float32" },
    { method: "dark-frame", darkPixels: new Float32Array([Infinity, 1, NaN, 4]), darkWidth: 2, darkHeight: 2, darkDtype: "float32" },
  );
  assert.ok(Number.isNaN(bothNonFinite.corrected[0]));
  assert.equal(bothNonFinite.corrected[1], 1);
  assert.ok(Number.isNaN(bothNonFinite.corrected[2]));
  assert.equal(bothNonFinite.corrected[3], 36);
});

test("S18a manual-offset never clips negative values and counts them exactly", () => {
  const pixels = new Uint8Array([1, 2, 3, 4]);
  const result = applyBackground(
    { pixels, width: 2, height: 2, dtype: "uint8" },
    { method: "manual-offset", offsetCounts: 10 },
  );
  assert.deepStrictEqual(Array.from(result.corrected), [-9, -8, -7, -6]);
  assert.equal(result.negativeCountAfter, 4);
  assert.equal(result.negativeFractionAfter, 1);
  assert.equal(result.offsetCounts, 10);
});

test("S18a none and manual-offset leave the input array untouched and return a fresh Float64Array", () => {
  const pixels = new Uint8Array([5, 6, 7, 8]);
  const original = pixels.slice();

  const none = applyBackground({ pixels, width: 2, height: 2, dtype: "uint8" }, { method: "none" });
  assert.ok(none.corrected instanceof Float64Array);
  assert.notStrictEqual(none.corrected, pixels);
  assert.deepStrictEqual(Array.from(none.corrected), [5, 6, 7, 8]);
  assert.deepStrictEqual(pixels, original);

  const manual = applyBackground(
    { pixels, width: 2, height: 2, dtype: "uint8" },
    { method: "manual-offset", offsetCounts: 1 },
  );
  assert.ok(manual.corrected instanceof Float64Array);
  assert.notStrictEqual(manual.corrected, pixels);
  assert.deepStrictEqual(Array.from(manual.corrected), [4, 5, 6, 7]);
  assert.deepStrictEqual(pixels, original);
});

test("S18a robust-plane is deterministic across repeated runs", () => {
  const width = 32;
  const height = 32;
  const pixels = makePlane(width, height, 9.7, 0.021, 0.013);
  const rects = edgeRects(width, height, 3);
  const first = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  const second = applyBackground(
    { pixels, width, height, dtype: "float32" },
    { method: "robust-plane", rects },
  );
  assert.deepStrictEqual(first.plane, second.plane);
  assert.deepStrictEqual(first.noise, second.noise);
  assert.deepStrictEqual(first.corrected, second.corrected);
});

test("S20 stage E reference identity is the resolved pixel union, not the rectangle list", () => {
  const a: BackgroundRect = { x0: 10, y0: 10, width: 1, height: 3 };
  const b: BackgroundRect = { x0: 14, y0: 12, width: 1, height: 3 };
  const c: BackgroundRect = { x0: 18, y0: 15, width: 1, height: 3 };
  const list = [a, b, c];

  // Same list, same order, reordered, repeated: all the same reference.
  assert.equal(backgroundRectsCoverSamePixels(list, list), true);
  assert.equal(backgroundRectsCoverSamePixels(list, [a, b, c]), true);
  assert.equal(backgroundRectsCoverSamePixels(list, [c, b, a]), true);
  assert.equal(backgroundRectsCoverSamePixels(list, [b, c, a]), true);
  assert.equal(backgroundRectsCoverSamePixels(list, [...list, a]), true);
  assert.equal(backgroundRectsCoverSamePixels(list, [b, c, b, a, c]), true);

  // Re-tiling: one 2x3 rectangle against two 1x3 rectangles over the same six
  // pixels. This is the case a sorted-tuple comparison cannot see, and the
  // reason the comparison is over pixels.
  assert.equal(
    backgroundRectsCoverSamePixels(
      [{ x0: 10, y0: 10, width: 2, height: 3 }],
      [
        { x0: 10, y0: 10, width: 1, height: 3 },
        { x0: 11, y0: 10, width: 1, height: 3 },
      ],
    ),
    true,
  );
  // Overlapping rectangles that together tile the same block.
  assert.equal(
    backgroundRectsCoverSamePixels(
      [{ x0: 4, y0: 4, width: 4, height: 4 }],
      [
        { x0: 4, y0: 4, width: 4, height: 3 },
        { x0: 4, y0: 6, width: 4, height: 2 },
      ],
    ),
    true,
  );

  // Different references: a subset, a superset, a shifted block, a different
  // shape of the same AREA, and an empty list.
  assert.equal(backgroundRectsCoverSamePixels(list, [a, b]), false);
  assert.equal(backgroundRectsCoverSamePixels(list, [...list, { x0: 30, y0: 30, width: 2, height: 2 }]), false);
  assert.equal(backgroundRectsCoverSamePixels(list, [a, b, { x0: 19, y0: 15, width: 1, height: 3 }]), false);
  assert.equal(
    backgroundRectsCoverSamePixels([{ x0: 4, y0: 4, width: 4, height: 3 }], [{ x0: 4, y0: 4, width: 3, height: 4 }]),
    false,
  );
  assert.equal(backgroundRectsCoverSamePixels(list, []), false);
  assert.equal(backgroundRectsCoverSamePixels([], []), true);

  // Degenerate extents are refused rather than measured - and refused BEFORE
  // any shortcut, so the alias case (the same array passed twice) answers
  // exactly as the equal-but-distinct case does. Without that ordering the
  // guard would hold only for callers who happened not to reuse one array.
  const degenerate: BackgroundRect[] = [{ x0: 0, y0: 0, width: 0, height: 3 }];
  assert.equal(backgroundRectsCoverSamePixels(degenerate, [{ x0: 0, y0: 0, width: 0, height: 3 }]), false);
  assert.equal(backgroundRectsCoverSamePixels(degenerate, degenerate), false, "alias of a degenerate list");
  for (const bad of [
    { x0: 0, y0: 0, width: 0, height: 3 },
    { x0: 0, y0: 0, width: 3, height: 0 },
    { x0: 0, y0: 0, width: -2, height: 3 },
    { x0: 0, y0: 0, width: 2.5, height: 3 },
    { x0: 0.5, y0: 0, width: 2, height: 3 },
    { x0: 0, y0: 0, width: Number.NaN, height: 3 },
    { x0: 0, y0: 0, width: Number.POSITIVE_INFINITY, height: 3 },
  ]) {
    const alias = [bad];
    assert.equal(backgroundRectsCoverSamePixels(alias, alias), false, `alias of ${JSON.stringify(bad)}`);
    assert.equal(backgroundRectsCoverSamePixels(alias, [{ ...bad }]), false, `copy of ${JSON.stringify(bad)}`);
    // A degenerate entry poisons an otherwise healthy list on either side.
    assert.equal(backgroundRectsCoverSamePixels([a, bad], [a, bad]), false, `left carries ${JSON.stringify(bad)}`);
    assert.equal(backgroundRectsCoverSamePixels([a], [a, bad]), false, `right carries ${JSON.stringify(bad)}`);
  }
});
