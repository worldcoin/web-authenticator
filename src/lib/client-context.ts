interface RequestNetwork {
	ip: string | null
	source: 'x-forwarded-for' | 'x-real-ip' | 'unavailable'
	verified: false
}

function parseNetwork(value: unknown): RequestNetwork {
	if (typeof value !== 'object' || value === null) throw new Error('Invalid network context')
	const record = value as Record<string, unknown>
	if (
		!(record.ip === null || (typeof record.ip === 'string' && record.ip.length <= 45)) ||
		!['x-forwarded-for', 'x-real-ip', 'unavailable'].includes(String(record.source)) ||
		record.verified !== false
	) {
		throw new Error('Invalid network context')
	}
	return { ip: record.ip as string | null, source: record.source as RequestNetwork['source'], verified: false }
}

// Intentionally logs the requested IP/device diagnostics only. No credential IDs or key material.
export async function logRegistrationClick(): Promise<void> {
	const timestamp = new Date().toISOString()
	const device = {
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		language: navigator.language,
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	}
	let network: RequestNetwork = { ip: null, source: 'unavailable', verified: false }
	let lookup: 'ok' | 'failed' = 'failed'
	try {
		const response = await fetch('/api/client-context', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
		if (!response.ok) throw new Error('Network context lookup failed')
		network = parseNetwork(await response.json())
		lookup = 'ok'
	} catch {
		// Diagnostics are best-effort and must not prevent the passkey operation.
		console.warn('registration_context_lookup_failed', { operation: 'client-context', timeoutMs: 3000 })
	}
	console.info('passkey_registration_click', {
		event: 'passkey_registration_click',
		timestamp,
		network: { ...network, lookup },
		device,
		integrity: { verified: false, source: 'unattested_browser_context' },
	})
}
