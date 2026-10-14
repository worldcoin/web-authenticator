import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { startFaceDetector } from '../src/face/face-detector'

async function withWorker(run: (h: ReturnType<typeof harness>) => Promise<void>) {
	const h = harness()
	const replacements = {
		Worker: h.Worker,
		createImageBitmap: () => h.capture(),
		setTimeout: h.setTimeout,
		clearTimeout: h.clearTimeout,
	}
	const saved = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
	for (const [key, value] of Object.entries(replacements))
		Object.defineProperty(globalThis, key, { value, configurable: true })
	try {
		await run(h)
	} finally {
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	}
}

function harness() {
	const worker = {
		onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
		onerror: undefined as (() => void) | undefined,
		onmessageerror: undefined as (() => void) | undefined,
		postMessage: (data: { type: string }) => {
			messages.push(data.type)
		},
		terminate: () => {
			terminated++
		},
	}
	const messages: string[] = [],
		errors: string[] = [],
		logs: string[] = []
	const timers = new Map<number, { fn: () => void; ms: number }>()
	let terminated = 0,
		captures = 0,
		closed = 0,
		nextTimer = 0
	const bitmap = {
		close: () => {
			closed++
		},
	} as ImageBitmap
	const h = {
		Worker: function () {
			return worker
		},
		worker,
		messages,
		errors,
		logs,
		timers,
		capture: () => {
			captures++
			return Promise.resolve(bitmap)
		},
		bitmap,
		setTimeout: (fn: () => void, ms: number) => {
			const id = ++nextTimer
			timers.set(id, { fn, ms })
			return id
		},
		clearTimeout: (id: number) => {
			timers.delete(id)
		},
		counts: () => ({ terminated, captures, closed }),
		start: (signal: AbortSignal) =>
			startFaceDetector(
				{ readyState: 2, currentTime: 1 } as HTMLVideoElement,
				signal,
				false,
				() => {},
				message => logs.push(message),
				message => errors.push(message)
			),
		emit: (data: unknown) => worker.onmessage?.({ data }),
	}
	return h
}

test('detector waits for a result before capturing again and abort terminates pending inference', async () => {
	await withWorker(async h => {
		const controller = new AbortController()
		h.start(controller.signal)
		assert.deepEqual(h.messages, ['init'])
		h.emit({ type: 'ready' })
		await Promise.resolve()
		assert.deepEqual(h.messages, ['init', 'frame'])
		assert.equal(h.counts().captures, 1)
		assert.deepEqual(
			[...h.timers.values()].map(t => t.ms),
			[10_000]
		)
		controller.abort()
		assert.equal(h.counts().terminated, 1)
		assert.equal(h.timers.size, 0)
	})
})

test('late bitmap capture after cancellation is closed and never sent to the terminated worker', async () => {
	await withWorker(async h => {
		let finish!: (image: ImageBitmap) => void
		h.capture = () =>
			new Promise(resolve => {
				finish = resolve
			})
		const controller = new AbortController()
		h.start(controller.signal)
		h.emit({ type: 'ready' })
		controller.abort()
		finish(h.bitmap)
		await Promise.resolve()
		assert.deepEqual(h.messages, ['init'])
		assert.equal(h.counts().closed, 1)
	})
})

test('startup timeout and worker errors are surfaced and release the worker', async () => {
	await withWorker(async h => {
		h.start(new AbortController().signal)
		const startup = [...h.timers.values()][0]
		assert.equal(startup.ms, 45_000)
		startup.fn()
		assert.match(h.errors[0], /startup timed out/)
		assert.equal(h.counts().terminated, 1)
		assert.equal(h.timers.size, 0)
	})
	await withWorker(async h => {
		h.start(new AbortController().signal)
		h.emit({ type: 'error', stage: 'model integrity', message: 'SHA-256 mismatch' })
		assert.match(h.errors[0], /model integrity: SHA-256 mismatch/)
		assert.equal(h.counts().terminated, 1)
	})
})
