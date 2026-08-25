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
import { toAnalysisFloat32 } from "./image-pixels.ts";
import { plotVals, PLOT_FRAME, type PlotVals } from "./plot.ts";
import {
  PRESETS,
  applySuggestedImageRoi,
  normalizeImageDrawTarget,
  selectImagePreviewView,
  transitionImageDrawMode,
  type ImageColorMap,
  type ImageDrawTarget,
  type ImageProfileKey,
} from "./state.ts";
import { S } from "./store.ts";
import { renderBeamlineTab } from "./views/beamline.ts";
import { exportProject, renderHeader, renderModal } from "./views/chrome.ts";
import { renderFieldTab, projectBeamW0 } from "./views/field.ts";
import { renderFitTab } from "./views/fit.ts";
import { renderImportTab } from "./views/importTab.ts";
import {
  buildAnalysisCsv,
  buildAnalysisSummaryJson,
  buildProfilePlotData,
  imageRoiStateKey,
  IMAGE_PROFILE_KEYS,
  profileLabel,
  renderImageTab,
  roiFromFitEligible,
  resolveTypedRoi,
  type ProfilePlotData,
} from "./views/image.ts";
import { rangeArray, renderOptimizerTab, solutionComponents } from "./views/optimizer.ts";
import "./base.css";
import "./workbench.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("ModeForge app root is missing");
const app = appRoot;

let lastPlot: PlotVals | null = null;

// ── rendering ─────────────────────────────────────────────

const SCROLL_CONTAINERS = [".wb-shell", ".wb-workspace", ".wb-center", ".wb-side", ".wb-results"] as const;

type ScrollSnap = {
  windowX: number;
  windowY: number;
  inners: ReadonlyArray<{ selector: string; top: number; left: number }>;
};

function imageTabMounted(): boolean {
  return Boolean(app.querySelector("[data-act=\"img-run\"]"));
}

function captureScroll(): ScrollSnap {
  const inners: Array<{ selector: string; top: number; left: number }> = [];
  for (const selector of SCROLL_CONTAINERS) {
    const el = app.querySelector<HTMLElement>(selector);
    if (!el) continue;
    inners.push({ selector, top: el.scrollTop, left: el.scrollLeft });
  }
  return { windowX: window.scrollX, windowY: window.scrollY, inners };
}

function restoreScroll(snap: ScrollSnap): void {
  const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const maxX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
  window.scrollTo(Math.min(Math.max(0, snap.windowX), maxX), Math.min(Math.max(0, snap.windowY), maxY));
  for (const inner of snap.inners) {
    const el = app.querySelector<HTMLElement>(inner.selector);
    if (!el) continue;
    el.scrollTop = Math.min(Math.max(0, inner.top), Math.max(0, el.scrollHeight - el.clientHeight));
    el.scrollLeft = Math.min(Math.max(0, inner.left), Math.max(0, el.scrollWidth - el.clientWidth));
  }
}

function render(afterDraw?: () => void): void {
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
  } else if (S.tab === "image") {
    body = renderImageTab(T);
  } else {
    body = renderFieldTab(T);
  }
  app.innerHTML = `
    <div class="wb-shell">
      ${renderHeader(T)}
      ${body}
      ${renderModal(T)}
    </div>`;
  requestAnimationFrame(() => {
    drawFieldCanvases();
    afterDraw?.();
  });
}

function focusSelector(active: HTMLElement): string | null {
  const key = active.dataset.k;
  if (key) return `[data-k="${CSS.escape(key)}"]`;
  const act = active.dataset.act;
  if (!act) return null;
  let selector = `[data-act="${CSS.escape(act)}"]`;
  const arg = active.dataset.arg;
  if (arg !== undefined && arg !== "") selector += `[data-arg="${CSS.escape(arg)}"]`;
  const index = active.dataset.i;
  if (index !== undefined && index !== "") selector += `[data-i="${CSS.escape(index)}"]`;
  return selector;
}

function rerender(): void {
  const preserveScroll = S.tab === "image" && imageTabMounted();
  const snap = preserveScroll ? captureScroll() : null;
  const active = document.activeElement as HTMLElement | null;
  const focusSel = active && app.contains(active) ? focusSelector(active) : null;
  let selStart: number | null = null;
  let selEnd: number | null = null;
  if (active?.dataset?.k && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
    try {
      selStart = active.selectionStart;
      selEnd = active.selectionEnd;
    } catch {
      selStart = null;
    }
  }
  const restoreFocus = (): void => {
    if (!focusSel) return;
    const el = app.querySelector<HTMLElement>(focusSel);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (selStart !== null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      try {
        el.setSelectionRange(selStart, selEnd ?? selStart);
      } catch {
        /* selects etc. */
      }
    }
  };
  render(() => {
    if (snap) restoreScroll(snap);
    restoreFocus();
  });
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

// Display-only framing and contrast. Not physics: the UI never recomputes
// widths or fits, it only decides which pixels to show and how to map them
// to 8-bit gray. A compact lab spot on a large sensor (typical: ~100 px
// D4 on 1600×1200, background 0–2 counts) is framed close-up so ring
// structure stays visible; contrast uses a 1–99.99 percentile of the
// *visible* pixels so a hot pixel cannot wash the frame while the beam
// core is not clipped to white. Linear LUT — sqrt flattened the core.
// Overlay presentation: D4sigma = solid green ellipse, fit = dashed orange
// ellipse, next-run ROI = solid blue rectangle (typed or drag-drawn),
// background samples = purple rectangles, suggested ROI = dashed cyan
// rectangle. Overlay strokes (ellipses, axes, centroid, ROI rects) get a
// two-pass dark halo (all underlays, then all
// colored strokes) so pinned colors stay readable on turbo/viridis without
// a later halo burying a neighbor; legend/caption keep boxes.
// Rectangles are drawn and listed only when an edge falls inside the crop.
// Compact spots default to a 3×D4 close-up; the view toggle switches to the
// full sensor so a larger ROI can actually be seen (a full-frame ROI has no
// edge in the close-up).
// A footer states that a 4sigma ellipse encloses about 86 percent of
// Gaussian power. ROI drag is a canvas overlay fast path: no innerHTML
// rerender per mousemove; state commits on pointerup. Empty space draws a
// new rectangle; the interior of the blue draft moves it; an edge or
// corner resizes it.
type PixelView = { x0: number; y0: number; width: number; height: number };
type OverlayRect = { x0: number; y0: number; width: number; height: number };

type OverlayEllipse = {
  cx: number;
  cy: number;
  majorPx: number;
  minorPx: number;
  thetaRad: number;
  color: string;
};

type ImageOverlay = {
  roi: OverlayRect | null;
  suggestion: OverlayRect | null;
  bgRects: OverlayRect[];
  activeBgRectIndex: number | null;
  centroid: { x: number; y: number } | null;
  ellipse: OverlayEllipse | null;
  fitEllipse: OverlayEllipse | null;
};

type OverlayStroke = {
  paint: (ctx: CanvasRenderingContext2D) => void;
  width: number;
  dash: number[];
  color: string;
  alpha?: number;
};

type RoiHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
type RoiDragKind = "create" | "move" | "resize";

type RoiDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
  kind: RoiDragKind;
  handle: RoiHandle | null;
  origin: OverlayRect | null;
  target: ImageDrawTarget;
  // Null means a background-rectangle drag started in empty space and will
  // append its new rectangle on pointerup.
  bgRectIndex: number | null;
};

type ImagePreviewCache = {
  pixels: Float32Array;
  srcW: number;
  srcH: number;
  view: PixelView;
  bitmap: ImageData;
  colorMap: ImageColorMap;
  whitePoint: number;
};

type RgbStop = readonly [number, number, number];

const COLOR_BAR_STRIP_CSS = 12;
const COLOR_BAR_TICK_CSS = 78;
const COLOR_BAR_GAP_CSS = 8;
const COLOR_BAR_PAD_CSS = 4;
const COLOR_BAR_LAYOUT_W = COLOR_BAR_GAP_CSS + COLOR_BAR_STRIP_CSS + COLOR_BAR_PAD_CSS + COLOR_BAR_TICK_CSS;
const COLOR_BAR_TICK_FRACS = [1, 0.75, 0.5, 0.25, 0] as const;

// Display LUTs: interpolated from embedded anchors (offline, no CDN). Grayscale
// does not use a LUT — the blit writes the stretch byte to R=G=B as before.
const TURBO_ANCHORS: readonly RgbStop[] = [
  [48, 18, 59],
  [70, 51, 147],
  [61, 87, 211],
  [47, 124, 224],
  [34, 155, 208],
  [28, 179, 172],
  [41, 196, 126],
  [73, 203, 81],
  [118, 198, 54],
  [160, 185, 47],
  [194, 166, 48],
  [217, 142, 54],
  [231, 114, 65],
  [238, 82, 76],
  [232, 48, 81],
  [122, 4, 3],
];
const VIRIDIS_ANCHORS: readonly RgbStop[] = [
  [68, 1, 84],
  [72, 22, 104],
  [71, 46, 124],
  [65, 68, 135],
  [57, 88, 140],
  [48, 106, 142],
  [40, 123, 142],
  [33, 140, 141],
  [31, 158, 137],
  [41, 175, 127],
  [66, 190, 113],
  [105, 201, 90],
  [152, 210, 62],
  [201, 218, 43],
  [243, 227, 38],
  [253, 231, 37],
];

function interpolateLut(anchors: readonly RgbStop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const last = anchors.length - 1;
  for (let i = 0; i < 256; i += 1) {
    const pos = (i / 255) * last;
    const k = Math.min(last - 1, Math.floor(pos));
    const frac = pos - k;
    const a = anchors[k];
    const b = anchors[k + 1];
    const o = i * 3;
    lut[o] = a[0] + (b[0] - a[0]) * frac;
    lut[o + 1] = a[1] + (b[1] - a[1]) * frac;
    lut[o + 2] = a[2] + (b[2] - a[2]) * frac;
  }
  return lut;
}

const LUT_TURBO = interpolateLut(TURBO_ANCHORS);
const LUT_VIRIDIS = interpolateLut(VIRIDIS_ANCHORS);

function resolveColorMap(value: string): ImageColorMap {
  return value === "turbo" || value === "viridis" ? value : "gray";
}

function colorMapLut(map: ImageColorMap): Uint8ClampedArray | null {
  if (map === "turbo") return LUT_TURBO;
  if (map === "viridis") return LUT_VIRIDIS;
  return null;
}

function mapGrayToRgb(map: ImageColorMap, gray: number): RgbStop {
  const g = Math.max(0, Math.min(255, gray));
  const lut = colorMapLut(map);
  if (!lut) return [g, g, g];
  const o = g * 3;
  return [lut[o], lut[o + 1], lut[o + 2]];
}

let roiDrag: RoiDrag | null = null;
let imagePreviewCache: ImagePreviewCache | null = null;

function fullView(width: number, height: number): PixelView {
  return { x0: 0, y0: 0, width, height };
}

function clampedView(cx: number, cy: number, vw: number, vh: number, imgW: number, imgH: number): PixelView {
  const width = Math.max(1, Math.min(imgW, Math.round(vw)));
  const height = Math.max(1, Math.min(imgH, Math.round(vh)));
  let x0 = Math.round(cx - width / 2);
  let y0 = Math.round(cy - height / 2);
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x0 + width > imgW) x0 = imgW - width;
  if (y0 + height > imgH) y0 = imgH - height;
  return { x0, y0, width, height };
}

function imageDisplayView(imgW: number, imgH: number, overlay: ImageOverlay): PixelView {
  const full = fullView(imgW, imgH);
  // Background rectangles often sit in the corners. Entering their draw mode
  // therefore always reveals the full frame instead of hiding the targets in
  // the compact-spot crop.
  if (S.img.previewView === "full" || isBgRectDrawMode()) return full;
  const frame = overlay.ellipse ?? overlay.fitEllipse;
  const cx = overlay.centroid?.x ?? frame?.cx;
  const cy = overlay.centroid?.y ?? frame?.cy;
  if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return full;
  const major = frame ? Math.max(frame.majorPx, frame.minorPx) : Math.min(imgW, imgH) * 0.2;
  if (!(major > 0) || !Number.isFinite(major)) return full;
  const pad = Math.max(96, major * 3);
  if (pad >= Math.min(imgW, imgH) * 0.85) return full;
  return clampedView(cx, cy, pad, pad, imgW, imgH);
}

function sortedFiniteView(pixels: ArrayLike<number>, srcW: number, view: PixelView): Float32Array {
  const buf = new Float32Array(Math.max(0, view.width * view.height));
  let n = 0;
  for (let y = 0; y < view.height; y += 1) {
    const row = (view.y0 + y) * srcW + view.x0;
    for (let x = 0; x < view.width; x += 1) {
      const value = pixels[row + x];
      if (Number.isFinite(value)) {
        buf[n] = value;
        n += 1;
      }
    }
  }
  const samples = buf.subarray(0, n);
  samples.sort((a, b) => a - b);
  return samples;
}

function rankOf(samples: Float32Array, p: number): number {
  if (samples.length === 0) return 0;
  const idx = Math.min(samples.length - 1, Math.max(0, Math.floor(p * (samples.length - 1))));
  return samples[idx] ?? 0;
}

function stretchLimits(samples: Float32Array, loP: number, hiP: number): { lo: number; hi: number } {
  if (samples.length === 0) return { lo: 0, hi: 1 };
  const lo = rankOf(samples, loP);
  const drop = Math.max(samples.length > 8 ? 1 : 0, Math.round((1 - hiP) * (samples.length - 1)));
  const hi = samples[Math.max(0, samples.length - 1 - drop)] ?? lo;
  if (!(hi > lo)) {
    const span = Math.abs(hi) > 0 ? Math.abs(hi) : 1;
    return { lo, hi: lo + span };
  }
  return { lo, hi };
}

function colorBarTickLabel(value: number): string {
  return `${sig(value, 4)} ${strings(S.lang).imgCountsUnit}`;
}

function paintVerticalLut(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, map: ImageColorMap): void {
  if (width <= 0 || height <= 0) return;
  const img = ctx.createImageData(width, height);
  let dst = 0;
  const denom = Math.max(1, height - 1);
  for (let row = 0; row < height; row += 1) {
    const gray = Math.round((1 - row / denom) * 255);
    const rgb = mapGrayToRgb(map, gray);
    for (let col = 0; col < width; col += 1) {
      img.data[dst] = rgb[0];
      img.data[dst + 1] = rgb[1];
      img.data[dst + 2] = rgb[2];
      img.data[dst + 3] = 255;
      dst += 4;
    }
  }
  ctx.putImageData(img, x, y);
}

