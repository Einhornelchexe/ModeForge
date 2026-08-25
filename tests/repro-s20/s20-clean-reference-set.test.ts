// S20 repro corpus - the CLEAN REFERENCE SET, and what the stage-B honesty
// instruments do on it.
//
// This file is the runnable backing for the two figures the gate-calibration
// spec's section 13 needs to cite, both measured on the canonical 74-released
// denominator rather than on any convenient subset:
//
//   N / 74   how often IMAGE_ALPHA_GATE_WEAK speaks on a clean released frame
//   X / 74   false IMAGE_ABSORBED_POWER fires at the shipped floor
//
// X is the HARD rollback condition of the ABSORBED_POWER_MIN_FRACTION change
// (0.003 -> 0.0005): any X above zero and the floor goes back to 0.003 with
// only the probe-reach notice shipping. It is therefore asserted exactly, not
// bounded.
//
// The corpus itself, its provenance and how its one free parameter was
// identified are documented in lib/clean-reference-set.ts. The first test here
// is the canonical-split proof: it re-derives the documented 111-scene
// structure and the documented 74-scene released subset before any of the
// measurements below are allowed to mean anything.
//
// Runtime: about 6.5 minutes - 111 full analyzer passes, run once at module
// level and shared by the four tests. This is why the S20 repro corpus has its
// own npm script instead of riding in the `npm test` glob.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCleanReferenceSet,
  isReleased,
  runCleanScene,
  CLEAN_SET_GEOMETRIES,
  type CleanScene,
} from "./lib/clean-reference-set.ts";
import { ABSORBED_POWER_MIN_FRACTION } from "../../packages/image/src/thresholds.ts";
import type { ImageAnalysisResult } from "../../packages/image/src/analyze.ts";

// One pass over the corpus, shared by every test below.
const scenes = buildCleanReferenceSet();
const results = new Map<string, ImageAnalysisResult>();
for (const scene of scenes) results.set(scene.name, runCleanScene(scene));

function releasedScenes(): CleanScene[] {
  return scenes.filter((scene) => isReleased(results.get(scene.name) as ImageAnalysisResult));
}

function codesOf(scene: CleanScene): string[] {
  return (results.get(scene.name) as ImageAnalysisResult).warnings.map((w) => w.code);
}

test("S20 repro: the clean reference set is the documented 111 scenes with the documented 74 releases", () => {
  // Structure, straight off the spec sentence: 6 geometries x SNR 100/20 x 4
  // seeds x 2 lanes, plus 6 noise-free, 6 large-frame and 3 beam-fills.
  assert.equal(CLEAN_SET_GEOMETRIES.length, 6);
  const byLane = new Map<string, number>();
  for (const scene of scenes) byLane.set(scene.lane, (byLane.get(scene.lane) ?? 0) + 1);
  assert.equal(byLane.get("float32"), 48, "6 geometries x 2 SNR x 4 seeds");
  assert.equal(byLane.get("camera"), 48, "the same block in the camera-realistic lane");
  assert.equal(byLane.get("noise-free"), 6);
  assert.equal(byLane.get("large-frame"), 6);
  assert.equal(byLane.get("beam-fills-roi"), 3);
  assert.equal(scenes.length, 111, "111 scenes exactly");

  // The split. This is the pin that makes every N/74 below citable: if a later
  // engine change moves the release count, the denominator of the documented
  // false-positive figures has moved with it and they must be re-measured
  // rather than quoted.
  assert.equal(releasedScenes().length, 74, "74 released of 111, per gate-calibration spec section 11");
});

test("S20 repro: the lowered wing floor produces zero false fires on the 74 released scenes", () => {
  // THE HARD ROLLBACK CONDITION. Every scene here is a clean single Gaussian:
  // there is no wing to find, so every IMAGE_ABSORBED_POWER on this corpus is
  // a false positive by construction.
  assert.equal(ABSORBED_POWER_MIN_FRACTION, 0.0005, "the floor this figure was measured at");

  const released = releasedScenes();
  assert.equal(released.length, 74);
  const fires = released.filter((scene) => codesOf(scene).includes("IMAGE_ABSORBED_POWER"));
  assert.deepEqual(
    fires.map((scene) => scene.name),
    [],
    "X must be 0/74 - any entry here restores ABSORBED_POWER_MIN_FRACTION to 0.003",
  );

  // How much room is left before the first one would fire. The worst clean
  // scene reaches 61 percent of its own ceiling, and that ceiling is the noise
  // arm rather than the floor, so the margin is not what the floor change
  // spent.
  let worstRatio = 0;
  let worstName = "-";
  let floorBound = 0;
  for (const scene of released) {
    const absorbed = (results.get(scene.name) as ImageAnalysisResult).aperture.absorbedPower;
    const excess = Math.abs(absorbed.apertureExcessFraction ?? 0);
    const threshold = absorbed.thresholdFraction ?? Number.POSITIVE_INFINITY;
    if (Math.abs(threshold - ABSORBED_POWER_MIN_FRACTION) < 1e-15) floorBound += 1;
    if (excess / threshold > worstRatio) {
      worstRatio = excess / threshold;
      worstName = scene.name;
    }
  }
  assert.ok(worstRatio < 0.7, `worst clean margin ${worstRatio.toFixed(4)} on ${worstName}`);
  assert.ok(floorBound <= 6, `${floorBound} of 74 rows are floor-bound at all`);
});

