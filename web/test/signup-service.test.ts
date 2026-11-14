import { expect, spyOn, test } from 'bun:test'
import {
	type EnrollmentReceipt,
	type SignupServiceOptions,
	SignupServiceError,
	getEnrollmentStatus,
	pollEnrollment,
	submitEnrollment,
} from '../lib/signup-service'
import type { EnrollmentCapture } from '../lib/enrollment-contract'

const SUB = '0x123abc'
const CAPTURE_ID = '01234567-89ab-4cde-8f01-23456789abcd'
const CHALLENGE_ID = '01234567-89ab-4cde-8f01-23456789abce'
const ENDPOINT = 'https://app.stage.face.worldcoin.org/api/v2/identity'
const proofCbor = new Uint8Array([0xa1, 0x00, 0x43, 0x00, 0x80, 0xff])
const authorization = { challengeId: CHALLENGE_ID, proofCbor }

function capture(): EnrollmentCapture {
	return {
		fields: Object.entries({
			contract_version: '2', sub: SUB, capture_id: CAPTURE_ID, timestamp: '1800000000',
			face_embedding_shares_0: btoa('a'.repeat(48)),
			face_embedding_shares_1: btoa('b'.repeat(48)),
			face_embedding_shares_2: btoa('c'.repeat(48)),
			face_embedding_version: '1', face_embedding_type: 'face', face_embedding_inference_backend: 'test',
			pcp_version: '1', associated_data_hash: '0x' + 'a'.repeat(64),
		}).map(([name, value]) => ({ name, value })),
		attestation_header: btoa('synthetic attestation'),
	}
}

function receipt(): EnrollmentReceipt {
	return { sub: SUB, captureId: CAPTURE_ID, pollingToken: 'A'.repeat(43), pollingTokenExpiresAt: new Date(Date.now() + 900_000).toISOString() }
}

function receiptWire() {
	const value = receipt()
	return { sub: value.sub, capture_id: value.captureId, polling_token: value.pollingToken, polling_token_expires_at: value.pollingTokenExpiresAt }
}

function statusWire(status = 'InProgress', extra: Record<string, unknown> = {}) {
	return { sub: SUB, capture_id: CAPTURE_ID, status, unique: false, ...extra }
}

function options(signal = new AbortController().signal): SignupServiceOptions {
	return { endpoint: ENDPOINT, signal }
}

async function withFetch(
	respond: (url: URL, init: RequestInit) => Response | Promise<Response>,
	run: () => Promise<void>,
) {
	const mocked = spyOn(globalThis, 'fetch').mockImplementation((async (input, init) =>
		respond(new URL(input instanceof Request ? input.url : input), init ?? {})) as typeof fetch)
	try { await run() } finally { mocked.mockRestore() }
}

test('submits unchanged attested fields, a raw CBOR file, and only the Nitro header', async () => {
	const bundle = capture()
	const wire = receiptWire()
	let calls = 0
	await withFetch(async (url, init) => {
		calls++
		expect(url.href).toBe(ENDPOINT)
		expect(init.method).toBe('PUT')
		expect(init.credentials).toBe('omit')
		expect(init.redirect).toBe('error')
		expect(init.cache).toBe('no-store')
		const headers = new Headers(init.headers)
		expect([...headers]).toEqual([['x-nitro-attestation', bundle.attestation_header]])
		const body = init.body as FormData
		expect([...body.keys()]).toEqual([...bundle.fields.map(field => field.name), 'world_id_challenge_id', 'world_id_ownership_proof'])
		for (const field of bundle.fields) expect(body.get(field.name)).toBe(field.value)
		expect(body.get('world_id_challenge_id')).toBe(CHALLENGE_ID)
		const file = body.get('world_id_ownership_proof') as File
		expect(file.name).toBe('ownership-proof.cbor')
		expect(file.type).toBe('application/cbor')
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(proofCbor)
		return Response.json(wire, { status: 202 })
	}, async () => {
		expect(await submitEnrollment(bundle, authorization, options())).toEqual({
			sub: SUB, captureId: CAPTURE_ID, pollingToken: wire.polling_token, pollingTokenExpiresAt: wire.polling_token_expires_at,
		})
	})
	expect(calls).toBe(1)
})