function drawColorBarBundle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  pxScale: number,
  map: ImageColorMap,
  whitePoint: number,
): void {
  const strip = Math.max(1, Math.round(COLOR_BAR_STRIP_CSS * pxScale));
  const gap = Math.max(1, Math.round(COLOR_BAR_GAP_CSS * pxScale));
  const pad = Math.max(1, Math.round(COLOR_BAR_PAD_CSS * pxScale));
  const ticks = Math.max(1, Math.round(COLOR_BAR_TICK_CSS * pxScale));
  ctx.fillStyle = "#070a0f";
  ctx.fillRect(x, y, gap + strip + pad + ticks, height);
  paintVerticalLut(ctx, x + gap, y, strip, height, map);
  const fontPx = Math.max(8, 9 * pxScale);
  ctx.font = `500 ${fontPx}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = "#97A1B2";
  ctx.textAlign = "left";
  const tx = x + gap + strip + pad;
  const denom = Math.max(1, height - 1);
  for (const frac of COLOR_BAR_TICK_FRACS) {
    const ty = y + (1 - frac) * denom;
    ctx.textBaseline = frac === 1 ? "top" : frac === 0 ? "bottom" : "middle";
    ctx.fillText(colorBarTickLabel(whitePoint * frac), tx, ty);
  }
}

function layoutImageColorBar(imageCanvas: HTMLCanvasElement, map: ImageColorMap, whitePoint: number): void {
  const wrap = document.querySelector<HTMLElement>("#img-colorbar");
  const strip = document.querySelector<HTMLCanvasElement>("#img-colorbar-canvas");
  const ticks = document.querySelector<HTMLElement>("#img-colorbar-ticks");
  if (!wrap || !strip || !ticks) return;
  const cssH = Math.max(1, imageCanvas.clientHeight);
  wrap.style.height = `${cssH}px`;
  const dpr = devicePixelRatioSafe();
  const bw = Math.max(1, Math.round(COLOR_BAR_STRIP_CSS * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (strip.width !== bw || strip.height !== bh) {
    strip.width = bw;
    strip.height = bh;
  }
  strip.style.width = `${COLOR_BAR_STRIP_CSS}px`;
  strip.style.height = `${cssH}px`;
  const ctx = strip.getContext("2d");
  if (ctx) paintVerticalLut(ctx, 0, 0, strip.width, strip.height, map);
  ticks.replaceChildren();
  for (const frac of COLOR_BAR_TICK_FRACS) {
    const el = document.createElement("div");
    el.className = "img-colorbar-tick";
    el.textContent = colorBarTickLabel(whitePoint * frac);
    el.style.top = `${(1 - frac) * 100}%`;
    if (frac === 1) el.dataset.align = "start";
    else if (frac === 0) el.dataset.align = "end";
    ticks.appendChild(el);
  }
}

function previewLayoutWidth(canvas: HTMLCanvasElement): number {
  // Measure the CARD content box, not a fit-content wrapper around the
  // canvas. Walking the stack first is circular once the stack shrinks to
  // the canvas; the card width is independent of the bitmap scale.
  const reserve = canvas.id === "img-canvas" ? COLOR_BAR_LAYOUT_W : 0;
  const card = canvas.closest(".img-frame-card") ?? canvas.closest(".mf-card");
  if (card instanceof HTMLElement && card.clientWidth > 0) {
    const style = getComputedStyle(card);
    const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    return Math.max(1, card.clientWidth - pad - reserve);
  }
  const stack = canvas.closest(".img-preview-stack");
  if (stack instanceof HTMLElement && stack.clientWidth > 0) return Math.max(1, stack.clientWidth - reserve);
  return Math.max(1, (canvas.parentElement?.clientWidth ?? 0) - reserve);
}

function fitCanvasLayout(canvas: HTMLCanvasElement, bitmapW: number, bitmapH: number): number {
  const parentW = previewLayoutWidth(canvas);
  const maxH = Math.min(typeof window !== "undefined" ? window.innerHeight * 0.64 : 640, 640);
  const maxW = parentW > 0 ? parentW : bitmapW;
  const scale = Math.min(maxW / Math.max(1, bitmapW), maxH / Math.max(1, bitmapH));
  const cssW = Math.max(1, Math.round(bitmapW * scale));
  const cssH = Math.max(1, Math.round(bitmapH * scale));
  // Pixel caps from the card, not max-width:100% of a shrink-to-fit parent
  // (that percentage is cyclic and collapses to the backing-store size).
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.maxWidth = `${maxW}px`;
  canvas.style.maxHeight = `${maxH}px`;
  canvas.style.aspectRatio = `${bitmapW} / ${bitmapH}`;
  canvas.style.objectFit = "contain";
  canvas.style.objectPosition = "center";
  return cssW / Math.max(1, bitmapW);
}

function devicePixelRatioSafe(): number {
  return typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
}

function sizeOverlayCanvas(overlay: HTMLCanvasElement, imageCanvas: HTMLCanvasElement): { dpr: number; cssW: number; cssH: number } {
  const dpr = devicePixelRatioSafe();
  // Lock to the image canvas used box (not the full card-wide stack). Same
  // pixel max-width/max-height so a later CSS shrink cannot leave the overlay
  // at a stale size; ResizeObserver re-runs layout+redraw on size change.
  const cssW = Math.max(1, imageCanvas.clientWidth);
  const cssH = Math.max(1, imageCanvas.clientHeight);
  overlay.style.maxWidth = imageCanvas.style.maxWidth || "100%";
  overlay.style.maxHeight = imageCanvas.style.maxHeight || `${Math.min(typeof window !== "undefined" ? window.innerHeight * 0.64 : 640, 640)}px`;
  overlay.style.width = `${cssW}px`;
  overlay.style.height = `${cssH}px`;
  overlay.style.left = `${imageCanvas.offsetLeft}px`;
  overlay.style.top = `${imageCanvas.offsetTop}px`;
  overlay.style.right = "auto";
  overlay.style.bottom = "auto";
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (overlay.width !== bw || overlay.height !== bh) {
    overlay.width = bw;
    overlay.height = bh;
  }
  return { dpr, cssW, cssH };
}

let imagePreviewResizeObserver: ResizeObserver | null = null;
let imagePreviewResizeTimer = 0;
let imagePreviewLastLayout = { parentW: 0, w: 0, h: 0 };

function scheduleImagePreviewRelayout(): void {
  if (imagePreviewResizeTimer) window.clearTimeout(imagePreviewResizeTimer);
  imagePreviewResizeTimer = window.setTimeout(() => {
    imagePreviewResizeTimer = 0;
    const el = document.querySelector<HTMLCanvasElement>("#img-canvas");
    if (!el || S.tab !== "image") return;
    const parentW = previewLayoutWidth(el);
    const w = el.clientWidth;
    const h = el.clientHeight;
    // Parent width must be part of the key: a height-capped canvas keeps the
    // same CSS pixels when the card grows, but fitCanvasLayout still needs
    // to re-run so the image can fill up to the 640 px cap again.
    if (parentW === imagePreviewLastLayout.parentW && w === imagePreviewLastLayout.w && h === imagePreviewLastLayout.h) {
      return;
    }
    drawFieldCanvases();
  }, 48);
}

function ensureImagePreviewObserver(canvas: HTMLCanvasElement): void {
  if (typeof ResizeObserver === "undefined") return;
  if (!imagePreviewResizeObserver) {
    imagePreviewResizeObserver = new ResizeObserver(() => scheduleImagePreviewRelayout());
    window.addEventListener("resize", () => scheduleImagePreviewRelayout());
  }
  imagePreviewResizeObserver.disconnect();
  imagePreviewResizeObserver.observe(canvas);
  const stack = canvas.closest(".img-preview-stack");
  if (stack) imagePreviewResizeObserver.observe(stack);
  const host = canvas.closest(".img-frame-card") ?? canvas.parentElement;
  if (host) imagePreviewResizeObserver.observe(host);
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

function sameOverlayRect(a: OverlayRect, b: OverlayRect): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.width === b.width && a.height === b.height;
}

function integerRoiRect(x0: number, y0: number, width: number, height: number, imgW: number, imgH: number): OverlayRect | null {
  if (!(imgW > 0 && imgH > 0)) return null;
  if (![x0, y0, width, height].every((value) => Number.isFinite(value))) return null;
  const rx0 = Math.round(x0);
  const ry0 = Math.round(y0);
  const rw = Math.round(width);
  const rh = Math.round(height);
  if (rw < 1 || rh < 1 || rx0 < 0 || ry0 < 0 || rx0 + rw > imgW || ry0 + rh > imgH) return null;
  return { x0: rx0, y0: ry0, width: rw, height: rh };
}

function boundsRoiRect(x0: number, y0: number, x1: number, y1: number, imgW: number, imgH: number): OverlayRect | null {
  if (!(imgW > 0 && imgH > 0) || ![x0, y0, x1, y1].every((value) => Number.isFinite(value))) return null;
  const left = Math.max(0, Math.min(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const right = Math.min(imgW, Math.max(x0, x1));
  const bottom = Math.min(imgH, Math.max(y0, y1));
  const rx0 = Math.round(left);
  const ry0 = Math.round(top);
  const rx1 = Math.max(rx0 + 1, Math.round(right));
  const ry1 = Math.max(ry0 + 1, Math.round(bottom));
  return integerRoiRect(rx0, ry0, Math.min(imgW - rx0, rx1 - rx0), Math.min(imgH - ry0, ry1 - ry0), imgW, imgH);
}

function draftRoiRect(): OverlayRect | null {
  const st = S.img;
  if (st.roiMode !== "rect" || st.width <= 0 || st.height <= 0) return null;
  const resolved = resolveTypedRoi(st.roiX0, st.roiY0, st.roiW, st.roiH, st.width, st.height);
  if (resolved.kind === "valid" || resolved.kind === "clamped") return resolved.rect;
  return null;
}

function roiDraftKey(st: typeof S.img): string {
  return `${st.roiMode}|${st.roiX0}|${st.roiY0}|${st.roiW}|${st.roiH}`;
}

function commitClampedRoi(st: typeof S.img, rect: OverlayRect): typeof S.img {
  const next = {
    ...st,
    roiX0: String(rect.x0),
    roiY0: String(rect.y0),
    roiW: String(rect.width),
    roiH: String(rect.height),
  };
  return { ...next, roiClampNote: roiDraftKey(next) };
}

function syncTypedRoi(st: typeof S.img): typeof S.img {
  if (st.roiMode !== "rect" || st.width <= 0 || st.height <= 0) return st;
  const resolved = resolveTypedRoi(st.roiX0, st.roiY0, st.roiW, st.roiH, st.width, st.height);
  if (resolved.kind === "clamped") return commitClampedRoi(st, resolved.rect);
  return st;
}

function fullFrameRoiRect(): OverlayRect | null {
  const st = S.img;
  if (st.roiMode !== "full" || st.width <= 0 || st.height <= 0) return null;
  return { x0: 0, y0: 0, width: st.width, height: st.height };
}

const BG_RECT_OVERLAY_COLOR = "#C58BF2";

function isBgRectDrawMode(): boolean {
  return normalizeImageDrawTarget(S.img.drawTarget, S.img.bgMethod) === "bg-rect";
}

function validActiveBgRectIndex(rects: readonly OverlayRect[] = S.img.bgRects, index: number | null = S.img.activeBgRectIndex): number | null {
  if (rects.length === 0) return null;
  return index !== null && Number.isInteger(index) && index >= 0 && index < rects.length ? index : 0;
}

// ── ROI from the released widths (shrink-spiral fix) ──────────────────────
//
// The button used to read the RAW Gauss fit sigmas. On a ringed, clearly
// non-Gaussian spot that is a positive feedback loop: every narrower window
// makes the least-squares Gaussian narrower, which produces a still narrower
// window on the next click. Two changes break it.
//
// (a) Source. The released stage-B D4sigma ellipse (an aperture-integrated
//     second-moment width) is used whenever stage B was released; the fit
//     sigmas are only the fallback for a suppressed stage B.
// (b) Scale. Semi-axes 1.5 * D4sigma equal 6 * sigma (D4sigma = 4 * sigma),
//     which is exactly the check ellipse packages/image/src/aperture.ts uses
//     for its clipping gate. The axis-aligned bounding box of that ellipse is
//     therefore the tangency bound of the gate, so the box is widened by a
//     1.25 safety margin and the gate never sits on the ROI boundary.
// The non-shrink clamp that completes the fix lives in the click handler.
const ROI_FROM_D4_SEMI_AXIS_FACTOR = 1.5;
const ROI_FROM_SIGMA_SEMI_AXIS_FACTOR = 6;
const ROI_FROM_FIT_SAFETY_MARGIN = 1.25;
// A derived box below this fraction of the current rectangle area is refused
// (the operator's shrink spiral); the current rectangle is kept instead.
const ROI_NON_SHRINK_MIN_AREA_RATIO = 0.85;

type RoiFromFit = { rect: OverlayRect; source: "d4sigma" | "fit-sigma" };

// Axis-aligned bounding box of an ellipse with semi-axes (a, b) rotated by
// theta: ex = sqrt((a*cos)^2 + (b*sin)^2), ey = sqrt((a*sin)^2 + (b*cos)^2).
function ellipseBoxRect(cx: number, cy: number, a: number, b: number, thetaRad: number, imgW: number, imgH: number): OverlayRect | null {
  if (![cx, cy, a, b, thetaRad].every((value) => Number.isFinite(value))) return null;
  if (!(a > 0 && b > 0)) return null;
  const cos = Math.cos(thetaRad);
  const sin = Math.sin(thetaRad);
  const ex = Math.sqrt(a * cos * (a * cos) + b * sin * (b * sin)) * ROI_FROM_FIT_SAFETY_MARGIN;
  const ey = Math.sqrt(a * sin * (a * sin) + b * cos * (b * cos)) * ROI_FROM_FIT_SAFETY_MARGIN;
  if (!Number.isFinite(ex) || !Number.isFinite(ey) || !(ex > 0) || !(ey > 0)) return null;
  const x0 = Math.max(0, Math.min(imgW - 1, Math.round(cx - ex)));
  const y0 = Math.max(0, Math.min(imgH - 1, Math.round(cy - ey)));
  const x1 = Math.max(x0 + 1, Math.min(imgW, Math.round(cx + ex)));
  const y1 = Math.max(y0 + 1, Math.min(imgH, Math.round(cy + ey)));
  return { x0, y0, width: x1 - x0, height: y1 - y0 };
}

function roiRectFromReleasedWidths(): RoiFromFit | null {
  const st = S.img;
  const result = st.result;
  const imgW = st.width;
  const imgH = st.height;
  if (!result || !(imgW > 0 && imgH > 0)) return null;
  if (!roiFromFitEligible(result)) return null;
  const released = result.moments.stageB;
  if (
    released &&
    released.valid &&
    released.d4SigmaMajorPx !== null &&
    released.d4SigmaMinorPx !== null &&
    released.centroidXPx !== null &&
    released.centroidYPx !== null
  ) {
    const rect = ellipseBoxRect(
      released.centroidXPx,
      released.centroidYPx,
      ROI_FROM_D4_SEMI_AXIS_FACTOR * released.d4SigmaMajorPx,
      ROI_FROM_D4_SEMI_AXIS_FACTOR * released.d4SigmaMinorPx,
      released.thetaRad ?? 0,
      imgW,
      imgH,
    );
    if (rect) return { rect, source: "d4sigma" };
  }
  const gauss = result.fits.gauss2d;
  if (!gauss.converged || !gauss.params || gauss.geometryReleasable !== true) return null;
  const params = gauss.params;
  const rect = ellipseBoxRect(
    params.centerXPx,
    params.centerYPx,
    ROI_FROM_SIGMA_SEMI_AXIS_FACTOR * params.sigmaMajorPx,
    ROI_FROM_SIGMA_SEMI_AXIS_FACTOR * params.sigmaMinorPx,
    params.thetaRad,
    imgW,
    imgH,
  );
  return rect ? { rect, source: "fit-sigma" } : null;
}

function translateRoiRect(origin: OverlayRect, dx: number, dy: number, imgW: number, imgH: number): OverlayRect | null {
  const x0 = Math.max(0, Math.min(origin.x0 + dx, imgW - origin.width));
  const y0 = Math.max(0, Math.min(origin.y0 + dy, imgH - origin.height));
  return integerRoiRect(x0, y0, origin.width, origin.height, imgW, imgH);
}

function resizeRoiRect(origin: OverlayRect, handle: RoiHandle, x: number, y: number, imgW: number, imgH: number): OverlayRect | null {
  let x0 = origin.x0;
  let y0 = origin.y0;
  let x1 = origin.x0 + origin.width;
  let y1 = origin.y0 + origin.height;
  if (handle === "w" || handle === "nw" || handle === "sw") x0 = x;
  if (handle === "e" || handle === "ne" || handle === "se") x1 = x;
  if (handle === "n" || handle === "nw" || handle === "ne") y0 = y;
  if (handle === "s" || handle === "sw" || handle === "se") y1 = y;
  return boundsRoiRect(x0, y0, x1, y1, imgW, imgH);
}

function liveRoiRect(): OverlayRect | null {
  if (!roiDrag) return null;
  const imgW = S.img.width;
  const imgH = S.img.height;
  if (roiDrag.kind === "move" && roiDrag.origin) {
    return translateRoiRect(roiDrag.origin, roiDrag.currentX - roiDrag.startX, roiDrag.currentY - roiDrag.startY, imgW, imgH);
  }
  if (roiDrag.kind === "resize" && roiDrag.origin && roiDrag.handle) {
    return resizeRoiRect(roiDrag.origin, roiDrag.handle, roiDrag.currentX, roiDrag.currentY, imgW, imgH);
  }
  return boundsRoiRect(roiDrag.startX, roiDrag.startY, roiDrag.currentX, roiDrag.currentY, imgW, imgH);
}

function roiEditHitPx(canvas: HTMLCanvasElement, view: PixelView): number {
  const box = canvas.getBoundingClientRect();
  const clientW = Math.max(1, box.width);
  return Math.max(3, (8 * view.width) / clientW);
}

function hitRoiEdit(
  rect: OverlayRect,
  pt: { x: number; y: number },
  hitPx: number,
  imgW: number,
  imgH: number,
  target: ImageDrawTarget,
): RoiHandle | "move" | null {
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

type BgRectEditHit = { index: number; rect: OverlayRect; hit: RoiHandle | "move" };

function hitBgRectEdit(pt: { x: number; y: number }, hitPx: number, imgW: number, imgH: number): BgRectEditHit | null {
  // Later rectangles paint above earlier rectangles, so they also own an
  // overlap during hit testing. This keeps selection, move and resize
  // deterministic when reference samples overlap.
  for (let index = S.img.bgRects.length - 1; index >= 0; index -= 1) {
    const rect = S.img.bgRects[index];
    const hit = hitRoiEdit(rect, pt, hitPx, imgW, imgH, "bg-rect");
    if (hit) return { index, rect, hit };
  }
  return null;
}

function roiCursor(hit: RoiHandle | "move" | "create"): string {
  if (hit === "move") return "move";
  if (hit === "n" || hit === "s") return "ns-resize";
  if (hit === "e" || hit === "w") return "ew-resize";
  if (hit === "ne" || hit === "sw") return "nesw-resize";
  if (hit === "nw" || hit === "se") return "nwse-resize";
  return "crosshair";
}

function drawRoiHandles(strokes: OverlayStroke[], roi: OverlayRect, viewSpan: number, color = "#9CC1F5"): void {
  const arm = Math.max(4, viewSpan / 36);
  const width = Math.max(1.5, viewSpan / 120);
  const x0 = roi.x0 + 0.5;
  const y0 = roi.y0 + 0.5;
  const x1 = roi.x0 + roi.width - 0.5;
  const y1 = roi.y0 + roi.height - 0.5;
  strokes.push({
    color,
    width,
    dash: [],
    paint: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(x0 + arm, y0);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0, y0 + arm);
      ctx.moveTo(x1 - arm, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y0 + arm);
      ctx.moveTo(x0 + arm, y1);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x0, y1 - arm);
      ctx.moveTo(x1 - arm, y1);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1, y1 - arm);
      ctx.stroke();
    },
  });
}

function suggestionRoiRect(): OverlayRect | null {
  const rect = S.img.result?.roi.suggestion?.rect;
  if (!rect) return null;
  return integerRoiRect(rect.x0, rect.y0, rect.width, rect.height, S.img.width, S.img.height);
}

function roiBoundaryVisible(roi: OverlayRect, view: PixelView): boolean {
  const rx0 = roi.x0;
  const ry0 = roi.y0;
  const rx1 = roi.x0 + roi.width;
  const ry1 = roi.y0 + roi.height;
  const vx0 = view.x0;
  const vy0 = view.y0;
  const vx1 = view.x0 + view.width;
  const vy1 = view.y0 + view.height;
  if (!rangesOverlap(rx0, rx1, vx0, vx1) || !rangesOverlap(ry0, ry1, vy0, vy1)) return false;
  const verticalEdgeVisible = (x: number): boolean => x >= vx0 && x <= vx1 && rangesOverlap(ry0, ry1, vy0, vy1);
  const horizontalEdgeVisible = (y: number): boolean => y >= vy0 && y <= vy1 && rangesOverlap(rx0, rx1, vx0, vx1);
  return verticalEdgeVisible(rx0) || verticalEdgeVisible(rx1) || horizontalEdgeVisible(ry0) || horizontalEdgeVisible(ry1);
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [text];
}

function overlayFromResult(): ImageOverlay {
  const result = S.img.result;
  const live = liveRoiRect();
  const roi = roiDrag?.target === "roi" ? live ?? draftRoiRect() ?? fullFrameRoiRect() : draftRoiRect() ?? fullFrameRoiRect();
  const resolvedAutoRects = result?.background.requestedMethod === "auto" && S.img.bgMethod === "auto" ? (result.background.resolvedRects ?? []) : null;
  const bgRects = (resolvedAutoRects ?? S.img.bgRects).map((rect) => ({ x0: rect.x0, y0: rect.y0, width: rect.width, height: rect.height }));
  let activeBgRectIndex = resolvedAutoRects === null ? validActiveBgRectIndex() : null;
  if (resolvedAutoRects === null && roiDrag?.target === "bg-rect" && live) {
    if (roiDrag.bgRectIndex === null) {
      bgRects.push(live);
      activeBgRectIndex = bgRects.length - 1;
    } else if (roiDrag.bgRectIndex >= 0 && roiDrag.bgRectIndex < bgRects.length) {
      bgRects[roiDrag.bgRectIndex] = live;
      activeBgRectIndex = roiDrag.bgRectIndex;
    }
  }
  const suggestionRaw = suggestionRoiRect();
  const suggestion = suggestionRaw && roi && sameOverlayRect(suggestionRaw, roi) ? null : suggestionRaw;
  if (!result) return { roi, suggestion, bgRects, activeBgRectIndex, centroid: null, ellipse: null, fitEllipse: null };
  const released = result.moments.stageB;
  const params = result.fits.gauss2d.params;
  const widths = result.fits.fitWidths;
  let ellipse: ImageOverlay["ellipse"] = null;
  let fitEllipse: ImageOverlay["fitEllipse"] = null;
  let centroid: ImageOverlay["centroid"] = null;
  if (
    released &&
    released.valid &&
    released.d4SigmaMajorPx !== null &&
    released.d4SigmaMinorPx !== null &&
    released.centroidXPx !== null &&
    released.centroidYPx !== null
  ) {
    centroid = { x: released.centroidXPx, y: released.centroidYPx };
    ellipse = {
      cx: released.centroidXPx,
      cy: released.centroidYPx,
      majorPx: released.d4SigmaMajorPx,
      minorPx: released.d4SigmaMinorPx,
      thetaRad: released.thetaRad ?? 0,
      color: "#5CE1A0",
    };
  }
  if (params && widths && widths.d4SigmaMajorPx > 0 && widths.d4SigmaMinorPx > 0) {
    if (!centroid) centroid = { x: params.centerXPx, y: params.centerYPx };
    fitEllipse = {
      cx: params.centerXPx,
      cy: params.centerYPx,
      majorPx: widths.d4SigmaMajorPx,
      minorPx: widths.d4SigmaMinorPx,
      thetaRad: params.thetaRad,
      color: "#F2B33D",
    };
  } else if (params && !centroid) {
    centroid = { x: params.centerXPx, y: params.centerYPx };
  }
  return { roi, suggestion, bgRects, activeBgRectIndex, centroid, ellipse, fitEllipse };
}

// Two-pass halo: all underlays first (1.5× width, semi-transparent near-black,
// same dash/cap/join), then all colored strokes. Per-path halo-then-color
// buried neighbors when D4sigma and fit nearly coincide.
const OVERLAY_STROKE_HALO = "rgba(8,10,14,0.65)";
const OVERLAY_HALO_WIDTH = 1.5;

function paintOverlayStrokes(ctx: CanvasRenderingContext2D, strokes: OverlayStroke[]): void {
  for (const stroke of strokes) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = OVERLAY_STROKE_HALO;
    ctx.lineWidth = stroke.width * OVERLAY_HALO_WIDTH;
    ctx.setLineDash(stroke.dash);
    stroke.paint(ctx);
    ctx.restore();
  }
  for (const stroke of strokes) {
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.setLineDash(stroke.dash);
    if (stroke.alpha !== undefined) ctx.globalAlpha = stroke.alpha;
    stroke.paint(ctx);
    ctx.restore();
  }
}

function strokeOverlayEllipse(strokes: OverlayStroke[], ellipse: OverlayEllipse, dash: number[]): void {
  if (!(ellipse.majorPx > 0 && ellipse.minorPx > 0)) return;
  const width = Math.max(1, Math.min(2.25, Math.max(ellipse.majorPx, ellipse.minorPx) / 90));
  strokes.push({
    color: ellipse.color,
    width,
    dash,
    paint: (ctx) => {
      ctx.beginPath();
      ctx.ellipse(ellipse.cx, ellipse.cy, ellipse.majorPx / 2, ellipse.minorPx / 2, ellipse.thetaRad, 0, Math.PI * 2);
      ctx.stroke();
    },
  });
}

function drawEllipseAxes(strokes: OverlayStroke[], ellipse: OverlayEllipse): void {
  if (!(ellipse.majorPx > 0 && ellipse.minorPx > 0)) return;
  const rx = ellipse.majorPx / 2;
  const ry = ellipse.minorPx / 2;
  const c = Math.cos(ellipse.thetaRad);
  const s = Math.sin(ellipse.thetaRad);
  const width = Math.max(1, Math.min(1.75, Math.max(ellipse.majorPx, ellipse.minorPx) / 120));
  strokes.push({
    color: ellipse.color,
    width,
    dash: [],
    alpha: 0.9,
    paint: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(ellipse.cx - c * rx, ellipse.cy - s * rx);
      ctx.lineTo(ellipse.cx + c * rx, ellipse.cy + s * rx);
      ctx.stroke();
    },
  });
  strokes.push({
    color: ellipse.color,
    width,
    dash: [],
    alpha: 0.9,
    paint: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(ellipse.cx + s * ry, ellipse.cy - c * ry);
      ctx.lineTo(ellipse.cx - s * ry, ellipse.cy + c * ry);
      ctx.stroke();
    },
  });
}

type LegendItem = { color: string; dash: number[]; lines: string[]; mark: "ellipse" | "cross" | "rect" };

function strokeLegendMark(
  ctx: CanvasRenderingContext2D,
  item: LegendItem,
  mx: number,
  cy: number,
  swatch: number,
  lineWidth: number,
  pxScale: number,
): void {
  ctx.strokeStyle = item.color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(item.dash.map((value) => value * pxScale));
  if (item.mark === "cross") {
    const arm = swatch * 0.28;
    ctx.beginPath();
    ctx.moveTo(mx - arm, cy);
    ctx.lineTo(mx + arm, cy);
    ctx.moveTo(mx, cy - arm);
    ctx.lineTo(mx, cy + arm);
    ctx.stroke();
  } else if (item.mark === "rect") {
    const rw = swatch * 0.82;
    const rh = swatch * 0.52;
    ctx.strokeRect(mx - rw / 2, cy - rh / 2, rw, rh);
  } else {
    ctx.beginPath();
    ctx.ellipse(mx, cy, swatch * 0.42, swatch * 0.26, -0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

type CanvasBox = { x: number; y: number; width: number; height: number };
type CanvasStrokeRect = CanvasBox & { lineX: number; lineY: number };

function imageRectCanvasBox(rect: OverlayRect, view: PixelView, canvasW: number, canvasH: number): CanvasBox {
  const sx = canvasW / Math.max(1, view.width);
  const sy = canvasH / Math.max(1, view.height);
  const x0 = (rect.x0 - view.x0) * sx;
  const y0 = (rect.y0 - view.y0) * sy;
  return { x: x0, y: y0, width: rect.width * sx, height: rect.height * sy };
}

function ellipseBoundingRect(ellipse: OverlayEllipse): OverlayRect {
  const rx = ellipse.majorPx / 2;
  const ry = ellipse.minorPx / 2;
  const c = Math.cos(ellipse.thetaRad);
  const s = Math.sin(ellipse.thetaRad);
  const halfW = Math.hypot(rx * c, ry * s);
  const halfH = Math.hypot(rx * s, ry * c);
  return { x0: ellipse.cx - halfW, y0: ellipse.cy - halfH, width: halfW * 2, height: halfH * 2 };
}

function canvasStrokeRect(rect: OverlayRect, lineWidth: number, view: PixelView, canvasW: number, canvasH: number): CanvasStrokeRect {
  const box = imageRectCanvasBox(rect, view, canvasW, canvasH);
  return {
    ...box,
    lineX: Math.max(1, lineWidth * (canvasW / Math.max(1, view.width))),
    lineY: Math.max(1, lineWidth * (canvasH / Math.max(1, view.height))),
  };
}

function overlappingArea(a: CanvasBox, b: CanvasBox): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function strokeRectOccupancy(candidate: CanvasBox, stroke: CanvasStrokeRect): number {
  const lineX = Math.min(stroke.lineX, Math.max(1, stroke.width));
  const lineY = Math.min(stroke.lineY, Math.max(1, stroke.height));
  const bands: CanvasBox[] = [
    { x: stroke.x, y: stroke.y, width: stroke.width, height: lineY },
    { x: stroke.x, y: stroke.y + stroke.height - lineY, width: stroke.width, height: lineY },
    { x: stroke.x, y: stroke.y, width: lineX, height: stroke.height },
    { x: stroke.x + stroke.width - lineX, y: stroke.y, width: lineX, height: stroke.height },
  ];
  return bands.reduce((area, band) => area + overlappingArea(candidate, band), 0);
}

function legendCorner(
  overlay: ImageOverlay,
  view: PixelView,
  canvasW: number,
  canvasH: number,
  pad: number,
  boxW: number,
  boxH: number,
): CanvasBox {
  const x1 = Math.max(pad, canvasW - boxW - pad);
  const y1 = Math.max(pad, canvasH - boxH - pad);
  const candidates: CanvasBox[] = [
    { x: pad, y: pad, width: boxW, height: boxH },
    { x: x1, y: pad, width: boxW, height: boxH },
    { x: pad, y: y1, width: boxW, height: boxH },
    { x: x1, y: y1, width: boxW, height: boxH },
  ];
  const viewSpan = Math.min(view.width, view.height);
  const strokes: CanvasStrokeRect[] = [];
  const rectWidth = Math.max(1.25, viewSpan / 140);
  const suggestionWidth = Math.max(1.1, viewSpan / 160);
  const addRect = (rect: OverlayRect | null, width: number): void => {
    if (rect && roiBoundaryVisible(rect, view)) strokes.push(canvasStrokeRect(rect, width, view, canvasW, canvasH));
  };
  addRect(overlay.roi, rectWidth);
  overlay.bgRects.forEach((rect) => addRect(rect, rectWidth));
  addRect(overlay.suggestion, suggestionWidth);
  for (const ellipse of [overlay.ellipse, overlay.fitEllipse]) {
    if (!ellipse) continue;
    const width = Math.max(1, Math.min(2.25, Math.max(ellipse.majorPx, ellipse.minorPx) / 90));
    addRect(ellipseBoundingRect(ellipse), width);
  }
  let chosen = candidates[0];
  let lowestOccupancy = candidates[0] ? strokes.reduce((area, stroke) => area + strokeRectOccupancy(candidates[0], stroke), 0) : 0;
  for (const candidate of candidates.slice(1)) {
    const occupancy = strokes.reduce((area, stroke) => area + strokeRectOccupancy(candidate, stroke), 0);
    // Strictly lower keeps the established top-left position as the tiebreak.
    if (occupancy < lowestOccupancy) {
      chosen = candidate;
      lowestOccupancy = occupancy;
    }
  }
  return chosen;
}

function drawOverlayLegend(ctx: CanvasRenderingContext2D, overlay: ImageOverlay, view: PixelView, canvasW: number, canvasH: number, pxScale: number): void {
  const T = strings(S.lang);
  const roiVisible = overlay.roi !== null && roiBoundaryVisible(overlay.roi, view);
  const suggestionVisible = overlay.suggestion !== null && roiBoundaryVisible(overlay.suggestion, view);
  const bgRectsVisible = overlay.bgRects.some((rect) => roiBoundaryVisible(rect, view));
  const items: LegendItem[] = [];
  if (overlay.ellipse) items.push({ color: overlay.ellipse.color, dash: [], lines: [T.imgD4Sigma], mark: "ellipse" });
  if (overlay.fitEllipse) items.push({ color: overlay.fitEllipse.color, dash: [5, 3], lines: [T.imgLegendFit], mark: "ellipse" });
  if (overlay.centroid) items.push({ color: "#F2B33D", dash: [], lines: [T.imgCentroid], mark: "cross" });
  if (roiVisible) {
    const lines = [T.imgLegendRoi];
    if (S.img.roiMode === "full" && liveRoiRect() === null) lines.push(T.imgRoiFullFrameNote);
    items.push({ color: "#6FA8F5", dash: [], lines, mark: "rect" });
  }
  if (bgRectsVisible) items.push({ color: BG_RECT_OVERLAY_COLOR, dash: [], lines: [T.imgLegendBgRect], mark: "rect" });
  if (suggestionVisible) items.push({ color: "#8FD3FF", dash: [5, 3], lines: [T.imgLegendSuggestion], mark: "rect" });
  if (items.length === 0) return;

  const fontDisplay = 12;
  const fontPx = fontDisplay * pxScale;
  const pad = Math.max(6, fontDisplay * 0.55) * pxScale;
  const lineGap = Math.max(2, fontDisplay * 0.2) * pxScale;
  const swatch = Math.max(16, fontDisplay * 1.7) * pxScale;
  const hairline = Math.max(1, pxScale);
  const markWidth = Math.max(1.25, fontDisplay / 8) * pxScale;
  const cssW = canvasW / Math.max(1e-6, pxScale);
  const cssH = canvasH / Math.max(1e-6, pxScale);
  // Cap is in CSS pixels (not backing-store). 42 percent / 280 px floor keeps
  // labeled rows at common ~640 sizes; compact chips only when the CSS box is
  // actually too tight for the wrapped labels.
  const maxBoxW = Math.max(cssW * 0.42, 280) * pxScale;
  const maxBoxH = Math.max(cssH * 0.34, 120) * pxScale;
  ctx.save();
  ctx.font = `600 ${fontPx}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textBaseline = "middle";
  const maxTextW = Math.max(fontPx * 4, maxBoxW - pad - swatch - pad * 2);
  const prepared = items.map((item) => {
    const wrapped: string[] = [];
    for (const line of item.lines) {
      const parts = wrapCanvasText(ctx, line, maxTextW);
      if (parts.length <= 2) wrapped.push(...parts);
      else wrapped.push(parts[0], parts.slice(1).join(" "));
    }
    return { ...item, lines: wrapped.length > 0 ? wrapped : item.lines };
  });
  let textW = 0;
  let rows = 0;
  for (const item of prepared) {
    rows += item.lines.length;
    for (const line of item.lines) textW = Math.max(textW, ctx.measureText(line).width);
  }
  const rowH = fontPx + lineGap;
  const labeledW = pad + swatch + pad + textW + pad;
  const labeledH = pad + rows * rowH + pad * 0.2;
  const compact = cssW < 420 && (labeledW > maxBoxW || labeledH > maxBoxH);
  const gap = pad * 0.6;
  let boxW = labeledW;
  let boxH = labeledH;
  let chipVertical = false;
  if (compact) {
    boxW = pad + items.length * swatch + (items.length - 1) * gap + pad;
    boxH = pad + swatch + pad;
    if (boxW > maxBoxW || boxH > maxBoxH) {
      chipVertical = true;
      boxW = pad + swatch + pad;
      boxH = pad + items.length * swatch + (items.length - 1) * gap + pad;
    }
  }
  const { x, y } = legendCorner(overlay, view, canvasW, canvasH, pad, boxW, boxH);
  ctx.fillStyle = "rgba(7, 10, 15, 0.72)";
  ctx.strokeStyle = "rgba(31, 40, 51, 0.9)";
  ctx.lineWidth = hairline;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeRect(x + hairline * 0.5, y + hairline * 0.5, boxW - hairline, boxH - hairline);

  let cy = y + pad;
  prepared.forEach((item, i) => {
    if (compact) {
      const mx = chipVertical
        ? x + pad + swatch / 2
        : x + pad + i * (swatch + gap) + swatch / 2;
      const itemCy = chipVertical
        ? y + pad + i * (swatch + gap) + swatch / 2
        : y + pad + swatch / 2;
      strokeLegendMark(ctx, item, mx, itemCy, swatch, markWidth, pxScale);
      return;
    }
    const lx = x + pad;
    item.lines.forEach((line, lineIndex) => {
      cy += rowH / 2;
      if (lineIndex === 0) strokeLegendMark(ctx, item, lx + swatch / 2, cy, swatch, markWidth, pxScale);
      ctx.fillStyle = "#E7ECF4";
      ctx.fillText(line, lx + swatch + pad, cy);
      cy += rowH / 2;
    });
  });
  ctx.restore();
}

