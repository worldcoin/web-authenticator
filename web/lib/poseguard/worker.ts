import type { PoseObservation, PoseWorkerRequest, PoseWorkerResponse } from "./types";

export interface PoseDetector {
  /** Takes ownership of the bitmap, including on rejection. */
  analyze(frame: ImageBitmap, timestamp: number): Promise<PoseObservation | null>;
}

export function openPoseDetector(signal: AbortSignal): Promise<PoseDetector> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./pose.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    let ready = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let pending: { resolve: (pose: PoseObservation | null) => void; reject: (cause: unknown) => void } | undefined;

    const stop = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      worker.terminate();
      signal.removeEventListener("abort", abort);
      clearTimeout(timer);
      reject(error);
      pending?.reject(error);
      pending = undefined;
    };
    const abort = () => stop(signal.reason);
    const fail = () => stop(new Error("The head-pose detector stopped. Try again."));
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = ({ data }: MessageEvent<PoseWorkerResponse>) => {
      clearTimeout(timer);
      if (data.type === "error") return stop(new Error(data.message));
      if (data.type === "ready" && !ready) {
        ready = true;
        resolve({
          analyze(frame, timestamp) {
            if (stopped || pending) {
              frame.close();
              return Promise.reject(signal.reason ?? new Error("The head-pose detector is unavailable."));
            }
            return new Promise((resolveFrame, rejectFrame) => {
              pending = { resolve: resolveFrame, reject: rejectFrame };
              timer = setTimeout(fail, 8_000);
              try { worker.postMessage({ type: "analyze", frame, timestamp } satisfies PoseWorkerRequest, [frame]); }
              catch { frame.close(); fail(); }
            });
          },
        });
        return;
      }
      if (data.type !== "result" || !pending) return fail();
      const current = pending;
      pending = undefined;
      current.resolve(data.pose);
    };
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(fail, 40_000);
    try { worker.postMessage({ type: "init" } satisfies PoseWorkerRequest); }
    catch { fail(); }
  });
}