test('rejects malformed capture, authorization and endpoints before making a request', async () => {
	let calls = 0
	await withFetch(() => { calls++; return Response.json(receiptWire(), { status: 202 }) }, async () => {
		await expect(submitEnrollment({ ...capture(), fields: [] }, authorization, options())).rejects.toBeInstanceOf(TypeError)
		for (const invalid of [
			{ challengeId: 'not-a-uuid', proofCbor },
			{ challengeId: CHALLENGE_ID, proofCbor: new Uint8Array() },
			{ challengeId: CHALLENGE_ID, proofCbor: new Uint8Array(768 * 1024 + 1) },
		]) await expect(submitEnrollment(capture(), invalid, options())).rejects.toBeInstanceOf(TypeError)
		for (const endpoint of [
			'http://app.stage.face.worldcoin.org/api/v2/identity',
			ENDPOINT + '?redirect=https://other.example', ENDPOINT + '#fragment',
			'https://user:password@app.stage.face.worldcoin.org/api/v2/identity',
			'https://app.stage.face.worldcoin.org/api/v1/identity',
		]) await expect(submitEnrollment(capture(), authorization, { ...options(), endpoint })).rejects.toBeInstanceOf(TypeError)
	})
	expect(calls).toBe(0)
})

test('validates receipt identity, grant encoding, and expiry', async () => {
	const changes = [
		{ sub: '0x123abd' }, { capture_id: CHALLENGE_ID },
		{ polling_token: 'not-a-token' }, { polling_token: 'A'.repeat(42) + 'B' },
		{ polling_token_expires_at: 'tomorrow' },
		{ polling_token_expires_at: '2030-01-01T00:15:00.1234567890Z' },
		...['sub', 'capture_id', 'polling_token', 'polling_token_expires_at'].flatMap(key =>
			[undefined, null, 42].map(value => ({ [key]: value }))),
	]
	for (const wire of [null, [], 'receipt', ...changes.map(change => ({ ...receiptWire(), ...change }))]) {
		await withFetch(() => Response.json(wire, { status: 202 }), async () => {
			await expect(submitEnrollment(capture(), authorization, options())).rejects.toMatchObject({
				code: 'invalid_response', retryable: true, status: 202,
				message: 'Enrollment submission could not be confirmed. Keep this capture; retrying requires a fresh ownership proof.',
			})
		})
	}
	await withFetch(() => Response.json({ ...receiptWire(), polling_token_expires_at: new Date(0).toISOString() }, { status: 202 }), async () => {
		await expect(submitEnrollment(capture(), authorization, options())).rejects.toMatchObject({ code: 'polling_grant_expired', retryable: false })
	})
})

test('preserves supported expiry offsets, fractional precision, and UUID-shaped capture identifiers', async () => {
	const clock = spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'))
	const captureId = '01234567-89ab-0cde-0f01-23456789abcd'
	const original = capture()
	const bundle = { ...original, fields: original.fields.map(field => field.name === 'capture_id' ? { ...field, value: captureId } : field) }
	try {
		for (const expires of ['2030-01-01T00:15:00Z', '2030-01-01T00:15:00.123456789Z', '2030-01-01T01:15:00.123456789+01:00', '2029-12-31T19:15:00-05:00']) {
			await withFetch((_url, init) => init.method === 'PUT'
				? Response.json({ ...receiptWire(), capture_id: captureId, polling_token_expires_at: expires }, { status: 202 })
				: Response.json(statusWire('Completed', { capture_id: captureId })), async () => {
				const grant = await submitEnrollment(bundle, authorization, options())
				expect(grant.pollingTokenExpiresAt).toBe(expires)
				expect(await getEnrollmentStatus(grant, options())).toEqual({ sub: SUB, captureId, state: 'duplicate' })
			})
		}
	} finally { clock.mockRestore() }
})

