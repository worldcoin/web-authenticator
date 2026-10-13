import { logFlowStep } from './flow-logging'
import { describePrfValue, prfBytes } from './prf-result'
import { AUTHENTICATOR_SALT, STORAGE_SALT, derivePasskeySecrets, type PasskeySecrets } from './passkey-secrets'

export interface CreatedPasskey {
	readonly credentialId: string
	readonly prfSupported: boolean
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength)
	new Uint8Array(buffer).set(bytes)
	return buffer
}

// Local PRF ceremony: no server uses this challenge to authenticate a session.
// The random user handle identifies a new local passkey, not a World ID account.
export async function createPasskey(signal: AbortSignal): Promise<CreatedPasskey> {
	if (
		!window.isSecureContext ||
		typeof PublicKeyCredential === 'undefined' ||
		typeof navigator.credentials?.create !== 'function'
	) {
		throw new Error('Passkeys require a supported browser on HTTPS or localhost.')
	}
	const challengeBytes = crypto.getRandomValues(new Uint8Array(32))
	const userIdBytes = crypto.getRandomValues(new Uint8Array(32))
	const challenge = ownedArrayBuffer(challengeBytes)
	const userId = ownedArrayBuffer(userIdBytes)
	const rp = window.location.hostname === 'localhost' ? { id: 'localhost', name: 'World ID' } : { name: 'World ID' }
	const publicKey = {
		challenge,
		rp,
		user: {
			id: userId,
			name: `world-id-passkey-${Date.now()}`,
			displayName: 'World ID',
		},
		pubKeyCredParams: [
			{ type: 'public-key' as const, alg: -7 },
			{ type: 'public-key' as const, alg: -257 },
		],
		authenticatorSelection: {
			residentKey: 'required' as const,
			requireResidentKey: true,
			userVerification: 'required' as const,
		},
		timeout: 60_000,
		attestation: 'none' as const,
		extensions: { prf: {} },
	} satisfies PublicKeyCredentialCreationOptions & {
		readonly extensions: AuthenticationExtensionsClientInputs & {
			readonly prf: Record<string, never>
		}
	}

	try {
		const credential = await logFlowStep('passkey.create', () =>
			navigator.credentials.create({ publicKey, signal })
		)
		if (!(credential instanceof PublicKeyCredential)) {
			throw new Error('The browser did not return a passkey. Please try again.')
		}
		const extensions = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
			prf?: { enabled?: boolean }
		}
		return { credentialId: credential.id, prfSupported: extensions.prf?.enabled === true }
	} finally {
		challengeBytes.fill(0)
		userIdBytes.fill(0)
		new Uint8Array(challenge).fill(0)
		new Uint8Array(userId).fill(0)
	}
}

export async function unlockPasskey(created: CreatedPasskey, signal: AbortSignal): Promise<PasskeySecrets> {
	if (!created.prfSupported)
		throw new Error('This passkey provider did not report PRF support. Registration requires PRF.')
	const encoder = new TextEncoder()
	const id = Uint8Array.from(atob(created.credentialId.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
	const publicKey = {
		challenge: crypto.getRandomValues(new Uint8Array(32)),
		rpId: window.location.hostname,
		allowCredentials: [{ type: 'public-key' as const, id }],
		userVerification: 'required' as const,
		timeout: 60_000,
		extensions: {
			prf: { eval: { first: encoder.encode(AUTHENTICATOR_SALT), second: encoder.encode(STORAGE_SALT) } },
		},
	} satisfies PublicKeyCredentialRequestOptions & {
		extensions: AuthenticationExtensionsClientInputs & {
			prf: { eval: { first: Uint8Array<ArrayBuffer>; second: Uint8Array<ArrayBuffer> } }
		}
	}
	const credential = await logFlowStep('passkey.unlock_prf', () => navigator.credentials.get({ publicKey, signal }))
	if (!(credential instanceof PublicKeyCredential) || credential.id !== created.credentialId) {
		throw new Error('The browser did not return the selected passkey.')
	}
	const { prf } = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
		prf?: { results?: { first?: unknown; second?: unknown } }
	}
	// Log shape only. Never pass the extension object or its secret bytes to console.
	console.info('passkey_prf_result', {
		prfPresent: prf !== undefined,
		first: describePrfValue(prf?.results?.first),
		second: describePrfValue(prf?.results?.second),
	})
	const first = prfBytes(prf?.results?.first)
	const second = prfBytes(prf?.results?.second)
	try {
		if (!first || !second) {
			const missing = !first && !second ? 'either' : !first ? 'the authenticator' : 'the storage'
			throw new Error(
				`The passkey did not return a valid 32-byte result for ${missing} PRF input. Registration has not started. See passkey_prf_result in the console for output types and lengths.`
			)
		}
		signal.throwIfAborted()
		return await logFlowStep('passkey.derive_secrets', () => derivePasskeySecrets(first.buffer, second.buffer))
	} finally {
		first?.fill(0)
		second?.fill(0)
	}
}
