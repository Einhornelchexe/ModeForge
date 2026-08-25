import { type ValidationResult } from "../../core/src/index.ts";
import {
  sanitizeMetadataText,
  type DecodedImage,
  type ImageChannel,
  type ImageDtype,
  type ImagePixelArray,
} from "./contracts.ts";
import { MAX_DECODE_PIXELS, METADATA_CAP_CHARS } from "./thresholds.ts";

// Conservative scientific-image decoder: everything outside the documented
// subset blocks with a precise message instead of being silently
// misinterpreted (same honesty policy as the wild-ZMX importer). Chunk CRCs
// are not verified (subset decoder; corrupt streams fail structurally).
//
// Malformed input is always answered with ok:false, never with an exception
// or a rejected promise. Both format cores are wrapped in try/catch as
// defense in depth: the precise, hand-written messages above stay the normal
// path, and any unexpected exception becomes ok:false "malformed file: ...".

export type DecodeOptions = {
  pageIndex?: number;
  channel?: ImageChannel;
};

export async function decodeImageFile(
  bytes: Uint8Array | ArrayBuffer,
  options: DecodeOptions = {},
): Promise<ValidationResult<DecodedImage>> {
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (data.length >= 4 && ((data[0] === 0x49 && data[1] === 0x49) || (data[0] === 0x4d && data[1] === 0x4d))) {
    return decodeTiff(data, options);
  }
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return decodePng(data, options);
  }
  return { ok: false, errors: ["unsupported file: neither a TIFF (II/MM) nor a PNG signature was found"] };
}

// --- TIFF ---------------------------------------------------------------

type TiffEntry = { type: number; count: number; valueOffset: number };
type TiffIfd = Map<number, TiffEntry>;

const TIFF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

// Tag value arrays are only materialized up to this many entries (review
// defect D4); anything larger is answered honestly before allocating.
const MAX_TAG_VALUE_COUNT = 1048576;

// Internal error carrying a precise structural-failure message. decodeTiff
// converts it to ok:false with that message; anything else is an unexpected
// exception and becomes ok:false "malformed file: ...".
class TiffStructuralError extends Error {}

function readIfd(view: DataView, offset: number, little: boolean): { ifd: TiffIfd; next: number } {
  if (offset + 2 > view.byteLength) throw new TiffStructuralError("TIFF: file truncated inside the IFD chain");
  const count = view.getUint16(offset, little);
  if (offset + 2 + count * 12 + 4 > view.byteLength) {
    throw new TiffStructuralError("TIFF: file truncated inside the IFD chain");
  }
  const ifd: TiffIfd = new Map();
  for (let i = 0; i < count; i += 1) {
    const base = offset + 2 + i * 12;
    const tag = view.getUint16(base, little);
    const type = view.getUint16(base + 2, little);
    const valueCount = view.getUint32(base + 4, little);
    ifd.set(tag, { type, count: valueCount, valueOffset: base + 8 });
  }
  const next = view.getUint32(offset + 2 + count * 12, little);
  return { ifd, next };
}

function tiffValues(view: DataView, entry: TiffEntry, little: boolean): number[] {
  const size = TIFF_TYPE_SIZES[entry.type] ?? 0;
  if (size === 0) throw new TiffStructuralError(`TIFF: unexpected tag type ${entry.type}`);
  if (!Number.isInteger(entry.count) || entry.count < 0) throw new TiffStructuralError("TIFF: invalid tag value count");
  if (entry.count > MAX_TAG_VALUE_COUNT) {
    throw new TiffStructuralError(`TIFF: oversized tag - ${entry.count} values exceeds the ${MAX_TAG_VALUE_COUNT} supported`);
  }
  const total = size * entry.count;
  const start = total <= 4 ? entry.valueOffset : view.getUint32(entry.valueOffset, little);
  if (start + total > view.byteLength) {
    throw new TiffStructuralError("TIFF: file truncated - tag values reach past end of file");
  }
  const values: number[] = [];
  for (let i = 0; i < entry.count; i += 1) {
    const at = start + i * size;
    if (entry.type === 3) values.push(view.getUint16(at, little));
    else if (entry.type === 4) values.push(view.getUint32(at, little));
    else if (entry.type === 1 || entry.type === 2 || entry.type === 6 || entry.type === 7) values.push(view.getUint8(at));
    else if (entry.type === 11) values.push(view.getFloat32(at, little));
    else throw new TiffStructuralError(`TIFF: unexpected tag type ${entry.type}`);
  }
  return values;
}

