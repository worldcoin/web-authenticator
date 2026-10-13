import { open } from 'node:fs/promises'

/** Explicit local-demo provisioning. Production admission belongs to the authenticated proxy. */
export async function POST(
	request: Request,
	config = {
		enabled: process.env.LOCAL_TEE_DEMO_ADMISSION === '1' && process.env.NODE_ENV !== 'production',
		tokenFile: process.env.LOCAL_TEE_TOKEN_FILE,
		origin: process.env.LOCAL_TEE_ORIGIN || 'http://localhost:3100',
	}
): Promise<Response> {
	const reply = (status: number, data: unknown) =>
		Response.json(data, {
			status,
			headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
		})
	if (!config.enabled) return reply(404, { error: 'Not found' })
	const url = new URL(request.url)
	if (
		url.protocol !== 'http:' ||
		!['localhost', '127.0.0.1'].includes(url.hostname) ||
		url.origin !== config.origin ||
		request.headers.get('origin') !== config.origin ||
		request.headers.get('sec-fetch-site') !== 'same-origin'
	)
		return reply(403, { error: 'Demo admission requires the configured localhost origin.' })
	if (request.method !== 'POST') return reply(405, { error: 'Expected POST' })
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
		return reply(415, { error: 'Expected JSON' })
	if (!config.tokenFile) return reply(503, { error: 'Demo token is not configured.' })
	try {
		const file = await open(config.tokenFile, 'r')
		let data: unknown
		try {
			const stat = await file.stat()
			if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096) throw new Error('Invalid token file')
			const buffer = Buffer.alloc(4097)
			const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
			if (bytesRead > 4096) throw new Error('Oversized token file')
			data = JSON.parse(buffer.toString('utf8', 0, bytesRead))
		} finally {
			await file.close()
		}
		if (!data || typeof data !== 'object') throw new Error('Invalid token')
		const value = data as Record<string, unknown>
		const now = Math.floor(Date.now() / 1000)
		if (
			typeof value.token !== 'string' ||
			!/^[0-9a-f]{64}$/.test(value.token) ||
			typeof value.expires_at !== 'number' ||
			!Number.isSafeInteger(value.expires_at) ||
			value.expires_at <= now ||
			value.expires_at > now + 600
		)
			throw new Error('Invalid token')
		return reply(200, { token: value.token, expires_at: value.expires_at, mode: 'local' })
	} catch {
		// The response exposes the degraded state, never the file contents or filesystem path.
		return reply(503, { error: 'Demo token is unavailable or expired. Refresh local provisioning.' })
	}
}
