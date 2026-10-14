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
