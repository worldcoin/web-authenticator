import { resolve, sep } from 'node:path'
import { GET as stagingRp } from './routes/staging-rp'
import { POST as teeAdmission } from './routes/tee-admission'
import { GET as clientContext } from './routes/client-context'
import { handle as selfieEnclave } from './routes/selfie-enclave'
import { POST as fauxCredential } from './routes/faux-credential'
import { POST as selfieCredential } from './routes/selfie-credential'

const endpoints: Record<string, { method: string; handle: (request: Request) => Response | Promise<Response> }> = {
	'/api/selfie-enclave': { method: 'GET', handle: selfieEnclave },
	'/api/selfie-admission': { method: 'POST', handle: selfieEnclave },
	'/api/tee-admission': { method: 'POST', handle: teeAdmission },
	'/api/client-context': { method: 'GET', handle: clientContext },
	'/api/staging-rp': { method: 'GET', handle: stagingRp },
	'/api/faux-credential': { method: 'POST', handle: fauxCredential },
	'/api/selfie-credential': { method: 'POST', handle: selfieCredential },
}

export async function handleRequest(request: Request): Promise<Response> {
	const url = new URL(request.url)
	const endpoint = endpoints[url.pathname]
	let response: Response
	if (endpoint) {
		response =
			request.method === endpoint.method
				? await endpoint.handle(request)
				: new Response('Method not allowed', { status: 405, headers: { Allow: endpoint.method } })
	} else if (url.pathname.startsWith('/api/')) {
		response = Response.json({ error: 'Not found' }, { status: 404 })
	} else if (!['GET', 'HEAD'].includes(request.method)) {
		response = new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
	} else {
		const root = resolve('dist')
		let path: string
		try {
			path = resolve(root, '.' + decodeURIComponent(url.pathname))
		} catch {
			return new Response('Invalid path', { status: 400, headers: { 'Referrer-Policy': 'no-referrer' } })
		}
		if (path !== root && !path.startsWith(root + sep)) {
			response = new Response('Not found', { status: 404 })
		} else {
			const page = ['/', '/verify', '/selfie-check', '/selfie-demo'].includes(url.pathname)
			const file = Bun.file(page ? resolve(root, 'index.html') : path)
			response = (await file.exists())
				? new Response(request.method === 'HEAD' ? null : file, {
						headers: { 'Content-Type': file.type, 'Cache-Control': page ? 'no-store' : 'no-cache' },
					})
				: new Response('Not found', { status: 404 })
		}
	}
	response.headers.set('Referrer-Policy', 'no-referrer')
	return response
}
