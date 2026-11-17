import type { CredentialMetadata } from './walletkit'
import { acceptsRequestEnvironment, type ProtocolEnvironment } from '../../config/environment'
import { currentProtocolEnvironment } from './environment'
import { hexToBytes, keccak256, stringToHex, verifyMessage, type Hex } from 'viem'
import { z } from 'zod'

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
const hex = (value: unknown, size: number): value is Hex =>
	typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(value)
const unsignedInteger = z.number().refine(value => Number.isSafeInteger(value) && value >= 0)
const fixedHex = (size: number) => z.custom<Hex>(value => hex(value, size))

const RequirementSchema = z.looseObject({
	identifier: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
	issuer_schema_id: unsignedInteger,
	signal: z.string().regex(/^0x(?:[0-9a-f]{2})*$/i).refine(value => value.length <= 4098).nullish(),
	genesis_issued_at_min: unsignedInteger.nullish(),
	expires_at_min: unsignedInteger.nullish(),
})
const ProofProtocolSchema = z.looseObject({
	version: z.literal(1),
	proof_type: z.literal('uniqueness'),
	session_id: z.null().optional(),
})
const ProofMetadataSchema = ProofProtocolSchema.extend({
	id: z.string().refine(value => value.length > 0 && value.length <= 128),
	rp_id: z.string().regex(/^rp_[0-9a-f]{1,16}$/i),
	oprf_key_id: z.string().regex(/^0x[0-9a-f]{1,40}$/i),
	nonce: fixedHex(32),
	signature: fixedHex(65),
	created_at: unsignedInteger,
	expires_at: unsignedInteger,
	action: fixedHex(32),
})
const PayloadMetadataSchema = z.looseObject({
	app_id: z.string().regex(/^app_[0-9a-f]{32}$/i),
	action: z.string().refine(value => value.length <= 1024),
	environment: z.enum(['staging', 'sandbox', 'production']),
	proof_request: ProofMetadataSchema,
})
const PayloadOptionsSchema = z.object({
	require_user_presence: z.boolean().optional(),
	identity_attributes: z.custom<unknown[]>(Array.isArray).nullish(),
	return_to_url: z.string().optional(),
})
const RequirementsSchema = z.custom<unknown[]>(value => Array.isArray(value) && value.length >= 1 && value.length <= 32)
const RpRegistrySchema = z.object({
	signer: fixedHex(20),
	oprfKeyId: ProofMetadataSchema.shape.oprf_key_id,
})

export type Requirement = z.infer<typeof RequirementSchema>
export type Constraint = string | { any: Constraint[] } | { all: Constraint[] }
export type ProofRequest = z.infer<typeof ProofMetadataSchema> & {
	proof_requests: Requirement[]
	constraints?: Constraint | null
}
export type Payload = z.infer<typeof PayloadMetadataSchema> & z.infer<typeof PayloadOptionsSchema> & {
	proof_request: ProofRequest
}
/** The request is past its signed expiry, or the bridge no longer holds it. */
export class RequestExpiredError extends Error {}

