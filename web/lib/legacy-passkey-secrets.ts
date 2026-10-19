export const AUTHENTICATOR_SALT = 'web.world.org/authenticator'
export const STORAGE_SALT = 'web.world.org/storage'
export const AUTHENTICATOR_INFO = 'web.world.org/v1/authenticator-secret'
export const STORAGE_INFO = 'web.world.org/v1/storage-secret'

export interface PasskeySecrets {
	seed: Uint8Array<ArrayBuffer>
	databaseKey: Uint8Array<ArrayBuffer>
}

// RFC 5869 HKDF-Expand-SHA256 for exactly one 32-byte block: HMAC(PRK, info || 0x01).
// WebCrypto HKDF also performs Extract, which is not part of this derivation spec.
export async function expandSecret(prfOutput: ArrayBuffer, info: string): Promise<Uint8Array<ArrayBuffer>> {
	if (prfOutput.byteLength !== 32) throw new Error('Expected a 32-byte PRF output.')
	const key = await crypto.subtle.importKey('raw', prfOutput, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
	const label = new TextEncoder().encode(info)
	const input = new Uint8Array(label.length + 1)
	input.set(label)
	input[label.length] = 1
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, input))
}

export async function derivePasskeySecrets(first: ArrayBuffer, second: ArrayBuffer): Promise<PasskeySecrets> {
	let seed: Uint8Array<ArrayBuffer> | undefined
	try {
		seed = await expandSecret(first, AUTHENTICATOR_INFO)
		const databaseKey = await expandSecret(second, STORAGE_INFO)
		return { seed, databaseKey }
	} catch (error) {
		seed?.fill(0)
		throw error
	} finally {
		new Uint8Array(first).fill(0)
		new Uint8Array(second).fill(0)
	}
}
