import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";

import type { DecodedImage, ImageChannel, ImagePixelArray } from "../../packages/image/src/contracts.ts";
import { decodeImageFile } from "../../packages/image/src/decode.ts";
import { METADATA_CAP_CHARS } from "../../packages/image/src/thresholds.ts";

type DecodeResult = Awaited<ReturnType<typeof decodeImageFile>>;

// ---------------------------------------------------------------------------
// Shared assertion helpers
// ---------------------------------------------------------------------------

function requireDecoded(result: DecodeResult, where: string): DecodedImage {
  if (!result.ok) {
    assert.fail(`${where}: expected a successful decode, got ${result.errors.join("; ")}`);
  }
  return result.value;
}

function assertDecodeFails(result: DecodeResult, ...needles: string[]): void {
  assert.equal(result.ok, false, "expected the decode to fail");
  const joined = result.errors.join("\n").toLowerCase();
  for (const needle of needles) {
    assert.ok(
      joined.includes(needle.toLowerCase()),
      `expected errors ${JSON.stringify(result.errors)} to include ${JSON.stringify(needle)}`,
    );
  }
}

function assertPixels(
  actual: ImagePixelArray,
  expected: readonly number[],
  transform: (value: number) => number = (value) => value,
): void {
  assert.equal(actual.length, expected.length, "pixel count mismatch");
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(actual[i], transform(expected[i]), `pixel ${i}`);
  }
}

// ---------------------------------------------------------------------------
// TIFF fixture builder
// ---------------------------------------------------------------------------

type TiffEndian = "le" | "be";

type TiffEntryDef = {
  tag: number;
  type: number; // 2 = ASCII, 3 = SHORT, 4 = LONG, 11 = FLOAT
  values: number[];
};

type TiffStripSpec = {
  bytes: Uint8Array;
  byteCountOverride?: number;
};

type TiffPageInput = {
  entries: readonly TiffEntryDef[];
  stripBytes?: Uint8Array;
  stripByteCountsOverride?: number;
  // Multi-strip support: the builder generates the StripOffsets (273) and
  // StripByteCounts (279) tags from this list and writes the real strip slot
  // offsets into them, out-of-line whenever the array needs more than 4 bytes.
  strips?: readonly TiffStripSpec[];
};

type EffectiveTiffPage = {
  entries: TiffEntryDef[];
  strips: readonly { bytes: Uint8Array; count: number }[];
};

const TIFF_TYPE_SIZES: Record<number, number> = { 2: 1, 3: 2, 4: 4, 11: 4 };

function tiffEntryByteSize(entry: TiffEntryDef): number {
  return (TIFF_TYPE_SIZES[entry.type] ?? 0) * entry.values.length;
}

function encodeTiffEntry(entry: TiffEntryDef, endian: TiffEndian): Uint8Array {
  const little = endian === "le";
  const bytesPerValue = TIFF_TYPE_SIZES[entry.type] ?? 0;
  const out = new Uint8Array(entry.values.length * bytesPerValue);
  const view = new DataView(out.buffer);
  entry.values.forEach((value, index) => {
    const at = index * bytesPerValue;
    if (entry.type === 3) view.setUint16(at, value, little);
    else if (entry.type === 4) view.setUint32(at, value >>> 0, little);
    else if (entry.type === 11) view.setFloat32(at, Math.fround(value), little);
    else out[at] = value & 0xff;
  });
  return out;
}