function drawOverlayCaption(ctx: CanvasRenderingContext2D, overlay: ImageOverlay, view: PixelView, canvasW: number, canvasH: number, pxScale: number): void {
  const T = strings(S.lang);
  const notes: string[] = [];
  if (overlay.ellipse || overlay.fitEllipse) notes.push(T.imgEllipsePowerNote);
  if (overlay.roi && !roiBoundaryVisible(overlay.roi, view)) notes.push(T.imgRoiOutsideCrop);
  if (notes.length === 0) return;

  const fontDisplay = 11;
  const fontPx = fontDisplay * pxScale;
  ctx.save();
  ctx.font = `500 ${fontPx}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textBaseline = "top";
  const pad = Math.max(6, fontDisplay * 0.5) * pxScale;
  const hairline = Math.max(1, pxScale);
  const maxText = Math.max(32 * pxScale, canvasW - pad * 4);
  const lines: string[] = [];
  for (const note of notes) lines.push(...wrapCanvasText(ctx, note, maxText));
  const lineH = fontPx + Math.max(3, fontDisplay * 0.28) * pxScale;
  let textW = 0;
  for (const line of lines) textW = Math.max(textW, ctx.measureText(line).width);
  const boxW = Math.min(canvasW - pad * 2, pad + textW + pad);
  const boxH = pad + lines.length * lineH + pad * 0.35;
  if (boxH > canvasH * 0.42) {
    ctx.restore();
    return;
  }
  const x = pad;
  const y = canvasH - boxH - pad;
  ctx.fillStyle = "rgba(7, 10, 15, 0.72)";
  ctx.strokeStyle = "rgba(31, 40, 51, 0.9)";
  ctx.lineWidth = hairline;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeRect(x + hairline * 0.5, y + hairline * 0.5, boxW - hairline, boxH - hairline);
  ctx.fillStyle = "#E7ECF4";
  lines.forEach((line, i) => {
    ctx.fillText(line, x + pad, y + pad + i * lineH);
  });
  ctx.restore();
}

function drawOverlay(ctx: CanvasRenderingContext2D, overlay: ImageOverlay, view: PixelView, canvasW: number, canvasH: number, pxScale: number): void {
  ctx.save();
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);
  ctx.clip();
  const sx = canvasW / Math.max(1, view.width);
  const sy = canvasH / Math.max(1, view.height);
  ctx.setTransform(sx, 0, 0, sy, -view.x0 * sx, -view.y0 * sy);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const viewSpan = Math.min(view.width, view.height);
  const strokes: OverlayStroke[] = [];
  const suggestion = overlay.suggestion;
  if (suggestion && roiBoundaryVisible(suggestion, view)) {
    const dash = [Math.max(6, viewSpan / 28), Math.max(4, viewSpan / 40)];
    strokes.push({
      color: "#8FD3FF",
      width: Math.max(1.1, viewSpan / 160),
      dash,
      paint: (c) => {
        c.strokeRect(suggestion.x0 + 0.5, suggestion.y0 + 0.5, suggestion.width - 1, suggestion.height - 1);
      },
    });
  }
  const roi = overlay.roi;
  if (roi && roiBoundaryVisible(roi, view)) {
    strokes.push({
      color: "#6FA8F5",
      width: Math.max(1.25, viewSpan / 140),
      dash: [],
      paint: (c) => {
        c.strokeRect(roi.x0 + 0.5, roi.y0 + 0.5, roi.width - 1, roi.height - 1);
      },
    });
    const editable = roiDrag?.target === "roi" ? liveRoiRect() ?? draftRoiRect() : draftRoiRect();
    if (editable && sameOverlayRect(editable, roi)) drawRoiHandles(strokes, roi, viewSpan);
  }
  // Background samples paint after the ROI so full-frame ROI borders never hide their frame edges.
  overlay.bgRects.forEach((rect, index) => {
    if (!roiBoundaryVisible(rect, view)) return;
    strokes.push({
      color: BG_RECT_OVERLAY_COLOR,
      width: Math.max(1.25, viewSpan / 140),
      dash: [],
      paint: (c) => {
        c.strokeRect(rect.x0 + 0.5, rect.y0 + 0.5, rect.width - 1, rect.height - 1);
      },
    });
    if (isBgRectDrawMode() && overlay.activeBgRectIndex === index) {
      drawRoiHandles(strokes, rect, viewSpan, "#E2C6FF");
    }
  });
  if (overlay.ellipse) {
    strokeOverlayEllipse(strokes, overlay.ellipse, []);
    drawEllipseAxes(strokes, overlay.ellipse);
  }
  if (overlay.fitEllipse) {
    const dash = [Math.max(6, viewSpan / 28), Math.max(4, viewSpan / 40)];
    strokeOverlayEllipse(strokes, overlay.fitEllipse, dash);
    if (!overlay.ellipse) drawEllipseAxes(strokes, overlay.fitEllipse);
  }
  if (overlay.centroid) {
    const arm = Math.max(4, viewSpan / 40);
    const cx = overlay.centroid.x;
    const cy = overlay.centroid.y;
    strokes.push({
      color: "#F2B33D",
      width: Math.max(1, arm / 8),
      dash: [],
      paint: (c) => {
        c.beginPath();
        c.moveTo(cx - arm, cy);
        c.lineTo(cx + arm, cy);
        c.moveTo(cx, cy - arm);
        c.lineTo(cx, cy + arm);
        c.stroke();
      },
    });
  }
  paintOverlayStrokes(ctx, strokes);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.restore();
  drawOverlayLegend(ctx, overlay, view, canvasW, canvasH, pxScale);
  drawOverlayCaption(ctx, overlay, view, canvasW, canvasH, pxScale);
}

function samePixelView(a: PixelView, b: PixelView): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.width === b.width && a.height === b.height;
}

function drawRawImage(canvas: HTMLCanvasElement | null, pixels: Float32Array | null | undefined, width: number, height: number): void {
  if (!canvas || !pixels || width <= 0 || height <= 0 || pixels.length === 0) return;
  const overlay = overlayFromResult();
  const view = imageDisplayView(width, height, overlay);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (canvas.width !== view.width || canvas.height !== view.height) {
    canvas.width = view.width;
    canvas.height = view.height;
  }
  canvas.style.imageRendering = view.width >= 256 || view.height >= 256 ? "auto" : "pixelated";
  fitCanvasLayout(canvas, view.width, view.height);
  imagePreviewLastLayout = { parentW: previewLayoutWidth(canvas), w: canvas.clientWidth, h: canvas.clientHeight };
  ensureImagePreviewObserver(canvas);
  const colorMap = resolveColorMap(S.img.colorMap);
  const lut = colorMapLut(colorMap);
  const cacheHit =
    imagePreviewCache !== null &&
    imagePreviewCache.pixels === pixels &&
    imagePreviewCache.srcW === width &&
    imagePreviewCache.srcH === height &&
    samePixelView(imagePreviewCache.view, view) &&
    imagePreviewCache.bitmap.width === view.width &&
    imagePreviewCache.bitmap.height === view.height &&
    imagePreviewCache.colorMap === colorMap;
  if (!cacheHit) {
    const { lo, hi } = stretchLimits(sortedFiniteView(pixels, width, view), 0.01, 0.9999);
    const span = hi - lo;
    const img = ctx.createImageData(view.width, view.height);
    let dst = 0;
    for (let y = 0; y < view.height; y += 1) {
      const row = (view.y0 + y) * width + view.x0;
      for (let x = 0; x < view.width; x += 1) {
        const t = (pixels[row + x] - lo) / span;
        const gray = Number.isFinite(t) ? Math.max(0, Math.min(255, Math.round(t * 255))) : 0;
        if (lut) {
          const o = gray * 3;
          img.data[dst] = lut[o];
          img.data[dst + 1] = lut[o + 1];
          img.data[dst + 2] = lut[o + 2];
        } else {
          img.data[dst] = gray;
          img.data[dst + 1] = gray;
          img.data[dst + 2] = gray;
        }
        img.data[dst + 3] = 255;
        dst += 4;
      }
    }
    imagePreviewCache = { pixels, srcW: width, srcH: height, view, bitmap: img, colorMap, whitePoint: hi };
  }
  if (!imagePreviewCache) return;
  ctx.putImageData(imagePreviewCache.bitmap, 0, 0);
  layoutImageColorBar(canvas, colorMap, imagePreviewCache.whitePoint);
  const overlayCanvas = document.querySelector<HTMLCanvasElement>("#img-overlay");
  if (!overlayCanvas) return;
  const { dpr, cssW, cssH } = sizeOverlayCanvas(overlayCanvas, canvas);
  imagePreviewLastLayout = { parentW: previewLayoutWidth(canvas), w: cssW, h: cssH };
  const overlayCtx = overlayCanvas.getContext("2d");
  if (!overlayCtx) return;
  overlayCtx.imageSmoothingEnabled = true;
  overlayCtx.imageSmoothingQuality = "high";
  drawOverlay(overlayCtx, overlay, view, overlayCanvas.width, overlayCanvas.height, dpr);
}

function residualGridView(
  display: { width: number; height: number; blockSizePx: number },
  roi: { x0: number; y0: number },
  view: PixelView,
): PixelView {
  const block = Math.max(1, display.blockSizePx);
  const x0 = Math.max(0, Math.floor((view.x0 - roi.x0) / block));
  const y0 = Math.max(0, Math.floor((view.y0 - roi.y0) / block));
  const x1 = Math.min(display.width, Math.ceil((view.x0 + view.width - roi.x0) / block));
  const y1 = Math.min(display.height, Math.ceil((view.y0 + view.height - roi.y0) / block));
  if (x1 <= x0 || y1 <= y0) return { x0: 0, y0: 0, width: display.width, height: display.height };
  return { x0, y0, width: x1 - x0, height: y1 - y0 };
}

function residualCoversView(roi: { x0: number; y0: number; width: number; height: number }, view: PixelView): boolean {
  return roi.x0 <= view.x0 && roi.y0 <= view.y0 && roi.x0 + roi.width >= view.x0 + view.width && roi.y0 + roi.height >= view.y0 + view.height;
}

function drawResidualImage(canvas: HTMLCanvasElement | null): void {
  const result = S.img.result;
  const display = result?.residuals?.display;
  if (!canvas || !display || display.width <= 0 || display.height <= 0 || display.values.length === 0) return;
  const overlay = overlayFromResult();
  const frameW = S.img.width;
  const frameH = S.img.height;
  const imageView =
    frameW > 0 && frameH > 0 ? imageDisplayView(frameW, frameH, overlay) : fullView(display.width, display.height);
  const roi = result?.roi.rect ?? { x0: 0, y0: 0, width: display.width, height: display.height };
  const covers = residualCoversView(roi, imageView);
  const view = covers ? residualGridView(display, roi, imageView) : { x0: 0, y0: 0, width: display.width, height: display.height };
  canvas.width = view.width;
  canvas.height = view.height;
  canvas.style.imageRendering = view.width >= 256 || view.height >= 256 ? "auto" : "pixelated";
  const preview = document.querySelector<HTMLCanvasElement>("#img-canvas");
  if (covers && preview && preview.style.width) {
    canvas.style.width = preview.style.width;
    canvas.style.height = preview.style.height || "auto";
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "min(64vh, 640px)";
    canvas.style.aspectRatio = `${view.width} / ${view.height}`;
    canvas.style.objectFit = "contain";
    canvas.style.objectPosition = "center";
  } else {
    fitCanvasLayout(canvas, view.width, view.height);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const absSamples = sortedFiniteView(
    Float32Array.from(display.values, (value) => Math.abs(value)),
    display.width,
    view,
  );
  const maxAbs = stretchLimits(absSamples, 0, 0.9999).hi;
  const img = ctx.createImageData(view.width, view.height);
  let dst = 0;
  for (let y = 0; y < view.height; y += 1) {
    const row = (view.y0 + y) * display.width + view.x0;
    for (let x = 0; x < view.width; x += 1) {
      const value = display.values[row + x];
      const t = maxAbs > 0 && Number.isFinite(value) ? Math.max(-1, Math.min(1, value / maxAbs)) : 0;
      const mag = Math.abs(t);
      if (t >= 0) {
        img.data[dst] = Math.round(14 + (242 - 14) * mag);
        img.data[dst + 1] = Math.round(16 + (179 - 16) * mag);
        img.data[dst + 2] = Math.round(22 + (61 - 22) * mag);
      } else {
        img.data[dst] = Math.round(14 + (111 - 14) * mag);
        img.data[dst + 1] = Math.round(16 + (168 - 16) * mag);
        img.data[dst + 2] = Math.round(22 + (245 - 22) * mag);
      }
      img.data[dst + 3] = 255;
      dst += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  const titleEl = document.querySelector("#img-residual-title");
  if (titleEl) {
    const T = strings(S.lang);
    titleEl.textContent = covers
      ? T.imgResidualWindowLabel(imageView.width, imageView.height)
      : T.imgResidualRoiLabel(roi.width, roi.height);
  }
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
  const requestId = fieldJobToken;
  setTimeout(() => {
    if (requestId !== fieldJobToken) return;
    handleFieldJobResult(runHeadlessJob(job));
  }, 30);
}

// ── image job dispatch: Web Worker for analyze/decode, await fallback ──

import type {
  ImageDecodeChannel,
  ImageWorkerJobInput,
  ImageWorkerRequest,
  ImageWorkerRequestResult,
  ImageWorkerResponse,
} from "./image-worker.ts";
import { runImageWorkerRequest } from "./image-worker.ts";

let imageWorker: Worker | null | undefined;
let imageJobToken = 0;
const pendingImageJobs = new Map<
  number,
  { resolve: (result: ImageWorkerRequestResult) => void; reject: (error: Error) => void }
>();

function getImageWorker(): Worker | null {
  if (imageWorker !== undefined) return imageWorker;
  try {
    imageWorker = new Worker(new URL("./image-worker.ts", import.meta.url), { type: "module" });
    imageWorker.onmessage = (event: MessageEvent<ImageWorkerResponse>) => {
      const message = event.data;
      const pending = pendingImageJobs.get(message.requestId);
      pendingImageJobs.delete(message.requestId);
      if (!pending) return; // stale run superseded by a newer request
      if (message.type === "done") pending.resolve(message.result);
      else pending.reject(new Error(message.message));
    };
    imageWorker.onerror = () => {
      imageWorker?.terminate();
      imageWorker = null;
      pendingImageJobs.forEach((pending) => pending.reject(new Error("image worker failed — retry runs on the main thread")));
      pendingImageJobs.clear();
    };
  } catch {
    imageWorker = null;
  }
  return imageWorker;
}

async function runImageJob(job: ImageWorkerJobInput): Promise<ImageWorkerRequestResult> {
  imageJobToken += 1;
  const requestId = imageJobToken;
  const worker = getImageWorker();
  if (worker) {
    return new Promise<ImageWorkerRequestResult>((resolve, reject) => {
      pendingImageJobs.set(requestId, { resolve, reject });
      const request: ImageWorkerRequest = { requestId, job };
      worker.postMessage(request);
    });
  }
  // Worker unavailable: await the pure core directly on the main thread.
  const response = await runImageWorkerRequest({ requestId, job });
  if (response.type === "done") return response.result;
  throw new Error(response.message);
}

// ── image analyzer tab: upload, decode and analysis dispatch ──────────

// The decoded binary payload lives in module scope so page/channel changes
// can re-run the decode op without re-reading the file (the ImageTabState
// slice only stores UI metadata, never the pixels themselves).
let imageFileBytes: ArrayBuffer | null = null;

const IMAGE_MAX_FILE_BYTES = 128 * 1024 * 1024;

function isImageFileName(name: string): boolean {
  return /\.(tif|tiff|png)$/i.test(name);
}

function imageFileNameBase(): string {
  return (S.img.fileName || "image").replace(/\.[^.]+$/, "");
}

function showImageError(message: string): void {
  const drawMode = transitionImageDrawMode(S.img, S.img.bgMethod, "roi");
  S.img = { ...S.img, ...drawMode, busy: false, phase: null, loaded: false, activeBgRectIndex: null, errs: [message] };
  rerender();
}

function downloadTextFile(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function pickImageFile(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".tif,.tiff,.png";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void loadImageFile(file);
  });
  input.click();
}

function decodeChannel(value: string): ImageDecodeChannel | undefined {
  return value === "r" || value === "g" || value === "b" || value === "a" ? value : undefined;
}

function bumpImageJobGeneration(prev: typeof S.img): number {
  return prev.imageJobGeneration + 1;
}

function imageJobIsCurrent(generation: number): boolean {
  return S.img.imageJobGeneration === generation;
}

function parseDraftRect(x0: string, y0: string, width: string, height: string): OverlayRect | null {
  const rx0 = Number(x0);
  const ry0 = Number(y0);
  const rw = Number(width);
  const rh = Number(height);
  if (![rx0, ry0, rw, rh].every((value) => Number.isFinite(value))) return null;
  if (!(rw > 0 && rh > 0)) return null;
  return { x0: rx0, y0: ry0, width: rw, height: rh };
}

function fitRectToImage(rect: OverlayRect, imgW: number, imgH: number): OverlayRect | null {
  const exact = integerRoiRect(rect.x0, rect.y0, rect.width, rect.height, imgW, imgH);
  if (exact) return exact;
  return boundsRoiRect(rect.x0, rect.y0, rect.x0 + rect.width, rect.y0 + rect.height, imgW, imgH);
}

function sameRectFields(rect: OverlayRect, x0: string, y0: string, width: string, height: string): boolean {
  return String(rect.x0) === x0 && String(rect.y0) === y0 && String(rect.width) === width && String(rect.height) === height;
}

// Structural extraction from the API's DecodedImage: the v1 UI only needs
// width/height, the pixel array, the page count and the channel list.
function applyDecodedImage(
  prev: typeof S.img,
  decoded: unknown,
  fileName: string,
  mode: "new-file" | "redecode",
): void {
  const rec = (typeof decoded === "object" && decoded !== null ? decoded : {}) as Record<string, unknown>;
  const num = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const width = Math.max(0, Math.round(num(rec.width ?? rec.nx, 0)));
  const height = Math.max(0, Math.round(num(rec.height ?? rec.ny, 0)));
  const rawPixels = (rec.pixels ?? rec.values ?? null) as ArrayLike<number> | null;
  const pixels = rawPixels ? toAnalysisFloat32(rawPixels) : new Float32Array(0);
  const decodedDtype = typeof rec.dtype === "string" ? rec.dtype : "";
  const pageCount = Math.max(1, Math.round(num(rec.pageCount, 1)));
  const rawChannels = Array.isArray(rec.channels) ? rec.channels.filter((c): c is string => typeof c === "string") : [];
  const channels = rawChannels.length > 0 ? rawChannels : ["gray"];
  const channel = channels.includes(prev.channel) ? prev.channel : channels[0];
  let next: typeof S.img = {
    ...prev,
    imageJobGeneration: bumpImageJobGeneration(prev),
    fileName,
    loaded: pixels.length > 0 && width > 0 && height > 0,
    busy: false,
    phase: null,
    width,
    height,
    decodedDtype,
    pageCount,
    channels,
    channel,
    result: null,
    render: pixels.length > 0 ? { kind: "raw", pixels } : null,
    errs: [],
    settingsNote: null,
  };

  if (mode === "new-file") {
    const drawMode = transitionImageDrawMode(prev, prev.bgMethod, "roi");
    next = {
      ...next,
      ...drawMode,
      roiMode: "full",
      roiX0: "",
      roiY0: "",
      roiW: "",
      roiH: "",
      bgRects: [],
      activeBgRectIndex: null,
      darkFrame: null,
      darkError: null,
      roiFitNote: null,
      roiClampNote: null,
      settingsNote: "reset",
    };
  } else {
    let adjusted = false;
    if (prev.roiMode === "rect") {
      const parsed = parseDraftRect(prev.roiX0, prev.roiY0, prev.roiW, prev.roiH);
      const fitted = parsed ? fitRectToImage(parsed, width, height) : null;
      if (!fitted) {
        next = { ...next, roiMode: "full", roiX0: "", roiY0: "", roiW: "", roiH: "" };
        adjusted = true;
      } else if (!sameRectFields(fitted, prev.roiX0, prev.roiY0, prev.roiW, prev.roiH)) {
        next = {
          ...next,
          roiX0: String(fitted.x0),
          roiY0: String(fitted.y0),
          roiW: String(fitted.width),
          roiH: String(fitted.height),
        };
        adjusted = true;
      }
    }

    const nextRects: OverlayRect[] = [];
    for (const rect of prev.bgRects) {
      const fitted = fitRectToImage(rect, width, height);
      if (!fitted) {
        adjusted = true;
        continue;
      }
      if (!sameOverlayRect(fitted, rect)) adjusted = true;
      nextRects.push(fitted);
    }
    const drawMode = transitionImageDrawMode(prev, prev.bgMethod, prev.drawTarget);
    const activeBgRectIndex = validActiveBgRectIndex(nextRects, prev.activeBgRectIndex);
    next = { ...next, ...drawMode, bgRects: nextRects, activeBgRectIndex };

    const darkDtypeChanged = prev.darkFrame !== null && prev.decodedDtype !== decodedDtype;
    if (prev.darkFrame && (prev.darkFrame.width !== width || prev.darkFrame.height !== height || darkDtypeChanged)) {
      next = { ...next, darkFrame: null, darkError: null };
      adjusted = true;
    }
    next = { ...next, settingsNote: darkDtypeChanged ? "dark-dtype-changed" : adjusted ? "adjusted" : null };
  }

  S.img = next;
  rerender();
}

async function loadImageFile(file: File): Promise<void> {
  if (!isImageFileName(file.name)) {
    showImageError(`Unsupported file “${file.name}” — the image analyzer accepts .tif, .tiff and .png files.`);
    return;
  }
  if (file.size > IMAGE_MAX_FILE_BYTES) {
    showImageError(`Image file “${file.name}” is too large (${file.size.toLocaleString()} bytes) — the limit is 128 MB.`);
    return;
  }
  const generation = bumpImageJobGeneration(S.img);
  const drawMode = transitionImageDrawMode(S.img, S.img.bgMethod, "roi");
  S.img = {
    ...S.img,
    ...drawMode,
    imageJobGeneration: generation,
    fileName: file.name,
    busy: true,
    phase: "decode",
    loaded: false,
    result: null,
    render: null,
    width: 0,
    height: 0,
    decodedDtype: "",
    activeBgRectIndex: null,
    darkFrame: null,
    darkError: null,
    errs: [],
    settingsNote: null,
  };
  rerender();
  try {
    const bytes = await file.arrayBuffer();
    if (!imageJobIsCurrent(generation)) return;
    imageFileBytes = bytes;
    const fileName = file.name;
    const response = await runImageJob({ op: "decode", fileBytes: imageFileBytes, fileName });
    if (!imageJobIsCurrent(generation)) return;
    if (response.op !== "decode") {
      showImageError("Unexpected image job result — retry the upload.");
      return;
    }
    if (!response.ok) {
      S.img = { ...S.img, busy: false, phase: null, loaded: false, errs: response.errors };
      rerender();
      return;
    }
    applyDecodedImage(S.img, response.result, fileName, "new-file");
  } catch (error) {
    if (!imageJobIsCurrent(generation)) return;
    showImageError(error instanceof Error ? error.message : String(error));
  }
}

// Page/channel changes re-run the decode op over the stored bytes. pageIndex
// is converted from the 1-based UI page number to a 0-based index before it
// reaches the API decoder.
async function reDecodeImage(): Promise<void> {
  const prev = S.img;
  if (!prev.loaded || prev.busy || imageFileBytes === null) return;
  const generation = bumpImageJobGeneration(prev);
  const pageNo = Number(prev.page);
  const channel = decodeChannel(prev.channel);
  S.img = { ...prev, imageJobGeneration: generation, busy: true, phase: "decode", result: null, errs: [] };
  rerender();
  try {
    const response = await runImageJob({
      op: "decode",
      fileBytes: imageFileBytes,
      fileName: prev.fileName,
      pageIndex: Number.isFinite(pageNo) && pageNo >= 1 ? Math.max(0, Math.round(pageNo) - 1) : undefined,
      ...(channel !== undefined ? { channel } : {}),
    });
    if (!imageJobIsCurrent(generation)) return;
    if (response.op !== "decode") {
      S.img = { ...S.img, busy: false, phase: null, errs: ["Unexpected image job result — retry the decode."] };
      rerender();
      return;
    }
    if (!response.ok) {
      S.img = { ...S.img, busy: false, phase: null, errs: response.errors };
      rerender();
      return;
    }
    applyDecodedImage(S.img, response.result, prev.fileName, "redecode");
  } catch (error) {
    if (!imageJobIsCurrent(generation)) return;
    S.img = { ...S.img, busy: false, phase: null, errs: [error instanceof Error ? error.message : String(error)] };
    rerender();
  }
}

// Dark-frame picker for the part-A background controls (S18e-C part B): same
// dynamic file-input pattern as pickImageFile, same 128 MB cap, and the same
// decode worker op (the decoder enforces the 4096x4096 pixel cap and answers
// malformed bytes with ok:false — those errors are surfaced into darkError).
// A dark frame must match the loaded image's pixel dimensions AND the
// original decoded dtype (uint8 vs uint16 stays blocked). On accept, pixels
// are converted with Float32Array.from — the same rounding as the main-image
// path (uint8/uint16 are exact in float32; uint32 above 2^24 is not) — and
// stored as dtype "float32" for the engine, which re-validates that dtype.
function pickDarkFrameFile(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".tif,.tiff,.png";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void loadDarkFrameFile(file);
  });
  input.click();
}

async function loadDarkFrameFile(file: File): Promise<void> {
  const before = S.img;
  const generation = bumpImageJobGeneration(before);
  S.img = { ...before, imageJobGeneration: generation };
  const failDecode = (detail: string[]): void => {
    if (!imageJobIsCurrent(generation)) return;
    S.img = { ...S.img, darkFrame: null, darkError: { kind: "decode", detail } };
    rerender();
  };
  if (!isImageFileName(file.name)) {
    failDecode([`Unsupported file “${file.name}” — dark frames accept .tif, .tiff and .png files.`]);
    return;
  }
  if (file.size > IMAGE_MAX_FILE_BYTES) {
    failDecode([`Dark frame file “${file.name}” is too large (${file.size.toLocaleString()} bytes) — the limit is 128 MB.`]);
    return;
  }
  try {
    const fileBytes = await file.arrayBuffer();
    if (!imageJobIsCurrent(generation)) return;
    const response = await runImageJob({ op: "decode", fileBytes, fileName: file.name });
    if (!imageJobIsCurrent(generation)) return;
    if (response.op !== "decode") {
      failDecode(["Unexpected image job result — retry the dark-frame load."]);
      return;
    }
    if (!response.ok) {
      failDecode(response.errors);
      return;
    }
    const decoded = response.result;
    if (decoded.width !== S.img.width || decoded.height !== S.img.height) {
      S.img = {
        ...S.img,
        darkFrame: null,
        darkError: {
          kind: "dimensions",
          darkWidth: decoded.width,
          darkHeight: decoded.height,
          imageWidth: S.img.width,
          imageHeight: S.img.height,
        },
      };
      rerender();
      return;
    }
    if (decoded.dtype !== S.img.decodedDtype) {
      S.img = {
        ...S.img,
        darkFrame: null,
        darkError: { kind: "dtype", darkDtype: decoded.dtype, imageDtype: S.img.decodedDtype },
      };
      rerender();
      return;
    }
    S.img = {
      ...S.img,
      darkFrame: {
        name: file.name,
        width: decoded.width,
        height: decoded.height,
        sourceDtype: decoded.dtype,
        dtype: "float32",
        pixels: toAnalysisFloat32(decoded.pixels),
      },
      darkError: null,
    };
    rerender();
  } catch (error) {
    failDecode([error instanceof Error ? error.message : String(error)]);
  }
}

function runImageAnalysis(): void {
  let prev = S.img;
  if (!prev.loaded || prev.busy || !prev.render || prev.render.pixels.length === 0) return;
  const image: Record<string, unknown> = {
    pixels: Array.from(prev.render.pixels),
    width: prev.width,
    height: prev.height,
    dtype: "float32",
  };
  const calX = Number(prev.calX);
  const calY = Number(prev.calY);
  if (Number.isFinite(calX) && calX > 0 && Number.isFinite(calY) && calY > 0) {
    image.calibration = { pixelPitchUmX: calX, pixelPitchUmY: calY };
  }
  // Background model from the part-A background controls (S18e-C part B): the
  // five methods map straight onto the engine's BackgroundConfig. The two
  // rect-based methods also feed the same rects into backgroundSigmaRects (the
  // documented sigma-reference cascade: user rects take precedence over the
  // ROI rim frame). An absent/invalid input (non-finite offset, missing dark
  // frame, empty rect list) leaves background unset, which the engine treats
  // as method "none".
  if (prev.bgMethod === "auto") {
    image.background = { method: "auto" };
  } else if (prev.bgMethod === "manual-offset") {
    const offset = Number(prev.bgOffset);
    if (Number.isFinite(offset)) image.background = { method: "manual-offset", offsetCounts: offset };
  } else if (prev.bgMethod === "dark-frame" && prev.darkFrame) {
    image.background = {
      method: "dark-frame",
      darkPixels: prev.darkFrame.pixels,
      darkWidth: prev.darkFrame.width,
      darkHeight: prev.darkFrame.height,
      darkDtype: prev.darkFrame.dtype,
    };
  } else if ((prev.bgMethod === "rect-median" || prev.bgMethod === "robust-plane") && prev.bgRects.length > 0) {
    image.background = { method: prev.bgMethod, rects: prev.bgRects };
    image.backgroundSigmaRects = prev.bgRects;
  }
  if (prev.roiMode === "auto") {
    image.roi = "auto";
  } else if (prev.roiMode === "rect") {
    const resolved = resolveTypedRoi(prev.roiX0, prev.roiY0, prev.roiW, prev.roiH, prev.width, prev.height);
    if (resolved.kind === "invalid" || resolved.kind === "incomplete") {
      S.img = { ...prev, busy: false, phase: null, errs: resolved.kind === "invalid" ? [strings(S.lang).imgRoiOutOfRange] : [] };
      rerender();
      return;
    }
    const rect = resolved.rect;
    if (resolved.kind === "clamped") prev = commitClampedRoi(prev, rect);
    image.roi = { x0: rect.x0, y0: rect.y0, width: rect.width, height: rect.height };
  }
  S.img = { ...prev, busy: true, phase: "analyze", result: null, errs: [] };
  const generation = prev.imageJobGeneration;
  rerender();
  void (async () => {
    try {
      const response = await runImageJob({ op: "analyze", image } as unknown as ImageWorkerJobInput);
      if (!imageJobIsCurrent(generation)) return;
      if (response.op !== "analyze") {
        S.img = { ...S.img, busy: false, phase: null, errs: ["Unexpected image job result — retry the analysis."] };
        rerender();
        return;
      }
      if (!response.ok) {
        S.img = { ...S.img, busy: false, phase: null, errs: response.errors };
        rerender();
        return;
      }
      S.img = { ...S.img, busy: false, phase: null, result: response.result, errs: [] };
      rerender();
    } catch (error) {
      if (!imageJobIsCurrent(generation)) return;
      S.img = { ...S.img, busy: false, phase: null, errs: [error instanceof Error ? error.message : String(error)] };
      rerender();
    }
  })();
}

// ── profile plot canvas (measured profile + released fit model) ───────────
//
// Display-only. Every number drawn here comes from packages/api: the
// measured samples and the crossing positions are released by the engine,
// the model curves are the released fit parameters re-evaluated along the
// same line (the math lives in views/image.ts, which stays DOM-free).
// Rendered on demand — one pass per render, for the selected profile only.

const PLOT2 = { W: 1180, H: 430, L: 88, R: 1160, T: 30, B: 366 };
const PROFILE_COLORS = {
  measured: "#5CE1A0",
  gauss: "#F2B33D",
  superGauss: "#6FA8F5",
  fwhm: "#8FD3FF",
  e2: "#A9B4C6",
  grid: "#1A212C",
  axis: "#2A3442",
  label: "#5C6675",
  text: "#E7ECF4",
};

// Same 1/2/5/10 tick ladder the beamline envelope plot uses. Returns 0 when
// no sane step exists (degenerate range); callers then skip the grid rather
// than looping forever on a zero or non-finite increment.
function niceTickStep(range: number, divisions: number): number {
  if (!(range > 0) || !Number.isFinite(range) || !(divisions > 0)) return 0;
  const raw = range / divisions;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  return Number.isFinite(step) && step > 0 ? step : 0;
}

function finiteExtent(series: ReadonlyArray<ReadonlyArray<number> | null>): { lo: number; hi: number } | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const values of series) {
    if (!values) continue;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (hi === lo) return { lo: lo - 1, hi: hi + 1 };
  return { lo, hi };
}

function strokeProfileSeries(
  ctx: CanvasRenderingContext2D,
  positions: ReadonlyArray<number>,
  values: ReadonlyArray<number>,
  toX: (v: number) => number,
  toY: (v: number) => number,
  color: string,
  width: number,
  dash: number[],
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  let open = false;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value) || !Number.isFinite(positions[i])) {
      open = false;
      continue;
    }
    const x = toX(positions[i]);
    const y = toY(value);
    if (open) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    open = true;
  }
  ctx.stroke();
  ctx.restore();
}

function drawProfileLegend(ctx: CanvasRenderingContext2D, items: Array<{ color: string; dash: number[]; label: string }>): void {
  if (items.length === 0) return;
  ctx.save();
  ctx.font = '500 17px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textBaseline = "middle";
  const swatch = 26;
  const pad = 12;
  const rowH = 24;
  let textW = 0;
  for (const item of items) textW = Math.max(textW, ctx.measureText(item.label).width);
  const boxW = pad + swatch + pad * 0.7 + textW + pad;
  const boxH = pad * 0.6 + items.length * rowH + pad * 0.6;
  const x = PLOT2.R - boxW - 8;
  const y = PLOT2.T + 8;
  ctx.fillStyle = "rgba(7, 10, 15, 0.78)";
  ctx.strokeStyle = "rgba(31, 40, 51, 0.9)";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);
  items.forEach((item, i) => {
    const cy = y + pad * 0.6 + i * rowH + rowH / 2;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2.4;
    ctx.setLineDash(item.dash);
    ctx.beginPath();
    ctx.moveTo(x + pad, cy);
    ctx.lineTo(x + pad + swatch, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PROFILE_COLORS.text;
    ctx.fillText(item.label, x + pad + swatch + pad * 0.7, cy);
  });
  ctx.restore();
}

function drawProfilePlot(canvas: HTMLCanvasElement | null, data: ProfilePlotData | null): void {
  if (!canvas) return;
  const T = strings(S.lang);
  if (canvas.width !== PLOT2.W || canvas.height !== PLOT2.H) {
    canvas.width = PLOT2.W;
    canvas.height = PLOT2.H;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setLineDash([]);
  ctx.fillStyle = "#080c12";
  ctx.fillRect(0, 0, PLOT2.W, PLOT2.H);
  if (!data || data.positions.length < 2) {
    ctx.fillStyle = PROFILE_COLORS.label;
    ctx.font = '500 18px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(T.imgProfileMissing, PLOT2.W / 2, PLOT2.H / 2);
    ctx.textAlign = "left";
    return;
  }

  const xLo = data.positions[0];
  const xHi = data.positions[data.positions.length - 1];
  const yExtent = finiteExtent([data.measured, data.gauss, data.superGauss]);
  if (!(xHi > xLo) || !yExtent) return;
  const yPad = (yExtent.hi - yExtent.lo) * 0.08;
  const yLo = yExtent.lo - yPad;
  const yHi = yExtent.hi + yPad;
  const toX = (v: number): number => PLOT2.L + ((v - xLo) / (xHi - xLo)) * (PLOT2.R - PLOT2.L);
  const toY = (v: number): number => PLOT2.B - ((v - yLo) / (yHi - yLo)) * (PLOT2.B - PLOT2.T);

  // grid + tick labels
  ctx.font = '400 17px "IBM Plex Mono", ui-monospace, monospace';
  ctx.strokeStyle = PROFILE_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = PROFILE_COLORS.label;
  const xStep = niceTickStep(xHi - xLo, 8);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (xStep > 0) {
    for (let v = Math.ceil(xLo / xStep) * xStep; v <= xHi + xStep * 1e-6; v += xStep) {
      const x = toX(v);
      ctx.beginPath();
      ctx.moveTo(x, PLOT2.T);
      ctx.lineTo(x, PLOT2.B);
      ctx.stroke();
      ctx.fillText(sig(v, 4), x, PLOT2.B + 8);
    }
  }
  const yStep = niceTickStep(yHi - yLo, 5);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  if (yStep > 0) {
    for (let v = Math.ceil(yLo / yStep) * yStep; v <= yHi + yStep * 1e-6; v += yStep) {
      const y = toY(v);
      ctx.beginPath();
      ctx.moveTo(PLOT2.L, y);
      ctx.lineTo(PLOT2.R, y);
      ctx.stroke();
      ctx.fillText(sig(v, 4), PLOT2.L - 10, y);
    }
  }
  if (yLo < 0 && yHi > 0) {
    ctx.save();
    ctx.strokeStyle = PROFILE_COLORS.axis;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(PLOT2.L, toY(0));
    ctx.lineTo(PLOT2.R, toY(0));
    ctx.stroke();
    ctx.restore();
  }

  // width crossings released by the engine
  for (const marker of data.markers) {
    if (marker.position < xLo || marker.position > xHi) continue;
    ctx.save();
    ctx.strokeStyle = marker.kind === "fwhm" ? PROFILE_COLORS.fwhm : PROFILE_COLORS.e2;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(marker.kind === "fwhm" ? [7, 5] : [2, 5]);
    const x = toX(marker.position);
    ctx.beginPath();
    ctx.moveTo(x, PLOT2.T);
    ctx.lineTo(x, PLOT2.B);
    ctx.stroke();
    ctx.restore();
  }

  // Draw order: measured data underneath, then the models on top. The
  // super-Gauss goes before the Gauss so the primary model stays readable
  // when the two coincide (which they do on a Gaussian beam, n -> 1).
  strokeProfileSeries(ctx, data.positions, data.measured, toX, toY, PROFILE_COLORS.measured, 2.6, []);
  if (data.superGauss) {
    strokeProfileSeries(ctx, data.positions, data.superGauss, toX, toY, PROFILE_COLORS.superGauss, 1.8, [2, 6]);
  }
  if (data.gauss) strokeProfileSeries(ctx, data.positions, data.gauss, toX, toY, PROFILE_COLORS.gauss, 2.2, [9, 5]);

  // frame, captions, legend
  ctx.strokeStyle = PROFILE_COLORS.axis;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(PLOT2.L + 0.5, PLOT2.T + 0.5, PLOT2.R - PLOT2.L - 1, PLOT2.B - PLOT2.T - 1);
  ctx.fillStyle = PROFILE_COLORS.label;
  ctx.font = '500 17px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(data.unit === "um" ? T.imgProfilePositionUm : T.imgProfilePositionPx, PLOT2.R, PLOT2.H - 12);
  ctx.textAlign = "left";
  ctx.fillText(T.imgProfileIntensity, 12, 20);
  ctx.fillStyle = PROFILE_COLORS.text;
  ctx.font = '600 18px "Space Grotesk", sans-serif';
  ctx.fillText(profileLabel(T, data.key), PLOT2.L + 12, PLOT2.T + 26);

  const legend: Array<{ color: string; dash: number[]; label: string }> = [
    { color: PROFILE_COLORS.measured, dash: [], label: T.imgProfileMeasured },
  ];
  if (data.gauss) legend.push({ color: PROFILE_COLORS.gauss, dash: [9, 5], label: T.imgProfileGaussModel });
  if (data.superGauss) legend.push({ color: PROFILE_COLORS.superGauss, dash: [2, 6], label: T.imgProfileSuperModel });
  if (data.markers.some((m) => m.kind === "fwhm")) {
    legend.push({ color: PROFILE_COLORS.fwhm, dash: [7, 5], label: T.imgProfileFwhmMark });
  }
  if (data.markers.some((m) => m.kind === "e2")) {
    legend.push({ color: PROFILE_COLORS.e2, dash: [2, 5], label: T.imgProfileE2Mark });
  }
  drawProfileLegend(ctx, legend);
}

function drawFieldCanvases(): void {
  if (S.tab === "image") {
    const imgState = S.img;
    drawRawImage(document.querySelector<HTMLCanvasElement>("#img-canvas"), imgState.render?.pixels, imgState.width, imgState.height);
    drawResidualImage(document.querySelector<HTMLCanvasElement>("#img-residual"));
    drawProfilePlot(
      document.querySelector<HTMLCanvasElement>("#img-profile-canvas"),
      buildProfilePlotData(imgState.result, imgState.profileKey),
    );
    return;
  }
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

function fieldSourceMode(): { kind: "HG"; m: number; n: number } | { kind: "LG"; p: number; l: number } | undefined {
  const f = S.fld;
  const clampOrder = (v: string): number => Math.max(0, Math.min(12, Math.round(Number(v) || 0)));
  if (f.srcMode === "hg") return { kind: "HG", m: clampOrder(f.mp1), n: clampOrder(f.mp2) };
  if (f.srcMode === "lg") {
    const l = Math.max(-12, Math.min(12, Math.round(Number(f.mp2) || 0)));
    return { kind: "LG", p: clampOrder(f.mp1), l };
  }
  return undefined;
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
    mode?: ReturnType<typeof fieldSourceMode>;
  } = {
    gaussian: { nx: n, ny: n, dxMm: Number(f.dx), dyMm: Number(f.dx), wavelengthUm: Number(f.lambda), waistRadiusMm: Number(f.waist) },
    distanceMm: Number(f.dist),
    method: f.method,
    samplingBeamRadiusMm: Number(f.waist),
    mode: fieldSourceMode(),
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
      sourceMode: fieldSourceMode(),
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
  "pick-file": (arg) => pickImportFile(arg),
  "img-pick-file": () => pickImageFile(),
  // Image analyzer background controls (S18e-C part B): the four background
  // rectangles of the rect editor, the dark-frame picker and the suggested-ROI
  // apply action. The rect rows carry their index in data-i (landed part-A
  // markup), picked up by the click delegation below.
  "img-bg-rect-add": () => {
    if (!S.img.loaded || S.img.width <= 0 || S.img.height <= 0) return;
    const w = Math.max(1, Math.floor(S.img.width / 4));
    const h = Math.max(1, Math.floor(S.img.height / 4));
    S.img = {
      ...S.img,
      bgRects: [...S.img.bgRects, { x0: 0, y0: 0, width: w, height: h }],
      activeBgRectIndex: S.img.bgRects.length,
    };
    rerender();
  },
  "img-bg-rect-remove": (arg) => {
    const i = Number(arg);
    if (Number.isInteger(i) && i >= 0 && i < S.img.bgRects.length) {
      const active = S.img.activeBgRectIndex;
      const bgRects = S.img.bgRects.filter((_, j) => j !== i);
      const nextIndex = active === null ? null : active > i ? active - 1 : active === i ? Math.min(i, bgRects.length - 1) : active;
      S.img = { ...S.img, bgRects, activeBgRectIndex: validActiveBgRectIndex(bgRects, nextIndex) };
      rerender();
    }
  },
  "img-bg-rect-corners": () => {
    if (!S.img.loaded || S.img.width <= 0 || S.img.height <= 0) return;
    const cw = Math.max(1, Math.round(0.12 * S.img.width));
    const ch = Math.max(1, Math.round(0.12 * S.img.height));
    S.img = {
      ...S.img,
      bgRects: [
        { x0: 0, y0: 0, width: cw, height: ch },
        { x0: S.img.width - cw, y0: 0, width: cw, height: ch },
        { x0: 0, y0: S.img.height - ch, width: cw, height: ch },
        { x0: S.img.width - cw, y0: S.img.height - ch, width: cw, height: ch },
      ],
      activeBgRectIndex: 0,
    };
    rerender();
  },
  "img-bg-pick-dark": () => pickDarkFrameFile(),
  "img-auto-mode": () => {
    const active = S.img.bgMethod === "auto" && S.img.roiMode === "auto";
    const drawMode = transitionImageDrawMode(S.img, active ? "none" : "auto", "roi");
    S.img = {
      ...S.img,
      ...drawMode,
      roiMode: active ? "full" : "auto",
      activeBgRectIndex: validActiveBgRectIndex(),
    };
    rerender();
  },
  "img-apply-suggestion": () => {
    const suggestion = S.img.result?.roi.suggestion;
    if (!suggestion) return;
    S.img = { ...S.img, ...applySuggestedImageRoi(S.img, suggestion.rect) };
    rerender();
  },
  // Apply the suggested ROI AND start the re-analysis in one click. The
  // callout that carries this button only appears when the suggestion is
  // materially different from the rectangle that was actually analysed.
  "img-apply-suggestion-run": () => {
    const suggestion = S.img.result?.roi.suggestion;
    if (!suggestion || S.img.busy) return;
    S.img = { ...S.img, ...applySuggestedImageRoi(S.img, suggestion.rect) };
    runImageAnalysis();
  },
  "img-roi-from-fit": () => {
    const derived = roiRectFromReleasedWidths();
    if (!derived) return;
    // NON-SHRINK CLAMP: a rectangle ROI is never narrowed below
    // ROI_NON_SHRINK_MIN_AREA_RATIO of its current area. That is the loop
    // breaker for a non-Gaussian (ringed) profile, whose Gaussian fit keeps
    // getting narrower on every tighter window. Coming from the full-frame
    // mode there is no rectangle to protect, so the first derivation always
    // lands.
    const current = draftRoiRect();
    if (S.img.roiMode === "rect" && current) {
      const currentArea = current.width * current.height;
      const nextArea = derived.rect.width * derived.rect.height;
      if (currentArea > 0 && nextArea < ROI_NON_SHRINK_MIN_AREA_RATIO * currentArea) {
        S.img = { ...S.img, roiFitNote: imageRoiStateKey() };
        rerender();
        return;
      }
    }
    S.img = {
      ...S.img,
      roiMode: "rect",
      roiX0: String(derived.rect.x0),
      roiY0: String(derived.rect.y0),
      roiW: String(derived.rect.width),
      roiH: String(derived.rect.height),
      roiFitNote: null,
    };
    rerender();
  },
  "img-profile": (arg) => {
    if (!IMAGE_PROFILE_KEYS.includes(arg as ImageProfileKey)) return;
    S.img = { ...S.img, profileKey: arg as ImageProfileKey };
    rerender();
  },
  "img-profile-png": () => {
    const canvas = document.querySelector<HTMLCanvasElement>("#img-profile-canvas");
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${imageFileNameBase()}.${S.img.profileKey}.png`;
    a.click();
  },
  "img-roi-mode": (arg) => {
    S.img = { ...S.img, roiMode: arg === "rect" ? "rect" : arg === "auto" ? "auto" : "full" };
    rerender();
  },
  "img-draw-target": (arg) => {
    const drawMode = transitionImageDrawMode(S.img, S.img.bgMethod, arg === "bg-rect" ? "bg-rect" : "roi");
    S.img = {
      ...S.img,
      ...drawMode,
      activeBgRectIndex: validActiveBgRectIndex(),
    };
    rerender();
  },
  "img-preview-view": (arg) => {
    S.img = { ...S.img, ...selectImagePreviewView(arg === "full" ? "full" : "closeup") };
    rerender();
  },
  "img-run": () => runImageAnalysis(),
  "img-export-json": () => {
    const result = S.img.result;
    if (!result) return;
    downloadTextFile(`${imageFileNameBase()}.analysis.json`, buildAnalysisSummaryJson(result, { bgRects: S.img.bgRects }), "application/json");
  },
  "img-export-csv": () => {
    const result = S.img.result;
    if (!result) return;
    downloadTextFile(`${imageFileNameBase()}.analysis.csv`, buildAnalysisCsv(result), "text/csv");
  },
  "img-export-png": () => {
    const canvas = document.querySelector<HTMLCanvasElement>("#img-canvas");
    const overlayCanvas = document.querySelector<HTMLCanvasElement>("#img-overlay");
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const overlay = overlayFromResult();
    const view = imageDisplayView(S.img.width, S.img.height, overlay);
    const full = view.x0 === 0 && view.y0 === 0 && view.width === S.img.width && view.height === S.img.height;
    const suffix = full ? "fullframe" : "closeup";
    const out = document.createElement("canvas");
    const exportW = overlayCanvas && overlayCanvas.width > 0 ? overlayCanvas.width : canvas.width;
    const exportH = overlayCanvas && overlayCanvas.height > 0 ? overlayCanvas.height : canvas.height;
    const pxScale = exportH / Math.max(1, canvas.clientHeight || canvas.height);
    const barW = Math.max(1, Math.round(COLOR_BAR_LAYOUT_W * pxScale));
    out.width = exportW + barW;
    out.height = exportH;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, exportW, exportH);
    if (overlayCanvas && overlayCanvas.width > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(overlayCanvas, 0, 0);
    }
    drawColorBarBundle(
      ctx,
      exportW,
      0,
      exportH,
      pxScale,
      resolveColorMap(S.img.colorMap),
      imagePreviewCache?.whitePoint ?? 0,
    );
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `${imageFileNameBase()}.${suffix}.png`;
    a.click();
  },
  "fld-srcmode": (arg) => {
    S.fld = { ...S.fld, srcMode: arg === "hg" ? "hg" : arg === "lg" ? "lg" : "gauss" };
    rerender();
  },
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
  // Image analyzer background-rectangle rows (part A): bgRectX0-<i> /
  // bgRectY0-<i> / bgRectW-<i> / bgRectH-<i>. Values are parsed as integers
  // and clamped to the loaded image bounds, keeping the rect fully inside the
  // frame (the engine would reject an out-of-bounds rect later anyway).
  const bgRectMatch = /^bgRect(X0|Y0|W|H)-(\d+)$/.exec(key);
  if (bgRectMatch) {
    const rectIndex = Number(bgRectMatch[2]);
    if (Number.isInteger(rectIndex) && rectIndex >= 0 && S.img.loaded && S.img.width > 0 && S.img.height > 0) {
      const rectField = bgRectMatch[1];
      const parsed = Math.round(Number(raw));
      if (Number.isFinite(parsed)) {
        const width = S.img.width;
        const height = S.img.height;
        S.img = {
          ...S.img,
          bgRects: S.img.bgRects.map((rect, j) => {
            if (j !== rectIndex) return rect;
            let x0 = rect.x0;
            let y0 = rect.y0;
            let w = rect.width;
            let h = rect.height;
            if (rectField === "X0") x0 = Math.max(0, Math.min(width - 1, parsed));
            if (rectField === "Y0") y0 = Math.max(0, Math.min(height - 1, parsed));
            if (rectField === "W") w = Math.max(1, Math.min(width, parsed));
            if (rectField === "H") h = Math.max(1, Math.min(height, parsed));
            if (x0 + w > width) w = Math.max(1, width - x0);
            if (y0 + h > height) h = Math.max(1, height - y0);
            return { x0, y0, width: w, height: h };
          }),
          activeBgRectIndex: rectIndex,
        };
      }
    }
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
    case "fldMp1":
      S.fld = { ...S.fld, mp1: raw };
      return true;
    case "fldMp2":
      S.fld = { ...S.fld, mp2: raw };
      return true;
    // image analyzer tab
    case "imgPage":
      S.img = { ...S.img, page: raw };
      return true;
    case "imgChannel": {
      const next = raw as string;
      if (S.img.channel === next) return true;
      S.img = { ...S.img, channel: next };
      if (S.img.loaded) void reDecodeImage();
      return true;
    }
    case "imgCalX":
      S.img = { ...S.img, calX: raw };
      return true;
    case "imgCalY":
      S.img = { ...S.img, calY: raw };
      return true;
    case "imgBgMethod": {
      const bgMethod =
        raw === "auto"
          ? "auto"
          : raw === "manual-offset"
          ? "manual-offset"
          : raw === "dark-frame"
            ? "dark-frame"
            : raw === "rect-median"
              ? "rect-median"
              : raw === "robust-plane"
                ? "robust-plane"
                : "none";
      const drawMode = transitionImageDrawMode(S.img, bgMethod, S.img.drawTarget);
      S.img = {
        ...S.img,
        ...drawMode,
        activeBgRectIndex: validActiveBgRectIndex(),
      };
      return true;
    }
    case "imgColorMap": {
      const next = resolveColorMap(raw);
      if (S.img.colorMap === next) return true;
      S.img = { ...S.img, colorMap: next };
      return true;
    }
    case "imgBgOffset":
      S.img = { ...S.img, bgOffset: raw };
      return true;
    case "imgRoiX0":
      S.img = syncTypedRoi({ ...S.img, roiX0: raw });
      return true;
    case "imgRoiY0":
      S.img = syncTypedRoi({ ...S.img, roiY0: raw });
      return true;
    case "imgRoiW":
      S.img = syncTypedRoi({ ...S.img, roiW: raw });
      return true;
    case "imgRoiH":
      S.img = syncTypedRoi({ ...S.img, roiH: raw });
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

// ── image ROI drag (canvas overlay fast path — commit on pointerup) ──

const ROI_DRAG_SLOP_PX = 4;

function canvasClientToImagePx(canvas: HTMLCanvasElement, clientX: number, clientY: number, view: PixelView): { x: number; y: number } | null {
  const box = canvas.getBoundingClientRect();
  const style = typeof getComputedStyle === "function" ? getComputedStyle(canvas) : null;
  const bl = style ? Number.parseFloat(style.borderLeftWidth) || 0 : 0;
  const br = style ? Number.parseFloat(style.borderRightWidth) || 0 : 0;
  const bt = style ? Number.parseFloat(style.borderTopWidth) || 0 : 0;
  const bb = style ? Number.parseFloat(style.borderBottomWidth) || 0 : 0;
  const w = box.width - bl - br;
  const h = box.height - bt - bb;
  if (!(w > 0 && h > 0)) return null;
  return {
    x: view.x0 + ((clientX - box.left - bl) / w) * view.width,
    y: view.y0 + ((clientY - box.top - bt) / h) * view.height,
  };
}

function paintDraftRoiInputs(rect: OverlayRect): void {
  const set = (key: string, value: number): void => {
    const input = document.querySelector<HTMLInputElement>(`input[data-k="${key}"]`);
    if (!input) return;
    if (document.activeElement === input) return;
    input.value = String(value);
  };
  set("imgRoiX0", rect.x0);
  set("imgRoiY0", rect.y0);
  set("imgRoiW", rect.width);
  set("imgRoiH", rect.height);
}

function paintDraftBgRectInputs(rect: OverlayRect, index: number): void {
  const set = (key: string, value: number): void => {
    const input = document.querySelector<HTMLInputElement>(`input[data-k="${key}-${index}"]`);
    if (!input || document.activeElement === input) return;
    input.value = String(value);
  };
  set("bgRectX0", rect.x0);
  set("bgRectY0", rect.y0);
  set("bgRectW", rect.width);
  set("bgRectH", rect.height);
}

function blurFocusedRoiInput(): void {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement)) return;
  const key = el.dataset.k ?? "";
  if (key === "imgRoiX0" || key === "imgRoiY0" || key === "imgRoiW" || key === "imgRoiH" || /^bgRect(?:X0|Y0|W|H)-\d+$/.test(key)) el.blur();
}

