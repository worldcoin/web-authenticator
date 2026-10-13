import { parse } from 'lossless-json'
import type { WalletKit } from './walletkit'
import { selfieResumeToken } from '../wallet/persistence'
import { readBounded } from './requests/bridge'
import { abortable } from './async'

export class SelfieWalletTimeout extends Error {}

export async function issueSelfieCredential(
	wallet: WalletKit,
	signal: AbortSignal,
	progress: (message: string) => void
) {
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(300_000)])
	async function walletCall<T>(promise: Promise<T>): Promise<T> {
		const walletDeadline = AbortSignal.any([deadline, AbortSignal.timeout(90_000)])
		try {
			return await abortable(promise, walletDeadline)
		} catch (error) {
			if (walletDeadline.aborted) {
				wallet.terminate()
				throw new SelfieWalletTimeout(
					'WalletKit timed out or was interrupted. Unlock again, then resume selfie issuance.'
				)
			}
			throw new Error('The encrypted wallet operation failed. Unlock again to resume issuance.', { cause: error })
		}
	}
	progress('Checking the encrypted vault for an active selfie credential…')
	const existing = (await walletCall(wallet.listCredentials())).find(
		record => record.issuerSchemaId === BigInt(11) && !record.isExpired
	)
	if (existing) {
		progress('An active selfie credential is already stored.')
		return existing
	}
	progress('Preparing the schema-11 subject with WalletKit…')
	const { sub, blindingFactor } = await walletCall(wallet.prepareCredential(BigInt(11)))
	// The OPRF derives the subject/factor for this account and schema again on resume.
	// Only an opaque issuer-operation capability is persisted, never the factor or seed.
	const token = selfieResumeToken(sub)
	progress('Preparing encrypted synthetic shares and staging identity authentication…')
	for (;;) {
		deadline.throwIfAborted()
		const response = await fetch('/api/selfie-credential', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ sub, token }),
			signal: deadline,
		})
		const text = await readBounded(response, 131_072)
		if (text.length > 131_072) throw new Error('Selfie issuer response exceeded its size limit.')
		const result = JSON.parse(text)
		if (!response.ok)
			throw new Error(typeof result.error === 'string' ? result.error : `Selfie issuer HTTP ${response.status}`)
		if (result.status === 'pending') {
			progress(result.stage)
			await abortable(new Promise(resolve => setTimeout(resolve, 3000)), deadline)
			continue
		}
		if (result.status !== 'issued' || typeof result.credential !== 'string')
			throw new Error('Selfie issuance did not return a credential.')
		progress('Staging issued the credential. Issuer signature and subject checked; storing in the vault…')
		const bytes = Uint8Array.from(atob(result.credential), character => character.charCodeAt(0))
		const credential = parse(new TextDecoder().decode(bytes)) as {
			sub?: unknown
			issuer_schema_id?: unknown
			expires_at?: unknown
		}
		if (
			!credential ||
			String(credential.sub).toLowerCase() !== sub.toLowerCase() ||
			String(credential.issuer_schema_id) !== '11' ||
			BigInt(String(credential.expires_at)) <= BigInt(Math.floor(Date.now() / 1000))
		)
			throw new Error('Issued selfie credential does not match this subject/schema or is expired.')
		const stored = await walletCall(wallet.storeCredential(bytes, blindingFactor))
		if (stored.issuerSchemaId !== BigInt(11)) throw new Error('Unexpected stored credential schema.')
		progress('Selfie credential stored in the encrypted vault. Synthetic staging enrollment complete.')
		return stored
	}
}
