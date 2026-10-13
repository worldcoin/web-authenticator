import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { derivePasskeySecrets } from '../src/lib/passkey-secrets'
import { prfBytes, describePrfValue } from '../src/lib/prf-result'

test('1Password byte arrays derive exactly the same secrets as native buffers', async () => {
	const first = Array.from({ length: 32 }, (_, i) => i)
	const second = Array.from({ length: 32 }, (_, i) => 255 - i)
	const normalized = await derivePasskeySecrets(prfBytes(first)!.buffer, prfBytes(second)!.buffer)
	const native = await derivePasskeySecrets(Uint8Array.from(first).buffer, Uint8Array.from(second).buffer)
	assert.deepEqual(normalized, native)
})

test('normalizes typed-array slices and cross-realm buffers', () => {
	const backing = new Uint8Array(40).fill(9)
	assert.deepEqual(prfBytes(backing.subarray(4, 36)), new Uint8Array(32).fill(9))
	assert.equal(backing[0], 9)
	assert.ok(backing.subarray(4, 36).every(byte => byte === 0))
	assert.deepEqual(prfBytes(runInNewContext('new Uint8Array(32).fill(7).buffer')), new Uint8Array(32).fill(7))
})

test('rejects malformed outputs rather than coercing bytes', () => {
	for (const value of [
		undefined,
		null,
		'secret',
		new Array(32),
		Array(31).fill(1),
		Array(33).fill(1),
		Array(32).fill(-1),
		Array(32).fill(256),
		Array(32).fill(1.5),
		Array(32).fill('7'),
		Array(32).fill(NaN),
		new Uint8Array(31),
	]) {
		assert.equal(prfBytes(value), undefined)
	}
})

test('diagnostic output contains shape only, never PRF values', () => {
	assert.deepEqual(describePrfValue(Array(32).fill(123)), { type: 'array', byteLength: 32 })
	assert.deepEqual(describePrfValue(new Uint8Array(32).buffer), { type: 'array-buffer', byteLength: 32 })
	assert.deepEqual(describePrfValue(undefined), { type: 'missing' })
})
