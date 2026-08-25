import type { BackgroundRect } from "./background.ts";
import {
  APERTURE_ALPHA_CHECK,
  SUGGESTED_ROI_K,
  SUGGESTED_ROI_MIN_PEAK_RATIO,
  SUGGESTED_ROI_NOISE_SUSPECT_FRACTION,
  SUGGESTED_ROI_PAD_MARGIN,
  SUGGESTED_ROI_PAD_MASK_FLOOR,
  SUGGESTED_ROI_PADDING_PX,
} from "./thresholds.ts";

// Suggested-ROI proposal on background-corrected data (S18b, padding revised
// in S20 stage D3).
//
// suggestRoi uses the B_eff = 0 convention: corrected pixel values live on an
// absolute scale, so a candidate ROI pixel is every finite value strictly
// above k * sigmaCounts, where sigmaCounts is the background noise scale from
// packages/image/src/background.ts. The largest 4-connected component of that
// mask wins; its bounding box is padded and clamped to the image. The input
// is never mutated and the result is deterministic.
//
// The padding is derived per axis from the mask itself (see the block comment
// on SUGGESTED_ROI_PAD_MARGIN in thresholds.ts). A fixed border is a constant
// while the aperture the clipping gate checks grows with the beam, so the old
// fixed border made the suggestion a dead end: applying it turned a releasing
// frame into aperture_clipped and the suggestion computed inside that ROI
// reproduced itself. The derived padding aims the suggested half side at
// SUGGESTED_ROI_PAD_MARGIN * APERTURE_ALPHA_CHECK sigma instead.
//
// The suggestion remains advisory. analyzeImage never applies it on its own,
// so nothing here can move a released number.

export type SuggestedRoi = {
  rect: BackgroundRect;
  componentPixelCount: number;
  maskPixelCount: number;
  // maskFraction is maskPixelCount / pixelCount and is used together with
  // suspectNoiseDominated as a UI warning hook, not a rejection.
  maskFraction: number;
  // FIX 6 (review round B): true when the mask covers more than
  // SUGGESTED_ROI_NOISE_SUSPECT_FRACTION of the frame AND the sigma behind
  // the threshold is not a measured noise scale. A sigma whose provenance is
  // "floor" or "zero" separates nothing — its threshold is a quantization or
  // zero floor, so a large mask is noise coverage, not beam. A sigma sourced
  // from "mad" or "iqr" is a real measurement: an HDR beam can then fill a
  // third of the frame and must NOT be flagged. Without a sigmaScaleSource
  // only the exact sigmaCounts === 0 case triggers (conservative).
  suspectNoiseDominated: boolean;
  peakValueCounts: number;
  peakX: number;
  peakY: number;
  thresholdCounts: number;
  // BASE border in pixels: the value an explicit paddingPx option carries, and
  // otherwise SUGGESTED_ROI_PADDING_PX. Since S20 stage D3 this is the FLOOR
  // of the applied padding, not the applied padding itself — read
  // paddingXPx / paddingYPx for what was actually added. It is kept because an
  // explicit paddingPx still overrides the derivation exactly.
  paddingPx: number;
  // Padding actually added on each side of the mask bounding box, per axis.
  // These are the authoritative padding numbers (R-24). They equal paddingPx
  // whenever the derivation is not available (see sigmaEstXPx below) or a
  // caller passed paddingPx explicitly.
  paddingXPx: number;
  paddingYPx: number;
  // Beam sigma read back from the mask edge per axis, or null when the
  // derivation was not applicable: an explicit paddingPx override, a zero
  // threshold, a peak-to-threshold ratio at or below
  // SUGGESTED_ROI_MIN_PEAK_RATIO, or a degenerate estimate. In every null case
  // the axis fell back to the base border. (A threshold that overflows to
  // Infinity produces no suggestion at all — see the overflow policy in
  // suggestRoi — so it is not one of these cases.)
  sigmaEstXPx: number | null;
  sigmaEstYPx: number | null;
  // True when the padded rectangle did not fit the image and was cut back.
  //
  // Semantics after S20 stage D3 (R-24): the computation is unchanged — the
  // returned rect differs from the padded mask box — but the reading is
  // sharper than it was under the fixed border. The derived padding asks for a
  // definite half side (SUGGESTED_ROI_PAD_MARGIN * APERTURE_ALPHA_CHECK
  // sigma), so this flag now says "the frame could not give the suggestion the
  // aperture it asked for". That is exactly the situation in which applying
  // the suggestion may still be suppressed as aperture_clipped, and the
  // suppression is then honest: the beam is too close to the image edge, and
  // no rectangle inside this frame can fix it.
  clampedToImage: boolean;
};