test('surfaces a retryable submit error without replaying its consumed ownership proof', async () => {
	for (const [body, status, expected] of [
		[{ error: 'polling_grant_unavailable', retryable: true }, 503, { code: 'polling_grant_unavailable', retryable: true, status: 503 }],
		[{ error: 'invalid_capture', retryable: false, metadata: { version: 3 } }, 400, { code: 'invalid_capture', retryable: false, status: 400 }],
		[{ error: null, retryable: true }, 503, { code: 'invalid_response', retryable: true, status: 503, message: 'Signup service returned an invalid enrollment response (HTTP 503).' }],
	] as const) {
		let calls = 0
		await withFetch(() => { calls++; return Response.json(body, { status }) }, async () => {
			await expect(submitEnrollment(capture(), authorization, options())).rejects.toMatchObject(expected)
		})
		expect(calls).toBe(1)
	}
})

test('an ambiguous submission reports that a fresh proof is required and is not retried', async () => {
	let calls = 0
	await withFetch(() => { calls++; throw new TypeError('connection lost') }, async () => {
		await expect(submitEnrollment(capture(), authorization, options())).rejects.toMatchObject({ code: 'request_failed', retryable: true })
	})
	expect(calls).toBe(1)
})

test('polls the configured endpoint using only the expected subject and bearer token', async () => {
	const grant = receipt()
	await withFetch((url, init) => {
		expect(url.origin + url.pathname).toBe(ENDPOINT)
		expect([...url.searchParams]).toEqual([['sub', SUB]])
		expect(init.method).toBe('GET')
		expect(init.credentials).toBe('omit')
		expect(init.redirect).toBe('error')
		expect([...new Headers(init.headers)]).toEqual([['authorization', `Bearer ${grant.pollingToken}`]])
		return Response.json(statusWire())
	}, async () => {
		expect(await getEnrollmentStatus(grant, options())).toEqual({ sub: SUB, captureId: CAPTURE_ID, state: 'pending', status: 'InProgress' })
	})
})

test('decodes signed credential bytes and distinguishes duplicate, failed, and expired captures', async () => {
	const bytes = new TextEncoder().encode('{"version":"1","signature":"synthetic"}')
	const credential = btoa(String.fromCharCode(...bytes))
	const cases = [
		[statusWire('Completed', { unique: true, credential }), { state: 'completed', credential: bytes }],
		[statusWire('Completed'), { state: 'duplicate' }],
		[statusWire('Received', { unique: true }), { state: 'pending', status: 'Received' }],
		[statusWire('PendingActivation'), { state: 'pending', status: 'PendingActivation' }],
		[statusWire('Failed', { error: 'MPC_RESULT_FAILED' }), { state: 'failed', reason: 'MPC_RESULT_FAILED' }],
		[statusWire('Error', { unique: true }), { state: 'failed' }],
		[statusWire('Expired', { unique: true }), { state: 'expired' }],
	] as const
	for (const [wire, expected] of cases) await withFetch(() => Response.json(wire), async () => {
		expect(await getEnrollmentStatus(receipt(), options())).toEqual({ sub: SUB, captureId: CAPTURE_ID, ...expected })
	})
})

test('rejects polling responses for another capture or with inconsistent completion data', async () => {
	for (const wire of [
		null, [], 'status',
		...['sub', 'capture_id', 'status', 'unique'].flatMap(key =>
			[undefined, null, 42].map(value => statusWire('InProgress', { [key]: value }))),
		statusWire('InProgress', { sub: '0x456' }), statusWire('InProgress', { capture_id: CHALLENGE_ID }),
		statusWire('NewStatus'), statusWire('Completed', { unique: true }),
		statusWire('Completed', { unique: true, credential: null }),
		statusWire('Completed', { unique: true, credential: 42 }),
		statusWire('Completed', { unique: true, credential: '' }),
		statusWire('Completed', { unique: true, credential: 'not base64' }),
		statusWire('Completed', { unique: true, credential: 'AB==' }),
		statusWire('Completed', { credential: btoa('{}') }), statusWire('Received', { credential: btoa('{}') }),
		...['Received', 'InProgress', 'PendingActivation', 'Completed', 'Failed', 'Error', 'Expired'].map(status => statusWire(status, { credential: null })),
		statusWire('InProgress', { unique: 'false' }), statusWire('InProgress', { error: null }),
		statusWire('InProgress', { error: 42 }),
		statusWire('Failed', { error: 'x'.repeat(1025) }),
		statusWire('Failed', { error: '😀'.repeat(513) }),
	]) await withFetch(() => Response.json(wire), async () => {
		await expect(getEnrollmentStatus(receipt(), options())).rejects.toMatchObject({ code: 'invalid_response' })
	})
})

