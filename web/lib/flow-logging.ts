import { analytics, analyticsReason } from "./analytics";
import type { AnalyticsStep } from "../../packages/contracts/src/analytics";

const analyticsSteps: Partial<Record<string, AnalyticsStep>> = {
  "passkey.create": "passkey_create", "passkey.unlock_prf": "passkey_unlock",
  "walletkit.worker_initialize": "wallet_initialize", "registration.submit": "registration_submit",
  "registration.poll": "registration_poll", "registration.initialize_authenticator": "registration_initialize",
};

// Never log arguments, results, or raw dependency errors: they can contain secrets.
export async function logFlowStep<T>(step: string, operation: () => Promise<T>): Promise<T> {
	const analyticsStep = analyticsSteps[step]
	const finish = analyticsStep ? analytics.begin(analyticsStep) : undefined
	const started = performance.now()
	console.info('authenticator_step', { step, status: 'started' })
	try {
		const result = await operation()
		finish?.("completed")
		console.info('authenticator_step', {
			step,
			status: 'completed',
			durationMs: Math.round(performance.now() - started),
		})
		return result
	} catch (error) {
		const reason = analyticsReason(error)
		finish?.(reason === "cancelled" ? "cancelled" : "failed", reason)
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
