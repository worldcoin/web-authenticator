import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { WalletKit } from '../lib/walletkit'
import type { WalletKit as PublishedWalletKit, CredentialStore } from '@worldcoin/walletkit-web'

function fixture(actualSubject = '0x01', generatedSubject = '0x01') {
	const freed: string[] = []
	const field = (name: string, hex: string) => ({
		toHexString: async () => hex,
		free: () => freed.push(name),
	})
	let writes = 0
	let failInit = false
	let failSub = false
	let failParseAt: number | undefined
	let parseCount = 0
	let failOwnershipProof = false
	const parsedFields: ReturnType<typeof field>[] = []
	const ownershipCalls: unknown[][] = []
	const ownershipProof = new Uint8Array([0xa1, 0x01, 0x43, 0x00, 0x80, 0xff])
	const credential = {
		sub: async () => field('actual', actualSubject),
		expiresAt: async () => BigInt(1000),
		issuerSchemaId: async () => BigInt(11),
		claimsHex: async () => ['score', 'matches', 'size'],
		free: () => freed.push('credential'),
	}
	const response = {
		toJson: async () => JSON.stringify({ responses: [{ issuer_schema_id: '11' }, { issuer_schema_id: '128' }] }),
		free: () => freed.push('response'),
	}
	const authenticator = {
		initStorage: async () => {
			if (failInit) throw new Error('storage unavailable')
		},
		computeCredentialSub: async () => {
			if (failSub) throw new Error('subject unavailable')
			return field('expected', generatedSubject)
		},
		generateCredentialBlindingFactorRemote: async () => field('factor', '0x02'),
		generateProof: async () => response,
		proveCredentialSub: async (...args: unknown[]) => {
			ownershipCalls.push(args)
			if (failOwnershipProof) throw new Error('ownership proof failed')
			return ownershipProof
		},
		free: () => freed.push('authenticator'),
	}
	const client = {
		EmbeddedZkArtifacts: { new: async () => ({ free: () => freed.push('artifacts') }) },
		Authenticator: { initWithDefaults: async () => authenticator },
		Credential: { fromBytes: async () => credential },
		FieldElement: {
			tryFromHexString: async (hex: string) => {
				if (++parseCount === failParseAt) throw new Error('invalid field element')
				const parsed = field(hex === '0x02' ? 'factor' : hex, hex)
				parsedFields.push(parsed)
				return parsed
			},
		},
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
		parsedFields,
		ownershipCalls,
		ownershipProof,
		writes: () => writes,
		failInit: () => {
			failInit = true
		},
		failSub: () => {
			failSub = true
		},
		failParseAt: (index: number) => {
			failParseAt = index
		},
		failOwnershipProof: () => {
			failOwnershipProof = true
		},
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

test('subject preparation returns canonical unpadded hex and preserves the blinding factor', async () => {
	const f = fixture('0x01', `0x${'0'.repeat(62)}1f`)
	await f.wallet.initializeAuthenticator(new Uint8Array(32))
	f.freed.length = 0
	assert.deepEqual(await f.wallet.prepareCredential(11n), { blindingFactor: '0x02', sub: '0x1f' })
	assert.deepEqual(f.freed, ['expected', 'factor'])
})

test('subject preparation rejects zero or invalid hex and releases both handles', async () => {
	for (const subject of ['0x0', `0x${'0'.repeat(64)}`, 'not hex']) {
		const f = fixture('0x01', subject)
		await f.wallet.initializeAuthenticator(new Uint8Array(32))
		f.freed.length = 0
		await assert.rejects(f.wallet.prepareCredential(11n), /nonzero hex field element/)
		assert.deepEqual(f.freed, ['expected', 'factor'])
	}
})

test('proof disclosure preserves only the selfie score and frees response/request/credential handles', async () => {
	const f = fixture()
	await f.wallet.initializeAuthenticator(new Uint8Array(32))
	const proof = JSON.parse(await f.wallet.generateProof('{}'))
	assert.deepEqual(proof.responses, [{ issuer_schema_id: '11', claims: ['score'] }, { issuer_schema_id: '128' }])
	for (const name of ['response', 'request', 'credential']) assert.ok(f.freed.includes(name))
})

test('ownership proof forwards field elements in order and returns raw proof bytes unchanged', async () => {
	const f = fixture()
	await f.wallet.initializeAuthenticator(new Uint8Array(32))
	f.freed.length = 0
	const proof = await f.wallet.proveCredentialSub('0x11', '0x12', '0x13', '0x14', 123n)
	assert.equal(proof, f.ownershipProof)
	assert.deepEqual(f.ownershipCalls, [[...f.parsedFields, 123n]])
	assert.deepEqual(await Promise.all(f.parsedFields.map(field => field.toHexString())), ['0x11', '0x12', '0x13', '0x14'])
	assert.deepEqual(f.freed, ['0x14', '0x13', '0x12', '0x11'])
})

test('ownership proof releases every parsed field when a later field is invalid', async () => {
	const inputs = ['0x11', '0x12', '0x13', '0x14'] as const
	for (let index = 1; index <= inputs.length; index++) {
		const f = fixture()
		await f.wallet.initializeAuthenticator(new Uint8Array(32))
		f.freed.length = 0
		f.failParseAt(index)
		await assert.rejects(f.wallet.proveCredentialSub(...inputs), /invalid field element/)
		assert.deepEqual(f.ownershipCalls, [])
		assert.deepEqual(f.freed, inputs.slice(0, index - 1).reverse())
	}
})

test('ownership proof failure releases all field elements', async () => {
	const f = fixture()
	await f.wallet.initializeAuthenticator(new Uint8Array(32))
	f.freed.length = 0
	f.failOwnershipProof()
	await assert.rejects(f.wallet.proveCredentialSub('0x11', '0x12', '0x13', '0x14'), /ownership proof failed/)
	assert.equal(f.ownershipCalls.length, 1)
	assert.deepEqual(f.freed, ['0x14', '0x13', '0x12', '0x11'])
})
