import { createPoseWorker, Session, Phase, secureSeed, words, VERSION, type PoseObservation, type PoseResult, type PoseWorker } from "./poseguard";
import { withAbort, type CaptureOptions, type CaptureResult, type CaptureState } from "./selfie-capture";
import { previewCrop } from "./rgbnet";

export type PoseProgress = { step: number; total: number; direction?: number; holding: boolean };
export type PoseCaptureState = CaptureState & { pose?: PoseProgress };
export class PoseGuardRejected extends Error {
  constructor(readonly result: PoseResult) { super(result.reason); this.name = "PoseGuardRejected"; }
}

// The FacePAD framing defaults; the challenge/evaluator constants remain in the pinned core.
const FRAME_WIDTH = 720;
const FRAMING_SECONDS = 15;
const RUN_SECONDS = 45;
const now = () => performance.now() / 1000;

export function poseFramingGuidance(recent: readonly PoseObservation[], receivedAtSeconds?: number): string | null {
  const o = recent.at(-1);
  if (!o?.present || !Number.isFinite(o.t) || !Number.isFinite(o.yaw) || !Number.isFinite(o.pitch) ||
    (receivedAtSeconds !== undefined && receivedAtSeconds - o.t > 0.5)) return "Look straight at the camera";
  if (![o.fraction, o.cx, o.cy, o.iod].every(Number.isFinite) || o.iod <= 0) return "Hold still";
  if (o.fraction < 0.45) return "Move a little closer";
  if (o.fraction > 0.86) return "Move a little farther away";
  if (Math.abs(o.yaw) > 6 || Math.abs(o.pitch) > 15) return "Look straight at the camera";
  const samples = recent.filter(r => o.t - r.t >= 0 && o.t - r.t <= 0.4);
  if (samples.length < 3 || o.t - samples[0].t < 0.24 || samples.some(r => !r.present || ![r.cx, r.cy, r.iod].every(Number.isFinite) || r.iod <= 0)) return "Hold still";
  const xs = samples.map(r => r.cx), ys = samples.map(r => r.cy), sizes = samples.map(r => r.iod);
  const mean = sizes.reduce((sum, value) => sum + value, 0) / sizes.length;
  if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > 0.12 * mean ||
    Math.log(Math.max(...sizes) / Math.min(...sizes)) > 0.05) return "Hold still";
  return null;
}

function jpeg(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Blob> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  return withAbort(new Promise<Blob>((resolve, reject) => {
    deadline = setTimeout(() => reject(new DOMException("Selfie capture timed out.", "TimeoutError")), 10_000);
    canvas.toBlob(image => image ? resolve(image) : reject(new Error("Could not capture your selfie.")), "image/jpeg", 0.9);
  }), signal).finally(() => { if (deadline !== undefined) clearTimeout(deadline); });
}

