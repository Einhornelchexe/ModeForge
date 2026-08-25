// S20 repro corpus — the suggested ROI, before and after the padding stage.
//
// BEFORE (stage D3): the workbench's standard call to action is "use the
// suggested ROI". The suggestion was the bounding box of the 4-sigma_B mask
// plus a FIXED 8 px border, independent of beam size, while the clipping gate
// requires the whole 6-sigma check ellipse to fit inside the ROI. For every
// realistic amplitude-to-noise ratio the padded box was far short of 6 sigma,
// so applying the suggestion turned a releasing frame into `aperture_clipped`
// — and the suggestion computed inside that ROI reproduced itself, so it was a
// fixed point, not a step towards one. 15 of 15 noisy scenes were pinned here
// as clipped.
//
// AFTER: the padding is derived per axis from the mask (see the constants
// block in packages/image/src/thresholds.ts). All 15 scenes release, and the
// fixed point still exists but is now a RELEASING one: clicking again changes
// nothing because nothing needs changing.
//
// The suggestion releases nothing by itself — analyzeImage never applies it —
// so none of this moves a released number. What it moves is which rectangle
// the operator is handed.
//
// Runtime: about 82 s (49 full-size analyses on a 512x512 frame).

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeImage } from "../../packages/image/src/analyze.ts";
import { SUGGESTED_ROI_PADDING_PX } from "../../packages/image/src/thresholds.ts";
import { addGaussianNoise, gaussianSceneF32, roundTo } from "./lib/scenes.ts";

const WIDTH = 512;
const HEIGHT = 512;
const CENTRE = 255.5;

type ApplyOutcome = {
  sigmaEstimate: number;
  thresholdCounts: number;
  rect: { x0: number; y0: number; width: number; height: number };
  halfSideInSigma: number;
  paddingXPx: number;
  paddingYPx: number;
  sigmaEstXPx: number;
  sigmaEstYPx: number;
  clampedToImage: boolean;
  fitSigmaMajor: number;
  checkEllipseInside: boolean;
  suppression: string | null;
};

// Pass 1 is the full frame (what the operator sees first); pass 2 applies the
// suggestion verbatim, exactly as the button does.
function suggestThenApply(
  sigma1: number,
  sigma2: number,
  thetaRad: number,
  amplitude: number,
  sigmaB: number,
  seed: number,
): ApplyOutcome {
  const pixels = gaussianSceneF32(WIDTH, HEIGHT, CENTRE, CENTRE, sigma1, sigma2, thetaRad, amplitude, 0);
  if (sigmaB > 0) addGaussianNoise(pixels, sigmaB, seed);

  const first = analyzeImage({ pixels, width: WIDTH, height: HEIGHT, dtype: "float32" });
  const suggestion = first.roi.suggestion;
  assert.notEqual(suggestion, null, "the scene must produce a suggestion");
  if (!suggestion) throw new Error("unreachable");

  const second = analyzeImage({
    pixels,
    width: WIDTH,
    height: HEIGHT,
    dtype: "float32",
    roi: suggestion.rect,
  });
  return {
    sigmaEstimate: roundTo(first.noise.sigmaCounts, 3),
    thresholdCounts: roundTo(suggestion.thresholdCounts, 3),
    rect: suggestion.rect,
    halfSideInSigma: roundTo((suggestion.rect.width - 1) / 2 / sigma1, 2),
    paddingXPx: suggestion.paddingXPx,
    paddingYPx: suggestion.paddingYPx,
    sigmaEstXPx: roundTo(suggestion.sigmaEstXPx ?? Number.NaN, 3),
    sigmaEstYPx: roundTo(suggestion.sigmaEstYPx ?? Number.NaN, 3),
    clampedToImage: suggestion.clampedToImage,
    fitSigmaMajor: roundTo(second.fits.gauss2d.params?.sigmaMajorPx ?? Number.NaN, 3),
    checkEllipseInside: second.aperture.gates.clipping.checkEllipseInside,
    suppression: second.moments.suppressionReason,
  };
}

