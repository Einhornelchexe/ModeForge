// ModeForge workbench — production port of the Claude Design prototype.
// All physics runs through packages/api (enforced by scripts/check-scope.mjs);
// this module only manages UI state, event wiring and rendering.

import {
  BUILTIN_MATERIALS,
  parseBeamWidthMeasurementsCsv,
  parseProjectJson,
  runHeadlessJob,
  serializeProject,
  type BeamlineComponent,
  type FieldImageGrid,
  type ModeForgeProject,
} from "../../../packages/api/src/index.ts";
import { hermiteGaussianM2, laguerreGaussianM2 } from "../../../packages/api/src/index.ts";
import { componentLengthMm, computeSim, currentProjectInput } from "./compute.ts";
import { fmtMm, sig } from "./format.ts";
import { saveLang, strings, type Lang } from "./i18n.ts";
import { plotVals, PLOT_FRAME, type PlotVals } from "./plot.ts";
import { PRESETS } from "./state.ts";
import { S } from "./store.ts";
import { renderBeamlineTab } from "./views/beamline.ts";
import { exportProject, renderHeader, renderModal } from "./views/chrome.ts";
import { renderFieldTab, projectBeamW0 } from "./views/field.ts";
import { renderFitTab } from "./views/fit.ts";
import { renderImportTab } from "./views/importTab.ts";
import { rangeArray, renderOptimizerTab, solutionComponents } from "./views/optimizer.ts";
import "./base.css";
import "./workbench.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("ModeForge app root is missing");
const app = appRoot;

let lastPlot: PlotVals | null = null;

// ── rendering ─────────────────────────────────────────────

function render(): void {
  const T = strings(S.lang);
  const sim = computeSim(S);
  let body = "";
  if (S.tab === "beamline") {
    const simOk = !!sim.canonical && !sim.canonical.warnings.some((w) => w.severity === "error") && sim.errors.length === 0;
    lastPlot = simOk ? plotVals(sim.dense, sim.canonical, S.project.beamline) : null;
    body = renderBeamlineTab(T, sim, lastPlot ?? plotVals(null, null, []));
  } else if (S.tab === "optimizer") {
    body = renderOptimizerTab(T);
  } else if (S.tab === "import") {
    body = renderImportTab(T);
  } else if (S.tab === "fit") {
    body = renderFitTab(T);
  } else {
    body = renderFieldTab(T);
  }
  app.innerHTML = `
    <div class="wb-shell">
      ${renderHeader(T)}
      ${body}
      ${renderModal(T)}
    </div>`;
  requestAnimationFrame(() => drawFieldCanvases());
}

function rerender(): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active?.dataset?.k;
  let selStart: number | null = null;
  let selEnd: number | null = null;
  if (key && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
    try {
      selStart = active.selectionStart;
      selEnd = active.selectionEnd;
    } catch {
      selStart = null;
    }
  }
  render();
  if (key) {
    const el = app.querySelector<HTMLElement>(`[data-k="${CSS.escape(key)}"]`);
    if (el) {
      el.focus();
      if (selStart !== null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        try {
          el.setSelectionRange(selStart, selEnd ?? selStart);
        } catch {
          /* selects etc. */
        }
      }
    }
  }
}

// ── field |E|² canvases (display-only colormap over API image grids) ──

const COLOR_STOPS = [
  [10, 13, 18],
  [22, 44, 66],
  [30, 92, 110],
  [55, 160, 130],
  [92, 225, 160],
  [225, 245, 200],
];

