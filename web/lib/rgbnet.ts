// Port of biometric-engines RGBNet preprocessing/decoding and pixel-space NMS.
// Local capture guidance only. Authoritative TEE validation is not connected here.
export const INPUT_SIZE = 256
export const ANCHOR_COUNT = 2688
export type FaceDetection = { box: [number, number, number, number]; landmarks: number[]; score: number }
export type ModelOutput = { dims: readonly number[]; data: Float32Array }

// fast_image_resize uses fixed-kernel bilinear interpolation, quantized weights,
// and rounds the vertical u8 pass before the horizontal pass. Canvas resizing
// is browser-dependent and does not reproduce this operation.
function axisWeights(size: number) {
	const weights = Array.from({ length: INPUT_SIZE }, (_, i) => {
		const center = ((i + 0.5) * size) / INPUT_SIZE - 0.5
		const left = Math.max(0, Math.min(size - 1, Math.floor(center)))
		const right = Math.max(0, Math.min(size - 1, Math.floor(center) + 1))
		const fraction = left === right ? 0 : center - Math.floor(center)
		return { left, right, a: 1 - fraction, b: fraction }
	})
	const maximum = Math.max(...weights.map(w => Math.max(w.a, w.b)))
	let precision = 0
	while (precision < 21 && Math.round(maximum * 2 ** (precision + 1)) < 32768) precision++
	const scale = 2 ** precision
	return weights.map(w => ({ ...w, a: Math.round(w.a * scale), b: Math.round(w.b * scale), scale }))
}

export function prepareRgbnet(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > 4096 ||
		height > 4096 ||
		rgba.length !== width * height * 4
	)
		throw new Error('Invalid RGBNet frame dimensions or RGBA buffer')
	const xs = axisWeights(width),
		ys = axisWeights(height)
	const plane = INPUT_SIZE * INPUT_SIZE
	const output = new Float32Array(3 * plane)
	const means = [104, 117, 123]
	for (let y = 0; y < INPUT_SIZE; y++) {
		const v = ys[y]
		for (let x = 0; x < INPUT_SIZE; x++) {
			const h = xs[x]
			for (let c = 0; c < 3; c++) {
				const left = Math.round(
					(rgba[(v.left * width + h.left) * 4 + c] * v.a + rgba[(v.right * width + h.left) * 4 + c] * v.b) /
						v.scale
				)
				const right = Math.round(
					(rgba[(v.left * width + h.right) * 4 + c] * v.a + rgba[(v.right * width + h.right) * 4 + c] * v.b) /
						v.scale
				)
				output[c * plane + y * INPUT_SIZE + x] =
					Math.min(255, Math.round((left * h.a + right * h.b) / h.scale)) - means[c]
			}
		}
	}
	return output
}

export const anchors: readonly (readonly number[])[] = [8, 16, 32].flatMap((step, level) => {
	const sizes = [
		[20, 33],
		[53, 87],
		[141, 230],
	][level]
	const grid = INPUT_SIZE / step
	return Array.from({ length: grid * grid }, (_, i) =>
		sizes.map(size => [
			(((i % grid) + 0.5) * step) / INPUT_SIZE,
			((Math.floor(i / grid) + 0.5) * step) / INPUT_SIZE,
			size / INPUT_SIZE,
			size / INPUT_SIZE,
		])
	).flat()
})

export function suppressDuplicates(faces: FaceDetection[], threshold = 0.4): FaceDetection[] {
	const kept: FaceDetection[] = []
	for (const face of [...faces].sort((a, b) => b.score - a.score)) {
		const a = face.box.map(x => x * INPUT_SIZE)
		const area = (a[2] - a[0] + 1) * (a[3] - a[1] + 1)
		if (
			kept.every(other => {
				const b = other.box.map(x => x * INPUT_SIZE)
				const intersection =
					Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1) *
					Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1)
				return intersection / (area + (b[2] - b[0] + 1) * (b[3] - b[1] + 1) - intersection) <= threshold
			})
		)
			kept.push(face)
	}
	return kept
}

