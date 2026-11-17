import type { DebugReport, DebugReportMetadata, EnclaveDebugReport } from '../../packages/contracts/src/debug-report'

type EnclaveReport = { available: { json: string } } | 'not_produced' | { omitted_too_large: { original_size_bytes: number } }

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

export function sendDebugReport(report: DebugReport): void {
	void fetch('/api/debug-reports', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report),
		signal: AbortSignal.timeout(3000),
	}).catch(() => {})
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
