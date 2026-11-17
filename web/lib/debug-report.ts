import type { EnvironmentConfig, ProtocolEnvironment } from '../../config/environment'

export type DebugReportMetadata = {
	os: 'web'
	userAgent: string
	appVersion: string
	environment: ProtocolEnvironment
	faceAuthPurpose: 'selfieEnrollment'
	flowId: string
} & (
	| { result: 'success'; terminationReason: 'success'; PCPFaceCaptureId?: string }
	| { result: 'failure'; terminationReason: 'invalid_image' | 'quality_rejected' | 'extraction_failed' | 'enclave_unavailable' | 'aborted'; PCPFaceCaptureId?: never }
)

export type EnclaveDebugReport =
	| { status: 'available'; report: unknown }
	| { status: 'not_produced' }
	| { status: 'omitted_too_large'; originalSizeBytes: number }
	| { status: 'invalid_json' }

export type DebugReport = {
	sessionId: string
	ts: number
	metadata: DebugReportMetadata
	enclaveDebugReport?: EnclaveDebugReport
}

type EnclaveReport = { available: { json: string } } | 'not_produced' | { omitted_too_large: { original_size_bytes: number } }
type DebugReportConfig = EnvironmentConfig['debugReports']

export function buildDebugReport(input: {
	sessionId: string
	ts: number
	metadata: DebugReportMetadata
	debugReport?: EnclaveReport
}): DebugReport {
	return {
		sessionId: input.sessionId,
		ts: input.ts,
		metadata: input.metadata,
		...(input.debugReport === undefined ? {} : { enclaveDebugReport: normalizeReport(input.debugReport) }),
	}
}

export function sendDebugReport(report: DebugReport, config: DebugReportConfig): void {
	if (!config) return
	void Promise.resolve().then(() => uploadReport(report, config)).catch(() => {})
}

async function uploadReport(report: DebugReport, config: NonNullable<DebugReportConfig>): Promise<void> {
	const apiOrigin = parseOrigin(config.apiOrigin)
	const uploadOrigin = parseOrigin(config.uploadOrigin)
	const bytes = new TextEncoder().encode(JSON.stringify(report))
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
	const response = await fetch(new URL('/api/v1/data/web/report', apiOrigin), {
		method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit', redirect: 'error',
		body: JSON.stringify({ flowId: report.metadata.flowId, sessionId: report.sessionId, sha256, contentLength: bytes.length }),
		signal: AbortSignal.timeout(3000),
	})
	if (!response.ok) return
	const presigned: unknown = await response.json()
	const { url, headers } = parsePresigned(presigned, uploadOrigin, bytes.length)
	await fetch(url, { method: 'PUT', headers, body: bytes, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(3000) })
}

function normalizeReport(report: EnclaveReport): EnclaveDebugReport {
	if (report === 'not_produced') return { status: 'not_produced' }
	if ('omitted_too_large' in report) return { status: 'omitted_too_large', originalSizeBytes: report.omitted_too_large.original_size_bytes }
	try {
		return { status: 'available', report: JSON.parse(report.available.json) as unknown }
	} catch {
		return { status: 'invalid_json' }
	}
}

function parseOrigin(value: string): URL {
	const url = new URL(value)
	if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin')
	return url
}

function parsePresigned(value: unknown, uploadOrigin: URL, length: number): { url: URL; headers: Headers } {
	if (!isObject(value) || typeof value.url !== 'string' || !isObject(value.headers)) throw new Error('Invalid presign response')
	const url = new URL(value.url)
	if (url.protocol !== 'https:' || url.origin !== uploadOrigin.origin || url.username || url.password) throw new Error('Invalid upload URL')
	const headers = new Headers()
	for (const [name, values] of Object.entries(value.headers)) {
		if (!Array.isArray(values) || values.length === 0 || !values.every(item => typeof item === 'string')) throw new Error('Invalid presign headers')
		const lower = name.toLowerCase()
		if (lower === 'content-length' && (values.length !== 1 || values[0] !== String(length))) throw new Error('Invalid content length')
		if (lower === 'content-type' || lower === 'if-none-match' || lower.startsWith('x-amz-')) for (const item of values) headers.append(name, item)
	}
	return { url, headers }
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
