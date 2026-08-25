// Workbench state model and presets, ported from the Claude Design source.

import type {
  BeamWidthBasis,
  BeamWidthMeasurement,
  HeadlessJobResult,
  ImageAnalysisResult,
  MaterialModel,
  ModeForgeProject,
  PulseInput,
  TwoLensOptimizationResult,
  ValidationResult,
} from "../../../packages/api/src/index.ts";
import type { Lang } from "./i18n.ts";
import { loadLang } from "./i18n.ts";

export type Tab = "beamline" | "optimizer" | "import" | "fit" | "field" | "image";

export type PulseDraft = {
  averagePowerW: number;
  repetitionRateHz: number;
  pulseEnergyJ: number;
  durationFwhmS: number;
  shape: PulseInput["shape"];
};

export type OptLensDraft = { id: string; f: string; ap: string };

export type OptState = {
  lenses: OptLensDraft[];
  l1From: string;
  l1To: string;
  l1Step: string;
  l2From: string;
  l2To: string;
  l2Step: string;
  targetZ: string;
  targetRadius: string;
  targetWaistRadius: string;
  targetWaistZ: string;
  minSep: string;
  marginMin: string;
  maxResults: string;
  sensOn: boolean;
  sensShift: string;
  sensFocal: string;
  sensM2: string;
  usePulse: boolean;
};

export type ZmxJob = ValidationResult<Extract<HeadlessJobResult, { kind: "zmx-import" }>>;
export type AgfJob = ValidationResult<Extract<HeadlessJobResult, { kind: "agf-import" }>>;
export type FitJobResult = Extract<HeadlessJobResult, { kind: "measured-beam-fit" }>["result"];
export type FieldJobResult = Extract<HeadlessJobResult, { kind: "field-fresnel" }>["result"];
export type FieldBeamlineResult = Extract<HeadlessJobResult, { kind: "field-beamline" }>["result"];

export type ImportState = {
  zmxText: string;
  agfText: string;
  lambda: string;
  zmx: ZmxJob | null;
  agf: AgfJob | null;
  session: MaterialModel[];
  adoptedCount: number;
};

export type FitState = {
  csv: string;
  basis: BeamWidthBasis;
  lambda: string;
  res: FitJobResult | null;
  meas: BeamWidthMeasurement[] | null;
  errs: string[];
};

export type FieldState = {
  mode: "beamline" | "source";
  n: string;
  dx: string;
  lambda: string;
  waist: string;
  apOn: boolean;
  ap: string;
  dist: string;
  bz: string;
  method: "fresnel" | "angular-spectrum";
  sp: "ideal" | "real-sag";
  srcMode: "gauss" | "hg" | "lg";
  mp1: string;
  mp2: string;
  res: FieldJobResult | null;
  resB: FieldBeamlineResult | null;
  busy: boolean;
  progress: { done: number; total: number } | null;
  errs: string[];
};

// Image analyzer tab (S18e-C). Binary pixel data is intentionally NOT kept in
// this state object: the decoded image lives in module scope of main.ts (like
// the worker handles) and this slice only carries the UI metadata, the
// controls and the released analysis result. `phase` distinguishes the decode
// op from the analyze op while busy; `render` is the v1 raw Float32 copy the
// canvas colormap reads (display-only, no physics in the UI). `decodedDtype`
// is the decoder's original dtype of the main image (the render copy is
// always float32). The only pixel-carrying exception is `darkFrame`: a
// user-picked reference frame, stored as float32 after the dark-lane cast,
// used by the decoder and analyzer in main.ts.
export type BgRect = { x0: number; y0: number; width: number; height: number };
export type ImageBgMethod = "none" | "manual-offset" | "dark-frame" | "rect-median" | "robust-plane" | "auto";
export type ImageRoiMode = "full" | "rect" | "auto";
export type ImageDrawTarget = "roi" | "bg-rect";
export type ImagePreviewView = "closeup" | "full";

export type NumericDraftOptions = { optional?: boolean; infinity?: boolean };

