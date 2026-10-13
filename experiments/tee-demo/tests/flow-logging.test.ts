import { expect, test, spyOn } from 'bun:test'
import { logFlowStep } from '../src/lib/flow-logging'

test('step logging preserves failures without exposing their sensitive payloads', async () => {
	const info = spyOn(console, 'info').mockImplementation(() => {})
	const error = spyOn(console, 'error').mockImplementation(() => {})
	const failure = new Error('secret request payload')
	try {
		await expect(
			logFlowStep('walletkit.worker_initialize', async () => {
				throw failure
			})
		).rejects.toBe(failure)
		expect(error.mock.calls[0]?.[1]).toMatchObject({
			step: 'walletkit.worker_initialize',
			status: 'failed',
			category: 'OperationError',
		})
		expect(JSON.stringify([...info.mock.calls, ...error.mock.calls])).not.toContain('secret request payload')
	} finally {
		info.mockRestore()
		error.mockRestore()
	}
})
