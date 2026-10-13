import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import resizeReference from './fixtures/rgbnet-resize.json'
import decodeReference from './fixtures/rgbnet-decode.json'
import {
	prepareRgbnet,
	decodeRgbnet,
	previewPoint,
	faceGuidance,
	ANCHOR_COUNT,
	type ModelOutput,
} from '../src/face/rgbnet'

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

test('preview projection accounts for mirror and object-cover crop in landscape and portrait', () => {
	assert.deepEqual(previewPoint(0.5, 0.5, 1920, 1080), [0.5, 0.5])
	const [x, y] = previewPoint(0.25, 0.25, 1920, 1080)
	assert.ok(Math.abs(x - 0.9444444444) < 1e-8)
	assert.equal(y, 0.25)
	const portrait = previewPoint(0.25, 0.25, 1080, 1920)
	assert.equal(portrait[0], 0.75)
	assert.ok(Math.abs(portrait[1] - 0.0555555556) < 1e-8)
})

test('guidance uses the portrait oval crop rather than a square preview', () => {
	const face = { box: [0.29, 0.2, 0.71, 0.8] as [number, number, number, number], landmarks: [], score: 0.99 }
	assert.equal(faceGuidance([face], 640, 480), 'Face positioned')
	assert.equal(faceGuidance([face], 640, 480, 260, 364), 'Face positioned')
	face.box = [0.25, 0.2, 0.75, 0.8]
	assert.equal(faceGuidance([face], 640, 480), 'Face positioned')
	assert.equal(faceGuidance([face], 640, 480, 260, 364), 'Move farther away')
	assert.equal(faceGuidance([face, face], 640, 480, 260, 364), 'Keep only one face in view')
	assert.equal(faceGuidance([face], 640, 480, 0, 0), 'Waiting for camera preview')
})