function buildTiff(endian: TiffEndian, pages: readonly TiffPageInput[]): Uint8Array {
  const little = endian === "le";

  const effectivePages: EffectiveTiffPage[] = pages.map((page) => {
    const strips: readonly { bytes: Uint8Array; count: number }[] =
      page.strips !== undefined
        ? page.strips.map((strip) => ({
            bytes: strip.bytes,
            count: strip.byteCountOverride ?? strip.bytes.length,
          }))
        : page.stripBytes !== undefined
          ? [{ bytes: page.stripBytes, count: page.stripByteCountsOverride ?? page.stripBytes.length }]
          : [];
    const entries =
      strips.length > 0
        ? page.entries.filter((entry) => entry.tag !== 273 && entry.tag !== 279)
        : [...page.entries];
    if (strips.length > 0) {
      entries.push({ tag: 273, type: 4, values: strips.map(() => 0) });
      entries.push({ tag: 279, type: 4, values: strips.map((strip) => strip.count) });
    }
    return { entries, strips };
  });

  const ifdOffsets: number[] = [];
  let cursor = 8;
  for (const page of effectivePages) {
    ifdOffsets.push(cursor);
    cursor += 2 + page.entries.length * 12 + 4;
  }

  const outOfLineSlots = new Map<number, number>();
  effectivePages.forEach((page, pageIndex) => {
    page.entries.forEach((entry, entryIndex) => {
      if (tiffEntryByteSize(entry) > 4) {
        outOfLineSlots.set(pageIndex * 4096 + entryIndex, cursor);
        cursor += tiffEntryByteSize(entry);
      }
    });
  });

  const stripSlots: number[][] = [];
  effectivePages.forEach((page) => {
    const slots: number[] = [];
    for (const strip of page.strips) {
      slots.push(cursor);
      cursor += strip.bytes.length;
    }
    stripSlots.push(slots);
  });

  const buffer = new Uint8Array(cursor);
  const view = new DataView(buffer.buffer);
  view.setUint8(0, little ? 0x49 : 0x4d);
  view.setUint8(1, little ? 0x49 : 0x4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, ifdOffsets[0] ?? 0, little);

  effectivePages.forEach((page, pageIndex) => {
    const offset = ifdOffsets[pageIndex];
    view.setUint16(offset, page.entries.length, little);
    page.entries.forEach((entry, entryIndex) => {
      const base = offset + 2 + entryIndex * 12;
      view.setUint16(base, entry.tag, little);
      view.setUint16(base + 2, entry.type, little);
      view.setUint32(base + 4, entry.values.length, little);
      if (tiffEntryByteSize(entry) <= 4) {
        buffer.set(encodeTiffEntry(entry, endian), base + 8);
      } else {
        const slot = outOfLineSlots.get(pageIndex * 4096 + entryIndex);
        if (slot === undefined) throw new Error("internal builder error: missing out-of-line slot");
        view.setUint32(base + 8, slot, little);
        buffer.set(encodeTiffEntry(entry, endian), slot);
      }
    });
    const nextIfd = pageIndex + 1 < effectivePages.length ? ifdOffsets[pageIndex + 1] : 0;
    view.setUint32(offset + 2 + page.entries.length * 12, nextIfd, little);
  });

  effectivePages.forEach((page, pageIndex) => {
    page.strips.forEach((strip, stripIndex) => {
      buffer.set(strip.bytes, stripSlots[pageIndex][stripIndex]);
    });
    if (page.strips.length === 0) return;
    const ifdOffset = ifdOffsets[pageIndex];
    const writeLongs = (entryIndex: number, values: readonly number[]): void => {
      const entry = page.entries[entryIndex];
      const base = ifdOffset + 2 + entryIndex * 12;
      if (tiffEntryByteSize(entry) <= 4) {
        values.forEach((value, index) => view.setUint32(base + 8 + index * 4, value >>> 0, little));
      } else {
        const slot = outOfLineSlots.get(pageIndex * 4096 + entryIndex);
        if (slot === undefined) throw new Error("internal builder error: missing out-of-line slot");
        values.forEach((value, index) => view.setUint32(slot + index * 4, value >>> 0, little));
      }
    };
    writeLongs(
      page.entries.findIndex((entry) => entry.tag === 273),
      stripSlots[pageIndex],
    );
    writeLongs(
      page.entries.findIndex((entry) => entry.tag === 279),
      page.strips.map((strip) => strip.count),
    );
  });

  return buffer;
}

type StandardTiffOptions = {
  width: number;
  height: number;
  bitsPerSample: number;
  sampleFormat?: number;
  compression?: number;
  photometric?: number;
  orientation?: number;
  planar?: number;
  tileWidth?: number;
  colorMap?: boolean;
  samplesPerPixel?: number;
  rowsPerStrip?: number;
  description?: string;
};

function standardTiffEntries(options: StandardTiffOptions): TiffEntryDef[] {
  const entries: TiffEntryDef[] = [
    { tag: 256, type: 4, values: [options.width] },
    { tag: 257, type: 4, values: [options.height] },
    { tag: 258, type: 3, values: [options.bitsPerSample] },
    { tag: 259, type: 3, values: [options.compression ?? 1] },
    { tag: 262, type: 3, values: [options.photometric ?? 1] },
    { tag: 273, type: 4, values: [0] },
    { tag: 277, type: 3, values: [options.samplesPerPixel ?? 1] },
    { tag: 279, type: 4, values: [0] },
  ];
  if (options.rowsPerStrip !== undefined) entries.push({ tag: 278, type: 4, values: [options.rowsPerStrip] });
  if (options.orientation !== undefined) entries.push({ tag: 274, type: 3, values: [options.orientation] });
  if (options.sampleFormat !== undefined) entries.push({ tag: 339, type: 3, values: [options.sampleFormat] });
  if (options.planar !== undefined) entries.push({ tag: 284, type: 3, values: [options.planar] });
  if (options.tileWidth !== undefined) entries.push({ tag: 322, type: 4, values: [options.tileWidth] });
  if (options.colorMap === true) {
    entries.push({ tag: 320, type: 3, values: [0, 65535, 0, 65535, 0, 65535] });
  }
  if (options.description !== undefined) {
    const codes: number[] = [];
    for (let i = 0; i < options.description.length; i += 1) {
      codes.push(options.description.charCodeAt(i));
    }
    entries.push({ tag: 270, type: 2, values: codes });
  }
  return entries;
}

function encodeTiffStrip(
  endian: TiffEndian,
  bitsPerSample: number,
  sampleFormat: number,
  values: readonly number[],
): Uint8Array {
  const bytesPerValue = bitsPerSample / 8;
  const out = new Uint8Array(values.length * bytesPerValue);
  const view = new DataView(out.buffer);
  const little = endian === "le";
  values.forEach((value, index) => {
    const at = index * bytesPerValue;
    if (sampleFormat === 3) view.setFloat32(at, Math.fround(value), little);
    else if (bytesPerValue === 2) view.setUint16(at, value & 0xffff, little);
    else if (bytesPerValue === 4) view.setUint32(at, value >>> 0, little);
    else out[at] = value & 0xff;
  });
  return out;
}

function buildBlockTiff(options: Partial<StandardTiffOptions>): Uint8Array {
  const width = options.width ?? 2;
  const height = options.height ?? 2;
  return buildTiff("le", [
    {
      entries: standardTiffEntries({ width, height, bitsPerSample: 8, ...options }),
      stripBytes: new Uint8Array(width * height),
    },
  ]);
}

