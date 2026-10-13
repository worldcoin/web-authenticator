import type { CreatedPasskey } from './passkey'
import type { RecoveryData } from './walletkit'

export const PROFILE_KEY = 'world-id-passkey-registration-v1'

// Only public metadata goes here. PRF outputs, seeds, and database keys never do.
export interface DemoProfile {
	version: 1
	passkey: CreatedPasskey
	registration: 'created' | 'submitting' | 'finalized'
	publicMaterial?: RecoveryData
}

function isPublicMaterial(value: unknown): value is RecoveryData {
	if (typeof value !== 'object' || value === null) return false
	const material = value as Record<string, unknown>
	return ['authenticatorAddress', 'authenticatorPubkey', 'offchainSignerCommitment'].every(
		key => typeof material[key] === 'string' && material[key].length > 0 && material[key].length <= 1024
	)
}

export function loadDemoProfile(storage: Pick<Storage, 'getItem'>): DemoProfile | null {
	let saved: string | null
	try {
		saved = storage.getItem(PROFILE_KEY)
	} catch {
		throw new Error('Browser storage is unavailable. Enable site storage before continuing.')
	}
	if (saved === null) return null
	try {
		const profile = JSON.parse(saved) as Partial<DemoProfile> | null
		if (
			!profile ||
			profile.version !== 1 ||
			typeof profile.passkey?.credentialId !== 'string' ||
			!/^[A-Za-z0-9_-]{1,2048}$/.test(profile.passkey.credentialId) ||
			profile.passkey.credentialId.length % 4 === 1 ||
			typeof profile.passkey.prfSupported !== 'boolean' ||
			!['created', 'submitting', 'finalized'].includes(profile.registration ?? '') ||
			(profile.publicMaterial !== undefined && !isPublicMaterial(profile.publicMaterial)) ||
			(profile.registration === 'finalized' && !isPublicMaterial(profile.publicMaterial))
		) {
			throw new Error('Invalid profile')
		}
		return profile as DemoProfile
	} catch {
		throw new Error(
			'The saved passkey record is invalid. It has been preserved; this demo will not replace it with a new identity.'
		)
	}
}

export function saveDemoProfile(storage: Pick<Storage, 'setItem'>, profile: DemoProfile): void {
	// Explicit projection prevents future callers from accidentally serializing secrets.
	const material = profile.publicMaterial
	const record: DemoProfile = {
		version: 1,
		passkey: { credentialId: profile.passkey.credentialId, prfSupported: profile.passkey.prfSupported },
		registration: profile.registration,
		...(material
			? {
					publicMaterial: {
						authenticatorAddress: material.authenticatorAddress,
						authenticatorPubkey: material.authenticatorPubkey,
						offchainSignerCommitment: material.offchainSignerCommitment,
					},
				}
			: {}),
	}
	try {
		storage.setItem(PROFILE_KEY, JSON.stringify(record))
	} catch {
		throw new Error(
			'Could not save passkey progress in browser storage. Keep this page open and enable site storage before continuing.'
		)
	}
}