function drawImage(canvas: HTMLCanvasElement | null, grid: FieldImageGrid | undefined): void {
  if (!canvas || !grid || grid.values.length === 0) return;
  canvas.width = grid.nx;
  canvas.height = grid.ny;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(grid.nx, grid.ny);
  for (let i = 0; i < grid.values.length; i += 1) {
    const t = Math.sqrt(Math.max(0, Math.min(1, grid.values[i])));
    const pos = t * (COLOR_STOPS.length - 1);
    const k = Math.min(COLOR_STOPS.length - 2, Math.floor(pos));
    const frac = pos - k;
    img.data[i * 4] = COLOR_STOPS[k][0] + (COLOR_STOPS[k + 1][0] - COLOR_STOPS[k][0]) * frac;
    img.data[i * 4 + 1] = COLOR_STOPS[k][1] + (COLOR_STOPS[k + 1][1] - COLOR_STOPS[k][1]) * frac;
    img.data[i * 4 + 2] = COLOR_STOPS[k][2] + (COLOR_STOPS[k + 1][2] - COLOR_STOPS[k][2]) * frac;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ── field job dispatch: Web Worker with progress, sync fallback ──

import type { FieldWorkerRequest, FieldWorkerResponse } from "./field-worker.ts";

let fieldWorker: Worker | null | undefined;
let fieldJobToken = 0;
let pendingFieldKind: "field-beamline" | "field-fresnel" = "field-beamline";

function handleFieldJobResult(result: ReturnType<typeof runHeadlessJob>): void {
  S.fld = { ...S.fld, busy: false, progress: null };
  if (!result.ok) {
    if (pendingFieldKind === "field-beamline") S.fld = { ...S.fld, resB: null, errs: result.errors };
    else S.fld = { ...S.fld, res: null, errs: result.errors };
  } else if (result.value.kind === "field-beamline") {
    S.fld = { ...S.fld, resB: result.value.result };
  } else if (result.value.kind === "field-fresnel") {
    S.fld = { ...S.fld, res: result.value.result };
  }
  rerender();
}

function getFieldWorker(): Worker | null {
  if (fieldWorker !== undefined) return fieldWorker;
  try {
    fieldWorker = new Worker(new URL("./field-worker.ts", import.meta.url), { type: "module" });
    fieldWorker.onmessage = (event: MessageEvent<FieldWorkerResponse>) => {
      const message = event.data;
      if (message.token !== fieldJobToken) return; // stale run superseded by a newer click
      if (message.type === "progress") {
        S.fld = { ...S.fld, progress: { done: message.done, total: message.total } };
        rerender();
        return;
      }
      handleFieldJobResult(message.result);
    };
    fieldWorker.onerror = () => {
      fieldWorker?.terminate();
      fieldWorker = null;
      if (S.fld.busy) {
        S.fld = { ...S.fld, busy: false, progress: null, errs: ["field worker failed — retry runs on the main thread"] };
        rerender();
      }
    };
  } catch {
    fieldWorker = null;
  }
  return fieldWorker;
}

function dispatchFieldJob(job: FieldWorkerRequest["job"]): void {
  pendingFieldKind = job.kind;
  fieldJobToken += 1;
  const worker = getFieldWorker();
  if (worker) {
    const request: FieldWorkerRequest = { token: fieldJobToken, job };
    worker.postMessage(request);
    return;
  }
  const token = fieldJobToken;
  setTimeout(() => {
    if (token !== fieldJobToken) return;
    handleFieldJobResult(runHeadlessJob(job));
  }, 30);
}

function drawFieldCanvases(): void {
  if (S.tab !== "field") return;
  if (S.fld.mode === "beamline") {
    const res = S.fld.resB;
    if (!res || res.probes.length === 0) return;
    drawImage(document.querySelector<HTMLCanvasElement>("#field-canvas-in"), res.probes[0].image);
    drawImage(document.querySelector<HTMLCanvasElement>("#field-canvas-out"), res.probes.at(-1)?.image);
    return;
  }
  if (!S.fld.res) return;
  drawImage(document.querySelector<HTMLCanvasElement>("#field-canvas-in"), S.fld.res.inputImage);
  drawImage(document.querySelector<HTMLCanvasElement>("#field-canvas-out"), S.fld.res.outputImage);
}

// ── project mutation helpers (ported from the design source) ──

function setProject(mutator: (p: ModeForgeProject) => void): void {
  const project = JSON.parse(JSON.stringify(S.project)) as ModeForgeProject;
  mutator(project);
  S.project = project;
}

function nextId(prefix: string): string {
  const ids = new Set(S.project.beamline.map((c) => c.id));
  let n = 1;
  while (ids.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

function addComponent(component: BeamlineComponent): void {
  setProject((p) => p.beamline.push(component));
  S.selId = component.id;
}

function selected(): BeamlineComponent | null {
  return S.project.beamline.find((c) => c.id === S.selId) ?? null;
}

function mutateSelected(mutator: (c: BeamlineComponent, p: ModeForgeProject) => void): void {
  const selId = S.selId;
  setProject((p) => {
    const c = p.beamline.find((x) => x.id === selId);
    if (c) mutator(c, p);
  });
}

// Set the absolute z position of a component by adjusting (or inserting)
// the free-space element in front of it. Layout editing only — no physics.
function setComponentPosition(id: string | null, newZ: number): void {
  if (id === null || !Number.isFinite(newZ) || newZ < 0) return;
  setProject((p) => {
    const i = p.beamline.findIndex((c) => c.id === id);
    if (i < 0) return;
    let startZ = 0;
    for (let k = 0; k < i; k += 1) {
      startZ += componentLengthMm(p.beamline[k]);
    }
    const prev = i > 0 ? p.beamline[i - 1] : null;
    if (prev && prev.kind === "free-space") {
      const prevStart = startZ - prev.lengthMm;
      const newLen = newZ - prevStart;
      if (newLen > 1e-9) prev.lengthMm = newLen;
    } else {
      const delta = newZ - startZ;
      if (delta > 1e-9) p.beamline.splice(i, 0, { id: nextId("drift-"), kind: "free-space", lengthMm: delta });
    }
  });
}

function moveSel(dir: number): void {
  const selId = S.selId;
  setProject((p) => {
    const i = p.beamline.findIndex((c) => c.id === selId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.beamline.length) return;
    const [c] = p.beamline.splice(i, 1);
    p.beamline.splice(j, 0, c);
  });
}

function switchKind(kind: "gaussian" | "elliptical-gaussian" | "moment"): void {
  if (S.project.beam.kind === kind) return;
  setProject((p) => {
    const beam = p.beam as Record<string, number | string | undefined>;
    const wl = p.beam.wavelengthUm;
    const power = p.beam.powerW;
    const w =
      (beam.waistRadiusMm as number | undefined) ??
      (beam.waistRadiusXmm as number | undefined) ??
      (beam.d4SigmaDiameterXmm !== undefined ? (beam.d4SigmaDiameterXmm as number) / 2 : 0.5);
    const z = (beam.waistPositionMm as number | undefined) ?? (beam.waistPositionXmm as number | undefined) ?? 0;
    if (kind === "gaussian") p.beam = { kind, wavelengthUm: wl, waistRadiusMm: w, waistPositionMm: z, powerW: power };
    if (kind === "elliptical-gaussian")
      p.beam = { kind, wavelengthUm: wl, waistRadiusXmm: w, waistRadiusYmm: w, waistPositionXmm: z, waistPositionYmm: z, powerW: power };
    if (kind === "moment") p.beam = { kind, wavelengthUm: wl, d4SigmaDiameterXmm: w * 2, waistPositionXmm: z, m2x: 1.3, powerW: power };
    if (power === undefined) delete p.beam.powerW;
  });
  S.drafts = {};
}

function applyModeM2(): void {
  const h = S.modeHelper;
  try {
    if (h.type === "HG") {
      const r = hermiteGaussianM2({ kind: "HG", m: Number(h.p1), n: Number(h.p2), waistRadiusMm: 1 });
      setProject((p) => {
        if (p.beam.kind === "gaussian") p.beam.m2 = Math.max(r.m2x, r.m2y);
        else if (p.beam.kind === "elliptical-gaussian") {
          p.beam.m2x = r.m2x;
          p.beam.m2y = r.m2y;
        } else {
          p.beam.m2x = r.m2x;
          p.beam.m2y = r.m2y;
        }
      });
    } else {
      const r = laguerreGaussianM2({ kind: "LG", p: Number(h.p1), l: Number(h.p2), waistRadiusMm: 1 });
      setProject((p) => {
        if (p.beam.kind === "gaussian") p.beam.m2 = r;
        else if (p.beam.kind === "elliptical-gaussian") {
          p.beam.m2x = r;
          p.beam.m2y = r;
        } else {
          p.beam.m2x = r;
          p.beam.m2y = r;
        }
      });
    }
    S.drafts = {};
  } catch {
    /* invalid order — helper text already shows it */
  }
}

// ── project JSON modal ────────────────────────────────────

function downloadProject(): void {
  const blob = new Blob([serializeProject(exportProject())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "beamline.modeforge.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function applyImport(): void {
  const parsed = parseProjectJson(S.importDraft);
  if (!parsed.ok) {
    S.importErrors = parsed.errors;
    rerender();
    return;
  }
  const project = parsed.value;
  S.project = { version: "0.1", beam: project.beam, beamline: project.beamline };
  S.importErrors = [];
  S.modal = null;
  S.selId = null;
  S.drafts = {};
  if (project.display?.widthBasis) S.widthBasis = project.display.widthBasis;
  if (project.pulses) {
    S.pulseOn = true;
    S.pulseMode = project.pulses.pulseEnergyJ !== undefined ? "energy" : "avg";
    S.pulseDraft = {
      averagePowerW: project.pulses.averagePowerW ?? 1,
      repetitionRateHz: project.pulses.repetitionRateHz ?? 1000,
      pulseEnergyJ: project.pulses.pulseEnergyJ ?? 0.001,
      durationFwhmS: project.pulses.durationFwhmS,
      shape: project.pulses.shape,
    };
  } else {
    S.pulseOn = false;
  }
  rerender();
}

// ── tool runs (all through packages/api runHeadlessJob) ──

function runOptimizer(): void {
  const o = S.opt;
  const lenses = o.lenses
    .filter((l) => l.id && Number.isFinite(Number(l.f)) && Number(l.f) !== 0)
    .map((l) => ({ id: l.id, focalLengthMm: Number(l.f), apertureRadiusMm: l.ap.trim() === "" ? undefined : Number(l.ap) }));
  const search: Record<string, number | number[]> = {
    lens1Zmm: rangeArray(o.l1From, o.l1To, o.l1Step),
    lens2Zmm: rangeArray(o.l2From, o.l2To, o.l2Step),
    targetZmm: Number(o.targetZ),
    maxResults: Number(o.maxResults) || 8,
  };
  if (o.targetRadius.trim() !== "") search.targetRadiusMm = Number(o.targetRadius);
  if (o.targetWaistRadius.trim() !== "") search.targetWaistRadiusMm = Number(o.targetWaistRadius);
  if (o.targetWaistZ.trim() !== "") search.targetWaistZmm = Number(o.targetWaistZ);
  if (o.minSep.trim() !== "") search.minSeparationMm = Number(o.minSep);
  if (o.marginMin.trim() !== "") search.apertureMarginMin = Number(o.marginMin);
  if (o.sensOn) {
    if (o.sensShift.trim() !== "") search.sensitivityShiftMm = Number(o.sensShift);
    if (o.sensFocal.trim() !== "") search.sensitivityFocalLengthMm = Number(o.sensFocal);
    if (o.sensM2.trim() !== "") search.sensitivityM2Delta = Number(o.sensM2);
  }
  const jobInput = {
    kind: "two-lens-optimizer" as const,
    input: {
      version: "0.1" as const,
      beam: S.project.beam,
      lenses,
      search,
      pulse: o.usePulse && S.pulseOn ? currentProjectInput(S).pulses : undefined,
    },
  };
  S.optBusy = true;
  S.optResult = null;
  S.optErrors = [];
  rerender();
  setTimeout(() => {
    const job = runHeadlessJob(jobInput as Parameters<typeof runHeadlessJob>[0]);
    S.optBusy = false;
    if (!job.ok) {
      S.optErrors = job.errors;
    } else if (job.value.kind === "two-lens-optimizer") {
      S.optResult = job.value.result;
      S.optSel = 1;
    }
    rerender();
  }, 30);
}

function sampleZmx(kind: "ok" | "unknown"): string {
  if (kind === "unknown") {
    return "! Cemented doublet with an uncommon glass\nSURF 0\n  RADIUS 62.75\n  DISZ 4.0\n  GLAS S-LAH64\n  DIAM 12.7\nSURF 1\n  RADIUS -45.71\n  DISZ 2.5\n  GLAS N-SF11\n  DIAM 12.7\nSURF 2\n  RADIUS -128.23\n  DISZ 0\n  DIAM 12.7\n";
  }
  return "! Plano-convex singlet, N-BK7 (f ≈ 50 mm)\nSURF 0\n  RADIUS 25.8\n  DISZ 5.3\n  GLAS N-BK7\n  DIAM 12.7\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n  DIAM 12.7\n";
}

function sampleAgf(): string {
  return "! Minimal AGF demo catalog\nNM S-LAH64\nCD 1.83021453 0.0090482329 0.29056381 0.0330756689 1.28544024 89.3675501\nNM N-SF11\nCD 1.73759695 0.013188707 0.313747346 0.0623068142 1.89878101 155.23629\nNM MYSTERY-K5\n";
}

function sampleCsv(): string {
  return "# z_mm   w_1e2_radius_mm\n0    0.1409\n10   0.1275\n20   0.1189\n30   0.1118\n40   0.1102\n50   0.1125\n60   0.1180\n70   0.1283\n80   0.1402\n90   0.1560\n100  0.1709\n";
}

function runZmx(): void {
  const materials = [...BUILTIN_MATERIALS, ...S.imp.session];
  const job = runHeadlessJob({
    kind: "zmx-import",
    text: S.imp.zmxText,
    wavelengthUm: Number(S.imp.lambda) || undefined,
    materials,
  });
  S.imp.zmx = job.ok && job.value.kind === "zmx-import" ? { ok: true, value: job.value, errors: [] } : { ok: false, errors: job.ok ? [] : job.errors };
  rerender();
}

function runAgf(): void {
  const job = runHeadlessJob({ kind: "agf-import", text: S.imp.agfText });
  S.imp.agf = job.ok && job.value.kind === "agf-import" ? { ok: true, value: job.value, errors: [] } : { ok: false, errors: job.ok ? [] : job.errors };
  rerender();
}

function addImportedLens(): void {
  const job = S.imp.zmx;
  if (!job?.ok || !job.value.result.ok) return;
  const stack = job.value.result.value as { surfaces: Array<{ radiusMm: number | "Infinity"; thicknessAfterMm: number; materialAfter: string; refractiveIndexAfter: number; apertureRadiusMm?: number }> };
  const sf = stack.surfaces;
  if (!(sf.length === 2 && sf[0].materialAfter.toUpperCase() !== "AIR" && sf[0].thicknessAfterMm > 0 && sf[1].materialAfter.toUpperCase() === "AIR")) return;
  setProject((p) =>
    p.beamline.push({
      id: nextId("ZMX"),
      kind: "thick-lens",
      radius1Mm: sf[0].radiusMm,
      radius2Mm: sf[1].radiusMm,
      thicknessMm: sf[0].thicknessAfterMm,
      refractiveIndex: sf[0].refractiveIndexAfter,
      apertureRadiusMm: sf[0].apertureRadiusMm,
    }),
  );
  S.tab = "beamline";
  rerender();
}

function addImportedStack(): void {
  const job = S.imp.zmx;
  if (!job?.ok || !job.value.result.ok) return;
  const stack = job.value.result.value as {
    name?: string;
    surfaces: Array<{
      radiusMm: number | "Infinity";
      thicknessAfterMm: number;
      materialAfter: string;
      refractiveIndexAfter: number;
      apertureRadiusMm?: number;
    }>;
  };
  if (stack.surfaces.length < 2) return;
  // beamline embedding policy: the stack exits into air with no trailing gap —
  // any trailing DISZ from the prescription belongs to a following free-space
  const surfaces = stack.surfaces.map((surface, index, all) => ({
    radiusMm: surface.radiusMm,
    thicknessAfterMm: index === all.length - 1 ? 0 : surface.thicknessAfterMm,
    refractiveIndexAfter: index === all.length - 1 ? 1 : surface.refractiveIndexAfter,
    apertureRadiusMm: surface.apertureRadiusMm,
    materialAfter: surface.materialAfter,
  }));
  setProject((p) => p.beamline.push({ id: nextId("ZMX"), kind: "surface-stack", name: stack.name, surfaces }));
  S.tab = "beamline";
  rerender();
}

function runFit(): void {
  const parsed = parseBeamWidthMeasurementsCsv(S.fit.csv, S.fit.basis);
  if (!parsed.ok) {
    S.fit.res = null;
    S.fit.meas = null;
    S.fit.errs = parsed.errors;
    rerender();
    return;
  }
  const job = runHeadlessJob({ kind: "measured-beam-fit", wavelengthUm: Number(S.fit.lambda), measurements: parsed.value });
  if (!job.ok) {
    S.fit.res = null;
    S.fit.meas = parsed.value;
    S.fit.errs = job.errors;
  } else if (job.value.kind === "measured-beam-fit") {
    S.fit.res = job.value.result;
    S.fit.meas = parsed.value;
    S.fit.errs = [];
  }
  rerender();
}

function applyFitAsBeam(): void {
  const res = S.fit.res;
  if (!res?.ok || res.waistRadiusMm === undefined || res.waistPositionMm === undefined) return;
  setProject((p) => {
    p.beam = {
      kind: "gaussian",
      wavelengthUm: Number(S.fit.lambda),
      waistRadiusMm: res.waistRadiusMm as number,
      waistPositionMm: res.waistPositionMm as number,
      m2: Math.max(1, res.m2 ?? 1),
      powerW: p.beam.powerW,
    };
    if (p.beam.powerW === undefined) delete p.beam.powerW;
  });
  S.tab = "beamline";
  S.drafts = {};
  rerender();
}

function runField(): void {
  const f = S.fld;
  const n = Math.max(8, Math.min(256, Math.round(Number(f.n)) || 48));
  const input: {
    gaussian: { nx: number; ny: number; dxMm: number; dyMm: number; wavelengthUm: number; waistRadiusMm: number };
    distanceMm: number;
    method: "fresnel" | "angular-spectrum";
    samplingBeamRadiusMm: number;
    apertureRadiusMm?: number;
  } = {
    gaussian: { nx: n, ny: n, dxMm: Number(f.dx), dyMm: Number(f.dx), wavelengthUm: Number(f.lambda), waistRadiusMm: Number(f.waist) },
    distanceMm: Number(f.dist),
    method: f.method,
    samplingBeamRadiusMm: Number(f.waist),
  };
  if (f.apOn) input.apertureRadiusMm = Number(f.ap);
  S.fld = { ...f, busy: true, errs: [], progress: null };
  rerender();
  dispatchFieldJob({ kind: "field-fresnel", input });
}

function probeTargetZ(): number {
  const sim = computeSim(S);
  const totalLen = sim.canonical?.zGridMm.at(-1) ?? 0;
  return S.fld.bz.trim() === "" ? totalLen : Number(S.fld.bz);
}

function runFieldBeamline(): void {
  const f = S.fld;
  const zProbe = probeTargetZ();
  if (!Number.isFinite(zProbe) || zProbe < 0) {
    S.fld = { ...f, resB: null, errs: ["evaluation plane z must be a finite number >= 0"] };
    rerender();
    return;
  }
  const n = Math.max(8, Math.min(256, Math.round(Number(f.n)) || 48));
  S.fld = { ...f, busy: true, errs: [], progress: null };
  rerender();
  dispatchFieldJob({
    kind: "field-beamline",
    input: {
      beamline: { version: "0.1", beam: S.project.beam, components: S.project.beamline },
      grid: { nx: n, ny: n, dxMm: Number(f.dx), dyMm: Number(f.dx) },
      method: f.method,
      includePlanes: true,
      probesZmm: [0, zProbe],
      surfacePhase: f.sp,
    },
  });
}

// AUTO dx: size the grid so it holds the largest analytic envelope radius seen
// anywhere up to the evaluation plane (display-only lookup in the densified
// core result — the UI computes no physics).
function autoDxFromEnvelope(): void {
  const sim = computeSim(S);
  const dense = sim.dense;
  if (!dense || dense.zGridMm.length === 0) return;
  const zProbe = probeTargetZ();
  const limit = Number.isFinite(zProbe) ? zProbe : dense.zGridMm.at(-1) ?? 0;
  let maxR = 0;
  dense.zGridMm.forEach((z, i) => {
    if (z <= limit + 1e-9) {
      maxR = Math.max(maxR, dense.envelope.radiusXmm[i] ?? 0, dense.envelope.radiusYmm?.[i] ?? 0);
    }
  });
  if (maxR <= 0) maxR = Math.max(...dense.envelope.radiusXmm, 0.1);
  const n = Math.max(8, Math.min(256, Math.round(Number(S.fld.n)) || 48));
  S.fld = { ...S.fld, dx: sig((6 * maxR) / n, 3) };
  rerender();
}

function syncFieldFromBeam(): void {
  const f = S.fld;
  const beam = S.project.beam;
  const w0 = projectBeamW0();
  const n = Math.max(8, Math.min(256, Math.round(Number(f.n)) || 48));
  const dx = (6 * w0) / n;
  S.fld = { ...f, lambda: String(beam.wavelengthUm), waist: sig(w0, 4), dx: sig(dx, 3), res: null, errs: [] };
  rerender();
}

// ── click actions ─────────────────────────────────────────

const actions: Record<string, (arg: string) => void> = {
  tab: (arg) => {
    S.tab = arg as typeof S.tab;
    rerender();
  },
  lang: (arg) => {
    saveLang(arg as Lang);
    S.lang = arg as Lang;
    S.drafts = {};
    rerender();
  },
  preset: (arg) => {
    const preset = PRESETS.find((p) => p.id === arg);
    if (!preset) return;
    S.presetId = preset.id;
    S.project = preset.make();
    S.pulseOn = preset.pulseOn;
    S.selId = null;
    S.drafts = {};
    rerender();
  },
  kind: (arg) => {
    switchKind(arg as "gaussian" | "elliptical-gaussian" | "moment");
    rerender();
  },
  "mode-type": (arg) => {
    S.modeHelper = { ...S.modeHelper, type: arg as "HG" | "LG" };
    rerender();
  },
  "apply-m2": () => {
    applyModeM2();
    rerender();
  },
  "pulse-toggle": () => {
    S.pulseOn = !S.pulseOn;
    rerender();
  },
  "pulse-mode": (arg) => {
    S.pulseMode = arg as "energy" | "avg";
    rerender();
  },
  "open-export": () => {
    S.modal = "json";
    S.modalMode = "export";
    S.copied = false;
    rerender();
  },
  "open-import": () => {
    S.modal = "json";
    S.modalMode = "import";
    S.importErrors = [];
    rerender();
  },
  "close-modal": () => {
    S.modal = null;
    rerender();
  },
  "modal-export": () => {
    S.modalMode = "export";
    S.copied = false;
    rerender();
  },
  "modal-import": () => {
    S.modalMode = "import";
    rerender();
  },
  "copy-project": () => {
    void navigator.clipboard?.writeText(serializeProject(exportProject())).then(() => {
      S.copied = true;
      rerender();
    });
  },
  "download-project": () => downloadProject(),
  "apply-import": () => applyImport(),
  "add-free": () => {
    addComponent({ id: nextId("drift-"), kind: "free-space", lengthMm: 100 });
    rerender();
  },
  "add-thin": () => {
    addComponent({ id: nextId("L"), kind: "thin-lens", focalLengthMm: 100, apertureRadiusMm: 12.7 });
    rerender();
  },
  "add-thick": () => {
    addComponent({ id: nextId("TL"), kind: "thick-lens", radius1Mm: 50, radius2Mm: -50, thicknessMm: 5, refractiveIndex: 1.5168, apertureRadiusMm: 12.7 });
    rerender();
  },
  "add-cyl": () => {
    addComponent({ id: nextId("CL"), kind: "cylindrical-lens", focalLengthMm: 100, axis: "x", apertureRadiusMm: 12.7 });
    rerender();
  },
  "add-slab": () => {
    addComponent({ id: nextId("win-"), kind: "slab", thicknessMm: 3, refractiveIndex: 1.45, apertureRadiusMm: 12.7 });
    rerender();
  },
  "add-aperture": () => {
    addComponent({ id: nextId("iris-"), kind: "aperture", apertureRadiusMm: 2 });
    rerender();
  },
  "comp-select": (arg) => {
    S.selId = S.selId === arg ? null : arg;
    S.drafts = {};
    rerender();
  },
  "move-left": () => {
    moveSel(-1);
    rerender();
  },
  "move-right": () => {
    moveSel(1);
    rerender();
  },
  "dup-sel": () => {
    const sel = selected();
    if (!sel) return;
    const copy = { ...sel, id: nextId(sel.id.replace(/\d+$/, "") || "c") };
    setProject((p) => {
      const i = p.beamline.findIndex((x) => x.id === sel.id);
      p.beamline.splice(i + 1, 0, copy);
    });
    S.selId = copy.id;
    rerender();
  },
  "del-sel": () => {
    const sel = selected();
    if (!sel) return;
    setProject((p) => {
      p.beamline = p.beamline.filter((x) => x.id !== sel.id);
    });
    S.selId = null;
    rerender();
  },
  axis: (arg) => {
    mutateSelected((c) => {
      if (c.kind === "cylindrical-lens") c.axis = arg as "x" | "y";
    });
    rerender();
  },
  "opt-add-lens": () => {
    S.opt.lenses = [...S.opt.lenses, { id: `f${S.opt.lenses.length + 1}`, f: "100", ap: "10" }];
    rerender();
  },
  "opt-del-lens": (arg) => {
    const i = Number(arg);
    S.opt.lenses = S.opt.lenses.filter((_, j) => j !== i);
    rerender();
  },
  "opt-sens-toggle": () => {
    S.opt.sensOn = !S.opt.sensOn;
    rerender();
  },
  "opt-pulse-toggle": () => {
    S.opt.usePulse = !S.opt.usePulse;
    rerender();
  },
  "run-opt": () => runOptimizer(),
  "opt-sel": (arg) => {
    S.optSel = Number(arg);
    rerender();
  },
  "send-solution": () => {
    const sol = S.optResult?.solutions.find((x) => x.rank === S.optSel);
    if (!sol) return;
    const comps = solutionComponents(sol);
    setProject((p) => {
      p.beamline = comps.map((c) => ({ ...c }));
    });
    S.tab = "beamline";
    S.selId = null;
    rerender();
  },
  "zmx-sample": () => {
    S.imp = { ...S.imp, zmxText: sampleZmx("ok"), zmx: null };
    rerender();
  },
  "zmx-sample-unknown": () => {
    S.imp = { ...S.imp, zmxText: sampleZmx("unknown"), zmx: null };
    rerender();
  },
  "run-zmx": () => runZmx(),
  "agf-sample": () => {
    S.imp = { ...S.imp, agfText: sampleAgf(), agf: null };
    rerender();
  },
  "run-agf": () => runAgf(),
  "adopt-agf": () => {
    const agf = S.imp.agf;
    if (!agf?.ok) return;
    S.imp = { ...S.imp, session: agf.value.result.materials, adoptedCount: agf.value.result.materials.length };
    rerender();
  },
  "add-imported-lens": () => addImportedLens(),
  "add-imported-stack": () => addImportedStack(),
  "fit-sample": () => {
    S.fit = { ...S.fit, csv: sampleCsv(), res: null, meas: null, errs: [] };
    rerender();
  },
  "run-fit": () => runFit(),
  "apply-fit-beam": () => applyFitAsBeam(),
  "fld-sync": () => syncFieldFromBeam(),
  "fld-ap-toggle": () => {
    S.fld = { ...S.fld, apOn: !S.fld.apOn };
    rerender();
  },
  "run-field": () => runField(),
  "fld-mode": (arg) => {
    S.fld = { ...S.fld, mode: arg === "source" ? "source" : "beamline" };
    rerender();
  },
  "fld-chip": (arg) => {
    S.fld = { ...S.fld, bz: arg };
    rerender();
  },
  "fld-auto-dx": () => autoDxFromEnvelope(),
  "run-field-beamline": () => runFieldBeamline(),
};

// ── numeric drafts (design numSetter semantics) ──

type NumApply = (v: number | undefined | "Infinity") => void;

function numDraft(key: string, raw: string, apply: NumApply, opts: { optional?: boolean; infinity?: boolean } = {}): void {
  S.drafts = { ...S.drafts, [key]: raw };
  if (raw.trim() === "" && opts.optional) {
    apply(undefined);
    return;
  }
  if (opts.infinity && /^inf(inity)?$/i.test(raw.trim())) {
    apply("Infinity");
    return;
  }
  const v = Number(raw);
  if (Number.isFinite(v)) apply(v);
}

function num(apply: (v: number) => void): NumApply {
  return (v) => {
    if (typeof v === "number") apply(v);
  };
}

function applyField(key: string, raw: string): boolean {
  const durUnitFactor = { fs: 1e-15, ps: 1e-12, ns: 1e-9 }[S.pulseDurUnit];
  // dynamic optimizer lens rows
  const lensMatch = /^ol-(id|f|ap)-(\d+)$/.exec(key);
  if (lensMatch) {
    const i = Number(lensMatch[2]);
    const fieldName = lensMatch[1] === "id" ? "id" : lensMatch[1] === "f" ? "f" : "ap";
    S.opt.lenses = S.opt.lenses.map((x, j) => (j === i ? { ...x, [fieldName]: raw } : x));
    return true;
  }
  switch (key) {
    // beam
    case "wl":
      numDraft(key, raw, num((v) => setProject((p) => (p.beam.wavelengthUm = v))));
      return true;
    case "pw":
      numDraft(key, raw, (v) => setProject((p) => {
        if (v === undefined) delete p.beam.powerW;
        else if (typeof v === "number") p.beam.powerW = v;
      }), { optional: true });
      return true;
    case "w0":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "gaussian") p.beam.waistRadiusMm = v;
      })));
      return true;
    case "z0":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "gaussian") p.beam.waistPositionMm = v;
      })));
      return true;
    case "m2":
      numDraft(key, raw, (v) => setProject((p) => {
        if (p.beam.kind !== "gaussian") return;
        if (v === undefined) delete p.beam.m2;
        else if (typeof v === "number") p.beam.m2 = v;
      }), { optional: true });
      return true;
    case "wx":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "elliptical-gaussian") p.beam.waistRadiusXmm = v;
      })));
      return true;
    case "wy":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "elliptical-gaussian") p.beam.waistRadiusYmm = v;
      })));
      return true;
    case "zx":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "elliptical-gaussian") p.beam.waistPositionXmm = v;
      })));
      return true;
    case "zy":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "elliptical-gaussian") p.beam.waistPositionYmm = v;
      })));
      return true;
    case "m2x":
      numDraft(key, raw, (v) => setProject((p) => {
        if (p.beam.kind !== "elliptical-gaussian") return;
        if (v === undefined) delete p.beam.m2x;
        else if (typeof v === "number") p.beam.m2x = v;
      }), { optional: true });
      return true;
    case "m2y":
      numDraft(key, raw, (v) => setProject((p) => {
        if (p.beam.kind !== "elliptical-gaussian") return;
        if (v === undefined) delete p.beam.m2y;
        else if (typeof v === "number") p.beam.m2y = v;
      }), { optional: true });
      return true;
    case "d4x":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "moment") p.beam.d4SigmaDiameterXmm = v;
      })));
      return true;
    case "d4y":
      numDraft(key, raw, (v) => setProject((p) => {
        if (p.beam.kind !== "moment") return;
        if (v === undefined) delete p.beam.d4SigmaDiameterYmm;
        else if (typeof v === "number") p.beam.d4SigmaDiameterYmm = v;
      }), { optional: true });
      return true;
    case "mzx":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "moment") p.beam.waistPositionXmm = v;
      })));
      return true;
    case "mzy":
      numDraft(key, raw, (v) => setProject((p) => {
        if (p.beam.kind !== "moment") return;
        if (v === undefined) delete p.beam.waistPositionYmm;
        else if (typeof v === "number") p.beam.waistPositionYmm = v;
      }), { optional: true });
      return true;
    case "mm2x":
      numDraft(key, raw, num((v) => setProject((p) => {
        if (p.beam.kind === "moment") p.beam.m2x = v;
      })));
      return true;
    case "mm2y":
      numDraft(key, raw, (v) => setProject((p) => {
        if (p.beam.kind !== "moment") return;
        if (v === undefined) delete p.beam.m2y;
        else if (typeof v === "number") p.beam.m2y = v;
      }), { optional: true });
      return true;
    // mode helper (plain text)
    case "mp1":
      S.modeHelper = { ...S.modeHelper, p1: raw };
      return true;
    case "mp2":
      S.modeHelper = { ...S.modeHelper, p2: raw };
      return true;
    // pulse
    case "pe":
      numDraft(key, raw, num((v) => (S.pulseDraft = { ...S.pulseDraft, pulseEnergyJ: v })));
      return true;
    case "pa":
      numDraft(key, raw, num((v) => (S.pulseDraft = { ...S.pulseDraft, averagePowerW: v })));
      return true;
    case "pr":
      numDraft(key, raw, num((v) => (S.pulseDraft = { ...S.pulseDraft, repetitionRateHz: v })));
      return true;
    case "pd":
      numDraft(key, raw, num((v) => (S.pulseDraft = { ...S.pulseDraft, durationFwhmS: v * durUnitFactor })));
      return true;
    case "pdu":
      S.pulseDurUnit = raw as "fs" | "ps" | "ns";
      S.drafts = {};
      return true;
    case "pshape":
      S.pulseDraft = { ...S.pulseDraft, shape: raw as "gaussian" | "sech2" | "rectangular" };
      return true;
    case "wb":
      S.widthBasis = raw as typeof S.widthBasis;
      return true;
    // selected component
    case "sid": {
      const old = S.selId;
      setProject((p) => {
        const c = p.beamline.find((x) => x.id === old);
        if (c) c.id = raw;
      });
      S.selId = raw;
      return true;
    }
    case "sp":
      numDraft(key, raw, num((v) => setComponentPosition(S.selId, v)));
      return true;
    case "sl":
      numDraft(key, raw, num((v) => mutateSelected((c) => {
        if (c.kind === "free-space") c.lengthMm = v;
      })));
      return true;
    case "sf":
      numDraft(key, raw, num((v) => mutateSelected((c) => {
        if (c.kind === "thin-lens" || c.kind === "cylindrical-lens") c.focalLengthMm = v;
      })));
      return true;
    case "st":
      numDraft(key, raw, num((v) => mutateSelected((c) => {
        if (c.kind === "slab" || c.kind === "thick-lens") c.thicknessMm = v;
      })));
      return true;
    case "sr1":
      numDraft(key, raw, (v) => mutateSelected((c) => {
        if (c.kind === "thick-lens" && v !== undefined) c.radius1Mm = v;
      }), { infinity: true });
      return true;
    case "sr2":
      numDraft(key, raw, (v) => mutateSelected((c) => {
        if (c.kind === "thick-lens" && v !== undefined) c.radius2Mm = v;
      }), { infinity: true });
      return true;
    case "sn":
      numDraft(key, raw, num((v) => mutateSelected((c) => {
        if (c.kind === "slab" || c.kind === "thick-lens") c.refractiveIndex = v;
      })));
      return true;
    case "sa": {
      const sel = selected();
      numDraft(key, raw, (v) => mutateSelected((c) => {
        if (v === undefined && c.kind !== "aperture") {
          if ("apertureRadiusMm" in c) delete c.apertureRadiusMm;
        } else if (typeof v === "number" && c.kind !== "free-space" && c.kind !== "surface-stack") {
          c.apertureRadiusMm = v;
        }
      }), { optional: sel?.kind !== "aperture" });
      return true;
    }
    // optimizer search fields (plain strings)
    case "l1From":
    case "l1To":
    case "l1Step":
    case "l2From":
    case "l2To":
    case "l2Step":
    case "targetZ":
    case "targetRadius":
    case "targetWaistRadius":
    case "targetWaistZ":
    case "minSep":
    case "marginMin":
    case "maxResults":
    case "sensShift":
    case "sensFocal":
    case "sensM2":
      S.opt = { ...S.opt, [key]: raw };
      return true;
    // import tab
    case "zmxText":
      S.imp = { ...S.imp, zmxText: raw };
      return true;
    case "agfText":
      S.imp = { ...S.imp, agfText: raw };
      return true;
    case "impLambda":
      S.imp = { ...S.imp, lambda: raw };
      return true;
    // fit tab
    case "fitCsv":
      S.fit = { ...S.fit, csv: raw };
      return true;
    case "fitBasis":
      S.fit = { ...S.fit, basis: raw as typeof S.fit.basis };
      return true;
    case "fitLambda":
      S.fit = { ...S.fit, lambda: raw };
      return true;
    // field tab
    case "fldN":
      S.fld = { ...S.fld, n: raw };
      return true;
    case "fldDx":
      S.fld = { ...S.fld, dx: raw };
      return true;
    case "fldLambda":
      S.fld = { ...S.fld, lambda: raw };
      return true;
    case "fldWaist":
      S.fld = { ...S.fld, waist: raw };
      return true;
    case "fldAp":
      S.fld = { ...S.fld, ap: raw };
      return true;
    case "fldDist":
      S.fld = { ...S.fld, dist: raw };
      return true;
    case "fldMethod":
      S.fld = { ...S.fld, method: raw as "fresnel" | "angular-spectrum" };
      return true;
    case "bz":
      S.fld = { ...S.fld, bz: raw };
      return true;
    case "fldSp":
      S.fld = { ...S.fld, sp: raw === "real-sag" ? "real-sag" : "ideal" };
      return true;
    // modal
    case "importDraft":
      S.importDraft = raw;
      return true;
    default:
      return false;
  }
}