export function checkExpiry(request: ProofRequest) {
	const now = Math.floor(Date.now() / 1000)
	if (
		request.created_at > now + 30 ||
		request.expires_at <= now ||
		request.expires_at <= request.created_at ||
		request.expires_at - request.created_at > 86400
	)
		throw new RequestExpiredError('The request is expired or its timestamp is invalid. Start a new request at the relying party.')
}
export function parsePayload(json: string, environment = currentProtocolEnvironment()): Payload {
	if (json.length > 131072) throw new Error('Request payload is too large.')
	const p: unknown = JSON.parse(json)
	if (!record(p) || !acceptsRequestEnvironment(p.environment, environment)) throw new Error(`This authenticator accepts ${environment} requests only.`)
	if (!ProofProtocolSchema.safeParse(p.proof_request).success)
		throw new Error('Only World ID 4.0 uniqueness requests are supported by this web authenticator.')
	const parsed = PayloadMetadataSchema.safeParse(p)
	if (!parsed.success) throw new Error('Malformed World ID request metadata.')
	const r = parsed.data.proof_request
	if (BigInt(r.action) !== BigInt(keccak256(stringToHex(parsed.data.action))) >> BigInt(8))
		throw new Error('The displayed action does not match the signed action.')
	const requirements = RequirementsSchema.safeParse(r.proof_requests)
	if (!requirements.success) throw new Error('Invalid credential requirements.')
	const ids = new Set<string>()
	const proofRequests: Requirement[] = []
	for (const item of requirements.data) {
		const requirement = RequirementSchema.safeParse(item)
		if (!requirement.success || ids.has(requirement.data.identifier))
			throw new Error('Malformed credential requirement.')
		ids.add(requirement.data.identifier)
		proofRequests.push(requirement.data)
	}
	let count = 0
	const constraint = (node: unknown, depth = 0): Constraint => {
		if (++count > 64 || depth > 8) throw new Error('Credential constraints exceed supported limits.')
		if (typeof node === 'string' && ids.has(node)) return node
		if (!record(node) || Object.keys(node).length !== 1) throw new Error('Invalid credential constraints.')
		const children = node.any ?? node.all
		if (!Array.isArray(children) || children.length < 1) throw new Error('Invalid credential constraints.')
		const parsedChildren: Constraint[] = []
		for (const child of children) parsedChildren.push(constraint(child, depth + 1))
		return 'any' in node ? { any: parsedChildren } : { all: parsedChildren }
	}
	const constraints = r.constraints == null ? r.constraints : constraint(r.constraints)
	const requireUserPresence = PayloadOptionsSchema.shape.require_user_presence.safeParse(p.require_user_presence)
	if (!requireUserPresence.success)
		throw new Error('Invalid user presence requirement.')
	const identityAttributes = PayloadOptionsSchema.shape.identity_attributes.safeParse(p.identity_attributes)
	if (!identityAttributes.success)
		throw new Error('Invalid identity attribute requirements.')
	const returnToUrl = PayloadOptionsSchema.shape.return_to_url.safeParse(p.return_to_url)
	if (!returnToUrl.success) throw new Error('Invalid return URL.')
	const payload: Payload = {
		...parsed.data,
		proof_request: {
			...r,
			proof_requests: proofRequests,
			...(constraints !== undefined ? { constraints } : {}),
		},
		...(requireUserPresence.data !== undefined ? { require_user_presence: requireUserPresence.data } : {}),
		...(identityAttributes.data !== undefined ? { identity_attributes: identityAttributes.data } : {}),
		...(returnToUrl.data !== undefined ? { return_to_url: returnToUrl.data } : {}),
	}
	checkExpiry(payload.proof_request)
	return payload
}
export async function validateSignature(request: ProofRequest, signal: AbortSignal, environment: ProtocolEnvironment = currentProtocolEnvironment()) {
	checkExpiry(request)
	const endpoint = environment === "production" ? "/api/rp" : "/api/staging-rp"
	const response = await fetch(`${endpoint}?id=${encodeURIComponent(request.rp_id)}`, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
		cache: 'no-store',
	})
	if (!response.ok)
		throw new Error(
			`Could not validate this RP against the ${environment} registry. It may be unregistered, inactive, or temporarily unavailable.`
		)
	const parsed = RpRegistrySchema.safeParse(await response.json())
	if (!parsed.success) throw new Error('Invalid RP registry response.')
	const rp = parsed.data
	if (BigInt(rp.oprfKeyId) !== BigInt(request.oprf_key_id))
		throw new Error('Request OPRF key does not match the registered RP.')
	const message = new Uint8Array(81)
	message[0] = 1
	message.set(hexToBytes(request.nonce), 1)
	new DataView(message.buffer).setBigUint64(33, BigInt(request.created_at))
	new DataView(message.buffer).setBigUint64(41, BigInt(request.expires_at))
	message.set(hexToBytes(request.action), 49)
	if (!(await verifyMessage({ address: rp.signer, message: { raw: message }, signature: request.signature })))
		throw new Error('The RP request signature is invalid.')
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
