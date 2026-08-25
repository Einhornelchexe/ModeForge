// Port of the workbench "ROI from fit" chain (apps/web/src/main.ts:693-758 and
// the img-roi-from-fit click handler around :2904-2933), with the constants
// and formulas copied 1:1 and only the state plumbing replaced by explicit
// arguments.
//
// Why a port and not an import: the handler reads module-scope UI state (`S`)
// and is not exported, and tests/repro-s20 must not pull the browser bundle in
// to reach two pure formulas. The pin in s20-roi-from-fit.test.ts is therefore
// on the ported chain; the numbers it produces are the numbers the button
// applies. Whoever changes main.ts's factors must change them here too — the
// constants are re-stated below so a divergence is visible in review.

import type { ImageAnalysisResult } from "../../../packages/image/src/analyze.ts";

export const ROI_FROM_D4_SEMI_AXIS_FACTOR = 1.5;
export const ROI_FROM_SIGMA_SEMI_AXIS_FACTOR = 6;
export const ROI_FROM_FIT_SAFETY_MARGIN = 1.25;
export const ROI_NON_SHRINK_MIN_AREA_RATIO = 0.85;

export type DerivedRect = { x0: number; y0: number; width: number; height: number };
export type RoiFromFit = { rect: DerivedRect; source: "d4sigma" | "fit-sigma" };

// Axis-aligned bounding box of an ellipse with semi-axes (a, b) rotated by
// theta, grown by the safety margin and clamped to the image.
export function ellipseBoxRect(
  cx: number,
  cy: number,
  a: number,
  b: number,
  thetaRad: number,
  imgW: number,
  imgH: number,
): DerivedRect | null {
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

// The released-widths branch is guarded; the fit fallback below it checks only
// `converged && params` today. That asymmetry is the defect the repro pins.
export function roiRectFromReleasedWidths(
  result: ImageAnalysisResult | null,
  imgW: number,
  imgH: number,
): RoiFromFit | null {
  if (!result || !(imgW > 0 && imgH > 0)) return null;
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
  // Deliberately FROZEN at the pre-guard chain (no geometryReleasable check):
  // this port pins the historical defect the guard stage closed, so its
  // "2 of 40 beam-free frames derive a degenerate ROI" oracle keeps measuring
  // the defect itself, not the shipped behaviour.
  if (!gauss.converged || !gauss.params) return null;
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

export type RoiFromFitClick = {
  applied: DerivedRect | null;
  refused: boolean;
  derived: RoiFromFit | null;
};

// One click on the "ROI from fit" button. `roiMode` is "rect" or "full";
// `current` is the current draft rectangle (null in full-frame mode, which is
// exactly how the non-shrink clamp gets bypassed today).
export function clickRoiFromFit(
  result: ImageAnalysisResult | null,
  imgW: number,
  imgH: number,
  roiMode: "rect" | "full",
  current: DerivedRect | null,
): RoiFromFitClick {
  const derived = roiRectFromReleasedWidths(result, imgW, imgH);
  if (!derived) return { applied: null, refused: false, derived: null };
  if (roiMode === "rect" && current) {
    const currentArea = current.width * current.height;
    const nextArea = derived.rect.width * derived.rect.height;
    if (currentArea > 0 && nextArea < ROI_NON_SHRINK_MIN_AREA_RATIO * currentArea) {
      return { applied: null, refused: true, derived };
    }
  }
  return { applied: derived.rect, refused: false, derived };
}