function refreshImageOverlay(): void {
  drawFieldCanvases();
}

function updateRoiHoverCursor(event: PointerEvent): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#img-canvas");
  if (!canvas || S.tab !== "image" || !S.img.loaded) return;
  const over = event.target instanceof Element && event.target.closest("#img-canvas");
  if (!over) {
    canvas.style.cursor = "";
    return;
  }
  const overlay = overlayFromResult();
  const view = imageDisplayView(S.img.width, S.img.height, overlay);
  const pt = canvasClientToImagePx(canvas, event.clientX, event.clientY, view);
  if (isBgRectDrawMode()) {
    if (!pt) {
      canvas.style.cursor = "crosshair";
      return;
    }
    const hit = hitBgRectEdit(pt, roiEditHitPx(canvas, view), S.img.width, S.img.height);
    canvas.style.cursor = roiCursor(hit?.hit ?? "create");
    return;
  }
  const draft = draftRoiRect();
  const editable = draft && roiBoundaryVisible(draft, view) ? draft : null;
  if (!pt || !editable) {
    canvas.style.cursor = "crosshair";
    return;
  }
  const hit = hitRoiEdit(editable, pt, roiEditHitPx(canvas, view), S.img.width, S.img.height, "roi");
  canvas.style.cursor = roiCursor(hit ?? "create");
}

