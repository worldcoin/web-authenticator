import { loadPolicy, parseChallenge, readSigningKey, signChallenge } from '../selfie-enclave'

const reply = (status: number, data: unknown) =>
	Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const configFromEnv = () => ({
	enabled: process.env.NODE_ENV !== 'production' && process.env.LOCAL_TEE_DEMO_ADMISSION === '1',
	origin: process.env.LOCAL_TEE_ORIGIN || 'http://localhost:3100',
	policyFile: process.env.TEE_ENROLLMENT_CONFIG_FILE,
	keyFile: process.env.TEE_ADMISSION_KEY_FILE,
})

export async function handle(request: Request, config = configFromEnv()) {
	if (!config.enabled) return reply(404, { error: 'Not found' })
	const url = new URL(request.url)
	if (
		url.protocol !== 'http:' ||
		!['localhost', '127.0.0.1'].includes(url.hostname) ||
		url.origin !== config.origin ||
		request.headers.get('sec-fetch-site') !== 'same-origin' ||
		(request.method === 'POST' && request.headers.get('origin') !== config.origin)
	)
		return reply(403, { error: 'Staging admission requires the configured localhost origin.' })
	if (!config.policyFile || !config.keyFile)
		return reply(503, { error: 'Staging enclave policy and admission key are not configured.' })
	let policy
	try {
		policy = await loadPolicy(config.policyFile)
	} catch {
		return reply(503, { error: 'Staging enclave policy is unavailable or invalid.' })
	}
	if (request.method === 'GET') return reply(200, policy)
	if (request.method !== 'POST') return reply(405, { error: 'Expected GET or POST' })
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
		return reply(415, { error: 'Expected JSON' })
	let challenge
	const reader = request.body?.getReader()
	if (!reader) return reply(400, { error: 'Missing challenge' })
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const body = await Promise.race([
			(async () => {
				const chunks: Uint8Array[] = []
				let size = 0
				for (;;) {
					const { done, value } = await reader.read()
					if (done) break
					size += value.length
					if (size > 2048) throw new Error('Oversized challenge')
					chunks.push(value)
				}
				return JSON.parse(Buffer.concat(chunks).toString('utf8'))
			})(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Timed out')), 5000)
			}),
		])
		challenge = parseChallenge(body, policy.audience)
	} catch {
		return reply(400, { error: 'Invalid or incomplete admission challenge.' })
	} finally {
		clearTimeout(timer)
		await reader.cancel().catch(() => {
			/* Request already disconnected. */
		})
	}
	try {
		return reply(200, signChallenge(challenge, await readSigningKey(config.keyFile), Math.floor(Date.now() / 1000)))
	} catch {
		return reply(503, { error: 'Staging admission signing key is unavailable or invalid.' })
	}
}