// S22 residual-scale editing must keep decimal prefixes such as "0." and
// "1e" as visible drafts until they become complete numbers. The strict
// decimal grammar also rejects JavaScript-only forms such as hexadecimal
// "0x10". For every pre-existing non-optional numeric field, blank and
// whitespace-only input intentionally retain Number's historical zero value.
export function completeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function numericDraftValue(raw: string, opts: NumericDraftOptions = {}): number | undefined | "Infinity" | null {
  const trimmed = raw.trim();
  if (trimmed === "") return opts.optional ? undefined : 0;
  if (opts.infinity && /^inf(inity)?$/i.test(trimmed)) return "Infinity";
  return completeNumber(raw);
}

export function bgRectEditorAvailable(method: ImageBgMethod): boolean {
  return method === "rect-median" || method === "robust-plane";
}

// A background-rectangle target is meaningful only while its editor is
// rendered. This keeps every method transition on the established ROI drag
// path unless the operator explicitly has a rectangle-capable method open.
export function normalizeImageDrawTarget(drawTarget: ImageDrawTarget, method: ImageBgMethod): ImageDrawTarget {
  return drawTarget === "bg-rect" && bgRectEditorAvailable(method) ? "bg-rect" : "roi";
}

export type ImageRectHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
export type BgRectEditHit = { index: number; rect: BgRect; hit: ImageRectHandle | "move" };
export type IdleImagePointerAction =
  | { kind: "roi-resize"; handle: ImageRectHandle; rect: BgRect }
  | { kind: "roi-move"; rect: BgRect }
  | { kind: "roi-create" }
  | { kind: "bg-rect"; index: number; rect: BgRect; hit: ImageRectHandle | "move" };

export function hitRoiEdit(
  rect: BgRect,
  pt: { x: number; y: number },
  hitPx: number,
  imgW: number,
  imgH: number,
  target: ImageDrawTarget,
): ImageRectHandle | "move" | null {
  const x0 = rect.x0;
  const y0 = rect.y0;
  const x1 = rect.x0 + rect.width;
  const y1 = rect.y0 + rect.height;
  const nearL = Math.abs(pt.x - x0) <= hitPx;
  const nearR = Math.abs(pt.x - x1) <= hitPx;
  const nearT = Math.abs(pt.y - y0) <= hitPx;
  const nearB = Math.abs(pt.y - y1) <= hitPx;
  const inX = pt.x >= x0 - hitPx && pt.x <= x1 + hitPx;
  const inY = pt.y >= y0 - hitPx && pt.y <= y1 + hitPx;
  if (nearT && nearL) return "nw";
  if (nearT && nearR) return "ne";
  if (nearB && nearL) return "sw";
  if (nearB && nearR) return "se";
  if (nearT && inX) return "n";
  if (nearB && inX) return "s";
  if (nearL && inY) return "w";
  if (nearR && inY) return "e";
  if (pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1) {
    // This no-move rule is ROI-specific: near-full-frame background samples remain movable.
    const frameArea = imgW * imgH;
    if (target === "roi" && frameArea > 0 && (rect.width * rect.height) / frameArea >= 0.98) return null;
    return "move";
  }
  return null;
}

export function hitUserBgRectEdit(
  rects: readonly BgRect[],
  pt: { x: number; y: number },
  hitPx: number,
  imgW: number,
  imgH: number,
): BgRectEditHit | null {
  // Later rectangles paint above earlier rectangles, so they also own an
  // overlap during hit testing. This keeps selection, move and resize
  // deterministic when reference samples overlap.
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index];
    const hit = hitRoiEdit(rect, pt, hitPx, imgW, imgH, "bg-rect");
    if (hit) return { index, rect, hit };
  }
  return null;
}

// Idle pointer (draw toggle off): ROI resize handles win, then a user
// background rectangle, then ROI move/create. Display-only auto corner
// rects are never passed in as userBgRects.
export function resolveIdleImagePointerAction(input: {
  bgMethod: ImageBgMethod;
  userBgRects: readonly BgRect[];
  roi: BgRect | null;
  point: { x: number; y: number };
  hitPx: number;
  imageWidth: number;
  imageHeight: number;
}): IdleImagePointerAction {
  const roiHit = input.roi ? hitRoiEdit(input.roi, input.point, input.hitPx, input.imageWidth, input.imageHeight, "roi") : null;
  if (roiHit && roiHit !== "move" && input.roi) {
    return { kind: "roi-resize", handle: roiHit, rect: input.roi };
  }
  if (bgRectEditorAvailable(input.bgMethod) && input.userBgRects.length > 0) {
    const bgHit = hitUserBgRectEdit(input.userBgRects, input.point, input.hitPx, input.imageWidth, input.imageHeight);
    if (bgHit) return { kind: "bg-rect", index: bgHit.index, rect: bgHit.rect, hit: bgHit.hit };
  }
  if (roiHit === "move" && input.roi) return { kind: "roi-move", rect: input.roi };
  return { kind: "roi-create" };
}

