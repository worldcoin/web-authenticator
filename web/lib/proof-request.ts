import type { CredentialMetadata } from './walletkit'
import type { Hex } from 'viem'
import { checkExpiry, verifyRequestSignature, type ProofRequest, type Constraint } from '../../packages/contracts/src/proof-request'
export * from '../../packages/contracts/src/proof-request'

export async function validateSignature(request: ProofRequest, signal: AbortSignal) {
	checkExpiry(request)
	const response = await fetch(`/api/staging-rp?id=${encodeURIComponent(request.rp_id)}`, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
		cache: 'no-store',
	})
	if (!response.ok)
		throw new Error(
			'Could not validate this RP against the staging registry. It may be unregistered, inactive, or temporarily unavailable.'
		)
	const rp = (await response.json()) as { signer: Hex; oprfKeyId: string }
	await verifyRequestSignature(request, rp)
}

export function credentialRequirementsLabel(request: ProofRequest): string {
	const names = new Map(
		request.proof_requests.map(item => [
			item.identifier,
			item.issuer_schema_id === 11
				? 'Selfie Check'
				: item.issuer_schema_id === 1
					? 'Orb'
					: `Schema ${item.issuer_schema_id}`,
		])
	)
	const describe = (node: Constraint): string =>
		typeof node === 'string'
			? (names.get(node) ?? node)
			: 'any' in node
				? `(${node.any.map(describe).join(' or ')})`
				: `(${node.all.map(describe).join(' and ')})`
	return describe(request.constraints ?? { all: request.proof_requests.map(item => item.identifier) })
}
export function credentialAvailability(request: ProofRequest, records: CredentialMetadata[]) {
	const items = request.proof_requests.map(item => ({
		...item,
		available: records.some(
			record =>
				record.issuerSchemaId === BigInt(item.issuer_schema_id) &&
				!record.isExpired &&
				record.expiresAt > BigInt(item.expires_at_min ?? request.created_at) &&
				record.genesisIssuedAt >= BigInt(item.genesis_issued_at_min ?? 0)
		),
	}))
	const matches = new Map(items.map(item => [item.identifier, item.available]))
	const evaluate = (node: Constraint, available = matches): boolean =>
		typeof node === 'string'
			? available.get(node) === true
			: 'any' in node
				? node.any.some(child => evaluate(child, available))
				: node.all.every(child => evaluate(child, available))
	const satisfies = (available: Map<string, boolean>) =>
		request.constraints
			? evaluate(request.constraints, available)
			: items.every(item => available.get(item.identifier) === true)
	const satisfied = satisfies(matches)
	const withSelfie = new Map(items.map(item => [item.identifier, item.available || item.issuer_schema_id === 11]))
	// Possibility is not a choice: an OR branch must not silently select selfie enrollment.
	const withoutSchema = (schema: number) =>
		satisfies(new Map(items.map(item => [item.identifier, item.issuer_schema_id !== schema])))
	const requiresSelfie = !withoutSchema(11)
	const requiresOrb = !withoutSchema(1)
	// An existing credential outside the RP's date bounds cannot be fixed by our demo issuer.
	const canEnrollSelfie =
		!satisfied &&
		!records.some(record => record.issuerSchemaId === BigInt(11) && !record.isExpired) &&
		satisfies(withSelfie)
	return {
		items,
		satisfied,
		requiresOrb,
		canEnrollSelfie,
		needsSelfieEnrollment: canEnrollSelfie && requiresSelfie,
	}
}
