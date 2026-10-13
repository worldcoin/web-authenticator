const ISSUER = 'https://faux-issuer.us.id-infra.worldcoin.dev/issue'

async function readText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
	if (!body) throw new Error('Missing body')
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let size = 0
	let text = ''
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) return text + decoder.decode()
			size += value.byteLength
			if (size > limit) {
				await reader.cancel()
				throw new Error('Body too large')
			}
			text += decoder.decode(value, { stream: true })
		}
	} finally {
		reader.releaseLock()
	}
}

export async function POST(request: Request) {
	if (request.headers.get('origin') !== new URL(request.url).origin) {
		return Response.json({ error: 'Same-origin requests required' }, { status: 403 })
	}
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
		return Response.json({ error: 'Expected JSON' }, { status: 415 })
	}
	let sub: string
	try {
		const body = JSON.parse(await readText(request.body, 1024)) as { sub?: unknown } | null
		if (!body || typeof body.sub !== 'string' || !/^0x[0-9a-f]{64}$/.test(body.sub))
			throw new Error('Invalid subject')
		sub = body.sub
	} catch {
		return Response.json({ error: 'Expected a 32-byte lowercase hex subject' }, { status: 400 })
	}
	try {
		const upstream = await fetch(ISSUER, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ sub }),
			cache: 'no-store',
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
		})
		if (!upstream.ok) {
			await upstream.body?.cancel()
			console.warn('faux_issuer_failed', { operation: 'issue', upstreamStatus: upstream.status })
			return Response.json({ error: 'Staging faux issuer rejected the request' }, { status: 502 })
		}
		const body = await readText(upstream.body, 1_000_000)
		return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
	} catch (cause) {
		const failure = cause instanceof DOMException && cause.name === 'TimeoutError' ? 'timeout' : 'request_failed'
		console.warn('faux_issuer_failed', { operation: 'issue', failure })
		return Response.json(
			{ error: 'Staging faux issuer unavailable' },
			{ status: failure === 'timeout' ? 504 : 502 }
		)
	}
}
