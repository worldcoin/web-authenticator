import type { FaceDetection } from './rgbnet'
import type { DetectorRequest, DetectorResponse } from './rgbnet.worker'

export function startFaceDetector(
	video: HTMLVideoElement,
	signal: AbortSignal,
	diagnostics: boolean,
	onResult: (faces: FaceDetection[], width: number, height: number) => void,
	onEvent: (message: string) => void,
	onError: (message: string) => void
): () => void {
	let worker: Worker
	try {
		worker = new Worker(new URL('./rgbnet.worker.ts', import.meta.url), { type: 'module' })
	} catch {
		onError('Could not start the detector worker. Check browser worker support.')
		return () => {}
	}
	let stopped = false,
		frameId = 0,
		lastVideoTime = -1,
		lastSummary = -Infinity
	let lastFrameAt = performance.now()
	let timer: ReturnType<typeof setTimeout> | undefined
	let deadline: ReturnType<typeof setTimeout> | undefined
	const clearDeadline = () => {
		if (deadline) clearTimeout(deadline)
	}
	const stop = () => {
		if (stopped) return
		stopped = true
		clearDeadline()
		if (timer) clearTimeout(timer)
		worker.terminate()
		signal.removeEventListener('abort', stop)
		onEvent('RGBNet: worker stopped; session and pending frame released.')
	}
	const fail = (message: string) => {
		if (stopped) return
		onEvent(`RGBNet error: ${message}`)
		onError(message)
		stop()
	}
	const armDeadline = (ms: number, operation: string) => {
		clearDeadline()
		deadline = setTimeout(() => fail(`${operation} timed out. Retry detection.`), ms)
	}
	const capture = async () => {
		if (stopped) return
		if (video.readyState < 2 || video.currentTime === lastVideoTime) {
			if (performance.now() - lastFrameAt > 10_000) {
				fail('Camera stopped producing frames. Restart the camera.')
				return
			}
			timer = setTimeout(() => void capture(), 100)
			return
		}
		lastVideoTime = video.currentTime
		lastFrameAt = performance.now()
		armDeadline(10_000, 'Frame capture/inference')
		try {
			const bitmap = await createImageBitmap(video)
			if (stopped) {
				bitmap.close()
				return
			}
			const request: DetectorRequest = { type: 'frame', bitmap, id: ++frameId }
			try {
				worker.postMessage(request, [bitmap])
			} catch (cause) {
				bitmap.close()
				throw cause
			}
		} catch {
			fail('Could not capture or transfer a camera frame.')
		}
	}
	worker.onmessage = ({ data }: MessageEvent<DetectorResponse>) => {
		if (stopped) return
		if (data.type === 'log') onEvent(`RGBNet: ${data.message}`)
		else if (data.type === 'error') fail(`${data.stage}: ${data.message}`)
		else if (data.type === 'ready') {
			clearDeadline()
			lastFrameAt = performance.now()
			void capture()
		} else {
			clearDeadline()
			onResult(data.faces, data.width, data.height)
			if (performance.now() - lastSummary >= 2000) {
				onEvent(`RGBNet frame ${data.id}: ${data.timings}`)
				lastSummary = performance.now()
			}
			// At most one in-flight frame; schedule from completion, never queue video.
			timer = setTimeout(() => void capture(), 100)
		}
	}
	worker.onerror = () => fail('Worker failed to load or execute. Check browser console and retry.')
	worker.onmessageerror = () => fail('Could not decode detector worker response.')
	signal.addEventListener('abort', stop, { once: true })
	if (signal.aborted) stop()
	else {
		armDeadline(45_000, 'Model/session startup')
		try { worker.postMessage({ type: 'init', diagnostics } satisfies DetectorRequest) }
		catch { fail('Could not initialize the detector worker.'); return stop }
		onEvent(
			`RGBNet: worker starting; detailed runtime logs ${diagnostics ? 'enabled in browser console' : 'disabled'}.`
		)
	}
	return stop
}
