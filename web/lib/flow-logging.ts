/** A capture that ended on the error screen. The message stays dev-only: dependency errors can contain secrets. */
export function logCaptureFailure(error: unknown) {
	const name = error instanceof Error ? error.name : 'unknown_error'
	const cause = error instanceof Error && error.cause instanceof Error ? error.cause.name : undefined
	console.warn('selfie_capture_failed', {
		name,
		...(cause ? { cause } : {}),
		...(import.meta.env.DEV && error instanceof Error ? { message: error.message } : {}),
	})
}

export function logPoseGuardStep<T>(step: string, operation: () => Promise<T>): Promise<T> {
	return import.meta.env.DEV ? logFlowStep(`poseguard.${step}`, operation) : operation()
}

export function logPoseGuardEvent(
	event: 'poseguard_prompt' | 'poseguard_target' | 'poseguard_gate' | 'poseguard_rejected' | 'poseguard_bundle_validated' | 'poseguard_indexer_sync',
	fields: Record<string, string | number | boolean | Readonly<Record<string, number>>>,
) {
	if (!import.meta.env.DEV) return
	if (event === 'poseguard_rejected') console.warn(event, fields)
	else console.info(event, fields)
}

/** The RP registry read failed after its retries, or the RP is not active. Names only: no request material. */
export function logRpLookupFailure(error: unknown, environment: string) {
	const cause = error instanceof Error && error.cause instanceof Error ? error.cause.name : undefined
	console.warn('rp_lookup_failed', {
		dependency: 'world_chain_rpc',
		environment,
		name: error instanceof Error ? error.name : 'unknown_error',
		...(cause ? { cause } : {}),
	})
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