// The old->new ledger. `was` is the pin this file carried before stage D3,
// when every one of these rows ended in `aperture_clipped`.
const APPLY_SET: {
  label: string;
  sigma1: number;
  sigma2: number;
  thetaRad: number;
  sigmaB: number;
  seed: number;
  was: { rect: { x0: number; y0: number; width: number; height: number }; halfSideInSigma: number };
  expected: Omit<ApplyOutcome, "checkEllipseInside" | "suppression">;
}[] = [
  // Circular sigma 10.
  { label: "sigma 10, A/sigmaB 1000", sigma1: 10, sigma2: 10, thetaRad: 0, sigmaB: 1, seed: 12345,
    was: { rect: { x0: 214, y0: 214, width: 84, height: 84 }, halfSideInSigma: 4.15 },
    expected: { sigmaEstimate: 1.008, thresholdCounts: 4.033, rect: { x0: 154, y0: 154, width: 204, height: 204 }, halfSideInSigma: 10.15, paddingXPx: 68, paddingYPx: 68, sigmaEstXPx: 10.249, sigmaEstYPx: 10.249, clampedToImage: false, fitSigmaMajor: 10.001 } },
  { label: "sigma 10, A/sigmaB 300", sigma1: 10, sigma2: 10, thetaRad: 0, sigmaB: 1000 / 300, seed: 12345,
    was: { rect: { x0: 217, y0: 218, width: 77, height: 77 }, halfSideInSigma: 3.8 },
    expected: { sigmaEstimate: 3.36, thresholdCounts: 13.442, rect: { x0: 164, y0: 165, width: 183, height: 183 }, halfSideInSigma: 9.1, paddingXPx: 61, paddingYPx: 61, sigmaEstXPx: 10.398, sigmaEstYPx: 10.398, clampedToImage: false, fitSigmaMajor: 10.002 } },
  { label: "sigma 10, A/sigmaB 100", sigma1: 10, sigma2: 10, thetaRad: 0, sigmaB: 10, seed: 12345,
    was: { rect: { x0: 222, y0: 221, width: 69, height: 69 }, halfSideInSigma: 3.4 },
    expected: { sigmaEstimate: 10.081, thresholdCounts: 40.325, rect: { x0: 177, y0: 176, width: 159, height: 159 }, halfSideInSigma: 7.9, paddingXPx: 53, paddingYPx: 53, sigmaEstXPx: 10.468, sigmaEstYPx: 10.468, clampedToImage: false, fitSigmaMajor: 10.007 } },
  { label: "sigma 10, A/sigmaB 50", sigma1: 10, sigma2: 10, thetaRad: 0, sigmaB: 20, seed: 12345,
    was: { rect: { x0: 225, y0: 224, width: 62, height: 63 }, halfSideInSigma: 3.05 },
    expected: { sigmaEstimate: 20.163, thresholdCounts: 80.651, rect: { x0: 179, y0: 176, width: 154, height: 159 }, halfSideInSigma: 7.65, paddingXPx: 54, paddingYPx: 56, sigmaEstXPx: 10.244, sigmaEstYPx: 10.467, clampedToImage: false, fitSigmaMajor: 10.013 } },
  { label: "sigma 10, A/sigmaB 20", sigma1: 10, sigma2: 10, thetaRad: 0, sigmaB: 50, seed: 12345,
    was: { rect: { x0: 230, y0: 229, width: 53, height: 54 }, halfSideInSigma: 2.6 },
    expected: { sigmaEstimate: 50.407, thresholdCounts: 201.627, rect: { x0: 179, y0: 176, width: 155, height: 160 }, halfSideInSigma: 7.7, paddingXPx: 59, paddingYPx: 61, sigmaEstXPx: 10.302, sigmaEstYPx: 10.58, clampedToImage: false, fitSigmaMajor: 10.033 } },
  { label: "sigma 10, A/sigmaB 10", sigma1: 10, sigma2: 10, thetaRad: 0, sigmaB: 100, seed: 12345,
    was: { rect: { x0: 234, y0: 233, width: 45, height: 46 }, halfSideInSigma: 2.2 },
    expected: { sigmaEstimate: 100.813, thresholdCounts: 403.253, rect: { x0: 178, y0: 175, width: 157, height: 162 }, halfSideInSigma: 7.8, paddingXPx: 64, paddingYPx: 66, sigmaEstXPx: 10.384, sigmaEstYPx: 10.742, clampedToImage: false, fitSigmaMajor: 10.064 } },
  // Elliptical sigma 10/5 at 45 degrees.
  { label: "sigma 10x5 at 45 deg, A/sigmaB 1000", sigma1: 10, sigma2: 5, thetaRad: Math.PI / 4, sigmaB: 1, seed: 998877,
    was: { rect: { x0: 221, y0: 220, width: 71, height: 71 }, halfSideInSigma: 3.5 },
    expected: { sigmaEstimate: 0.993, thresholdCounts: 3.97, rect: { x0: 174, y0: 173, width: 165, height: 165 }, halfSideInSigma: 8.2, paddingXPx: 55, paddingYPx: 55, sigmaEstXPx: 8.284, sigmaEstYPx: 8.284, clampedToImage: false, fitSigmaMajor: 10 } },
  { label: "sigma 10x5 at 45 deg, A/sigmaB 100", sigma1: 10, sigma2: 5, thetaRad: Math.PI / 4, sigmaB: 10, seed: 998877,
    was: { rect: { x0: 227, y0: 228, width: 59, height: 57 }, halfSideInSigma: 2.9 },
    expected: { sigmaEstimate: 9.926, thresholdCounts: 39.704, rect: { x0: 192, y0: 195, width: 129, height: 123 }, halfSideInSigma: 6.4, paddingXPx: 43, paddingYPx: 41, sigmaEstXPx: 8.479, sigmaEstYPx: 8.085, clampedToImage: false, fitSigmaMajor: 10.004 } },
  { label: "sigma 10x5 at 45 deg, A/sigmaB 20", sigma1: 10, sigma2: 5, thetaRad: Math.PI / 4, sigmaB: 50, seed: 998877,
    was: { rect: { x0: 234, y0: 233, width: 44, height: 46 }, halfSideInSigma: 2.15 },
    expected: { sigmaEstimate: 49.63, thresholdCounts: 198.521, rect: { x0: 197, y0: 193, width: 118, height: 126 }, halfSideInSigma: 5.85, paddingXPx: 45, paddingYPx: 48, sigmaEstXPx: 7.734, sigmaEstYPx: 8.287, clampedToImage: false, fitSigmaMajor: 10.016 } },
  // Small beam: the fixed 8 px border was comparatively large and still short.
  { label: "sigma 3, A/sigmaB 1000", sigma1: 3, sigma2: 3, thetaRad: 0, sigmaB: 1, seed: 4242,
    was: { rect: { x0: 238, y0: 238, width: 36, height: 36 }, halfSideInSigma: 5.83 },
    expected: { sigmaEstimate: 1.004, thresholdCounts: 4.015, rect: { x0: 226, y0: 226, width: 60, height: 60 }, halfSideInSigma: 9.83, paddingXPx: 20, paddingYPx: 20, sigmaEstXPx: 3.049, sigmaEstYPx: 3.049, clampedToImage: false, fitSigmaMajor: 3.001 } },
  { label: "sigma 3, A/sigmaB 100", sigma1: 3, sigma2: 3, thetaRad: 0, sigmaB: 10, seed: 4242,
    was: { rect: { x0: 240, y0: 240, width: 32, height: 32 }, halfSideInSigma: 5.17 },
    expected: { sigmaEstimate: 10.039, thresholdCounts: 40.154, rect: { x0: 231, y0: 231, width: 50, height: 50 }, halfSideInSigma: 8.17, paddingXPx: 17, paddingYPx: 17, sigmaEstXPx: 3.223, sigmaEstYPx: 3.223, clampedToImage: false, fitSigmaMajor: 3.012 } },
  { label: "sigma 3, A/sigmaB 20", sigma1: 3, sigma2: 3, thetaRad: 0, sigmaB: 50, seed: 4242,
    was: { rect: { x0: 243, y0: 243, width: 26, height: 26 }, halfSideInSigma: 4.17 },
    expected: { sigmaEstimate: 50.193, thresholdCounts: 200.771, rect: { x0: 234, y0: 234, width: 44, height: 44 }, halfSideInSigma: 7.17, paddingXPx: 17, paddingYPx: 17, sigmaEstXPx: 2.896, sigmaEstYPx: 2.896, clampedToImage: false, fitSigmaMajor: 3.053 } },
  // Large beam: the border was negligible against the beam.
  { label: "sigma 25, A/sigmaB 1000", sigma1: 25, sigma2: 25, thetaRad: 0, sigmaB: 1, seed: 777,
    was: { rect: { x0: 163, y0: 163, width: 186, height: 185 }, halfSideInSigma: 3.7 },
    expected: { sigmaEstimate: 0.999, thresholdCounts: 3.996, rect: { x0: 1, y0: 2, width: 510, height: 507 }, halfSideInSigma: 10.18, paddingXPx: 170, paddingYPx: 169, sigmaEstXPx: 25.58, sigmaEstYPx: 25.429, clampedToImage: false, fitSigmaMajor: 25.001 } },
  { label: "sigma 25, A/sigmaB 100", sigma1: 25, sigma2: 25, thetaRad: 0, sigmaB: 10, seed: 777,
    was: { rect: { x0: 183, y0: 182, width: 147, height: 148 }, halfSideInSigma: 2.92 },
    expected: { sigmaEstimate: 9.991, thresholdCounts: 39.964, rect: { x0: 60, y0: 58, width: 393, height: 396 }, halfSideInSigma: 7.84, paddingXPx: 131, paddingYPx: 132, sigmaEstXPx: 25.81, sigmaEstYPx: 26.007, clampedToImage: false, fitSigmaMajor: 25.007 } },
  { label: "sigma 25, A/sigmaB 20", sigma1: 25, sigma2: 25, thetaRad: 0, sigmaB: 50, seed: 777,
    was: { rect: { x0: 200, y0: 201, width: 109, height: 110 }, halfSideInSigma: 2.16 },
    expected: { sigmaEstimate: 49.956, thresholdCounts: 199.822, rect: { x0: 61, y0: 60, width: 387, height: 392 }, halfSideInSigma: 7.72, paddingXPx: 147, paddingYPx: 149, sigmaEstXPx: 25.748, sigmaEstYPx: 26.025, clampedToImage: false, fitSigmaMajor: 25.033 } },
];

