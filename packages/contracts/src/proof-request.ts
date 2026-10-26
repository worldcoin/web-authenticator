import { hexToBytes, keccak256, stringToHex, verifyMessage, type Hex } from 'viem'

export type Requirement = {
	identifier: string
	issuer_schema_id: number
	signal?: string | null
	genesis_issued_at_min?: number | null
	expires_at_min?: number | null
}
export type Constraint = string | { any: Constraint[] } | { all: Constraint[] }
export type ProofRequest = {
	id: string
	version: 1
	proof_type: 'uniqueness'
	rp_id: string
	oprf_key_id: string
	nonce: Hex
	signature: Hex
	created_at: number
	expires_at: number
	action: Hex
	session_id: null
	proof_requests: Requirement[]
	constraints?: Constraint | null
}
export type Payload = {
	app_id: string
	action: string
	environment: 'staging'
	proof_request: ProofRequest
	require_user_presence?: boolean
	identity_attributes?: unknown[]
	return_to_url?: string
}
const uint = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
const hex = (value: unknown, size: number): value is Hex =>
	typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(value)
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
export function parsePayload(json: string): Payload {
	if (json.length > 131072) throw new Error('Request payload is too large.')
	const p: unknown = JSON.parse(json)
	if (!record(p) || p.environment !== 'staging') throw new Error('This authenticator accepts staging requests only.')
	const r = p.proof_request
	if (!record(r) || r.version !== 1 || r.proof_type !== 'uniqueness' || r.session_id != null)
		throw new Error('Only World ID 4.0 uniqueness requests are supported by this web authenticator.')
	if (
		typeof p.app_id !== 'string' ||
		!/^app_[0-9a-f]{32}$/i.test(p.app_id) ||
		typeof p.action !== 'string' ||
		p.action.length > 1024 ||
		typeof r.id !== 'string' ||
		r.id.length > 128 ||
		!r.id ||
		typeof r.rp_id !== 'string' ||
		!/^rp_[0-9a-f]{1,16}$/i.test(r.rp_id) ||
		typeof r.oprf_key_id !== 'string' ||
		!/^0x[0-9a-f]{1,40}$/i.test(r.oprf_key_id) ||
		!hex(r.nonce, 32) ||
		!hex(r.signature, 65) ||
		!hex(r.action, 32) ||
		!uint(r.created_at) ||
		!uint(r.expires_at)
	)
		throw new Error('Malformed World ID request metadata.')
	if (BigInt(r.action) !== BigInt(keccak256(stringToHex(p.action))) >> BigInt(8))
		throw new Error('The displayed action does not match the signed action.')
	if (!Array.isArray(r.proof_requests) || r.proof_requests.length < 1 || r.proof_requests.length > 32)
		throw new Error('Invalid credential requirements.')
	const ids = new Set<string>()
	for (const item of r.proof_requests) {
		if (
			!record(item) ||
			typeof item.identifier !== 'string' ||
			!/^[a-zA-Z0-9_-]{1,80}$/.test(item.identifier) ||
			ids.has(item.identifier) ||
			!uint(item.issuer_schema_id) ||
			(item.signal != null &&
				(typeof item.signal !== 'string' ||
					!/^0x(?:[0-9a-f]{2})*$/i.test(item.signal) ||
					item.signal.length > 4098)) ||
			(item.genesis_issued_at_min != null && !uint(item.genesis_issued_at_min)) ||
			(item.expires_at_min != null && !uint(item.expires_at_min))
		)
			throw new Error('Malformed credential requirement.')
		ids.add(item.identifier)
	}
	let count = 0
	const constraint = (node: unknown, depth = 0): void => {
		if (++count > 64 || depth > 8) throw new Error('Credential constraints exceed supported limits.')
		if (typeof node === 'string' && ids.has(node)) return
		if (!record(node) || Object.keys(node).length !== 1) throw new Error('Invalid credential constraints.')
		const children = node.any ?? node.all
		if (!Array.isArray(children) || children.length < 1) throw new Error('Invalid credential constraints.')
		children.forEach(child => constraint(child, depth + 1))
	}
	if (r.constraints != null) constraint(r.constraints)
	if (p.require_user_presence !== undefined && typeof p.require_user_presence !== 'boolean')
		throw new Error('Invalid user presence requirement.')
	if (p.identity_attributes != null && !Array.isArray(p.identity_attributes))
		throw new Error('Invalid identity attribute requirements.')
	if (p.return_to_url !== undefined && typeof p.return_to_url !== 'string') throw new Error('Invalid return URL.')
	const payload = p as unknown as Payload
	checkExpiry(payload.proof_request)
	return payload
}
export async function verifyRequestSignature(request: ProofRequest, rp: { signer: Hex; oprfKeyId: string }) {
	checkExpiry(request)
	if (!rp || !hex(rp.signer, 20) || typeof rp.oprfKeyId !== 'string' || !/^0x[0-9a-f]{1,40}$/i.test(rp.oprfKeyId)) throw new Error('Invalid staging RP registry response.')
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