export interface Observation {
  t: number; present: boolean; yaw: number; pitch: number;
  landmarks: Float32Array | null; width: number; height: number;
}
export interface PoseResult {
  status: 'passed' | 'failed' | 'inconclusive';
  outcome: string; reason: string; metrics: Record<string, number>;
}
export interface Target {
  index: number; direction: number; x: number; y: number; armDelay: number;
  shownAt: number; hitAt: number; enteredAt: number; hit: boolean;
  middleYaw: number; middlePitch: number; wrongWayDegrees: number; outAtHit: number;
  document(): Record<string, number | boolean>;
}
export const VERSION: 8;
export const Phase: Readonly<{ PAUSE: 0; TARGET: 1; DONE: 2 }>;
export const TARGETS: number;
export const OUT_DEGREES: number;
export const SECTOR_DEGREES: number;
export const MIN_FROM_PREVIOUS: number;
export const HOLD_SECONDS: number;
export const HOLD_OBSERVATIONS: number;
export const GAZE_MIN_RANGE: number;
export const GAZE_SLOPE_PASS: number;
export const GAZE_R2_PASS: number;
export const GAZE_R2_FAIL: number;
export const GAZE_SLOPE_FAIL: number;
export const LOST_SECONDS: number;
export function secureSeed(): bigint;
export function targets(seed: bigint | number | string): Target[];
export function words(direction: number): string;
export function observation(t: number, present: boolean, yaw?: number, pitch?: number, landmarks?: Float32Array | null, width?: number, height?: number): Observation;
export function constants(): Record<string, unknown>;
export function toRadians(degrees: number): number;
export function toDegrees(radians: number): number;
export function angleBetween(a: number, b: number): number;
export function iris(landmarks: Float32Array | null, width: number, height: number): number;
export class Session {
  constructor(seed: bigint | number | string, t: number, yaw: number, pitch: number, mesh: Float32Array | null, width: number, height: number);
  readonly seed: bigint;
  readonly startedAt: number;
  readonly targets: Target[];
  observe(observation: Observation): void;
  tick(t: number): void;
  phase(): 0 | 1 | 2;
  index(): number;
  hold(): number;
  point(): [number, number];
  present(): boolean;
  done(): boolean;
  armed(): boolean;
  completion(): string | null;
  trace(): number[][];
  middles(): number[][];
  result(): PoseResult;
  document(): Record<string, unknown>;
}


export class JavaRandom {
  constructor(seed: bigint | number | string);
  nextGaussian(): number;
  nextDouble(): number;
}
