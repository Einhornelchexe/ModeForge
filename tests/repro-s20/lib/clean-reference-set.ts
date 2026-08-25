// The CLEAN REFERENCE SET of the S18 gate-calibration campaign, rebuilt so it
// can be re-run against the shipped modules.
//
// Definition (`Plan/S18_GATE_CALIBRATION_SPEC.md` section 11, line 731,
// verbatim): "The clean reference set is 74 released scenes out of 111: 6
// geometries (sigma 11x6, 8x6, 20x12, 5x3, 3x1.5, 12x8) x SNR 100 / 20 x 4
// seeds, in both a float32 and a camera-realistic (uint16 + bias + rect-median
// corners) lane, plus 6 noise-free scenes, 6 large-frame 512x512 camera
// controls matching the attack geometry, and 3 beam-fills-the-ROI scenes."
//
//   6 * 2 * 4 * 2 = 96, plus 6 + 6 + 3 = 111 scenes exactly.
//
// This corpus is the denominator of the section-11 false-positive figures that
// the shipped constants were calibrated against: ABSORBED_POWER 0/74,
// TIER_DISAGREEMENT 1/74, WIDTH_SCATTER 8/74. Any later change to a release
// threshold has to be able to state its own N/74.
//
// PROVENANCE, stated plainly. The original generator does NOT live in this
// repository - only the sentence above does. What is reconstructed here is the
// documented STRUCTURE (exact, no freedom) plus the one quantity the sentence
// leaves open: the signal amplitude. That amplitude was IDENTIFIED, not
// chosen, by requiring the reconstruction to reproduce the documented release
// split against the shipped modules. Measured over the whole plausible range,
// releases rise monotonically with amplitude:
//
//     amplitude    3    5    8   10   20   50  100  2000
//     released    51   55   55   59   74   79  100   104
//
// and the documented 74 is hit at exactly one point, AMPLITUDE = 20 (marginal
// signal, which is also what a false-positive campaign would be built on: the
// regime where the gates are actually under stress). The split is the only
// quantity fitted; everything the tests then measure on this corpus is an
// independent read-out. Two documented secondary anchors come out close but
// not exact - WIDTH_SCATTER 11/74 against the recorded 8/74 and
// TIER_DISAGREEMENT 2/74 against the recorded 1/74 - which is the honest
// residual of a corpus rebuilt from a prose description rather than restored
// from its generator, and is recorded here rather than tuned away. A third
// limitation: in this reconstruction the 6 large-frame and 3 beam-fills
// control scenes all end suppressed; the original campaign's per-scene
// suppression DISTRIBUTION is not recorded in the prose, so it can be
// neither verified nor was it fitted or pinned - only the 74/111 total is.
//
// Determinism: fixed literal seeds, no ambient state, so two runs of the suite
// produce bit-identical numbers.

import type { BackgroundRect } from "../../../packages/image/src/background.ts";
import { analyzeImage, type ImageAnalysisResult } from "../../../packages/image/src/analyze.ts";
import { addGaussianNoise, cornerRects, fillGaussian } from "./scenes.ts";

export type CleanScene = {
  name: string;
  lane: "float32" | "camera" | "noise-free" | "large-frame" | "beam-fills-roi";
  width: number;
  height: number;
  cx: number;
  cy: number;
  sigmaX: number;
  sigmaY: number;
  theta: number;
  amplitude: number;
  sigmaB: number;
  pixels: Float64Array;
  rects: BackgroundRect[] | null;
  roi: BackgroundRect | null;
};

export const CLEAN_SET_GEOMETRIES: [number, number][] = [
  [11, 6],
  [8, 6],
  [20, 12],
  [5, 3],
  [3, 1.5],
  [12, 8],
];

const THETA = 0.7;
// Identified against the documented 74/111 release split - see PROVENANCE.
export const CLEAN_SET_AMPLITUDE = 20;
const BIAS = 100;

// Frame large enough that a clean beam of this geometry is fully contained:
// 8 sigma of beam plus a 40 px background margin per side.
function frameFor(sigmaX: number, sigmaY: number): [number, number] {
  const w = Math.max(160, 2 * Math.ceil(8 * sigmaX + 40));
  const h = Math.max(128, 2 * Math.ceil(8 * sigmaY + 40));
  return [w, h];
}

