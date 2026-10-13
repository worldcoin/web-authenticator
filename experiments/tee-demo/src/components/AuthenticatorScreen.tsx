import { useNavigate } from 'react-router-dom'
import type { RecoveryData } from '../lib/walletkit'
import WorldMark from '@/components/icons/WorldMark'
import CredentialVault from '@/components/CredentialVault'
import { logRegistrationClick } from '@/lib/client-context'
import { useCallback, useEffect, useRef, useState } from 'react'
import CredentialRequestSheet from '@/components/CredentialRequestSheet'
import { useAuthenticatorSession } from '@/components/AuthenticatorSession'
import { createPasskey, unlockPasskey, type CreatedPasskey } from '@/lib/passkey'
import { loadDemoProfile, saveDemoProfile, type DemoProfile } from '@/lib/demo-profile'
import { abortable, registerOnStaging, type RegistrationPhase } from '@/lib/staging-registration'
import { initializeAuthenticator, issueFauxCredential, type FauxIssuanceExchange } from '@/lib/authenticator-session'

const phaseLabels = {
	idle: 'Ready to create a passkey',
	saved: 'Your passkey is saved. Unlock it to continue registration.',
	creating: 'Complete the passkey creation prompt.',
	unlocking: 'Unlock your passkey to derive the two secrets.',
	loading: 'Secrets derived. Loading WalletKit…',
	registering: 'Submitting the public account to staging…',
	queued: 'Registration queued…',
	batching: 'Registration is being batched…',
	submitted: 'Registration submitted. Waiting for finalization…',
	finalized: 'Registration saved. Unlock your passkey to initialize this authenticator.',
	initializing: 'Opening the registered authenticator and encrypted vault…',
	ready: 'Authenticator initialized. Encrypted credential vault is open.',
	issuing: 'Requesting a staging faux credential and storing it in the vault…',
	issued: 'Faux credential issued and stored in the encrypted vault.',
	issuingSelfie: 'Issuing a selfie credential using synthetic staging enrollment…',
	selfieIssued: 'Selfie credential issued and stored in the encrypted vault.',
}
type Phase = keyof typeof phaseLabels

function errorMessage(error: unknown): string {
	if (error instanceof DOMException) {
		if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
			return 'The passkey prompt was cancelled, timed out, or needs another click. You can try again.'
		}
		if (error.name === 'NotSupportedError')
			return 'This browser or passkey provider does not support the requested operation.'
		if (error.name === 'SecurityError') return 'Passkeys are unavailable for this origin. Use HTTPS or localhost.'
	}
	return error instanceof Error ? error.message : 'The operation failed. Registration has not been confirmed.'
}