test("S20 repro: applying the suggested ROI now releases on 0 of 15 clipped scenes", () => {
  let clipped = 0;
  for (const scene of APPLY_SET) {
    const outcome = suggestThenApply(scene.sigma1, scene.sigma2, scene.thetaRad, 1000, scene.sigmaB, scene.seed);
    // The scene itself is untouched: the noise scale and the mask threshold
    // are bit-identical to the pre-D3 pins, so only the padding moved.
    assert.equal(outcome.sigmaEstimate, scene.expected.sigmaEstimate, `sigma estimate for ${scene.label}`);
    assert.equal(outcome.thresholdCounts, scene.expected.thresholdCounts, `mask threshold for ${scene.label}`);
    assert.deepEqual(outcome.rect, scene.expected.rect, `suggested rectangle for ${scene.label}`);
    assert.equal(outcome.halfSideInSigma, scene.expected.halfSideInSigma, `half side in sigma for ${scene.label}`);
    assert.equal(outcome.paddingXPx, scene.expected.paddingXPx, `x padding for ${scene.label}`);
    assert.equal(outcome.paddingYPx, scene.expected.paddingYPx, `y padding for ${scene.label}`);
    assert.equal(outcome.sigmaEstXPx, scene.expected.sigmaEstXPx, `x sigma estimate for ${scene.label}`);
    assert.equal(outcome.sigmaEstYPx, scene.expected.sigmaEstYPx, `y sigma estimate for ${scene.label}`);
    // Every row of the apply set got the aperture it asked for. This is not a
    // formality on the widest row: sigma 25 at A/sigmaB 1000 lands at 510 px of
    // a 512 px frame, the measured worst case of the mask floor's cost, and it
    // is asserted unclamped rather than described as such.
    assert.equal(outcome.clampedToImage, scene.expected.clampedToImage, `clamp for ${scene.label}`);
    assert.equal(outcome.fitSigmaMajor, scene.expected.fitSigmaMajor, `fitted sigma for ${scene.label}`);
    assert.equal(outcome.checkEllipseInside, true, `check ellipse must fit for ${scene.label}`);
    assert.equal(outcome.suppression, null, `verdict for ${scene.label}`);
    // The ledger: every row grew, and every row was short of 6 sigma before.
    assert.ok(scene.was.halfSideInSigma < 6, `ledger: ${scene.label} used to be short of 6 sigma`);
    assert.ok(
      outcome.rect.width > scene.was.rect.width && outcome.rect.height > scene.was.rect.height,
      `ledger: ${scene.label} must be wider than the pre-D3 rectangle`,
    );
    // R-19's criterion is "half side >= 6.25 sigma_fit OR clamped at the
    // binding image edge". For a CIRCULAR beam the axis-aligned half extent of
    // the check ellipse is 6 * sigma_fit, so the criterion is the literal one.
    // For the rotated 10x5 family it is not: the gate tests
    // sqrt((6*a*cos)^2 + (6*b*sin)^2), which at 45 degrees is 6 * 7.906 = 47.4
    // px against a sigma_major of 10 — so the row whose half side is only 5.84
    // sigma_major sits comfortably inside the ellipse the gate actually
    // checks. Each family is held to the quantity that binds it.
    const halfSideOverSigmaFit = (outcome.rect.width - 1) / 2 / outcome.fitSigmaMajor;
    if (scene.sigma1 === scene.sigma2) {
      assert.ok(
        halfSideOverSigmaFit >= 6.25,
        `${scene.label}: half side ${roundTo(halfSideOverSigmaFit, 3)} sigma_fit must clear 6.25`,
      );
    }
    if (outcome.suppression === "aperture_clipped") clipped += 1;
  }
  assert.equal(clipped, 0, "no row of the apply set clips any more");
});

