import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'bun:test'
import { handle } from '../src/server/routes/selfie-enclave'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { createECDH, createPublicKey, verify } from 'node:crypto'
import { parseChallenge, parsePolicy, signChallenge, readSigningKey } from '../src/server/selfie-enclave'

const directory = await mkdtemp(join(tmpdir(), 'selfie-admission-test-'))
afterAll(() => rm(directory, { recursive: true, force: true }))
const ecdh = createECDH('prime256v1')
ecdh.generateKeys()
const privateHex = ecdh.getPrivateKey().toString('hex').padStart(64, '0')
const publicBytes = ecdh.getPublicKey()
const publicKey = createPublicKey({
	format: 'jwk',
	key: {
		kty: 'EC',
		crv: 'P-256',
		x: publicBytes.subarray(1, 33).toString('base64url'),
		y: publicBytes.subarray(33).toString('base64url'),
	},
})
const audience = 'selfie-enrollment-stage.worldcoin.dev'
const challenge = { audience, nonce: Array.from({ length: 32 }, (_, index) => index) }
const policy = {
	endpoint: `wss://${audience}/v1/embeddings`,
	audience,
	releases: [
		{
			pcr0: 'a'.repeat(96),
			pcr1: 'b'.repeat(96),
			pcr2: 'c'.repeat(96),
			worker_sha384: 'd'.repeat(96),
		},
	],
}
const policyFile = join(directory, 'policy.json')
const keyFile = join(directory, 'key.hex')
await writeFile(policyFile, JSON.stringify(policy))
await writeFile(keyFile, privateHex, { mode: 0o600 })
const config = { enabled: true, origin: 'http://localhost:3100', policyFile, keyFile }
function request(body: unknown = challenge, headers: Record<string, string> = {}) {
	return new Request('http://localhost:3100/api/selfie-admission', {
		method: 'POST',
		headers: {
			origin: config.origin,
			'sec-fetch-site': 'same-origin',
			'content-type': 'application/json',
			...headers,
		},
		body: JSON.stringify(body),
	})
}

test('ticket uses the Rust JSON tuple, SHA-256 and fixed-width P256 signature', () => {
	const ticket = signChallenge(challenge, privateHex, 1000)
	expect(ticket.expires_at).toBe(1030)
	expect(ticket.signature).toHaveLength(128)
	const message = (nonce = challenge.nonce, expires = ticket.expires_at) =>
		Buffer.from(JSON.stringify(['selfie-enrollment/admission/v1', audience, nonce, expires]))
	const options = { key: publicKey, dsaEncoding: 'ieee-p1363' as const }
	const signature = Buffer.from(ticket.signature, 'hex')
	expect(verify('sha256', message(), options, signature)).toBe(true)
	expect(verify('sha256', message(Array(32).fill(9)), options, signature)).toBe(false)
	expect(verify('sha256', message(challenge.nonce, 1031), options, signature)).toBe(false)
})

test('rejects wrong audiences, malformed nonces, extra fields and untrusted policies', () => {
	for (const value of [
		null,
		{ ...challenge, audience: 'other' },
		{ ...challenge, nonce: Array(32).fill(256) },
		{ ...challenge, nonce: Array(31).fill(0) },
		{ ...challenge, nonce: Array(32).fill(0.5) },
		{ ...challenge, extra: true },
	])
		expect(() => parseChallenge(value, audience)).toThrow()
	expect(parsePolicy(policy)).toEqual(policy)
	expect(() => parsePolicy({ ...policy, endpoint: 'ws://attacker.example' })).toThrow()
	expect(() => parsePolicy({ ...policy, releases: [{ ...policy.releases[0], pcr0: '0'.repeat(96) }] })).toThrow()
})

test('local route gates origin, environment, content type, payload and configuration', async () => {
	expect((await handle(request(), config)).status).toBe(200)
	expect((await handle(request(), { ...config, enabled: false })).status).toBe(404)
	expect((await handle(request(), { ...config, keyFile: undefined })).status).toBe(503)
	expect((await handle(request(challenge, { origin: 'http://evil.example' }), config)).status).toBe(403)
	expect((await handle(request(challenge, { 'sec-fetch-site': 'cross-site' }), config)).status).toBe(403)
	expect((await handle(request(challenge, { 'content-type': 'text/plain' }), config)).status).toBe(415)
	expect((await handle(request({ ...challenge, audience: 'wrong' }), config)).status).toBe(400)
	expect((await handle(request('x'.repeat(3000)), config)).status).toBe(400)
	expect((await handle(request(), { ...config, keyFile: join(directory, 'missing') })).status).toBe(503)
})

test('refuses signing keys readable by other users', async () => {
	const insecure = join(directory, 'insecure.hex')
	await writeFile(insecure, privateHex)
	await chmod(insecure, 0o644)
	await expect(readSigningKey(insecure)).rejects.toThrow('Invalid key file')
})
