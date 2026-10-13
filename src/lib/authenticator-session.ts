import { parse, stringify } from 'lossless-json'
import type { PasskeySecrets } from './passkey-secrets'
import { abortable, passkeyStorageId } from './staging-registration'
import type { InitializeOptions, RecoveryData, WalletKit } from './walletkit'

export async function initializeAuthenticator(
	secrets: PasskeySecrets,
	credentialId: string,
	expected: RecoveryData,
	signal: AbortSignal,
	initialize?: (options: InitializeOptions) => Promise<WalletKit>
): Promise<WalletKit> {
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
	let wallet: WalletKit | undefined
	const terminate = () => wallet?.terminate()
	deadline.addEventListener('abort', terminate, { once: true })
	let stage = 'load WalletKit'
	try {
		const init = initialize ?? (await abortable(import('./walletkit'), deadline)).initializeWalletKit
		const storageId = await passkeyStorageId(credentialId)
		deadline.throwIfAborted()
		wallet = await init({
			databaseKey: secrets.databaseKey,
			storageId,
			environment: 'staging',
			region: 'us',
			signal: deadline,
		})
		stage = 'check the saved account identity'
		const actual = await abortable(wallet.recoveryDataFromSeed(secrets.seed), deadline)
		if (
			actual.authenticatorAddress.toLowerCase() !== expected.authenticatorAddress.toLowerCase() ||
			actual.authenticatorPubkey !== expected.authenticatorPubkey ||
			actual.offchainSignerCommitment !== expected.offchainSignerCommitment
		) {
			throw new Error('Passkey-derived identity does not match the saved registration.')
		}
		stage = 'initialize the registered authenticator and encrypted vault'
		await abortable(wallet.initializeAuthenticator(secrets.seed), deadline)
		deadline.throwIfAborted()
		return wallet
	} catch (cause) {
		wallet?.terminate()
		if (signal.aborted) throw signal.reason
		throw new Error(
			`Could not ${stage}.${deadline.aborted ? ' The two-minute deadline expired.' : ''} Unlock again to retry.`,
			{ cause }
		)
	} finally {
		deadline.removeEventListener('abort', terminate)
		secrets.seed.fill(0)
		secrets.databaseKey.fill(0)
	}
}

export interface FauxIssuanceExchange {
	request: { method: 'POST'; url: '/api/faux-credential'; body: { sub: string } }
	response?: { status: number; body: string }
}

export async function issueFauxCredential(
	wallet: WalletKit,
	signal: AbortSignal,
	request: typeof fetch = fetch,
	onExchange?: (exchange: FauxIssuanceExchange) => void
) {
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)])
	const terminate = () => wallet.terminate()
	deadline.addEventListener('abort', terminate, { once: true })
	let stage = 'prepare the credential subject'
	try {
		deadline.throwIfAborted()
		const { blindingFactor, sub } = await abortable(wallet.prepareCredential(BigInt(128)), deadline)
		stage = 'request the staging faux credential'
		const exchange: FauxIssuanceExchange = {
			request: { method: 'POST', url: '/api/faux-credential', body: { sub } },
		}
		onExchange?.(exchange)
		const response = await request('/api/faux-credential', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ sub }),
			signal: deadline,
		})
		const text = await response.text()
		if (text.length > 1_000_000) throw new Error('Faux issuer response exceeds size limit')
		onExchange?.({ ...exchange, response: { status: response.status, body: text } })
		if (!response.ok) throw new Error(`Faux issuer HTTP ${response.status}`)
		// Signed credential integers can exceed Number.MAX_SAFE_INTEGER. Preserve their exact bytes.
		const body = parse(text) as { credential?: unknown } | null
		if (
			!body ||
			typeof body.credential !== 'object' ||
			body.credential === null ||
			Array.isArray(body.credential)
		) {
			throw new Error('Faux issuer response did not contain a credential object')
		}
		const serialized = stringify(body.credential)
		if (!serialized) throw new Error('Faux issuer credential could not be serialized')
		stage = 'store the issued credential in the encrypted vault'
		const stored = await abortable(
			wallet.storeCredential(new TextEncoder().encode(serialized), blindingFactor),
			deadline
		)
		if (stored.issuerSchemaId !== BigInt(128)) throw new Error('Unexpected stored issuer schema')
		return stored
	} catch (cause) {
		wallet.terminate()
		if (signal.aborted) throw signal.reason
		throw new Error(
			`Could not ${stage}.${deadline.aborted ? ' The one-minute deadline expired.' : ''} No automatic retry was made; unlock and initialize again before retrying.`,
			{ cause }
		)
	} finally {
		deadline.removeEventListener('abort', terminate)
	}
}