// Keep the full-frame override paired with the draw-target transition that
// caused it.  In particular, this avoids leaving the preview forced to full
// after an indirect exit such as applying an ROI suggestion or changing the
// background method.
export type ImageDrawModeState = Pick<ImageTabState, "bgMethod" | "drawTarget" | "previewView" | "previewViewBeforeBgDraw">;

export function transitionImageDrawMode(
  state: ImageDrawModeState,
  bgMethod: ImageBgMethod,
  requestedDrawTarget: ImageDrawTarget,
): ImageDrawModeState {
  const currentDrawTarget = normalizeImageDrawTarget(state.drawTarget, state.bgMethod);
  const drawTarget = normalizeImageDrawTarget(requestedDrawTarget, bgMethod);
  if (currentDrawTarget === "roi" && drawTarget === "bg-rect") {
    return { bgMethod, drawTarget, previewView: "full", previewViewBeforeBgDraw: state.previewView };
  }
  if (currentDrawTarget === "bg-rect" && drawTarget === "roi") {
    return {
      bgMethod,
      drawTarget,
      previewView: state.previewViewBeforeBgDraw ?? state.previewView,
      previewViewBeforeBgDraw: null,
    };
  }
  return { bgMethod, drawTarget, previewView: state.previewView, previewViewBeforeBgDraw: state.previewViewBeforeBgDraw };
}

// A direct view selection is an explicit operator preference. It must win
// over a remembered view when the background-draw mode later exits.
export function selectImagePreviewView(previewView: ImagePreviewView): Pick<ImageTabState, "previewView" | "previewViewBeforeBgDraw"> {
  return { previewView, previewViewBeforeBgDraw: null };
}

// Both suggestion buttons share this reducer, so accepting a proposal always
// leaves background-rectangle drawing before it writes the ROI draft.
export function applySuggestedImageRoi(
  state: ImageDrawModeState,
  rect: BgRect,
): ImageDrawModeState & Pick<ImageTabState, "roiMode" | "roiX0" | "roiY0" | "roiW" | "roiH"> {
  return {
    ...transitionImageDrawMode(state, state.bgMethod, "roi"),
    roiMode: "rect",
    roiX0: String(rect.x0),
    roiY0: String(rect.y0),
    roiW: String(rect.width),
    roiH: String(rect.height),
  };
}
// Which of the six released line profiles the profile plot draws. Display
// selection only — the engine always releases all six.
export type ImageProfileKey = "cutX" | "cutY" | "projectionX" | "projectionY" | "axisMajor" | "axisMinor";
export type ImageColorMap = "gray" | "turbo" | "viridis";
// Residual controls are display-only. They never alter an analysis request or
// a saved project.
export type ImageResidualMode = "counts" | "percent-peak" | "sigma";
export type DarkFrameDraft = {
  name: string;
  width: number;
  height: number;
  // The decoder's dtype is retained for an honest loaded-frame note; `dtype`
  // remains float32 because the analysis engine receives the converted copy.
  sourceDtype: string;
  dtype: string;
  pixels: Float32Array;
};
export type DarkError =
  | { kind: "dimensions"; darkWidth: number; darkHeight: number; imageWidth: number; imageHeight: number }
  | { kind: "decode"; detail: string[] }
  | { kind: "dtype"; darkDtype: string; imageDtype: string };
