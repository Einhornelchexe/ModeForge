// Image analyzer tab (S18e-C) — mirrors the field tab's view patterns:
// render() replaces a shell via innerHTML, state access through S, i18n via
// the Strings argument, canvases drawn by main.ts, and all physics behind
// packages/api. This module contains NO worker or file code: decode and
// analyze ops are dispatched from main.ts through the shared image worker
// path, and the binary payload itself lives in main.ts module scope.
//
// Presentation-only: the UI formats numbers the engine already produced
// (px, counts, degrees from thetaRad) and converts sizes to µm/mm in this
// view layer from the calibration inputs plus engine-provided stepUm /
// physical geometry. It never recomputes widths, gates, or fits. Nested
// engine objects are not stringified into the result panel — JSON/CSV
// export remains the dump path. When the engine did not emit a physical um
// value and the pitch is isotropic, this view multiplies px by um/px — a
// unit conversion, not a re-fit. Anisotropic pitch has no single factor;
// those rows stay in px with an honest suffix unless the engine already
// mapped the axis.
//
// v1 pragmatic cut (Plan v5 section 7), documented honestly:
// - ROI is full-frame by default with numeric rectangle inputs. Drag on
//   #img-canvas (main.ts overlay fast path) draws a new rectangle, moves
//   the existing draft from its interior, or resizes from an edge/corner.
//   The suggested-ROI dashed overlay also sets the same draft rectangle;
//   Run analysis confirms it.
// - The result canvas is a display-only linear stretch over the visible
//   pixels of the raw Float32 render copy (compact spots are framed
//   close-up; D4sigma / fit-ellipse / axes / legend overlays are drawn
//   in main.ts). The legend lists only overlays whose geometry is visible
//   in the crop. A view toggle (spot close-up | full frame) shows the
//   whole sensor so the blue ROI rectangle is drawn. A caption states that
//   a 4sigma ellipse encloses about 86 percent of Gaussian power while the
//   display stretch still shows fainter tails.
// - Page/channel changes re-decode through the dispatch in main.ts.
// - Background controls (part A): five background methods, rectangle editor
//   for rect-median/robust-plane, dark-frame picker and the suggested-ROI
//   informational line. Click handlers land in main.ts (part B) and are
//   addressed by the data-act names documented below.
// All UI strings are product-neutral plain language.

import type { ImageAnalysisResult } from "../../../../packages/api/src/index.ts";
import { esc, sig } from "../format.ts";
import type { Strings } from "../i18n.ts";
import { bgRectEditorAvailable, normalizeImageDrawTarget, type BgRect, type DarkError, type ImageProfileKey } from "../state.ts";
import { S } from "../store.ts";
import { bareInput, fieldCol, segBtn, warningCard, warnLines } from "./ui.ts";

type Profile = ImageAnalysisResult["profiles"]["cutX"];
type Moments = NonNullable<ImageAnalysisResult["moments"]["stageB"]>;
type Physical = NonNullable<ImageAnalysisResult["moments"]["physical"]>;
type FitParams = NonNullable<ImageAnalysisResult["fits"]["gauss2d"]["params"]>;
type SuperParams = NonNullable<NonNullable<ImageAnalysisResult["fits"]["superGauss2d"]>["params"]>;
type Sensitivity = NonNullable<ImageAnalysisResult["stability"]["sensitivities"]>[number];
type WidthGate = NonNullable<NonNullable<Profile>["widths"]["fwhmData"]>;
type PixelPitch = { xUm: number; yUm: number };
type KvValue = string | { html: string };
type KvRow = readonly [string, KvValue] | readonly [string, KvValue, string];
type ProfileAxis = "x" | "y" | "rotated";

// ── pure result exporters (no DOM, tested in tests/unit/image-view-export) ──

function dash(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? sig(value, 6) : "—";
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "—" : serialized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export type ImageAnalysisExportContext = { bgRects: readonly BgRect[] };

export function buildAnalysisSummaryJson(result: ImageAnalysisResult, context: ImageAnalysisExportContext): string {
  const released = result.moments.stageB;
  const releasedOk = released !== null && released.valid;
  const releasedEntry = releasedOk
    ? { d4SigmaMajorPx: released.d4SigmaMajorPx, d4SigmaMinorPx: released.d4SigmaMinorPx }
    : { suppressedReason: result.moments.suppressionReason ?? null };
  const summary = {
    releasedD4sigma: releasedEntry,
    physical: result.moments.physical ?? (releasedOk ? result.fits.physical ?? null : null),
    fitWidth4sigma: result.fits.fitWidths ?? null,
    fitStatus: result.fits.gauss2d.status,
    centroidPx: releasedOk && released.centroidXPx !== null ? { x: released.centroidXPx, y: released.centroidYPx } : null,
    thetaRad: releasedOk ? released.thetaRad : null,
    sigmaB: result.noise.sigmaCounts,
    scaleSource: result.noise.scaleSource,
    ellipticity: result.metrics.ellipticity,
    ellipticityPhysical: result.metrics.ellipticityPhysical,
    peakToBackgroundNoise: result.aperture.peakToBackgroundNoise,
    residualRmsCounts: result.residuals?.rmsCounts ?? null,
    residualMaxAbsCounts: result.residuals?.maxAbsCounts ?? null,
    roi: {
      source: result.roi.source,
      x0: result.roi.rect.x0,
      y0: result.roi.rect.y0,
      width: result.roi.rect.width,
      height: result.roi.rect.height,
    },
    bgRects: context.bgRects.map((rect) => ({ x0: rect.x0, y0: rect.y0, width: rect.width, height: rect.height })),
    symmetry: result.metrics.symmetry
      ? {
          rotationAsymmetry: result.metrics.symmetry.rotationAsymmetry,
          axialAsymmetryX: result.metrics.symmetry.axialAsymmetryX,
          axialAsymmetryY: result.metrics.symmetry.axialAsymmetryY,
        }
      : null,
  };
  return JSON.stringify(summary, null, 2);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildAnalysisCsv(result: ImageAnalysisResult): string {
  const rows: Array<Array<unknown>> = [];
  const released = result.moments.stageB;
  const releasedOk = released !== null && released.valid;
  if (releasedOk) {
    rows.push(["released_d4sigma", `${dash(released.d4SigmaMajorPx)} px x ${dash(released.d4SigmaMinorPx)} px`]);
    rows.push(["released_d4sigma_theta_rad", dash(released.thetaRad)]);
    rows.push(["released_centroid_x_px", dash(released.centroidXPx)]);
    rows.push(["released_centroid_y_px", dash(released.centroidYPx)]);
    const physical = asRecord(result.moments.physical);
    if (physical) {
      for (const [key, value] of Object.entries(physical)) rows.push([`released_physical_${key}`, dash(value)]);
    }
  } else {
    rows.push(["released_d4sigma", `suppressed: ${dash(result.moments.suppressionReason)}`]);
  }
  rows.push(["fit_width_4sigma", dash(result.fits.fitWidths)]);
  rows.push(["fit_status", dash(result.fits.gauss2d.status)]);
  rows.push(["sigma_b_counts", dash(result.noise.sigmaCounts)]);
  rows.push(["scale_source", dash(result.noise.scaleSource)]);
  rows.push(["ellipticity", dash(result.metrics.ellipticity)]);
  rows.push(["ellipticity_physical", dash(result.metrics.ellipticityPhysical)]);
  rows.push(["peak_to_background_noise", dash(result.aperture.peakToBackgroundNoise)]);
  rows.push(["residual_rms_counts", dash(result.residuals?.rmsCounts ?? null)]);
  rows.push(["residual_max_abs_counts", dash(result.residuals?.maxAbsCounts ?? null)]);
  rows.push(["roi_source", dash(result.roi.source)]);
  rows.push(["roi_x0", dash(result.roi.rect.x0)]);
  rows.push(["roi_y0", dash(result.roi.rect.y0)]);
  rows.push(["roi_w", dash(result.roi.rect.width)]);
  rows.push(["roi_h", dash(result.roi.rect.height)]);
  const symmetry = result.metrics.symmetry;
  rows.push(["symmetry_rotation_asymmetry", dash(symmetry?.rotationAsymmetry ?? null)]);
  rows.push(["symmetry_axial_asymmetry_x", dash(symmetry?.axialAsymmetryX ?? null)]);
  rows.push(["symmetry_axial_asymmetry_y", dash(symmetry?.axialAsymmetryY ?? null)]);
  return ["key,value", ...rows.map(([key, value]) => `${String(key)},${csvCell(String(value))}`)].join("\n");
}

// ── display formatters (no physics; unit/label conversion only) ──

function num(value: number | null | undefined, digits = 4): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : sig(value, digits);
}

// Display guard for aperture.peakToBackgroundNoise: the engine reports null
// when sigma_B or the corrected peak is non-positive. Infinity / NaN / <= 0
// are not shown as a lab number (tile and gate row stay omitted).
function peakToBackgroundNoiseDisplay(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || !(value > 0)) return null;
  return num(value, 4);
}

function parsePitch(calX: string, calY: string): PixelPitch | null {
  const xUm = Number(calX);
  const yUm = Number(calY);
  if (!(xUm > 0) || !(yUm > 0) || !Number.isFinite(xUm) || !Number.isFinite(yUm)) return null;
  return { xUm, yUm };
}

function isotropicUmPerPx(pitch: PixelPitch | null): number | null {
  if (!pitch || pitch.xUm !== pitch.yUm) return null;
  return pitch.xUm;
}

// Pairing rule: the um pair comes from the engine physical eigen-decomposition
// (sorted by PHYSICAL size); the px pair is the pixel-space pair (sorted by
// PIXEL size). Under anisotropic pitch those orderings can CROSS, so pairing
// them positionally attaches the wrong px value to a um axis. Compare
// physical theta vs pixel theta: if the two major axes are closer to
// perpendicular than aligned, swap the px pair so each um value is
// parenthesized with ITS OWN geometric axis. Key-results tiles all follow
// this physical-major-first order when a physical decomposition exists;
// otherwise they stay in pixel-major order. The profiles panel uses the same
// rule: titles stay "major/minor" (lange/kurze Achse); only the bound profile
// data swaps when the eigen-order crosses.
function axesCrossed(pixelTheta: number | null | undefined, physicalTheta: number | null | undefined): boolean {
  if (
    pixelTheta === null ||
    pixelTheta === undefined ||
    physicalTheta === null ||
    physicalTheta === undefined ||
    !Number.isFinite(pixelTheta) ||
    !Number.isFinite(physicalTheta)
  ) {
    return false;
  }
  let delta = Math.abs(pixelTheta - physicalTheta) % Math.PI;
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta > Math.PI / 4;
}

function alignedPixelPair(
  majorPx: number | null | undefined,
  minorPx: number | null | undefined,
  pixelTheta: number | null | undefined,
  physicalTheta: number | null | undefined,
): { firstPx: number | null | undefined; secondPx: number | null | undefined } {
  if (axesCrossed(pixelTheta, physicalTheta)) return { firstPx: minorPx, secondPx: majorPx };
  return { firstPx: majorPx, secondPx: minorPx };
}