// ---------------------------------------------------------------------------
// PNG fixture builder
// ---------------------------------------------------------------------------

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, 0, false); // dummy CRC, the decoder does not verify CRCs
  return out;
}

function pngChannelsFor(colorType: number): number {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  return 4; // colorType 6
}

function testPaeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Real PNG pre-filtering for all five filter types. For Average and Paeth
// the predictor uses the reconstructed left pixel of the current row and the
// up/up-left pixels of the previous row (bytesPerPixel-aware), exactly as the
// decoder in decode.ts does in reverse.
function applyPngFilter(
  raw: Uint8Array,
  bytesPerPixel: number,
  filter: number,
  previous: Uint8Array | undefined,
): Uint8Array {
  if (filter === 0) return new Uint8Array(raw);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const left = i >= bytesPerPixel ? raw[i - bytesPerPixel] : 0;
    const up = previous !== undefined && i < previous.length ? previous[i] : 0;
    const upLeft =
      previous !== undefined && i >= bytesPerPixel && i - bytesPerPixel < previous.length
        ? previous[i - bytesPerPixel]
        : 0;
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = up;
    else if (filter === 3) predictor = Math.floor((left + up) / 2);
    else if (filter === 4) predictor = testPaeth(left, up, upLeft);
    else throw new Error(`applyPngFilter: unsupported filter ${filter}`);
    out[i] = (raw[i] - predictor) & 0xff;
  }
  return out;
}

type PngBuildOptions = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace?: number;
  filters?: number[];
  rawRows: Uint8Array[];
  hasTrns?: boolean;
};

function buildPng(options: PngBuildOptions): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, options.width, false);
  view.setUint32(4, options.height, false);
  ihdr[8] = options.bitDepth;
  ihdr[9] = options.colorType;
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = options.interlace ?? 0;

  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const bytesPerPixel = pngChannelsFor(options.colorType) * (options.bitDepth === 16 ? 2 : 1);
  const scan: Uint8Array[] = [];
  options.rawRows.forEach((row, index) => {
    const filter = options.filters?.[index] ?? 0;
    scan.push(Uint8Array.of(filter));
    scan.push(applyPngFilter(row, bytesPerPixel, filter, index > 0 ? options.rawRows[index - 1] : undefined));
  });
  const idat = new Uint8Array(deflateSync(concatBytes(scan)));
  const parts: Uint8Array[] = [signature, pngChunk("IHDR", ihdr)];
  if (options.hasTrns === true) {
    parts.push(pngChunk("tRNS", Uint8Array.of(0, 255, 0, 255, 0, 255)));
  }
  parts.push(pngChunk("IDAT", idat));
  parts.push(pngChunk("IEND", Uint8Array.of()));
  return concatBytes(parts);
}

function rowsFrom(width: number, values: readonly number[]): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (let i = 0; i < values.length; i += width) {
    rows.push(Uint8Array.from(values.slice(i, i + width)));
  }
  return rows;
}

function rowsFromBe16(width: number, values: readonly number[]): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (let i = 0; i < values.length; i += width) {
    const row = new Uint8Array(width * 2);
    for (let x = 0; x < width; x += 1) {
      const value = values[i + x];
      row[x * 2] = (value >> 8) & 0xff;
      row[x * 2 + 1] = value & 0xff;
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Malformed fixtures used by the focused regression tests and by T10
// ---------------------------------------------------------------------------

function mismatchedStripTableTiff(): Uint8Array {
  const entries = standardTiffEntries({ width: 1, height: 1, bitsPerSample: 8 });
  const offsetEntry = entries.findIndex((entry) => entry.tag === 273);
  const countEntry = entries.findIndex((entry) => entry.tag === 279);
  entries[offsetEntry].values = [0, 0];
  entries[countEntry].values = [0];
  return buildTiff("le", [{ entries }]);
}

function truncatedIfdTiff(): Uint8Array {
  const bytes = buildTiff("le", [
    { entries: standardTiffEntries({ width: 2, height: 2, bitsPerSample: 8 }), stripBytes: new Uint8Array(4) },
  ]);
  // Keep the 8-byte header plus only a fragment of the IFD: the entry count
  // promises more entries than the file carries.
  return bytes.slice(0, 20);
}

function oversizedTagTiff(): Uint8Array {
  const bytes = buildBlockTiff({});
  // Entry 3 of the standard entries is Compression (tag 259); promise an
  // absurd number of values (0x7fffffff) in its count field at IFD offset 8.
  new DataView(bytes.buffer).setUint32(8 + 2 + 3 * 12 + 4, 0x7fffffff, true);
  return bytes;
}

// Orientation (tag 274) is not part of the standard entry set, so these
// fixtures append a raw entry whose type and value count can be malformed on
// purpose.
function orientationTagTiff(entry: TiffEntryDef): Uint8Array {
  const width = 2;
  const height = 2;
  return buildTiff("le", [
    {
      entries: [...standardTiffEntries({ width, height, bitsPerSample: 8 }), entry],
      stripBytes: new Uint8Array(width * height),
    },
  ]);
}

function mistypedOrientationTiff(): Uint8Array {
  // LONG instead of the documented SHORT.
  return orientationTagTiff({ tag: 274, type: 4, values: [1] });
}

function multiValueOrientationTiff(): Uint8Array {
  // Two values where the tag is defined to carry exactly one.
  return orientationTagTiff({ tag: 274, type: 3, values: [1, 1] });
}

function emptyOrientationTiff(): Uint8Array {
  // The entry is present but promises zero values, so nothing can be read from
  // it; the count field is patched in place because the builder always writes
  // the real length.
  const bytes = orientationTagTiff({ tag: 274, type: 3, values: [1] });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint16(8, true);
  for (let i = 0; i < entryCount; i += 1) {
    const base = 8 + 2 + i * 12;
    if (view.getUint16(base, true) === 274) {
      view.setUint32(base + 4, 0, true);
      return bytes;
    }
  }
  throw new Error("internal fixture error: no Orientation entry found");
}

function oversizedDimensionTiff(): Uint8Array {
  const entries = standardTiffEntries({ width: 65535, height: 65535, bitsPerSample: 8 });
  return buildTiff("le", [{ entries, stripBytes: new Uint8Array(1) }]);
}

function oversizedDimensionPng(): Uint8Array {
  return buildPng({
    width: 65535,
    height: 65535,
    bitDepth: 8,
    colorType: 0,
    rawRows: [Uint8Array.of(0)],
  });
}

function gray8OnePixelPng(): Uint8Array {
  return buildPng({ width: 1, height: 1, bitDepth: 8, colorType: 0, rawRows: [Uint8Array.of(5)] });
}

function shortIhdrPng(): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return concatBytes([signature, pngChunk("IHDR", new Uint8Array(8)), pngChunk("IEND", Uint8Array.of())]);
}

function oversizedChunkLengthPng(): Uint8Array {
  const bytes = gray8OnePixelPng();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === "IDAT") {
      view.setUint32(offset, 0xffffffff, false);
      return bytes;
    }
    offset += 12 + view.getUint32(offset, false);
  }
  throw new Error("internal fixture error: no IDAT chunk found");
}

