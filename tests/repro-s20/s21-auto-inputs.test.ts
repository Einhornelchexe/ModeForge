// S21 stage A repros — the two automatic analyzer inputs, held against the
// manual chains on RELEASED scenes.
//
// This file lives in the S20 repro corpus because that directory is the
// oracle harness the release gate runs (`npm run verify:s20repros`); it adds
// rows to that harness and changes nothing in it. The scenes are taken from
// the corpus itself so the equalities below are stated on frames whose manual
// behaviour is already pinned elsewhere:
//
//   - the `sigma 10, A/sigmaB 100` row of s20-roi-suggest.test.ts, where the
//     suggestion releases when applied (that file pins the rectangle and the
//     released fit width for the manual two-run chain), and
//   - the repository's own 64 x 48 ramp fixture, where s20-background-stats
//     pins what the plane model recovers over the four corner rectangles.
//
// What is asserted is EQUALITY of the whole serialized result against the
// manual chain, not a re-pin of individual numbers. The automatic inputs are
// resolved into ordinary inputs at the top of analyzeImage, so equality is the
// claim the implementation actually makes, and a re-pinned number would only
// restate what the manual rows already pin.
//
// Runtime: about 12 s (six 512x512 analyses plus three on the small fixture).

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { analyzeImage, type ImageAnalysisResult } from "../../packages/image/src/analyze.ts";
import { autoBackgroundCornerRects } from "../../packages/image/src/background.ts";
import { addGaussianNoise, cornerRects, gaussianSceneF32, roundTo, shortWarningCodes } from "./lib/scenes.ts";

const WIDTH = 512;
const HEIGHT = 512;
const CENTRE = 255.5;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Everything the automatic run and its manual twin must share. Only the fields
// that exist BECAUSE the run was automatic are removed.
function withoutAutoProvenance(result: ImageAnalysisResult): unknown {
  const copy = JSON.parse(JSON.stringify(result)) as {
    background: Record<string, unknown>;
    roi: Record<string, unknown>;
  };
  delete copy.background.requestedMethod;
  delete copy.background.resolvedMethod;
  delete copy.background.resolvedRects;
  delete copy.roi.source;
  delete copy.roi.autoFallbackReason;
  return copy;
}

test("S21 repro: the generated reference IS the shipped four-corner preset", () => {
  // The corpus already carries the preset's geometry as a test helper
  // (lib/scenes.ts cornerRects, written to match the workbench). The engine's
  // own generator must agree with it rectangle for rectangle, order included -
  // that agreement is what lets every equality below be stated against a
  // manual run at all.
  for (const [w, h] of [[512, 512], [64, 48], [96, 96], [13, 21], [4, 4]] as [number, number][]) {
    assert.deepEqual(autoBackgroundCornerRects(w, h), cornerRects(w, h, 0.12, 0.12), `${w}x${h}`);
  }
});

test("S21 repro: the automatic ROI reproduces apply-and-re-run on a releasing scene", () => {
  // The `sigma 10, A/sigmaB 100` row of s20-roi-suggest.test.ts: the suggestion
  // releases when applied, and that file pins its rectangle as
  // { x0: 177, y0: 176, width: 159, height: 159 } with a fitted sigma of 10.007.
  const pixels = gaussianSceneF32(WIDTH, HEIGHT, CENTRE, CENTRE, 10, 10, 0, 1000, 0);
  addGaussianNoise(pixels, 10, 12345);
  const base = { pixels, width: WIDTH, height: HEIGHT, dtype: "float32" } as const;

  // The manual chain: run on the full frame, read the suggestion, run again.
  const manualFirst = analyzeImage(base);
  const suggestion = manualFirst.roi.suggestion;
  assert.notEqual(suggestion, null);
  if (suggestion === null) throw new Error("unreachable");
  assert.deepEqual(suggestion.rect, { x0: 177, y0: 176, width: 159, height: 159 }, "the corpus rectangle");
  const manualSecond = analyzeImage({ ...base, roi: suggestion.rect });

  // The automatic chain: one run.
  const auto = analyzeImage({ ...base, roi: "auto" });

  assert.equal(
    digest(withoutAutoProvenance(auto)),
    digest(withoutAutoProvenance(manualSecond)),
    "one automatic run serializes identically to the two-run manual chain",
  );

  // The equality is between two RELEASES, and the released numbers are the
  // corpus ones.
  assert.equal(auto.moments.suppressionReason, null);
  assert.equal(roundTo(auto.fits.gauss2d.params?.sigmaMajorPx ?? Number.NaN, 3), 10.007, "the pinned fitted sigma");
  assert.equal(auto.aperture.gates.clipping.checkEllipseInside, true);
  assert.deepEqual(auto.roi.rect, suggestion.rect);
  assert.equal(auto.roi.source, "auto");
  assert.equal(auto.roi.autoFallbackReason, undefined);
  assert.deepEqual(shortWarningCodes(auto), shortWarningCodes(manualSecond), "identical warning list");

  // The second sigma stage is real on this scene: the rim frame moved with the
  // ROI, so the automatic run genuinely re-measured rather than reusing the
  // full-frame scale.
  assert.equal(roundTo(manualFirst.noise.sigmaCounts, 3), 10.081, "stage 1: the full-frame rim");
  assert.notEqual(manualFirst.noise.sigmaCounts, manualSecond.noise.sigmaCounts);
  assert.equal(auto.noise.sigmaCounts, manualSecond.noise.sigmaCounts, "stage 2 is what the analysis used");
});