export type ImageRoiRect = { x0: number; y0: number; width: number; height: number };
export type TypedRoiResolution =
  | { kind: "valid"; rect: ImageRoiRect }
  | { kind: "clamped"; rect: ImageRoiRect }
  | { kind: "invalid" }
  | { kind: "incomplete" };

export function resolveTypedRoi(
  x0Raw: string,
  y0Raw: string,
  wRaw: string,
  hRaw: string,
  imgW: number,
  imgH: number,
): TypedRoiResolution {
  if (!(imgW > 0 && imgH > 0)) return { kind: "incomplete" };
  const x0 = Number(x0Raw);
  const y0 = Number(y0Raw);
  const w = Number(wRaw);
  const h = Number(hRaw);
  if (![x0, y0, w, h].every((value) => Number.isFinite(value))) return { kind: "incomplete" };
  if (!(w > 0 && h > 0)) return { kind: "incomplete" };
  const rx0 = Math.round(x0);
  const ry0 = Math.round(y0);
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw >= 1 && rh >= 1 && rx0 >= 0 && ry0 >= 0 && rx0 + rw <= imgW && ry0 + rh <= imgH) {
    return { kind: "valid", rect: { x0: rx0, y0: ry0, width: rw, height: rh } };
  }
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  const right = Math.min(imgW, x0 + w);
  const bottom = Math.min(imgH, y0 + h);
  const iw = right - left;
  const ih = bottom - top;
  if (!(iw >= 0.5 && ih >= 0.5)) return { kind: "invalid" };
  const cx0 = Math.max(0, Math.min(imgW - 1, Math.round(left)));
  const cy0 = Math.max(0, Math.min(imgH - 1, Math.round(top)));
  const cw = Math.max(1, Math.min(imgW - cx0, Math.round(iw)));
  const ch = Math.max(1, Math.min(imgH - cy0, Math.round(ih)));
  if (cx0 + cw > imgW || cy0 + ch > imgH || cw < 1 || ch < 1) return { kind: "invalid" };
  return { kind: "clamped", rect: { x0: cx0, y0: cy0, width: cw, height: ch } };
}

export type ImageCloseupKind = "d4" | "fixed" | "fallback";

export function imageCloseupKind(width: number, height: number, res: ImageAnalysisResult | null): ImageCloseupKind | null {
  if (!res || width <= 0 || height <= 0) return null;
  const released = res.moments.stageB;
  let major: number | null = null;
  let source: "d4" | "fallback" = "fallback";
  if (released?.valid && released.d4SigmaMajorPx !== null && released.d4SigmaMinorPx !== null) {
    major = Math.max(released.d4SigmaMajorPx, released.d4SigmaMinorPx);
    source = "d4";
  } else if (res.fits.fitWidths) {
    major = Math.max(res.fits.fitWidths.d4SigmaMajorPx, res.fits.fitWidths.d4SigmaMinorPx);
    source = "d4";
  } else if (res.fits.gauss2d.params) {
    major = Math.min(width, height) * 0.2;
    source = "fallback";
  }
  if (major === null || !(major > 0) || !Number.isFinite(major)) return null;
  const pad = Math.max(96, major * 3);
  if (pad >= Math.min(width, height) * 0.85) return null;
  if (source === "fallback") return "fallback";
  if (major * 3 < 96) return "fixed";
  return "d4";
}

function imageCloseupRect(width: number, height: number, res: ImageAnalysisResult | null): ImageRoiRect | null {
  if (imageCloseupKind(width, height, res) === null || !res) return null;
  const released = res.moments.stageB;
  const params = res.fits.gauss2d.params;
  const widths = res.fits.fitWidths;
  let cx: number | undefined;
  let cy: number | undefined;
  let major: number | undefined;
  if (
    released?.valid &&
    released.d4SigmaMajorPx !== null &&
    released.d4SigmaMinorPx !== null &&
    released.centroidXPx !== null &&
    released.centroidYPx !== null
  ) {
    cx = released.centroidXPx;
    cy = released.centroidYPx;
    major = Math.max(released.d4SigmaMajorPx, released.d4SigmaMinorPx);
  } else if (params && widths && widths.d4SigmaMajorPx > 0 && widths.d4SigmaMinorPx > 0) {
    cx = params.centerXPx;
    cy = params.centerYPx;
    major = Math.max(widths.d4SigmaMajorPx, widths.d4SigmaMinorPx);
  } else if (params) {
    cx = params.centerXPx;
    cy = params.centerYPx;
    major = Math.min(width, height) * 0.2;
  }
  if (
    cx === undefined ||
    cy === undefined ||
    major === undefined ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !(major > 0) ||
    !Number.isFinite(major)
  ) {
    return null;
  }
  const pad = Math.max(96, major * 3);
  if (pad >= Math.min(width, height) * 0.85) return null;
  const vw = Math.max(1, Math.min(width, Math.round(pad)));
  const vh = Math.max(1, Math.min(height, Math.round(pad)));
  let x0 = Math.round(cx - vw / 2);
  let y0 = Math.round(cy - vh / 2);
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x0 + vw > width) x0 = width - vw;
  if (y0 + vh > height) y0 = height - vh;
  return { x0, y0, width: vw, height: vh };
}

function roiCoversView(roi: ImageRoiRect, view: ImageRoiRect): boolean {
  return (
    roi.x0 <= view.x0 &&
    roi.y0 <= view.y0 &&
    roi.x0 + roi.width >= view.x0 + view.width &&
    roi.y0 + roi.height >= view.y0 + view.height
  );
}

function px(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${sig(value, 4)} px`;
}

function pairPx(major: number | null | undefined, minor: number | null | undefined): string {
  if (major === null || major === undefined || minor === null || minor === undefined) return "—";
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return "—";
  return `${sig(major, 4)} px × ${sig(minor, 4)} px`;
}

function sizePxSpan(inner: string): string {
  return ` <span class="size-px">${esc(`(${inner})`)}</span>`;
}

function lengthHtml(pxVal: number | null | undefined, um: number | null | undefined, anisoNote?: string | null): string {
  if (pxVal === null || pxVal === undefined || !Number.isFinite(pxVal)) return esc("—");
  if (um === null || um === undefined || !Number.isFinite(um)) {
    if (anisoNote) return esc(`${px(pxVal)} · ${anisoNote}`);
    return esc(px(pxVal));
  }
  return `${esc(umToDisplay(um))}${sizePxSpan(`${sig(pxVal, 4)} px`)}`;
}

function axisPairCaption(T: Strings): string {
  return `<span class="size-axis">${esc(`${T.imgLongAxis} × ${T.imgShortAxis}`)}</span>`;
}

function withPairAxisLabel(html: string, T: Strings): string {
  if (html === "—" || html === esc("—")) return html;
  return `${html}${axisPairCaption(T)}`;
}

function withSingleAxisLabel(html: string, T: Strings, which: "major" | "minor"): string {
  const label = which === "major" ? T.imgLongAxis : T.imgShortAxis;
  return `<span class="size-axis-item">${html}<span class="size-axis">${esc(label)}</span></span>`;
}

function pairLengthHtml(
  majorPx: number | null | undefined,
  minorPx: number | null | undefined,
  majorUm: number | null | undefined,
  minorUm: number | null | undefined,
  anisoNote?: string | null,
): string {
  if (
    majorPx === null ||
    majorPx === undefined ||
    minorPx === null ||
    minorPx === undefined ||
    !Number.isFinite(majorPx) ||
    !Number.isFinite(minorPx)
  ) {
    return esc("—");
  }
  if (
    majorUm !== null &&
    majorUm !== undefined &&
    minorUm !== null &&
    minorUm !== undefined &&
    Number.isFinite(majorUm) &&
    Number.isFinite(minorUm)
  ) {
    return `${esc(`${umToDisplay(majorUm)} × ${umToDisplay(minorUm)}`)}${sizePxSpan(pairPx(majorPx, minorPx))}`;
  }
  if (anisoNote) return esc(`${pairPx(majorPx, minorPx)} · ${anisoNote}`);
  return esc(pairPx(majorPx, minorPx));
}

function ellipseUm(
  pxVal: number | null | undefined,
  engineUm: number | null | undefined,
  pitch: PixelPitch | null,
): number | null {
  if (!pitch || pxVal === null || pxVal === undefined || !Number.isFinite(pxVal)) return null;
  if (engineUm !== null && engineUm !== undefined && Number.isFinite(engineUm)) return engineUm;
  const scale = isotropicUmPerPx(pitch);
  return scale === null ? null : pxVal * scale;
}

function alongProfileUm(
  widthPx: number | null | undefined,
  stepUm: number | undefined,
  pitch: PixelPitch | null,
): number | null {
  if (!pitch || widthPx === null || widthPx === undefined || !Number.isFinite(widthPx)) return null;
  if (stepUm !== undefined && Number.isFinite(stepUm) && stepUm > 0) return widthPx * stepUm;
  const scale = isotropicUmPerPx(pitch);
  return scale === null ? null : widthPx * scale;
}

function axisAlignedUm(
  widthPx: number | null | undefined,
  stepUm: number | undefined,
  pitch: PixelPitch | null,
  axis: "x" | "y",
): number | null {
  if (!pitch || widthPx === null || widthPx === undefined || !Number.isFinite(widthPx)) return null;
  if (stepUm !== undefined && Number.isFinite(stepUm) && stepUm > 0) return widthPx * stepUm;
  return widthPx * (axis === "x" ? pitch.xUm : pitch.yUm);
}

function profileWidthUm(
  widthPx: number | null | undefined,
  stepUm: number | undefined,
  pitch: PixelPitch | null,
  axis: ProfileAxis,
): number | null {
  return axis === "rotated" ? alongProfileUm(widthPx, stepUm, pitch) : axisAlignedUm(widthPx, stepUm, pitch, axis);
}

function anisoLengthNote(pitch: PixelPitch | null, um: number | null, T: Strings): string | null {
  if (um !== null && Number.isFinite(um)) return null;
  if (!pitch || isotropicUmPerPx(pitch) !== null) return null;
  return T.imgAnisoPxNote;
}

function pairSizeHtml(
  majorPx: number | null | undefined,
  minorPx: number | null | undefined,
  majorUm: number | null | undefined,
  minorUm: number | null | undefined,
  pitch: PixelPitch | null,
  T: Strings,
  pixelTheta?: number | null,
  physicalTheta?: number | null,
): string {
  const aligned = alignedPixelPair(majorPx, minorPx, pixelTheta, physicalTheta);
  const firstUm = ellipseUm(aligned.firstPx, majorUm, pitch);
  const secondUm = ellipseUm(aligned.secondPx, minorUm, pitch);
  const note =
    firstUm === null && secondUm === null && pitch !== null && isotropicUmPerPx(pitch) === null ? T.imgAnisoPxNote : null;
  return withPairAxisLabel(pairLengthHtml(aligned.firstPx, aligned.secondPx, firstUm, secondUm, note), T);
}

function deg(rad: number | null | undefined): string {
  if (rad === null || rad === undefined || !Number.isFinite(rad)) return "—";
  return `${sig((rad * 180) / Math.PI, 4)}°`;
}

function percent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${sig(fraction * 100, 3)} %`;
}