export default function AuthenticatorScreen() {
	const autoStarted = useRef(new Set<string>())
	const request = useRef<AbortController | null>(null)
	const profile = useRef<DemoProfile | null>(null)
	const { wallet, initialized, setInitialized, shareStarted, setShareStarted } = useAuthenticatorSession()
	const [issuanceExchange, setIssuanceExchange] = useState<FauxIssuanceExchange | null>(null)
	const [hasActiveFaux, setHasActiveFaux] = useState<boolean | null>(null)
	const [hasActiveSelfie, setHasActiveSelfie] = useState<boolean | null>(null)
	const navigate = useNavigate()
	const onVaultLoaded = useCallback((faux: boolean, selfie: boolean) => {
		setHasActiveFaux(faux)
		setHasActiveSelfie(selfie)
	}, [])
	const [issued, setIssued] = useState<{ credentialId: string; issuerSchemaId: string } | null>(null)
	const [loaded, setLoaded] = useState(false)
	const [requestEntry, setRequestEntry] = useState<boolean | null>(null)
	const [pending, setPending] = useState(false)
	const [created, setCreated] = useState<CreatedPasskey | null>(null)
	const [phase, setPhase] = useState<Phase>('idle')
	const [registrationAttempted, setRegistrationAttempted] = useState(false)
	const [material, setMaterial] = useState<RecoveryData | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		try {
			const saved = loadDemoProfile(localStorage)
			profile.current = saved
			if (saved) {
				setCreated(saved.passkey)
				setMaterial(saved.publicMaterial ?? null)
				setRegistrationAttempted(saved.registration !== 'created')
				setPhase(wallet.current ? 'ready' : saved.registration === 'finalized' ? 'finalized' : 'saved')
				if (saved.registration === 'submitting') {
					setError(
						'A previous registration attempt was interrupted. Its outcome is unknown; this demo will not submit again or create another passkey.'
					)
				}
			}
			setLoaded(true)
		} catch (cause) {
			setError(errorMessage(cause))
		}
		const abort = () => {
			request.current?.abort()
		}
		window.addEventListener('pagehide', abort)
		return () => {
			window.removeEventListener('pagehide', abort)
			abort()
		}
	}, [wallet])

	const onStart = useCallback(
		async (automatic = false) => {
			if (!loaded || request.current || registrationAttempted) return
			const controller = new AbortController()
			request.current = controller
			setPending(true)
			setError(null)
			try {
				let passkey = created
				if (!passkey) {
					if (!automatic) void logRegistrationClick()
					setPhase('creating')
					passkey = await createPasskey(controller.signal)
					controller.signal.throwIfAborted()
					setCreated(passkey)
					profile.current = { version: 1, passkey, registration: 'created' }
				}
				if (!profile.current) throw new Error('Missing saved passkey record.')
				saveDemoProfile(localStorage, profile.current)
				setPhase('unlocking')
				// Try immediately after creation. If a provider requires fresh activation,
				// the retry button calls this same get() directly from a new click.
				const secrets = await unlockPasskey(passkey, controller.signal)
				if (controller.signal.aborted) {
					secrets.seed.fill(0)
					secrets.databaseKey.fill(0)
					controller.signal.throwIfAborted()
				}
				setRegistrationAttempted(true)
				const session = await registerOnStaging(
					secrets,
					passkey.credentialId,
					controller.signal,
					(next: RegistrationPhase) => {
						if (!controller.signal.aborted) {
							if (next === 'registering' || next === 'finalized') {
								const saved = profile.current!
								const updated = {
									...saved,
									registration:
										next === 'registering' ? ('submitting' as const) : ('finalized' as const),
								}
								saveDemoProfile(localStorage, updated)
								profile.current = updated
							}
							setPhase(next)
						}
					},
					publicMaterial => {
						if (!controller.signal.aborted) {
							profile.current = { ...profile.current!, publicMaterial }
							setMaterial(publicMaterial)
						}
					}
				)
				if (controller.signal.aborted) {
					session.terminate()
					return
				}
				wallet.current = session
				setInitialized(true)
				setPhase('ready')
			} catch (cause) {
				if (!controller.signal.aborted) setError(errorMessage(cause))
			} finally {
				request.current = null
				setPending(false)
			}
		},
		[loaded, registrationAttempted, created, wallet, setInitialized]
	)

	const onInitialize = useCallback(async () => {
		const saved = profile.current
		if (request.current || wallet.current || saved?.registration !== 'finalized' || !saved.publicMaterial) return
		const controller = new AbortController()
		request.current = controller
		setPending(true)
		setError(null)
		setPhase('unlocking')
		try {
			const secrets = await unlockPasskey(saved.passkey, controller.signal)
			setPhase('initializing')
			const session = await initializeAuthenticator(
				secrets,
				saved.passkey.credentialId,
				saved.publicMaterial,
				controller.signal
			)
			if (controller.signal.aborted) {
				session.terminate()
				return
			}
			setHasActiveFaux(null)
			setHasActiveSelfie(null)
			wallet.current = session
			setInitialized(true)
			setPhase('ready')
		} catch (cause) {
			if (!controller.signal.aborted) setError(errorMessage(cause))
		} finally {
			request.current = null
			setPending(false)
		}
	}, [wallet, setInitialized])

	useEffect(() => {
		if (requestEntry === null || (requestEntry && !shareStarted)) return
		if (!loaded || initialized || pending || error || request.current) return
		const registration = profile.current?.registration
		if (registration === 'submitting') return
		const action = registration === 'finalized' ? 'initialize' : 'register'
		if (autoStarted.current.has(action)) return
		autoStarted.current.add(action)
		if (action === 'initialize') void onInitialize()
		else void onStart(true)
	}, [loaded, initialized, pending, error, onInitialize, onStart, requestEntry, shareStarted])

	const onIssue = async () => {
		if (
			request.current ||
			!initialized ||
			!wallet.current ||
			issued?.issuerSchemaId === '128' ||
			hasActiveFaux !== false
		)
			return
		const controller = new AbortController()
		request.current = controller
		setPending(true)
		setError(null)
		setPhase('issuing')
		setIssuanceExchange(null)
		try {
			const records = await abortable(
				wallet.current.listCredentials(),
				AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
			)
			if (records.some(record => record.issuerSchemaId === BigInt(128) && !record.isExpired)) {
				setHasActiveFaux(true)
				setPhase('ready')
				return
			}
			const stored = await issueFauxCredential(wallet.current, controller.signal, fetch, exchange => {
				if (!controller.signal.aborted) setIssuanceExchange(exchange)
			})
			if (!controller.signal.aborted) {
				setIssued({
					credentialId: stored.credentialId.toString(),
					issuerSchemaId: stored.issuerSchemaId.toString(),
				})
				setPhase('issued')
			}
		} catch (cause) {
			wallet.current?.terminate()
			wallet.current = null
			setInitialized(false)
			if (!controller.signal.aborted) setError(errorMessage(cause))
		} finally {
			request.current = null
			setPending(false)
		}
	}

	return (
		<div className="flex min-h-screen flex-col bg-background px-6 py-8 text-primary">
			{(requestEntry === false || shareStarted) && (
				<>
					<header>
						<WorldMark className="h-6" />
					</header>
					<main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-16">
						<h1 className="font-tiempos text-4xl">
							{issued
								? issued.issuerSchemaId === '11'
									? 'Selfie credential stored'
									: 'Faux credential stored'
								: initialized
									? 'Authenticator ready'
									: profile.current?.registration === 'finalized'
										? 'World ID registered'
										: 'Create your World ID'}
						</h1>
						<p className="mt-4 text-lg">
							Register on staging, initialize your authenticator, then issue a test credential.
						</p>
						<div aria-live="polite" aria-atomic="true">
							<p className="mt-6">
								{error ? 'Flow stopped.' : !loaded ? 'Checking saved passkey…' : phaseLabels[phase]}
							</p>
							{created && (
								<dl className="mt-6 space-y-4 rounded-2xl border border-border p-5">
									<div>
										<dt className="text-sm text-secondary">Passkey ID</dt>
										<dd className="mt-1 break-all font-mono text-sm">{created.credentialId}</dd>
									</div>
									<div>
										<dt className="text-sm text-secondary">Passkey PRF</dt>
										<dd>{created.prfSupported ? 'Supported' : 'Not reported as supported'}</dd>
									</div>
									{material && (
										<>
											<div>
												<dt className="text-sm text-secondary">Authenticator address</dt>
												<dd className="break-all font-mono text-sm">
													{material.authenticatorAddress}
												</dd>
											</div>
											<div>
												<dt className="text-sm text-secondary">Authenticator public key</dt>
												<dd className="break-all font-mono text-sm">
													{material.authenticatorPubkey}
												</dd>
											</div>
											<div>
												<dt className="text-sm text-secondary">Offchain signer commitment</dt>
												<dd className="break-all font-mono text-sm">
													{material.offchainSignerCommitment}
												</dd>
											</div>
										</>
									)}
								</dl>
							)}
						</div>
						{error && (
							<p role="alert" className="mt-6">
								{error}
							</p>
						)}
						{loaded &&
							(pending || error) &&
							!registrationAttempted &&
							(!created || created.prfSupported) && (
								<button
									type="button"
									onClick={() => void onStart()}
									disabled={pending}
									className="mt-8 min-h-12 w-full cursor-pointer rounded-full bg-primary px-6 py-3 font-semibold text-white disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4"
								>
									{pending
										? 'Waiting for browser…'
										: created
											? 'Unlock passkey and register'
											: 'Create passkey and register'}
								</button>
							)}
						{loaded &&
							(pending || error) &&
							profile.current?.registration === 'finalized' &&
							!initialized && (
								<button
									type="button"
									onClick={onInitialize}
									disabled={pending}
									className="mt-8 min-h-12 w-full cursor-pointer rounded-full bg-primary px-6 py-3 font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4"
								>
									{pending ? 'Initializing…' : 'Initialize authenticator'}
								</button>
							)}
						{initialized && wallet.current && (
							<details className="mt-6 rounded-2xl border border-border p-5">
								<summary className="cursor-pointer font-semibold">Developer menu</summary>
								<CredentialVault
									wallet={wallet.current}
									revision={issued?.credentialId}
									onLoaded={onVaultLoaded}
									disabled={pending}
									onDeleted={() => {
										setIssued(null)
										setIssuanceExchange(null)
									}}
								/>
								<button
									type="button"
									onClick={onIssue}
									disabled={pending || issued?.issuerSchemaId === '128' || hasActiveFaux !== false}
									className="mt-8 min-h-12 w-full cursor-pointer rounded-full bg-primary px-6 py-3 font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4"
								>
									{pending
										? 'Issuing…'
										: issued?.issuerSchemaId === '128' || hasActiveFaux
											? 'Active faux credential already stored'
											: 'Issue faux credential'}
								</button>

								<button
									type="button"
									onClick={() => {
										navigate('/selfie-demo')
									}}
									disabled={pending || hasActiveSelfie === null}
									aria-describedby="selfie-issuance-status"
									className="mt-3 min-h-12 w-full rounded-full bg-primary px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
								>
									{phase === 'issuingSelfie'
										? 'Issuing selfie credential…'
										: hasActiveSelfie
											? 'Demo challenge'
											: 'Issue selfie credential'}
								</button>
								<p id="selfie-issuance-status" className="mt-2 text-sm text-secondary">
									{hasActiveSelfie
										? 'Demo challenge opens a live camera preview. No image is sent and no face match is performed yet.'
										: 'Opens a live camera preview that stays in this tab. Demo issuance uses synthetic face data; it does not verify your face or create a recoverable PCP.'}
								</p>
								{issued && (
									<p className="mt-6">
										Stored credential ID: {issued.credentialId} · Issuer schema:{' '}
										{issued.issuerSchemaId}
									</p>
								)}
								{issuanceExchange && (
									<section
										aria-label="Faux issuance request and response"
										className="mt-6 min-w-0 space-y-4 rounded-2xl border border-border p-5"
									>
										<h2 className="font-semibold">Faux issuance request / response</h2>
										<p className="text-sm text-secondary">
											This button’s exchange with the staging issuer proxy. Visible only for this
											visit.
										</p>
										<div>
											<h3 className="mb-2 text-sm font-semibold">Request</h3>
											<p className="mb-2 break-all font-mono text-xs">
												POST /api/faux-credential
											</p>
											<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
												{JSON.stringify(issuanceExchange.request.body, null, 2)}
											</pre>
										</div>
										<div>
											<h3 className="mb-2 text-sm font-semibold">
												Response
												{issuanceExchange.response
													? ` · HTTP ${issuanceExchange.response.status}`
													: ''}
											</h3>
											<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
												{issuanceExchange.response?.body ??
													(pending ? 'Waiting for response…' : 'No response received.')}
											</pre>
										</div>
									</section>
								)}
							</details>
						)}
					</main>
				</>
			)}
			<CredentialRequestSheet
				wallet={initialized ? wallet.current : null}
				enabled={shareStarted}
				canContinue={
					loaded &&
					!pending &&
					profile.current?.registration !== 'submitting' &&
					(!created || created.prfSupported)
				}
				continuationError={
					error ??
					(created && !created.prfSupported
						? 'This passkey provider does not support this authenticator. Use a provider with passkey PRF support.'
						: null)
				}
				onRequestDetected={setRequestEntry}
				onContinue={() => {
					setShareStarted(true)
					if (initialized) return
					// Start WebAuthn directly from the click to preserve user activation.
					const action = profile.current?.registration === 'finalized' ? 'initialize' : 'register'
					autoStarted.current.add(action)
					if (action === 'initialize') void onInitialize()
					else void onStart()
				}}
				onSessionClosed={() => {
					wallet.current = null
					setInitialized(false)
				}}
			/>
		</div>
	)
}
