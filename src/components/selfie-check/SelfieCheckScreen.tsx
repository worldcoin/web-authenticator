import { Link } from 'react-router-dom'
import SelfieCamera from './SelfieCamera'
import { useNavigate } from 'react-router-dom'
import { checkExpiry } from '@/lib/requests/proof-request'
import { useCallback, useEffect, useRef, useState } from 'react'
import { checkRequestCredentials } from '@/lib/requests/incoming-request'
import { useAuthenticatorSession } from '@/components/AuthenticatorSession'
import { issueSelfieCredential, SelfieWalletTimeout } from '@/lib/selfie-issuance'

export default function SelfieCheckScreen() {
	const navigate = useNavigate()
	const { incoming, wallet, initialized, setInitialized, shareStarted, clearRequest } = useAuthenticatorSession()
	const operation = useRef<AbortController | null>(null)
	const [phase, setPhase] = useState<'checking' | 'ready' | 'issuing' | 'retry' | 'returning'>('checking')
	const [error, setError] = useState<string | null>(null)
	const [expired, setExpired] = useState(false)
	const [closing, setClosing] = useState(false)
	const [closed, setClosed] = useState(false)
	const [progress, setProgress] = useState<string[]>([])

	useEffect(() => {
		const controller = new AbortController()
		if (!incoming || !initialized || !wallet.current || !shareStarted) return
		const currentWallet = wallet.current
		const timer = setTimeout(
			() => {
				setExpired(true)
				controller.abort()
				operation.current?.abort()
			},
			Math.max(0, incoming.proof.expires_at * 1000 - Date.now())
		)
		const stop = () => {
			controller.abort()
			operation.current?.abort()
		}
		window.addEventListener('pagehide', stop)
		void (async () => {
			await incoming.validate(controller.signal)
			if (incoming.unsupportedReason) throw new Error(incoming.unsupportedReason)
			const available = await checkRequestCredentials(incoming, currentWallet, controller.signal)
			controller.signal.throwIfAborted()
			if (operation.current) return
			if (available.satisfied) {
				setPhase('returning')
				navigate('/', { replace: true })
			} else if (available.canEnrollSelfie) {
				setPhase('ready')
			} else {
				throw new Error('This request cannot be completed by issuing a demo selfie credential.')
			}
		})().catch(cause => {
			if (!controller.signal.aborted)
				setError(cause instanceof Error ? cause.message : 'Could not check this request.')
		})
		return () => {
			clearTimeout(timer)
			window.removeEventListener('pagehide', stop)
			stop()
		}
	}, [incoming, initialized, wallet, shareStarted, navigate])

	const issue = useCallback(async () => {
		if (
			!incoming ||
			!wallet.current ||
			!initialized ||
			!shareStarted ||
			expired ||
			incoming.unsupportedReason ||
			operation.current
		)
			return
		const controller = new AbortController()
		operation.current = controller
		const currentWallet = wallet.current
		setError(null)
		setProgress([])
		setPhase('issuing')
		try {
			await incoming.validate(controller.signal)
			await issueSelfieCredential(currentWallet, controller.signal, message => {
				if (!controller.signal.aborted)
					setProgress(steps => (steps.at(-1) === message ? steps : [...steps, message].slice(-20)))
			})
			controller.signal.throwIfAborted()
			checkExpiry(incoming.proof)
			setPhase('returning')
			navigate('/', { replace: true })
		} catch (cause) {
			if (cause instanceof SelfieWalletTimeout) {
				wallet.current = null
				setInitialized(false)
			}
			if (!controller.signal.aborted) {
				setError(
					cause instanceof Error
						? cause.message
						: 'Demo issuance failed. Retry to resume the same enrollment.'
				)
				setPhase('retry')
			}
		} finally {
			operation.current = null
		}
	}, [incoming, wallet, initialized, shareStarted, expired, navigate, setInitialized])

	const cancel = async () => {
		if (!incoming || operation.current) return
		const controller = new AbortController()
		operation.current = controller
		setClosing(true)
		try {
			await incoming.cancel(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
			controller.signal.throwIfAborted()
			clearRequest()
			setClosed(true)
			if (incoming.returnUrl) window.location.assign(incoming.returnUrl)
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(cause instanceof Error ? cause.message : 'Could not cancel the request. Try again.')
		} finally {
			operation.current = null
			setClosing(false)
		}
	}

	return (
		<main className="flex min-h-dvh flex-col justify-center bg-background px-6 py-12 text-primary">
			<div className="mx-auto w-full max-w-md text-center">
				<img src="/images/world-id/mark.svg" alt="World ID" width={64} height={64} className="mx-auto" />
				<h1 className="mt-8 text-3xl font-semibold">{closed ? 'Request closed' : 'Set up Selfie Check'}</h1>
				{!incoming ? (
					<>
						<p className="mt-4 text-secondary">
							Open a new request from the requesting app to continue. Requests are kept only in this tab
							and are cleared on reload.
						</p>
						<Link to="/" className="mt-8 inline-block underline">
							Open authenticator
						</Link>
					</>
				) : (
					<>
						<p className="mt-4 break-words text-secondary">Requested by {incoming.label}</p>
						<p className="mt-4 text-sm">Set up a selfie credential to continue with this request.</p>
						<p className="mt-6 rounded-2xl border border-border p-4 text-sm">
							Staging demo: the camera preview stays in this tab. Credential issuance still uses synthetic
							face data; this capture does not verify your face.
						</p>
						{(phase === 'ready' || phase === 'issuing' || phase === 'retry') &&
							initialized &&
							shareStarted &&
							!expired &&
							!closing && <SelfieCamera />}
						{(error || expired) && (
							<p role="alert" className="mt-6 text-sm">
								{expired ? 'This request expired. Start a new request from the requesting app.' : error}
							</p>
						)}
						<ol role="log" aria-live="polite" className="mt-6 space-y-2 text-left text-sm text-secondary">
							{progress.map((message, index) => (
								<li key={index}>{message}</li>
							))}
						</ol>
						<div className="mt-8 flex flex-col gap-3">
							{phase === 'ready' && initialized && shareStarted && !expired && (
								<details className="text-sm">
									<summary className="cursor-pointer">Developer tools</summary>
									<button
										className="sheet-secondary mt-3"
										disabled={closing}
										onClick={() => void issue()}
									>
										Enroll synthetic selfie credential
									</button>
								</details>
							)}
							{!initialized || !shareStarted ? (
								<Link to="/" className="sheet-primary">
									Continue with your passkey
								</Link>
							) : phase === 'retry' ? (
								<button
									className="sheet-primary"
									onClick={() => void issue()}
									disabled={expired || closing}
								>
									Retry demo credential issuance
								</button>
							) : (
								phase !== 'ready' && (
									<p role="status" className="text-sm text-secondary">
										{phase === 'checking'
											? 'Checking credential…'
											: phase === 'issuing'
												? 'Issuing demo credential…'
												: 'Opening proof request…'}
									</p>
								)
							)}
							<button
								className="sheet-secondary"
								onClick={() => void cancel()}
								disabled={closing || (phase === 'issuing' && !expired)}
							>
								{closing ? 'Closing…' : 'Cancel request'}
							</button>
						</div>
					</>
				)}
			</div>
		</main>
	)
}
