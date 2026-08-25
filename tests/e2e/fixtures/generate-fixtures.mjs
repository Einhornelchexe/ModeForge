// Deterministic fixture generator for the analyzer E2E suite (S18f).
//
// Writes small, uncompressed grayscale 16-bit TIFF files into this directory,
// matching exactly the little-endian classic-TIFF subset the repo decoder
// supports (packages/image/src/decode.ts): single strip, Compression=1,
// PhotometricInterpretation=1 (BlackIsZero), BitsPerSample=16,
// SamplesPerPixel=1, RowsPerStrip=height, minimal 9-tag IFD.
//
// Plain ESM with node builtins only (no dependencies). Playwright's
// globalSetup spawns this script on demand (`node generate-fixtures.mjs`),
// so no binary is ever committed.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = fileURLToPath(new URL(".", import.meta.url));

const TAGS = {
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
};

// Classic TIFF header (8 bytes) + IFD (2-byte count, 9 entries x 12 bytes,
// 4-byte next-IFD offset) + single strip of raw little-endian uint16 pixels.
function writeGray16Tiff(fileName, width, height, pixelAt) {
  const valueCount = width * height;
  const stripOffset = 8 + (2 + 9 * 12 + 4);
  const byteCount = valueCount * 2;
  const file = Buffer.alloc(stripOffset + byteCount);

  file.write("II", 0, "ascii"); // little-endian byte order
  file.writeUInt16LE(42, 2); // classic TIFF magic number
  file.writeUInt32LE(8, 4); // first IFD offset

  file.writeUInt16LE(9, 8); // IFD entry count
  let p = 10;
  const entry = (tag, type, value) => {
    file.writeUInt16LE(tag, p);
    file.writeUInt16LE(type, p + 2);
    file.writeUInt32LE(1, p + 4); // count = 1, value stored inline
    if (type === 3) file.writeUInt16LE(value & 0xffff, p + 8);
    else file.writeUInt32LE(value >>> 0, p + 8);
    p += 12;
  };
  entry(TAGS.imageWidth, 3, width);
  entry(TAGS.imageLength, 3, height);
  entry(TAGS.bitsPerSample, 3, 16);
  entry(TAGS.compression, 3, 1); // uncompressed
  entry(TAGS.photometric, 3, 1); // BlackIsZero grayscale
  entry(TAGS.stripOffsets, 4, stripOffset);
  entry(TAGS.samplesPerPixel, 3, 1);
  entry(TAGS.rowsPerStrip, 3, height); // single strip holds every row
  entry(TAGS.stripByteCounts, 4, byteCount);
  file.writeUInt32LE(0, p); // no next IFD

  for (let i = 0; i < valueCount; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    const value = Math.max(0, Math.min(65535, Math.round(pixelAt(x, y))));
    file.writeUInt16LE(value, stripOffset + i * 2);
  }

  writeFileSync(join(FIXTURES_DIR, fileName), file);
}

function gaussianCounts(x, y, cx, cy, sigmaX, sigmaY, amplitude, background) {
  const dx = (x - cx) / sigmaX;
  const dy = (y - cy) / sigmaY;
  return background + amplitude * Math.exp(-0.5 * (dx * dx + dy * dy));
}

// Ramp scene for the robust-plane E2E test (S18e-C part B): the beam sits on
// a perfectly planar background (600 counts at x=0, +8 counts per x pixel, no
// noise). The four corner rectangles sample only the ramp, the robust-plane
// fit recovers the gradient, and subtracting it leaves the centred Gaussian.
function rampPixelAt(x, y) {
  return 600 + 8 * x + gaussianCounts(x, y, 31.5, 23.5, 3.5, 2.5, 20000, 0);
}

function generateAll() {
  mkdirSync(FIXTURES_DIR, { recursive: true });

  // Released scene: centered elliptical Gaussian. The 6-sigma check ellipse
  // needs >= 12*sigmaMajor+1 px inside the frame (CW-01 lesson), so sigma
  // 3.5 x 2.5 on 64x48 releases with margin (~20k
  // counts) over a flat ~800-count background with zero noise.
  writeGray16Tiff("gauss_released.tif", 64, 48, (x, y) => gaussianCounts(x, y, 31.5, 23.5, 3.5, 2.5, 20000, 800));

  // Suppressed scene: two equal Gaussian lobes (sigma 4 px, separated 24 px,
  // ~20k counts each) over the same background - stage B suppresses it.
  writeGray16Tiff("two_lobe_suppressed.tif", 64, 48, (x, y) =>
    gaussianCounts(x, y, 20, 23.5, 4, 4, 20000, 800) + gaussianCounts(x, y, 44, 23.5, 4, 4, 20000, 800),
  );

  // Ramp scene: the beam plus a linear background ramp (no noise).
  writeGray16Tiff("ramp_background.tif", 64, 48, rampPixelAt);

  // Matching uint16 dark frame for gauss_released.tif (S20 stage C): same
  // 64x48 geometry, photometric 1, flat low counts. A wrong-size sibling
  // drives the dimensions darkError path in the analyzer E2E suite.
  writeGray16Tiff("dark_flat.tif", 64, 48, () => 100);
  // This matching pedestal removes gauss_released.tif's complete 800-count
  // background, so the dark-frame analysis has distinguishable symmetry
  // values from the method-none run.
  writeGray16Tiff("dark_pedestal.tif", 64, 48, () => 800);
  writeGray16Tiff("dark_small.tif", 16, 12, () => 100);

  // Flat zero noise scene: constant background (500) + Gaussian beam.
  writeGray16Tiff("flat_zero_noise.tif", 64, 48, (x, y) => gaussianCounts(x, y, 31.5, 23.5, 3.5, 2.5, 20000, 500));

  console.log(`[fixtures] wrote gauss_released.tif + two_lobe_suppressed.tif + ramp_background.tif + dark_flat.tif + dark_pedestal.tif + dark_small.tif + flat_zero_noise.tif -> ${FIXTURES_DIR}`);
}

generateAll();