export function decodeRgbnet(outputs: ModelOutput[]): FaceDetection[] {
	const heads = new Map<number, Float32Array>()
	for (const output of outputs) {
		const dims = output.dims.length === 3 && output.dims[0] === 1 ? output.dims.slice(1) : output.dims
		const columns = dims[1]
		if (
			dims.length !== 2 ||
			dims[0] !== ANCHOR_COUNT ||
			![2, 4, 10].includes(columns) ||
			heads.has(columns) ||
			!(output.data instanceof Float32Array) ||
			output.data.length !== ANCHOR_COUNT * columns ||
			!output.data.every(Number.isFinite)
		)
			throw new Error('Unexpected RGBNet output shape, type or non-finite value')
		heads.set(columns, output.data)
	}
	if (heads.size !== 3) throw new Error('Missing RGBNet output head')
	const boxes = heads.get(4)!,
		scores = heads.get(2)!,
		points = heads.get(10)!
	const faces: FaceDetection[] = []
	const f = Math.fround,
		clamp = (n: number) => Math.min(1, Math.max(0, n))
	for (let i = 0; i < ANCHOR_COUNT; i++) {
		if (scores[i * 2 + 1] <= f(0.8)) continue
		const anchor = anchors[i]
		const center = [0, 1].map(c => f(f(f(boxes[i * 4 + c] * f(0.1)) * anchor[c + 2]) + anchor[c]))
		const size = [0, 1].map(c => f(f(Math.exp(f(boxes[i * 4 + c + 2] * f(0.2)))) * anchor[c + 2]))
		const start = center.map((v, c) => f(v - f(size[c] / 2)))
		const box: FaceDetection['box'] = [
			clamp(start[0]),
			clamp(start[1]),
			clamp(f(start[0] + size[0])),
			clamp(f(start[1] + size[1])),
		]
		const landmarks = Array.from({ length: 10 }, (_, j) =>
			clamp(f(f(f(points[i * 10 + j] * f(0.1)) * anchor[(j % 2) + 2]) + anchor[j % 2]))
		)
		if (![...box, ...landmarks].every(Number.isFinite)) throw new Error('Invalid decoded RGBNet coordinates')
		faces.push({ box, landmarks, score: scores[i * 2 + 1] })
	}
	return suppressDuplicates(faces)
}

// Normalized source coordinates -> mirrored, centered object-cover preview.
export function previewPoint(x: number, y: number, width: number, height: number, viewWidth = 1, viewHeight = 1): [number, number] {
	const scale = Math.max(viewWidth / width, viewHeight / height)
	return [1 - (x * width * scale - (width * scale - viewWidth) / 2) / viewWidth, (y * height * scale - (height * scale - viewHeight) / 2) / viewHeight]
}

export function faceGuidance(faces: FaceDetection[], width: number, height: number, viewWidth = 1, viewHeight = 1): string {
	if (![width, height, viewWidth, viewHeight].every(value => Number.isFinite(value) && value > 0)) return 'Waiting for camera preview'
	if (!faces.length) return 'No face detected'
	if (faces.length > 1) return 'Keep only one face in view'
	const [x1, y1, x2, y2] = faces[0].box
	const [cx, cy] = previewPoint((x1 + x2) / 2, (y1 + y2) / 2, width, height, viewWidth, viewHeight)
	const scale = Math.max(viewWidth / width, viewHeight / height)
	const visibleWidth = (x2 - x1) * width * scale / viewWidth
	const visibleHeight = (y2 - y1) * height * scale / viewHeight
	if (Math.hypot(cx - 0.5, cy - 0.5) > 0.12) return 'Center your face'
	if (visibleWidth < 0.25 || visibleHeight < 0.35) return 'Move closer'
	if (visibleWidth > 0.8 || visibleHeight > 0.85) return 'Move farther away'
	return 'Face positioned'
}