function onRoiPointerDown(event: PointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (!event.isPrimary) return;
  const canvas = event.target instanceof Element ? event.target.closest<HTMLCanvasElement>("#img-canvas") : null;
  if (!canvas || S.tab !== "image" || S.img.busy || !S.img.loaded || S.img.width <= 0 || S.img.height <= 0) return;
  const overlay = overlayFromResult();
  const view = imageDisplayView(S.img.width, S.img.height, overlay);
  const pt = canvasClientToImagePx(canvas, event.clientX, event.clientY, view);
  if (!pt) return;
  blurFocusedRoiInput();
  const target = normalizeImageDrawTarget(S.img.drawTarget, S.img.bgMethod);
  let editable: OverlayRect | null = null;
  let hit: RoiHandle | "move" | null = null;
  let bgRectIndex: number | null = null;
  if (target === "bg-rect") {
    const bgHit = hitBgRectEdit(pt, roiEditHitPx(canvas, view), S.img.width, S.img.height);
    if (bgHit) {
      editable = bgHit.rect;
      hit = bgHit.hit;
      bgRectIndex = bgHit.index;
      if (S.img.activeBgRectIndex !== bgHit.index) {
        S.img = { ...S.img, activeBgRectIndex: bgHit.index };
        refreshImageOverlay();
      }
    }
  } else {
    const draft = draftRoiRect();
    editable = draft && roiBoundaryVisible(draft, view) ? draft : null;
    hit = editable ? hitRoiEdit(editable, pt, roiEditHitPx(canvas, view), S.img.width, S.img.height, "roi") : null;
  }
  const kind: RoiDragKind = hit === "move" ? "move" : hit ? "resize" : "create";
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = roiCursor(hit ?? "create");
  roiDrag = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: pt.x,
    startY: pt.y,
    currentX: pt.x,
    currentY: pt.y,
    moved: false,
    kind,
    handle: hit && hit !== "move" ? hit : null,
    origin: kind === "create" ? null : editable,
    target,
    bgRectIndex,
  };
}