export type ImageTabState = {
  fileName: string;
  loaded: boolean;
  busy: boolean;
  phase: "decode" | "analyze" | null;
  width: number;
  height: number;
  decodedDtype: string;
  page: string;
  pageCount: number;
  channel: string;
  channels: string[];
  calX: string;
  calY: string;
  bgMethod: ImageBgMethod;
  bgOffset: string;
  bgRects: BgRect[];
  // Canvas drag target. Background rectangles are editable only for the two
  // rectangle-backed background methods; method transitions normalize this to
  // ROI so the established ROI drag path remains the fallback.
  drawTarget: ImageDrawTarget;
  // The selected background rectangle survives method changes and is clamped
  // to a valid rectangle whenever the list changes.
  activeBgRectIndex: number | null;
  darkFrame: DarkFrameDraft | null;
  darkError: DarkError | null;
  roiMode: ImageRoiMode;
  roiX0: string;
  roiY0: string;
  roiW: string;
  roiH: string;
  // Display framing only — close-up (3×D4) or full sensor. Not the analysis ROI.
  previewView: ImagePreviewView;
  // While background rectangles are drawn, the preview is forced to full
  // frame. This saves the operator's prior framing for the matching exit.
  previewViewBeforeBgDraw: ImagePreviewView | null;
  // Display-only color map for the preview blit. Default gray is the current
  // linear 8-bit stretch; turbo/viridis are LUTs over that same stretch.
  colorMap: ImageColorMap;
  // Profile plot selection (display only).
  profileKey: ImageProfileKey;
  // The manual shared S scale is stored in counts so a mode switch merely
  // relabels it, just as it relabels the residual maps.
  residualMode: ImageResidualMode;
  residualManualScaleCounts: number | null;
  // Non-shrink note of the "ROI from fit" button: the rectangle key
  // `${x0}:${y0}:${width}:${height}` the note was raised for. The note is
  // rendered only while the draft rectangle still has that key, so ANY later
  // change to the rectangle (button, suggestion, typing, drag) clears it
  // without a reset call in every one of those paths.
  roiFitNote: string | null;
  roiClampNote: string | null;
  result: ImageAnalysisResult | null;
  render: { kind: "raw"; pixels: Float32Array } | null;
  errs: string[];
  // Monotonic token: load/re-decode bumps it so an in-flight analyze cannot
  // write into a later image. Same idea as the field-tab job token.
  imageJobGeneration: number;
  settingsNote: "reset" | "adjusted" | "dark-dtype-changed" | null;
};

export type AppState = {
  lang: Lang;
  tab: Tab;
  presetId: string;
  project: ModeForgeProject;
  pulseOn: boolean;
  pulseMode: "energy" | "avg";
  pulseDraft: PulseDraft;
  pulseDurUnit: "fs" | "ps" | "ns";
  widthBasis: BeamWidthBasis;
  selId: string | null;
  drafts: Record<string, string>;
  modal: "json" | null;
  modalMode: "export" | "import";
  importDraft: string;
  importErrors: string[];
  copied: boolean;
  modeHelper: { type: "HG" | "LG"; p1: string; p2: string };
  opt: OptState;
  optResult: TwoLensOptimizationResult | null;
  optBusy: boolean;
  optSel: number;
  optErrors: string[];
  imp: ImportState;
  fit: FitState;
  fld: FieldState;
  img: ImageTabState;
};

export type PresetDef = {
  id: string;
  pulseOn: boolean;
  make: () => ModeForgeProject;
};

export const PRESETS: PresetDef[] = [
  {
    id: "focus",
    pulseOn: true,
    make: () => ({
      version: "0.1",
      beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0, powerW: 1 },
      beamline: [
        { id: "window", kind: "slab", thicknessMm: 2, refractiveIndex: 1.45, apertureRadiusMm: 5 },
        { id: "drift-1", kind: "free-space", lengthMm: 80 },
        { id: "L1", kind: "thick-lens", radius1Mm: 50, radius2Mm: -50, thicknessMm: 5, refractiveIndex: 1.5, apertureRadiusMm: 12 },
        { id: "to-sample", kind: "free-space", lengthMm: 120 },
      ],
    }),
  },
  {
    id: "telescope",
    pulseOn: false,
    make: () => ({
      version: "0.1",
      beam: { kind: "gaussian", wavelengthUm: 0.78, waistRadiusMm: 0.4, waistPositionMm: 0, powerW: 0.05 },
      beamline: [
        { id: "drift-1", kind: "free-space", lengthMm: 100 },
        { id: "L1", kind: "thin-lens", focalLengthMm: 100, apertureRadiusMm: 6 },
        { id: "drift-2", kind: "free-space", lengthMm: 300 },
        { id: "L2", kind: "thin-lens", focalLengthMm: 200, apertureRadiusMm: 1 },
        { id: "drift-3", kind: "free-space", lengthMm: 200 },
      ],
    }),
  },
  {
    id: "astig",
    pulseOn: false,
    make: () => ({
      version: "0.1",
      beam: {
        kind: "elliptical-gaussian",
        wavelengthUm: 0.405,
        waistRadiusXmm: 0.03,
        waistRadiusYmm: 0.12,
        waistPositionXmm: 0,
        waistPositionYmm: 0,
        powerW: 0.12,
        m2x: 1.1,
        m2y: 1.3,
      },
      beamline: [
        { id: "drift-1", kind: "free-space", lengthMm: 50 },
        { id: "CL1", kind: "cylindrical-lens", focalLengthMm: 100, axis: "x", apertureRadiusMm: 6 },
        { id: "drift-2", kind: "free-space", lengthMm: 150 },
      ],
    }),
  },
];