// ---------------------------------------------------------------------------
// TIFF: pixel roundtrips
// ---------------------------------------------------------------------------

test("S18a TIFF II little-endian uint8 values roundtrip exactly", async () => {
  const values = [0, 1, 2, 3, 127, 128, 254, 255];
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 4, height: 2, bitsPerSample: 8 }),
      stripBytes: encodeTiffStrip("le", 8, 1, values),
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "le uint8 tiff");
  assert.equal(image.width, 4);
  assert.equal(image.height, 2);
  assert.equal(image.dtype, "uint8");
  assert.equal(image.sourceFormat, "tiff");
  assert.equal(image.pageCount, 1);
  assert.equal(image.pageIndex, 0);
  assert.equal(image.channelCount, 1);
  assert.equal(image.falseColorRisk, false);
  assert.ok(image.pixels instanceof Uint8Array);
  assertPixels(image.pixels, values);
});

test("S18a TIFF MM big-endian uint16 values roundtrip exactly", async () => {
  const values = [0, 1, 255, 256, 512, 0x10ff, 0xabcd, 65534, 65535];
  const bytes = buildTiff("be", [
    {
      entries: standardTiffEntries({ width: 3, height: 3, bitsPerSample: 16 }),
      stripBytes: encodeTiffStrip("be", 16, 1, values),
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "be uint16 tiff");
  assert.equal(image.dtype, "uint16");
  assert.ok(image.pixels instanceof Uint16Array);
  assertPixels(image.pixels, values);
});

test("S18a TIFF little-endian uint32 values roundtrip exactly", async () => {
  const values = [0, 1, 0x12345678, 305419896, 4294967295];
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 5, height: 1, bitsPerSample: 32 }),
      stripBytes: encodeTiffStrip("le", 32, 1, values),
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "le uint32 tiff");
  assert.equal(image.dtype, "uint32");
  assert.ok(image.pixels instanceof Uint32Array);
  assertPixels(image.pixels, values);
});

test("S18a TIFF little-endian float32 values roundtrip exactly via Math.fround", async () => {
  const values = [0, 1.5, -2.25, 0.1, 3.141592653589793, 1e-6, 123456.789];
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 7, height: 1, bitsPerSample: 32, sampleFormat: 3 }),
      stripBytes: encodeTiffStrip("le", 32, 3, values),
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "le float32 tiff");
  assert.equal(image.dtype, "float32");
  assert.ok(image.pixels instanceof Float32Array);
  assertPixels(image.pixels, values, Math.fround);
});

test("S18a TIFF MM big-endian float32 values roundtrip exactly via Math.fround", async () => {
  const values = [0, 1.5, -2.25, 0.1, 3.141592653589793, 1e-6, 123456.789, -987.625];
  const bytes = buildTiff("be", [
    {
      entries: standardTiffEntries({ width: 8, height: 1, bitsPerSample: 32, sampleFormat: 3 }),
      stripBytes: encodeTiffStrip("be", 32, 3, values),
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "be float32 tiff");
  assert.equal(image.dtype, "float32");
  assert.ok(image.pixels instanceof Float32Array);
  assertPixels(image.pixels, values, Math.fround);
});

test("S18a TIFF multipage reports pageCount and blocks out-of-range pageIndex", async () => {
  const page0Values = [10, 20, 30, 40];
  const page1Values = [50, 60, 70, 80];
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 2, height: 2, bitsPerSample: 8 }),
      stripBytes: encodeTiffStrip("le", 8, 1, page0Values),
    },
    {
      entries: standardTiffEntries({ width: 2, height: 2, bitsPerSample: 8 }),
      stripBytes: encodeTiffStrip("le", 8, 1, page1Values),
    },
  ]);

  const first = requireDecoded(await decodeImageFile(bytes), "multipage first decode");
  assert.equal(first.pageCount, 2);
  assert.equal(first.pageIndex, 0);
  assertPixels(first.pixels, page0Values);

  const second = requireDecoded(await decodeImageFile(bytes, { pageIndex: 1 }), "multipage second decode");
  assert.equal(second.pageCount, 2);
  assert.equal(second.pageIndex, 1);
  assertPixels(second.pixels, page1Values);

  assertDecodeFails(await decodeImageFile(bytes, { pageIndex: 5 }), "out of range");
});

