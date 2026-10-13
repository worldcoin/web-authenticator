import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startCamera } from '../src/components/selfie-check/camera-capture'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

async function withCamera(run: (camera: ReturnType<typeof fakeCamera>) => Promise<void>) {
	const camera = fakeCamera()
	const replacements = {
		window: camera.window,
		document: camera.document,
		navigator: { mediaDevices: { getUserMedia: () => camera.permission() } },
		requestAnimationFrame: (callback: (now: number) => void) => {
			camera.animationCallback = callback
			return 1
		},
		cancelAnimationFrame: () => {
			camera.animationCallback = undefined
		},
	}
	const descriptors = new Map(
		Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
	)
	for (const [key, value] of Object.entries(replacements))
		Object.defineProperty(globalThis, key, { value, configurable: true })
	try {
		await run(camera)
	} finally {
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
}

function fakeCamera() {
	let stops = 0
	const track = Object.assign(new EventTarget(), {
		stop: () => {
			stops++
		},
	})
	const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
	const camera = {
		window: Object.assign(new EventTarget(), { isSecureContext: true }),
		document: Object.assign(new EventTarget(), { hidden: false }),
		permission: () => Promise.resolve(stream),
		stream,
		track,
		stops: () => stops,
		frameCallback: undefined as ((now: number, metadata: { mediaTime: number }) => void) | undefined,
		animationCallback: undefined as ((now: number) => void) | undefined,
		drawn: [] as number[],
		video: {
			videoWidth: 1920,
			videoHeight: 1080,
			readyState: 2,
			currentTime: 0,
			srcObject: null as MediaStream | null,
			play: () => Promise.resolve(),
			pause: () => {},
			requestVideoFrameCallback: (callback: (now: number, metadata: { mediaTime: number }) => void) => {
				camera.frameCallback = callback
				return 1
			},
			cancelVideoFrameCallback: () => {
				camera.frameCallback = undefined
			},
		} as unknown as HTMLVideoElement,
		canvas: {
			width: 0,
			height: 0,
			getContext: () => ({
				drawImage: () => {
					camera.drawn.push(camera.video.currentTime)
				},
			}),
		} as unknown as HTMLCanvasElement,
		emit: (now: number, mediaTime = now / 1000) => {
			camera.video.currentTime = mediaTime
			const callback = camera.frameCallback
			camera.frameCallback = undefined
			callback?.(now, { mediaTime })
			const animation = camera.animationCallback
			camera.animationCallback = undefined
			animation?.(now)
		},
	}
	return camera
}

test('preview stays open after startup until explicitly cancelled', async () => {
	await withCamera(async camera => {
		const controller = new AbortController()
		let ready = false
		const running = startCamera(camera.video, controller.signal, () => {
			ready = true
		})
		const rejected = assert.rejects(running)
		await flush()
		assert.equal(ready, true)
		assert.equal(camera.video.srcObject, camera.stream)
		assert.equal(camera.stops(), 0)
		assert.deepEqual(camera.drawn, [])
		controller.abort()
		await rejected
		assert.equal(camera.video.srcObject, null)
		assert.equal(camera.stops(), 1)
	})
})

test('hiding the tab stops the preview and releases the camera', async () => {
	await withCamera(async camera => {
		const running = startCamera(camera.video, new AbortController().signal, () => {})
		const rejected = assert.rejects(running, /left this tab/)
		await flush()
		camera.document.hidden = true
		camera.document.dispatchEvent(new Event('visibilitychange'))
		await rejected
		assert.equal(camera.stops(), 1)
		assert.equal(camera.video.srcObject, null)
	})
})

test('permission granted after cancellation releases the late stream', async () => {
	await withCamera(async camera => {
		let grant!: (stream: MediaStream) => void
		camera.permission = () =>
			new Promise(resolve => {
				grant = resolve
			})
		const controller = new AbortController()
		const running = startCamera(camera.video, controller.signal, () => {})
		const rejected = assert.rejects(running)
		controller.abort()
		await rejected
		grant(camera.stream)
		await flush()
		assert.equal(camera.stops(), 1)
		assert.equal(camera.video.srcObject, null)
	})
})
