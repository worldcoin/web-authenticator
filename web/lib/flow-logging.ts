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
			'WalletKitError',
			'StorageError',
		]
		const category = error instanceof Error && allowedNames.includes(error.name) ? error.name : 'OperationError'
		// Fixed SDK variants only; dependency messages and details may contain secrets.
		const allowedCodes = ['AccountDoesNotExist', 'NetworkError', 'Reqwest', 'UnauthorizedAuthenticator']
		const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && allowedCodes.includes(error.code)
			? error.code : undefined
		console.error('authenticator_step', {
			step,
			status: 'failed',
			category,
			...(code ? { code } : {}),
			durationMs: Math.round(performance.now() - started),
		})
		throw error
	}
}
