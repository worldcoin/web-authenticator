import type { Observation } from '../../../packages/poseguard/src/vendor/posechallenge.js'

export interface PoseObservation extends Observation {
  fraction: number
  cx: number
  cy: number
  iod: number
}

export interface PoseWorker {
  /** Takes ownership of the bitmap, including on rejection. Only one frame may be in flight. */
  analyze(frame: ImageBitmap, tSeconds: number): Promise<PoseObservation>
  dispose(): void
  readonly delegate: 'GPU' | 'CPU'
}

export type PoseWorkerRequest =
  | { type: 'init' }
  | { type: 'analyze'; id: number; frame: ImageBitmap; t: number }
export type PoseWorkerResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'result'; id: number; observation: PoseObservation }
  | { type: 'error'; message: string }

