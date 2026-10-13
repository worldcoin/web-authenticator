import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { abortable } from '@/lib/staging-registration'
import SelfieCamera from '@/components/selfie-check/SelfieCamera'
import { useAuthenticatorSession } from '@/components/AuthenticatorSession'

type Metadata = { embeddingType: string; version: string; inferenceBackend: string }

export default function SelfieDemoPage() {
	const { wallet, initialized, setInitialized } = useAuthenticatorSession()
	const operation = useRef<AbortController | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [metadata, setMetadata] = useState<Metadata | null>(null)
	const [progress, setProgress] = useState('Ready to capture.')
	useEffect(() => () => operation.current?.abort(), [])

	async function extract(image: Uint8Array) {
		const client = wallet.current
		if (!client || !initialized || operation.current) return
		const controller = new AbortController()
		operation.current = controller
		const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])
		let extracting = false
		const cancel = () => {
			if (!extracting) return
			// #604 has no per-extraction cancellation; release its worker and OPFS ownership.
			client.terminate()
			if (wallet.current === client) {
				wallet.current = null
				setInitialized(false)
			}
		}
		signal.addEventListener('abort', cancel, { once: true })
		setPending(true)
		setError(null)
		setMetadata(null)
		setProgress('Loading trusted staging release…')
		try {
			const response = await fetch('/api/selfie-enclave', {
				signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
				cache: 'no-store',
			})
			if (!response.ok)
				throw new Error(
					'Staging is not configured. The backend needs the promoted release policy and admission key.'
				)
			const config = await response.text()
			if (config.length > 8192) throw new Error('Staging policy is too large.')
			signal.throwIfAborted()
			setProgress('Verifying enclave, encrypting the frame, and extracting…')
			extracting = true
			const result = await abortable(client.extractSelfieEmbedding(config, image), signal)
			extracting = false
			if (result.status !== 'success') throw new Error(`Extraction rejected: ${result.reason}`)
			const { embeddingType, version, inferenceBackend } = result.embedding
			// This demo deliberately retains neither the biometric vector nor the image.
			result.embedding.vector = ''
			setMetadata({ embeddingType, version, inferenceBackend })
			setProgress('Real enclave extraction succeeded. Downstream issuance is mocked.')
		} catch (cause) {
			if (!controller.signal.aborted) {
				setError(
					signal.aborted
						? 'Extraction timed out. Unlock your authenticator to retry.'
						: cause instanceof Error && !extracting
							? cause.message
							: 'Enclave extraction failed. Check the deployed version, release policy, and admission key.'
				)
				setProgress('Extraction did not complete.')
			}
		} finally {
			signal.removeEventListener('abort', cancel)
			operation.current = null
			if (!controller.signal.aborted) setPending(false)
		}
	}

	return (
		<main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12 text-primary">
			<div className="w-full max-w-2xl text-center">
				<h1 className="text-3xl font-semibold">Staging Selfie Check</h1>
				{initialized ? (
					<>
						<p className="mt-4 text-sm text-secondary">
							Capture sends one encrypted frame to the verified staging enclave. Face positioning runs on
							this device.
						</p>
						<SelfieCamera detectFaces onCapture={extract} captureDisabled={pending} />
					</>
				) : (
					<p className="mt-6">Unlock your authenticator to open the camera.</p>
				)}
				<p role="status" className="mt-4 text-sm">
					{progress}
				</p>
				{error && (
					<p role="alert" className="mt-4 text-sm">
						{error}
					</p>
				)}
				{metadata && (
					<section className="mt-6 rounded-2xl border border-border p-5 text-left">
						<h2 className="font-semibold">Extraction result</h2>
						<dl className="mt-3 text-sm">
							<dt>Embedding type</dt>
							<dd>{metadata.embeddingType}</dd>
							<dt>Embedding version</dt>
							<dd>{metadata.version}</dd>
							<dt>Inference backend</dt>
							<dd>{metadata.inferenceBackend}</dd>
						</dl>
						<h2 className="mt-4 font-semibold">Mock issuance preview</h2>
						<p className="mt-2 text-sm">
							issuer_assurance = 2 (web), mocked. Sybil score, match count, database size and PCP version
							remain unavailable. No credential is signed or stored.
						</p>
					</section>
				)}
				<Link to="/" className="mt-8 inline-block underline">
					Back to authenticator
				</Link>
			</div>
		</main>
	)
}