type ComponentSummary = {
  size: number;
  peakValueCounts: number;
  peakX: number;
  peakY: number;
  startIndex: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

// Robust component peak for the padding inversion (R-44, semantics per R-39).
//
// The inversion divides by sqrt(2 * ln(peak / threshold)), so a peak that is
// too HIGH shrinks sigmaEst and shrinks the padding — a single hot pixel
// welded to the beam would walk the suggestion straight back into the clipped
// dead end it is meant to leave. The raw component maximum is therefore not
// usable here (it stays in peakValueCounts, which reports what is in the
// data).
//
// Definition: the maximum over the component of the 3x3 median centred on each
// component pixel. Window clamped at the image border, non-finite neighbours
// dropped before the median (R-39: finite-only, clamped window); the centre is
// always finite because mask membership required it, so the sample is never
// empty. Even sample counts (border and corner windows, or windows with
// dropped neighbours) take the mean of the two middle values.
//
// Taking the max of the medians rather than the median at the raw peak pixel
// matters when the raw maximum IS the artefact: the artefact's own window is
// outvoted by its neighbours, and the true beam crest still contributes its
// own, undisturbed median. The result is deterministic and costs O(9) per
// component pixel with no allocation beyond one 9-element scratch array.
function robustComponentPeak(
  values: Float64Array | number[],
  width: number,
  height: number,
  pixels: Uint32Array,
  count: number,
): number {
  const window = new Float64Array(9);
  let best = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const index = pixels[i];
    const x = index % width;
    const y = (index - x) / width;
    let n = 0;
    const yLo = y > 0 ? y - 1 : 0;
    const yHi = y < height - 1 ? y + 1 : height - 1;
    const xLo = x > 0 ? x - 1 : 0;
    const xHi = x < width - 1 ? x + 1 : width - 1;
    for (let wy = yLo; wy <= yHi; wy += 1) {
      const row = wy * width;
      for (let wx = xLo; wx <= xHi; wx += 1) {
        const value = values[row + wx];
        if (!Number.isFinite(value)) continue;
        // Insertion sort into the scratch window: at most 9 entries, so this
        // is cheaper than sorting afterwards and keeps the order exact.
        let slot = n;
        while (slot > 0 && window[slot - 1] > value) {
          window[slot] = window[slot - 1];
          slot -= 1;
        }
        window[slot] = value;
        n += 1;
      }
    }
    // n >= 1: the centre pixel is a mask pixel and mask membership is
    // finite-only.
    const median = n % 2 === 1 ? window[(n - 1) / 2] : (window[n / 2 - 1] + window[n / 2]) / 2;
    if (median > best) best = median;
  }
  return best;
}

// One axis of the derived padding. Returns the applied padding and the sigma
// the mask edge implies, or a null sigma when the derivation does not apply.
function derivePadding(
  halfExtent: number,
  denominator: number,
  basePaddingPx: number,
): { paddingPx: number; sigmaEstPx: number | null } {
  const sigmaEstPx = halfExtent / denominator;
  // Explicit finiteness guard (G-F2). halfExtent >= 0.5 and denominator >= 1
  // by construction, so this is a belt-and-braces check against a future
  // caller widening the guards above.
  if (!Number.isFinite(sigmaEstPx) || sigmaEstPx <= 0) {
    return { paddingPx: basePaddingPx, sigmaEstPx: null };
  }
  const apertureTarget = Math.ceil(SUGGESTED_ROI_PAD_MARGIN * APERTURE_ALPHA_CHECK * sigmaEstPx - halfExtent);
  const maskFloor = Math.ceil(SUGGESTED_ROI_PAD_MASK_FLOOR * halfExtent);
  return {
    paddingPx: Math.max(basePaddingPx, apertureTarget, maskFloor),
    sigmaEstPx,
  };
}