function onRoiPointerMove(event: PointerEvent): void {
  if (!roiDrag || event.pointerId !== roiDrag.pointerId) {
    updateRoiHoverCursor(event);
    return;
  }
  event.preventDefault();
  const canvas = document.querySelector<HTMLCanvasElement>("#img-canvas");
  if (!canvas) return;
  const overlay = overlayFromResult();
  const view = imageDisplayView(S.img.width, S.img.height, overlay);
  const pt = canvasClientToImagePx(canvas, event.clientX, event.clientY, view);
  if (!pt) return;
  roiDrag.currentX = pt.x;
  roiDrag.currentY = pt.y;
  if (!roiDrag.moved) {
    const slop = Math.hypot(event.clientX - roiDrag.startClientX, event.clientY - roiDrag.startClientY);
    if (slop < ROI_DRAG_SLOP_PX) return;
    roiDrag.moved = true;
  }
  const live = liveRoiRect();
  if (live) {
    if (roiDrag.target === "bg-rect" && roiDrag.bgRectIndex !== null) paintDraftBgRectInputs(live, roiDrag.bgRectIndex);
    else if (roiDrag.target === "roi") paintDraftRoiInputs(live);
  }
  refreshImageOverlay();
}

function onRoiPointerUp(event: PointerEvent): void {
  if (!roiDrag || event.pointerId !== roiDrag.pointerId) return;
  const drag = roiDrag;
  const canvas = document.querySelector<HTMLCanvasElement>("#img-canvas");
  if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const live = drag.moved ? liveRoiRect() : null;
  roiDrag = null;
  if (drag.target === "bg-rect") {
    if (!live) {
      rerender();
      return;
    }
    let bgRects: OverlayRect[];
    let activeBgRectIndex: number;
    if (drag.bgRectIndex === null) {
      bgRects = [...S.img.bgRects, live];
      activeBgRectIndex = bgRects.length - 1;
    } else {
      bgRects = S.img.bgRects.map((rect, index) => (index === drag.bgRectIndex ? live : rect));
      activeBgRectIndex = drag.bgRectIndex;
    }
    S.img = { ...S.img, bgRects, activeBgRectIndex };
    rerender();
    return;
  }
  if (!live) {
    refreshImageOverlay();
    updateRoiHoverCursor(event);
    return;
  }
  S.img = {
    ...S.img,
    roiMode: "rect",
    roiX0: String(live.x0),
    roiY0: String(live.y0),
    roiW: String(live.width),
    roiH: String(live.height),
  };
  rerender();
}

