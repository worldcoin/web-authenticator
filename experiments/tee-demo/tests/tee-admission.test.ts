import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { POST } from '../src/server/routes/tee-admission'
import { requestDemoToken } from '../src/lib/tee-admission'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'

const origin = 'http://localhost:3100'
const token = 'a'.repeat(64)
const valid = () => ({ token, expires_at: Math.floor(Date.now() / 1000) + 300 })
const request = (headers: Record<string, string> = {}, url = origin) =>
	new Request(url + '/api/tee-admission', {
		method: 'POST',
		headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers },
		body: '{}',
	})

async function fixture(run: (config: { enabled: boolean; tokenFile: string; origin: string }) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), 'tee-admission-test-'))
	const tokenFile = join(dir, 'token.json')
	await writeFile(tokenFile, JSON.stringify(valid()), { mode: 0o600 })
	try {
		await run({ enabled: true, tokenFile, origin })
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

test('local provider returns only the configured valid token with no-store', async () => {
	await fixture(async config => {
		const response = await POST(request(), config)
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('cache-control'), 'no-store')
		assert.equal(response.headers.has('access-control-allow-origin'), false)
		const data = await response.json()
		assert.equal(data.token, token)
		assert.equal(data.mode, 'local')
		assert.deepEqual(Object.keys(data).sort(), ['expires_at', 'mode', 'token'])
	})
})

test('provider is disabled by default and rejects cross-origin or non-browser requests', async () => {
	assert.equal((await POST(request(), { enabled: false, tokenFile: undefined, origin })).status, 404)
	await fixture(async config => {
		const deniedHeaders: Record<string, string>[] = [
			{ origin: 'http://localhost:9999' },
			{ origin: 'https://evil.example' },
			{ origin: '' },
			{ 'sec-fetch-site': 'cross-site' },
			{ 'sec-fetch-site': '' },
		]
		for (const headers of deniedHeaders) {
			const response = await POST(request(headers), config)
			assert.equal(response.status, 403)
			assert.ok(!(await response.text()).includes(token))
		}
		assert.equal(
			(await POST(request({}, 'https://public.example'), { ...config, origin: 'https://public.example' })).status,
			403
		)
	})
})

test('provider fails closed for missing, expired, malformed and insecure token files', async () => {
	await fixture(async config => {
		for (const value of [
			{ ...valid(), expires_at: 1 },
			{ ...valid(), expires_at: Math.floor(Date.now() / 1000) + 3600 },
			{ ...valid(), token: 'short' },
			null,
			'x'.repeat(5000),
		]) {
			await writeFile(config.tokenFile, JSON.stringify(value))
			const response = await POST(request(), config)
			assert.equal(response.status, 503)
			const body = await response.text()
			assert.ok(!body.includes(config.tokenFile))
			assert.ok(!body.includes(token))
		}
		await writeFile(config.tokenFile, JSON.stringify(valid()))
		await chmod(config.tokenFile, 0o644)
		assert.equal((await POST(request(), config)).status, 503)
		assert.equal((await POST(request(), { ...config, tokenFile: undefined })).status, 503)
	})
})

async function withFetch(
	fake: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
	run: () => Promise<void>
) {
	const original = globalThis.fetch
	globalThis.fetch = Object.assign(fake, { preconnect: original.preconnect })
	try {
		await run()
	} finally {
		globalThis.fetch = original
	}
}

test('browser obtains the provisioned credential through a same-origin POST', async () => {
	await withFetch(
		async (url, init) => {
			assert.equal(url, '/api/tee-admission')
			assert.equal(init?.method, 'POST')
			assert.equal(init?.redirect, 'error')
			assert.equal(init?.cache, 'no-store')
			assert.equal(init?.credentials, 'same-origin')
			return Response.json({ ...valid(), mode: 'local' })
		},
		async () => assert.equal(await requestDemoToken(new AbortController().signal), token)
	)
})

test('browser refuses invalid/expired provisioning and sanitizes errors', async () => {
	for (const response of [
		Response.json({ ...valid(), mode: 'remote' }),
		Response.json({ ...valid(), mode: 'local', expires_at: 1 }),
		Response.json({ ...valid(), mode: 'local', padding: 'x'.repeat(5000) }),
		new Response(token, { status: 503 }),
	]) {
		await withFetch(
			async () => response,
			async () => {
				await assert.rejects(requestDemoToken(new AbortController().signal), error => {
					assert.ok(error instanceof Error)
					assert.ok(!error.message.includes(token))
					return true
				})
			}
		)
	}
})