test('ignores additive receipt and status metadata without following response URLs', async () => {
	const wire = receiptWire()
	let calls = 0
	await withFetch(url => {
		expect(url.origin + url.pathname).toBe(ENDPOINT)
		const body = ++calls === 1 ? wire : statusWire('Completed')
		return Response.json({ ...body, metadata: { version: 3 }, polling_url: 'https://other.example/collect' }, { status: calls === 1 ? 202 : 200 })
	}, async () => {
		const grant = await submitEnrollment(capture(), authorization, options())
		expect(grant).toEqual({ sub: SUB, captureId: CAPTURE_ID, pollingToken: wire.polling_token, pollingTokenExpiresAt: wire.polling_token_expires_at })
		expect(await getEnrollmentStatus(grant, options())).toEqual({ sub: SUB, captureId: CAPTURE_ID, state: 'duplicate' })
	})
})

test('recognizes a failed capture with free-form backend text without returning that text', async () => {
	for (const error of ['MPC response missing for private subject 0x123abc', 'NEW_BACKEND_ERROR', '😀'.repeat(512)]) {
		await withFetch(() => Response.json(statusWire('Failed', { error })), async () => {
			expect(await getEnrollmentStatus(receipt(), options())).toEqual({
				sub: SUB, captureId: CAPTURE_ID, state: 'failed', reason: 'capture_processing_failed',
			})
		})
	}
})

test('preserves edge HTTP status and retryability for HTML and malformed JSON failures', async () => {
	for (const status of [403, 429, 503]) {
		for (const json of [false, true]) {
			const privateText = 'private edge diagnostic payload'
			const response = new Response(json ? '{' + privateText : `<html>${privateText}</html>`, {
				status, headers: { 'Content-Type': json ? 'application/json' : 'text/html' },
			})
			await withFetch(() => response, async () => {
				await expect(getEnrollmentStatus(receipt(), options())).rejects.toMatchObject({
					code: 'invalid_response', status, retryable: status !== 403,
					message: `Signup service returned an invalid enrollment response (HTTP ${status}).`,
				})
			})
		}
	}
})

test('expired receipts fail before networking and invalid server grants stop polling', async () => {
	let calls = 0
	await withFetch(() => { calls++; return Response.json({ error: 'polling_grant_invalid', retryable: false }, { status: 401 }) }, async () => {
		await expect(getEnrollmentStatus({ ...receipt(), pollingTokenExpiresAt: new Date(0).toISOString() }, options())).rejects.toMatchObject({ code: 'polling_grant_expired' })
		expect(calls).toBe(0)
		await expect(pollEnrollment(receipt(), options())).rejects.toMatchObject({ code: 'polling_grant_invalid', retryable: false, status: 401 })
	})
	expect(calls).toBe(1)
})

test('polling makes no retries after a failed GET', async () => {
	let calls = 0
	await withFetch(() => { calls++; return Response.json({ error: 'capture_store_unavailable', retryable: true }, { status: 503 }) }, async () => {
		await expect(pollEnrollment(receipt(), options())).rejects.toMatchObject({ code: 'capture_store_unavailable', retryable: true })
	})
	expect(calls).toBe(1)
})

test('polling waits between pending responses and stops at completion', async () => {
	let calls = 0
	const delays: number[] = []
	const originalTimeout = globalThis.setTimeout
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
		delays.push(delay ?? 0)
		return originalTimeout(callback, 0, ...args)
	}) as typeof setTimeout)
	try {
		await withFetch(() => Response.json(statusWire(++calls === 1 ? 'Received' : 'Completed')), async () => {
			expect(await pollEnrollment(receipt(), options())).toMatchObject({ state: 'duplicate' })
		})
		expect(calls).toBe(2)
		expect(delays).toContain(1000)
	} finally { timer.mockRestore() }
})

