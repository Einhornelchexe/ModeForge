// Web Worker for the CPU-heavy image-analysis jobs (S18e-B): keeps the UI
// thread responsive while analyzeImage and the image decode op run. Physics
// and file decoding stay behind packages/api — this file only forwards
// inputs and results and builds the render snapshot the UI needs.

import {
  decodeImageFile,
  runHeadlessJob,
  type DecodedImage,
  type ImageAnalysisInput,
  type ImageAnalysisResult,
  type SimulationWarning,
} from "../../../packages/api/src/index.ts";

// v1 render simplification: the UI renders the raw, unprocessed pixels as a
// Float32 copy. `renderKind: "raw"` is the only supported render today.
export type ImageRenderKind = "raw";

export type ImageJobInput = {
  image: ImageAnalysisInput;
  render?: { kind: ImageRenderKind };
};

export type ImageJobResult =
  | {
      op: "analyze";
      ok: true;
      result: ImageAnalysisResult;
      warnings: SimulationWarning[];
      errors: [];
      render: { kind: "raw"; pixels: Float32Array };
    }
  | {
      op: "analyze";
      ok: false;
      result?: undefined;
      warnings: [];
      errors: string[];
      render: { kind: "raw"; pixels: Float32Array };
    };

// Channel selection for the decode op of RGB(A) sources. Uses the same
// r/g/b/a values as the API's channel contract so it passes straight through
// structurally; apps/web never imports the physics package directly.
export type ImageDecodeChannel = "r" | "g" | "b" | "a";

export type ImageDecodeJobInput = {
  fileBytes: ArrayBuffer;
  fileName: string;
  pageIndex?: number;
  channel?: ImageDecodeChannel;
};

export type ImageWorkerJobInput =
  | (ImageJobInput & { op?: "analyze" })
  | (ImageDecodeJobInput & { op: "decode" });

export type ImageDecodeJobResult =
  | { op: "decode"; ok: true; result: DecodedImage; errors: [] }
  | { op: "decode"; ok: false; result?: undefined; errors: string[] };

export type ImageWorkerRequestResult = ImageJobResult | ImageDecodeJobResult;

export type ImageWorkerRequest = {
  requestId: number;
  job: ImageWorkerJobInput;
};

export type ImageWorkerResponse =
  | { type: "done"; requestId: number; result: ImageWorkerRequestResult }
  | { type: "error"; requestId: number; message: string };

export function isImageWorkerGlobalScope(scope: unknown): boolean {
  return typeof (scope as { importScripts?: unknown } | null | undefined)?.importScripts === "function";
}

function copyRenderPixels(pixels: unknown): Float32Array {
  if (pixels == null) return new Float32Array(0);
  try {
    return Float32Array.from(pixels as ArrayLike<number>);
  } catch {
    return new Float32Array(0);
  }
}

// Pure, synchronous core: runs the headless image-analysis job through
// packages/api and attaches the v1 raw render copy. Never throws — the API
// returns ValidationResult and the render copy is always constructible from
// the input pixel array (or an empty Float32Array when pixels are absent).
export function executeImageJob(job: ImageJobInput): ImageJobResult {
  const render = { kind: "raw" as const, pixels: copyRenderPixels(job.image?.pixels) };
  const run = runHeadlessJob({ kind: "image-analysis", input: job.image });
  if (!run.ok) return { op: "analyze", ok: false, errors: run.errors, warnings: [], render };
  if (run.value.kind !== "image-analysis") {
    return { op: "analyze", ok: false, errors: ["unexpected headless job result kind"], warnings: [], render };
  }
  return { op: "analyze", ok: true, result: run.value.result, warnings: run.value.warnings, errors: [], render };
}

// Pure, async core for the decode op: wraps the API decoder and never throws.
// The decoder answers malformed bytes with ok:false already; the catch is the
// final defense-in-depth guard for unexpected exceptions.
export async function executeImageDecodeJob(job: ImageDecodeJobInput): Promise<ImageDecodeJobResult> {
  try {
    const decoded = await decodeImageFile(job.fileBytes, { pageIndex: job.pageIndex, channel: job.channel });
    if (!decoded.ok) return { op: "decode", ok: false, errors: decoded.errors };
    return { op: "decode", ok: true, result: decoded.value, errors: [] };
  } catch (error) {
    return { op: "decode", ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

// Pure request dispatcher: requestId correlation plus both ops. The worker
// envelope below AND the main-thread fallback both go through here, so the
// requestId correlation logic is testable without a real Worker.
export async function runImageWorkerRequest(request: ImageWorkerRequest): Promise<ImageWorkerResponse> {
  const { requestId, job } = request;
  try {
    if (job.op === "decode") {
      const result = await executeImageDecodeJob(job);
      return { type: "done", requestId, result };
    }
    const op = (job as { op?: string }).op;
    if (op !== undefined && op !== "analyze") {
      return { type: "error", requestId, message: `unknown image worker op ${op}` };
    }
    return { type: "done", requestId, result: executeImageJob(job as ImageJobInput) };
  } catch (error) {
    return { type: "error", requestId, message: error instanceof Error ? error.message : String(error) };
  }
}

// Worker envelope, guarded so the module also imports safely under Node
// and under a browser window. `typeof self !== "undefined"` is true on the
// window, so installing onmessage there would steal UI-thread messages and
// loop. Dedicated workers expose importScripts; that is the envelope test.
if (isImageWorkerGlobalScope(globalThis)) {
  const ctx = globalThis as unknown as {
    postMessage: (message: ImageWorkerResponse) => void;
    onmessage: ((event: MessageEvent<ImageWorkerRequest>) => void) | null;
  };
  ctx.onmessage = (event) => {
    void runImageWorkerRequest(event.data).then(
      (response) => ctx.postMessage(response),
      (error) =>
        ctx.postMessage({
          type: "error",
          requestId: event.data.requestId,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  };
}
