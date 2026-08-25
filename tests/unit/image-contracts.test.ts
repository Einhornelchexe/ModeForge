import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeMetadataText,
  validateImageAnalyzerInput,
} from "../../packages/image/src/contracts.ts";

function validInput(
  pixels: number[],
  dtype: "uint8" | "uint16" | "uint32" | "float32" = "uint8",
) {
  return { pixels, width: 2, height: 2, dtype };
}

test("S18a FIX 1: every typed-array/dtype mismatch is rejected with a clear message", () => {
  const width = 2;
  const height = 2;
  const count = width * height;
  const cases: ReadonlyArray<{
    dtype: "uint8" | "uint16" | "uint32" | "float32";
    pixels: Uint8Array | Uint16Array | Uint32Array | Float32Array;
  }> = [
    { dtype: "uint8", pixels: new Float32Array(count) },
    { dtype: "uint8", pixels: new Uint16Array(count) },
    { dtype: "uint8", pixels: new Uint32Array(count) },
    { dtype: "uint16", pixels: new Uint8Array(count) },
    { dtype: "uint16", pixels: new Float32Array(count) },
    { dtype: "uint16", pixels: new Uint32Array(count) },
    { dtype: "uint32", pixels: new Uint8Array(count) },
    { dtype: "uint32", pixels: new Uint16Array(count) },
    { dtype: "uint32", pixels: new Float32Array(count) },
    { dtype: "float32", pixels: new Uint8Array(count) },
    { dtype: "float32", pixels: new Uint16Array(count) },
    { dtype: "float32", pixels: new Uint32Array(count) },
  ];
  for (const { dtype, pixels } of cases) {
    const result = validateImageAnalyzerInput({ pixels, width, height, dtype });
    assert.equal(result.ok, false, `${dtype} with ${pixels.constructor.name} must be rejected`);
    assert.ok(
      result.errors.some((message) => message.includes("does not match dtype")),
      `errors ${JSON.stringify(result.errors)} must mention the dtype mismatch`,
    );
  }
});

test("S18a FIX 1: every matching typed array and plain number[] are accepted", () => {
  const width = 2;
  const height = 2;
  const count = width * height;
  const matches: ReadonlyArray<{
    dtype: "uint8" | "uint16" | "uint32" | "float32";
    pixels: Uint8Array | Uint16Array | Uint32Array | Float32Array;
  }> = [
    { dtype: "uint8", pixels: new Uint8Array(count) },
    { dtype: "uint16", pixels: new Uint16Array(count) },
    { dtype: "uint32", pixels: new Uint32Array(count) },
    { dtype: "float32", pixels: new Float32Array(count) },
  ];
  for (const { dtype, pixels } of matches) {
    const result = validateImageAnalyzerInput({ pixels, width, height, dtype });
    assert.equal(result.ok, true, result.errors.join("; "));
  }
  // Plain number[] stays allowed for every dtype (existing lanes rely on it).
  for (const dtype of ["uint8", "uint16", "uint32", "float32"] as const) {
    const result = validateImageAnalyzerInput(validInput(new Array<number>(count).fill(0), dtype));
    assert.equal(result.ok, true, `${dtype} with number[] must be accepted: ${result.errors.join("; ")}`);
  }
});

test("S18a FIX 2: the metadata cap never leaves a dangling high surrogate", () => {
  const raw = "a".repeat(4095) + "😀";
  // 4095 ASCII chars + one 2-code-unit emoji = 4097 code units; the former
  // UTF-16 slice kept 4095 a's plus the lone high surrogate of the emoji.
  const result = sanitizeMetadataText(raw, 4096);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 4096);
  assert.equal(result.text.length, 4095);
  assert.equal(result.text[result.text.length - 1], "a");
  const lastCode = result.text.charCodeAt(result.text.length - 1);
  assert.ok(!(lastCode >= 0xd800 && lastCode <= 0xdbff), `lone high surrogate 0x${lastCode.toString(16)}`);
});

test("S18a FIX 2: a complete surrogate pair that fits the cap is kept intact", () => {
  const raw = "a".repeat(4094) + "😀";
  const result = sanitizeMetadataText(raw, 4096);
  assert.equal(result.truncated, false);
  assert.equal(result.text, raw);
  assert.equal(result.text.length, 4096);
});