// ── plot hover (direct DOM fast path — no full re-render per mousemove) ──

function onPlotMove(e: MouseEvent): void {
  const svg = (e.target as Element | null)?.closest<SVGSVGElement>("#env-plot");
  const line = document.querySelector<SVGLineElement>("#hover-line");
  const text = document.querySelector<HTMLElement>("#hover-text");
  if (!svg || !line || !text || !lastPlot?.z) return;
  const rect = svg.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * 940;
  if (sx < PLOT_FRAME.L || sx > PLOT_FRAME.R) {
    line.setAttribute("visibility", "hidden");
    text.textContent = "";
    return;
  }
  const zv = ((sx - PLOT_FRAME.L) / (PLOT_FRAME.R - PLOT_FRAME.L)) * lastPlot.plotEnd;
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < lastPlot.z.length; i += 1) {
    const d = Math.abs(lastPlot.z[i] - zv);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const px = (PLOT_FRAME.L + (lastPlot.z[best] / lastPlot.plotEnd) * (PLOT_FRAME.R - PLOT_FRAME.L)).toFixed(1);
  line.setAttribute("x1", px);
  line.setAttribute("x2", px);
  line.setAttribute("visibility", "visible");
  const wx = lastPlot.rx?.[best];
  const wy = lastPlot.ry?.[best];
  text.textContent = `z ${sig(lastPlot.z[best], 4)} mm · wx ${fmtMm(wx)}${wy !== undefined ? ` · wy ${fmtMm(wy)}` : ""}`;
}

