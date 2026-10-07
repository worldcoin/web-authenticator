import { LIVE_GUIDANCE_MODEL_V1 } from "./model-provenance";

export const LIVE_FACE_GUIDANCE_CODES_V1 = Object.freeze([
  "loading",
  "unavailable",
  "face_not_found",
  "multiple_faces",
  "move_closer",
  "move_farther",
  "move_left",
  "move_right",
  "move_up",
  "move_down",
  "turn_left",
  "turn_right",
  "improve_lighting",
  "reduce_lighting",
  "hold_steady",
] as const);

export type LiveFaceGuidanceCodeV1 =
  (typeof LIVE_FACE_GUIDANCE_CODES_V1)[number];

export interface LiveFaceGuidanceV1 {
  readonly code: LiveFaceGuidanceCodeV1;
  readonly text: string;
}

export interface NormalizedFacePointV1 {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

export const LIVE_FACE_GUIDANCE_COPY_V1: Readonly<
  Record<LiveFaceGuidanceCodeV1, string>
> = Object.freeze({
  loading: "Place your face in the oval",
  unavailable: "Place your face in the oval",
  face_not_found: "Move your face into the oval",
  multiple_faces: "Keep only one face in view",
  move_closer: "Move closer",
  move_farther: "Move farther away",
  move_left: "Move slightly left",
  move_right: "Move slightly right",
  move_up: "Move slightly up",
  move_down: "Move slightly down",
  turn_left: "Turn slightly left",
  turn_right: "Turn slightly right",
  improve_lighting: "Move to brighter, even light",
  reduce_lighting: "Move away from very bright light",
  hold_steady: "Great position, hold steady",
});

function guidance(code: LiveFaceGuidanceCodeV1): LiveFaceGuidanceV1 {
  return Object.freeze({ code, text: LIVE_FACE_GUIDANCE_COPY_V1[code] });
}

function usablePoint(point: NormalizedFacePointV1 | undefined): point is NormalizedFacePointV1 {
  return point !== undefined &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= -0.25 &&
    point.x <= 1.25 &&
    point.y >= -0.25 &&
    point.y <= 1.25;
}

export function classifyLiveFaceGuidanceV1(
  faces: readonly (readonly NormalizedFacePointV1[])[],
  meanLuma: number | null,
): LiveFaceGuidanceV1 {
  if (faces.length === 0) return guidance("face_not_found");
  if (faces.length > 1) return guidance("multiple_faces");
  const face = faces[0];
  const nose = face?.[1];
  const leftCheek = face?.[234];
  const rightCheek = face?.[454];
  if (
    face === undefined ||
    !usablePoint(nose) ||
    !usablePoint(leftCheek) ||
    !usablePoint(rightCheek)
  ) return guidance("unavailable");

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of face) {
    if (!usablePoint(point)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return guidance("unavailable");

  if (meanLuma !== null && Number.isFinite(meanLuma)) {
    if (meanLuma < 52) return guidance("improve_lighting");
    if (meanLuma > 222) return guidance("reduce_lighting");
  }

  const faceAreaRatio = width * height;
  if (faceAreaRatio < 0.14) return guidance("move_closer");
  if (faceAreaRatio > 0.56) return guidance("move_farther");

  const sourceCenterX = (minX + maxX) / 2;
  const visualCenterX = 1 - sourceCenterX;
  const centerY = (minY + maxY) / 2;
  if (visualCenterX < 0.40) return guidance("move_right");
  if (visualCenterX > 0.60) return guidance("move_left");
  if (centerY < 0.37) return guidance("move_down");
  if (centerY > 0.63) return guidance("move_up");

  const cheekMidpoint = (leftCheek.x + rightCheek.x) / 2;
  const visualNoseOffset = -(nose.x - cheekMidpoint) / width;
  if (visualNoseOffset > 0.055) return guidance("turn_left");
  if (visualNoseOffset < -0.055) return guidance("turn_right");
  return guidance("hold_steady");
}

interface FaceLandmarkerResultV1 {
  readonly faceLandmarks: readonly (readonly NormalizedFacePointV1[])[];
}

interface FaceLandmarkerV1 {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResultV1;
  close(): void;
}

export type FaceLandmarkerFactoryV1 = () => Promise<FaceLandmarkerV1>;

async function createFaceLandmarkerV1(): Promise<FaceLandmarkerV1> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(
    LIVE_GUIDANCE_MODEL_V1.wasmBasePath,
  );
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: LIVE_GUIDANCE_MODEL_V1.modelPath,
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numFaces: 2,
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

class PreviewLumaReaderV1 {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D | null;

  constructor() {
    this.canvas.width = 48;
    this.canvas.height = 48;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  read(video: HTMLVideoElement): number | null {
    const context = this.context;
    if (context === null || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    try {
      if (this.canvas.width !== 48 || this.canvas.height !== 48) {
        this.canvas.width = 48;
        this.canvas.height = 48;
      }
      context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      const image = context.getImageData(0, 0, this.canvas.width, this.canvas.height);
      let sum = 0;
      let count = 0;
      for (let index = 0; index < image.data.length; index += 16) {
        sum += 0.2126 * image.data[index] +
          0.7152 * image.data[index + 1] +
          0.0722 * image.data[index + 2];
        count += 1;
      }
      image.data.fill(0);
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return count === 0 ? null : sum / count;
    } catch {
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return null;
    }
  }

  clear(): void {
    this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}

export interface LiveFaceGuidanceControllerOptionsV1 {
  readonly createLandmarker?: FaceLandmarkerFactoryV1;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
  readonly now?: () => number;
  readonly readMeanLuma?: (video: HTMLVideoElement) => number | null;
  readonly minimumIntervalMs?: number;
}

export class LiveFaceGuidanceControllerV1 {
  private generation = 0;
  private frameHandle?: number;
  private landmarker?: FaceLandmarkerV1;
  private lastAnalysisAt = -Infinity;
  private lastVideoTime = -1;
  private candidateCode?: LiveFaceGuidanceCodeV1;
  private candidateCount = 0;
  private emittedCode?: LiveFaceGuidanceCodeV1;
  private readonly lumaReader = new PreviewLumaReaderV1();
  private readonly createLandmarker: FaceLandmarkerFactoryV1;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly now: () => number;
  private readonly readMeanLuma: (video: HTMLVideoElement) => number | null;
  private readonly minimumIntervalMs: number;

  constructor(
    private readonly getVideo: () => HTMLVideoElement | null,
    private readonly onGuidance: (result: LiveFaceGuidanceV1) => void,
    options: LiveFaceGuidanceControllerOptionsV1 = {},
  ) {
    this.createLandmarker = options.createLandmarker ?? createFaceLandmarkerV1;
    this.requestFrame = options.requestFrame ?? requestAnimationFrame.bind(globalThis);
    this.cancelFrame = options.cancelFrame ?? cancelAnimationFrame.bind(globalThis);
    this.now = options.now ?? (() => performance.now());
    this.readMeanLuma = options.readMeanLuma ?? ((video) => this.lumaReader.read(video));
    this.minimumIntervalMs = options.minimumIntervalMs ?? 125;
  }

  start(): void {
    this.stop();
    const generation = ++this.generation;
    this.emit("loading", true);
    void this.createLandmarker().then((landmarker) => {
      if (generation !== this.generation) {
        landmarker.close();
        return;
      }
      this.landmarker = landmarker;
      this.schedule(generation);
    }).catch(() => {
      if (generation === this.generation) this.emit("unavailable", true);
    });
  }

  stop(): void {
    this.generation += 1;
    if (this.frameHandle !== undefined) this.cancelFrame(this.frameHandle);
    this.frameHandle = undefined;
    this.landmarker?.close();
    this.landmarker = undefined;
    this.lastAnalysisAt = -Infinity;
    this.lastVideoTime = -1;
    this.candidateCode = undefined;
    this.candidateCount = 0;
    this.emittedCode = undefined;
    this.lumaReader.clear();
  }

  private schedule(generation: number): void {
    this.frameHandle = this.requestFrame(() => this.runFrame(generation));
  }

  private runFrame(generation: number): void {
    if (generation !== this.generation || this.landmarker === undefined) return;
    const now = this.now();
    const video = this.getVideo();
    if (
      video === null ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.currentTime === this.lastVideoTime ||
      now - this.lastAnalysisAt < this.minimumIntervalMs
    ) {
      this.schedule(generation);
      return;
    }
    this.lastAnalysisAt = now;
    this.lastVideoTime = video.currentTime;
    try {
      const result = this.landmarker.detectForVideo(video, now);
      const classified = classifyLiveFaceGuidanceV1(
        result.faceLandmarks,
        this.readMeanLuma(video),
      );
      this.emit(classified.code);
    } catch {
      this.emit("unavailable", true);
      this.stop();
      return;
    }
    this.schedule(generation);
  }

  private emit(code: LiveFaceGuidanceCodeV1, immediate = false): void {
    if (immediate) {
      this.candidateCode = code;
      this.candidateCount = 2;
      if (this.emittedCode === code) return;
      this.emittedCode = code;
      this.onGuidance(guidance(code));
      return;
    }
    if (this.candidateCode === code) this.candidateCount += 1;
    else {
      this.candidateCode = code;
      this.candidateCount = 1;
    }
    if (this.candidateCount >= 2 && this.emittedCode !== code) {
      this.emittedCode = code;
      this.onGuidance(guidance(code));
    }
  }
}