test("S20 repro: the noise-free scene keeps the fixed border and its exact rectangle", () => {
  // With sigma_B estimated as zero the mask threshold is zero, the inversion
  // has nothing to divide by, and the guard hands the axis back the base
  // border. This row is byte-identical to its pre-D3 pin — the guard, not luck.
  const outcome = suggestThenApply(10, 10, 0, 1000, 0, 1);
  assert.equal(outcome.sigmaEstimate, 0);
  assert.equal(outcome.thresholdCounts, 0);
  assert.deepEqual(outcome.rect, { x0: 99, y0: 99, width: 314, height: 314 });
  assert.equal(outcome.halfSideInSigma, 15.65);
  assert.equal(outcome.paddingXPx, SUGGESTED_ROI_PADDING_PX);
  assert.equal(outcome.paddingYPx, SUGGESTED_ROI_PADDING_PX);
  assert.ok(Number.isNaN(outcome.sigmaEstXPx), "no sigma estimate without a threshold");
  assert.ok(Number.isNaN(outcome.sigmaEstYPx), "no sigma estimate without a threshold");
  assert.equal(outcome.clampedToImage, false);
  assert.equal(outcome.checkEllipseInside, true);
  assert.equal(outcome.suppression, null);
});

test("S20 repro: the suggestion is still a fixed point, and now it is a releasing one", () => {
  // Pre-D3 this test recorded the defect: the full frame released, applying
  // the suggestion suppressed as `aperture_clipped`, and re-running inside
  // that ROI reproduced the same rectangle — a fixed point the operator was
  // parked on. The fixed point survives, because a suggestion that reproduces
  // itself is what convergence looks like; what changed is that it releases.
  const pixels = gaussianSceneF32(WIDTH, HEIGHT, CENTRE, CENTRE, 10, 10, 0, 1000, 0);
  addGaussianNoise(pixels, 1, 20260820);

  const first = analyzeImage({ pixels, width: WIDTH, height: HEIGHT, dtype: "float32" });
  const firstRect = first.roi.suggestion?.rect;
  assert.ok(firstRect);
  // was { x0: 214, y0: 214, width: 84, height: 85 } under the fixed border.
  assert.deepEqual(firstRect, { x0: 154, y0: 153, width: 204, height: 207 });
  assert.equal(first.moments.suppressionReason, null, "the full frame releases");

  const second = analyzeImage({ pixels, width: WIDTH, height: HEIGHT, dtype: "float32", roi: firstRect });
  assert.equal(second.moments.suppressionReason, null, "applying it keeps releasing");
  const secondRect = second.roi.suggestion?.rect;
  assert.ok(secondRect);
  assert.deepEqual(secondRect, firstRect, "the suggestion reproduces itself");

  const third = analyzeImage({ pixels, width: WIDTH, height: HEIGHT, dtype: "float32", roi: secondRect });
  assert.equal(third.moments.suppressionReason, null, "and again");
  assert.deepEqual(third.roi.suggestion?.rect, firstRect, "a third click still changes nothing");
});

