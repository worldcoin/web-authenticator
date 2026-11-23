import { DEMO_ACTION, type DemoRequest } from "../../config/demo"
import type { CaptureResult } from "./selfie-capture"

export function logDemoRequest(config: DemoRequest, requestId: string) {
	console.info('selfie_check_beta_request', {
		environment: 'staging',
		action: DEMO_ACTION,
		schemaId: 11,
		appId: config.app_id,
		rpId: config.rp_context.rp_id,
		requestId,
		expiresAt: config.rp_context.expires_at,
	})
}

export function logCaptureTiming({ guidanceMs, totalMs, width, height }: CaptureResult['timing']) {
	if (import.meta.env.DEV) console.info('selfie_capture', { guidanceMs, totalMs, width, height })
}

export function logPoseGuardStep<T>(step: string, operation: () => Promise<T>): Promise<T> {
	return import.meta.env.DEV ? logFlowStep(`poseguard.${step}`, operation) : operation()
}

export function logPoseGuardEvent(
	event: 'poseguard_prompt' | 'poseguard_target' | 'poseguard_gate' | 'poseguard_rejected' | 'poseguard_bundle_validated',
	fields: Record<string, string | number | boolean | Readonly<Record<string, number>>>,
) {
	if (!import.meta.env.DEV) return
	if (event === 'poseguard_rejected') console.warn(event, fields)
	else console.info(event, fields)
}

// Never log arguments, results, or raw dependency errors: they can contain secrets.
export async function logFlowStep<T>(step: string, operation: () => Promise<T>): Promise<T> {
	const started = performance.now()
	console.info('authenticator_step', { step, status: 'started' })
	try {
		const result = await operation()
		console.info('authenticator_step', {
			step,
			status: 'completed',
			durationMs: Math.round(performance.now() - started),
		})
		return result
	} catch (error) {
		const allowedNames = [
			'AbortError',
			'TimeoutError',
			'NotAllowedError',
			'NotSupportedError',
			'SecurityError',
			'TypeError',
			'LinkError',
			'CompileError',
			'RuntimeError',
			'DataError',
			'InvalidStateError',
			'QuotaExceededError',
		]
		const category = error instanceof Error && allowedNames.includes(error.name) ? error.name : 'OperationError'
		console.error('authenticator_step', {
			step,
			status: 'failed',
			category,
			durationMs: Math.round(performance.now() - started),
		})
		throw error
	}
}
