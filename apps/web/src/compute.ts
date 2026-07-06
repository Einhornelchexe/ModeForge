// Headless-API access for the workbench. The UI computes no physics: every
// simulation runs through packages/api runHeadlessJob and the results are
// rendered as-is.

import {
  runHeadlessJob,
  type BeamlineComponent,
  type BeamlineResult,
  type ModeForgeProject,
  type PulseInput,
} from "../../../packages/api/src/index.ts";
import type { AppState } from "./state.ts";

export type Sim = { canonical: BeamlineResult | null; dense: BeamlineResult | null; errors: string[] };

export function pulseInputOf(state: AppState): PulseInput | undefined {
  if (!state.pulseOn) return undefined;
  const d = state.pulseDraft;
  return state.pulseMode === "energy"
    ? { pulseEnergyJ: d.pulseEnergyJ, durationFwhmS: d.durationFwhmS, shape: d.shape }
    : { averagePowerW: d.averagePowerW, repetitionRateHz: d.repetitionRateHz, durationFwhmS: d.durationFwhmS, shape: d.shape };
}

export function currentProjectInput(state: AppState): ModeForgeProject {
  return { version: "0.1", beam: state.project.beam, beamline: state.project.beamline, pulses: pulseInputOf(state) };
}

function runProject(project: ModeForgeProject): { result: BeamlineResult | null; errors: string[] } {
  const job = runHeadlessJob({ kind: "modeforge-project", project });
  if (job.ok && job.value.kind === "modeforge-project") return { result: job.value.result.beamline, errors: [] };
  return { result: null, errors: job.ok ? [] : job.errors };
}

export function componentLengthMm(component: BeamlineComponent): number {
  if (component.kind === "free-space") return component.lengthMm;
  if (component.kind === "slab" || component.kind === "thick-lens") return component.thicknessMm;
  if (component.kind === "surface-stack") return component.surfaces.reduce((sum, surface) => sum + surface.thicknessAfterMm, 0);
  return 0;
}

// Densified copy of the layout: free-space/slab segments are subdivided so the
// core samples the hyperbolic envelope finely. Display-only input construction;
// every sample is still computed by the core (contract zStepMm lands later).
export function densifyComponents(components: BeamlineComponent[], padMm: number): BeamlineComponent[] {
  const out: BeamlineComponent[] = [];
  const total = components.reduce((sum, c) => sum + componentLengthMm(c), 0) + padMm;
  const step = Math.max(total / 220, 1e-6);
  let n = 0;
  for (const c of components) {
    if (c.kind === "free-space") {
      const k = Math.max(1, Math.ceil(c.lengthMm / step));
      for (let i = 0; i < k; i += 1) out.push({ id: `d${n++}`, kind: "free-space", lengthMm: c.lengthMm / k, refractiveIndex: c.refractiveIndex });
    } else if (c.kind === "slab") {
      const k = Math.max(1, Math.ceil(c.thicknessMm / step));
      for (let i = 0; i < k; i += 1) out.push({ id: `d${n++}`, kind: "slab", thicknessMm: c.thicknessMm / k, refractiveIndex: c.refractiveIndex });
    } else {
      out.push({ ...c, id: `d${n++}` });
    }
  }
  if (padMm > 0) {
    const k = Math.max(1, Math.ceil(padMm / step));
    for (let i = 0; i < k; i += 1) out.push({ id: `d${n++}`, kind: "free-space", lengthMm: padMm / k });
  }
  return out;
}

export function denseRunFor(beam: ModeForgeProject["beam"], components: BeamlineComponent[], padMm: number): BeamlineResult | null {
  return runProject({ version: "0.1", beam, beamline: densifyComponents(components, padMm) }).result;
}

let memoKey = "";
let memo: Sim = { canonical: null, dense: null, errors: [] };

export function computeSim(state: AppState): Sim {
  const project = currentProjectInput(state);
  const key = JSON.stringify(project);
  if (key === memoKey) return memo;
  const canonicalRun = runProject(project);
  const canonical = canonicalRun.result;
  let dense: BeamlineResult | null = null;
  if (canonical && !canonical.warnings.some((w) => w.severity === "error")) {
    const end = canonical.zGridMm.at(-1) ?? 0;
    const maxWaistZ = Math.max(...canonical.waists.map((w) => w.zMm + w.rayleighRangeMm * 0.4), 0);
    let pad = Math.max(end * 0.06, maxWaistZ - end + 10);
    if (end === 0) pad = Math.max(maxWaistZ * 1.4, 100);
    pad = Math.min(Math.max(pad, 5), Math.max(end * 1.2, 400));
    dense = denseRunFor(project.beam, project.beamline, pad);
  }
  memoKey = key;
  memo = { canonical, dense, errors: canonicalRun.errors };
  return memo;
}
