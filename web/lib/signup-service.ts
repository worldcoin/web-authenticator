import { abortable, pause } from './async'
import { type EnrollmentCapture, EnrollmentCaptureSchema, isCanonicalUuid, validateEnrollmentCapture } from './enrollment-contract'
import { EnrollmentStatusSchema, SignupServiceErrorSchema, SubmissionReceiptSchema } from './signup-service-contract'

const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_PROOF_BYTES = 768 * 1024
const REQUEST_TIMEOUT_MS = 10_000
const POLLING_TIMEOUT_MS = 120_000

export interface SignupServiceOptions {
	/** A trusted configuration value, never a URL supplied by an enrollment response. */
	endpoint: string
	signal: AbortSignal
}

export interface EnrollmentReceipt {
	sub: string
	captureId: string
}

export type EnrollmentResult = EnrollmentReceipt & (
	| { state: 'completed'; credential: Uint8Array }
	| { state: 'duplicate' }
	| { state: 'failed'; reason?: string }
	| { state: 'expired' }
)

export type EnrollmentStatus = EnrollmentResult | (EnrollmentReceipt & {
	state: 'pending'
	status: 'Received' | 'InProgress' | 'PendingActivation'
})

export class SignupServiceError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly retryable: boolean,
		readonly status?: number,
		options?: ErrorOptions,
	) {
		super(message, options)
		this.name = 'SignupServiceError'
	}
}

/** Each call submits once. A retry needs a fresh challenge/proof, even for the same capture. */
export async function submitEnrollment(
	capture: EnrollmentCapture,
	authorization: { challengeId: string; proofCbor: Uint8Array },
	options: SignupServiceOptions,
): Promise<EnrollmentReceipt> {
	const parsedCapture = EnrollmentCaptureSchema.safeParse(capture)
	if (!parsedCapture.success) throw new TypeError('Invalid TEE enrollment bundle')
	const bundle = parsedCapture.data
	const identity = validateEnrollmentCapture(bundle)
	if (!isCanonicalUuid(authorization.challengeId) || !(authorization.proofCbor instanceof Uint8Array) || authorization.proofCbor.byteLength === 0 || authorization.proofCbor.byteLength > MAX_PROOF_BYTES) {
		throw new TypeError('Enrollment authorization requires a challenge UUID and a bounded, nonempty CBOR proof.')
	}
	const url = endpoint(options.endpoint)
	const body = new FormData()
	for (const field of bundle.fields) body.append(field.name, field.value)
	body.append('world_id_challenge_id', authorization.challengeId)
	body.append('world_id_ownership_proof', new Blob([authorization.proofCbor.slice()], { type: 'application/cbor' }), 'ownership-proof.cbor')
	try {
		const parsed = SubmissionReceiptSchema.safeParse(await requestJson(url, {
			method: 'PUT', headers: { 'X-Nitro-Attestation': bundle.attestation_header }, body,
		}, 202, options))
		if (!parsed.success) return invalidResponse()
		const value = parsed.data
		if (value.sub !== identity.sub || value.capture_id !== identity.captureId) return invalidResponse()
		return identity
	} catch (cause) {
		if (options.signal.aborted) throw options.signal.reason
		if (cause instanceof SignupServiceError && cause.code === 'invalid_response' && (cause.status === undefined || cause.status === 202)) {
			throw new SignupServiceError(
				'Enrollment submission could not be confirmed. Keep this capture; retrying requires a fresh ownership proof.',
				cause.code, true, cause.status ?? 202, { cause },
			)
		}
		throw cause
	}
}

/** Waits only while processing is pending. The receipt remains usable after this wait expires. */
export async function pollEnrollment(receipt: EnrollmentReceipt, options: SignupServiceOptions): Promise<EnrollmentResult> {
	validateReceipt(receipt)
	const deadline = AbortSignal.timeout(POLLING_TIMEOUT_MS)
	const signal = AbortSignal.any([options.signal, deadline])
	try {
		for (;;) {
			const result = await getEnrollmentStatus(receipt, { ...options, signal })
			if (result.state !== 'pending') return result
			await pause(1000, signal)
		}
	} catch (error) {
		if (options.signal.aborted) throw options.signal.reason
		if (deadline.aborted) {
			throw new SignupServiceError('Enrollment is still pending. Resume polling with this receipt.', 'polling_timeout', true)
		}
		throw error
	}
}