// ---------------------------------------------------------------------------
// TIFF: honest blocks for everything outside the supported subset
// ---------------------------------------------------------------------------

test("S18a TIFF blocks compressed data with a precise message", async () => {
  assertDecodeFails(await decodeImageFile(buildBlockTiff({ compression: 5 })), "compressed");
});

test("S18a TIFF blocks tiled layout with a precise message", async () => {
  assertDecodeFails(await decodeImageFile(buildBlockTiff({ tileWidth: 8 })), "tiled");
});

test("S18a TIFF blocks planar configuration 2 with a precise message", async () => {
  assertDecodeFails(await decodeImageFile(buildBlockTiff({ planar: 2 })), "planar");
});

test("S18a TIFF blocks palette-color data with a precise message", async () => {
  assertDecodeFails(await decodeImageFile(buildBlockTiff({ colorMap: true })), "palette");
});

test("S18a TIFF blocks non-grayscale photometric interpretation with a precise message", async () => {
  assertDecodeFails(await decodeImageFile(buildBlockTiff({ photometric: 2 })), "grayscale");
});

test("S18a TIFF blocks signed integer samples with a precise message", async () => {
  assertDecodeFails(await decodeImageFile(buildBlockTiff({ sampleFormat: 2 })), "signed");
});

test("S18a TIFF blocks unsupported bits per sample with a precise message", async () => {
  assertDecodeFails(await decodeImageFile(buildBlockTiff({ bitsPerSample: 12 })), "12-bit");
});

test("S18a TIFF blocks truncated strip data with a precise message", async () => {
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 2, height: 2, bitsPerSample: 8 }),
      stripBytes: new Uint8Array(4),
      stripByteCountsOverride: 2,
    },
  ]);
  assertDecodeFails(await decodeImageFile(bytes), "truncated");
});

// ---------------------------------------------------------------------------
// TIFF: tag semantics the decoder refuses to guess at (S20 stage D1)
//
// WhiteIsZero and a rotated/flipped Orientation both describe pixel data that
// would need a transform the decoder deliberately does not perform. Accepting
// them unchanged would invert every downstream reading or swap the axes, so
// both are blocked with a precise message instead.
// ---------------------------------------------------------------------------

test("S20d1 TIFF blocks WhiteIsZero images instead of decoding them inverted", async () => {
  const values = [0, 40, 200, 255];
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 2, height: 2, bitsPerSample: 8, photometric: 0 }),
      stripBytes: encodeTiffStrip("le", 8, 1, values),
    },
  ]);
  assertDecodeFails(await decodeImageFile(bytes), "WhiteIsZero", "BlackIsZero");
});

test("S20d1 TIFF still accepts an explicit BlackIsZero photometric interpretation", async () => {
  const values = [0, 40, 200, 255];
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 2, height: 2, bitsPerSample: 8, photometric: 1 }),
      stripBytes: encodeTiffStrip("le", 8, 1, values),
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "BlackIsZero tiff");
  assertPixels(image.pixels, values);
});

test("S20d1 TIFF blocks every non-identity Orientation and names the value", async () => {
  for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
    const result = await decodeImageFile(buildBlockTiff({ orientation }));
    assertDecodeFails(result, "orientation", String(orientation));
  }
});

test("S20d1 TIFF decodes Orientation 1 and an absent Orientation tag identically", async () => {
  const values = [10, 20, 30, 40, 50, 60];
  const build = (orientation?: number): Uint8Array =>
    buildTiff("le", [
      {
        entries: standardTiffEntries({ width: 3, height: 2, bitsPerSample: 8, orientation }),
        stripBytes: encodeTiffStrip("le", 8, 1, values),
      },
    ]);
  const tagged = requireDecoded(await decodeImageFile(build(1)), "orientation 1 tiff");
  const untagged = requireDecoded(await decodeImageFile(build()), "orientation-less tiff");
  assert.equal(tagged.width, 3);
  assert.equal(tagged.height, 2);
  assertPixels(tagged.pixels, values);
  assertPixels(untagged.pixels, values);
});

test("S20d1 TIFF rejects an Orientation tag carried with the wrong type", async () => {
  assertDecodeFails(await decodeImageFile(mistypedOrientationTiff()), "unexpected tag type 4 for tag 274", "Orientation");
});

test("S20d1 TIFF rejects an Orientation tag whose value count is not one", async () => {
  assertDecodeFails(await decodeImageFile(multiValueOrientationTiff()), "orientation", "exactly 1 value", "2");
  assertDecodeFails(await decodeImageFile(emptyOrientationTiff()), "orientation", "exactly 1 value", "0");
});

// ---------------------------------------------------------------------------
// TIFF: ImageDescription metadata passthrough
// ---------------------------------------------------------------------------

