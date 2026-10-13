/** Obtain the local demo credential from the backend; never persist it or log the response. */
export async function requestDemoToken(signal: AbortSignal): Promise<string> {
	signal.throwIfAborted()
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)])
	let response: Response
	try {
		response = await fetch('/api/tee-admission', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal: deadline,
		})
	} catch {
		signal.throwIfAborted()
		throw new Error('Demo token provisioning could not be reached.')
	}
	if (response.status !== 200) {
		await response.body?.cancel()
		throw new Error(
			`Demo token provisioning unavailable (HTTP ${response.status}). Check the local backend configuration and token expiry.`
		)
	}
	const reader = response.body?.getReader()
	if (!reader) throw new Error('Empty demo admission response.')
	let text = '',
		size = 0
	const decoder = new TextDecoder()
	try {
		while (true) {
			deadline.throwIfAborted()
			const { done, value } = await reader.read()
			if (done) break
			size += value.byteLength
			if (size > 4096) throw new Error('Oversized response')
			text += decoder.decode(value, { stream: true })
		}
		text += decoder.decode()
	} catch {
		await reader.cancel()
		throw new Error('Could not read a bounded demo admission response.')
	} finally {
		reader.releaseLock()
	}
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		throw new Error('Invalid demo admission response.')
	}
	if (!value || typeof value !== 'object') throw new Error('Invalid demo admission response.')
	const data = value as Record<string, unknown>
	if (
		data.mode !== 'local' ||
		typeof data.token !== 'string' ||
		!/^[0-9a-f]{64}$/.test(data.token) ||
		typeof data.expires_at !== 'number' ||
		!Number.isSafeInteger(data.expires_at) ||
		data.expires_at * 1000 <= Date.now() ||
		data.expires_at * 1000 > Date.now() + 600_000
	)
		throw new Error('Invalid or expired demo admission response.')
	return data.token
}