// ── event wiring ──────────────────────────────────────────

app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target.classList.contains("modal-backdrop")) {
    actions["close-modal"]("");
    return;
  }
  const actEl = target.closest<HTMLElement>("[data-act]");
  if (!actEl) return;
  const act = actEl.dataset.act;
  if (act && actions[act]) actions[act](actEl.dataset.arg ?? "");
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  const key = target.dataset.k;
  if (!key) return;
  if (applyField(key, target.value)) rerender();
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const key = target.dataset.k;
  if (!key) return;
  if (applyField(key, target.value)) rerender();
});

app.addEventListener("focusout", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.dataset?.blur) return;
  if (Object.keys(S.drafts).length === 0 && !S.copied) return;
  S.drafts = {};
  S.copied = false;
  const rel = event.relatedTarget as HTMLElement | null;
  // if focus moves to an action button, its click handler re-renders — a
  // re-render here would destroy the button before the click lands
  if (rel && rel.closest("[data-act]")) return;
  rerender();
});

app.addEventListener("mousemove", (event) => onPlotMove(event));
app.addEventListener("mouseout", (event) => {
  const from = (event.target as Element | null)?.closest?.("#env-plot");
  const to = (event.relatedTarget as Element | null)?.closest?.("#env-plot");
  if (from && !to) {
    document.querySelector("#hover-line")?.setAttribute("visibility", "hidden");
    const text = document.querySelector<HTMLElement>("#hover-text");
    if (text) text.textContent = "";
  }
});

render();
