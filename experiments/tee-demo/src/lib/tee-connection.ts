export type ConnectionPreparation =
	| { status: 'connected'; reason: string; expiresAt: number; httpStatus: 200 }
	| { status: 'unavailable' | 'forbidden'; reason: string; httpStatus?: 403 | 503 }

/** Local bearer admission only. Production requires verified enclave attestation and encryption. */
export async function connect(
	signal: AbortSignal,
	token: string,
	configuredHost: string | undefined = import.meta.env?.VITE_TEE_BASE_URL
): Promise<ConnectionPreparation> {
	signal.throwIfAborted()
	if (!configuredHost)
		return { status: 'unavailable', reason: 'Configure VITE_TEE_BASE_URL to use the local TEE host.' }
	let host: URL
	try {
		host = new URL(configuredHost)
	} catch {
		throw new Error('Invalid local TEE origin.')
	}
	if (
		host.protocol !== 'http:' ||
		!['localhost', '127.0.0.1'].includes(host.hostname) ||
		host.username ||
		host.password ||
		host.search ||
		host.hash ||
		host.pathname !== '/'
	)
		throw new Error(
			'Development admission requires an HTTP loopback origin. Remote TEE verification is not implemented.'
		)
	if (token && !/^[0-9a-f]{64}$/.test(token))
		return { status: 'forbidden', reason: 'Enter the 64-character local access token.' }
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)])
	let response: Response
	try {
		response = await fetch(new URL('/v1/connect', host), {
			method: 'POST',
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			credentials: 'omit',
			cache: 'no-store',
			redirect: 'error',
			signal: deadline,
		})
	} catch {
		signal.throwIfAborted()
		throw new Error(
			deadline.aborted
				? 'Local TEE connection timed out.'
				: 'Cannot reach the local TEE host. Check the server and allowed origin.'
		)
	}
	if (response.status === 403) {
		await response.body?.cancel()
		return {
			status: 'forbidden',
			httpStatus: 403,
			reason: 'Forbidden: token is invalid or expired, or this browser origin is not allowed.',
		}
	}
	if (response.status === 503) {
		await response.body?.cancel()
		return {
			status: 'unavailable',
			httpStatus: 503,
			reason: 'Authorized, but the face worker is unavailable. Upload remains disabled.',
		}
	}
	if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('application/json')) {
		await response.body?.cancel()
		throw new Error('Unexpected local TEE handshake response.')
	}
	const reader = response.body?.getReader()
	if (!reader) throw new Error('Empty local TEE handshake response.')
	let text = '',
		size = 0
	const decoder = new TextDecoder()
	try {
		while (true) {
			deadline.throwIfAborted()
			const { done, value } = await reader.read()
			if (done) break
			size += value.byteLength
			if (size > 4096) throw new Error('Oversized local TEE handshake response.')
			text += decoder.decode(value, { stream: true })
		}
		text += decoder.decode()
	} catch {
		await reader.cancel()
		throw new Error('Could not read a bounded local TEE handshake response.')
	} finally {
		reader.releaseLock()
	}
	let data: unknown
	try {
		data = JSON.parse(text)
	} catch {
		throw new Error('Invalid local TEE handshake JSON.')
	}
	if (typeof data !== 'object' || data === null) throw new Error('Invalid local TEE handshake.')
	const result = data as Record<string, unknown>
	if (
		result.protocol_version !== 1 ||
		result.mode !== 'local' ||
		!Array.isArray(result.capabilities) ||
		!result.capabilities.includes('face-image-check') ||
		typeof result.expires_at !== 'number' ||
		!Number.isSafeInteger(result.expires_at) ||
		result.expires_at * 1000 <= Date.now() ||
		result.expires_at * 1000 > Date.now() + 600_000
	)
		throw new Error('Incompatible or expired local TEE handshake. Upload remains disabled.')
	return {
		status: 'connected',
		httpStatus: 200,
		expiresAt: result.expires_at * 1000,
		reason: 'Local admission accepted; face worker ready. This is not an attested enclave connection.',
	}
}
