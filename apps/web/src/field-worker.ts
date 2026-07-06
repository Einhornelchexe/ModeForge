// Web Worker for the CPU-heavy field jobs: keeps the UI thread responsive and
// streams progress messages while the O(N^4) DFT segments run. Physics stays
// behind packages/api — this file only forwards inputs and results.

import { runHeadlessJob, type HeadlessJobInput } from "../../../packages/api/src/index.ts";

export type FieldWorkerRequest = {
  token: number;
  job: Extract<HeadlessJobInput, { kind: "field-beamline" | "field-fresnel" }>;
};

export type FieldWorkerResponse =
  | { type: "progress"; token: number; done: number; total: number }
  | { type: "done"; token: number; result: ReturnType<typeof runHeadlessJob> };

const ctx = self as unknown as {
  postMessage: (message: FieldWorkerResponse) => void;
  onmessage: ((event: MessageEvent<FieldWorkerRequest>) => void) | null;
};

ctx.onmessage = (event) => {
  const { token, job } = event.data;
  const onProgress = (progress: { done: number; total: number }): void =>
    ctx.postMessage({ type: "progress", token, done: progress.done, total: progress.total });
  const withProgress: HeadlessJobInput =
    job.kind === "field-beamline"
      ? { ...job, input: { ...job.input, onProgress } }
      : { ...job, input: { ...job.input, onProgress } };
  const result = runHeadlessJob(withProgress);
  ctx.postMessage({ type: "done", token, result });
};