// ── R-18: the non-Gaussian family at A/sigma_B = 1e4 ──────────────────────
//
// The Gaussian inversion reads the mask EDGE. A profile whose edge is steeper
// than a Gaussian's therefore reports a sigma far below the one a Gaussian fit
// puts through the same profile, and at high dynamic range the gap widens with
// sqrt(2*ln(peak/threshold)). The mask floor exists for exactly this family:
// it scales with the lit area, which is measured, instead of with a shape,
// which is assumed.
//
// Note what these rows do NOT claim. Only the Gaussian control releases; the
// others are suppressed as `residual_high` or `fit_not_converged`, because a
// Gaussian fit is not a description of them. That verdict is correct and no
// rectangle changes it. What the padding owes them is that the SUGGESTION is
// not the reason they fail — the 6-sigma check ellipse has to fit.

const SIGMA_B_1E4 = 0.1; // amplitude 1000 over this is A/sigma_B = 1e4
const NON_GAUSS_SEED = 20260824;

function superGaussScene(sigma: number, order: number): Float32Array {
  const out = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const dx = x - CENTRE;
      const dy = y - CENTRE;
      out[x + y * WIDTH] = 1000 * Math.exp(-Math.pow((dx * dx + dy * dy) / (2 * sigma * sigma), order));
    }
  }
  return out;
}

