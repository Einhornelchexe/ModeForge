import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { executeImageDecodeJob, executeImageJob, isImageWorkerGlobalScope, runImageWorkerRequest } from "../../apps/web/src/image-worker.ts";

function tinyImage() {
  const width = 4;
  const height = 4;
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = i * 16;
  return { pixels, width, height, dtype: "uint8" as const };
}

test("executeImageJob runs a valid analysis and returns the raw render copy", () => {
  const image = tinyImage();
  const job = executeImageJob({ image });
  assert.equal(job.ok, true);
  if (job.ok) {
    assert.equal(job.result.warnings, job.warnings);
    assert.deepEqual(job.errors, []);
  }
  assert.equal(job.render.kind, "raw");
  assert.equal(job.render.pixels.length, image.width * image.height);
  assert.deepEqual(Array.from(job.render.pixels), Array.from(image.pixels));
});

test("render copy is a fresh Float32Array and is not affected by later input mutation", () => {
  const image = tinyImage();
  const job = executeImageJob({ image });
  const before = Array.from(job.render.pixels);
  image.pixels[0] = 255;
  assert.notDeepEqual(Array.from(job.render.pixels), Array.from(image.pixels));
  assert.deepEqual(Array.from(job.render.pixels), before);
  assert.ok(job.render.pixels instanceof Float32Array);
});

test("validation failure returns ok:false with errors and still provides the raw render", () => {
  const image = {
    pixels: new Float32Array(16),
    width: 4,
    height: 4,
    dtype: "uint8" as const,
  };
  const job = executeImageJob({ image });
  assert.equal(job.ok, false);
  if (!job.ok) assert.ok(job.errors.length > 0);
  assert.equal(job.render.kind, "raw");
  assert.equal(job.render.pixels.length, 16);
});

test("non-finite float pixels surface as an IMAGE_FLOAT_SPECIALS warning", () => {
  const pixels = new Float32Array(16);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = i + 1;
  pixels[5] = Number.NaN;
  const job = executeImageJob({
    image: { pixels, width: 4, height: 4, dtype: "float32" },
  });
  assert.equal(job.ok, true);
  assert.ok(job.warnings.some((item) => item.code === "IMAGE_FLOAT_SPECIALS"));
  assert.equal(job.render.kind, "raw");
});

test("every result carries the documented v1 render kind and pixel count", () => {
  const image = tinyImage();
  const job = executeImageJob({ image, render: { kind: "raw" } });
  assert.equal(job.render.kind, "raw");
  assert.equal(job.render.pixels.length, image.pixels.length);
  assert.ok(job.render.pixels.every((value) => Number.isFinite(value)));
});

test("module import under Node skips the worker envelope (importScripts is not a function)", () => {
  // This test file imports image-worker.ts at the top; had the envelope
  // been installed unguarded at module scope, the import itself would have
  // thrown before any test ran. Dedicated workers expose importScripts;
  // a browser window does not, so the envelope must not key off `self`.
  assert.equal(typeof (globalThis as { importScripts?: unknown }).importScripts, "undefined");
  assert.equal(isImageWorkerGlobalScope(globalThis), false);
  assert.equal(isImageWorkerGlobalScope({}), false);
  assert.equal(isImageWorkerGlobalScope({ importScripts: () => undefined }), true);
});

test("decode op answers garbage bytes with ok:false and an honest message, never a throw", async () => {
  const result = await executeImageDecodeJob({
    fileBytes: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]).buffer,
    fileName: "garbage.tif",
  });
  assert.equal(result.op, "decode");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.length > 0);
    assert.match(result.errors[0], /unsupported file/);
  }
});

test("pure dispatcher correlates requestId and op for both analyze and decode", async () => {
  const analyzeResponse = await runImageWorkerRequest({ requestId: 123, job: { image: tinyImage() } });
  assert.equal(analyzeResponse.type, "done");
  if (analyzeResponse.type === "done") {
    assert.equal(analyzeResponse.requestId, 123);
    assert.equal(analyzeResponse.result.op, "analyze");
    assert.equal(analyzeResponse.result.ok, true);
  }

  const decodeResponse = await runImageWorkerRequest({
    requestId: 77,
    job: { op: "decode", fileBytes: new Uint8Array([1, 2, 3, 4]).buffer, fileName: "x.bin" },
  });
  assert.equal(decodeResponse.type, "done");
  if (decodeResponse.type === "done") {
    assert.equal(decodeResponse.requestId, 77);
    assert.equal(decodeResponse.result.op, "decode");
    assert.equal(decodeResponse.result.ok, false);
  }
});

test("S18a executeImageJob with null pixels returns ok:false and never throws", () => {
  const job = executeImageJob({
    image: { pixels: null, width: 4, height: 4, dtype: "float32" } as unknown as ReturnType<typeof tinyImage>,
  });
  assert.equal(job.ok, false);
  if (!job.ok) assert.ok(job.errors.length > 0);
  assert.equal(job.render.kind, "raw");
  assert.ok(job.render.pixels instanceof Float32Array);
});

test("S18a unknown worker op is reported as an error instead of silent analyze", async () => {
  const response = await runImageWorkerRequest({
    requestId: 9,
    job: { op: "export", image: tinyImage() } as never,
  });
  assert.equal(response.type, "error");
  if (response.type === "error") {
    assert.equal(response.requestId, 9);
    assert.match(response.message, /unknown image worker op export/);
  }
});

test("S18a decode op roundtrips a 2x2 grayscale PNG and the result is structured-cloneable", async () => {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 2, false);
  ihdrView.setUint32(4, 2, false);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Uint8Array.from([0, 10, 20, 0, 30, 40]);
  const idat = deflateSync(raw);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out;
  };
  const concat = (parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((n, part) => n + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  const png = concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
  const fileBytes = new ArrayBuffer(png.byteLength);
  new Uint8Array(fileBytes).set(png);

  const decoded = await executeImageDecodeJob({ fileBytes, fileName: "tiny.png" });
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.result.width, 2);
    assert.equal(decoded.result.height, 2);
    assert.deepEqual(Array.from(decoded.result.pixels), [10, 20, 30, 40]);
    const clone = structuredClone(decoded);
    assert.deepEqual(Array.from(clone.result.pixels), [10, 20, 30, 40]);
  }

  const analyze = executeImageJob({ image: tinyImage() });
  const clonedAnalyze = structuredClone(analyze);
  assert.equal(clonedAnalyze.ok, analyze.ok);
  assert.deepEqual(Array.from(clonedAnalyze.render.pixels), Array.from(analyze.render.pixels));
});
