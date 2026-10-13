import { handleRequest } from './http'

const port = Number(process.env.PORT || 3100)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const server = Bun.serve({
	hostname: '127.0.0.1',
	port,
	idleTimeout: 180,
	maxRequestBodySize: 1024 * 1024,
	fetch: handleRequest,
	error() {
		console.error('local_api_request_failed')
		return Response.json(
			{ error: 'Local API request failed' },
			{ status: 500, headers: { 'Referrer-Policy': 'no-referrer' } }
		)
	},
})
console.info(`Local API listening on http://127.0.0.1:${server.port}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		server.stop(true)
		process.exit(0)
	})
}