// ── event wiring ──────────────────────────────────────────

// File drag & drop: dropping a .zmx/.agf/.json onto a marked textarea loads
// its text; anywhere else the default browser navigation (opening the file
// in a new tab) is suppressed.
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  const zone = event.target instanceof Element ? event.target.closest("[data-drop]") : null;
  if (event.dataTransfer) event.dataTransfer.dropEffect = zone ? "copy" : "none";
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  const zone = event.target instanceof Element ? event.target.closest("[data-drop]") : null;
  const file = event.dataTransfer?.files?.[0];
  if (!zone || !file) return;
  if (file.size > 5 * 1024 * 1024) return;
  const key = zone.getAttribute("data-drop");
  if (key) void decodeImportFile(file).then((text) => applyImportedText(key, text));
});

// Image analyzer drop zone (binary): the text-drop handler above is only for
// zmx/agf/json textareas, so the analyzer gets its own listener with its own
// size cap and visible error reporting.
document.addEventListener("drop", (event) => {
  const zone = event.target instanceof Element ? event.target.closest("[data-drop]") : null;
  if (!zone || zone.getAttribute("data-drop") !== "image-file") return;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();
  void loadImageFile(file);
});

// Zemax exports are frequently UTF-16 (BOM FF FE); file.text() would decode
// them as UTF-8 garbage. Sniff the BOM and decode accordingly.
async function decodeImportFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding =
    bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(encoding).decode(bytes).replace(/^﻿/, "");
}

