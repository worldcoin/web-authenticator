import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { WalletKit } from '../lib/walletkit'
import type { WalletKit as PublishedWalletKit, CredentialStore } from '@worldcoin/walletkit-web'
import { proofResponse } from './fixtures/proof-response'

function fixture(actualSubject = '0x01') {
	const freed: string[] = []
	const field = (name: string, hex: string) => ({
		toHexString: async () => hex,
		free: () => freed.push(name),
	})
	let writes = 0
	let failInit = false
	let failSub = false
	let proofJson = JSON.stringify({ ...proofResponse('11'), responses: [proofResponse('11').responses[0], proofResponse('128').responses[0]] })
	const credential = {
		sub: async () => field('actual', actualSubject),
		expiresAt: async () => BigInt(1000),
		issuerSchemaId: async () => BigInt(11),
		claimsHex: async () => ['score', 'matches', 'size'],
		free: () => freed.push('credential'),
	}
	const response = {
		toJson: async () => proofJson,
		free: () => freed.push('response'),
	}
	const authenticator = {
		initStorage: async () => {
			if (failInit) throw new Error('storage unavailable')
		},
		computeCredentialSub: async () => {
			if (failSub) throw new Error('subject unavailable')
			return field('expected', '0x01')
		},
		generateCredentialBlindingFactorRemote: async () => field('factor', '0x02'),
		generateProof: async () => response,
		free: () => freed.push('authenticator'),
	}
	const client = {
		EmbeddedZkArtifacts: { new: async () => ({ free: () => freed.push('artifacts') }) },
		Authenticator: { initWithDefaults: async () => authenticator },
		Credential: { fromBytes: async () => credential },
		FieldElement: { tryFromHexString: async () => field('factor', '0x02') },
		ProofRequest: { fromJson: async () => ({ free: () => freed.push('request') }) },
	} as unknown as PublishedWalletKit
	const store = {
		storeCredential: async () => {
			writes++
			return BigInt(7)
		},
		fetchCredential: async () => credential,
	} as unknown as CredentialStore
	return {
		wallet: new WalletKit(client, store, 'staging', 'us'),
		freed,
		writes: () => writes,
		failInit: () => {
			failInit = true
		},
		failSub: () => {
			failSub = true
		},
		proofJson: (json: string) => { proofJson = json },
	}
}

test('published adapter refuses a different credential subject before writing and releases handles', async () => {
	const f = fixture('0x03')
	await f.wallet.initializeAuthenticator(new Uint8Array(32))
	await assert.rejects(f.wallet.storeCredential(new Uint8Array(), '0x02'), /subject does not match/)
	assert.equal(f.writes(), 0)
	for (const name of ['actual', 'expected', 'factor', 'credential']) assert.ok(f.freed.includes(name))
})

test('published adapter stores a matching credential and returns its schema/id', async () => {
	const f = fixture()
	await f.wallet.initializeAuthenticator(new Uint8Array(32))
	assert.deepEqual(await f.wallet.storeCredential(new Uint8Array(), '0x02'), {
		credentialId: BigInt(7),
		issuerSchemaId: BigInt(11),
	})
	assert.equal(f.writes(), 1)
})

test('failed vault initialization releases the authenticator and never marks the session ready', async () => {
	const f = fixture()
	f.failInit()
	await assert.rejects(f.wallet.initializeAuthenticator(new Uint8Array(32)), /storage unavailable/)
	assert.throws(() => f.wallet.listCredentials(), /Initialize the authenticator first/)
	assert.deepEqual(f.freed, ['authenticator', 'artifacts'])
})

test('subject preparation releases the blinding factor when computation fails', async () => {
	const f = fixture()
	await f.wallet.initializeAuthenticator(new Uint8Array(32))
	f.failSub()
	await assert.rejects(f.wallet.prepareCredential(BigInt(11)), /subject unavailable/)
	assert.ok(f.freed.includes('factor'))
})

test('proof disclosure preserves only the selfie score and frees response/request/credential handles', async () => {
	const f = fixture()
	await f.wallet.initializeAuthenticator(new Uint8Array(32))
	const proof = JSON.parse(await f.wallet.generateProof('{}'))
	assert.deepEqual(proof.responses, [{ ...proofResponse('11').responses[0], claims: ['score'] }, proofResponse('128').responses[0]])
	for (const name of ['response', 'request', 'credential']) assert.ok(f.freed.includes(name))
})

test('malformed proof responses fail before credential access and release Rust handles', async () => {
	for (const json of ['{private malformed payload', JSON.stringify({ ...proofResponse(), responses: [null] }), JSON.stringify({ ...proofResponse(), error: 'private upstream error' })]) {
		const f = fixture()
		await f.wallet.initializeAuthenticator(new Uint8Array(32))
		f.proofJson(json)
		await assert.rejects(f.wallet.generateProof('{}'), { message: 'WalletKit returned an invalid proof response.' })
		assert.ok(f.freed.includes('response'))
		assert.ok(f.freed.includes('request'))
		assert.ok(!f.freed.includes('credential'))
	}
})
