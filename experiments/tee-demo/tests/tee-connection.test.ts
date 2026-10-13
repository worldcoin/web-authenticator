import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from '../src/lib/tee-connection'

const token = 'a'.repeat(64)
const origin = 'http://127.0.0.1:8010'
const signal = () => new AbortController().signal
const handshake = () => ({
	protocol_version: 1,
	mode: 'local',
	capabilities: ['face-image-check'],
	expires_at: Math.floor(Date.now() / 1000) + 300,
})
async function withFetch(
	fake: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
	run: () => Promise<void>
) {
	const original = globalThis.fetch
	globalThis.fetch = Object.assign(fake, { preconnect: original.preconnect })
	try {
		await run()
	} finally {
		globalThis.fetch = original
	}
}

test('local handshake sends credential only in header and accepts a ready compatible response', async () => {
	await withFetch(
		async (url, init) => {
			assert.equal(String(url), origin + '/v1/connect')
			assert.equal(init?.method, 'POST')
			assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + token)
			assert.equal(init?.redirect, 'error')
			assert.equal(init?.credentials, 'omit')
			assert.equal(init?.cache, 'no-store')
			assert.ok(init?.signal)
			assert.equal(init?.body, undefined)
			return Response.json(handshake())
		},
		async () => {
			const result = await connect(signal(), token, origin)
			assert.equal(result.status, 'connected')
			assert.ok(!JSON.stringify(result).includes(token))
		}
	)
})

test('forbidden and worker-unavailable responses never establish a connection', async () => {
	for (const [status, expected] of [
		[403, 'forbidden'],
		[503, 'unavailable'],
	] as const) {
		await withFetch(
			async () => new Response(null, { status }),
			async () => {
				assert.equal((await connect(signal(), token, origin)).status, expected)
			}
		)
	}
})

test('rejects remote destinations, URL credentials and malformed tokens before transmitting', async () => {
	await withFetch(
		async () => {
			throw new Error('must not fetch')
		},
		async () => {
			for (const target of [
				'https://example.com',
				'http://127.0.0.1.evil.test:8010',
				'http://user:secret@localhost:8010',
				origin + '/path',
				origin + '?token=bad',
			]) {
				await assert.rejects(connect(signal(), token, target), /loopback/)
			}
			for (const value of ['short', token + '\r\n'])
				assert.equal((await connect(signal(), value, origin)).status, 'forbidden')
		}
	)
})

test('rejects unsupported, incomplete, expired and oversized success responses', async () => {
	for (const data of [
		null,
		{},
		{ ...handshake(), protocol_version: 2 },
		{ ...handshake(), mode: 'nitro' },
		{ ...handshake(), capabilities: [] },
		{ ...handshake(), expires_at: 1 },
		{ ...handshake(), expires_at: Math.floor(Date.now() / 1000) + 3600 },
		{ ...handshake(), padding: 'x'.repeat(5000) },
	]) {
		await withFetch(
			async () => Response.json(data),
			async () => {
				await assert.rejects(connect(signal(), token, origin))
			}
		)
	}
	for (const response of [
		new Response('not JSON', { headers: { 'content-type': 'application/json' } }),
		new Response('oops', { status: 500 }),
	]) {
		await withFetch(
			async () => response,
			async () => {
				await assert.rejects(connect(signal(), token, origin))
			}
		)
	}
})

test('handles network errors without exposing their potentially sensitive message', async () => {
	await withFetch(
		async () => {
			throw new Error(token)
		},
		async () => {
			await assert.rejects(connect(signal(), token, origin), error => {
				assert.ok(error instanceof Error)
				assert.ok(!error.message.includes(token))
				assert.match(error.message, /Cannot reach/)
				return true
			})
		}
	)
})

test('aborted connection does not send a request', async () => {
	await withFetch(
		async () => {
			throw new Error('must not fetch')
		},
		async () => {
			const controller = new AbortController()
			controller.abort()
			await assert.rejects(connect(controller.signal, token, origin), { name: 'AbortError' })
		}
	)
})

test('without a provisioned token still posts and lets the host return forbidden', async () => {
	await withFetch(
		async (url, init) => {
			assert.equal(String(url), origin + '/v1/connect')
			assert.equal(init?.method, 'POST')
			assert.equal(new Headers(init?.headers).has('Authorization'), false)
			return new Response(null, { status: 403 })
		},
		async () => {
			const result = await connect(signal(), '', origin)
			assert.equal(result.status, 'forbidden')
			assert.equal(result.httpStatus, 403)
		}
	)
})
