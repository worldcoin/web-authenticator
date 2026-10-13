import { openBridge } from './bridge'
import type { WalletKit } from '../walletkit'
import { abortable } from '../async'
import { parseConnector, returnUrl } from './connector'
import {
	credentialAvailability,
	parsePayload,
	validateSignature,
	checkExpiry,
	type ProofRequest,
} from './proof-request'

export type IncomingRequest = {
	proof: ProofRequest
	label: string
	appId?: string
	actionLabel: string
	returnUrl?: string
	unsupportedReason?: string
	validate: (signal: AbortSignal) => Promise<void>
	deliver: (proof: string, signal: AbortSignal) => Promise<void>
	cancel: (signal: AbortSignal) => Promise<void>
}
export async function loadIncomingRequest(
	href: string,
	signal: AbortSignal,
	progress: (message: string) => void
): Promise<IncomingRequest | null> {
	const connector = parseConnector(href)
	if (!connector) return null
	progress('Fetching the encrypted request from the World ID bridge…')
	const bridge = await openBridge(connector, signal)
	progress('Request decrypted. Checking staging metadata and signature…')
	const payload = parsePayload(bridge.json)
	await validateSignature(payload.proof_request, signal)
	const callback = returnUrl(payload.return_to_url) ?? connector.returnUrl
	// URL metadata cannot replace a different callback inside the encrypted request.
	if (connector.returnUrl && callback !== connector.returnUrl)
		throw new Error('Connector and encrypted request return URLs disagree.')
	return {
		proof: payload.proof_request,
		label: payload.proof_request.rp_id,
		appId: payload.app_id,
		actionLabel: payload.action,
		returnUrl: callback,
		unsupportedReason: payload.require_user_presence
			? 'This request requires World App user presence verification. The web authenticator does not implement that check.'
			: payload.identity_attributes?.length
				? 'Identity attribute attestation is not implemented by this web authenticator.'
				: undefined,
		validate: async signal => {
			await validateSignature(payload.proof_request, signal)
		},
		deliver: async (proof, signal) => {
			const response = JSON.parse(proof) as {
				id?: unknown
				error?: unknown
				responses?: unknown
				nonce?: unknown
			}
			if (
				response.error ||
				!Array.isArray(response.responses) ||
				!response.responses.length ||
				response.id !== payload.proof_request.id
			)
				throw new Error('WalletKit returned an error or mismatched proof response.')
			checkExpiry(payload.proof_request)
			await bridge.send({ proof_response: response }, signal)
		},
		cancel: signal => bridge.send({ error_code: 'verification_rejected' }, signal),
	}
}
export async function checkRequestCredentials(incoming: IncomingRequest, wallet: WalletKit, signal: AbortSignal) {
	const records = await abortable(wallet.listCredentials(), AbortSignal.any([signal, AbortSignal.timeout(10000)]))
	return credentialAvailability(incoming.proof, records)
}