function tiffAscii(view: DataView, entry: TiffEntry, little: boolean): string {
  // Read at most min(count, 4 * METADATA_CAP_CHARS) bytes (review defect D8)
  // in addition to the hard file boundary enforced below.
  const readCount = Math.min(entry.count, 4 * METADATA_CAP_CHARS);
  if (readCount === 0) return "";
  const start = entry.count <= 4 ? entry.valueOffset : view.getUint32(entry.valueOffset, little);
  if (start + readCount > view.byteLength) {
    throw new TiffStructuralError("TIFF: file truncated - metadata text reaches past end of file");
  }
  let text = "";
  for (let i = 0; i < readCount; i += 1) {
    const code = view.getUint8(start + i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

function first(view: DataView, ifd: TiffIfd, tag: number, little: boolean, fallback?: number): number | undefined {
  const entry = ifd.get(tag);
  if (!entry) return fallback;
  const values = tiffValues(view, entry, little);
  return values.length > 0 ? values[0] : fallback;
}

function decodeTiff(data: Uint8Array, options: DecodeOptions): ValidationResult<DecodedImage> {
  try {
    return decodeTiffCore(data, options);
  } catch (error) {
    if (error instanceof TiffStructuralError) return { ok: false, errors: [error.message] };
    const message = error instanceof Error ? error.message : String(error);
    // Precise hand-written failures above are the normal path; this is the
    // final defense-in-depth guard for unexpected exceptions.
    return { ok: false, errors: [`malformed file: ${message}`] };
  }
}

function decodeTiffCore(data: Uint8Array, options: DecodeOptions): ValidationResult<DecodedImage> {
  const errors: string[] = [];
  if (data.length < 8) return { ok: false, errors: ["TIFF: file truncated before the first IFD offset"] };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const little = data[0] === 0x49;
  if (view.getUint16(2, little) !== 42) return { ok: false, errors: ["TIFF: bad magic number (expected 42)"] };

  const ifds: TiffIfd[] = [];
  let offset = view.getUint32(4, little);
  let guard = 0;
  while (offset !== 0) {
    if (guard > 512) return { ok: false, errors: ["TIFF: IFD chain too long or circular"] };
    if (offset + 2 > data.length) return { ok: false, errors: ["TIFF: file truncated inside the IFD chain"] };
    const { ifd, next } = readIfd(view, offset, little);
    ifds.push(ifd);
    offset = next;
    guard += 1;
  }
  if (ifds.length === 0) return { ok: false, errors: ["TIFF: no image directory found"] };

  const pageIndex = options.pageIndex ?? 0;
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= ifds.length) {
    return { ok: false, errors: [`TIFF: pageIndex ${pageIndex} is out of range (file has ${ifds.length} page(s))`] };
  }
  const ifd = ifds[pageIndex];

  // Review defect D9: every consumed tag must carry its documented type; the
  // old silent UINT32 fallback for unknown types no longer applies to them.
  const expectTagType = (tag: number, label: string, allowed: readonly number[]): void => {
    const entry = ifd.get(tag);
    if (entry === undefined) return;
    if (!allowed.includes(entry.type)) {
      errors.push(`TIFF: unexpected tag type ${entry.type} for tag ${tag} (${label}, expected ${allowed.join(" or ")})`);
    }
  };
  expectTagType(256, "ImageWidth", [3, 4]);
  expectTagType(257, "ImageLength", [3, 4]);
  expectTagType(258, "BitsPerSample", [3]);
  expectTagType(259, "Compression", [3]);
  expectTagType(262, "PhotometricInterpretation", [3]);
  expectTagType(270, "ImageDescription", [2]);
  expectTagType(273, "StripOffsets", [3, 4]);
  expectTagType(274, "Orientation", [3]);
  expectTagType(277, "SamplesPerPixel", [3]);
  expectTagType(278, "RowsPerStrip", [3, 4]);
  expectTagType(279, "StripByteCounts", [3, 4]);
  expectTagType(284, "PlanarConfiguration", [3]);
  expectTagType(317, "Predictor", [3]);
  expectTagType(339, "SampleFormat", [3]);
  if (errors.length > 0) return { ok: false, errors };

  // Honest blocks for everything outside the subset.
  const compression = first(view, ifd, 259, little, 1);
  if (compression !== 1) errors.push(`TIFF: compressed data (Compression=${compression}) is not supported - export uncompressed`);
  if (ifd.has(322) || ifd.has(323)) errors.push("TIFF: tiled layout is not supported - export with strips");
  const planar = first(view, ifd, 284, little, 1);
  if (planar !== 1) errors.push(`TIFF: planar configuration ${planar} is not supported`);
  if (ifd.has(320)) errors.push("TIFF: palette-color images are not supported");
  const photometric = first(view, ifd, 262, little, 1);
  if (photometric === 0) {
    // WhiteIsZero needs an inversion this decoder deliberately does not
    // perform: reading it as BlackIsZero would invert every downstream
    // reading instead of failing visibly.
    errors.push("TIFF: WhiteIsZero (inverted) images are not supported - export with BlackIsZero");
  } else if (photometric !== 1) {
    errors.push(`TIFF: photometric interpretation ${photometric} is not supported (grayscale only)`);
  }
  // Orientation describes a rotation/flip this decoder does not apply, so any
  // non-identity value is blocked rather than decoded as if it were 1 (which
  // would silently swap the axes). An absent tag means the identity.
  const orientationEntry = ifd.get(274);
  if (orientationEntry !== undefined) {
    if (orientationEntry.count !== 1) {
      errors.push(`TIFF: Orientation tag must carry exactly 1 value (found ${orientationEntry.count})`);
    } else {
      const orientation = first(view, ifd, 274, little, 1);
      if (orientation !== 1) {
        errors.push(`TIFF: orientation ${orientation} is not supported - export with orientation 1 (top-left)`);
      }
    }
  }
  const samplesPerPixel = first(view, ifd, 277, little, 1);
  if (samplesPerPixel !== 1) errors.push(`TIFF: ${samplesPerPixel} samples per pixel are not supported (grayscale only)`);
  const predictor = first(view, ifd, 317, little, 1);
  if (predictor !== 1) errors.push(`TIFF: predictor ${predictor} is not supported`);
  const bitsPerSample = first(view, ifd, 258, little, 1) ?? 1;
  const sampleFormat = first(view, ifd, 339, little, 1) ?? 1;
  if (sampleFormat === 2) errors.push("TIFF: signed integer samples are not supported");
  else if (sampleFormat !== 1 && sampleFormat !== 3) errors.push(`TIFF: sample format ${sampleFormat} is not supported`);
  if (sampleFormat === 3 && bitsPerSample !== 32) errors.push("TIFF: floating-point data is only supported as 32-bit");
  if (sampleFormat === 1 && bitsPerSample !== 8 && bitsPerSample !== 16 && bitsPerSample !== 32) {
    errors.push(`TIFF: ${bitsPerSample}-bit integer samples are not supported (8/16/32)`);
  }

  const width = first(view, ifd, 256, little);
  const height = first(view, ifd, 257, little);
  const rowsPerStripOrFallback = first(view, ifd, 278, little, height);
  if (!width || !height) errors.push("TIFF: missing image dimensions");
  const stripOffsetsEntry = ifd.get(273);
  const stripCountsEntry = ifd.get(279);
  if (!stripOffsetsEntry || !stripCountsEntry) errors.push("TIFF: missing strip offsets/byte counts");
  if (errors.length > 0) return { ok: false, errors };

  const w = width as number;
  const h = height as number;
  // Review defect D7: enforce the documented pixel cap before any allocation
  // or strip logic runs.
  if (w > MAX_DECODE_PIXELS / h) {
    return { ok: false, errors: [`TIFF: image dimensions ${w} x ${h} exceed the supported pixel cap of ${MAX_DECODE_PIXELS}`] };
  }
  const rowsPerStrip = rowsPerStripOrFallback ?? h;
  if (!Number.isInteger(rowsPerStrip) || rowsPerStrip <= 0) {
    return { ok: false, errors: ["TIFF: RowsPerStrip must be a positive integer"] };
  }

  // Review defect D2: both strip tables must agree, and every offset/count
  // must be a finite non-negative integer (unsigned SHORT/LONG reads already
  // guarantee this; the explicit scan keeps the invariant visible).
  const stripOffsets = tiffValues(view, stripOffsetsEntry as TiffEntry, little);
  const stripCounts = tiffValues(view, stripCountsEntry as TiffEntry, little);
  if (stripOffsets.length !== stripCounts.length) {
    return { ok: false, errors: [`TIFF: strip table mismatch - ${stripOffsets.length} offsets vs ${stripCounts.length} byte counts`] };
  }
  for (let i = 0; i < stripOffsets.length; i += 1) {
    if (!Number.isInteger(stripOffsets[i]) || stripOffsets[i] < 0 || !Number.isInteger(stripCounts[i]) || stripCounts[i] < 0) {
      return { ok: false, errors: ["TIFF: strip table values must be finite non-negative integers"] };
    }
  }

  const bytesPerSample = bitsPerSample / 8;
  const dtype: ImageDtype = sampleFormat === 3 ? "float32" : bitsPerSample === 8 ? "uint8" : bitsPerSample === 16 ? "uint16" : "uint32";
  const pixels: ImagePixelArray =
    dtype === "uint8"
      ? new Uint8Array(w * h)
      : dtype === "uint16"
        ? new Uint16Array(w * h)
        : dtype === "uint32"
          ? new Uint32Array(w * h)
          : new Float32Array(w * h);

  // Review defect D1: honor RowsPerStrip. Each strip carries exactly
  // rowsPerStrip rows (fewer for the final strip), and only those samples are
  // consumed - surplus bytes in a strip are padding and are ignored.
  let written = 0;
  let row = 0;
  for (let s = 0; s < stripOffsets.length && written < w * h; s += 1) {
    const rowsInStrip = Math.min(rowsPerStrip, h - row);
    const samplesInStrip = rowsInStrip * w;
    const neededBytes = samplesInStrip * bytesPerSample;
    const start = stripOffsets[s];
    if (stripCounts[s] < neededBytes) {
      return {
        ok: false,
        errors: [`TIFF: truncated strip ${s} - byte count ${stripCounts[s]} is smaller than the ${neededBytes} bytes needed for ${rowsInStrip} row(s)`],
      };
    }
    if (start + neededBytes > data.length) {
      return { ok: false, errors: [`TIFF: file truncated - strip ${s} reaches past end of file`] };
    }
    for (let i = 0; i < samplesInStrip; i += 1) {
      const at = start + i * bytesPerSample;
      if (dtype === "uint8") pixels[written + i] = view.getUint8(at);
      else if (dtype === "uint16") pixels[written + i] = view.getUint16(at, little);
      else if (dtype === "uint32") pixels[written + i] = view.getUint32(at, little);
      else pixels[written + i] = view.getFloat32(at, little);
    }
    written += samplesInStrip;
    row += rowsInStrip;
  }
  if (written < w * h) return { ok: false, errors: ["TIFF: file truncated - not enough strip data"] };

  const result: DecodedImage = {
    width: w,
    height: h,
    dtype,
    pixels,
    sourceFormat: "tiff",
    pageCount: ifds.length,
    pageIndex,
    channelCount: 1,
    falseColorRisk: false,
  };
  const descriptionEntry = ifd.get(270);
  if (descriptionEntry) {
    const { text, truncated } = sanitizeMetadataText(tiffAscii(view, descriptionEntry, little), METADATA_CAP_CHARS);
    if (text.length > 0) {
      result.metadataText = text;
      result.metadataTruncated = truncated;
    }
  }
  return { ok: true, value: result, errors: [] };
}

// --- PNG ----------------------------------------------------------------

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("PNG: DecompressionStream is not available in this runtime");
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw: Uint8Array, width: number, height: number, bytesPerPixel: number): ValidationResult<Uint8Array> {
  const stride = width * bytesPerPixel;
  if (raw.length < height * (stride + 1)) return { ok: false, errors: ["PNG: decompressed data is shorter than the image needs"] };
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    if (filter > 4) return { ok: false, errors: [`PNG: unknown filter type ${filter}`] };
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[src + x];
      const left = x >= bytesPerPixel ? out[dst + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[dst + x - stride] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[dst + x - stride - bytesPerPixel] : 0;
      let value = rawByte;
      if (filter === 1) value = rawByte + left;
      else if (filter === 2) value = rawByte + up;
      else if (filter === 3) value = rawByte + Math.floor((left + up) / 2);
      else if (filter === 4) value = rawByte + paeth(left, up, upLeft);
      out[dst + x] = value & 0xff;
    }
  }
  return { ok: true, value: out, errors: [] };
}

