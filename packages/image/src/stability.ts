import type { BackgroundRect } from "./background.ts";
import {
  ROI_SWEEP_SHIFT_FRACTION,
  ROI_SWEEP_SIZE_FACTORS,
} from "./thresholds.ts";

// Generic ROI stability sweep engine (S18b). Geometry and aggregation live
// here; the concrete figures of merit come later from an evaluator callback.
// The variant sequence is deterministic: size factors in ascending order
// first, then the four shifts +x, -x, +y, -y.

export type SweepVariant = {
  label: string;
  kind: "size" | "shift";
  sizeFactor: number;
  shiftXPx: number;
  shiftYPx: number;
  rect: BackgroundRect;
  clamped: boolean;
};

export type SweepVariantResult = {
  variant: SweepVariant;
  valid: boolean;
  metrics: Record<string, number> | null;
  // Label of the first variant (in sweep sequence order) whose final,
  // post-clamp rect is identical to this variant's rect, or null when no
  // earlier variant carries this rect. A duplicate measures nothing new: it
  // is excluded from sensitivity min/max aggregation and from
  // validVariantCount, which counts valid AND non-duplicate variants only.
  duplicateOfLabel: string | null;
};

export type SweepSensitivity = {
  metric: string;
  baselineValue: number;
  minValue: number;
  maxValue: number;
  halfSpreadPercent: number;
  // True when any clamped variant was included in this metric's aggregation
  // (deliberately conservative: not only the variants that carry the actual
  // min/max — any clamped window in the pool can distort the spread).
  clampedContributing: boolean;
};

export type RoiStabilityReport = {
  variants: SweepVariantResult[];
  // Null when the spread cannot be determined: fewer than three unique valid
  // variants remain, or the baseline variant (size factor 1.0) is invalid or
  // missing (an invalid baseline is contractual, never a silently empty list).
  sensitivities: SweepSensitivity[] | null;
  // Number of variants that are valid AND non-duplicate; each counted
  // variant carries a distinct final rect.
  validVariantCount: number;
  partialSweep: boolean;
  undeterminable: boolean;
  fullFrame: boolean;
};

function isFullFrame(baseRect: BackgroundRect, imageWidth: number, imageHeight: number): boolean {
  return (
    baseRect.x0 === 0 &&
    baseRect.y0 === 0 &&
    baseRect.width === imageWidth &&
    baseRect.height === imageHeight
  );
}