test("S18a TIFF ImageDescription is sanitized, NUL-terminated and capped", async () => {
  const prefix = "camera export metadata: ";
  let longBody = "";
  for (let i = 0; i < 5000; i += 1) {
    longBody += "q";
    if (i % 189 === 0) longBody += "\u0007";
    if (i % 337 === 0) longBody += "\u001f";
    if (i % 449 === 0) longBody += "\u007f";
  }
  const rawDescription = prefix + longBody + "\u0000text after the NUL must not appear";
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 1, height: 1, bitsPerSample: 8, description: rawDescription }),
      stripBytes: new Uint8Array(1),
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "long metadata");
  assert.equal(image.metadataTruncated, true);
  assert.ok(image.metadataText !== undefined, "metadata text must be present");
  assert.equal(image.metadataText.length, METADATA_CAP_CHARS);
  assert.ok(image.metadataText.startsWith(prefix), "metadata keeps its neutral prefix");
  assert.ok(!image.metadataText.includes("text after the NUL"), "reader must stop at the embedded NUL");
  assert.ok(!/[\u0000-\u001f\u007f]/.test(image.metadataText), "control characters must be stripped");

  const shortBytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 1, height: 1, bitsPerSample: 8, description: "camera export metadata" }),
      stripBytes: new Uint8Array(1),
    },
  ]);
  const short = requireDecoded(await decodeImageFile(shortBytes), "short metadata");
  assert.equal(short.metadataText, "camera export metadata");
  assert.equal(short.metadataTruncated, false);
});

// ---------------------------------------------------------------------------
// TIFF: multi-strip layout, strip padding and strip-table malformation
// ---------------------------------------------------------------------------

test("S18a TIFF honors RowsPerStrip across multiple out-of-line strip tables (2+2+1 rows)", async () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const strips = [
    { bytes: encodeTiffStrip("le", 8, 1, values.slice(0, 4)) },
    { bytes: encodeTiffStrip("le", 8, 1, values.slice(4, 8)) },
    { bytes: encodeTiffStrip("le", 8, 1, values.slice(8, 10)) },
  ];
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 2, height: 5, bitsPerSample: 8, rowsPerStrip: 2 }),
      strips,
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "multi-strip tiff");
  assert.equal(image.width, 2);
  assert.equal(image.height, 5);
  assert.equal(image.pageCount, 1);
  assertPixels(image.pixels, values);
});

test("S18a TIFF ignores surplus strip padding bytes", async () => {
  const values = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111];
  const padded = (payload: readonly number[]): Uint8Array => {
    const encoded = encodeTiffStrip("le", 8, 1, payload);
    const out = new Uint8Array(encoded.length + 4);
    out.set(encoded, 0);
    out.fill(0xee, encoded.length);
    return out;
  };
  const strips = [
    { bytes: padded(values.slice(0, 4)) },
    { bytes: padded(values.slice(4, 8)) },
    { bytes: padded(values.slice(8, 10)) },
  ];
  const bytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 2, height: 5, bitsPerSample: 8, rowsPerStrip: 2 }),
      strips,
    },
  ]);
  const image = requireDecoded(await decodeImageFile(bytes), "padded multi-strip tiff");
  assertPixels(image.pixels, values);
});

test("S18a TIFF rejects mismatched strip offset/count tables without throwing", async () => {
  const bytes = mismatchedStripTableTiff();
  const result = await decodeImageFile(bytes);
  assertDecodeFails(result, "strip table mismatch");
});

test("S18a TIFF rejects a truncated IFD without throwing", async () => {
  const result = await decodeImageFile(truncatedIfdTiff());
  assertDecodeFails(result, "truncated");
});

test("S18a TIFF rejects an oversized tag value count quickly and without throwing", async () => {
  const started = Date.now();
  const result = await decodeImageFile(oversizedTagTiff());
  const elapsed = Date.now() - started;
  assertDecodeFails(result, "oversized");
  assert.ok(elapsed < 1000, `oversized-tag rejection must stay fast (took ${elapsed} ms)`);
});

test("S18a TIFF rejects images above the pixel cap before allocating", async () => {
  const result = await decodeImageFile(oversizedDimensionTiff());
  assertDecodeFails(result, "pixel cap", "65535");
});

// ---------------------------------------------------------------------------
// PNG: pixel roundtrips
// ---------------------------------------------------------------------------

test("S18a PNG grayscale 8-bit values roundtrip exactly", async () => {
  const values = [0, 1, 2, 127, 128, 254, 255, 3, 4];
  const bytes = buildPng({ width: 3, height: 3, bitDepth: 8, colorType: 0, rawRows: rowsFrom(3, values) });
  const image = requireDecoded(await decodeImageFile(bytes), "png gray8");
  assert.equal(image.width, 3);
  assert.equal(image.height, 3);
  assert.equal(image.dtype, "uint8");
  assert.equal(image.sourceFormat, "png");
  assert.equal(image.channelCount, 1);
  assert.equal(image.falseColorRisk, false);
  assert.ok(image.pixels instanceof Uint8Array);
  assertPixels(image.pixels, values);
});

test("S18a PNG grayscale 16-bit values above 255 roundtrip exactly", async () => {
  const values = [0, 256, 1024, 32768, 50000, 65534, 65535, 1, 512];
  const bytes = buildPng({ width: 3, height: 3, bitDepth: 16, colorType: 0, rawRows: rowsFromBe16(3, values) });
  const image = requireDecoded(await decodeImageFile(bytes), "png gray16");
  assert.equal(image.dtype, "uint16");
  assert.ok(image.pixels instanceof Uint16Array);
  assertPixels(image.pixels, values);
});

