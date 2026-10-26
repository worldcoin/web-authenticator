import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { faceGeometry, headAngles } from '../../../packages/poseguard/src/vendor/geometry.js'
import type { PoseObservation, PoseWorkerRequest, PoseWorkerResponse } from './types'

const MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
let landmarker: FaceLandmarker | null = null
let busy = false
let lastStamp = -1
const send = (message: PoseWorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(message, { transfer })

async function initialize(preferred?: 'CPU'): Promise<'GPU' | 'CPU'> {
  // Match FacePAD's module-worker runtime; importScripts is unavailable here.
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm', true)
  const response = await fetch('/mediapipe/face_landmarker.task', {
    credentials: 'omit',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error('Pose model is unavailable')
  const model = await response.arrayBuffer()
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', model)),
    byte => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== MODEL_SHA256) throw new Error('Pose model integrity check failed')
  for (const delegate of (preferred === 'CPU' ? ['CPU'] as const : ['GPU', 'CPU'] as const)) {
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        ...(typeof OffscreenCanvas !== 'undefined' ? { canvas: new OffscreenCanvas(1, 1) } : {}),
        baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
      })
      return delegate
    } catch {
      landmarker?.close()
      landmarker = null
    }
  }
  throw new Error('Pose model could not start with GPU or CPU')
}

function analyze(frame: ImageBitmap, t: number): PoseObservation {
  if (!landmarker) throw new Error('Pose model is not ready')
  const { width, height } = frame
  if (!Number.isFinite(t) || width < 1 || height < 1 || width > 4096 || height > 4096)
    throw new Error('Unsupported pose frame')
  const stamp = Math.max(Math.round(t * 1000), lastStamp + 1)
  lastStamp = stamp
  const found = landmarker.detectForVideo(frame, stamp)
  const result: PoseObservation = {
    t, present: false, yaw: NaN, pitch: NaN, landmarks: null, width, height,
    fraction: 0, cx: 0, cy: 0, iod: 0,
  }
  const face = found.faceLandmarks[0]
  if (!face || face.length < 468) return result
  const landmarks = new Float32Array(3 * face.length)
  for (let i = 0; i < face.length; i++) {
    landmarks[3 * i] = face[i].x
    landmarks[3 * i + 1] = face[i].y
    landmarks[3 * i + 2] = face[i].z
  }
  const geometry = faceGeometry(landmarks, width, height)
  if (!geometry) return result
  const angles = headAngles(found.facialTransformationMatrixes[0]?.data ?? null)
  return {
    ...result,
    present: true,
    yaw: angles.yaw ?? NaN,
    pitch: angles.pitch ?? NaN,
    landmarks,
    // FacePAD fallback when a device-specific focal calibration is unavailable.
    fraction: (geometry.boxRight - geometry.boxLeft) / width,
    cx: geometry.center[0], cy: geometry.center[1], iod: geometry.iod,
  }
}

self.onmessage = async ({ data }: MessageEvent<PoseWorkerRequest>) => {
  if (busy) {
    if (data.type === 'analyze') data.frame.close()
    send({ type: 'error', message: 'Concurrent pose requests are not supported' })
    return
  }
  busy = true
  try {
    if (data.type === 'init') {
      if (landmarker) throw new Error('Pose model already initialized')
      send({ type: 'ready', delegate: await initialize(data.delegate) })
    } else {
      try {
        const observation = analyze(data.frame, data.t)
        send({ type: 'result', id: data.id, observation },
          observation.landmarks ? [observation.landmarks.buffer] : [])
      } finally {
        data.frame.close()
      }
    }
  } catch {
    // Keep frame content, landmarks and runtime buffers out of diagnostics.
    send({ type: 'error', message: 'Pose detection failed. Reload the camera and try again.' })
  } finally {
    busy = false
  }
}