// A variant that overhangs the image is clamped: positions are clipped to the
// image boundaries, which may shrink its width/height. FIX 5 (review round B):
// x0/y0 are clamped from ABOVE as well, before the far edge is derived, so a
// shifted 1-px border rect collapses onto the last valid column/row instead
// of producing an out-of-contract rect like { x0: imageWidth, ... }.
function clampVariantRect(
  raw: { x0: number; y0: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): { rect: BackgroundRect; clamped: boolean } {
  const rawX1 = raw.x0 + raw.width - 1;
  const rawY1 = raw.y0 + raw.height - 1;
  const x0 = Math.min(Math.max(raw.x0, 0), imageWidth - 1);
  const y0 = Math.min(Math.max(raw.y0, 0), imageHeight - 1);
  const x1 = Math.min(Math.max(rawX1, 0), imageWidth - 1);
  const y1 = Math.min(Math.max(rawY1, 0), imageHeight - 1);
  const clamped = raw.x0 !== x0 || raw.y0 !== y0 || rawX1 !== x1 || rawY1 !== y1;
  const rect: BackgroundRect = {
    x0,
    y0,
    width: Math.max(1, x1 - x0 + 1),
    height: Math.max(1, y1 - y0 + 1),
  };
  return { rect, clamped };
}

// Banker's rounding (round half to even). Size-variant geometry used to use
// Math.round, whose +Infinity tie behaviour drifted every derived centre by a
// systematic +0.5 px whenever both the rounded size and the rounded x0/y0 hit
// an exact 0.5. Half-to-even makes those tie cases alternate, so each size
// variant's centre stays within 0.5 px of the baseline centre and the signed
// centre deviations balance to zero across the size sweep.
function roundHalfEven(value: number): number {
  const lower = Math.floor(value);
  if (value - lower === 0.5) return lower % 2 === 0 ? lower : lower + 1;
  return Math.round(value);
}

export function buildSweepVariants(
  baseRect: BackgroundRect,
  imageWidth: number,
  imageHeight: number,
): SweepVariant[] {
  if (!Number.isInteger(imageWidth) || imageWidth <= 0 || !Number.isInteger(imageHeight) || imageHeight <= 0) {
    throw new RangeError("imageWidth and imageHeight must be positive integers");
  }
  if (
    !Number.isInteger(baseRect.x0) ||
    !Number.isInteger(baseRect.y0) ||
    !Number.isInteger(baseRect.width) ||
    !Number.isInteger(baseRect.height)
  ) {
    throw new RangeError("baseRect coordinates and sizes must be integers");
  }
  if (baseRect.width <= 0 || baseRect.height <= 0) {
    throw new RangeError("baseRect width and height must be positive integers");
  }
  if (
    baseRect.x0 < 0 ||
    baseRect.y0 < 0 ||
    baseRect.x0 + baseRect.width > imageWidth ||
    baseRect.y0 + baseRect.height > imageHeight
  ) {
    throw new RangeError("baseRect must be fully inside the image");
  }

  const fullFrame = isFullFrame(baseRect, imageWidth, imageHeight);
  const centerX = baseRect.x0 + (baseRect.width - 1) / 2;
  const centerY = baseRect.y0 + (baseRect.height - 1) / 2;
  const variants: SweepVariant[] = [];

  // Full-frame images only get the shrinking factors plus the 1.0 baseline.
  // Shift variants are omitted here: once clamped to the frame they would only
  // be size variants carrying a misleading label.
  const sizeFactors = fullFrame
    ? ROI_SWEEP_SIZE_FACTORS.filter((factor) => factor <= 1)
    : ROI_SWEEP_SIZE_FACTORS;
  for (const factor of sizeFactors) {
    const width = Math.max(1, roundHalfEven(factor * baseRect.width));
    const height = Math.max(1, roundHalfEven(factor * baseRect.height));
    const raw = {
      x0: roundHalfEven(centerX - (width - 1) / 2),
      y0: roundHalfEven(centerY - (height - 1) / 2),
      width,
      height,
    };
    const { rect, clamped } = clampVariantRect(raw, imageWidth, imageHeight);
    variants.push({
      label: `size${factor.toFixed(1)}`,
      kind: "size",
      sizeFactor: factor,
      shiftXPx: 0,
      shiftYPx: 0,
      rect,
      clamped,
    });
  }

  if (!fullFrame) {
    // Shift variants always move by at least 1 px per axis: without the
    // floor, windows smaller than 10 px would round 5% down to zero and
    // produce four shift variants identical to the baseline, each of which
    // would still count as a distinct valid measurement.
    const shiftX = Math.max(1, Math.round(ROI_SWEEP_SHIFT_FRACTION * baseRect.width));
    const shiftY = Math.max(1, Math.round(ROI_SWEEP_SHIFT_FRACTION * baseRect.height));
    const shifts: ReadonlyArray<readonly [string, number, number]> = [
      ["shift+x", shiftX, 0],
      ["shift-x", -shiftX, 0],
      ["shift+y", 0, shiftY],
      ["shift-y", 0, -shiftY],
    ];
    for (const [label, dx, dy] of shifts) {
      const raw = {
        x0: baseRect.x0 + dx,
        y0: baseRect.y0 + dy,
        width: baseRect.width,
        height: baseRect.height,
      };
      const { rect, clamped } = clampVariantRect(raw, imageWidth, imageHeight);
      variants.push({
        label,
        kind: "shift",
        sizeFactor: 1,
        shiftXPx: dx,
        shiftYPx: dy,
        rect,
        clamped,
      });
    }
  }

  return variants;
}

export function runRoiStabilitySweep(
  baseRect: BackgroundRect,
  imageWidth: number,
  imageHeight: number,
  evaluate: (rect: BackgroundRect) => Record<string, number> | null,
): RoiStabilityReport {
  const variants = buildSweepVariants(baseRect, imageWidth, imageHeight);
  const results: SweepVariantResult[] = variants.map((variant) => {
    let metrics: Record<string, number> | null = null;
    try {
      metrics = evaluate(variant.rect);
    } catch {
      // A failing evaluator marks the variant invalid; the sweep never aborts.
      metrics = null;
    }
    return { variant, valid: metrics !== null, metrics, duplicateOfLabel: null };
  });

  // Duplicate-rect dedup: the first variant in sequence order owns each
  // distinct final rect; every later variant with the same rect is marked
  // with that owner's label and measures nothing new.
  const firstRectLabels = new Map<string, string>();
  for (const result of results) {
    const rect = result.variant.rect;
    const key = `${rect.x0},${rect.y0},${rect.width},${rect.height}`;
    const firstLabel = firstRectLabels.get(key);
    if (firstLabel === undefined) {
      firstRectLabels.set(key, result.variant.label);
    } else {
      result.duplicateOfLabel = firstLabel;
    }
  }
  const isUnique = (result: SweepVariantResult): boolean => result.duplicateOfLabel === null;

  const fullFrame = isFullFrame(baseRect, imageWidth, imageHeight);
  const validVariantCount = results.reduce(
    (sum, result) => (result.valid && isUnique(result) ? sum + 1 : sum),
    0,
  );
  // A clamped variant only peeks at part of its intended window, a full-frame
  // baseline cannot grow at all, and a duplicate rect means one intended
  // variant geometry was never actually measured; in all cases the sweep is
  // partial (tiny base rects collapse most size variants onto one rect).
  const partialSweep =
    fullFrame ||
    results.some((result) => result.variant.clamped) ||
    results.some((result) => result.duplicateOfLabel !== null);

  const baseline = results.find(
    (result) => result.variant.kind === "size" && result.variant.sizeFactor === 1,
  );
  const baselineInvalid = baseline === undefined || !baseline.valid || baseline.metrics === null;
  // An invalid or missing baseline is contractual: the spread reference is
  // gone, so sensitivities is null and the sweep is undeterminable regardless
  // of how many other variants remain valid.
  const undeterminable = validVariantCount < 3 || baselineInvalid;

  let sensitivities: SweepSensitivity[] | null = null;
  if (!undeterminable) {
    const baselineMetrics = baseline!.metrics as Record<string, number>;
    sensitivities = [];
    for (const metric of Object.keys(baselineMetrics)) {
      const baselineValue = baselineMetrics[metric];
      if (!Number.isFinite(baselineValue) || baselineValue === 0) continue;
      let otherFiniteCount = 0;
      for (const result of results) {
        if (!result.valid || !isUnique(result) || result === baseline) continue;
        const value = result.metrics?.[metric];
        if (value === undefined || !Number.isFinite(value)) continue;
        otherFiniteCount += 1;
      }
      if (otherFiniteCount < 2) continue;
      let minValue = Infinity;
      let maxValue = -Infinity;
      let clampedContributing = false;
      for (const result of results) {
        if (!result.valid || !isUnique(result)) continue;
        const value = result.metrics?.[metric];
        if (value === undefined || !Number.isFinite(value)) continue;
        if (value < minValue) minValue = value;
        if (value > maxValue) maxValue = value;
        if (result.variant.clamped) clampedContributing = true;
      }
      sensitivities.push({
        metric,
        baselineValue,
        minValue,
        maxValue,
        halfSpreadPercent: (100 * (maxValue - minValue)) / (2 * Math.abs(baselineValue)),
        clampedContributing,
      });
    }
  }

  return {
    variants: results,
    sensitivities,
    validVariantCount,
    partialSweep,
    undeterminable,
    fullFrame,
  };
}