/** Polls once; failed requests are surfaced without automatic retries. */
// TODO: Add GET auth once agreed: https://github.com/worldcoin/web-authenticator/pull/36#discussion_r4585357470
export async function getEnrollmentStatus(receipt: EnrollmentReceipt, options: SignupServiceOptions): Promise<EnrollmentStatus> {
	validateReceipt(receipt)
	const url = endpoint(options.endpoint)
	url.searchParams.set('sub', receipt.sub)
	const parsed = EnrollmentStatusSchema.safeParse(await requestJson(url, {
		method: 'GET',
	}, 200, options))
	if (!parsed.success) return invalidResponse()
	const value = parsed.data
	if (value.sub !== receipt.sub || value.capture_id !== receipt.captureId) return invalidResponse()
	const identity = { sub: receipt.sub, captureId: receipt.captureId }
	if (value.status === 'Completed' && value.unique) {
		return { ...identity, state: 'completed', credential: credentialBytes(value.credential) }
	}
	switch (value.status) {
		case 'Received': case 'InProgress': case 'PendingActivation':
			return { ...identity, state: 'pending', status: value.status }
		case 'Completed': return { ...identity, state: 'duplicate' }
		case 'Failed': case 'Error':
			// The backend stores a free-form string. Expose its known code, never arbitrary text.
			return { ...identity, state: 'failed', ...(typeof value.error === 'string' ? {
				reason: value.error === 'MPC_RESULT_FAILED' ? value.error : 'capture_processing_failed',
			} : {}) }
		case 'Expired': return { ...identity, state: 'expired' }
		default: return invalidResponse()
	}
}

async function requestJson(url: URL, init: RequestInit, expectedStatus: number, options: SignupServiceOptions): Promise<unknown> {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	const signal = AbortSignal.any([options.signal, timeout])
	signal.throwIfAborted()
	let responseStatus: number | undefined
	try {
		const response = await abortable(fetch(url, { ...init, signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' }), signal)
		responseStatus = response.status
		const value = await readJson(response, signal)
		if (response.status !== expectedStatus) {
			const parsed = SignupServiceErrorSchema.safeParse(value)
			if (!parsed.success) return invalidResponse()
			const error = parsed.data
			throw new SignupServiceError(`Signup service returned ${error.error}.`, error.error, error.retryable, response.status)
		}
		return value
	} catch (cause) {
		if (options.signal.aborted) throw options.signal.reason
		const retryableStatus = responseStatus === 429 || (responseStatus !== undefined && responseStatus >= 500)
		if (cause instanceof SignupServiceError) {
			if (cause.status !== undefined || responseStatus === undefined) throw cause
			throw new SignupServiceError(`Signup service returned an invalid enrollment response (HTTP ${responseStatus}).`, cause.code, retryableStatus, responseStatus)
		}
		const submission = init.method === 'PUT'
		throw new SignupServiceError(
			submission
				? 'Enrollment submission could not be confirmed. Keep this capture; retrying requires a fresh ownership proof.'
				: 'Enrollment status could not be checked. Resume polling with this receipt.',
			timeout.aborted ? 'request_timeout' : 'request_failed', responseStatus === undefined || responseStatus === expectedStatus || retryableStatus, responseStatus, { cause },
		)
	}
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
	if (!response.body) return invalidResponse()
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	let complete = false
	try {
		for (;;) {
			const { value, done } = await abortable(reader.read(), signal)
			if (done) break
			size += value.byteLength
			if (size > MAX_RESPONSE_BYTES) return invalidResponse()
			chunks.push(value)
		}
		complete = true
	} finally {
		// Abandoned response cleanup must not replace the original validation/abort error.
		if (!complete) void reader.cancel().catch(() => {})
		reader.releaseLock()
	}
	if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return invalidResponse()
	const bytes = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
	} catch {
		return invalidResponse()
	}
}

function credentialBytes(value: string): Uint8Array {
	if (!(/^[A-Za-z0-9+/]+={0,2}$/.test(value) || /^[A-Za-z0-9_-]+={0,2}$/.test(value))) return invalidResponse()
	const standard = value.replace(/-/g, '+').replace(/_/g, '/')
	try {
		const decoded = atob(standard)
		const canonical = btoa(decoded)
		if (standard !== canonical && standard !== canonical.replace(/=+$/, '')) return invalidResponse()
		return Uint8Array.from(decoded, character => character.charCodeAt(0))
	} catch {
		return invalidResponse()
	}
}

function validateReceipt(receipt: EnrollmentReceipt): void {
	const parsed = SubmissionReceiptSchema.safeParse({
		sub: receipt.sub, capture_id: receipt.captureId,
	})
	if (!parsed.success) return invalidResponse()
}

function endpoint(value: string): URL {
	const url = new URL(value)
	const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	if ((url.protocol !== 'https:' && !localHttp) || url.pathname !== '/api/v2/identity' || url.search || url.hash || url.username || url.password) {
		throw new TypeError('Signup endpoint must be an HTTPS /api/v2/identity URL without query, fragment, or credentials.')
	}
	return url
}

function invalidResponse(): never {
	throw new SignupServiceError('Signup service returned an invalid enrollment response.', 'invalid_response', false)
}
