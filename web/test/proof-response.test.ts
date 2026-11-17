import { expect, spyOn, test } from 'bun:test'
import { parseProofResponse } from '../lib/proof-response'
import { loadIncomingRequest } from '../lib/incoming-request'
import { encryptedRequest, signedRequest } from '../../tests/integration/fixtures/request'
import { proofResponse } from './fixtures/proof-response'

test('proof response parsing preserves encoded material, claims and additive metadata', () => {
	for (const issuer of [11, '11']) {
		const source = proofResponse(issuer)
		const wire = {
			...source, metadata: { version: 'future' },
			responses: [{ ...source.responses[0], claims: ['0x01'], extra: { retained: true } }],
		}
		expect(parseProofResponse(JSON.stringify(wire))).toEqual(wire)
	}
})

test('proof response parsing rejects malformed success bodies without exposing their contents', () => {
	const source = proofResponse()
	const invalidItems = [
		null, [], 'private proof', {},
		...['identifier', 'issuer_schema_id', 'proof', 'nullifier', 'expires_at_min'].map(key => ({ ...source.responses[0], [key]: undefined })),
		...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'not-an-integer', '18446744073709551616', '11\n'].map(issuer_schema_id => ({ ...source.responses[0], issuer_schema_id })),
		{ ...source.responses[0], proof: '00'.repeat(159) },
		{ ...source.responses[0], proof: source.responses[0].proof + '\n' },
		{ ...source.responses[0], nullifier: '0x' + '0'.repeat(64) },
		{ ...source.responses[0], nullifier: source.responses[0].nullifier + '\n' },
		{ ...source.responses[0], session_nullifier: 'unexpected session proof' },
		{ ...source.responses[0], claims: [1] },
	]
	for (const body of [
		null, [], {}, { ...source, id: 42 }, { ...source, version: 2 },
		{ ...source, error: 'private upstream error' }, { ...source, responses: [] },
		{ ...source, session_id: 'unexpected bound session' },
		{ ...source, responses: Array(33).fill(source.responses[0]) },
		...invalidItems.map(item => ({ ...source, responses: [item] })),
	]) {
		expect(() => parseProofResponse(JSON.stringify(body))).toThrow('WalletKit returned an invalid proof response.')
	}
	expect(() => parseProofResponse('{private invalid json')).toThrow('WalletKit returned an invalid proof response.')
})

test('invalid or mismatched proof responses never reach the bridge', async () => {
	const { payload, registry } = await signedRequest()
	const encrypted = await encryptedRequest(payload)
	let submissions = 0
	const fetch = spyOn(globalThis, 'fetch').mockImplementation((async input => {
		const url = String(input)
		if (url.startsWith('/api/staging-rp')) return Response.json(registry)
		if (url.includes('/request/')) return Response.json(encrypted.body)
		submissions++
		return new Response(null, { status: 204 })
	}) as typeof globalThis.fetch)
	try {
		const signal = new AbortController().signal
		const incoming = (await loadIncomingRequest('http://localhost' + encrypted.query, signal, () => {}))!
		for (const proof of [
			'{private invalid json',
			JSON.stringify({ ...proofResponse(), responses: [null] }),
			JSON.stringify({ ...proofResponse(), error: 'private upstream error' }),
			JSON.stringify({ ...proofResponse(), id: 'another-request' }),
		]) await expect(incoming.deliver(proof, signal)).rejects.toThrow('WalletKit returned')
		expect(submissions).toBe(0)
	} finally { fetch.mockRestore() }
})
