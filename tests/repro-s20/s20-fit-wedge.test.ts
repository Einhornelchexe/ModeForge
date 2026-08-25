// S20 repro corpus — the fit's status decision across an adversarial scene
// sweep.
//
// Background: the wedge exit of the fit certifies convergence when the last
// accepted step improved the cost by less than the relative tolerance. That arm
// does not require the PARAMETER step to have been small, so in principle a
// large jump with a tiny cost gain could be certified. The verification round
// measured that the two conditions are antagonistic in practice: over a large
// adversarial sweep, no scene certified through that arm carried a parameter
// step anywhere near the size that would matter.
//
// A guard closing that door is therefore planned as a FREE change: it must not
// move a single status on this sweep. This file is that oracle. It pins the
// status of every scene as one digest string plus the aggregate counts; one
// changed scene changes the digest.
//
// Reduction against the source sweep (222 scenes, about 27 s): the clean
// section drops to 2 amplitudes and 2 sub-pixel phases (32 of 96 scenes, all of
// which produce identical exact-sigma convergence), the noisy section drops to
// 4 amplitude-to-noise ratios and 3 seeds (36 of 108). The flat and clipped
// sections are complete. 86 scenes remain and all three status classes survive.
//
// Not ported: the step-size instrumentation the source used to attribute each
// certification to a specific exit arm. It required an instrumented copy of the
// production fit module, which would be a second copy of that file living in
// the test tree. The arm attribution is a one-time diagnostic and is recorded
// in the verification write-up; what a regression barrier needs is the status
// per scene, which the shipped module reports directly.
//
// Runtime: about 11 s.

import assert from "node:assert/strict";
import test from "node:test";

import { fitGauss2d } from "../../packages/image/src/fit.ts";
import { addGaussianNoise, gaussianFieldF64, roundTo } from "./lib/scenes.ts";

const STATUS_CODE: Record<string, string> = {
  converged: "c",
  max_iterations: "m",
  singular_normal_equations: "s",
  nonfinite_residual: "n",
};

type SweepRow = { status: string; sigmaMajor: number | null; truthSigma: number | null };

function fitScene(values: Float64Array, width: number, height: number, truthSigma: number | null): SweepRow {
  const fit = fitGauss2d({ values, width, height }, { x0: 0, y0: 0, width, height });
  return { status: fit.status, sigmaMajor: fit.params?.sigmaMajorPx ?? null, truthSigma };
}

function runSweep(): { rows: SweepRow[]; sectionEnds: [number, number, number] } {
  const rows: SweepRow[] = [];

  // 1. Clean high-amplitude beams at several frame aspect ratios, rotations and
  //    sub-pixel phases. The wedge exit is reached here on a good scene.
  for (const [w, h] of [
    [300, 80],
    [80, 300],
    [240, 120],
    [400, 100],
  ]) {
    for (const theta of [Math.PI / 4, Math.PI / 3]) {
      for (const amplitude of [1000, 20000]) {
        for (const phase of [0, 2]) {
          const values = gaussianFieldF64(w, h, w / 2 + phase * 0.25, h / 2 + phase * 0.17, 11, 6, theta, amplitude, 0);
          rows.push(fitScene(values, w, h, 11));
        }
      }
    }
  }
  const cleanEnd = rows.length;

  // 2. Noise-dominated beams: the cost is dominated by residual noise, so a
  //    large sigma step can carry a tiny relative cost improvement.
  for (const ratio of [0.02, 0.1, 1, 3]) {
    for (const sigma of [4, 11, 30]) {
      for (let seed = 1; seed <= 3; seed += 1) {
        const values = gaussianFieldF64(128, 128, 63.5, 63.5, sigma, sigma * 0.6, 0.3, 1000, 500);
        addGaussianNoise(values, 1000 / ratio, seed * 104729);
        rows.push(fitScene(values, 128, 128, sigma));
      }
    }
  }
  const noisyEnd = rows.length;

  // 3. Flat, beam-free frames.
  for (let seed = 1; seed <= 12; seed += 1) {
    const values = new Float64Array(96 * 96);
    values.fill(1000);
    addGaussianNoise(values, 30, seed * 7919);
    rows.push(fitScene(values, 96, 96, null));
  }
  const flatEnd = rows.length;

  // 4. Saturated plateaus: a shallow valley in sigma.
  for (const clip of [200, 500, 900]) {
    for (const sigma of [8, 20]) {
      const values = gaussianFieldF64(128, 128, 63.5, 63.5, sigma, sigma, 0, 1000, 0);
      addGaussianNoise(values, 2, 4242);
      for (let i = 0; i < values.length; i += 1) if (values[i] > clip) values[i] = clip;
      rows.push(fitScene(values, 128, 128, sigma));
    }
  }

  return { rows, sectionEnds: [cleanEnd, noisyEnd, flatEnd] };
}

// The sweep is the expensive part of this file; both tests read the same run.
let cached: ReturnType<typeof runSweep> | null = null;
function sweep(): ReturnType<typeof runSweep> {
  if (cached === null) cached = runSweep();
  return cached;
}

test("S20 repro: the adversarial fit sweep produces exactly this status pattern", () => {
  const { rows, sectionEnds } = sweep();
  assert.equal(rows.length, 86);
  assert.deepEqual(sectionEnds, [32, 68, 80]);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  assert.deepEqual(counts, { converged: 53, max_iterations: 28, singular_normal_equations: 5 });

  // One character per scene, in sweep order. A guard that changes any single
  // scene's verdict changes this string.
  const digest = rows.map((row) => STATUS_CODE[row.status] ?? "?").join("");
  assert.equal(
    digest,
    "ccccccccccccccccccccccccccccccccmmmmssmssmmmmmmsmmmmmcccccccccccccccmmmmmmmmmmmmcccccc",
  );
});

test("S20 repro: the clean section converges exactly and the flat section never certifies", () => {
  const { rows, sectionEnds } = sweep();
  const [cleanEnd, noisyEnd, flatEnd] = sectionEnds;

  // Every clean scene converges on the true width to the last digit the fit
  // reports: the wedge exit is not costing accuracy on good data.
  let worstCleanErrorPercent = 0;
  for (let i = 0; i < cleanEnd; i += 1) {
    const row = rows[i];
    assert.equal(row.status, "converged", `clean scene ${i} must converge`);
    assert.ok(row.sigmaMajor !== null && row.truthSigma !== null);
    worstCleanErrorPercent = Math.max(
      worstCleanErrorPercent,
      Math.abs((100 * ((row.sigmaMajor as number) - (row.truthSigma as number))) / (row.truthSigma as number)),
    );
  }
  assert.equal(roundTo(worstCleanErrorPercent, 9), 0);

  // No beam-free frame is ever certified as converged: that is the property a
  // wedge guard must not weaken, and the one it must not need to strengthen.
  for (let i = noisyEnd; i < flatEnd; i += 1) {
    assert.equal(rows[i].status, "max_iterations", `flat scene ${i} must not certify`);
  }

  // The saturated plateaus all converge; a shallow sigma valley is not by
  // itself enough to reach the wedge exit with a large step.
  for (let i = flatEnd; i < rows.length; i += 1) {
    assert.equal(rows[i].status, "converged", `clipped scene ${i} converges`);
  }
});
