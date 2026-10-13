import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WalletKit } from '../src/lib/walletkit'
import { POST } from '../src/server/routes/faux-credential'
import {
	initializeAuthenticator,
	issueFauxCredential,
	type FauxIssuanceExchange,
} from '../src/lib/authenticator-session'

const material = { authenticatorAddress: '0x123', authenticatorPubkey: 'key', offchainSignerCommitment: 'commitment' }
const makeSecrets = () => ({ seed: new Uint8Array(32).fill(1), databaseKey: new Uint8Array(32).fill(2) })

test('initialization matches saved public material, opens vault, clears supplied secrets, keeps worker alive', async () => {
	const secrets = makeSecrets()
	let initialized = false
	let terminated = false
	const wallet = {
		recoveryDataFromSeed: async () => material,
		initializeAuthenticator: async (seed: Uint8Array) => {
			assert.equal(seed[0], 1)
			initialized = true
		},
		terminate: () => {
			terminated = true
		},
	} as unknown as WalletKit
	const result = await initializeAuthenticator(
		secrets,
		'passkey-id',
		material,
		new AbortController().signal,
		async options => {
			assert.equal(options.environment, 'staging')
			assert.equal(options.databaseKey[0], 2)
			return wallet
		}
	)
	assert.equal(result, wallet)
	assert.ok(initialized && !terminated)
	assert.ok(secrets.seed.every(byte => byte === 0) && secrets.databaseKey.every(byte => byte === 0))
})

test('identity mismatch stops before authenticator/vault initialization', async () => {
	let terminated = false
	let initialized = false
	const secrets = makeSecrets()
	await assert.rejects(
		initializeAuthenticator(
			secrets,
			'id',
			material,
			new AbortController().signal,
			async () =>
				({
					recoveryDataFromSeed: async () => ({ ...material, authenticatorPubkey: 'other' }),
					initializeAuthenticator: async () => {
						initialized = true
					},
					terminate: () => {
						terminated = true
					},
				}) as unknown as WalletKit
		),
		/saved account identity/
	)
	assert.ok(terminated && !initialized)
	assert.ok(secrets.seed.every(byte => byte === 0))
})

test('faux issuance preserves signed u64 values and sends only subject to issuer', async () => {
	let stored = false
	const wallet = {
		prepareCredential: async (schema: bigint) => {
			assert.equal(schema, BigInt(128))
			return { sub: 'subject', blindingFactor: 'factor' }
		},
		storeCredential: async (bytes: Uint8Array, factor: string) => {
			assert.equal(new TextDecoder().decode(bytes), '{"large":18446744073709551615}')
			assert.equal(factor, 'factor')
			stored = true
			return { credentialId: BigInt(1), issuerSchemaId: BigInt(128) }
		},
		terminate: () => {
			throw new Error('Successful issuance should keep vault open')
		},
	} as unknown as WalletKit
	const request = (async (_url, options) => {
		assert.deepEqual(JSON.parse(options!.body as string), { sub: 'subject' })
		return new Response('{"credential":{"large":18446744073709551615}}')
	}) as typeof fetch
	const exchanges: FauxIssuanceExchange[] = []
	await issueFauxCredential(wallet, new AbortController().signal, request, exchange => exchanges.push(exchange))
	assert.deepEqual(exchanges[0].request.body, { sub: 'subject' })
	assert.equal(exchanges[1].response?.body, '{"credential":{"large":18446744073709551615}}')
	assert.equal(exchanges[1].response?.status, 200)
	assert.ok(!JSON.stringify(exchanges).includes('factor'))
	assert.ok(stored)
})

test('malformed issuer response never reaches storage and closes session', async () => {
	let terminated = false
	const wallet = {
		prepareCredential: async () => ({ sub: 'subject', blindingFactor: 'factor' }),
		storeCredential: async () => {
			throw new Error('Should not store')
		},
		terminate: () => {
			terminated = true
		},
	} as unknown as WalletKit
	await assert.rejects(
		issueFauxCredential(
			wallet,
			new AbortController().signal,
			(async () => new Response('{"credential":null}')) as unknown as typeof fetch
		),
		/request the staging faux credential/
	)
	assert.ok(terminated)
})

test('issuer proxy rejects cross-origin and malformed requests before upstream calls', async () => {
	const crossOrigin = new Request('http://localhost:3100/api/faux-credential', {
		method: 'POST',
		headers: { origin: 'https://other.example' },
	})
	assert.equal((await POST(crossOrigin)).status, 403)
	for (const body of ['not-json', '{"sub":"invalid"}', 'a'.repeat(2048)]) {
		const request = new Request('http://localhost:3100/api/faux-credential', {
			method: 'POST',
			headers: { origin: 'http://localhost:3100', 'content-type': 'application/json' },
			body,
		})
		assert.equal((await POST(request)).status, 400)
	}
})