test("S18a PNG unfiltering reconstructs Sub- and Up-filtered scanlines", async () => {
  const rawRows = [
    Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80]),
    Uint8Array.from([15, 36, 58, 81, 105, 130, 156, 183]),
    Uint8Array.from([25, 56, 88, 121, 155, 190, 226, 7]),
    Uint8Array.from([255, 254, 253, 252, 251, 250, 249, 248]),
  ];
  const bytes = buildPng({
    width: 8,
    height: 4,
    bitDepth: 8,
    colorType: 0,
    filters: [0, 1, 2, 0],
    rawRows,
  });
  const image = requireDecoded(await decodeImageFile(bytes), "png unfilter");
  assertPixels(image.pixels, Array.from(concatBytes(rawRows)));
});

test("S18a PNG unfiltering reconstructs every filter type (Average and Paeth included) on gray8", async () => {
  const rawRows = [
    Uint8Array.from([10, 20, 30, 40, 50]),
    Uint8Array.from([15, 36, 58, 81, 105]),
    Uint8Array.from([25, 56, 88, 121, 155]),
    Uint8Array.from([255, 254, 253, 252, 251]),
    Uint8Array.from([3, 7, 200, 90, 17]),
  ];
  const bytes = buildPng({
    width: 5,
    height: 5,
    bitDepth: 8,
    colorType: 0,
    filters: [0, 1, 2, 4, 3],
    rawRows,
  });
  const image = requireDecoded(await decodeImageFile(bytes), "png all filters gray8");
  assertPixels(image.pixels, Array.from(concatBytes(rawRows)));
});

test("S18a PNG unfiltering handles Average and Paeth with 2-byte pixels on gray16", async () => {
  const values = [
    0, 256, 1024, 32768, 50000, 65534, 65535, 1, 512, 4096, 12000, 11, 222, 3333, 44444, 100, 200, 300, 400, 500,
    600, 700, 800, 900, 65500,
  ];
  const rawRows = rowsFromBe16(5, values);
  const bytes = buildPng({
    width: 5,
    height: 5,
    bitDepth: 16,
    colorType: 0,
    filters: [0, 1, 2, 4, 3],
    rawRows,
  });
  const image = requireDecoded(await decodeImageFile(bytes), "png all filters gray16");
  assert.equal(image.dtype, "uint16");
  assertPixels(image.pixels, values);
});

// ---------------------------------------------------------------------------
// PNG: color images and channel handling
// ---------------------------------------------------------------------------

test("S18a PNG RGB requires an explicit channel and extracts the green plane", async () => {
  const row0 = Uint8Array.from([200, 10, 100, 210, 20, 110, 220, 30, 120]);
  const row1 = Uint8Array.from([5, 6, 7, 15, 16, 17, 25, 26, 27]);
  const bytes = buildPng({ width: 3, height: 2, bitDepth: 8, colorType: 2, rawRows: [row0, row1] });

  assertDecodeFails(await decodeImageFile(bytes), "explicit channel");

  const image = requireDecoded(await decodeImageFile(bytes, { channel: "g" }), "png rgb green plane");
  assert.equal(image.dtype, "uint8");
  assert.equal(image.channelCount, 3);
  assert.equal(image.channel, "g");
  assert.equal(image.falseColorRisk, true);
  assertPixels(image.pixels, [10, 20, 30, 6, 16, 26]);
});

test("S18a PNG RGBA extracts the alpha plane", async () => {
  const row0 = Uint8Array.from([10, 11, 12, 1, 20, 21, 22, 2, 30, 31, 32, 3]);
  const row1 = Uint8Array.from([40, 41, 42, 4, 50, 51, 52, 5, 60, 61, 62, 6]);
  const bytes = buildPng({ width: 3, height: 2, bitDepth: 8, colorType: 6, rawRows: [row0, row1] });
  const image = requireDecoded(await decodeImageFile(bytes, { channel: "a" }), "png rgba alpha plane");
  assert.equal(image.channelCount, 4);
  assert.equal(image.channel, "a");
  assert.equal(image.falseColorRisk, true);
  assertPixels(image.pixels, [1, 2, 3, 4, 5, 6]);
});

test("S18a PNG rejects an alpha channel request for RGB without alpha", async () => {
  const bytes = buildPng({ width: 1, height: 1, bitDepth: 8, colorType: 2, rawRows: [Uint8Array.of(9, 8, 7)] });
  assertDecodeFails(await decodeImageFile(bytes, { channel: "a" }), "no alpha");
});

test("S18a PNG rejects unknown channel values from runtime input", async () => {
  const bytes = gray8OnePixelPng();
  assertDecodeFails(await decodeImageFile(bytes, { channel: "z" as unknown as ImageChannel }), "unknown channel");
  assertDecodeFails(await decodeImageFile(bytes, { channel: "" as unknown as ImageChannel }), "unknown channel");
});

// ---------------------------------------------------------------------------
// PNG: honest blocks for everything outside the supported subset
// ---------------------------------------------------------------------------

test("S18a PNG blocks Adam7 interlace with a precise message", async () => {
  const bytes = buildPng({
    width: 2,
    height: 1,
    bitDepth: 8,
    colorType: 0,
    interlace: 1,
    rawRows: [Uint8Array.of(0, 0)],
  });
  assertDecodeFails(await decodeImageFile(bytes), "Adam7");
});

test("S18a PNG blocks palette images with a precise message", async () => {
  const bytes = buildPng({ width: 2, height: 1, bitDepth: 8, colorType: 3, rawRows: [Uint8Array.of(0, 0)] });
  assertDecodeFails(await decodeImageFile(bytes), "palette");
});