function percentAlready(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${sig(value, 3)} %`;
}

function counts(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : sig(value, 4);
}

function yesNo(T: Strings, value: boolean): string {
  return value ? T.imgYes : T.imgNo;
}

function centroid(x: number | null | undefined, y: number | null | undefined): string {
  if (x === null || x === undefined || y === null || y === undefined) return "—";
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "—";
  return `${sig(x, 4)}, ${sig(y, 4)} px`;
}

function lookup(table: Record<string, string>, code: string | null | undefined, fallback = "—"): string {
  if (code === null || code === undefined || code === "") return fallback;
  return table[code] ?? code.replaceAll("_", " ").replaceAll("-", " ");
}

function suppressionLabel(T: Strings, code: string | null | undefined): string {
  return lookup(
    {
      fit_not_converged: T.imgReasonFitNotConverged,
      nonpositive_amplitude: T.imgReasonNonpositiveAmplitude,
      residual_high: T.imgReasonResidualHigh,
      aperture_clipped: T.imgReasonApertureClipped,
      coverage_insufficient: T.imgReasonCoverageInsufficient,
      alpha_inconsistent: T.imgReasonAlphaInconsistent,
      multi_peak: T.imgReasonMultiPeak,
    },
    code,
  );
}

function fitStatusLabel(T: Strings, code: string | null | undefined): string {
  return lookup(
    {
      converged: T.imgStatusConverged,
      max_iterations: T.imgStatusMaxIterations,
      time_budget_exceeded: T.imgStatusTimeBudget,
      singular_normal_equations: T.imgStatusSingular,
      invalid_start: T.imgStatusInvalidStart,
    },
    code,
  );
}

function widthReasonLabel(T: Strings, code: string | null | undefined): string {
  return lookup(
    {
      "low-signal": T.imgWidthLowSignal,
      "nonpositive-peak": T.imgWidthNonpositivePeak,
      gap: T.imgWidthGap,
    },
    code,
  );
}

function momentReasonLabel(T: Strings, code: string | null | undefined): string {
  return lookup(
    {
      nonfinite_aggregate: T.imgMomentNonfinite,
      nonpositive_sum: T.imgMomentNonpositiveSum,
      background_dominated: T.imgMomentBackgroundDominated,
      indefinite_covariance: T.imgMomentIndefinite,
      zero_covariance: T.imgMomentZeroCovariance,
    },
    code,
  );
}

function scaleSourceLabel(T: Strings, code: string | null | undefined): string {
  return lookup(
    {
      mad: T.imgScaleMad,
      iqr: T.imgScaleIqr,
      floor: T.imgScaleFloor,
      zero: T.imgScaleZero,
    },
    code,
  );
}

function metricLabel(T: Strings, metric: string): string {
  if (metric === "d4SigmaMajorPx") return `${T.imgD4Sigma} · ${T.imgMajor}`;
  if (metric === "d4SigmaMinorPx") return `${T.imgD4Sigma} · ${T.imgMinor}`;
  return metric;
}

function kv(label: string, value: KvValue, tone?: string): string {
  const color = tone ? ` style="color: ${tone};"` : "";
  const inner = typeof value === "string" ? esc(value) : value.html;
  return `<div class="kv-line"><span class="k">${esc(label)}</span><span class="v"${color}>${inner}</span></div>`;
}

function kvBlock(values: ReadonlyArray<KvRow>): string {
  return `<div class="img-kv">${values.map((row) => kv(row[0], row[1], row[2])).join("")}</div>`;
}

function panel(title: string, inner: string): string {
  return `<div class="mf-card img-panel"><div class="mf-card-title">${esc(title)}</div>${inner}</div>`;
}

function tile(label: string, value: KvValue, color = "#E7ECF4", hint?: { text: string; title: string }): string {
  const inner = typeof value === "string" ? esc(value) : value.html;
  const hintLine = hint ? `<div class="tile-hint" title="${esc(hint.title)}">${esc(hint.text)}</div>` : "";
  return `<div class="mf-card result-tile"><div class="tile-label">${esc(label)}</div><div class="tile-value" style="color: ${color};">${inner}</div>${hintLine}</div>`;
}

// Matches the close-up rule in main.ts (3× D4 window when widths exist,
// otherwise max(96, 0.6 × shorter side); skip if it would cover most of
// the frame). Presentation only — uses released/fit widths the engine
// already produced.
function gateTone(ok: boolean): string {
  return ok ? "#5CE1A0" : "#F26D6D";
}

function histogramSparkline(countsArr: ReadonlyArray<number>): string {
  if (countsArr.length === 0) return "";
  let maxCount = 1;
  for (const value of countsArr) {
    if (value > maxCount) maxCount = value;
  }
  const width = countsArr.length;
  const height = 42;
  const logMax = Math.log1p(maxCount);
  const bars: string[] = [];
  for (let i = 0; i < countsArr.length; i += 1) {
    const barHeight = (Math.log1p(Math.max(0, countsArr[i])) / logMax) * (height - 2);
    bars.push(
      `<rect x="${i}" y="${(height - barHeight).toFixed(2)}" width="0.9" height="${barHeight.toFixed(2)}" fill="#5CE1A0" opacity="0.85"/>`,
    );
  }
  return `<svg class="img-hist" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${bars.join("")}</svg>`;
}

function widthValue(T: Strings, measurement: WidthGate | undefined, um: number | null): KvValue {
  if (!measurement) return "—";
  if (measurement.widthPx === null || measurement.widthPx === undefined) {
    return `${T.imgSuppressed}: ${widthReasonLabel(T, measurement.suppressedReason)}`;
  }
  const extra = measurement.ambiguous ? ` · ${T.imgAmbiguous}` : "";
  return { html: `${lengthHtml(measurement.widthPx, um)}${esc(extra)}` };
}

function profileBlock(T: Strings, label: string, profile: Profile, pitch: PixelPitch | null, axis: ProfileAxis): string {
  if (!profile) return "";
  const widths = profile.widths;
  const umOf = (measurement: WidthGate | undefined): number | null =>
    profileWidthUm(measurement?.widthPx, profile.stepUm, pitch, axis);
  return kvBlock([
    [`${label} · ${T.imgPeak}`, `${counts(widths.peakValueCounts)} @ ${px(widths.peakPositionPx)}`],
    [`${label} · ${T.imgWidthFwhm}`, widthValue(T, widths.fwhmData, umOf(widths.fwhmData))],
    [`${label} · ${T.imgWidth1e2}`, widthValue(T, widths.oneOverESquaredData, umOf(widths.oneOverESquaredData))],
  ]);
}

function profilePairHtml(
  T: Strings,
  major: Profile,
  minor: Profile,
  pick: (widths: NonNullable<Profile>["widths"]) => WidthGate,
  pitch: PixelPitch | null,
): KvValue {
  if (!major && !minor) return "—";
  const majorM = major ? pick(major.widths) : undefined;
  const minorM = minor ? pick(minor.widths) : undefined;
  const majorPx = majorM?.widthPx;
  const minorPx = minorM?.widthPx;
  const majorOk = majorPx !== null && majorPx !== undefined && Number.isFinite(majorPx);
  const minorOk = minorPx !== null && minorPx !== undefined && Number.isFinite(minorPx);
  if (majorOk && minorOk) {
    return {
      html: withPairAxisLabel(
        pairLengthHtml(
          majorPx,
          minorPx,
          alongProfileUm(majorPx, major?.stepUm, pitch),
          alongProfileUm(minorPx, minor?.stepUm, pitch),
        ),
        T,
      ),
    };
  }
  if (!majorOk && !minorOk) {
    const majorReason = majorM?.suppressedReason ?? null;
    const minorReason = minorM?.suppressedReason ?? null;
    if (majorM || minorM) {
      if (majorReason === minorReason) return `${T.imgSuppressed}: ${widthReasonLabel(T, majorReason ?? minorReason)}`;
      return {
        html: `${esc(`${T.imgSuppressed}: ${widthReasonLabel(T, majorReason)}`)} × ${esc(`${T.imgSuppressed}: ${widthReasonLabel(T, minorReason)}`)}`,
      };
    }
    return "—";
  }
  const one = (profile: Profile, measurement: WidthGate | undefined): string => {
    if (!measurement) return esc("—");
    if (measurement.widthPx === null || measurement.widthPx === undefined || !Number.isFinite(measurement.widthPx)) {
      return esc(`${T.imgSuppressed}: ${widthReasonLabel(T, measurement.suppressedReason)}`);
    }
    return lengthHtml(measurement.widthPx, alongProfileUm(measurement.widthPx, profile?.stepUm, pitch));
  };
  return {
    html: `${withSingleAxisLabel(one(major, majorM), T, "major")} × ${withSingleAxisLabel(one(minor, minorM), T, "minor")}`,
  };
}

function momentsBlock(
  T: Strings,
  moments: Moments | null | undefined,
  extra: ReadonlyArray<KvRow> = [],
  pitch: PixelPitch | null = null,
  geometry: Physical | null | undefined = null,
): string {
  if (!moments) return kvBlock([[T.imgValid, "—"]]);
  const rows: KvRow[] = [[T.imgValid, yesNo(T, moments.valid), moments.valid ? "#5CE1A0" : "#F2B33D"]];
  if (!moments.valid) rows.push([T.imgSuppressed, momentReasonLabel(T, moments.invalidReason)]);
  rows.push(
    [
      T.imgD4Sigma,
      {
        html: pairSizeHtml(
          moments.d4SigmaMajorPx,
          moments.d4SigmaMinorPx,
          geometry?.d4SigmaMajorUm,
          geometry?.d4SigmaMinorUm,
          pitch,
          T,
          moments.thetaRad,
          geometry?.thetaRad,
        ),
      },
    ],
    [T.imgCentroid, centroid(moments.centroidXPx, moments.centroidYPx)],
    [T.imgTheta, deg(moments.thetaRad)],
    ...extra,
  );
  return kvBlock(rows);
}

function physicalBlock(
  T: Strings,
  geometry: Physical | null | undefined,
  pxMajor: number | null | undefined,
  pxMinor: number | null | undefined,
  cxPx: number | null | undefined,
  cyPx: number | null | undefined,
  pixelTheta: number | null | undefined,
  marker?: string,
): string {
  if (!geometry) return "";
  const aligned = alignedPixelPair(pxMajor, pxMinor, pixelTheta, geometry.thetaRad);
  const rows: KvRow[] = [
    [T.imgPhysicalD4, { html: withPairAxisLabel(pairLengthHtml(aligned.firstPx, aligned.secondPx, geometry.d4SigmaMajorUm, geometry.d4SigmaMinorUm), T) }],
    [T.imgCentroid, { html: `${lengthHtml(cxPx, geometry.centerXUm)}, ${lengthHtml(cyPx, geometry.centerYUm)}` }],
    [T.imgTheta, deg(geometry.thetaRad)],
  ];
  if (marker) rows.unshift([T.imgSuppressed, marker]);
  return `<div class="mf-sec-title">${esc(T.imgPhysical)}</div>${kvBlock(rows)}`;
}

function gaussParamsBlock(
  T: Strings,
  params: FitParams | null,
  pitch: PixelPitch | null,
  geometry: Physical | null | undefined,
): string {
  if (!params) return kvBlock([[T.imgFitParams, "—"]]);
  const rows: KvRow[] = [
    [T.imgAmplitude, counts(params.amplitudeCounts)],
    [T.imgFitBackground, counts(params.backgroundCounts)],
    [T.imgCentroid, centroid(params.centerXPx, params.centerYPx)],
    [T.imgSigmaMajor, { html: lengthHtml(params.sigmaMajorPx, ellipseUm(params.sigmaMajorPx, geometry?.sigmaMajorUm, pitch)) }],
    [T.imgSigmaMinor, { html: lengthHtml(params.sigmaMinorPx, ellipseUm(params.sigmaMinorPx, geometry?.sigmaMinorUm, pitch)) }],
    [T.imgTheta, deg(params.thetaRad)],
  ];
  if (params.backgroundSlopeXCountsPerPx !== undefined) {
    rows.push([`${T.imgFitBackground} ∂x`, counts(params.backgroundSlopeXCountsPerPx)]);
  }
  if (params.backgroundSlopeYCountsPerPx !== undefined) {
    rows.push([`${T.imgFitBackground} ∂y`, counts(params.backgroundSlopeYCountsPerPx)]);
  }
  return kvBlock(rows);
}

function superParamsBlock(
  T: Strings,
  params: SuperParams | null | undefined,
  pitch: PixelPitch | null,
  physicalTheta?: number | null,
): string {
  if (!params) return "";
  const w1Um = ellipseUm(params.w1Px, null, pitch);
  const w2Um = ellipseUm(params.w2Px, null, pitch);
  const crossed = axesCrossed(params.thetaRad, physicalTheta);
  return `<div class="mf-sec-title">${esc(T.imgSuperGauss2d)}</div>${kvBlock([
    [T.imgAmplitude, counts(params.amplitudeCounts)],
    [T.imgFitBackground, counts(params.backgroundCounts)],
    [T.imgCentroid, centroid(params.centerXPx, params.centerYPx)],
    [
      "w1",
      {
        html: withSingleAxisLabel(lengthHtml(params.w1Px, w1Um, anisoLengthNote(pitch, w1Um, T)), T, crossed ? "minor" : "major"),
      },
    ],
    [
      "w2",
      {
        html: withSingleAxisLabel(lengthHtml(params.w2Px, w2Um, anisoLengthNote(pitch, w2Um, T)), T, crossed ? "major" : "minor"),
      },
    ],
    [T.imgSuperGaussN, num(params.superGaussN, 3)],
    [T.imgTheta, deg(params.thetaRad)],
  ])}`;
}

// ── profile plot: measured samples + the released fit model ────────────────
//
// Display-only re-evaluation of parameters the engine already released. No
// fitting, no width measurement and no gate logic happens here: the curves
// are the fitted models drawn along the same line the engine sampled, and
// every marker position comes straight from the released width data.
//
// Model forms (exactly the ones packages/image/src/fit.ts optimises):
//   Gauss2d    I(x,y) = B + bx*(x-cx) + by*(y-cy)
//                       + A*exp(-0.5*((u/s1)^2 + (v/s2)^2))
//   SuperGauss I(x,y) = B + A*exp(-2*((u/w1)^2 + (v/w2)^2)^n)
// with u = (x-cx)*cos(th) + (y-cy)*sin(th), v = -(x-cx)*sin(th) + (y-cy)*cos(th).
// The tilted background is anchored on the fit centre, as in fit.ts.

export const IMAGE_PROFILE_KEYS: ReadonlyArray<ImageProfileKey> = [
  "cutX",
  "cutY",
  "projectionX",
  "projectionY",
  "axisMajor",
  "axisMinor",
];

export function profileLabel(T: Strings, key: ImageProfileKey): string {
  if (key === "cutX") return T.imgCutX;
  if (key === "cutY") return T.imgCutY;
  if (key === "projectionX") return T.imgProjX;
  if (key === "projectionY") return T.imgProjY;
  if (key === "axisMajor") return T.imgLongAxis;
  return T.imgShortAxis;
}

// The first released profile, used when the selected one is absent for this
// run (the engine releases null whenever its extractor could not run).
export function resolveProfileKey(res: ImageAnalysisResult | null, wanted: ImageProfileKey): ImageProfileKey | null {
  if (!res) return null;
  if (res.profiles[wanted]) return wanted;
  return IMAGE_PROFILE_KEYS.find((key) => res.profiles[key] !== null) ?? null;
}

type LineModel = {
  amplitude: number;
  background: number;
  slopeX: number;
  slopeY: number;
  cx: number;
  cy: number;
  a1: number;
  a2: number;
  theta: number;
  // null for the plain Gauss; the super-Gauss exponent otherwise (a1/a2 are
  // then the 1/e^2 half-widths w1/w2, not sigmas).
  superN: number | null;
};

function finiteAll(values: ReadonlyArray<number>): boolean {
  return values.every((value) => Number.isFinite(value));
}

function gaussModel(params: FitParams | null | undefined): LineModel | null {
  if (!params) return null;
  const { amplitudeCounts, backgroundCounts, centerXPx, centerYPx, sigmaMajorPx, sigmaMinorPx, thetaRad } = params;
  if (!finiteAll([amplitudeCounts, backgroundCounts, centerXPx, centerYPx, sigmaMajorPx, sigmaMinorPx, thetaRad])) return null;
  if (!(sigmaMajorPx > 0 && sigmaMinorPx > 0)) return null;
  return {
    amplitude: amplitudeCounts,
    background: backgroundCounts,
    slopeX: params.backgroundSlopeXCountsPerPx ?? 0,
    slopeY: params.backgroundSlopeYCountsPerPx ?? 0,
    cx: centerXPx,
    cy: centerYPx,
    a1: sigmaMajorPx,
    a2: sigmaMinorPx,
    theta: thetaRad,
    superN: null,
  };
}

function superModel(params: SuperParams | null | undefined): LineModel | null {
  if (!params) return null;
  const { amplitudeCounts, backgroundCounts, centerXPx, centerYPx, w1Px, w2Px, thetaRad, superGaussN } = params;
  if (!finiteAll([amplitudeCounts, backgroundCounts, centerXPx, centerYPx, w1Px, w2Px, thetaRad, superGaussN])) return null;
  if (!(w1Px > 0 && w2Px > 0 && superGaussN > 0)) return null;
  return {
    amplitude: amplitudeCounts,
    background: backgroundCounts,
    slopeX: params.backgroundSlopeXCountsPerPx ?? 0,
    slopeY: params.backgroundSlopeYCountsPerPx ?? 0,
    cx: centerXPx,
    cy: centerYPx,
    a1: w1Px,
    a2: w2Px,
    theta: thetaRad,
    superN: superGaussN,
  };
}

function modelAt(model: LineModel, x: number, y: number): number {
  const dx = x - model.cx;
  const dy = y - model.cy;
  const cos = Math.cos(model.theta);
  const sin = Math.sin(model.theta);
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;
  const base = model.background + model.slopeX * dx + model.slopeY * dy;
  const e = (u / model.a1) * (u / model.a1) + (v / model.a2) * (v / model.a2);
  const kernel = model.superN === null ? Math.exp(-0.5 * e) : Math.exp(-2 * Math.pow(e, model.superN));
  return base + model.amplitude * kernel;
}

// Projected variance of the fitted 2D Gauss along an image axis.
// Covariance of the model: Sigma = R * diag(s1^2, s2^2) * R^T, so
//   Sigma_xx = s1^2*cos^2(th) + s2^2*sin^2(th)
//   Sigma_yy = s1^2*sin^2(th) + s2^2*cos^2(th).
// Integrating the 2D kernel over the other axis gives
//   integral exp(-0.5*d^T Sigma^-1 d) dy
//     = sqrt(2*pi) * sqrt(det Sigma)/sqrt(Sigma_xx) * exp(-dx^2/(2*Sigma_xx)),
// with sqrt(det Sigma) = s1*s2. The projected profile is therefore a 1D
// Gauss of sigma sqrt(Sigma_xx) and peak A*sqrt(2*pi)*s1*s2/sqrt(Sigma_xx).
// The engine SUMS 1-px rows instead of integrating; for a beam contained in
// the ROI the two agree to far below plot resolution.
function projectedVariance(model: LineModel, axis: "x" | "y"): number {
  const cos = Math.cos(model.theta);
  const sin = Math.sin(model.theta);
  const major = model.a1 * model.a1;
  const minor = model.a2 * model.a2;
  return axis === "x" ? major * cos * cos + minor * sin * sin : major * sin * sin + minor * cos * cos;
}

// Numeric row/column quadrature for the super-Gauss, whose marginal has no
// elementary closed form. The stride caps the work; the sum is rescaled to
// the real line count so the background level still matches the data.
const PROJECTION_QUADRATURE_MAX_LINES = 192;

function projectedSuperGauss(model: LineModel, axis: "x" | "y", position: number, from: number, span: number, lineCount: number): number {
  if (!(span > 0) || !(lineCount > 0)) return Number.NaN;
  const samples = Math.min(span, PROJECTION_QUADRATURE_MAX_LINES);
  const step = span / samples;
  // Sample points are the midpoints of [from - 0.5, from + span - 0.5], so a
  // stride of 1 reproduces the engine's sum over the integer pixel centres
  // from .. from + span - 1 exactly.
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const other = from - 0.5 + (i + 0.5) * step;
    sum += axis === "x" ? modelAt(model, position, other) : modelAt(model, other, position);
  }
  return (sum / samples) * lineCount;
}

export type ProfilePlotMarker = { position: number; kind: "fwhm" | "e2" };

export type ProfilePlotData = {
  key: ImageProfileKey;
  kind: string;
  unit: "px" | "um";
  positions: number[];
  measured: number[];
  gauss: number[] | null;
  superGauss: number[] | null;
  markers: ProfilePlotMarker[];
  peak: { position: number; value: number } | null;
};

// The line the engine sampled: analyze.ts picks the released stage-B
// centroid/theta first and falls back to the converged Gauss fit. The third
// engine fallback (brightest ROI pixel) needs the pixel data and is not
// reproducible here, so the model curve is simply omitted in that case.
function profileLaneGeometry(res: ImageAnalysisResult): { cx: number; cy: number; theta: number | null } | null {
  const released = res.moments.stageB;
  if (
    released &&
    released.valid &&
    released.centroidXPx !== null &&
    released.centroidYPx !== null &&
    Number.isFinite(released.centroidXPx) &&
    Number.isFinite(released.centroidYPx)
  ) {
    const theta = released.thetaRad;
    return { cx: released.centroidXPx, cy: released.centroidYPx, theta: theta === null || !Number.isFinite(theta) ? null : theta };
  }
  const params = res.fits.gauss2d.params;
  if (params && finiteAll([params.centerXPx, params.centerYPx, params.thetaRad])) {
    return { cx: params.centerXPx, cy: params.centerYPx, theta: params.thetaRad };
  }
  return null;
}

function sampleAlongLine(
  model: LineModel,
  key: ImageProfileKey,
  positions: ReadonlyArray<number>,
  lane: { cx: number; cy: number; theta: number | null },
): number[] | null {
  if (key === "cutX") return positions.map((p) => modelAt(model, p, lane.cy));
  if (key === "cutY") return positions.map((p) => modelAt(model, lane.cx, p));
  if (lane.theta === null) return null;
  const angle = key === "axisMajor" ? lane.theta : lane.theta + Math.PI / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return positions.map((p) => modelAt(model, lane.cx + p * cos, lane.cy + p * sin));
}

function sampleProjection(
  model: LineModel,
  axis: "x" | "y",
  positions: ReadonlyArray<number>,
  contributing: ReadonlyArray<number> | undefined,
  roi: ImageAnalysisResult["roi"]["rect"],
): number[] {
  const span = axis === "x" ? roi.height : roi.width;
  const from = axis === "x" ? roi.y0 : roi.x0;
  const otherMean = from + (span - 1) / 2;
  if (model.superN !== null) {
    return positions.map((p, i) => projectedSuperGauss(model, axis, p, from, span, contributing?.[i] ?? span));
  }
  const variance = projectedVariance(model, axis);
  if (!(variance > 0) || !Number.isFinite(variance)) return positions.map(() => Number.NaN);
  const sigma = Math.sqrt(variance);
  const peak = (model.amplitude * Math.sqrt(2 * Math.PI) * model.a1 * model.a2) / sigma;
  const centre = axis === "x" ? model.cx : model.cy;
  const otherCentre = axis === "x" ? model.cy : model.cx;
  return positions.map((p, i) => {
    const lines = contributing?.[i] ?? span;
    const d = p - centre;
    const alongSlope = axis === "x" ? model.slopeX : model.slopeY;
    const acrossSlope = axis === "x" ? model.slopeY : model.slopeX;
    const backgroundSum = lines * (model.background + alongSlope * d + acrossSlope * (otherMean - otherCentre));
    return peak * Math.exp(-(d * d) / (2 * variance)) + backgroundSum;
  });
}

// Pure plot payload for one profile. main.ts owns the canvas; this module
// stays DOM-free so the Node unit tests can import it.
export function buildProfilePlotData(res: ImageAnalysisResult | null, wanted: ImageProfileKey): ProfilePlotData | null {
  const key = resolveProfileKey(res, wanted);
  if (!res || key === null) return null;
  const profile = res.profiles[key];
  if (!profile || profile.positionsPx.length === 0) return null;
  const stepUm = profile.stepUm;
  const useUm = stepUm !== undefined && Number.isFinite(stepUm) && stepUm > 0;
  const scale = useUm ? (stepUm as number) : 1;
  const positions = profile.positionsPx.map((p) => p * scale);

  const lane = profileLaneGeometry(res);
  // The Gauss model is drawn whenever the fit released parameters (a
  // non-converged fit still carries its last iterate, and seeing it is the
  // point of the overlay). The super-Gauss is only drawn once it converged.
  const gauss = gaussModel(res.fits.gauss2d.params);
  const superFit = res.fits.superGauss2d;
  const superParams = superFit?.converged ? superFit.params : null;
  const superG = superModel(superParams);

  const projectionAxis: "x" | "y" | null = key === "projectionX" ? "x" : key === "projectionY" ? "y" : null;
  const modelLine = (model: LineModel | null): number[] | null => {
    if (!model) return null;
    if (projectionAxis !== null) {
      return sampleProjection(model, projectionAxis, profile.positionsPx, profile.contributingCounts, res.roi.rect);
    }
    if (!lane) return null;
    return sampleAlongLine(model, key, profile.positionsPx, lane);
  };

  const markers: ProfilePlotMarker[] = [];
  const pushMarker = (value: number | null, kind: "fwhm" | "e2"): void => {
    if (value !== null && Number.isFinite(value)) markers.push({ position: value * scale, kind });
  };
  pushMarker(profile.widths.fwhmData.leftCrossingPx, "fwhm");
  pushMarker(profile.widths.fwhmData.rightCrossingPx, "fwhm");
  pushMarker(profile.widths.oneOverESquaredData.leftCrossingPx, "e2");
  pushMarker(profile.widths.oneOverESquaredData.rightCrossingPx, "e2");

  const peakPosition = profile.widths.peakPositionPx;
  const peakValue = profile.widths.peakValueCounts;

  return {
    key,
    kind: profile.kind,
    unit: useUm ? "um" : "px",
    positions,
    measured: profile.values.slice(),
    gauss: modelLine(gauss),
    superGauss: modelLine(superG),
    markers,
    peak:
      Number.isFinite(peakPosition) && Number.isFinite(peakValue)
        ? { position: peakPosition * scale, value: peakValue }
        : null,
  };
}

// ── honest suggestion iteration (item 2) ──────────────────────────────────
//
// The engine emits a fresh suggested ROI after every run, and the first one
// (before a measured noise scale exists) is deliberately crude. Silently
// drawing a new dashed rectangle every time reads like a bug, so the
// callout appears only once the proposal is materially different from the
// rectangle that was ACTUALLY analysed:
//   area:     |A_sug - A_roi| / A_roi           > 0.10
//   position: max(|dcx| / w_roi, |dcy| / h_roi)  > 0.10
// where (dcx, dcy) is the offset between the two rectangle centres. Below
// both thresholds nothing is shown and the dashed overlay stays as is.
const SUGGESTION_CALLOUT_RELATIVE_THRESHOLD = 0.1;

// Identity of the current ROI draft, used to expire the ROI-from-fit
// non-shrink note without a reset call in every ROI editing path.
export function imageRoiStateKey(): string {
  const st = S.img;
  return `${st.roiMode}|${st.roiX0}|${st.roiY0}|${st.roiW}|${st.roiH}`;
}

// Keep the button and its click path on the analyzer's one released-geometry
// verdict. A released stage-B width remains usable on its own; a fit fallback
// also needs parameters and the engine-provided geometry release.
export function roiFromFitEligible(result: ImageAnalysisResult | null): boolean {
  const released = result?.moments.stageB;
  if (released?.valid === true) return true;
  const gauss = result?.fits.gauss2d;
  return gauss?.converged === true && gauss.params !== null && gauss.geometryReleasable === true;
}

export type SuggestionDelta = {
  areaRatio: number;
  areaRelative: number;
  positionRelative: number;
  direction: "tighter" | "wider" | "shifted";
};

export function suggestionDelta(res: ImageAnalysisResult | null): SuggestionDelta | null {
  const suggestion = res?.roi.suggestion?.rect;
  const analyzed = res?.roi.rect;
  if (!suggestion || !analyzed) return null;
  const analyzedArea = analyzed.width * analyzed.height;
  const suggestedArea = suggestion.width * suggestion.height;
  if (!(analyzedArea > 0) || !(suggestedArea > 0)) return null;
  const areaRatio = suggestedArea / analyzedArea;
  const areaRelative = Math.abs(suggestedArea - analyzedArea) / analyzedArea;
  const dcx = suggestion.x0 + suggestion.width / 2 - (analyzed.x0 + analyzed.width / 2);
  const dcy = suggestion.y0 + suggestion.height / 2 - (analyzed.y0 + analyzed.height / 2);
  const positionRelative = Math.max(Math.abs(dcx) / analyzed.width, Math.abs(dcy) / analyzed.height);
  if (areaRelative <= SUGGESTION_CALLOUT_RELATIVE_THRESHOLD && positionRelative <= SUGGESTION_CALLOUT_RELATIVE_THRESHOLD) {
    return null;
  }
  const direction =
    areaRelative <= SUGGESTION_CALLOUT_RELATIVE_THRESHOLD ? "shifted" : areaRatio < 1 ? "tighter" : "wider";
  return { areaRatio, areaRelative, positionRelative, direction };
}

function suggestionCallout(T: Strings, res: ImageAnalysisResult | null): string {
  const delta = suggestionDelta(res);
  const suggestion = res?.roi.suggestion?.rect;
  const analyzed = res?.roi.rect;
  if (!delta || !suggestion || !analyzed) return "";
  const headline =
    delta.direction === "tighter"
      ? T.imgSuggestionCalloutTighter
      : delta.direction === "wider"
        ? T.imgSuggestionCalloutWider
        : T.imgSuggestionCalloutShifted;
  const signed = delta.areaRatio - 1;
  const areaPercent = `${signed >= 0 ? "+" : "−"}${sig(Math.abs(signed) * 100, 3)} %`;
  return `<div class="mf-card img-callout">
      <div class="img-callout-head">
        <span class="img-callout-dot"></span>
        <span class="img-callout-title">${esc(headline)}</span>
      </div>
      <div class="img-callout-line">${esc(
        T.imgSuggestionCalloutNumbers(
          suggestion.width,
          suggestion.height,
          suggestion.x0,
          suggestion.y0,
          analyzed.width,
          analyzed.height,
          areaPercent,
        ),
      )}</div>
      <div class="img-callout-line faint">${esc(T.imgSuggestionCalloutWhy)}</div>
      <button data-act="img-apply-suggestion-run" class="btn-solid img-callout-btn">${esc(T.imgApplySuggestionRun)}</button>
    </div>`;
}

// Part A data-act names (click handlers land in main.ts, part B):
//   img-bg-rect-add      add a background rectangle row
//   img-bg-rect-remove   remove one background rectangle (data-i index)
//   img-bg-rect-corners  fill four corner rectangles, each ~12% of a frame side
//   img-bg-pick-dark     open the dark-frame file picker
//   img-apply-suggestion apply the suggested ROI to the ROI inputs
//   img-roi-from-fit     set the draft rectangle from the released widths
// Part A data-k names for indexable inputs: bgRectX0-<i>, bgRectY0-<i>,
//   bgRectW-<i>, bgRectH-<i> (i is the rectangle index; integers only).
//
// Operator-feature data-act names added later:
//   img-profile              select the profile the plot draws (data-arg = key)
//   img-profile-png          download the current profile plot as a PNG
//   img-apply-suggestion-run apply the suggested ROI AND start the re-analysis
//   imgColorMap (data-k)     preview color map: gray | turbo | viridis

function profilePlotPanel(T: Strings, res: ImageAnalysisResult | null): string {
  if (!res) return "";
  const active = resolveProfileKey(res, S.img.profileKey);
  const chips = IMAGE_PROFILE_KEYS.map((key) =>
    segBtn("img-profile", key, profileLabel(T, key), key === active, res.profiles[key] === null ? " disabled" : ""),
  ).join("");
  const data = buildProfilePlotData(res, S.img.profileKey);
  const notes: string[] = [];
  if (!data) {
    notes.push(T.imgProfileMissing);
  } else {
    if (data.gauss === null) notes.push(T.imgProfileNoModel);
    if (data.kind === "projection-x" || data.kind === "projection-y") notes.push(T.imgProfileProjectionNote);
    if (data.kind === "axis") notes.push(T.imgProfileAxisNote);
  }
  return `<div class="mf-card img-panel img-plot-card">
      <div class="img-plot-head">
        <div class="mf-card-title">${esc(T.imgProfilePlot)}</div>
        <div style="flex: 1;"></div>
        <button data-act="img-profile-png" class="btn-ghost"${data ? "" : " disabled"}>${esc(T.imgProfileExportPng)}</button>
      </div>
      <div class="mf-seg img-profile-chips">${chips}</div>
      <canvas id="img-profile-canvas" class="img-plot-canvas"></canvas>
      ${notes.map((note) => `<div class="mf-note">${esc(note)}</div>`).join("")}
    </div>`;
}

export function renderImageTab(T: Strings): string {
  const st = S.img;
  const res = st.result;
  const rectEditorVisible = bgRectEditorAvailable(st.bgMethod);
  const drawTarget = normalizeImageDrawTarget(st.drawTarget, st.bgMethod);

  const channelSelect = () => `<select data-k="imgChannel" class="mf-select">${st.channels
    .map((c) => `<option value="${esc(c)}"${st.channel === c ? " selected" : ""}>${esc(c)}</option>`)
    .join("")}</select>`;

  const pageAndChannel =
    st.pageCount <= 1 && st.channels.length <= 1
      ? ""
      : `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          ${st.pageCount > 1 ? fieldCol(T.imgPage, bareInput("imgPage", st.page, { blur: false })) : ""}
          ${st.channels.length > 1 ? fieldCol(T.imgChannel, channelSelect()) : ""}
        </div>`;

  const calibration =
    `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      ${fieldCol(T.imgCalX, bareInput("imgCalX", st.calX, { blur: false, placeholder: "—" }))}
      ${fieldCol(T.imgCalY, bareInput("imgCalY", st.calY, { blur: false, placeholder: "—" }))}
    </div>`;

  const rectEditor =
    !rectEditorVisible
      ? ""
      : `<div class="img-rect-editor">
          <div class="mf-sec-title">${esc(T.imgRectEditor)}</div>
          <div class="mf-note">${esc(T.imgRectHint)}</div>
          ${st.bgRects
            .map(
              (r, i) => `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: 4px; align-items: center; margin-bottom: 4px;">
              ${fieldCol(T.imgRectX0, bareInput(`bgRectX0-${i}`, String(r.x0), { blur: false }))}
              ${fieldCol(T.imgRectY0, bareInput(`bgRectY0-${i}`, String(r.y0), { blur: false }))}
              ${fieldCol(T.imgRectW, bareInput(`bgRectW-${i}`, String(r.width), { blur: false }))}
              ${fieldCol(T.imgRectH, bareInput(`bgRectH-${i}`, String(r.height), { blur: false }))}
              <button data-act="img-bg-rect-remove" data-i="${i}" class="btn-ghost">${esc(T.imgRectRemove)}</button>
            </div>`,
            )
            .join("")}
          <div style="display: flex; gap: 8px; margin-top: 6px;">
            <button data-act="img-bg-rect-add" class="btn-dashed">${esc(T.imgRectAdd)}</button>
            <button data-act="img-bg-rect-corners" class="btn-dashed">${esc(T.imgRectCorners)}</button>
          </div>
        </div>`;

  const darkErrorText = (() => {
    if (st.darkError === null) return "";
    const error = st.darkError;
    const textByKind: Record<DarkError["kind"], string> = {
      dimensions:
        error.kind === "dimensions"
          ? T.imgBgDarkDimMismatch(error.darkWidth, error.darkHeight, error.imageWidth, error.imageHeight)
          : "",
      decode: T.imgBgDarkDecodeFailed,
      dtype: error.kind === "dtype" ? T.imgBgDarkDtypeMismatch(error.darkDtype, error.imageDtype) : "",
    };
    return textByKind[error.kind];
  })();
  const darkErrorDetail =
    st.darkError?.kind === "decode"
      ? st.darkError.detail
          .filter((detail) => detail !== "")
          .map((detail) => `<div class="mf-note" style="color: #8B94A3; margin-top: -2px;">${esc(detail)}</div>`)
          .join("")
      : "";
  const darkFramePicker =
    st.bgMethod !== "dark-frame"
      ? ""
      : `<div style="margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">
          <button data-act="img-bg-pick-dark" class="btn-dashed">${esc(T.imgBgPickDark)}</button>
          ${st.darkFrame ? `<div class="mf-note">${esc(T.imgBgDarkLoaded(st.darkFrame.name, st.darkFrame.width, st.darkFrame.height, st.darkFrame.sourceDtype))}</div>` : ""}
          ${st.darkError ? `<div class="mf-note" style="color: #D96C6C;">${esc(darkErrorText)}</div>${darkErrorDetail}` : ""}
        </div>`;

  const background =
    `<select data-k="imgBgMethod" class="mf-select">
      <option value="none"${st.bgMethod === "none" ? " selected" : ""}>${esc(T.imgBgNone)}</option>
      <option value="auto"${st.bgMethod === "auto" ? " selected" : ""}>${esc(T.imgAuto)}</option>
      <option value="manual-offset"${st.bgMethod === "manual-offset" ? " selected" : ""}>${esc(T.imgBgManualOffset)}</option>
      <option value="dark-frame"${st.bgMethod === "dark-frame" ? " selected" : ""}>${esc(T.imgBgDarkFrame)}</option>
      <option value="rect-median"${st.bgMethod === "rect-median" ? " selected" : ""}>${esc(T.imgBgRectMedian)}</option>
      <option value="robust-plane"${st.bgMethod === "robust-plane" ? " selected" : ""}>${esc(T.imgBgRobustPlane)}</option>
    </select>
    ${st.bgMethod === "manual-offset" ? fieldCol(T.imgBgOffsetCounts, bareInput("imgBgOffset", st.bgOffset, { blur: false })) : ""}
    ${rectEditor}
    ${darkFramePicker}`;

  const roiRect =
    st.roiMode === "rect"
      ? `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          ${fieldCol(T.imgRectX0, bareInput("imgRoiX0", st.roiX0, { blur: false }))}
          ${fieldCol(T.imgRectY0, bareInput("imgRoiY0", st.roiY0, { blur: false }))}
          ${fieldCol(T.imgRectW, bareInput("imgRoiW", st.roiW, { blur: false }))}
          ${fieldCol(T.imgRectH, bareInput("imgRoiH", st.roiH, { blur: false }))}
        </div>`
      : "";

  const drawTargetToggle = rectEditorVisible
    ? `<div class="mf-seg" style="margin-top: 8px;">
        ${segBtn("img-draw-target", "roi", T.imgDrawTargetRoi, drawTarget === "roi")}
        ${segBtn("img-draw-target", "bg-rect", T.imgDrawTargetBgRect, drawTarget === "bg-rect")}
      </div>`
    : "";

  const fromFitBtn =
    roiFromFitEligible(res)
      ? `<button data-act="img-roi-from-fit" class="btn-dashed" style="margin-top: 4px;">${esc(T.imgRoiFromFit)}</button>`
      : "";
  // Non-shrink note of the ROI-from-fit button. It is keyed to the rectangle
  // it was raised for, so it disappears by itself as soon as that rectangle
  // changes in ANY way (button, suggestion, typing, drag, mode switch).
  const fromFitNote =
    st.roiFitNote !== null && st.roiFitNote === imageRoiStateKey()
      ? `<div class="mf-note" style="color: #F2C879;">${esc(T.imgRoiFitNotNarrowed)}</div>`
      : "";
  const typedRoi = st.roiMode === "rect" ? resolveTypedRoi(st.roiX0, st.roiY0, st.roiW, st.roiH, st.width, st.height) : null;
  const roiClampNote =
    typedRoi?.kind === "clamped" || (st.roiClampNote !== null && st.roiClampNote === imageRoiStateKey())
      ? `<div class="img-roi-note">${esc(T.imgRoiClamped)}</div>`
      : "";

  const suggestion = res?.roi.suggestion ?? null;
  const suggestionLine = suggestion
    ? `<div style="margin-top: 8px;">
        ${kv(T.imgSuggestedRoi, `${T.imgRectX0} ${suggestion.rect.x0} · ${T.imgRectY0} ${suggestion.rect.y0} · ${suggestion.rect.width}×${suggestion.rect.height}`)}
        ${suggestion.clampedToImage ? `<div class="mf-note-faint">${esc(T.imgSuggestionClamped)}</div>` : ""}
        ${suggestion.suspectNoiseDominated ? `<div class="mf-note-faint">${esc(T.imgSuggestionNoiseDominated)}</div>` : ""}
        <button data-act="img-apply-suggestion" class="btn-dashed" style="margin-top: 4px;">${esc(T.imgApplySuggestion)}</button>
      </div>`
    : "";

  const runLabel = st.busy ? (st.phase === "decode" ? T.imgDecoding : T.imgBusy) : T.imgRun;

  const pitch = parsePitch(st.calX, st.calY);
  const released = res?.moments.stageB ?? null;
  const releasedOk = released !== null && released.valid;
  const physicalFromMoments = res?.moments.physical ?? null;
  const physicalFromFit = res?.fits.physical ?? null;
  const physical = physicalFromMoments ?? physicalFromFit ?? null;
  const physicalFromSuppressedFit = !releasedOk && physicalFromMoments === null && physicalFromFit !== null;
  const pixelTheta = releasedOk ? released.thetaRad : res?.fits.gauss2d.params?.thetaRad;
  const physicalTheta = physical?.thetaRad;
  const swapProfiles = axesCrossed(pixelTheta, physicalTheta);
  // Physical-major titles stay; only the bound profile data swaps when eigen-order crosses.
  const profileMajor = res && swapProfiles ? res.profiles.axisMinor : res?.profiles.axisMajor;
  const profileMinor = res && swapProfiles ? res.profiles.axisMajor : res?.profiles.axisMinor;
  const d4Value: KvValue = releasedOk
    ? {
        html: pairSizeHtml(
          released.d4SigmaMajorPx,
          released.d4SigmaMinorPx,
          physicalFromMoments?.d4SigmaMajorUm,
          physicalFromMoments?.d4SigmaMinorUm,
          pitch,
          T,
          released.thetaRad,
          physicalFromMoments?.thetaRad,
        ),
      }
    : `${T.imgSuppressed}: ${suppressionLabel(T, res?.moments.suppressionReason ?? null)}`;
  const d4Color = releasedOk ? "#E7ECF4" : "#F2B33D";
  const fitWidthValue: KvValue = {
    html: pairSizeHtml(
      res?.fits.fitWidths?.d4SigmaMajorPx,
      res?.fits.fitWidths?.d4SigmaMinorPx,
      res?.fits.physical?.d4SigmaMajorUm,
      res?.fits.physical?.d4SigmaMinorUm,
      pitch,
      T,
      res?.fits.gauss2d.params?.thetaRad,
      res?.fits.physical?.thetaRad,
    ),
  };
  const ungatedHint = res && !releasedOk ? { text: T.imgUngatedHint, title: T.imgUngatedHintTitle } : undefined;
  const roiOutOfRange = typedRoi?.kind === "invalid";
  const runBlocked = st.busy || !st.loaded || typedRoi?.kind === "invalid" || typedRoi?.kind === "incomplete";

  const diagnosticsInner = res
    ? `${kvBlock([
        [T.imgSize, `${res.raw.width} × ${res.raw.height}`],
        [T.imgDtype, String(res.raw.dtype)],
        [T.imgMin, counts(res.raw.minValue)],
        [T.imgMax, counts(res.raw.maxValue)],
        [T.imgMedian, counts(res.raw.medianValue)],
        [T.imgDynamicRange, counts(res.raw.dynamicRange)],
        [T.imgSaturated, `${res.raw.saturatedCount} · ${percent(res.raw.saturatedFraction)}`],
        [T.imgClippingSuspect, yesNo(T, res.raw.clippingSuspect), res.raw.clippingSuspect ? "#F2B33D" : "#97A1B2"],
        [T.imgHotPixels, String(res.raw.hotPixelCandidateCount)],
        [T.imgZeros, String(res.raw.zeroCount)],
        [T.imgNegatives, String(res.raw.negativeCount)],
        [T.imgNonFinite, String(res.raw.nonFiniteCount)],
        [T.imgEdgeTouch, yesNo(T, res.raw.edgeTouch), res.raw.edgeTouch ? "#F2B33D" : "#97A1B2"],
        [T.imgLocalMaxima, String(res.raw.localMaximaCount)],
      ])}
       <div class="mf-sec-title">${esc(T.imgHistogram)}</div>
       ${histogramSparkline(res.raw.histogram.counts)}
       ${
         res.warnings.length > 0
           ? `<div class="mf-sec-title">${esc(T.imgWarnings)}</div><div class="img-warns">${res.warnings.map((wv) => warningCard(wv, "", T.imgWarningTitle(wv.code))).join("")}</div>`
           : ""
       }`
    : `<div class="mf-note-faint">${esc(T.imgNoData)}</div>`;

  const backgroundNoiseInner = res
    ? kvBlock([
        [T.imgSigmaB, counts(res.noise.sigmaCounts)],
        [T.imgScaleSource, scaleSourceLabel(T, res.noise.scaleSource)],
        [T.imgMedian, counts(res.noise.medianCounts)],
        [T.imgMean, counts(res.noise.meanCounts)],
        [T.imgStd, counts(res.noise.stdCounts)],
        [T.imgMad, counts(res.noise.madCounts)],
        [T.imgIqr, counts(res.noise.iqrCounts)],
        [T.imgFloorApplied, yesNo(T, res.noise.floorApplied)],
        [T.imgSampleCount, String(res.noise.sampleCount)],
        [T.imgNegatives, `${res.background.negativeCountAfter} · ${percent(res.background.negativeFractionAfter)}`],
      ])
    : "";

  const sensitivityRows = (res?.stability.sensitivities ?? []).map((item: Sensitivity) => {
    const note = item.clampedContributing ? ` · ${T.imgClamped}` : "";
    return [metricLabel(T, item.metric), `${percentAlready(item.halfSpreadPercent)}${note}`] as const;
  });

  const roiSourceLabel = (source: ImageAnalysisResult["roi"]["source"]): string =>
    source === "full-frame" ? T.imgRoiSourceFull : source === "auto" ? T.imgRoiSourceAuto : T.imgRoiSourceInput;

  const autoProvenance = (() => {
    if (!res) return "";
    const lines: string[] = [];
    if (st.bgMethod === "auto" && res.background.requestedMethod === "auto") {
      lines.push(res.background.resolvedMethod === "robust-plane" ? T.imgBgAutoRobustPlane : T.imgBgAutoNone);
    }
    if (st.roiMode === "auto" && res.roi.source === "auto") {
      lines.push(T.imgAutoRoi(res.roi.rect.x0, res.roi.rect.y0, res.roi.rect.width, res.roi.rect.height));
      if (res.roi.autoFallbackReason === "no-suggestion") lines.push(T.imgAutoRoiNoSuggestion);
    }
    return lines.map((line) => `<div class="mf-note">${esc(line)}</div>`).join("");
  })();

  const stabilityInner = res
    ? kvBlock([
        [T.imgRoiSource, roiSourceLabel(res.roi.source)],
        [
          T.imgRoi,
          `${T.imgRectX0} ${res.roi.rect.x0} · ${T.imgRectY0} ${res.roi.rect.y0} · ${res.roi.rect.width}×${res.roi.rect.height}${
            res.roi.source === "full-frame" ? ` · ${T.imgRoiFullFrameNote}` : ""
          }`,
        ],
        [T.imgValidVariants, String(res.stability.validVariantCount)],
        [T.imgUndeterminable, yesNo(T, res.stability.undeterminable), res.stability.undeterminable ? "#F2B33D" : "#97A1B2"],
        [T.imgPartialSweep, yesNo(T, res.stability.partialSweep)],
        [T.imgFullFrame, yesNo(T, res.stability.fullFrame)],
      ]) +
      (sensitivityRows.length > 0 ? `<div class="mf-sec-title">${esc(T.imgHalfSpread)}</div>${kvBlock(sensitivityRows)}` : "")
    : "";

  const stageA = res?.momentsRoiDiagnostic.moments;
  const encircledItems = res?.metrics.encircledPowerRadiiPx ?? [];
  const encircledAniso = encircledItems.some((item) => anisoLengthNote(pitch, ellipseUm(item.radiusPx, null, pitch), T) !== null);
  const encircledHtml = encircledItems
    .map((item) => {
      const um = ellipseUm(item.radiusPx, null, pitch);
      return `${esc(`${sig(item.fraction * 100, 2)}% `)}${lengthHtml(item.radiusPx, um)}`;
    })
    .join(" · ");
  const encircledRow = encircledHtml ? `${encircledHtml}${encircledAniso ? ` · ${esc(T.imgAnisoPxNote)}` : ""}` : "";
  const modelCompare = res?.metrics.modelComparison;
  const momentsProfilesInner = res
    ? `<div class="mf-sec-title">${esc(T.imgStageB)}</div>${momentsBlock(
        T,
        released,
        [
          [T.imgEllipticity, num(res.metrics.ellipticity, 4)],
          ...(res.metrics.ellipticityPhysical !== null
            ? ([[T.imgEllipticityPhysical, num(res.metrics.ellipticityPhysical, 4)]] as const)
            : []),
        ],
        pitch,
        physicalFromMoments,
      )}
      <div class="mf-sec-title">${esc(T.imgSymmetry)}</div>${kvBlock([
        [T.imgRotationAsymmetry, num(res.metrics.symmetry?.rotationAsymmetry, 3)],
        [T.imgAxialAsymmetryX, num(res.metrics.symmetry?.axialAsymmetryX, 3)],
        [T.imgAxialAsymmetryY, num(res.metrics.symmetry?.axialAsymmetryY, 3)],
      ])}
      ${physicalBlock(
        T,
        physical,
        physicalFromMoments ? released?.d4SigmaMajorPx : res.fits.fitWidths?.d4SigmaMajorPx,
        physicalFromMoments ? released?.d4SigmaMinorPx : res.fits.fitWidths?.d4SigmaMinorPx,
        physicalFromMoments ? released?.centroidXPx : res.fits.gauss2d.params?.centerXPx,
        physicalFromMoments ? released?.centroidYPx : res.fits.gauss2d.params?.centerYPx,
        physicalFromMoments ? released?.thetaRad : res.fits.gauss2d.params?.thetaRad,
        physicalFromSuppressedFit ? T.imgPhysicalFromFit : undefined,
      )}
      <div class="mf-sec-title">${esc(T.imgFitWidth)}</div>${kvBlock([[T.imgFitWidth, fitWidthValue]])}
      ${encircledRow ? kvBlock([[T.imgEncircled, { html: encircledRow }]]) : ""}
      ${
        modelCompare
          ? kvBlock([[T.imgModelCompare, modelCompare.relativeRmsReduction === null ? "—" : percent(modelCompare.relativeRmsReduction)]])
          : ""
      }
      <div class="mf-sec-title">${esc(T.imgAperture)}</div>${gateBlock(T, res)}
      <div class="mf-sec-title">${esc(T.imgStageA)}</div>${momentsBlock(T, stageA, [], pitch)}
      <div class="mf-sec-title">${esc(T.imgProfilesCut)}</div>
      ${profileBlock(T, T.imgCutX, res.profiles.cutX, pitch, "x")}
      ${profileBlock(T, T.imgCutY, res.profiles.cutY, pitch, "y")}
      ${profileBlock(T, T.imgProjX, res.profiles.projectionX, pitch, "x")}
      ${profileBlock(T, T.imgProjY, res.profiles.projectionY, pitch, "y")}
      ${profileBlock(T, T.imgLongAxis, profileMajor ?? null, pitch, "rotated")}
      ${profileBlock(T, T.imgShortAxis, profileMinor ?? null, pitch, "rotated")}`
    : "";

  const gauss = res?.fits.gauss2d;
  const superFit = res?.fits.superGauss2d;
  const fitsInner = res
    ? `<div class="mf-sec-title">${esc(T.imgFitStatus)}</div>${kvBlock([
        [T.imgGauss2d, fitStatusLabel(T, gauss?.status), gauss?.converged ? "#5CE1A0" : "#F2B33D"],
        [T.imgSuperGauss2d, fitStatusLabel(T, superFit?.status ?? null), superFit?.converged ? "#5CE1A0" : "#97A1B2"],
        [T.imgIterations, gauss ? String(gauss.iterations) : "—"],
        [T.imgResidualRms, counts(res.residuals?.rmsCounts ?? gauss?.residualRmsCounts ?? null)],
        [T.imgResidualMax, counts(res.residuals?.maxAbsCounts ?? gauss?.residualMaxAbsCounts ?? null)],
      ])}
      <div class="mf-sec-title">${esc(T.imgFitParams)}</div>${gaussParamsBlock(T, gauss?.params ?? null, pitch, res.fits.physical)}
      ${superParamsBlock(T, superFit?.params, pitch, res.fits.physical?.thetaRad)}`
    : "";

  const closeupKind = imageCloseupKind(st.width, st.height, res);
  const closeupAvailable = closeupKind !== null;
  const showingCloseup = closeupAvailable && st.previewView !== "full";
  const previewTitle = showingCloseup
    ? `${T.imgRawRender} · ${T.imgSpotCloseup}`
    : closeupAvailable
      ? `${T.imgRawRender} · ${T.imgViewFull}`
      : T.imgRawRender;
  const closeupRect = showingCloseup ? imageCloseupRect(st.width, st.height, res) : null;
  const residualCoCropped = closeupRect !== null && res !== null && roiCoversView(res.roi.rect, closeupRect);
  const residualTitle = res
    ? residualCoCropped && closeupRect
      ? T.imgResidualWindowLabel(closeupRect.width, closeupRect.height)
      : T.imgResidualRoiLabel(res.roi.rect.width, res.roi.rect.height)
    : T.imgResidualMap;
  const closeupCaption =
    closeupKind === "fallback" ? T.imgCloseupFallbackNote : closeupKind === "fixed" ? T.imgCloseupFixedNote : T.imgCloseupRoiNote;
  const bgDrawForcesFull = drawTarget === "bg-rect";
  const forcedViewExtra = bgDrawForcesFull ? ` disabled title="${esc(T.imgViewForcedBgDraw)}"` : "";
  const viewToggle = closeupAvailable
    ? `<div class="mf-seg img-view-toggle${bgDrawForcesFull ? " img-view-toggle-forced" : ""}"${bgDrawForcesFull ? ` title="${esc(T.imgViewForcedBgDraw)}"` : ""}>
        ${segBtn("img-preview-view", "closeup", T.imgSpotCloseup, showingCloseup, forcedViewExtra)}
        ${segBtn("img-preview-view", "full", T.imgViewFull, !showingCloseup, forcedViewExtra)}
      </div>`
    : "";
  const colorMapSelect = `<label class="img-colormap-field">
        <span class="mf-lbl">${esc(T.imgColorMap)}</span>
        <select data-k="imgColorMap" class="mf-select img-colormap-select">
          <option value="gray"${st.colorMap === "gray" ? " selected" : ""}>${esc(T.imgColorMapGray)}</option>
          <option value="turbo"${st.colorMap === "turbo" ? " selected" : ""}>${esc(T.imgColorMapTurbo)}</option>
          <option value="viridis"${st.colorMap === "viridis" ? " selected" : ""}>${esc(T.imgColorMapViridis)}</option>
        </select>
      </label>`;

  const residualCard = res?.residuals
    ? `<div class="mf-card img-frame-card">
        <div class="mf-card-title" id="img-residual-title" style="margin-bottom: 10px;">${esc(residualTitle)}</div>
        <canvas id="img-residual" class="img-canvas"></canvas>
      </div>`
    : "";

  const frameRow = st.loaded
    ? `<div class="img-frame-row">
        <div class="mf-card img-frame-card">
          <div class="mf-card-title img-preview-head">
            <span>${esc(previewTitle)}</span>
            <div class="img-preview-controls">
              ${colorMapSelect}
              ${viewToggle}
            </div>
          </div>
          <div class="img-preview-stack">
            <div class="img-preview-frame">
              <canvas id="img-canvas" class="img-canvas"></canvas>
              <canvas id="img-overlay" class="img-overlay-canvas"></canvas>
            </div>
            <div class="img-colorbar" id="img-colorbar">
              <canvas id="img-colorbar-canvas" class="img-colorbar-canvas"></canvas>
              <div class="img-colorbar-ticks" id="img-colorbar-ticks"></div>
            </div>
          </div>
          <div class="mf-note-faint" style="margin-top: 8px;">${esc(showingCloseup ? `${T.imgDisplayNote} ${closeupCaption}` : T.imgDisplayNote)}</div>
        </div>
        ${residualCard}
      </div>`
    : "";

  const keyResults = res
    ? `<div class="mf-card img-key-results">
        <div class="mf-card-title">${esc(T.imgKeyResults)}</div>
        <div class="img-tiles">
          ${tile(T.imgD4Sigma, d4Value, d4Color)}
          ${tile(T.imgWidth1e2, profilePairHtml(T, profileMajor ?? null, profileMinor ?? null, (w) => w.oneOverESquaredData, pitch), "#E7ECF4", ungatedHint)}
          ${tile(T.imgWidthFwhm, profilePairHtml(T, profileMajor ?? null, profileMinor ?? null, (w) => w.fwhmData, pitch), "#E7ECF4", ungatedHint)}
          ${tile(T.imgFitWidth, fitWidthValue, "#E7ECF4", ungatedHint)}
        </div>
      </div>`
    : "";

  const exports = res
    ? `<div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button data-act="img-export-json" class="btn-ghost">${esc(T.imgExportJson)}</button>
        <button data-act="img-export-csv" class="btn-ghost">${esc(T.imgExportCsv)}</button>
        <button data-act="img-export-png" class="btn-ghost">${esc(T.imgExportPng)}</button>
      </div>`
    : "";

  return `
  <div class="wb-workspace">
    <div class="wb-side w330">
      <div class="mf-card">
        <div class="mf-card-title">${esc(T.imgUpload)}</div>
        <div class="img-drop" data-drop="image-file" data-act="img-pick-file" role="button" tabindex="0">${esc(T.imgDropHint)}</div>
        <div style="display: flex; gap: 8px; align-items: center; margin: 8px 0;">
          <button data-act="img-pick-file" class="btn-dashed">${esc(T.imgPickFile)}</button>
          ${st.fileName ? `<span class="mf-note">${esc(st.fileName)}</span>` : ""}
        </div>
        ${st.loaded ? `<div class="mf-note">${T.imgRawRender} · ${st.width} × ${st.height}</div>` : ""}
      </div>

      ${st.loaded ? `<div class="mf-card">
        ${pageAndChannel}
        <div class="mf-sec-title">${esc(T.imgCalibration)}</div>
        ${calibration}
        <div class="mf-sec-title">${esc(T.imgBackground)}</div>
        ${background}
        <div class="mf-sec-title">${esc(T.imgRoi)}</div>
        <div class="mf-seg">
          ${segBtn("img-roi-mode", "full", T.imgRoiFull, st.roiMode === "full")}
          ${segBtn("img-roi-mode", "rect", T.imgRoiRect, st.roiMode === "rect")}
          ${segBtn("img-roi-mode", "auto", T.imgRoiAuto, st.roiMode === "auto")}
        </div>
        <div class="mf-note">${esc(T.imgRoiNote)}</div>
        ${drawTargetToggle}
        ${roiRect}
        ${roiOutOfRange ? `<div class="img-roi-error">${esc(T.imgRoiOutOfRange)}</div>` : ""}
        ${roiClampNote}
        ${fromFitBtn}
        ${fromFitNote}
        ${suggestionLine}
      </div>` : ""}

      <div class="mf-seg" style="margin: 8px 0;">
        <button data-act="img-auto-mode" class="mf-seg-btn${st.bgMethod === "auto" && st.roiMode === "auto" ? " active" : ""}" type="button">${esc(T.imgAutoMode)}</button>
      </div>
      <button data-act="img-run" class="btn-primary"${runBlocked ? " disabled" : ""}>${esc(runLabel)}</button>
      ${st.settingsNote ? `<div class="mf-note">${esc(st.settingsNote === "reset" ? T.imgSettingsReset : st.settingsNote === "dark-dtype-changed" ? T.imgSettingsDarkDtypeChanged : T.imgSettingsAdjusted)}</div>` : ""}
      ${autoProvenance}
      ${warnLines(st.errs)}
    </div>

    <div class="wb-center">
      ${suggestionCallout(T, res)}
      ${res ? keyResults : ""}
      ${st.loaded ? `${exports}${frameRow}` : res ? "" : `<div class="mf-note-faint">${esc(T.imgNoData)}</div>`}
      ${profilePlotPanel(T, res)}
      ${res ? panel(T.imgDiagnostics, diagnosticsInner) : ""}
      ${res ? panel(T.imgBackgroundNoise, backgroundNoiseInner) : ""}
      ${res ? panel(T.imgRoiStability, stabilityInner) : ""}
      ${res ? panel(T.imgMomentsProfiles, momentsProfilesInner) : ""}
      ${res ? panel(T.imgFitsResiduals, fitsInner) : ""}
    </div>
  </div>`;
}

function gateBlock(T: Strings, res: ImageAnalysisResult): string {
  const gates = res.aperture.gates;
  const residualOk = !gates.residual.high;
  const alphaOk = !gates.alphaConsistency.inconsistent;
  const peakOk = !gates.multiPeak.detected;
  const residualText = `${counts(gates.residual.rmsCounts)} / ${counts(gates.residual.maxAllowedCounts)}`;
  const alphaText = `${percentAlready(gates.alphaConsistency.deltaMajorPercent)} / ${percentAlready(gates.alphaConsistency.deltaMinorPercent)}`;
  const scatter = `${percentAlready(gates.alphaConsistency.d4ScatterMajorPercent)} / ${percentAlready(gates.alphaConsistency.d4ScatterMinorPercent)}`;
  const rows: Array<readonly [string, string] | readonly [string, string, string]> = [
    [T.imgGateFit, gates.fitConverged ? T.imgPass : T.imgFail, gateTone(gates.fitConverged)],
    [T.imgGateAmplitude, gates.amplitudePositive ? T.imgPass : T.imgFail, gateTone(gates.amplitudePositive)],
    [T.imgGateResidual, `${residualOk ? T.imgPass : T.imgFail} · ${residualText}`, gateTone(residualOk)],
    [T.imgGateClip, gates.clipping.checkEllipseInside ? T.imgPass : T.imgFail, gateTone(gates.clipping.checkEllipseInside)],
    [T.imgGateAlpha, `${alphaOk ? T.imgPass : T.imgFail} · ${alphaText}`, gateTone(alphaOk)],
    [
      T.imgAlphaThreshold,
      `${percentAlready(gates.alphaConsistency.thresholdMajorPercent)} / ${percentAlready(gates.alphaConsistency.thresholdMinorPercent)}`,
    ],
    [
      T.imgMcRealizationCount,
      Number.isFinite(gates.alphaConsistency.mcRealizationCount) ? String(gates.alphaConsistency.mcRealizationCount) : "—",
    ],
    [T.imgGateMultiPeak, `${peakOk ? T.imgPass : T.imgFail} · ${gates.multiPeak.significantPeakCount}`, gateTone(peakOk)],
    [T.imgMultiPeakThreshold, counts(gates.multiPeak.thresholdCounts)],
  ];
  const ptbnDisplay = peakToBackgroundNoiseDisplay(res.aperture.peakToBackgroundNoise);
  if (ptbnDisplay !== null) rows.push([T.imgPeakToBackground, ptbnDisplay]);
  else rows.push([T.imgPeakToBackground, T.imgSigmaBUnmeasurable, "#97A1B2"]);
  rows.push(
    [T.imgAlphaUsed, num(res.aperture.alphaUsed, 3)],
    [T.imgWidthScatter, scatter],
    [T.imgPedestal, res.aperture.pedestal.hint ? T.imgYes : T.imgNo, res.aperture.pedestal.hint ? "#F2B33D" : "#97A1B2"],
    [T.imgAbsorbedPower, res.aperture.absorbedPower.high ? T.imgYes : T.imgNo, res.aperture.absorbedPower.high ? "#F2B33D" : "#97A1B2"],
  );
  return kvBlock(rows);
}

// Display-only conversion of physical um values: µm below 1000 µm, otherwise
// mm with 3 significant digits. Nothing here computes physics.
export function umToDisplay(um: number | null | undefined): string {
  if (um === null || um === undefined || !Number.isFinite(um)) return "—";
  if (Math.abs(um) < 1000) return `${sig(um, 3)} µm`;
  return `${sig(um / 1000, 3)} mm`;
}