test("S20 repro: the stage-B honesty notices report these rates on the 74 released scenes", () => {
  const released = releasedScenes();
  assert.equal(released.length, 74);
  const rate = (code: string) => released.filter((scene) => codesOf(scene).includes(code)).length;

  // N/74 for section 13. The alpha notice speaks on a clean frame whenever
  // this image's own noise widened the consistency ceiling past 10 percent -
  // which on a marginal-amplitude corpus is most of the SNR-20 half. That is
  // the instrument working, not a false positive: it states that the test had
  // no discriminating power, and at those ceilings it did not.
  assert.equal(rate("IMAGE_ALPHA_GATE_WEAK"), 40, "N = 40/74 (54.1 percent)");

  // The other two, measured on the same denominator so section 13 can quote
  // all three from one run.
  assert.equal(rate("IMAGE_WING_PROBE_REDUCED"), 12, "12/74 (16.2 percent)");
  assert.equal(rate("IMAGE_TIER_CHECK_UNAVAILABLE"), 38, "38/74 (51.4 percent)");

  // Every one of them is INFO, on every scene of the corpus.
  for (const scene of released) {
    for (const item of (results.get(scene.name) as ImageAnalysisResult).warnings) {
      if (
        item.code === "IMAGE_ALPHA_GATE_WEAK" ||
        item.code === "IMAGE_WING_PROBE_REDUCED" ||
        item.code === "IMAGE_TIER_CHECK_UNAVAILABLE"
      ) {
        assert.equal(item.severity, "info", `${item.code} on ${scene.name}`);
      }
    }
  }
});

test("S20 repro: the alpha notice honours its calibration anchors on this corpus", () => {
  // The two families the reporting level was calibrated between. Silence on
  // the well-resolved SNR-100 family is exact (its ceiling is the bare 3
  // percent floor); the wide 20x12 family at SNR 20 is the near side of the
  // calibration and is where the constant is closest to a family band.
  const ceilingOf = (scene: CleanScene) => {
    const gate = (results.get(scene.name) as ImageAnalysisResult).aperture.gates.alphaConsistency;
    return Math.max(gate.thresholdMajorPercent, gate.thresholdMinorPercent);
  };
  const family = (needle: string) =>
    releasedScenes().filter((scene) => scene.name.includes(needle));

  const wellResolved = family("11x6 SNR100");
  assert.ok(wellResolved.length > 0);
  for (const scene of wellResolved) {
    assert.equal(ceilingOf(scene), 3, `${scene.name} sits on the bare floor`);
    assert.equal(codesOf(scene).includes("IMAGE_ALPHA_GATE_WEAK"), false, `${scene.name} must stay silent`);
  }

  // Documented plan band for sigma 20x12 at SNR 20 is 7.42-7.91 percent, and
  // on a high-amplitude population this reconstruction reproduces it (6.70-
  // 7.74, silent 0/8). On THIS corpus - marginal amplitude, where the Monte
  // Carlo null is much wider - the same family reaches 11.38 percent on one
  // seed and the notice speaks there. Pinned as measured, and flagged: the
  // family band is amplitude dependent, so "20x12 at SNR 20 stays silent" is a
  // statement about a signal regime, not about a geometry.
  const wide = family("20x12 SNR20");
  assert.equal(wide.length, 8);
  const speaking = wide.filter((scene) => codesOf(scene).includes("IMAGE_ALPHA_GATE_WEAK"));
  assert.equal(speaking.length, 1, "1 of 8 on this corpus");
  for (const scene of speaking) {
    assert.ok(ceilingOf(scene) > 10, `${scene.name} ceiling ${ceilingOf(scene)} must justify the notice`);
  }
});
