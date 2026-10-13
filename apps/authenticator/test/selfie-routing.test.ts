import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { CredentialMetadata } from '../src/lib/walletkit'
import {
	credentialAvailability,
	credentialRequirementsLabel,
	type ProofRequest,
	type Constraint,
} from '../src/lib/requests/proof-request'

const request = (constraints?: Constraint): ProofRequest => ({
	id: 'test',
	version: 1,
	proof_type: 'uniqueness',
	rp_id: 'rp_1',
	oprf_key_id: '0x1',
	nonce: '0x00',
	signature: '0x00',
	created_at: 100,
	expires_at: 200,
	action: '0x00',
	session_id: null,
	proof_requests: [
		{ identifier: 'selfie', issuer_schema_id: 11 },
		{ identifier: 'orb', issuer_schema_id: 1 },
	],
	constraints,
})
const credential = (schema: number, overrides: Partial<CredentialMetadata> = {}): CredentialMetadata =>
	({
		credentialId: BigInt(schema),
		issuerSchemaId: BigInt(schema),
		genesisIssuedAt: BigInt(100),
		expiresAt: BigInt(300),
		isExpired: false,
		...overrides,
	}) as CredentialMetadata

test('a missing selfie credential starts enrollment; an available one continues to proof', () => {
	const selfie = request('selfie')
	assert.equal(credentialAvailability(selfie, []).needsSelfieEnrollment, true)
	const available = credentialAvailability(selfie, [credential(11)])
	assert.equal(available.satisfied, true)
	assert.equal(available.needsSelfieEnrollment, false)
})

test('an expired selfie credential can enroll but an active credential outside date bounds does not loop', () => {
	const selfie = request('selfie')
	assert.equal(credentialAvailability(selfie, [credential(11, { isExpired: true })]).needsSelfieEnrollment, true)
	selfie.proof_requests[0].genesis_issued_at_min = 150
	const unavailable = credentialAvailability(selfie, [credential(11)])
	assert.equal(unavailable.satisfied, false)
	assert.equal(unavailable.needsSelfieEnrollment, false)
})

test('an available alternative skips selfie enrollment, including nested constraints', () => {
	const alternative = request({ any: [{ all: ['selfie'] }, 'orb'] })
	for (const schema of [1, 11]) {
		const available = credentialAvailability(alternative, [credential(schema)])
		assert.equal(available.satisfied, true)
		assert.equal(available.canEnrollSelfie, false)
		assert.equal(available.needsSelfieEnrollment, false)
	}
	const missing = credentialAvailability(alternative, [])
	assert.equal(missing.satisfied, false)
	assert.equal(missing.canEnrollSelfie, true)
	assert.equal(missing.needsSelfieEnrollment, false)
	assert.equal(missing.requiresOrb, false)
})

test('enrollment is offered only when adding selfie can satisfy the complete request', () => {
	for (const all of [request(), request({ all: ['selfie', 'orb'] })]) {
		assert.equal(credentialAvailability(all, []).needsSelfieEnrollment, false)
		assert.equal(credentialAvailability(all, [credential(1)]).needsSelfieEnrollment, true)
	}
	assert.equal(credentialAvailability(request('orb'), []).needsSelfieEnrollment, false)
})

test('Orb-only requests use an eligible Orb credential and never substitute Selfie', () => {
	const orb = request('orb')
	for (const records of [[], [credential(11)], [credential(1, { isExpired: true })]]) {
		const result = credentialAvailability(orb, records)
		assert.equal(result.satisfied, false)
		assert.equal(result.requiresOrb, true)
		assert.equal(result.canEnrollSelfie, false)
		assert.equal(result.needsSelfieEnrollment, false)
	}
	assert.equal(credentialAvailability(orb, [credential(1)]).satisfied, true)
	orb.proof_requests[1].expires_at_min = 400
	assert.equal(credentialAvailability(orb, [credential(1)]).satisfied, false)
})

test('unknown issuers and nested alternatives do not become an automatic Selfie choice', () => {
	const mixed = request({ any: ['selfie', { all: ['orb', 'other'] }] })
	mixed.proof_requests.push({ identifier: 'other', issuer_schema_id: 128 })
	const result = credentialAvailability(mixed, [])
	assert.equal(result.canEnrollSelfie, true)
	assert.equal(result.needsSelfieEnrollment, false)
	mixed.constraints = 'other'
	assert.equal(credentialAvailability(mixed, []).canEnrollSelfie, false)
	assert.equal(credentialAvailability(mixed, [credential(128)]).satisfied, true)
})

test('Selfie required in every alternative only enrolls when it can complete the request', () => {
	const mixed = request({ any: [{ all: ['selfie', 'orb'] }, { all: ['selfie', 'other'] }] })
	mixed.proof_requests.push({ identifier: 'other', issuer_schema_id: 128 })
	assert.equal(credentialAvailability(mixed, []).canEnrollSelfie, false)
	assert.equal(credentialAvailability(mixed, [credential(128)]).needsSelfieEnrollment, true)
})

test('request summary preserves AND/OR groups and identifies credentials by schema', () => {
	assert.equal(credentialRequirementsLabel(request('orb')), 'Orb')
	assert.equal(credentialRequirementsLabel(request('selfie')), 'Selfie Check')
	assert.equal(credentialRequirementsLabel(request()), '(Selfie Check and Orb)')
	assert.equal(credentialRequirementsLabel(request({ any: ['selfie', 'orb'] })), '(Selfie Check or Orb)')
	const nested = request({ any: ['selfie', { all: ['orb', 'other'] }] })
	nested.proof_requests.push({ identifier: 'other', issuer_schema_id: 128 })
	assert.equal(credentialRequirementsLabel(nested), '(Selfie Check or (Orb and Schema 128))')
	nested.proof_requests[0].issuer_schema_id = 1
	assert.equal(credentialRequirementsLabel({ ...nested, constraints: 'selfie' }), 'Orb')
})
