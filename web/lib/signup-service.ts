import { abortable, pause } from './async'
import { type EnrollmentCapture, EnrollmentCaptureSchema, isCanonicalUuid, validateEnrollmentCapture } from './enrollment-contract'
import { EnrollmentReceiptSchema, IdentityStatusSchema, type IdentityStatusResponse, SignupServiceErrorSchema, SubmissionAcceptanceSchema } from './signup-service-contract'

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
)

export type EnrollmentStatus = EnrollmentResult | (EnrollmentReceipt & {
	state: 'pending'
	status: 'ENROLLMENT_IN_PROGRESS'
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
		const parsed = SubmissionAcceptanceSchema.safeParse(await requestJson(url, {
			method: 'PUT', headers: { 'X-Nitro-Attestation': bundle.attestation_header }, body,
		}, 202, options))
		if (!parsed.success) return invalidResponse()
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

/** Polls one submitted capture; failed requests are surfaced without automatic retries. */
export async function getEnrollmentStatus(receipt: EnrollmentReceipt, options: SignupServiceOptions): Promise<EnrollmentStatus> {
	validateReceipt(receipt)
	const value = await getIdentityStatus(receipt.sub, options)
	const identity = { sub: receipt.sub, captureId: receipt.captureId }
	if (value.deletion_status || value.status === 'UNVERIFIED') {
		return { ...identity, state: 'failed', reason: 'identity_unavailable' }
	}
	const enrollment = value.enrollment_status
	if (!enrollment) return { ...identity, state: 'pending', status: 'ENROLLMENT_IN_PROGRESS' }
	if (enrollment.capture_id !== receipt.captureId) return invalidResponse()
	switch (enrollment.status) {
		case 'ENROLLMENT_IN_PROGRESS':
			return { ...identity, state: 'pending', status: enrollment.status }
		case 'ENROLLMENT_UNIQUE_SUCCESSFUL':
			if (typeof enrollment.credential !== 'string') return invalidResponse()
			return { ...identity, state: 'completed', credential: credentialBytes(enrollment.credential) }
		case 'ENROLLMENT_NOT_UNIQUE': return { ...identity, state: 'duplicate' }
		case 'ENROLLMENT_FAILED': return { ...identity, state: 'failed' }
	}
}

/** Fetches the same identity-status DTO used by Oxide, selected by v4 subject. */
// TODO: Add GET auth once agreed: https://github.com/worldcoin/web-authenticator/pull/36#discussion_r4585357470
export async function getIdentityStatus(sub: string, options: SignupServiceOptions): Promise<IdentityStatusResponse> {
	if (!EnrollmentReceiptSchema.shape.sub.safeParse(sub).success) return invalidResponse()
	const url = endpoint(options.endpoint)
	url.searchParams.set('sub', sub)
	const parsed = IdentityStatusSchema.safeParse(await requestJson(url, { method: 'GET' }, 200, options))
	if (!parsed.success) return invalidResponse()
	return parsed.data
}

async function requestJson(url: URL, init: RequestInit, expectedStatus: number, options: SignupServiceOptions): Promise<unknown> {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	const signal = AbortSignal.any([options.signal, timeout])
	signal.throwIfAborted()
	let responseStatus: number | undefined
	try {
		const response = await abortable(fetch(url, { ...init, signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' }), signal)
		responseStatus = response.status
		const value = await readJson(response, signal, response.status !== expectedStatus)
		if (response.status !== expectedStatus) {
			const retryable = isRetryableStatus(response.status)
			if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
				throw new SignupServiceError(`Signup service returned HTTP ${response.status}.`, 'http_error', retryable, response.status)
			}
			const parsed = SignupServiceErrorSchema.safeParse(value)
			if (!parsed.success) return invalidResponse()
			const error = parsed.data
			throw new SignupServiceError(`Signup service returned ${error.error}.`, error.error, error.retryable ?? retryable, response.status)
		}
		return value
	} catch (cause) {
		if (options.signal.aborted) throw options.signal.reason
		const retryableStatus = isRetryableStatus(responseStatus)
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

async function readJson(response: Response, signal: AbortSignal, allowEmpty = false): Promise<unknown> {
	if (!response.body) return allowEmpty ? {} : invalidResponse()
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
	if (size === 0 && allowEmpty) return {}
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
	const parsed = EnrollmentReceiptSchema.safeParse(receipt)
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

function isRetryableStatus(status: number | undefined): boolean {
	return status === 408 || status === 429 || (status !== undefined && status >= 500)
}

function invalidResponse(): never {
	throw new SignupServiceError('Signup service returned an invalid enrollment response.', 'invalid_response', false)
}
