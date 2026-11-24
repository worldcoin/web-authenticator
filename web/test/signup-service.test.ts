import { expect, spyOn, test } from 'bun:test'
import {
	type EnrollmentReceipt,
	type SignupServiceOptions,
	SignupServiceError,
	getEnrollmentStatus,
	getIdentityStatus,
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
	return { sub: SUB, captureId: CAPTURE_ID }
}

function statusWire(status = 'ENROLLMENT_IN_PROGRESS', extra: Record<string, unknown> = {}) {
	return {
		status: status === 'ENROLLMENT_UNIQUE_SUCCESSFUL' ? 'VERIFIED' : 'NEW',
		enrollment_status: { capture_id: CAPTURE_ID, status, ...extra },
	}
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
	const wire = {}
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
		expect(await submitEnrollment(bundle, authorization, options())).toEqual(receipt())
	})
	expect(calls).toBe(1)
})

test('rejects malformed capture, authorization and endpoints before making a request', async () => {
	let calls = 0
	await withFetch(() => { calls++; return Response.json({}, { status: 202 }) }, async () => {
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

test('rejects malformed acceptance bodies as unconfirmed submissions', async () => {
	for (const wire of [null, [], 'receipt', 42]) {
		await withFetch(() => Response.json(wire, { status: 202 }), async () => {
			await expect(submitEnrollment(capture(), authorization, options())).rejects.toMatchObject({
				code: 'invalid_response', retryable: true, status: 202,
				message: 'Enrollment submission could not be confirmed. Keep this capture and check its status.',
			})
		})
	}
})

test('handles v1-compatible empty errors and rate limits without replaying PUT', async () => {
	for (const status of [400, 401, 408, 409, 413, 422, 500, 503]) {
		let calls = 0
		await withFetch(() => { calls++; return new Response(null, { status }) }, async () => {
			await expect(submitEnrollment(capture(), authorization, options())).rejects.toMatchObject({
				code: 'http_error', status, retryable: status === 408 || status >= 500,
			})
			await expect(getEnrollmentStatus(receipt(), options())).rejects.toMatchObject({ code: 'http_error', status })
		})
		expect(calls).toBe(2)
	}
	await withFetch(() => Response.json({ error: 'RATE_LIMIT_EXCEEDED' }, { status: 429 }), async () => {
		await expect(submitEnrollment(capture(), authorization, options())).rejects.toMatchObject({
			code: 'RATE_LIMIT_EXCEEDED', status: 429, retryable: true,
		})
	})
})

test('accepts canonical UUID-shaped capture identifiers without a fixed version', async () => {
	const captureId = '01234567-89ab-0cde-0f01-23456789abcd'
	const original = capture()
	const bundle = { ...original, fields: original.fields.map(field => field.name === 'capture_id' ? { ...field, value: captureId } : field) }
	await withFetch((_url, init) => init.method === 'PUT'
		? Response.json({}, { status: 202 })
		: Response.json(statusWire('ENROLLMENT_NOT_UNIQUE', { capture_id: captureId })), async () => {
		const accepted = await submitEnrollment(bundle, authorization, options())
		expect(accepted).toEqual({ sub: SUB, captureId })
		expect(await getEnrollmentStatus(accepted, options())).toEqual({ sub: SUB, captureId, state: 'duplicate' })
	})
})

test('surfaces a retryable submit error without replaying its consumed ownership proof', async () => {
	for (const [body, status, expected] of [
		[{ error: 'capture_store_unavailable', retryable: true }, 503, { code: 'capture_store_unavailable', retryable: true, status: 503 }],
		[{ error: 'subject_bound_to_other_identity', retryable: false }, 409, { code: 'subject_bound_to_other_identity', retryable: false, status: 409 }],
		[{ error: 'temporarily_disabled', retryable: false }, 503, { code: 'temporarily_disabled', retryable: false, status: 503 }],
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

test('polls the configured endpoint using only the expected subject without authorization', async () => {
	await withFetch((url, init) => {
		expect(url.origin + url.pathname).toBe(ENDPOINT)
		expect([...url.searchParams]).toEqual([['sub', SUB]])
		expect(init.method).toBe('GET')
		expect(init.credentials).toBe('omit')
		expect(init.redirect).toBe('error')
		expect([...new Headers(init.headers)]).toEqual([])
		return Response.json(statusWire())
	}, async () => {
		expect(await getEnrollmentStatus(receipt(), options())).toEqual({ sub: SUB, captureId: CAPTURE_ID, state: 'pending', status: 'ENROLLMENT_IN_PROGRESS' })
	})
})

test('returns the public identity DTO independently of a submitted capture', async () => {
	for (const body of [
		{ status: 'NEW' },
		{ status: 'VERIFIED', last_successful_capture_id: 'older-mobile-capture',
			enrollment_status: { status: 'ENROLLMENT_IN_PROGRESS', capture_id: 'new-capture', credential: 'previous-credential' } },
		{ status: 'UNVERIFIED', deletion_status: { identity_status: 'active', deletion_request_id: 'deletion-id' } },
	] as const) await withFetch(() => Response.json(body), async () => {
		expect(await getIdentityStatus(SUB, options())).toEqual(body)
	})
})

test('uses the same four public enrollment outcomes as Oxide', async () => {
	const bytes = new TextEncoder().encode('{"version":"1","signature":"synthetic"}')
	const credential = btoa(String.fromCharCode(...bytes))
	const cases = [
		[statusWire('ENROLLMENT_UNIQUE_SUCCESSFUL', { credential }), { state: 'completed', credential: bytes }],
		[statusWire('ENROLLMENT_NOT_UNIQUE'), { state: 'duplicate' }],
		[statusWire('ENROLLMENT_FAILED'), { state: 'failed' }],
		[statusWire(), { state: 'pending', status: 'ENROLLMENT_IN_PROGRESS' }],
		[statusWire('ENROLLMENT_IN_PROGRESS', { credential }), { state: 'pending', status: 'ENROLLMENT_IN_PROGRESS' }],
		[statusWire('ENROLLMENT_FAILED', { credential }), { state: 'failed' }],
		[{ status: 'NEW' }, { state: 'pending', status: 'ENROLLMENT_IN_PROGRESS' }],
		[{ status: 'NEW', enrollment_status: null, last_successful_capture_id: null }, { state: 'pending', status: 'ENROLLMENT_IN_PROGRESS' }],
		[{ status: 'UNVERIFIED', deletion_status: { identity_status: 'active' } }, { state: 'failed', reason: 'identity_unavailable' }],
	] as const
	for (const [wire, expected] of cases) await withFetch(() => Response.json(wire), async () => {
		expect(await getEnrollmentStatus(receipt(), options())).toEqual({ ...receipt(), ...expected })
	})
})

test('rejects raw database states, mismatched captures and invalid successful credentials', async () => {
	for (const wire of [
		null, [], 'status', { status: null }, { status: 'NewStatus' },
		{ status: 'NEW', enrollment_status: 42 },
		...['Received', 'InProgress', 'PendingActivation', 'Completed', 'Failed', 'Error', 'Expired'].map(status => statusWire(status)),
		statusWire('ENROLLMENT_IN_PROGRESS', { capture_id: CHALLENGE_ID }),
		statusWire('ENROLLMENT_IN_PROGRESS', { capture_id: 42 }),
		...[undefined, null, 42, '', 'not base64', 'AB=='].map(credential => statusWire('ENROLLMENT_UNIQUE_SUCCESSFUL', { credential })),
		{ status: 'VERIFIED', last_successful_capture_id: 42 },
	]) await withFetch(() => Response.json(wire), async () => {
		await expect(getEnrollmentStatus(receipt(), options())).rejects.toMatchObject({ code: 'invalid_response' })
	})
})

test('ignores additive acceptance and status metadata without following response URLs', async () => {
	const wire = {}
	let calls = 0
	await withFetch(url => {
		expect(url.origin + url.pathname).toBe(ENDPOINT)
		const body = ++calls === 1 ? wire : statusWire('ENROLLMENT_NOT_UNIQUE')
		return Response.json({
			...body, metadata: { version: 3 }, polling_url: 'https://other.example/collect',
			polling_token: 'opaque-service-token-v2', polling_token_expires_at: 'not-required',
		}, { status: calls === 1 ? 202 : 200 })
	}, async () => {
		const accepted = await submitEnrollment(capture(), authorization, options())
		expect(accepted).toEqual(receipt())
		expect(await getEnrollmentStatus(accepted, options())).toEqual({ sub: SUB, captureId: CAPTURE_ID, state: 'duplicate' })
	})
})

test('ignores unrelated backend metadata on the public status body', async () => {
	await withFetch(() => Response.json({
		...statusWire('ENROLLMENT_FAILED'),
		error: 'private internal backend diagnostic',
		unique: true,
	}), async () => {
		expect(await getEnrollmentStatus(receipt(), options())).toEqual({ ...receipt(), state: 'failed' })
	})
})

test('preserves edge HTTP status and retryability for HTML and malformed JSON failures', async () => {
	for (const status of [403, 408, 429, 503]) {
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

test('rejects invalid polling identities before networking', async () => {
	let calls = 0
	await withFetch(() => { calls++; return Response.json(statusWire()) }, async () => {
		await expect(getIdentityStatus('0x0', options())).rejects.toMatchObject({ code: 'invalid_response' })
		for (const invalid of [{ ...receipt(), sub: '0x0' }, { ...receipt(), captureId: 'invalid' }]) {
			await expect(getEnrollmentStatus(invalid, options())).rejects.toMatchObject({ code: 'invalid_response' })
			await expect(pollEnrollment(invalid, options())).rejects.toMatchObject({ code: 'invalid_response' })
		}
	})
	expect(calls).toBe(0)
})

test('polling makes no retries after a failed GET', async () => {
	for (const [status, error, retryable] of [[401, 'unauthorized', false], [503, 'capture_store_unavailable', true]] as const) {
		let calls = 0
		await withFetch(() => { calls++; return Response.json({ error, retryable }, { status }) }, async () => {
			await expect(pollEnrollment(receipt(), options())).rejects.toMatchObject({ code: error, retryable, status })
		})
		expect(calls).toBe(1)
	}
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
		await withFetch(() => Response.json(statusWire(++calls === 1 ? 'ENROLLMENT_IN_PROGRESS' : 'ENROLLMENT_NOT_UNIQUE')), async () => {
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
		...[null, [], { retryable: true },
			{ error: null, retryable: true }, { error: 42, retryable: true },
			{ error: 'capture_store_unavailable', retryable: null }, { error: 'capture_store_unavailable', retryable: 'true' },
		].map(body => Response.json(body, { status: 503 })),
		Response.json(statusWire('ENROLLMENT_UNIQUE_SUCCESSFUL', { credential: sensitive })),
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