function applyImportedText(key: string, text: string): void {
  if (key === "zmxText") S.imp = { ...S.imp, zmxText: text, zmx: null };
  else if (key === "agfText") S.imp = { ...S.imp, agfText: text, agf: null };
  else if (key === "importDraft") S.importDraft = text;
  else return;
  rerender();
}

function pickImportFile(key: string): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = key === "agfText" ? ".agf,.txt" : key === "importDraft" ? ".json,.txt" : ".zmx,.txt";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file || file.size > 5 * 1024 * 1024) return;
    void decodeImportFile(file).then((text) => applyImportedText(key, text));
  });
  input.click();
}

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
  // data-arg is the documented click payload; the part-A background-rectangle
  // rows carry their row index in data-i (landed view markup), so fall back to
  // it before the empty default. No existing data-act handler used data-i, so
  // this is additive.
  if (act && actions[act]) actions[act](actEl.dataset.arg ?? actEl.dataset.i ?? "");
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target?.matches(".img-drop[data-act]")) return;
  event.preventDefault();
  const act = target.dataset.act;
  if (act && actions[act]) actions[act]("");
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

// Image page commit: the page input is a blur-less text field, so the
// re-decode runs on the change event instead of every keystroke.
app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.k !== "imgPage") return;
  if (S.img.loaded) void reDecodeImage();
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

app.addEventListener("focusout", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const key = target.dataset.k ?? "";
  if (key !== "imgRoiX0" && key !== "imgRoiY0" && key !== "imgRoiW" && key !== "imgRoiH") return;
  const st = S.img;
  if (st.roiMode !== "rect" || st.width <= 0 || st.height <= 0) return;
  const resolved = resolveTypedRoi(st.roiX0, st.roiY0, st.roiW, st.roiH, st.width, st.height);
  if (resolved.kind !== "clamped") return;
  S.img = commitClampedRoi(st, resolved.rect);
  const rel = event.relatedTarget as HTMLElement | null;
  if (rel && rel.closest("[data-act]")) return;
  rerender();
});

app.addEventListener("mousemove", (event) => onPlotMove(event));
app.addEventListener("pointerdown", (event) => onRoiPointerDown(event));
document.addEventListener("pointermove", (event) => onRoiPointerMove(event));
document.addEventListener("pointerup", (event) => onRoiPointerUp(event));
document.addEventListener("pointercancel", (event) => onRoiPointerUp(event));
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
