import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleRequest } from '../src/server/http'

test('local API router dispatches existing handlers and keeps referrers private', async () => {
	const response = await handleRequest(new Request('http://localhost:3100/api/client-context'))
	assert.equal(response.status, 200)
	assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
	assert.equal(response.headers.get('Cache-Control'), 'no-store')
	assert.equal((await response.json()).verified, false)
})

test('API router rejects unknown routes and incorrect methods without serving the SPA', async () => {
	assert.equal((await handleRequest(new Request('http://localhost:3100/api/missing'))).status, 404)
	const response = await handleRequest(new Request('http://localhost:3100/api/selfie-credential'))
	assert.equal(response.status, 405)
	assert.equal(response.headers.get('Allow'), 'POST')
})

test('migrated selfie API preserves same-origin and localhost restrictions', async () => {
	for (const [url, origin] of [
		['http://localhost:3100/api/selfie-credential', 'https://other.example'],
		['https://public.example/api/selfie-credential', 'https://public.example'],
	]) {
		const response = await handleRequest(
			new Request(url, {
				method: 'POST',
				headers: { origin, 'content-type': 'application/json' },
				body: '{}',
			})
		)
		assert.equal(response.status, 403)
	}
	const response = await handleRequest(
		new Request('http://localhost:3100/api/selfie-credential', {
			method: 'POST',
			headers: { origin: 'http://localhost:3100', 'content-type': 'application/json' },
			body: '{}',
		})
	)
	assert.equal(response.status, 400)
})

test('static server cannot expose files outside dist', async () => {
	const response = await handleRequest(new Request('http://localhost:3100/..%2fpackage.json'))
	assert.equal(response.status, 404)
})
