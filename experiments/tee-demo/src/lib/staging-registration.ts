import { logFlowStep } from './flow-logging'
import type { PasskeySecrets } from './passkey-secrets'
import type { InitializeOptions, RecoveryData, RegistrationStatus, WalletKit } from './walletkit'

export type RegistrationPhase =
	| 'loading'
	| 'registering'
	| 'initializing'
	| Exclude<RegistrationStatus['state'], 'failed'>

// Bound worker RPCs too: the package's public methods do not expose per-call signals.
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted()
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason)
		signal.addEventListener('abort', abort, { once: true })
		operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
	})
}

function pause(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer)
			reject(signal.reason)
		}
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', abort)
			resolve()
		}, 1000)
		signal.addEventListener('abort', abort, { once: true })
		if (signal.aborted) abort()
	})
}

// A digest gives this passkey a stable, path-safe namespace without persisting secrets.
export async function passkeyStorageId(credentialId: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credentialId))
	return `passkey-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

type InitializeWalletKit = (options: InitializeOptions) => Promise<WalletKit>

export async function registerOnStaging(
	secrets: PasskeySecrets,
	credentialId: string,
	signal: AbortSignal,
	onPhase: (phase: RegistrationPhase) => void,
	onPublicMaterial: (material: RecoveryData) => void,
	initialize?: InitializeWalletKit
): Promise<WalletKit> {
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(180_000)])
	let wallet: WalletKit | undefined
	let registrationStarted = false
	let sessionReady = false
	let finalized = false
	let reportedFailure: string | undefined
	const terminate = () => wallet?.terminate()
	deadline.addEventListener('abort', terminate, { once: true })
	try {
		onPhase('loading')
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
		deadline.throwIfAborted()
		const material = await logFlowStep('registration.derive_public_material', () =>
			abortable(wallet!.recoveryDataFromSeed(secrets.seed), deadline)
		)
		onPublicMaterial(material)
		onPhase('registering')
		registrationStarted = true
		await logFlowStep('registration.submit', () => abortable(wallet!.register(secrets.seed), deadline))
		for (;;) {
			deadline.throwIfAborted()
			const status = await logFlowStep('registration.poll', () => abortable(wallet!.pollRegistration(), deadline))
			if (status.state === 'failed') {
				reportedFailure = 'Staging reported a failed registration. No automatic retry was made.'
				throw new Error(reportedFailure)
			}
			if (!['queued', 'batching', 'submitted', 'finalized'].includes(status.state)) {
				reportedFailure = 'Staging returned an unrecognized status. Registration has not been confirmed.'
				throw new Error(reportedFailure)
			}
			onPhase(status.state)
			if (status.state === 'finalized') {
				finalized = true
				onPhase('initializing')
				await logFlowStep('registration.initialize_authenticator', () =>
					abortable(wallet!.initializeAuthenticator(secrets.seed), deadline)
				)
				deadline.throwIfAborted()
				sessionReady = true
				return wallet
			}
			await pause(deadline)
		}
	} catch (cause) {
		if (signal.aborted) throw signal.reason
		const timeout = deadline.aborted ? ' The three-minute deadline expired.' : ''
		// Do not surface raw worker errors: dependency messages may contain sensitive request data.
		throw new Error(
			(finalized
				? 'World ID registration succeeded, but authenticator initialization failed. Unlock again to retry initialization.'
				: reportedFailure) ??
				(registrationStarted
					? `Staging registration could not be confirmed.${timeout} It may already have been submitted. No automatic retry was made.`
					: `WalletKit could not initialize or derive the public account material.${timeout} Registration was not submitted.`),
			{ cause }
		)
	} finally {
		deadline.removeEventListener('abort', terminate)
		if (!sessionReady) wallet?.terminate()
		secrets.seed.fill(0)
		secrets.databaseKey.fill(0)
	}
}