// Top hat of the given radius with a tanh edge of the given scale. edge -> 0
// is the discontinuous limit; a real flat-top beam has a finite edge.
function flatTopScene(radius: number, edge: number): Float32Array {
  const out = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const dx = x - CENTRE;
      const dy = y - CENTRE;
      const r = Math.sqrt(dx * dx + dy * dy);
      out[x + y * WIDTH] = 1000 * 0.5 * (1 - Math.tanh((r - radius) / edge));
    }
  }
  return out;
}

function ringScene(inner: number, outer: number): Float32Array {
  const out = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const dx = x - CENTRE;
      const dy = y - CENTRE;
      const r2 = dx * dx + dy * dy;
      out[x + y * WIDTH] = r2 <= outer * outer && r2 >= inner * inner ? 1000 : 0;
    }
  }
  return out;
}

function applyToScene(pixels: Float32Array, sigmaB: number, seed: number) {
  if (sigmaB > 0) addGaussianNoise(pixels, sigmaB, seed);
  const first = analyzeImage({ pixels, width: WIDTH, height: HEIGHT, dtype: "float32" });
  const suggestion = first.roi.suggestion;
  assert.ok(suggestion, "the scene must produce a suggestion");
  const second = analyzeImage({ pixels, width: WIDTH, height: HEIGHT, dtype: "float32", roi: suggestion.rect });
  const sigmaFit = second.fits.gauss2d.params?.sigmaMajorPx ?? Number.NaN;
  return {
    rect: suggestion.rect,
    paddingXPx: suggestion.paddingXPx,
    paddingYPx: suggestion.paddingYPx,
    sigmaEstXPx: roundTo(suggestion.sigmaEstXPx ?? Number.NaN, 3),
    sigmaEstYPx: roundTo(suggestion.sigmaEstYPx ?? Number.NaN, 3),
    clampedToImage: suggestion.clampedToImage,
    sigmaFit: roundTo(sigmaFit, 3),
    halfSideOverSigmaFit: roundTo((suggestion.rect.width - 1) / 2 / sigmaFit, 3),
    checkEllipseInside: second.aperture.gates.clipping.checkEllipseInside,
    suppression: second.moments.suppressionReason,
    fullFrameSuppression: first.moments.suppressionReason,
  };
}

