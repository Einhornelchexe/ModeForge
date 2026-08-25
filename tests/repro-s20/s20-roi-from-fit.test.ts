// S20 repro corpus — "ROI from fit" applies geometry the analyzer itself
// refused to release.
//
// The released-widths branch of the derivation is guarded (it reads stage-B
// only when it is valid). The fit fallback under it checks nothing but
// `converged && params`. A beam-free frame can produce a converged fit with a
// negative amplitude and a centre thousands of pixels off the sensor; the
// derived box then collapses to a 1-pixel-wide strip, and the button applies
// it without a word.
//
// Pinned here: 2 of 40 pure-noise frames produce such a box today. The guard
// stage must take that to 0 of 40 while leaving the healthy control identical.
//
// The derivation chain lives in ./lib/roi-from-fit.ts, a 1:1 port of the
// workbench handler with the state plumbing replaced by arguments.
//
// Runtime: about 24 s.

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeImage } from "../../packages/image/src/analyze.ts";
import { clickRoiFromFit, roiRectFromReleasedWidths } from "./lib/roi-from-fit.ts";
import { addGaussianNoise, gaussianSceneF32, roundTo } from "./lib/scenes.ts";

const SIZE = 128;

test("S20 repro: 2 of 40 beam-free frames derive a degenerate one-pixel ROI", () => {
  let converged = 0;
  let centreOutside = 0;
  let nonpositiveAmplitude = 0;
  let geometryReleasableCount = 0;
  const degenerate: string[] = [];

  for (let seed = 1; seed <= 40; seed += 1) {
    const pixels = new Float32Array(SIZE * SIZE);
    pixels.fill(100);
    addGaussianNoise(pixels, 20, seed * 7919);
    const result = analyzeImage({ pixels, width: SIZE, height: SIZE, dtype: "float32" });
    const gauss = result.fits.gauss2d;
    if (!gauss.converged || !gauss.params) continue;
    converged += 1;
    // S20 stage F (R-58): the exported ROI-geometry verdict on exactly this
    // scene class. Both converged fits over the beam-free set are geometries
    // the analyzer itself refuses, and the field says so.
    if (gauss.geometryReleasable) geometryReleasableCount += 1;
    const params = gauss.params;
    if (params.centerXPx < 0 || params.centerXPx > SIZE - 1 || params.centerYPx < 0 || params.centerYPx > SIZE - 1) {
      centreOutside += 1;
    }
    if (!(params.amplitudeCounts > 0)) nonpositiveAmplitude += 1;

    const derived = roiRectFromReleasedWidths(result, SIZE, SIZE);
    const rect = derived?.rect;
    if (rect && (rect.width <= 4 || rect.height <= 4)) {
      degenerate.push(
        `seed ${seed}: centre (${roundTo(params.centerXPx, 1)}, ${roundTo(params.centerYPx, 1)}) ` +
          `sigma (${roundTo(params.sigmaMajorPx, 1)}, ${roundTo(params.sigmaMinorPx, 1)}) ` +
          `amplitude ${roundTo(params.amplitudeCounts, 1)} -> ${rect.width}x${rect.height}@${rect.x0},${rect.y0} ` +
          `source ${derived?.source} suppression ${result.moments.suppressionReason}`,
      );
    }
  }

  assert.equal(converged, 2, "converged fits over 40 beam-free frames");
  assert.equal(centreOutside, 2, "both converged fits place the centre off the sensor");
  assert.equal(nonpositiveAmplitude, 1, "one of them has a non-positive amplitude");
  assert.equal(geometryReleasableCount, 0, "no converged beam-free fit carries a releasable geometry");
  assert.deepEqual(degenerate, [
    "seed 18: centre (-67.6, 40.9) sigma (22.4, 5.1) amplitude -28.4 -> 1x128@0,0 source fit-sigma suppression nonpositive_amplitude",
    "seed 36: centre (554.3, 271.6) sigma (62, 22.4) amplitude 0.1 -> 1x128@127,0 source fit-sigma suppression aperture_clipped",
  ]);
});

test("S20 repro: one click from full-frame mode applies a 1x128 strip and bypasses the shrink clamp", () => {
  // A beam that sits far outside the sensor: the fit runs away, converges, and
  // the derivation is happy to use it.
  const pixels = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx = x + 140;
      const dy = y - 64;
      pixels[y * SIZE + x] = 5000 * Math.exp(-(dx * dx + dy * dy) / (2 * 144));
    }
  }
  addGaussianNoise(pixels, 5, 900 + 140 + 12);

  const result = analyzeImage({ pixels, width: SIZE, height: SIZE, dtype: "float32" });
  const params = result.fits.gauss2d.params;
  assert.equal(result.fits.gauss2d.status, "converged");
  assert.equal(result.fits.gauss2d.converged, true);
  assert.ok(params);
  assert.equal(roundTo(params.amplitudeCounts, 1), -1640.5);
  assert.equal(roundTo(params.centerXPx, 1), -7309.3);
  assert.equal(roundTo(params.centerYPx, 1), 2000.1);
  assert.equal(roundTo(params.sigmaMajorPx, 1), 1500.5);
  assert.equal(roundTo(params.sigmaMinorPx, 1), 391.5);
  assert.equal(result.moments.suppressionReason, "nonpositive_amplitude");
  assert.ok(!result.fits.physical, "no physical geometry is derived from this fit");
  // S20 stage F (R-58): converged true, geometry not releasable - the exact
  // pair the guard stage needs, now readable off the result.
  assert.equal(result.fits.gauss2d.geometryReleasable, false);

  // Full-frame mode passes no current rectangle, so the non-shrink clamp never
  // runs: the strip is applied on the first click.
  const click = clickRoiFromFit(result, SIZE, SIZE, "full", null);
  assert.deepEqual(click.applied, { x0: 0, y0: 0, width: 1, height: 128 });
  assert.equal(click.refused, false);
  assert.equal(click.derived?.source, "fit-sigma");

  // And the frame the operator lands on is worse than the one they left.
  assert.ok(click.applied);
  const after = analyzeImage({ pixels, width: SIZE, height: SIZE, dtype: "float32", roi: click.applied });
  assert.equal(after.moments.suppressionReason, "fit_not_converged");
  assert.equal(after.fits.gauss2d.status, "max_iterations");

  // The second click is a dead end too: nothing can be derived any more, so the
  // button simply disappears rather than offering a way back.
  const second = clickRoiFromFit(after, SIZE, SIZE, "rect", click.applied);
  assert.equal(second.applied, null);
  assert.equal(second.refused, false);
  assert.equal(second.derived, null);
});

test("S20 repro: a healthy beam derives its ROI from the released widths and must stay unchanged", () => {
  // The control for the guard stage: this row uses the released-widths branch,
  // which is already guarded, and must produce exactly this rectangle after the
  // fit fallback is tightened.
  const pixels = gaussianSceneF32(SIZE, SIZE, 63.5, 63.5, 9, 6, 0.2, 2000, 0);
  addGaussianNoise(pixels, 5, 20260823);
  const result = analyzeImage({ pixels, width: SIZE, height: SIZE, dtype: "float32" });
  assert.equal(result.moments.suppressionReason, null);
  // S20 stage F (R-58): the healthy control's counterpart pin.
  assert.equal(result.fits.gauss2d.geometryReleasable, true);

  const click = clickRoiFromFit(result, SIZE, SIZE, "full", null);
  assert.equal(click.derived?.source, "d4sigma");
  assert.deepEqual(click.applied, { x0: 0, y0: 17, width: 128, height: 93 });
});
