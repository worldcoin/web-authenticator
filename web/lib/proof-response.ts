import { z } from 'zod'

const uint = z.number().refine(value => Number.isSafeInteger(value) && value >= 0)
const issuerSchemaId = z.union([
	uint,
	z.string().refine(value => /^(0|[1-9][0-9]{0,19})$/.test(value) &&
		BigInt(value).toString() === value && BigInt(value) <= 18_446_744_073_709_551_615n),
])

// WalletKit's Rust ResponseItem encodes a compressed 160-byte proof as hex.
// Preserve additive fields (including disclosed claims) when forwarding to the RP.
const ResponseItemSchema = z.looseObject({
	identifier: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
	issuer_schema_id: issuerSchemaId,
	proof: z.string().length(320).regex(/^[0-9a-fA-F]{320}$/),
	nullifier: z.string().length(68).regex(/^nil_[0-9a-f]{64}$/),
	session_nullifier: z.null().optional(),
	expires_at_min: uint,
	claims: z.array(z.string()).optional(),
})

/** Successful responses for the unbound uniqueness requests supported by this app. */
export const ProofResponseSchema = z.looseObject({
	id: z.string().min(1).refine(value => value.length <= 128),
	version: z.literal(1),
	session_id: z.null().optional(),
	error: z.string().nullish(),
	responses: z.custom<unknown[]>(value => Array.isArray(value) && value.length >= 1 && value.length <= 32)
		.pipe(z.array(ResponseItemSchema)),
})

export type ProofResponse = z.infer<typeof ProofResponseSchema>

export function parseProofResponse(json: string): ProofResponse {
	const message = 'WalletKit returned an invalid proof response.'
	let value: unknown
	try {
		value = JSON.parse(json)
	} catch {
		throw new Error(message)
	}
	const parsed = ProofResponseSchema.safeParse(value)
	if (!parsed.success || parsed.data.error) throw new Error(message)
	return parsed.data
}
