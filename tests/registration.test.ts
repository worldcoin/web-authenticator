import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WalletKit, InitializeOptions } from '../src/lib/walletkit'
import { derivePasskeySecrets, expandSecret } from '../src/lib/passkey-secrets'
import { passkeyStorageId, registerOnStaging } from '../src/lib/staging-registration'

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex')).buffer

test('HKDF-Expand matches an independent HMAC-SHA256 oracle without an Extract step', async () => {
	const prk = bytes('077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5')
	const { createHmac } = await import('node:crypto')
	const label = 'web.world.org/v1/authenticator-secret'
	const expected = createHmac('sha256', Buffer.from(prk))
		.update(label)
		.update(Buffer.from([1]))
		.digest()
	assert.deepEqual(Buffer.from(await expandSecret(prk, label)), expected)
})

test('derivation separates identity/storage secrets, is deterministic, and clears PRF buffers', async () => {
	const first = new Uint8Array(32).fill(7)
	const second = new Uint8Array(32).fill(7)
	const secrets = await derivePasskeySecrets(first.buffer, second.buffer)
	const again = await derivePasskeySecrets(new Uint8Array(32).fill(7).buffer, new Uint8Array(32).fill(7).buffer)
	assert.notDeepEqual(secrets.seed, secrets.databaseKey)
	assert.deepEqual(secrets.seed, again.seed)
	assert.deepEqual(secrets.databaseKey, again.databaseKey)
	assert.ok(first.every(byte => byte === 0) && second.every(byte => byte === 0))
})

test('rejects malformed PRF output and clears both buffers', async () => {
	const first = new Uint8Array(32).fill(7)
	const second = new Uint8Array(31).fill(7)
	await assert.rejects(derivePasskeySecrets(first.buffer, second.buffer), /32-byte/)
	assert.ok(first.every(byte => byte === 0) && second.every(byte => byte === 0))
})

const publicMaterial = {
	authenticatorAddress: 'public-address',
	authenticatorPubkey: 'public-key',
	offchainSignerCommitment: 'public-commitment',
}
const secrets = () => ({ seed: new Uint8Array(32).fill(1), databaseKey: new Uint8Array(32).fill(2) })
function fakeWallet(overrides: Partial<WalletKit> = {}) {
	return {
		recoveryDataFromSeed: async () => publicMaterial,
		register: async () => {},
		pollRegistration: async () => ({ state: 'finalized' }),
		initializeAuthenticator: async () => {},
		terminate: () => {},
		...overrides,
	} as WalletKit
}

test('registers exactly once on staging, initializes after finalized, retains the session, and clears secrets', async () => {
	const input = secrets()
	const phases: string[] = []
	let registrations = 0
	let polls = 0
	let stopped = false
	let initialized = false
	const wallet = fakeWallet({
		register: async seed => {
			assert.deepEqual(seed, new Uint8Array(32).fill(1))
			registrations++
		},
		pollRegistration: async () => ({ state: ++polls === 1 ? 'submitted' : 'finalized' }),
		initializeAuthenticator: async seed => {
			assert.equal(polls, 2)
			assert.deepEqual(seed, new Uint8Array(32).fill(1))
			initialized = true
		},
		terminate: () => {
			stopped = true
		},
	})
	const session = await registerOnStaging(
		input,
		'credential-id',
		new AbortController().signal,
		p => phases.push(p),
		material => assert.deepEqual(material, publicMaterial),
		async (options: InitializeOptions) => {
			assert.equal(options.environment, 'staging')
			assert.equal(options.storageId, await passkeyStorageId('credential-id'))
			assert.deepEqual(options.databaseKey, new Uint8Array(32).fill(2))
			return wallet
		}
	)
	assert.equal(registrations, 1)
	assert.deepEqual(phases, ['loading', 'registering', 'submitted', 'finalized', 'initializing'])
	assert.ok(initialized)
	assert.equal(session, wallet)
	assert.equal(stopped, false)
	assert.ok(input.seed.every(byte => byte === 0) && input.databaseKey.every(byte => byte === 0))
})

test('uncertain submission fails without retrying or surfacing raw dependency payloads', async () => {
	let registrations = 0
	const input = secrets()
	const phases: string[] = []
	await assert.rejects(
		registerOnStaging(
			input,
			'id',
			new AbortController().signal,
			p => phases.push(p),
			() => {},
			async () =>
				fakeWallet({
					register: async () => {
						registrations++
						throw new Error('sensitive payload')
					},
				})
		),
		error =>
			error instanceof Error &&
			/may already have been submitted/.test(error.message) &&
			!error.message.includes('sensitive payload')
	)
	assert.equal(registrations, 1)
	assert.ok(!phases.includes('finalized'))
	assert.ok(input.seed.every(byte => byte === 0) && input.databaseKey.every(byte => byte === 0))
})

test('abort bounds a hung registration call and releases the worker', async () => {
	const controller = new AbortController()
	const input = secrets()
	let stopped = false
	await assert.rejects(
		registerOnStaging(
			input,
			'id',
			controller.signal,
			() => {},
			() => {},
			async () =>
				fakeWallet({
					register: () => {
						setTimeout(() => controller.abort(), 10)
						return new Promise(() => {})
					},
					terminate: () => {
						stopped = true
					},
				})
		)
	)
	assert.ok(stopped)
	assert.ok(input.seed.every(byte => byte === 0) && input.databaseKey.every(byte => byte === 0))
})

test('initialization failure after finalization preserves success status and cleans up', async () => {
	let stopped = false
	const input = secrets()
	const phases: string[] = []
	await assert.rejects(
		registerOnStaging(
			input,
			'id',
			new AbortController().signal,
			phase => phases.push(phase),
			() => {},
			async () =>
				fakeWallet({
					initializeAuthenticator: async () => {
						throw new Error('private dependency details')
					},
					terminate: () => {
						stopped = true
					},
				})
		),
		/registration succeeded, but authenticator initialization failed/
	)
	assert.ok(phases.includes('finalized'))
	assert.ok(stopped)
	assert.ok(input.seed.every(byte => byte === 0) && input.databaseKey.every(byte => byte === 0))
})