export function initialState(): AppState {
  return {
    lang: loadLang(),
    tab: "beamline",
    presetId: "focus",
    project: PRESETS[0].make(),
    pulseOn: true,
    pulseMode: "avg",
    pulseDraft: { averagePowerW: 1, repetitionRateHz: 1000, pulseEnergyJ: 0.001, durationFwhmS: 1e-13, shape: "gaussian" },
    pulseDurUnit: "fs",
    widthBasis: "one_over_e2_radius",
    selId: null,
    drafts: {},
    modal: null,
    modalMode: "export",
    importDraft: "",
    importErrors: [],
    copied: false,
    modeHelper: { type: "HG", p1: "1", p2: "0" },
    opt: {
      lenses: [
        { id: "f050", f: "50", ap: "10" },
        { id: "f100", f: "100", ap: "10" },
        { id: "f150", f: "150", ap: "10" },
        { id: "f200", f: "200", ap: "10" },
      ],
      l1From: "60",
      l1To: "140",
      l1Step: "20",
      l2From: "220",
      l2To: "380",
      l2Step: "20",
      targetZ: "500",
      targetRadius: "0.5",
      targetWaistRadius: "",
      targetWaistZ: "",
      minSep: "50",
      marginMin: "1.5",
      maxResults: "8",
      sensOn: true,
      sensShift: "1",
      sensFocal: "1",
      sensM2: "0.1",
      usePulse: false,
    },
    optResult: null,
    optBusy: false,
    optSel: 1,
    optErrors: [],
    imp: { zmxText: "", agfText: "", lambda: "0.5876", zmx: null, agf: null, session: [], adoptedCount: 0 },
    fit: { csv: "", basis: "one_over_e2_radius", lambda: "0.632", res: null, meas: null, errs: [] },
    fld: {
      mode: "beamline",
      n: "48",
      dx: "0.05",
      lambda: "1.064",
      waist: "0.3",
      apOn: false,
      ap: "0.35",
      dist: "150",
      bz: "",
      method: "fresnel",
      sp: "ideal",
      srcMode: "gauss",
      mp1: "1",
      mp2: "0",
      res: null,
      resB: null,
      busy: false,
      progress: null,
      errs: [],
    },
    img: {
      fileName: "",
      loaded: false,
      busy: false,
      phase: null,
      width: 0,
      height: 0,
      decodedDtype: "",
      page: "1",
      pageCount: 1,
      channel: "gray",
      channels: [],
      calX: "",
      calY: "",
      bgMethod: "none",
      bgOffset: "",
      bgRects: [],
      drawTarget: "roi",
      activeBgRectIndex: null,
      darkFrame: null,
      darkError: null,
      roiMode: "full",
      roiX0: "",
      roiY0: "",
      roiW: "",
      roiH: "",
      previewView: "closeup",
      previewViewBeforeBgDraw: null,
      colorMap: "gray",
      profileKey: "cutX",
      residualMode: "counts",
      residualManualScaleCounts: null,
      roiFitNote: null,
      roiClampNote: null,
      result: null,
      render: null,
      errs: [],
      imageJobGeneration: 0,
      settingsNote: null,
    },
  };
}
