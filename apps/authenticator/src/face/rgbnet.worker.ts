import model from './rgbnet-model.json'
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import { decodeRgbnet, prepareRgbnet, INPUT_SIZE, type FaceDetection } from './rgbnet'

export type DetectorRequest =
	| { type: 'init'; diagnostics: boolean }
	| { type: 'frame'; bitmap: ImageBitmap; id: number }
export type DetectorResponse =
	| { type: 'log'; message: string }
	| { type: 'ready' }
	| { type: 'result'; faces: FaceDetection[]; width: number; height: number; id: number; timings: string }
	| { type: 'error'; stage: string; message: string }

let session: ort.InferenceSession | undefined
let diagnostics = false
let busy = false
let stage = 'initialization'
const send = (message: DetectorResponse) => self.postMessage(message)
const log = (message: string) => {
	send({ type: 'log', message })
}
const trace = (message: string) => {
	if (diagnostics) log(message)
}

self.onmessage = async ({ data }: MessageEvent<DetectorRequest>) => {
	if (busy) {
		if (data.type === 'frame') data.bitmap.close()
		send({ type: 'error', stage: 'protocol', message: 'Concurrent detector requests are not supported' })
		return
	}
	busy = true
	try {
		if (data.type === 'init') {
			if (session) throw new Error('Detector already initialized')
			diagnostics = data.diagnostics
			ort.env.wasm.numThreads = 1
			ort.env.wasm.proxy = false
			ort.env.wasm.wasmPaths = {
				wasm: new URL(wasmUrl, self.location.href).href,
				mjs: new URL(wasmModuleUrl, self.location.href).href,
			}
			ort.env.logLevel = diagnostics ? 'verbose' : 'warning'
			stage = 'model download'
			log(`Downloading RGBNet (${model.bytes} bytes expected). Frames remain on this device.`)
			const response = await fetch(model.url, { signal: AbortSignal.timeout(20_000), credentials: 'omit' })
			if (!response.ok)
				throw new Error(`Model download returned HTTP ${response.status}; run the RGBNet setup script`)
			const bytes = await response.arrayBuffer()
			if (bytes.byteLength !== model.bytes) throw new Error('Model length mismatch; run the RGBNet setup script')
			stage = 'model integrity'
			const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b =>
				b.toString(16).padStart(2, '0')
			).join('')
			if (hash !== model.sha256) throw new Error('Model SHA-256 mismatch; refusing to run unpinned weights')
			log(`Model SHA-256 verified: ${hash}`)
			stage = 'Wasm session creation'
			const start = performance.now()
			log('Creating ONNX Runtime session: Wasm CPU, SIMD, one thread, dedicated worker.')
			session = await ort.InferenceSession.create(bytes, {
				executionProviders: ['wasm'],
				graphOptimizationLevel: 'all',
				logSeverityLevel: diagnostics ? 0 : 2,
				logVerbosityLevel: diagnostics ? 1 : 0,
			})
			if (session.inputNames.length !== 1 || session.outputNames.length !== 3)
				throw new Error('Unexpected RGBNet model interface')
			log(
				`Session created in ${(performance.now() - start).toFixed(1)}ms; input=${session.inputNames.join(',')}; outputs=${session.outputNames.join(',')}.`
			)
			stage = 'warm-up'
			const warmup = new ort.Tensor(
				'float32',
				prepareRgbnet(new Uint8ClampedArray(INPUT_SIZE * INPUT_SIZE * 4), INPUT_SIZE, INPUT_SIZE),
				[1, 3, INPUT_SIZE, INPUT_SIZE]
			)
			try {
				const outputs = await session.run({ [session.inputNames[0]]: warmup })
				try {
					decodeRgbnet(Object.values(outputs).map(t => ({ dims: t.dims, data: t.data as Float32Array })))
				} finally {
					for (const output of Object.values(outputs)) output.dispose()
				}
			} finally {
				warmup.dispose()
			}
			log('Warm-up and output-shape validation complete; detector ready.')
			send({ type: 'ready' })
		} else {
			const { bitmap, id } = data
			try {
				if (!session) throw new Error('Detector session is not ready')
				const { width, height } = bitmap
				if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Unsupported frame size')
				stage = 'frame extraction'
				const start = performance.now()
				trace(`frame ${id}: extraction begin (${width}x${height})`)
				const canvas = new OffscreenCanvas(width, height)
				const context = canvas.getContext('2d', { willReadFrequently: true })
				if (!context) throw new Error('OffscreenCanvas 2D is unavailable')
				context.drawImage(bitmap, 0, 0)
				const pixels = context.getImageData(0, 0, width, height)
				const extracted = performance.now()
				stage = 'preprocessing'
				trace(`frame ${id}: preprocessing begin (bilinear RGB, mean subtraction, NCHW)`)
				let preparedPixels: Float32Array
				try { preparedPixels = prepareRgbnet(pixels.data, width, height) }
				finally { pixels.data.fill(0); canvas.width = 1; canvas.height = 1 }
				const input = new ort.Tensor('float32', preparedPixels, [
					1,
					3,
					INPUT_SIZE,
					INPUT_SIZE,
				])
				const prepared = performance.now()
				try {
					stage = 'inference'
					trace(`frame ${id}: ONNX session.run begin`)
					const outputs = await session.run({ [session.inputNames[0]]: input })
					const inferred = performance.now()
					try {
						stage = 'decoding'
						trace(`frame ${id}: output validation, anchors, confidence filter and NMS begin`)
						const faces = decodeRgbnet(
							Object.values(outputs).map(t => ({ dims: t.dims, data: t.data as Float32Array }))
						)
						const timings = `extract ${(extracted - start).toFixed(1)}ms; preprocess ${(prepared - extracted).toFixed(1)}ms; inference ${(inferred - prepared).toFixed(1)}ms; decode ${(performance.now() - inferred).toFixed(1)}ms`
						trace(`frame ${id}: completed; ${timings}`)
						send({ type: 'result', faces, width, height, id, timings })
					} finally {
						for (const output of Object.values(outputs)) output.dispose()
					}
				} finally {
					preparedPixels.fill(0)
					input.dispose()
					trace(`frame ${id}: tensors disposed`)
				}
			} finally {
				bitmap.close()
				trace(`frame ${id}: bitmap released`)
			}
		}
	} catch {
		// Report the failed stage without exposing runtime buffers or model outputs.
		const message = 'Detector operation failed. Check the pinned model installation and browser WASM support.'
		send({ type: 'error', stage, message })
	} finally {
		busy = false
	}
}
