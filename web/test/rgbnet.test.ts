import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import resizeReference from './fixtures/rgbnet-resize.json'
import decodeReference from './fixtures/rgbnet-decode.json'
import {
	prepareRgbnet,
	decodeRgbnet,
	previewCrop,
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

test('detections at the confidence boundary are dropped', () => {
	const heads = outputs()
	heads[1].data[1] = 0.8
	assert.deepEqual(decodeRgbnet(heads), [])
})

test('preview crop is the centered object-cover region for landscape, portrait and square views', () => {
	// 1280x720 webcam into the 260x364 oval: full height, 514 px centered width.
	assert.deepEqual(previewCrop(1280, 720, 260, 364), [383, 0, 514, 720])
	// A portrait phone camera is already narrower than the oval: full width, trimmed height.
	assert.deepEqual(previewCrop(720, 1280, 260, 364), [0, 136, 720, 1008])
	assert.deepEqual(previewCrop(640, 480), [80, 0, 480, 480])
})
