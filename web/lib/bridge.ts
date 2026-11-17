import { BodyTooLargeError, readBoundedBytes } from '../../packages/shared/read-bounded'
import { decodeBase64, type Connector } from './connector'
import { RequestExpiredError } from './proof-request'

function encode(bytes: Uint8Array<ArrayBuffer>): string {
	let raw = ''
	for (const byte of bytes) raw += String.fromCharCode(byte)
	return btoa(raw)
}
export async function readBounded(response: Response, limit = 262144): Promise<string> {
	if (!response.body) throw new Error('The bridge returned an empty response.')
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBytes(response.body, limit))
	} catch (error) {
		if (error instanceof BodyTooLargeError) throw new Error('The bridge response is too large.')
		throw error
	}
}
export async function openBridge(connector: Connector, signal: AbortSignal) {
	const key = await crypto.subtle.importKey('raw', connector.key, 'AES-GCM', false, ['decrypt', 'encrypt'])
	connector.key.fill(0)
	const response = await fetch(`${connector.bridgeUrl}/request/${connector.requestId}`, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
		credentials: 'omit',
		referrerPolicy: 'no-referrer',
		cache: 'no-store',
		redirect: 'error',
	})
	if (response.status === 404)
		throw new RequestExpiredError('This request expired or was already consumed. Start a new request on the relying-party site.')
	if (!response.ok) throw new Error(`Bridge request fetch failed (HTTP ${response.status}).`)
	const wrapper = JSON.parse(await readBounded(response)) as { iv?: unknown; payload?: unknown }
	const iv = decodeBase64(wrapper.iv, 12)
	const encrypted = decodeBase64(wrapper.payload, 196608)
	if (iv.length !== 12 || encrypted.length < 16) throw new Error('Invalid encrypted bridge payload.')
	let plaintext: ArrayBuffer
	try {
		plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
	} catch {
		throw new Error('Could not decrypt the request. The connector key may be invalid.')
	}
	const json = new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
	new Uint8Array(plaintext).fill(0)
	return {
		json,
		async send(payload: unknown, signal: AbortSignal) {
			const iv = crypto.getRandomValues(new Uint8Array(12))
			const encrypted = await crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv },
				key,
				new TextEncoder().encode(JSON.stringify(payload))
			)
			const response = await fetch(`${connector.bridgeUrl}/response/${connector.requestId}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				credentials: 'omit',
				referrerPolicy: 'no-referrer',
				redirect: 'error',
				body: JSON.stringify({ iv: encode(iv), payload: encode(new Uint8Array(encrypted)) }),
				signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
			})
			if (!response.ok) throw new Error(`Bridge response upload failed (HTTP ${response.status}).`)
		},
	}
}