test("S18a PNG blocks grayscale+alpha images with a precise message", async () => {
  const bytes = buildPng({ width: 2, height: 1, bitDepth: 8, colorType: 4, rawRows: [Uint8Array.of(0, 0, 0, 0)] });
  assertDecodeFails(await decodeImageFile(bytes), "grayscale+alpha");
});

test("S18a PNG blocks 16-bit RGB with a precise message", async () => {
  const bytes = buildPng({
    width: 1,
    height: 1,
    bitDepth: 16,
    colorType: 2,
    rawRows: [Uint8Array.of(0, 0, 0, 0, 0, 0)],
  });
  assertDecodeFails(await decodeImageFile(bytes), "8 bit");
});

test("S18a PNG blocks tRNS transparency with a precise message", async () => {
  const bytes = buildPng({ width: 1, height: 1, bitDepth: 8, colorType: 0, hasTrns: true, rawRows: [Uint8Array.of(1)] });
  assertDecodeFails(await decodeImageFile(bytes), "tRNS");
});

test("S18a PNG blocks a too-short IHDR chunk without throwing", async () => {
  const result = await decodeImageFile(shortIhdrPng());
  assertDecodeFails(result, "IHDR", "short");
});

test("S18a PNG blocks a chunk whose length runs past end of file without throwing", async () => {
  const result = await decodeImageFile(oversizedChunkLengthPng());
  assertDecodeFails(result, "truncated");
});

test("S18a PNG rejects images above the pixel cap before inflating", async () => {
  const result = await decodeImageFile(oversizedDimensionPng());
  assertDecodeFails(result, "pixel cap", "65535");
});

// ---------------------------------------------------------------------------
// Signature dispatch and defensive copies
// ---------------------------------------------------------------------------

test("S18a unknown file signatures are rejected as unsupported", async () => {
  const bytes = Uint8Array.from([0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12]);
  assertDecodeFails(await decodeImageFile(bytes), "unsupported file");
});

test("S18a decode results are fresh copies that never mutate the input bytes", async () => {
  const tiffValues = [1, 2, 3, 4];
  const tiffBytes = buildTiff("le", [
    {
      entries: standardTiffEntries({ width: 2, height: 2, bitsPerSample: 8 }),
      stripBytes: encodeTiffStrip("le", 8, 1, tiffValues),
    },
  ]);
  const tiffBefore = new Uint8Array(tiffBytes);
  const tiffFirst = requireDecoded(await decodeImageFile(tiffBytes), "tiff first decode");
  assert.deepEqual(tiffBytes, tiffBefore, "tiff input bytes unchanged by the first decode");
  tiffFirst.pixels.fill(99);
  const tiffSecond = requireDecoded(await decodeImageFile(tiffBytes), "tiff second decode");
  assertPixels(tiffSecond.pixels, tiffValues);
  assert.deepEqual(tiffBytes, tiffBefore, "tiff input bytes unchanged by the second decode");

  const pngValues = [7, 8, 9, 10];
  const pngBytes = buildPng({ width: 2, height: 2, bitDepth: 8, colorType: 0, rawRows: rowsFrom(2, pngValues) });
  const pngBefore = new Uint8Array(pngBytes);
  const pngFirst = requireDecoded(await decodeImageFile(pngBytes), "png first decode");
  assert.deepEqual(pngBytes, pngBefore, "png input bytes unchanged by the first decode");
  pngFirst.pixels.fill(88);
  const pngSecond = requireDecoded(await decodeImageFile(pngBytes), "png second decode");
  assertPixels(pngSecond.pixels, pngValues);
  assert.deepEqual(pngBytes, pngBefore, "png input bytes unchanged by the second decode");
});

// ---------------------------------------------------------------------------
// Guard: every malformed fixture resolves to ok:false, never a rejection
// ---------------------------------------------------------------------------

test("S18a every malformed fixture resolves with ok:false and never rejects", async () => {
  const malformedFixtures: { name: string; call: () => Promise<DecodeResult> }[] = [
    { name: "strip table mismatch", call: () => decodeImageFile(mismatchedStripTableTiff()) },
    { name: "truncated IFD", call: () => decodeImageFile(truncatedIfdTiff()) },
    { name: "oversized tag value count", call: () => decodeImageFile(oversizedTagTiff()) },
    { name: "mistyped orientation tag", call: () => decodeImageFile(mistypedOrientationTiff()) },
    { name: "multi-value orientation tag", call: () => decodeImageFile(multiValueOrientationTiff()) },
    { name: "empty orientation tag", call: () => decodeImageFile(emptyOrientationTiff()) },
    { name: "tiff dimension cap", call: () => decodeImageFile(oversizedDimensionTiff()) },
    { name: "png dimension cap", call: () => decodeImageFile(oversizedDimensionPng()) },
    { name: "unknown channel z", call: () => decodeImageFile(gray8OnePixelPng(), { channel: "z" as unknown as ImageChannel }) },
    { name: "unknown empty channel", call: () => decodeImageFile(gray8OnePixelPng(), { channel: "" as unknown as ImageChannel }) },
    { name: "short IHDR", call: () => decodeImageFile(shortIhdrPng()) },
    { name: "chunk length past EOF", call: () => decodeImageFile(oversizedChunkLengthPng()) },
  ];
  for (const fixture of malformedFixtures) {
    const result = await fixture.call().catch((error: unknown): never => {
      assert.fail(
        `${fixture.name} must resolve instead of rejecting (rejected with ${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    });
    assert.equal(result.ok, false, `${fixture.name} must report ok:false`);
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0, `${fixture.name} must carry an error message`);
  }
});