test("S20 repro: the non-Gaussian family at A/sigma_B 1e4 is served by the mask floor", () => {
  const rows: {
    label: string;
    pixels: Float32Array;
    rect: { x0: number; y0: number; width: number; height: number };
    paddingXPx: number;
    paddingYPx: number;
    sigmaEstXPx: number;
    sigmaEstYPx: number;
    sigmaFit: number;
    halfSideOverSigmaFit: number;
    checkEllipseInside: boolean;
    suppression: string | null;
  }[] = [
    // Control: on a true Gaussian the aperture term is what binds below
    // A/sigma_B about 91, and the floor above it. Either way the shape the
    // inversion assumes is the shape that is there.
    {
      label: "Gaussian sigma 10 (control)",
      pixels: gaussianSceneF32(WIDTH, HEIGHT, CENTRE, CENTRE, 10, 10, 0, 1000, 0),
      rect: { x0: 136, y0: 134, width: 240, height: 243 },
      paddingXPx: 80, paddingYPx: 81, sigmaEstXPx: 10.122, sigmaEstYPx: 10.249,
      sigmaFit: 10, halfSideOverSigmaFit: 11.95, checkEllipseInside: true, suppression: null,
    },
    // sigmaEst 6.07 against a fitted 8.77: the inversion under-reads by 31 %.
    // The aperture term alone would have asked for 22 px of padding; the floor
    // asks for 48 and is what carries the check ellipse inside.
    {
      label: "super-Gauss n=2, sigma 10",
      pixels: superGaussScene(10, 2),
      rect: { x0: 184, y0: 184, width: 144, height: 144 },
      paddingXPx: 48, paddingYPx: 48, sigmaEstXPx: 6.069, sigmaEstYPx: 6.069,
      sigmaFit: 8.77, halfSideOverSigmaFit: 8.153, checkEllipseInside: true, suppression: "residual_high",
    },
    // Steeper still: sigmaEst 4.68 against a fitted 8.65, an under-read of 46 %.
    {
      label: "super-Gauss n=4, sigma 10",
      pixels: superGaussScene(10, 4),
      rect: { x0: 200, y0: 202, width: 111, height: 108 },
      paddingXPx: 37, paddingYPx: 36, sigmaEstXPx: 4.678, sigmaEstYPx: 4.551,
      sigmaFit: 8.65, halfSideOverSigmaFit: 6.358, checkEllipseInside: true, suppression: "residual_high",
    },
    // A physically realizable flat top: radius 30 with a 3 px edge.
    {
      label: "flat top, radius 30, 3 px edge",
      pixels: flatTopScene(30, 3),
      rect: { x0: 128, y0: 128, width: 255, height: 255 },
      paddingXPx: 85, paddingYPx: 85, sigmaEstXPx: 10.746, sigmaEstYPx: 10.746,
      sigmaFit: 19.188, halfSideOverSigmaFit: 6.619, checkEllipseInside: true, suppression: "residual_high",
    },
    // The ring is the documented limit of the whole approach. Its Gaussian fit
    // does not converge, and the sigma it reports on the way out (26.6) is
    // larger than the ring's own lit radius (30) is wide — a model artefact,
    // not a beam size. A criterion built on that number cannot be met by any
    // padding, and the honest verdict is the one the analyzer already gives.
    {
      label: "ring, inner 20 outer 30",
      pixels: ringScene(20, 30),
      rect: { x0: 166, y0: 166, width: 180, height: 180 },
      paddingXPx: 60, paddingYPx: 60, sigmaEstXPx: 7.586, sigmaEstYPx: 7.586,
      sigmaFit: 26.561, halfSideOverSigmaFit: 3.37, checkEllipseInside: false, suppression: "fit_not_converged",
    },
  ];

  for (const row of rows) {
    const outcome = applyToScene(row.pixels, SIGMA_B_1E4, NON_GAUSS_SEED);
    assert.deepEqual(outcome.rect, row.rect, `rectangle for ${row.label}`);
    assert.equal(outcome.paddingXPx, row.paddingXPx, `x padding for ${row.label}`);
    assert.equal(outcome.paddingYPx, row.paddingYPx, `y padding for ${row.label}`);
    assert.equal(outcome.sigmaEstXPx, row.sigmaEstXPx, `x sigma estimate for ${row.label}`);
    assert.equal(outcome.sigmaEstYPx, row.sigmaEstYPx, `y sigma estimate for ${row.label}`);
    assert.equal(outcome.clampedToImage, false, `nothing clamps for ${row.label}`);
    assert.equal(outcome.sigmaFit, row.sigmaFit, `fitted sigma for ${row.label}`);
    assert.equal(outcome.halfSideOverSigmaFit, row.halfSideOverSigmaFit, `half side in sigma_fit for ${row.label}`);
    assert.equal(outcome.checkEllipseInside, row.checkEllipseInside, `clipping gate for ${row.label}`);
    assert.equal(outcome.suppression, row.suppression, `verdict for ${row.label}`);
  }

  // Everything the Gaussian fit can still describe clears R-19's criterion.
  for (const row of rows) {
    if (row.label.startsWith("ring")) continue;
    assert.ok(row.halfSideOverSigmaFit >= 6.25, `${row.label} must clear 6.25 sigma_fit`);
  }
});

