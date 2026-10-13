import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import type { WalletKit } from '../lib/walletkit'
import { abortable } from '@/lib/staging-registration'
import RequestPreflight from '@/components/RequestPreflight'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthenticatorSession } from '@/components/AuthenticatorSession'
import { checkExpiry, credentialRequirementsLabel } from '@/lib/requests/proof-request'
import { loadIncomingRequest, checkRequestCredentials } from '@/lib/requests/incoming-request'

export default function CredentialRequestSheet({
	wallet,
	enabled,
	canContinue,
	continuationError,
	onRequestDetected,
	onContinue,
	onSessionClosed,
}: {
	wallet: WalletKit | null
	enabled: boolean
	canContinue: boolean
	continuationError: string | null
	onRequestDetected: (detected: boolean) => void
	onContinue: () => void
	onSessionClosed: () => void
}) {
	const navigate = useNavigate()
	const dialog = useRef<HTMLDialogElement>(null)
	const operation = useRef<AbortController | null>(null)
	const loading = useRef<AbortController | null>(null)
	const sourceUrl = useRef<string | null>(null)
	const { incoming, setIncoming, clearRequest, setShareStarted } = useAuthenticatorSession()
	const resumedRequest = useRef(incoming)
	const request = incoming?.proof
	const [error, setError] = useState<string | null>(null)
	const [phase, setPhase] = useState<'review' | 'proving' | 'success'>('review')
	const [sending, setSending] = useState(false)
	const [sent, setSent] = useState(false)
	const [confirmCancel, setConfirmCancel] = useState(false)
	const [hasRequest, setHasRequest] = useState(false)
	const [closed, setClosed] = useState(false)
	const [proofResponse, setProofResponse] = useState<string | null>(null)
	const [credentialCheck, setCredentialCheck] = useState<{
		incoming: NonNullable<typeof incoming>
		result: Awaited<ReturnType<typeof checkRequestCredentials>>
	} | null>(null)
	const availability = credentialCheck?.incoming === incoming ? credentialCheck?.result : null
	const [vaultCheckAttempt, setVaultCheckAttempt] = useState(0)
	const [progress, setProgress] = useState<{ time: string; message: string }[]>([])
	const logStep = useCallback(
		(step: string, message: string, status: 'started' | 'completed' | 'failed' = 'completed') => {
			const time = new Date().toISOString()
			setProgress(entries => [...entries, { time, message }].slice(-30))
			console.info('world_id_proof_flow', { time, step, status })
		},
		[]
	)

	useEffect(() => {
		const controller = new AbortController()
		loading.current = controller
		const stop = () => {
			controller.abort()
			operation.current?.abort()
		}
		window.addEventListener('pagehide', stop)
		const cleanup = () => {
			window.removeEventListener('pagehide', stop)
			stop()
		}
		sourceUrl.current ??= window.location.href
		const url = new URL(sourceUrl.current)
		const hasConnector = ['i', 'k'].some(key => url.searchParams.has(key))
		const detected = hasConnector || !!resumedRequest.current
		onRequestDetected(detected)
		if (!detected) return cleanup
		setHasRequest(true)
		if (!hasConnector) return cleanup
		setIncoming(null)
		setShareStarted(false)
		// The decrypted request's response capability stays in memory across routes.
		if (url.searchParams.has('k')) window.history.replaceState(window.history.state, '', window.location.pathname)
		void loadIncomingRequest(sourceUrl.current, controller.signal, message => {
			if (!controller.signal.aborted) logStep('load_request', message, 'started')
		})
			.then(loaded => {
				if (!controller.signal.aborted) {
					setIncoming(loaded)
					logStep('validate_request', 'Request validated. Waiting for the authenticator to check its vault.')
				}
			})
			.catch(cause => {
				if (!controller.signal.aborted) {
					setError(cause instanceof Error ? cause.message : 'Could not load the request.')
					logStep('load_request', 'Request loading or validation failed.', 'failed')
				}
			})
		return cleanup
	}, [logStep, onRequestDetected, setIncoming, setShareStarted])

	const needsEnrollment = !!availability?.needsSelfieEnrollment && !incoming?.unsupportedReason && !error

	useEffect(() => {
		if (!enabled || !hasRequest || !wallet || (!availability && !error)) return
		if (needsEnrollment) {
			dialog.current?.close()
			navigate('/selfie-check', { replace: true })
		} else if (!dialog.current?.open) dialog.current?.showModal()
	}, [enabled, wallet, hasRequest, availability, needsEnrollment, error, navigate])

	useEffect(() => {
		if (!enabled || !wallet || !incoming) return
		const controller = new AbortController()
		void checkRequestCredentials(incoming, wallet, controller.signal)
			.then(result => {
				if (controller.signal.aborted) return
				setCredentialCheck({ incoming, result })
				logStep(
					'check_credentials',
					result.satisfied
						? 'Requested credentials are available. Waiting for approval.'
						: 'The vault does not satisfy this request’s credential requirements.'
				)
			})
			.catch(() => {
				if (!controller.signal.aborted) setError('Could not read credential availability from the vault.')
			})
		return () => controller.abort()
	}, [enabled, wallet, incoming, logStep, vaultCheckAttempt])

	useEffect(() => {
		if (!request || sent) return
		const timer = setTimeout(
			() => setError('This request expired. Start a new request at the relying party.'),
			Math.max(0, request.expires_at * 1000 - Date.now())
		)
		return () => clearTimeout(timer)
	}, [request, sent])

	const leave = () => {
		loading.current?.abort()
		dialog.current?.close()
		clearRequest()
		if (incoming?.returnUrl) window.location.assign(incoming.returnUrl)
		else {
			setHasRequest(false)
			setClosed(true)
		}
	}
	const returnToApp = async (proof = proofResponse) => {
		if (!incoming || !proof || sending || operation.current) return
		if (sent) {
			leave()
			return
		}
		setSending(true)
		setError(null)
		const controller = new AbortController()
		operation.current = controller
		try {
			logStep('return_response', 'Encrypting and sending the proof response…', 'started')
			await incoming.deliver(proof, controller.signal)
			controller.signal.throwIfAborted()
			setSent(true)
			logStep('return_response', 'Response accepted by the transport. RP verification is separate.')
			if (incoming.returnUrl) leave()
		} catch {
			if (!controller.signal.aborted) {
				setError('Could not confirm proof delivery. Retry sending the same proof, or close this request.')
				logStep('return_response', 'Response delivery failed; proof retained for retry.', 'failed')
			}
		} finally {
			operation.current = null
			setSending(false)
		}
	}
	const cancel = async () => {
		if (sending) return
		operation.current?.abort()
		if (!incoming) {
			leave()
			return
		}
		setSending(true)
		try {
			await incoming.cancel(AbortSignal.timeout(15000))
			logStep('cancel_request', 'Rejection returned to the relying party.')
			leave()
		} catch {
			setError(
				'Could not send the rejection to the bridge. You can retry cancellation or close this tab; the RP request will expire.'
			)
		} finally {
			setSending(false)
		}
	}
	const requestClose = () => {
		if (sending) return
		if (phase === 'success') {
			leave()
			return
		}
		setConfirmCancel(true)
	}
	const approve = async () => {
		if (
			!wallet ||
			!incoming ||
			operation.current ||
			error ||
			!availability?.satisfied ||
			incoming.unsupportedReason
		)
			return
		const controller = new AbortController()
		operation.current = controller
		const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])
		const terminate = () => wallet.terminate()
		deadline.addEventListener('abort', terminate, { once: true })
		setPhase('proving')
		logStep('approval', 'Approval received.')
		let generatedProof: string | null = null
		try {
			await incoming.validate(deadline)
			logStep('revalidate_request', 'Request signature and expiry rechecked.')
			const available = await checkRequestCredentials(incoming, wallet, deadline)
			if (!available.satisfied) throw new Error('The required credentials are no longer available.')
			logStep('generate_proof', 'WalletKit is generating the proof…', 'started')
			const proof = await abortable(wallet.generateProof(JSON.stringify(incoming.proof)), deadline)
			deadline.throwIfAborted()
			checkExpiry(incoming.proof)
			const result = JSON.parse(proof) as { error?: unknown; responses?: unknown }
			if (result.error || !Array.isArray(result.responses) || !result.responses.length)
				throw new Error('WalletKit could not satisfy this proof request.')
			setProofResponse(proof)
			setConfirmCancel(false)
			setPhase('success')
			generatedProof = proof
			logStep('generate_proof', 'Proof created. Sending it to the relying party…')
		} catch (cause) {
			wallet.terminate()
			onSessionClosed()
			if (!controller.signal.aborted)
				setError(
					cause instanceof Error && cause.message === 'WalletKit could not satisfy this proof request.'
						? cause.message
						: 'Proof generation failed or timed out. Reopen the authenticator and start a fresh request.'
				)
			logStep('generate_proof', 'Proof generation stopped.', 'failed')
		} finally {
			deadline.removeEventListener('abort', terminate)
			operation.current = null
		}
		// Delivery has its own deadline and retry path; a transport failure must not
		// discard the proof or terminate the wallet after successful generation.
		if (generatedProof && !controller.signal.aborted) await returnToApp(generatedProof)
	}

	if (closed)
		return (
			<main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center text-center">
				<h1 className="text-3xl font-semibold">Request closed</h1>
				<p className="mt-4 text-secondary">You can close this tab or return to the requesting app.</p>
				<Link to="/" className="mt-8 underline">
					Open authenticator
				</Link>
			</main>
		)
	if (!hasRequest) return null
	if (!enabled)
		return (
			<RequestPreflight
				incoming={incoming}
				error={error ?? continuationError}
				busy={sending}
				canContinue={canContinue && !!incoming && !error && !continuationError && !incoming.unsupportedReason}
				onShare={onContinue}
				onCancel={() => void cancel()}
			/>
		)
	return (
		<>
			<div className="mt-6 rounded-2xl border border-border p-5" aria-live="polite">
				<p className="font-semibold">Request from {incoming?.label ?? 'relying party'}</p>
				<p className="mt-2 text-sm text-secondary">
					{error ??
						(wallet
							? 'Review the request in the approval sheet.'
							: 'Initialize your authenticator with your passkey. The approval sheet will open automatically.')}
				</p>
				{!request && (
					<button onClick={leave} className="mt-3 inline-block underline">
						Close request
					</button>
				)}
				{request && !wallet && (
					<button onClick={cancel} className="mt-3 underline">
						Cancel request
					</button>
				)}
			</div>
			<dialog
				ref={dialog}
				className="credential-sheet"
				aria-labelledby="credential-sheet-title"
				aria-describedby="credential-sheet-description"
				onCancel={event => {
					event.preventDefault()
					requestClose()
				}}
				onClick={event => {
					if (event.target === event.currentTarget) {
						const rect = event.currentTarget.getBoundingClientRect()
						if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right)
							requestClose()
					}
				}}
			>
				<div className="sheet-handle" />
				<div className="flex items-start justify-between">
					<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f1f0ee]">
						<img src={`/images/world-id/${sent ? 'success' : 'mark'}.svg`} alt="" width={36} height={36} />
					</div>
					<button
						autoFocus
						onClick={requestClose}
						aria-label="Close request"
						disabled={sending}
						className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f1f0ee]"
					>
						<img src="/images/world-id/close.svg" alt="" width={24} height={24} />
					</button>
				</div>
				<p className="mt-6 text-sm text-secondary">{incoming?.label ?? 'Incoming request'} · Staging</p>
				<h2 id="credential-sheet-title" className="mt-2 text-3xl font-semibold tracking-tight">
					{confirmCancel
						? 'Cancel this request?'
						: phase === 'success'
							? sent
								? 'Proof response sent'
								: sending
									? 'Sharing proof…'
									: 'Proof delivery unconfirmed'
							: `Share a proof with ${incoming?.label ?? 'relying party'}`}
				</h2>
				<p id="credential-sheet-description" className="mt-4 text-secondary">
					{confirmCancel
						? 'The relying party will receive a rejection without a proof.'
						: phase === 'success'
							? sent
								? 'Your proof response has been sent. Verification happens on the relying party’s server.'
								: sending
									? 'Sending your proof to the requesting app.'
									: 'Your proof is ready. You can retry delivery without generating another proof.'
							: 'Approving creates your proof and sends it to the requesting app.'}
				</p>
				{!confirmCancel && phase !== 'success' && (
					<>
						<div className="my-6 h-px bg-border" />
						<p className="mb-4 break-all text-sm">Action: {incoming?.actionLabel ?? 'Loading…'}</p>
						{request && (
							<p className="mb-4 text-sm">Accepted credentials: {credentialRequirementsLabel(request)}</p>
						)}
						{incoming?.appId && (
							<p className="mb-4 break-all text-xs text-secondary">
								App ID: {incoming.appId} · RP signature checked against staging registry
							</p>
						)}
						{request?.proof_requests.map(item => (
							<div
								key={item.identifier}
								className="mb-3 flex items-center gap-4 rounded-2xl bg-[#f5f5f4] p-4"
							>
								<img src="/images/world-id/shield.svg" alt="" width={32} height={32} />
								<div>
									<p className="font-semibold">{item.identifier.replaceAll('_', ' ')}</p>
									<p className="text-sm text-secondary">
										Schema {item.issuer_schema_id} ·{' '}
										{availability
											? availability.items.find(result => result.identifier === item.identifier)
													?.available
												? 'Available'
												: 'Missing or outside date requirements'
											: 'Checking vault…'}
									</p>
								</div>
							</div>
						))}
						{availability && !availability.satisfied && (
							<p className="mt-4 text-sm">
								{availability.requiresOrb &&
								availability.items.some(item => item.issuer_schema_id === 1 && !item.available)
									? 'This request requires an eligible Orb credential, which is missing from this vault. Selfie enrollment cannot replace it. Orb enrollment and transfer from another wallet are not available here; cancel and retry from the requesting app with an authenticator holding the required credential.'
									: availability.canEnrollSelfie
										? 'This request accepts alternative credentials. You can choose Selfie Check below, or cancel and use another accepted credential from the requesting app.'
										: 'Your vault does not contain credentials that satisfy all the required issuer and date conditions. Use an authenticator holding the accepted credentials.'}
							</p>
						)}
						{incoming?.unsupportedReason && <p className="mt-4 text-sm">{incoming.unsupportedReason}</p>}
						{request && (
							<details className="mt-4">
								<summary>Request details</summary>
								<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
									{JSON.stringify(request, null, 2)}
								</pre>
							</details>
						)}

						<p className="mt-4 text-sm text-secondary">
							The app receives a cryptographic proof. Your passkey and secret keys are not shared.
						</p>
					</>
				)}

				{phase === 'success' && proofResponse && (
					<section aria-label="Proof response" className="mt-6">
						<h3 className="font-semibold">Proof response</h3>
						<pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[#f5f5f4] p-4 text-xs">
							{proofResponse}
						</pre>
					</section>
				)}
				<section className="mt-6" aria-label="Proof progress">
					<h3 className="text-sm font-semibold">Progress</h3>
					<ol
						role="log"
						aria-live="polite"
						className="mt-3 max-h-40 space-y-2 overflow-auto text-xs text-secondary"
					>
						{progress.map((entry, index) => (
							<li key={index}>
								<time dateTime={entry.time}>{entry.time.slice(11, 19)}</time> · {entry.message}
							</li>
						))}
					</ol>
				</section>
				{error && (
					<p role="alert" className="mt-5 text-sm">
						{error}
					</p>
				)}
				{incoming?.returnUrl && (
					<p className="mt-4 break-all text-xs text-secondary">Return destination: {incoming.returnUrl}</p>
				)}
				<div className="mt-8 flex flex-col gap-3" aria-live="polite">
					{confirmCancel ? (
						<>
							<button className="sheet-primary" onClick={() => setConfirmCancel(false)}>
								Keep reviewing
							</button>
							<button className="sheet-secondary" onClick={cancel} disabled={sending}>
								Cancel request
							</button>
						</>
					) : phase === 'success' ? (
						<button className="sheet-primary" onClick={() => void returnToApp()} disabled={sending}>
							{sending ? 'Sending…' : sent ? 'Done' : 'Retry sending proof'}
						</button>
					) : error ? (
						<button className="sheet-primary" onClick={cancel}>
							Reject and close
						</button>
					) : (
						<>
							{availability?.canEnrollSelfie && !incoming?.unsupportedReason && (
								<button
									className="sheet-primary"
									onClick={() => {
										dialog.current?.close()
										navigate('/selfie-check')
									}}
								>
									Continue with Selfie Check
								</button>
							)}
							{availability && !availability.satisfied && !incoming?.unsupportedReason && (
								<button
									className="sheet-secondary"
									onClick={() => {
										setCredentialCheck(null)
										setVaultCheckAttempt(attempt => attempt + 1)
									}}
								>
									Check vault again
								</button>
							)}
							<button
								className="sheet-primary"
								disabled={
									phase === 'proving' || !availability?.satisfied || !!incoming?.unsupportedReason
								}
								onClick={approve}
							>
								{phase === 'proving' ? 'Creating proof…' : 'Approve and share'}
							</button>
							<button className="sheet-secondary" onClick={requestClose}>
								Cancel
							</button>
						</>
					)}
				</div>
			</dialog>
		</>
	)
}
