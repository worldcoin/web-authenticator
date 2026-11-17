import { afterEach, expect, test } from 'bun:test'
import { buildDebugReport, sendDebugReport, type DebugReportMetadata } from '../lib/debug-report'
import { connectSources, ENVIRONMENTS } from '../../config/environment'

const metadata: DebugReportMetadata = { os: 'web', userAgent: 'agént', appVersion: '1', environment: 'staging',
	faceAuthPurpose: 'selfieEnrollment', flowId: 'flow', result: 'success', terminationReason: 'success' }
const report = buildDebugReport({ sessionId: 'session', ts: 123, metadata })
const config = { apiOrigin: 'https://backend.example', uploadOrigin: 'https://bucket.example' }
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('builds the envelope and normalizes enclave states', () => {
	expect(report).toEqual({ sessionId: 'session', ts: 123, metadata })
	for (const [debugReport, expected] of [
		[{ available: { json: '{"ok":true}' } }, { status: 'available', report: { ok: true } }],
		['not_produced', { status: 'not_produced' }],
		[{ omitted_too_large: { original_size_bytes: 123 } }, { status: 'omitted_too_large', originalSizeBytes: 123 }],
		[{ available: { json: '{' } }, { status: 'invalid_json' }],
	] as const) expect(buildDebugReport({ sessionId: 'session', ts: 123, metadata, debugReport }).enclaveDebugReport).toEqual(expected)
})

test('uploads exact bytes with digest and allowed SigV4 headers', async () => {
	const calls: { url: string; init: RequestInit }[] = []
	let uploaded!: () => void
	const complete = new Promise<void>(resolve => { uploaded = resolve })
	const bytes = new TextEncoder().encode(JSON.stringify(report))
	globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(url), init: init! })
		if (calls.length === 1) return Response.json({ url: 'https://bucket.example/key?signature=secret', headers: {
			host: ['bucket.example'], 'content-length': [String(bytes.length)], 'content-type': ['application/json'],
			'x-amz-checksum-sha256': ['checksum'], 'x-amz-sdk-checksum-algorithm': ['SHA256'], 'if-none-match': ['*'], authorization: ['ignored'],
		} })
		uploaded()
		return new Response(null, { status: 200 })
	}) as unknown as typeof fetch
	expect(sendDebugReport(report, config)).toBeUndefined()
	await complete
	expect(calls).toHaveLength(2)
	expect(calls[0]!.url).toBe('https://backend.example/api/v1/data/web/report')
	expect(calls[0]!.init.method).toBe('POST')
	expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ flowId: 'flow', sessionId: 'session',
		sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), contentLength: bytes.length })
	expect(calls[1]!.url).toBe('https://bucket.example/key?signature=secret')
	expect(calls[1]!.init.method).toBe('PUT')
	expect(calls[1]!.init.body).toEqual(bytes)
	expect(Object.fromEntries(new Headers(calls[1]!.init.headers))).toEqual({ 'content-type': 'application/json',
		'if-none-match': '*', 'x-amz-checksum-sha256': 'checksum', 'x-amz-sdk-checksum-algorithm': 'SHA256' })
	for (const { init } of calls) {
		expect(init.credentials).toBe('omit')
		expect(init.redirect).toBe('error')
		expect(init.signal).toBeDefined()
	}
})

test('rejects mismatched origins and content lengths before PUT', async () => {
	for (const response of [
		{ url: 'https://attacker.example/key', headers: {} },
		{ url: 'http://bucket.example/key', headers: {} },
		{ url: 'https://bucket.example/key', headers: { 'content-length': ['1'] } },
	]) {
		let calls = 0
		let requested!: () => void
		const complete = new Promise<void>(resolve => { requested = resolve })
		globalThis.fetch = (async () => { calls++; requested(); return Response.json(response) }) as unknown as typeof fetch
		sendDebugReport(report, config)
		await complete
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(calls).toBe(1)
	}
})

test('swallows presign and PUT failures and timeout rejections', async () => {
	for (const stage of ['presign-error', 'presign-timeout', 'put-error', 'put-timeout'] as const) {
		let calls = 0
		let requested!: () => void
		const complete = new Promise<void>(resolve => { requested = resolve })
		globalThis.fetch = (async () => {
			calls++
			if (stage.startsWith('presign') || calls === 2) {
				requested()
				if (stage.endsWith('timeout')) throw new DOMException('timeout', 'TimeoutError')
				return new Response(null, { status: 500 })
			}
			return Response.json({ url: 'https://bucket.example/key', headers: {} })
		}) as unknown as typeof fetch
		expect(sendDebugReport(report, config)).toBeUndefined()
		await complete
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(calls).toBe(stage.startsWith('presign') ? 1 : 2)
	}
})

test('disabled uploads do not make requests', async () => {
	let calls = 0
	globalThis.fetch = (async () => { calls++; throw new Error('unexpected') }) as unknown as typeof fetch
	sendDebugReport(report, null)
	await Promise.resolve()
	expect(calls).toBe(0)
})

test('CSP connect sources include both debug report origins when enabled', () => {
	const sources = connectSources('staging', { ...ENVIRONMENTS.staging, debugReports: config })
	expect(sources).toContain(config.apiOrigin)
	expect(sources).toContain(config.uploadOrigin)
	expect(connectSources('staging')).not.toContain(config.apiOrigin)
})

test('request deadlines abort presign and PUT without failing the caller', async () => {
	for (const failAt of [1, 2]) {
		let calls = 0
		let aborted!: () => void
		const complete = new Promise<void>(resolve => { aborted = resolve })
		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			calls++
			if (calls === failAt) return await new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => { aborted(); reject(init.signal?.reason) }, { once: true })
			})
			return Response.json({ url: 'https://bucket.example/key', headers: {} })
		}) as unknown as typeof fetch
		expect(sendDebugReport(report, config)).toBeUndefined()
		await complete
		expect(calls).toBe(failAt)
	}
}, 10000)

test('serialization errors do not throw into the caller', async () => {
	const invalid = { ...report, toJSON: () => { throw new Error('serialization failed') } }
	expect(() => sendDebugReport(invalid, config)).not.toThrow()
	await Promise.resolve()
})
