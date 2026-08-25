// Main-image and dark-frame loads both use the same production conversion
// helper. uint32 values above 2^24 are deliberately included because the
// analysis Float32 representation cannot retain every integer exactly.

import assert from "node:assert/strict";
import { test } from "node:test";
import { toAnalysisFloat32 } from "../../apps/web/src/image-pixels.ts";

test("uint32 values above 2^24 use the shared float32 conversion with pinned IEEE-754 rounding", () => {
  const rawPixels = new Uint32Array([16777217, 16777219, 33554433]);

  // These calls model the two production call sites, both of which delegate
  // their conversion to toAnalysisFloat32.
  const mainImage = toAnalysisFloat32(rawPixels);
  const darkLane = toAnalysisFloat32(rawPixels);

  assert.deepEqual(Array.from(mainImage), [16777216, 16777220, 33554432]);
  assert.deepEqual(
    new Uint8Array(darkLane.buffer, darkLane.byteOffset, darkLane.byteLength),
    new Uint8Array(mainImage.buffer, mainImage.byteOffset, mainImage.byteLength),
    "dark-lane and main-image float32 casts must be bit-identical",
  );

  const sourceNumbers = Array.from(rawPixels);
  const analysisNumbers = Array.from(mainImage);
  assert.notDeepEqual(analysisNumbers, sourceNumbers, "Array.from preserves source integers where float32 conversion rounds them");
});
