// S20 repro corpus — where the suggestion starts to work.
//
// BEFORE (stage D3): the 4-sigma_B mask edge of a Gaussian sits at
// r = sigma * sqrt(2 * ln(A / (4 * sigma_B))). With a FIXED border of 8 px the
// suggested half side reached 6 sigma only when
// sigma * sqrt(2 * ln(A / (4 * sigma_B))) + 8 >= 6 * sigma, i.e. when
// A / sigma_B >= 4 * exp((6 - 8/sigma)^2 / 2). The demand grew without bound in
// the beam size, because the border was a constant while the shortfall scaled
// with sigma: at sigma = 10 px it asked for A/sigma_B ~ 3e6 and the engine only
// released from 1e7.
//
// AFTER: the padding is derived from the mask per axis, so the ratio the
// suggestion needs no longer depends on the beam size at all — the crossing is
// gone from both series. The closed form is kept below because it is the
// statement of the defect; the engine tables underneath are the measurement.
//
// Reduction against the source sweep: the sigma-3 series drops its 10000 row
// and the sigma-10 series drops 1e5 and 1e6 (all three sit inside a run of
// identical verdicts and add no crossing information). 22 analyses remain.
//
// Runtime: about 34 s.

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeImage } from "../../packages/image/src/analyze.ts";
import { addGaussianNoise, gaussianSceneF32, roundTo } from "./lib/scenes.ts";

const WIDTH = 512;
const HEIGHT = 512;
const CENTRE = 255.5;
const AMPLITUDE = 1000;
const SEED = 4242;

// Minimum amplitude-to-noise ratio for a padded 4-sigma_B box with a FIXED 8 px
// border to reach the 6-sigma check ellipse. Below sigma = 4/3 px the border
// alone already covers it, so the formula returns the mask constant itself.
// This is the pre-D3 law and is kept as the record of what was wrong.
function requiredRatio(sigma: number): number {
  const t = 6 - 8 / sigma;
  if (t <= 0) return 4;
  return 4 * Math.exp((t * t) / 2);
}

function applySuggestion(sigma: number, ratio: number): {
  rect: { x0: number; y0: number; width: number; height: number };
  paddingXPx: number;
  paddingYPx: number;
  sigmaEstXPx: number;
  halfSideInSigma: number;
  halfSideOverSigmaFit: number;
  suppression: string | null;
  d4Major: number;
} {
  const pixels = gaussianSceneF32(WIDTH, HEIGHT, CENTRE, CENTRE, sigma, sigma, 0, AMPLITUDE, 0);
  addGaussianNoise(pixels, AMPLITUDE / ratio, SEED);
  const first = analyzeImage({ pixels, width: WIDTH, height: HEIGHT, dtype: "float32" });
  const suggestion = first.roi.suggestion;
  assert.notEqual(suggestion, null);
  if (!suggestion) throw new Error("unreachable");
  const second = analyzeImage({
    pixels,
    width: WIDTH,
    height: HEIGHT,
    dtype: "float32",
    roi: suggestion.rect,
  });
  const sigmaFit = second.fits.gauss2d.params?.sigmaMajorPx ?? Number.NaN;
  return {
    rect: suggestion.rect,
    paddingXPx: suggestion.paddingXPx,
    paddingYPx: suggestion.paddingYPx,
    sigmaEstXPx: roundTo(suggestion.sigmaEstXPx ?? Number.NaN, 3),
    halfSideInSigma: roundTo((suggestion.rect.width - 1) / 2 / sigma, 2),
    halfSideOverSigmaFit: roundTo((suggestion.rect.width - 1) / 2 / sigmaFit, 3),
    suppression: second.moments.suppressionReason,
    d4Major: roundTo(second.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 3),
  };
}

test("S20 repro: the closed form for the ratio a fixed 8 px border needed", () => {
  const expected: [number, string][] = [
    [1, "4.000e+0"],
    [2, "2.956e+1"],
    [3, "1.035e+3"],
    [4, "1.192e+4"],
    [6, "2.143e+5"],
    [10, "2.977e+6"],
    [15, "1.234e+7"],
    [25, "4.053e+7"],
    [50, "1.019e+8"],
  ];
  for (const [sigma, value] of expected) {
    assert.equal(requiredRatio(sigma).toExponential(3), value, `required ratio at sigma ${sigma}`);
  }
  // The shape of the problem: the demand grew without bound in the beam size,
  // because the border was a constant while the shortfall scaled with sigma.
  assert.ok(requiredRatio(50) / requiredRatio(10) > 30);
});