test('the polling deadline is bounded by two minutes and reports a resumable pending capture', async () => {
	const deadline = new AbortController()
	const originalTimeout = AbortSignal.timeout
	const timeout = spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 120_000 ? deadline.signal : originalTimeout(ms))
	try {
		await withFetch(() => {
			deadline.abort(new DOMException('Timed out', 'TimeoutError'))
			return Response.json(statusWire())
		}, async () => {
			await expect(pollEnrollment(receipt(), options())).rejects.toMatchObject({
				code: 'polling_timeout', retryable: true, message: 'Enrollment is still pending. Resume polling with this receipt.',
			})
		})
		expect(timeout).toHaveBeenCalledWith(120_000)
	} finally { timeout.mockRestore() }
})

test('polling uses the earlier grant expiry as its deadline', async () => {
	const now = Date.now()
	const clock = spyOn(Date, 'now').mockReturnValue(now)
	const timeout = spyOn(AbortSignal, 'timeout')
	try {
		await withFetch(() => Response.json(statusWire('Completed')), async () => {
			await pollEnrollment({ ...receipt(), pollingTokenExpiresAt: new Date(now + 2500).toISOString() }, options())
		})
		expect(timeout).toHaveBeenCalledWith(2500)
	} finally { timeout.mockRestore(); clock.mockRestore() }
})

test('cancellation interrupts a pending cadence and a pre-aborted call never fetches', async () => {
	const controller = new AbortController()
	const reason = new DOMException('Cancelled', 'AbortError')
	let calls = 0
	await withFetch(() => {
		calls++
		setTimeout(() => controller.abort(reason), 0)
		return Response.json(statusWire())
	}, async () => {
		await expect(pollEnrollment(receipt(), options(controller.signal))).rejects.toBe(reason)
		await expect(getEnrollmentStatus(receipt(), options(controller.signal))).rejects.toBe(reason)
	})
	expect(calls).toBe(1)
})

test('each request has a ten-second deadline including stalled response bodies', async () => {
	const deadline = new AbortController()
	const timeout = spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
	let cancelled = false
	try {
		await withFetch(() => new Response(new ReadableStream({
			start() { setTimeout(() => deadline.abort(new DOMException('Timed out', 'TimeoutError')), 0) },
			cancel() { cancelled = true },
		}), { headers: { 'Content-Type': 'application/json' } }), async () => {
			await expect(getEnrollmentStatus(receipt(), options())).rejects.toMatchObject({ code: 'request_timeout', retryable: true })
		})
		expect(timeout).toHaveBeenCalledWith(10_000)
		expect(cancelled).toBe(true)
	} finally { timeout.mockRestore() }
})

test('rejects oversized streamed responses and abandons their bodies', async () => {
	let cancelled = false
	await withFetch(() => new Response(new ReadableStream({
		start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)) },
		cancel() { cancelled = true },
	}), { headers: { 'Content-Type': 'application/json' } }), async () => {
		await expect(getEnrollmentStatus(receipt(), options())).rejects.toMatchObject({ code: 'invalid_response' })
	})
	expect(cancelled).toBe(true)
})

test('rejects malformed responses without exposing arbitrary server text in errors', async () => {
	const sensitive = 'arbitrary private upstream payload'
	for (const response of [
		new Response(sensitive, { status: 502 }),
		new Response('{', { headers: { 'Content-Type': 'application/json' } }),
		Response.json({ error: sensitive, retryable: true }, { status: 503 }),
		Response.json({ error: 'x'.repeat(129), retryable: true }, { status: 503 }),
		...[null, [], { retryable: true }, { error: 'capture_store_unavailable' },
			{ error: null, retryable: true }, { error: 42, retryable: true },
			{ error: 'capture_store_unavailable', retryable: null }, { error: 'capture_store_unavailable', retryable: 'true' },
		].map(body => Response.json(body, { status: 503 })),
		Response.json(statusWire('Completed', { unique: true, credential: sensitive })),
	]) await withFetch(() => response, async () => {
		try {
			await getEnrollmentStatus(receipt(), options())
			throw new Error('Expected response rejection')
		} catch (error) {
			expect(error).toBeInstanceOf(SignupServiceError)
			expect((error as SignupServiceError).code).toBe('invalid_response')
			expect((error as Error).message).not.toContain(sensitive)
		}
	})
})