// ---------------------------------------------------------------------------
// The repository's 64 x 48 ramp fixture: 600 + 8x plus a small beam, noise-free.
// Classic TIFF layout, read exactly as s20-background-stats.test.ts reads it.
// ---------------------------------------------------------------------------
const RAMP_WIDTH = 64;
const RAMP_HEIGHT = 48;

function readRampFixture(): number[] {
  const bytes = readFileSync(new URL("../e2e/fixtures/ramp_background.tif", import.meta.url));
  const stripOffset = 8 + (2 + 9 * 12 + 4);
  const pixels: number[] = [];
  for (let i = 0; i < RAMP_WIDTH * RAMP_HEIGHT; i += 1) pixels.push(bytes.readUInt16LE(stripOffset + 2 * i));
  return pixels;
}

test("S21 repro: both automations on the ramp fixture equal the manual chain", () => {
  const pixels = readRampFixture();
  assert.equal(pixels[32 + 24 * RAMP_WIDTH], 20261, "fixture centre value");
  const rects = autoBackgroundCornerRects(RAMP_WIDTH, RAMP_HEIGHT);
  const base = { pixels, width: RAMP_WIDTH, height: RAMP_HEIGHT, dtype: "float32" } as const;
  const manualBackground = { method: "robust-plane", rects } as const;

  const manualFirst = analyzeImage({ ...base, background: manualBackground });
  const suggestion = manualFirst.roi.suggestion;
  assert.notEqual(suggestion, null);
  if (suggestion === null) throw new Error("unreachable");
  const manualSecond = analyzeImage({ ...base, background: manualBackground, roi: suggestion.rect });

  const both = analyzeImage({ ...base, background: { method: "auto" }, roi: "auto" });

  assert.equal(
    digest(withoutAutoProvenance(both)),
    digest(withoutAutoProvenance(manualSecond)),
    "auto background + auto ROI equals the manual plane-then-apply chain",
  );

  // Provenance.
  assert.equal(both.background.requestedMethod, "auto");
  assert.equal(both.background.resolvedMethod, "robust-plane");
  assert.deepEqual(both.background.resolvedRects, rects);
  assert.equal(both.roi.source, "auto");

  // The plane the corpus pins for this fixture: 600 + 8x, read as 852 at the
  // reference centroid with a slope of 8 counts per pixel and no y term.
  assert.equal(both.background.plane?.converged, true);
  assert.equal(roundTo(both.background.plane?.b0Counts ?? Number.NaN, 4), 852);
  assert.equal(roundTo(both.background.plane?.bxCountsPerPx ?? Number.NaN, 5), 8);
  assert.equal(roundTo(both.background.plane?.byCountsPerPx ?? Number.NaN, 5), 0);

  // The gradient channel is a rect-median instrument and must stay silent on
  // the plane path. The automatic method resolves to the plane - the model a
  // tilt calls for - so a firing here would mean it had resolved to the wrong
  // one. s20-background-stats pins the same silence for the manual plane run.
  assert.ok(!shortWarningCodes(both).includes("BACKGROUND_GRADIENT_IN_REFERENCE"));
  assert.equal(both.background.referenceTrend, undefined, "the trend statistic is not computed for a plane");

  // Released numbers, at the corpus values for this fixture.
  assert.equal(both.moments.suppressionReason, null);
  assert.equal(roundTo(both.moments.stageB?.d4SigmaMajorPx ?? Number.NaN, 4), 13.9848);
  assert.equal(roundTo(both.moments.stageB?.d4SigmaMinorPx ?? Number.NaN, 4), 9.9863);
});