test("S20 repro: at sigma 3 the crossing is gone — every row releases", () => {
  // Pre-D3 the closed form predicted a crossing at 1.035e3 and the engine put
  // it between 1500 (clipped) and 3000 (released). The `was` column is that
  // pin. After D3 the derived padding tracks the beam, so the whole series
  // releases, including the 100 row that the old border never reached.
  const rows: {
    ratio: number;
    was: { width: number; halfSideInSigma: number; suppression: string | null };
    width: number;
    height: number;
    paddingXPx: number;
    sigmaEstXPx: number;
    halfSideInSigma: number;
    halfSideOverSigmaFit: number;
    suppression: string | null;
    d4: number;
  }[] = [
    { ratio: 100, was: { width: 32, halfSideInSigma: 5.17, suppression: "aperture_clipped" },
      width: 50, height: 50, paddingXPx: 17, sigmaEstXPx: 3.223, halfSideInSigma: 8.17, halfSideOverSigmaFit: 8.135, suppression: null, d4: 12.27 },
    { ratio: 500, was: { width: 35, halfSideInSigma: 5.67, suppression: "aperture_clipped" },
      width: 57, height: 57, paddingXPx: 19, sigmaEstXPx: 3.103, halfSideInSigma: 9.33, halfSideOverSigmaFit: 9.326, suppression: null, d4: 12.035 },
    { ratio: 1000, was: { width: 36, halfSideInSigma: 5.83, suppression: "aperture_clipped" },
      width: 60, height: 60, paddingXPx: 20, sigmaEstXPx: 3.049, halfSideInSigma: 9.83, halfSideOverSigmaFit: 9.83, suppression: null, d4: 12.009 },
    { ratio: 1500, was: { width: 38, halfSideInSigma: 6.17, suppression: "aperture_clipped" },
      width: 66, height: 63, paddingXPx: 22, sigmaEstXPx: 3.234, halfSideInSigma: 10.83, halfSideOverSigmaFit: 10.831, suppression: null, d4: 12 },
    { ratio: 3000, was: { width: 38, halfSideInSigma: 6.17, suppression: null },
      width: 66, height: 66, paddingXPx: 22, sigmaEstXPx: 3.056, halfSideInSigma: 10.83, halfSideOverSigmaFit: 10.832, suppression: null, d4: 11.991 },
  ];
  for (const row of rows) {
    const outcome = applySuggestion(3, row.ratio);
    assert.equal(outcome.rect.width, row.width, `suggested width at ratio ${row.ratio}`);
    assert.equal(outcome.rect.height, row.height, `suggested height at ratio ${row.ratio}`);
    assert.equal(outcome.paddingXPx, row.paddingXPx, `x padding at ratio ${row.ratio}`);
    assert.equal(outcome.sigmaEstXPx, row.sigmaEstXPx, `x sigma estimate at ratio ${row.ratio}`);
    assert.equal(outcome.halfSideInSigma, row.halfSideInSigma, `half side at ratio ${row.ratio}`);
    assert.equal(outcome.halfSideOverSigmaFit, row.halfSideOverSigmaFit, `half side in sigma_fit at ratio ${row.ratio}`);
    assert.ok(outcome.halfSideOverSigmaFit >= 6.25, `half side must clear 6.25 sigma_fit at ratio ${row.ratio}`);
    assert.equal(outcome.suppression, row.suppression, `verdict at ratio ${row.ratio}`);
    assert.equal(outcome.d4Major, row.d4, `released d4 at ratio ${row.ratio}`);
    // The ledger, stated exactly. The 3000 row released before D3 as well, and
    // its d4 moved: 11.989 -> 11.991. That is not the suggestion changing a
    // measurement — for a FIXED ROI every released number here is bit
    // identical, which the rest of the suite pins. It is the operator being
    // handed a different rectangle, and the number measured inside the wider
    // one sits closer to the analytic 4*sigma = 12.000 of this scene, not
    // further from it.
    if (row.ratio === 3000) {
      assert.equal(outcome.d4Major, 11.991, "the widened ROI measures 11.991");
      assert.ok(
        Math.abs(outcome.d4Major - 12) < Math.abs(11.989 - 12),
        "and it is closer to the analytic 12.000 than the pre-D3 11.989",
      );
    }
  }
});