function makeScene(
  name: string,
  lane: CleanScene["lane"],
  width: number,
  height: number,
  sigmaX: number,
  sigmaY: number,
  amplitude: number,
  sigmaB: number,
  seed: number,
  camera: boolean,
  roi: BackgroundRect | null,
): CleanScene {
  const cx = width / 2 + 0.3;
  const cy = height / 2 - 0.3;
  const pixels = new Float64Array(width * height);
  fillGaussian(pixels, width, height, cx, cy, sigmaX, sigmaY, THETA, amplitude, camera ? BIAS : 0);
  if (sigmaB > 0) addGaussianNoise(pixels, sigmaB, seed);
  // Camera-realistic lane: uint16 quantization on top of the bias.
  if (camera) {
    for (let i = 0; i < pixels.length; i += 1) {
      pixels[i] = Math.min(65535, Math.max(0, Math.round(pixels[i])));
    }
  }
  return {
    name,
    lane,
    width,
    height,
    cx,
    cy,
    sigmaX,
    sigmaY,
    theta: THETA,
    amplitude,
    sigmaB,
    pixels,
    rects: camera ? cornerRects(width, height, 0.12, 0.12) : null,
    roi,
  };
}

export function buildCleanReferenceSet(): CleanScene[] {
  const scenes: CleanScene[] = [];
  let seed = 1000;
  for (const [sigmaX, sigmaY] of CLEAN_SET_GEOMETRIES) {
    const [width, height] = frameFor(sigmaX, sigmaY);
    for (const snr of [100, 20]) {
      const sigmaB = CLEAN_SET_AMPLITUDE / snr;
      for (let s = 0; s < 4; s += 1) {
        seed += 7;
        scenes.push(
          makeScene(`f32 ${sigmaX}x${sigmaY} SNR${snr} s${s}`, "float32", width, height, sigmaX, sigmaY, CLEAN_SET_AMPLITUDE, sigmaB, seed, false, null),
        );
        seed += 7;
        scenes.push(
          makeScene(`cam ${sigmaX}x${sigmaY} SNR${snr} s${s}`, "camera", width, height, sigmaX, sigmaY, CLEAN_SET_AMPLITUDE, sigmaB, seed, true, null),
        );
      }
    }
    // One noise-free control per geometry.
    scenes.push(
      makeScene(`nf ${sigmaX}x${sigmaY}`, "noise-free", width, height, sigmaX, sigmaY, CLEAN_SET_AMPLITUDE, 0, 1, false, null),
    );
  }
  // Large-frame camera controls, 512x512, on the attack geometry.
  for (let s = 0; s < 6; s += 1) {
    seed += 7;
    scenes.push(
      makeScene(`large 512 s${s}`, "large-frame", 512, 512, 11, 6, CLEAN_SET_AMPLITUDE, s < 3 ? 20 : 100, seed, true, null),
    );
  }
  // Beam-fills-the-ROI: a ROI barely wider than the 6 sigma check ellipse.
  for (const [sigmaX, sigmaY] of [[11, 6], [8, 6], [12, 8]] as [number, number][]) {
    const [width, height] = frameFor(sigmaX, sigmaY);
    seed += 7;
    const scene = makeScene(
      `fills ${sigmaX}x${sigmaY}`,
      "beam-fills-roi",
      width,
      height,
      sigmaX,
      sigmaY,
      CLEAN_SET_AMPLITUDE,
      20,
      seed,
      false,
      null,
    );
    const ex = Math.ceil(6 * Math.hypot(sigmaX * Math.cos(THETA), sigmaY * Math.sin(THETA))) + 6;
    const ey = Math.ceil(6 * Math.hypot(sigmaX * Math.sin(THETA), sigmaY * Math.cos(THETA))) + 6;
    scene.roi = {
      x0: Math.round(scene.cx) - ex,
      y0: Math.round(scene.cy) - ey,
      width: 2 * ex + 1,
      height: 2 * ey + 1,
    };
    scenes.push(scene);
  }
  return scenes;
}

export function runCleanScene(scene: CleanScene): ImageAnalysisResult {
  return analyzeImage({
    pixels: Float32Array.from(scene.pixels),
    width: scene.width,
    height: scene.height,
    dtype: "float32",
    background: scene.rects === null ? undefined : { method: "rect-median", rects: scene.rects },
    backgroundSigmaRects: scene.rects ?? undefined,
    roi: scene.roi ?? undefined,
  });
}

export function isReleased(result: ImageAnalysisResult): boolean {
  return result.moments.suppressionReason === null && result.moments.stageB !== null;
}
