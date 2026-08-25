import { type ValidationResult } from "../../core/src/index.ts";

// Pixel storage types the analyzer accepts. Values are always row-major,
// index = y * width + x, origin at the top-left pixel centre.
export type ImageDtype = "uint8" | "uint16" | "uint32" | "float32";

export type ImagePixelArray = Uint8Array | Uint16Array | Uint32Array | Float32Array;

export type ImageChannel = "r" | "g" | "b" | "a";

// Optional physical pixel calibration. Non-square pixels are allowed; all
// mm-derived quantities are computed in physical coordinates (Plan v5 §6).
export type ImageCalibration = {
  pixelPitchUmX: number;
  pixelPitchUmY: number;
};

// Analyzer configuration understood by the S18a foundation. Later subphases
// extend this additively (background, ROI, fits).
export type ImageAnalyzerConfig = {
  // Float data carries no dtype-implied saturation limit; detection only runs
  // when the user states one (Plan v5 §3 / operator decision #6).
  floatSaturationLimitCounts?: number;
};

// A decoded image. `pixels` is a fresh, defensively copied typed array that
// the decoder never reuses; callers may mutate their copy freely without
// affecting later decodes of the same bytes.
export type DecodedImage = {
  width: number;
  height: number;
  dtype: ImageDtype;
  pixels: ImagePixelArray;
  sourceFormat: "tiff" | "png";
  pageCount: number;
  pageIndex: number;
  // 1 for grayscale sources; 3/4 when the source was RGB(A) and a single
  // channel was extracted (channel then says which one).
  channelCount: number;
  channel?: ImageChannel;
  // True for RGB(A) sources: likely a rendered/false-color image, unsuitable
  // for quantitative evaluation without explicit user judgement.
  falseColorRisk: boolean;
  // Sanitized (NUL/control characters stripped) and capped metadata text from
  // the container (TIFF ImageDescription / OME-XML), when present.
  metadataText?: string;
  metadataTruncated?: boolean;
};

export type ImageAnalyzerInput = {
  pixels: ImagePixelArray | number[];
  width: number;
  height: number;
  dtype: ImageDtype;
  // Plan JSON lane uses `calib`; the analyzer entry point uses `calibration`.
  // Both names are accepted and both are validated when present.
  calib?: ImageCalibration;
  calibration?: ImageCalibration;
  config?: ImageAnalyzerConfig;
};

const DTYPES: readonly ImageDtype[] = ["uint8", "uint16", "uint32", "float32"];

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateCalibrationField(field: string, calib: ImageCalibration | undefined, errors: string[]): void {
  if (calib === undefined) return;
  if (typeof calib !== "object" || calib === null) {
    errors.push(`${field} must be an object`);
    return;
  }
  for (const key of ["pixelPitchUmX", "pixelPitchUmY"] as const) {
    const value = calib[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      errors.push(`${field}.${key} must be a positive finite number`);
    }
  }
}

// Full input validation for the analyzer entry point. runHeadlessJobJson only
// checks `kind`, so everything — including calib/config from the JSON lane —
// must be rejected here (Plan v5 §3).
export function validateImageAnalyzerInput(
  input: ImageAnalyzerInput,
): ValidationResult<ImageAnalyzerInput> {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) return { ok: false, errors: ["image input must be an object"] };

  if (!isPositiveInteger(input.width)) errors.push("width must be a positive integer");
  if (!isPositiveInteger(input.height)) errors.push("height must be a positive integer");
  if (!DTYPES.includes(input.dtype)) errors.push(`dtype must be one of ${DTYPES.join(", ")}`);

  const pixels = input.pixels;
  const isTyped =
    pixels instanceof Uint8Array ||
    pixels instanceof Uint16Array ||
    pixels instanceof Uint32Array ||
    pixels instanceof Float32Array;
  if (!isTyped && !Array.isArray(pixels)) {
    errors.push("pixels must be a typed array or a number[]");
  } else if (isTyped) {
    // FIX 1 (review round B): a typed array must be the constructor implied
    // by the declared dtype, otherwise a silently reinterpreted buffer would
    // pass validation. Plain number[] stays dtype-agnostic on purpose.
    const constructorMatches =
      (input.dtype === "uint8" && pixels instanceof Uint8Array) ||
      (input.dtype === "uint16" && pixels instanceof Uint16Array) ||
      (input.dtype === "uint32" && pixels instanceof Uint32Array) ||
      (input.dtype === "float32" && pixels instanceof Float32Array);
    if (!constructorMatches) {
      errors.push(`pixels typed array constructor does not match dtype ${input.dtype}`);
    }
    if (isPositiveInteger(input.width) && isPositiveInteger(input.height)) {
      const expected = input.width * input.height;
      const actual = (pixels as { length: number }).length;
      if (actual !== expected) errors.push(`pixels.length ${actual} does not match width*height ${expected}`);
    }
  } else {
    // Plain number[] branch: dtype-agnostic by contract, so the FIX 1
    // constructor check is deliberately skipped here. Only the pixel count
    // is validated (and non-array/non-typed inputs were rejected above).
    if (isPositiveInteger(input.width) && isPositiveInteger(input.height)) {
      const expected = input.width * input.height;
      const actual = (pixels as number[]).length;
      if (actual !== expected) errors.push(`pixels.length ${actual} does not match width*height ${expected}`);
    }
  }

  validateCalibrationField("calib", input.calib, errors);
  validateCalibrationField("calibration", input.calibration, errors);

  if (input.config !== undefined) {
    const config = input.config;
    if (typeof config !== "object" || config === null) {
      errors.push("config must be an object");
    } else if (config.floatSaturationLimitCounts !== undefined) {
      const limit = config.floatSaturationLimitCounts;
      if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
        errors.push("config.floatSaturationLimitCounts must be a positive finite number");
      }
    }
  }

  return errors.length === 0 ? { ok: true, value: input, errors: [] } : { ok: false, errors };
}

// Strip NUL and control characters (except \n and \t) from container metadata
// and cap the length. Applies to display AND export (Plan v5 §3; NUL-sanitize
// precedent from the wild-ZMX import path).
export function sanitizeMetadataText(raw: string, capChars: number): { text: string; truncated: boolean } {
  let cleaned = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\t") {
      cleaned += ch;
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue;
    cleaned += ch;
  }
  if (cleaned.length > capChars) {
    let capped = cleaned.slice(0, capChars);
    // FIX 2 (review round B): a cap that splits a surrogate pair must not
    // leave a dangling high surrogate; drop the lone half and end one code
    // unit short instead.
    const lastCode = capped.charCodeAt(capped.length - 1);
    const nextCode = cleaned.charCodeAt(capChars);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
      capped = capped.slice(0, capped.length - 1);
    }
    return { text: capped, truncated: true };
  }
  return { text: cleaned, truncated: false };
}

// Saturation limit implied by the dtype; float data has none unless the user
// provides one (Plan v5 §3).
export function dtypeSaturationLimit(dtype: ImageDtype, config?: ImageAnalyzerConfig): number | null {
  if (dtype === "uint8") return 255;
  if (dtype === "uint16") return 65535;
  if (dtype === "uint32") return 4294967295;
  return config?.floatSaturationLimitCounts ?? null;
}
