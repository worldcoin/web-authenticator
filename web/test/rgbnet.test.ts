import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import resizeReference from './fixtures/rgbnet-resize.json'
import decodeReference from './fixtures/rgbnet-decode.json'
import {
	prepareRgbnet,
	decodeRgbnet,
	previewCrop,
	faceGuidance,
	ANCHOR_COUNT,
	type ModelOutput,
} from '../lib/rgbnet'

function outputs(): ModelOutput[] {
	return [4, 2, 10].map(n => ({ dims: [1, ANCHOR_COUNT, n], data: new Float32Array(ANCHOR_COUNT * n) }))
}

test('RGBNet preprocessing matches native fast_image_resize reference tensors byte for byte', () => {
	for (const { width, height, sha256 } of resizeReference) {
		const rgba = Uint8ClampedArray.from(
			{ length: width * height * 4 },
			(_, i) => (i * 37 + Math.floor(i / 13)) % 256
		)
		const tensor = prepareRgbnet(rgba, width, height)
		assert.equal(
			createHash('sha256').update(new Uint8Array(tensor.buffer)).digest('hex'),
			sha256,
			`${width}x${height}`
		)
	}
})

test('RGBNet decode matches native Rust boxes, landmarks and suppression with shuffled output heads', () => {
	const heads = outputs()
	for (const row of decodeReference.rows) {
		heads[0].data.set(row.box, row.anchor * 4)
		heads[1].data.set([1 - row.score, row.score], row.anchor * 2)
		heads[2].data.set(row.landmarks, row.anchor * 10)
	}
	const actual = decodeRgbnet([heads[2], heads[0], heads[1]])
	assert.equal(actual.length, decodeReference.expected.length)
	actual.forEach((face, i) => {
		const expected = decodeReference.expected[i]
		for (const key of ['box', 'landmarks'] as const)
			face[key].forEach((value, j) => assert.ok(Math.abs(value - expected[key][j]) < 1e-7))
		assert.ok(Math.abs(face.score - expected.score) < 1e-7)
	})
})

test('invalid frames and missing, malformed or non-finite output heads fail explicitly', () => {
	assert.throws(() => prepareRgbnet(new Uint8ClampedArray(4), 0, 1), /dimensions/)
	assert.throws(() => prepareRgbnet(new Uint8ClampedArray(4), 2, 2), /dimensions/)
	assert.throws(() => decodeRgbnet([]), /Missing/)
	const heads = outputs()
	assert.throws(() => decodeRgbnet([heads[0], heads[0], heads[2]]), /Unexpected/)
	heads[0].data[0] = NaN
	assert.throws(() => decodeRgbnet(heads), /non-finite/)
	heads[0].data[0] = 0
	heads[0].dims = [1, 4]
	assert.throws(() => decodeRgbnet(heads), /shape/)
})

test('empty detections and confidence boundary do not report a positioned face', () => {
	const heads = outputs()
	heads[1].data[1] = 0.8
	assert.deepEqual(decodeRgbnet(heads), [])
	assert.equal(faceGuidance([], 640, 480), 'No face detected')
})

test('preview crop is the centered object-cover region for landscape, portrait and square views', () => {
	// 1280x720 webcam into the 260x364 oval: full height, 514 px centered width.
	assert.deepEqual(previewCrop(1280, 720, 260, 364), [383, 0, 514, 720])
	// A portrait phone camera is already narrower than the oval: full width, trimmed height.
	assert.deepEqual(previewCrop(720, 1280, 260, 364), [0, 136, 720, 1008])
	assert.deepEqual(previewCrop(640, 480), [80, 0, 480, 480])
})

// Builds a camera-frame detection from a box expressed in the cropped (sent) image.
function inCrop(box: [number, number, number, number], width: number, height: number, viewWidth: number, viewHeight: number) {
	const [sx, sy, sw, sh] = previewCrop(width, height, viewWidth, viewHeight)
	const frame = [(sx + box[0] * sw) / width, (sy + box[1] * sh) / height, (sx + box[2] * sw) / width, (sy + box[3] * sh) / height]
	return { box: frame as [number, number, number, number], landmarks: [], score: 0.99 }
}

test('guidance applies the face engine framing thresholds to the cropped image', () => {
	const at = (box: [number, number, number, number]) => faceGuidance([inCrop(box, 1280, 720, 260, 364)], 1280, 720, 260, 364)
	assert.equal(at([0.2, 0.15, 0.8, 0.85]), 'Face positioned')
	// Smaller axis 0.4 <= 0.52: FaceTooSmallError.
	assert.equal(at([0.3, 0.2, 0.7, 0.8]), 'Move closer')
	// Larger axis 0.9 >= 0.8: FaceTooBigError, reported before the edge it also crosses.
	assert.equal(at([0.1, 0.05, 0.9, 0.95]), 'Move farther away')
	// Size passes, but the box is inside the 0.015 edge margin.
	assert.equal(at([0.005, 0.15, 0.6, 0.85]), 'Center your face')
	// Sizes pass relative to a 129x180 crop, but 0.6 x 129 px is below the 112 px resolution floor.
	assert.equal(faceGuidance([inCrop([0.2, 0.15, 0.8, 0.85], 320, 180, 260, 364)], 320, 180, 260, 364), 'Move closer')
})

test('a face filling the oval would be too small in the uncropped 16:9 frame', () => {
	const face = inCrop([0.2, 0.15, 0.8, 0.85], 1280, 720, 260, 364)
	assert.equal(faceGuidance([face], 1280, 720, 260, 364), 'Face positioned')
	// Judged against the whole frame (a 16:9 view crops nothing), the same face spans 0.24 of the width.
	assert.equal(faceGuidance([face], 1280, 720, 1280, 720), 'Move closer')
})

test('guidance reports missing, multiple and unmeasurable faces', () => {
	const face = inCrop([0.2, 0.15, 0.8, 0.85], 1280, 720, 260, 364)
	assert.equal(faceGuidance([face, face], 1280, 720, 260, 364), 'Keep only one face in view')
	assert.equal(faceGuidance([face], 1280, 720, 0, 0), 'Waiting for camera preview')
})