async function decodePng(data: Uint8Array, options: DecodeOptions): Promise<ValidationResult<DecodedImage>> {
  try {
    return await decodePngCore(data, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Precise hand-written failures above are the normal path; this is the
    // final defense-in-depth guard for unexpected exceptions.
    return { ok: false, errors: [`malformed file: ${message}`] };
  }
}

async function decodePngCore(data: Uint8Array, options: DecodeOptions): Promise<ValidationResult<DecodedImage>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  let header: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null = null;
  const idatParts: Uint8Array[] = [];
  let sawTrns = false;

  while (offset + 8 <= data.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    const chunkStart = offset + 8;
    if (chunkStart + length > data.length) return { ok: false, errors: ["PNG: file truncated inside a chunk"] };
    if (type === "IHDR") {
      // Review defect D6: a short IHDR cannot be trusted to describe an image.
      if (length < 13) return { ok: false, errors: [`PNG: IHDR chunk is too short (expected 13 bytes, got ${length})`] };
      header = {
        width: view.getUint32(chunkStart, false),
        height: view.getUint32(chunkStart + 4, false),
        bitDepth: data[chunkStart + 8],
        colorType: data[chunkStart + 9],
        interlace: data[chunkStart + 12],
      };
      if (data[chunkStart + 10] !== 0) return { ok: false, errors: ["PNG: unknown compression method"] };
      if (data[chunkStart + 11] !== 0) return { ok: false, errors: ["PNG: unknown filter method"] };
    } else if (type === "IDAT") {
      idatParts.push(data.subarray(chunkStart, chunkStart + length));
    } else if (type === "tRNS") {
      sawTrns = true;
    } else if (type === "IEND") {
      break;
    }
    offset = chunkStart + length + 4;
  }

  if (!header) return { ok: false, errors: ["PNG: missing IHDR chunk"] };
  const errors: string[] = [];
  if (header.interlace !== 0) errors.push("PNG: Adam7-interlaced images are not supported");
  if (sawTrns) errors.push("PNG: tRNS transparency is not supported");
  if (header.colorType === 3) errors.push("PNG: palette images are not supported");
  if (header.colorType === 4) errors.push("PNG: grayscale+alpha images are not supported");
  const isGray = header.colorType === 0;
  const isRgb = header.colorType === 2 || header.colorType === 6;
  if (!isGray && !isRgb && header.colorType !== 3 && header.colorType !== 4) {
    errors.push(`PNG: color type ${header.colorType} is not supported`);
  }
  if (isGray && header.bitDepth !== 8 && header.bitDepth !== 16) {
    errors.push(`PNG: ${header.bitDepth}-bit grayscale is not supported (8/16)`);
  }
  if (isRgb && header.bitDepth !== 8) {
    errors.push("PNG: RGB(A) images are only supported with 8 bit per channel");
  }
  if (header.width <= 0 || header.height <= 0) errors.push("PNG: invalid dimensions");
  if (idatParts.length === 0) errors.push("PNG: missing IDAT data");

  const channels = isGray ? 1 : header.colorType === 2 ? 3 : 4;
  // Review defect D5: a channel is a runtime input and must be exactly one of
  // r/g/b/a; an unknown value is rejected instead of silently mapping to
  // something else.
  const validChannels: readonly ImageChannel[] = ["r", "g", "b", "a"];
  let channelIndex = -1;
  if (options.channel !== undefined && !validChannels.includes(options.channel)) {
    errors.push(`PNG: unknown channel ${JSON.stringify(options.channel)} (expected r, g, b or a)`);
  } else if (isRgb) {
    const channel = options.channel;
    if (channel === undefined) {
      errors.push("PNG: RGB(A) images need an explicit channel selection (r, g, b or a)");
    } else {
      channelIndex = channel === "r" ? 0 : channel === "g" ? 1 : channel === "b" ? 2 : 3;
      if (channelIndex === 3 && channels !== 4) errors.push("PNG: alpha channel requested but the image has no alpha");
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Review defect D7: enforce the documented pixel cap before inflating,
  // unfiltering or allocating the pixel buffer.
  if (header.width > MAX_DECODE_PIXELS / header.height) {
    return { ok: false, errors: [`PNG: image dimensions ${header.width} x ${header.height} exceed the supported pixel cap of ${MAX_DECODE_PIXELS}`] };
  }

  const idat = new Uint8Array(idatParts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of idatParts) {
    idat.set(part, at);
    at += part.length;
  }
  let raw: Uint8Array;
  try {
    raw = await inflateZlib(idat);
  } catch (error) {
    return { ok: false, errors: [`PNG: inflate failed - ${error instanceof Error ? error.message : String(error)}`] };
  }

  const bytesPerPixel = channels * (header.bitDepth === 16 ? 2 : 1);
  const unfiltered = unfilter(raw, header.width, header.height, bytesPerPixel);
  if (!unfiltered.ok) return { ok: false, errors: unfiltered.errors };
  const scan = unfiltered.value;
  const count = header.width * header.height;

  let pixels: ImagePixelArray;
  let dtype: ImageDtype;
  if (isGray && header.bitDepth === 16) {
    dtype = "uint16";
    const out = new Uint16Array(count);
    for (let i = 0; i < count; i += 1) out[i] = (scan[i * 2] << 8) | scan[i * 2 + 1];
    pixels = out;
  } else if (isGray) {
    dtype = "uint8";
    pixels = new Uint8Array(scan.subarray(0, count));
  } else {
    dtype = "uint8";
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) out[i] = scan[i * bytesPerPixel + channelIndex];
    pixels = out;
  }

  return {
    ok: true,
    value: {
      width: header.width,
      height: header.height,
      dtype,
      pixels,
      sourceFormat: "png",
      pageCount: 1,
      pageIndex: 0,
      channelCount: channels,
      channel: isRgb ? options.channel : undefined,
      falseColorRisk: isRgb,
    },
    errors: [],
  };
}
