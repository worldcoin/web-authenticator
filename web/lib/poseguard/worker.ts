import type { PoseObservation, PoseWorker, PoseWorkerRequest, PoseWorkerResponse } from './types'

/** One model instance per capture session, with bounded startup and one transferred frame at a time. */
export function createPoseWorker(signal: AbortSignal, delegate?: 'CPU'): Promise<PoseWorker> {
  if (signal.aborted) return Promise.reject(new DOMException('Pose capture cancelled', 'AbortError'))
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(error)
      return
    }
    let stopped = false
    let ready = false
    let nextId = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: { id: number; resolve: (observation: PoseObservation) => void; reject: (error: Error) => void } | null = null
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const stop = (error: Error = new DOMException('Pose capture cancelled', 'AbortError')) => {
      if (stopped) return
      stopped = true
      clearTimer()
      signal.removeEventListener('abort', abort)
      worker.terminate()
      if (!ready) reject(error)
      pending?.reject(error)
      pending = null
    }
    const abort = () => stop()
    const fail = (message: string) => stop(new Error(message))
    const armTimer = (milliseconds: number, message: string) => {
      clearTimer()
      timer = setTimeout(() => fail(message), milliseconds)
    }

    worker.onmessage = ({ data }: MessageEvent<PoseWorkerResponse>) => {
      if (stopped) return
      if (data.type === 'error') {
        fail(data.message)
      } else if (data.type === 'ready') {
        if (ready) return fail('Unexpected pose initialization response')
        clearTimer()
        ready = true
        resolve({
          delegate: data.delegate,
          analyze(frame, tSeconds) {
            if (stopped || signal.aborted) {
              frame.close()
              return Promise.reject(new DOMException('Pose capture cancelled', 'AbortError'))
            }
            if (pending) {
              frame.close()
              return Promise.reject(new Error('A pose frame is already in flight'))
            }
            if (!Number.isFinite(tSeconds)) {
              frame.close()
              return Promise.reject(new Error('Invalid pose frame time'))
            }
            return new Promise((frameResolve, frameReject) => {
              const id = ++nextId
              pending = { id, resolve: frameResolve, reject: frameReject }
              armTimer(10_000, 'Pose frame analysis timed out')
              try {
                worker.postMessage({ type: 'analyze', id, frame, t: tSeconds } satisfies PoseWorkerRequest, [frame])
              } catch {
                frame.close()
                fail('Could not transfer the pose frame')
              }
            })
          },
          dispose: () => stop(),
        })
      } else {
        if (!pending || pending.id !== data.id) return fail('Unexpected pose frame response')
        clearTimer()
        const current = pending
        pending = null
        current.resolve(data.observation)
      }
    }
    worker.onerror = () => fail('Pose worker could not load or execute')
    worker.onmessageerror = () => fail('Could not decode the pose worker response')
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      stop()
      return
    }
    armTimer(45_000, 'Pose model startup timed out')
    try { worker.postMessage({ type: 'init', ...(delegate ? { delegate } : {}) } satisfies PoseWorkerRequest) }
    catch { fail('Could not initialize the pose worker') }
  })
}
