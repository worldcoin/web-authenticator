import { afterEach, expect, test } from 'bun:test'
import { buildDebugReport, sendDebugReport } from '../lib/debug-report'
import type { DebugReportMetadata } from '../../packages/contracts/src/debug-report'

const metadata: DebugReportMetadata = { os: 'web', userAgent: 'agent', appVersion: 'version', environment: 'staging',
	faceAuthPurpose: 'selfieEnrollment', flowId: 'flow', result: 'success', terminationReason: 'success' }
const input = { sessionId: 'session', ts: 123, metadata }
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('builds the envelope and normalizes enclave states', () => {
	expect(buildDebugReport(input)).toEqual(input)
	for (const [debugReport, expected] of [
		[{ available: { json: '{"ok":true}' } }, { status: 'available', report: { ok: true } }],
		['not_produced', { status: 'not_produced' }],
		[{ omitted_too_large: { original_size_bytes: 123 } }, { status: 'omitted_too_large', originalSizeBytes: 123 }],
		[{ available: { json: '{' } }, { status: 'invalid_json' }],
	] as const) expect(buildDebugReport({ ...input, debugReport }).enclaveDebugReport).toEqual(expected)
})

test('send is fire-and-forget and absorbs failures', async () => {
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		expect(init?.signal).toBeDefined()
		throw new DOMException('timeout', 'TimeoutError')
	}) as unknown as typeof fetch
	expect(sendDebugReport(buildDebugReport(input))).toBeUndefined()
	await Promise.resolve()
})