/** Client-only PoseGuard. Keeps just a frontal selfie for the existing enrollment handoff; no video upload. */
export async function capturePoseGuard(
  video: HTMLVideoElement,
  signal: AbortSignal,
  update: (state: PoseCaptureState) => void,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const own = new AbortController();
  const attempt = AbortSignal.any([signal, own.signal]);
  let stream: MediaStream | undefined;
  let worker: PoseWorker | undefined;
  let retained = false;
  let clock: ReturnType<typeof setInterval> | undefined;
  let session: Session | undefined;
  const canvas = document.createElement("canvas");
  const started = performance.now();
  const release = () => {
    signal.removeEventListener("abort", release);
    own.abort();
    worker?.dispose();
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    video.srcObject = null;
  };
  signal.addEventListener("abort", release, { once: true });
  const publish = () => {
    if (!session || attempt.aborted || session.done()) return;
    const moving = session.phase() === Phase.TARGET;
    const target = session.targets[session.index()];
    const holding = moving && session.hold() > 0;
    update({
      phase: "holding", cameraReady: true,
      title: !session.present() ? "Keep your face in view" : moving ? holding ? "Hold it there" : `Turn your head ${words(target.direction)}` : session.index() === 0 ? "Look straight ahead" : "Keep looking at the screen",
      hint: "Keep your eyes on the dot. Turn toward the green edge.",
      progress: (session.index() + (moving ? session.hold() : 0)) / session.targets.length,
      pose: { step: Math.min(session.index() + 1, session.targets.length), total: session.targets.length, direction: moving ? target.direction : undefined, holding },
    });
  };
  try {
    attempt.throwIfAborted();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open this page over HTTPS or localhost to use your camera.");
    update({ phase: "starting", title: "Getting ready", hint: "Allow camera access. The movement check is loading.", progress: 0, cameraReady: false });
    // Warm the model while the permission prompt/camera startup is in progress.
    await withAbort(Promise.all([
      createPoseWorker(attempt).then(value => { worker = value; }),
      navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } }).then(async media => {
        if (attempt.aborted) { media.getTracks().forEach(track => track.stop()); attempt.throwIfAborted(); }
        stream = media;
        for (const track of media.getVideoTracks()) track.addEventListener("ended", () => own.abort(new Error("Camera disconnected. Please try again.")), { once: true });
        video.srcObject = media;
        await withAbort(video.play(), attempt);
        update({ phase: "starting", title: "Getting ready", hint: "Look at the screen. The movement check is loading.", progress: 0, cameraReady: true });
      }),
    ]), attempt);
    if (options.beforeCapture) await withAbort(options.beforeCapture(attempt), attempt);
    attempt.throwIfAborted();
    const context = canvas.getContext("2d");
    if (!context || !worker) throw new Error("Could not start the movement check.");
    let lastVideoTime = -1;
    let lastFrameAt = now();
    let framingStarted: number | undefined;
    let reference: Promise<Blob> | undefined;
    let frames = 0;
    const recent: PoseObservation[] = [];
    clock = setInterval(() => { session?.tick(now()); publish(); }, 50);
    for (;;) {
      attempt.throwIfAborted();
      if (session?.done()) break;
      const tick = now();
      if (session && tick - session.startedAt > RUN_SECONDS) throw new DOMException("The movement check took too long. Please try again.", "TimeoutError");
      if (!session && framingStarted !== undefined && tick - framingStarted > FRAMING_SECONDS) throw new PoseGuardRejected({ status: "inconclusive", outcome: "no_face", reason: "We couldn't get a steady view. Face the camera in good light and try again.", metrics: {} });
      if (video.readyState < 2 || video.currentTime === lastVideoTime) {
        if (tick - lastFrameAt > 3) throw new Error("Your camera stopped sending frames. Please try again.");
        await withAbort(new Promise(resolve => setTimeout(resolve, 25)), attempt);
        continue;
      }
      lastVideoTime = video.currentTime;
      lastFrameAt = tick;
      if (video.videoWidth < 1 || video.videoHeight < 1 || video.videoWidth > 4096 || video.videoHeight > 4096) throw new Error("Unsupported camera dimensions.");
      const [sx, sy, sw, sh] = previewCrop(video.videoWidth, video.videoHeight, video.clientWidth || video.videoWidth, video.clientHeight || video.videoHeight);
      const height = Math.round(FRAME_WIDTH * sh / sw);
      if (!Number.isFinite(height) || height < 1 || height > 2048) throw new Error("Unsupported camera dimensions.");
      if (canvas.width !== FRAME_WIDTH || canvas.height !== height) { canvas.width = FRAME_WIDTH; canvas.height = height; }
      context.drawImage(video, sx, sy, sw, sh, 0, 0, FRAME_WIDTH, height);
      const bitmap = await withAbort(createImageBitmap(canvas).then(frame => {
        if (attempt.aborted) { frame.close(); attempt.throwIfAborted(); }
        return frame;
      }), attempt);
      // Await each result. The camera stays live; old inference frames never accumulate.
      const observed = await worker.analyze(bitmap, tick);
      attempt.throwIfAborted();
      frames++;
      if (session) { session.observe(observed); publish(); }
      else {
        // First inference includes shader compilation; it must not use the framing time budget.
        framingStarted ??= now();
        recent.push(observed);
        while (recent.length && observed.t - recent[0].t > 0.4) recent.shift();
        const guidance = poseFramingGuidance(recent, now());
        update({ phase: "framing", title: guidance ?? "Looking good", hint: "Keep your camera still. Look at the dot as you turn your head.", progress: 0, cameraReady: true });
        if (guidance === null) {
          // toBlob snapshots this frontal frame. Encoding must not pause the observation stream:
          // the unchanged core expires a run after 0.7 seconds without a fresh face result.
          reference = jpeg(canvas, attempt);
          void reference.catch(() => { /* Observed immediately; propagated when the run finishes. */ });
          session = new Session(secureSeed(), observed.t, observed.yaw, observed.pitch, observed.landmarks, observed.width, observed.height);
          publish();
        }
      }
      // Cap work at 20 observations/s without delaying an already slow device further.
      const rest = 50 - (now() - tick) * 1000;
      if (rest > 0) await withAbort(new Promise(resolve => setTimeout(resolve, rest)), attempt);
    }
    const result = session!.result();
    // eslint-disable-next-line no-console -- Local aggregate diagnostics; never images, landmarks, seeds or embedding vectors.
    console.info("poseguard_complete " + JSON.stringify({ version: VERSION, status: result.status, outcome: result.outcome, frames, totalMs: Math.round(performance.now() - started), delegate: worker.delegate,
      gaze: { yawRange: result.metrics.gazeYawRange, slope: result.metrics.gazeSlope, rSquared: result.metrics.gazeR2, faceFound: result.metrics.gazeFaceFound, samples: result.metrics.gazeResults } }));
    if (result.status !== "passed") throw new PoseGuardRejected(result);
    if (!reference) throw new Error("The reference selfie is missing. Please try again.");
    const image = await reference;
    attempt.throwIfAborted();
    retained = options.retainPreviewUntilAbort === true;
    return { image, timing: { guidanceMs: Math.round((session!.startedAt * 1000) - started), totalMs: Math.round(performance.now() - started), width: canvas.width, height: canvas.height } };
  } finally {
    if (clock !== undefined) clearInterval(clock);
    worker?.dispose();
    canvas.width = canvas.height = 0;
    if (!retained) release();
  }
}