test("S20 repro: at sigma 10 the unreachable ratio is no longer needed", () => {
  // Pre-D3: 1e4 clipped at a half side of 4.80 sigma, 3e6 still clipped, and
  // only 1e7 released. No real detector delivers that, which is why every
  // noisy row of s20-roi-suggest.test.ts was clipped. After D3 the 1e3 row
  // already releases and the released d4 at 1e7 is unchanged.
  const rows: {
    ratio: number;
    was: { width: number; halfSideInSigma: number; suppression: string | null };
    width: number;
    height: number;
    paddingXPx: number;
    sigmaEstXPx: number;
    halfSideInSigma: number;
    halfSideOverSigmaFit: number;
    suppression: string | null;
    d4: number;
  }[] = [
    { ratio: 1e3, was: { width: 84, halfSideInSigma: 4.15, suppression: "aperture_clipped" },
      width: 204, height: 204, paddingXPx: 68, sigmaEstXPx: 10.246, halfSideInSigma: 10.15, halfSideOverSigmaFit: 10.149, suppression: null, d4: 39.951 },
    { ratio: 1e4, was: { width: 97, halfSideInSigma: 4.8, suppression: "aperture_clipped" },
      width: 243, height: 243, paddingXPx: 81, sigmaEstXPx: 10.249, halfSideInSigma: 12.1, halfSideOverSigmaFit: 12.1, suppression: null, d4: 39.946 },
    { ratio: 3e6, was: { width: 122, halfSideInSigma: 6.05, suppression: "aperture_clipped" },
      width: 318, height: 315, paddingXPx: 106, sigmaEstXPx: 10.196, halfSideInSigma: 15.85, halfSideOverSigmaFit: 15.85, suppression: null, d4: 39.946 },
    { ratio: 1e7, was: { width: 126, halfSideInSigma: 6.25, suppression: null },
      width: 330, height: 330, paddingXPx: 110, sigmaEstXPx: 10.138, halfSideInSigma: 16.45, halfSideOverSigmaFit: 16.45, suppression: null, d4: 39.946 },
  ];
  for (const row of rows) {
    const outcome = applySuggestion(10, row.ratio);
    assert.equal(outcome.rect.width, row.width, `suggested width at ratio ${row.ratio}`);
    assert.equal(outcome.rect.height, row.height, `suggested height at ratio ${row.ratio}`);
    assert.equal(outcome.paddingXPx, row.paddingXPx, `x padding at ratio ${row.ratio}`);
    assert.equal(outcome.sigmaEstXPx, row.sigmaEstXPx, `x sigma estimate at ratio ${row.ratio}`);
    assert.equal(outcome.halfSideInSigma, row.halfSideInSigma, `half side at ratio ${row.ratio}`);
    assert.equal(outcome.halfSideOverSigmaFit, row.halfSideOverSigmaFit, `half side in sigma_fit at ratio ${row.ratio}`);
    assert.ok(outcome.halfSideOverSigmaFit >= 6.25, `half side must clear 6.25 sigma_fit at ratio ${row.ratio}`);
    assert.equal(outcome.suppression, row.suppression, `verdict at ratio ${row.ratio}`);
    assert.equal(outcome.d4Major, row.d4, `released d4 at ratio ${row.ratio}`);
    // The ledger: the one row that released before releases the same number.
    if (row.ratio === 1e7) assert.equal(outcome.d4Major, 39.946, "the pre-D3 released d4 is unchanged");
  }
});

test("S20 repro: the ratio a suggestion needs no longer grows with the beam", () => {
  // The single sentence the two tables make together. Pre-D3 the required
  // ratio grew as exp((6 - 8/sigma)^2 / 2); after D3 the same low ratio of
  // 1000 serves sigma 3 and sigma 10 alike, and both clear 6.25 sigma_fit.
  const small = applySuggestion(3, 1000);
  const large = applySuggestion(10, 1000);
  assert.equal(small.suppression, null, "sigma 3 releases at ratio 1000");
  assert.equal(large.suppression, null, "sigma 10 releases at ratio 1000");
  assert.ok(small.halfSideOverSigmaFit >= 6.25);
  assert.ok(large.halfSideOverSigmaFit >= 6.25);
  // Pre-D3 the same pair needed 1.035e3 and 2.977e6 respectively.
  assert.ok(requiredRatio(10) / requiredRatio(3) > 2000, "the old law separated them by three orders");
});