// ── R-19: the edge beam, where the clamp binds and the suppression is honest ──

test("S20 repro: a beam against the frame edge stays aperture_clipped, and the clamp says why", () => {
  // The suggestion asks for its full aperture and the frame refuses. The
  // important part is the control column: the FULL FRAME is clipped too. The
  // beam sits closer to the image edge than 6 sigma_fit, so no rectangle
  // inside this image can hold the check ellipse, the suggestion included.
  // `aperture_clipped` here is a statement about the scene, and
  // `clampedToImage` is the suggestion admitting it could not fix it.
  const rows: {
    centreX: number;
    rect: { x0: number; y0: number; width: number; height: number };
    paddingXPx: number;
    paddingYPx: number;
    sigmaEstXPx: number;
    sigmaEstYPx: number;
  }[] = [
    { centreX: 20, rect: { x0: 0, y0: 154, width: 110, height: 204 }, paddingXPx: 55, paddingYPx: 68, sigmaEstXPx: 8.316, sigmaEstYPx: 10.281 },
    { centreX: 40, rect: { x0: 0, y0: 153, width: 142, height: 207 }, paddingXPx: 68, paddingYPx: 69, sigmaEstXPx: 10.267, sigmaEstYPx: 10.418 },
  ];

  for (const row of rows) {
    const pixels = gaussianSceneF32(WIDTH, HEIGHT, row.centreX, CENTRE, 10, 10, 0, 1000, 0);
    const outcome = applyToScene(pixels, 1, NON_GAUSS_SEED);
    assert.deepEqual(outcome.rect, row.rect, `rectangle at centre x ${row.centreX}`);
    assert.equal(outcome.paddingXPx, row.paddingXPx, `x padding at centre x ${row.centreX}`);
    assert.equal(outcome.paddingYPx, row.paddingYPx, `y padding at centre x ${row.centreX}`);
    assert.equal(outcome.sigmaEstXPx, row.sigmaEstXPx, `x sigma estimate at centre x ${row.centreX}`);
    assert.equal(outcome.sigmaEstYPx, row.sigmaEstYPx, `y sigma estimate at centre x ${row.centreX}`);
    assert.equal(outcome.clampedToImage, true, `the clamp must bind at centre x ${row.centreX}`);
    assert.equal(outcome.rect.x0, 0, `the rectangle runs into the frame at centre x ${row.centreX}`);
    assert.equal(outcome.checkEllipseInside, false, `the check ellipse cannot fit at centre x ${row.centreX}`);
    assert.equal(outcome.suppression, "aperture_clipped", `verdict at centre x ${row.centreX}`);
    assert.equal(
      outcome.fullFrameSuppression,
      "aperture_clipped",
      `the full frame is clipped too at centre x ${row.centreX}, so the suggestion is not the cause`,
    );
  }
});