export function suggestRoi(
  corrected: { values: Float64Array | number[]; width: number; height: number },
  sigmaCounts: number,
  options?: {
    k?: number;
    paddingPx?: number;
    // Provenance of sigmaCounts: the scaleSource field of
    // BackgroundNoiseEstimate. "floor" / "zero" are not measured noise
    // scales, so a large mask under them is noise-dominated (FIX 6).
    sigmaScaleSource?: "mad" | "iqr" | "floor" | "zero";
  },
): SuggestedRoi | null {
  const { values, width, height } = corrected;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("corrected image width and height must be positive integers");
  }
  const pixelCount = width * height;
  if (values.length !== pixelCount) {
    throw new RangeError(`values.length ${values.length} does not match width*height ${pixelCount}`);
  }
  if (!Number.isFinite(sigmaCounts) || sigmaCounts < 0) {
    throw new RangeError("sigmaCounts must be a finite number >= 0");
  }
  const k = options?.k ?? SUGGESTED_ROI_K;
  // An explicitly passed paddingPx keeps exact override semantics: it is the
  // padding, not a floor under a derivation.
  const explicitPadding = options?.paddingPx !== undefined;
  const paddingPx = options?.paddingPx ?? SUGGESTED_ROI_PADDING_PX;
  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError("k must be a finite number > 0");
  }
  if (!Number.isInteger(paddingPx) || paddingPx < 0) {
    throw new RangeError("paddingPx must be an integer >= 0");
  }

  const thresholdCounts = k * sigmaCounts;
  // Overflow policy (S20 D3). k and sigmaCounts are each finite by the checks
  // above, but their PRODUCT can still round to Infinity — a sigmaCounts near
  // Number.MAX_VALUE is enough. There is no rectangle to return then, and this
  // is not a floating-point accident: if the exact product exceeds
  // Number.MAX_VALUE it exceeds every representable pixel value too, so the
  // mask is genuinely empty and null is the honest answer. Saying so here,
  // instead of letting `value > Infinity` decide it further down, makes the
  // behaviour a stated policy and keeps the padding guards below reachable —
  // they can then assume a finite threshold rather than advertising a
  // fallback that nothing can arrive at.
  if (!Number.isFinite(thresholdCounts)) return null;
  const mask = new Uint8Array(pixelCount);
  let maskPixelCount = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && value > thresholdCounts) {
      mask[index] = 1;
      maskPixelCount += 1;
    }
  }
  if (maskPixelCount === 0) return null;

  const visited = new Uint8Array(pixelCount);
  // One preallocated FIFO queue is reused for every component. Each pixel can
  // be enqueued at most once globally (the visited guard above the pushes),
  // so a single buffer of size pixelCount is sufficient for the whole scan.
  const queue = new Uint32Array(pixelCount);
  let best: ComponentSummary | undefined;
  // Pixel list of the current best component, kept for the robust peak. Each
  // component is copied at most once (only when it takes the lead), so the
  // total copy cost over the scan is bounded by the mask size.
  let bestPixels: Uint32Array | undefined;

  for (let seed = 0; seed < pixelCount; seed += 1) {
    if (mask[seed] !== 1 || visited[seed] !== 0) continue;
    // Iterative flood fill with the shared queue (no recursion, no
    // per-component allocation).
    visited[seed] = 1;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let peakValueCounts = -Infinity;
    let peakX = -1;
    let peakY = -1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const value = values[index];
      // Ties on the maximum resolve to the smallest (y, x) pixel.
      if (value > peakValueCounts || (value === peakValueCounts && (y < peakY || (y === peakY && x < peakX)))) {
        peakValueCounts = value;
        peakX = x;
        peakY = y;
      }
      if (x > 0 && mask[index - 1] === 1 && visited[index - 1] === 0) {
        visited[index - 1] = 1;
        queue[tail] = index - 1;
        tail += 1;
      }
      if (x < width - 1 && mask[index + 1] === 1 && visited[index + 1] === 0) {
        visited[index + 1] = 1;
        queue[tail] = index + 1;
        tail += 1;
      }
      if (y > 0 && mask[index - width] === 1 && visited[index - width] === 0) {
        visited[index - width] = 1;
        queue[tail] = index - width;
        tail += 1;
      }
      if (y < height - 1 && mask[index + width] === 1 && visited[index + width] === 0) {
        visited[index + width] = 1;
        queue[tail] = index + width;
        tail += 1;
      }
    }
    const candidate: ComponentSummary = {
      size,
      peakValueCounts,
      peakX,
      peakY,
      startIndex: seed,
      minX,
      minY,
      maxX,
      maxY,
    };
    // Seeds are visited in ascending index order, so earlier components win
    // exact ties by construction; no third tie-break clause is needed.
    const better =
      best === undefined ||
      candidate.size > best.size ||
      (candidate.size === best.size && candidate.peakValueCounts > best.peakValueCounts);
    if (better) {
      best = candidate;
      bestPixels = queue.slice(0, size);
    }
  }

  // best is always defined here because maskPixelCount > 0.
  const component = best as ComponentSummary;
  const maskFraction = maskPixelCount / pixelCount;
  const sigmaScaleSource = options?.sigmaScaleSource;
  const suspectNoiseDominated =
    maskFraction > SUGGESTED_ROI_NOISE_SUSPECT_FRACTION &&
    (sigmaCounts === 0 || sigmaScaleSource === "floor" || sigmaScaleSource === "zero");
  // Half extents of the mask bounding box, in the same convention the
  // inversion assumes: the box spans (max - min + 1) pixels, so its half
  // extent is half of that, and it is at least 0.5 for a single pixel.
  const halfExtentX = (component.maxX - component.minX + 1) / 2;
  const halfExtentY = (component.maxY - component.minY + 1) / 2;

  // Guards on the inversion (plan section 4f). A zero threshold makes
  // ln(peak/threshold) meaningless; a ratio at or below
  // SUGGESTED_ROI_MIN_PEAK_RATIO puts the logarithm too close to zero for the
  // quotient to carry information. Either way the axis keeps the base border.
  // The threshold is finite by construction here — a non-finite one returned
  // null at the mask step above — and non-negative because k > 0 and
  // sigmaCounts >= 0, so `> 0` is the whole remaining condition.
  let paddingXPx = paddingPx;
  let paddingYPx = paddingPx;
  let sigmaEstXPx: number | null = null;
  let sigmaEstYPx: number | null = null;
  if (!explicitPadding && thresholdCounts > 0) {
    const peakRobust = robustComponentPeak(values, width, height, bestPixels as Uint32Array, component.size);
    const ratio = peakRobust / thresholdCounts;
    // The finiteness half of this test cannot fail as the code stands — a
    // median of finite values over a non-empty component divided by a finite
    // positive threshold is finite — and is kept only so a future change to
    // robustComponentPeak cannot leak a non-finite ratio into the logarithm.
    // The condition that does the work is the ratio guard.
    if (Number.isFinite(ratio) && ratio > SUGGESTED_ROI_MIN_PEAK_RATIO) {
      const denominator = Math.sqrt(2 * Math.log(ratio));
      const derivedX = derivePadding(halfExtentX, denominator, paddingPx);
      const derivedY = derivePadding(halfExtentY, denominator, paddingPx);
      paddingXPx = derivedX.paddingPx;
      sigmaEstXPx = derivedX.sigmaEstPx;
      paddingYPx = derivedY.paddingPx;
      sigmaEstYPx = derivedY.sigmaEstPx;
    }
  }

  const unclampedX0 = component.minX - paddingXPx;
  const unclampedY0 = component.minY - paddingYPx;
  const unclampedX1 = component.maxX + paddingXPx;
  const unclampedY1 = component.maxY + paddingYPx;
  const x0 = Math.max(0, unclampedX0);
  const y0 = Math.max(0, unclampedY0);
  const x1 = Math.min(width - 1, unclampedX1);
  const y1 = Math.min(height - 1, unclampedY1);
  return {
    rect: { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
    componentPixelCount: component.size,
    maskPixelCount,
    maskFraction,
    suspectNoiseDominated,
    peakValueCounts: component.peakValueCounts,
    peakX: component.peakX,
    peakY: component.peakY,
    thresholdCounts,
    paddingPx,
    paddingXPx,
    paddingYPx,
    sigmaEstXPx,
    sigmaEstYPx,
    clampedToImage: x0 !== unclampedX0 || y0 !== unclampedY0 || x1 !== unclampedX1 || y1 !== unclampedY1,
  };
}
