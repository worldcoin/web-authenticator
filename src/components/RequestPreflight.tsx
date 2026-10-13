import type { IncomingRequest } from '@/lib/requests/incoming-request'

export default function RequestPreflight({
	incoming,
	error,
	busy,
	canContinue,
	onShare,
	onCancel,
}: {
	incoming: IncomingRequest | null
	error: string | null
	busy: boolean
	canContinue: boolean
	onShare: () => void
	onCancel: () => void
}) {
	const selfie = incoming?.proof.proof_requests.some(item => item.issuer_schema_id === 11)
	const message = error ?? incoming?.unsupportedReason
	return (
		<main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12 text-center">
			<img src="/images/world-id/mark.svg" alt="World ID" width={64} height={64} className="mx-auto" />
			<p className="mt-8 text-sm text-secondary">Request through World ID</p>
			<h1 className="mt-3 break-words text-3xl font-semibold">
				{incoming ? incoming.label : error ? 'Unable to open request' : 'Loading request…'}
			</h1>
			<p className="mt-4 text-secondary">
				{incoming
					? selfie
						? 'is requesting a Selfie Check through World.'
						: 'is requesting a World ID proof.'
					: error
						? 'Return to the requesting app and start a new request.'
						: 'Checking the request before continuing.'}
			</p>
			{incoming && <p className="mt-4 break-words text-sm">Action: {incoming.actionLabel}</p>}
			{message && (
				<p role="alert" className="mt-6 text-sm">
					{message}
				</p>
			)}
			<div className="mt-10 flex flex-col gap-3">
				<button className="sheet-primary" onClick={onShare} disabled={!canContinue || busy}>
					Share
				</button>
				<button className="sheet-secondary" onClick={onCancel} disabled={busy}>
					{busy ? 'Closing…' : 'Cancel'}
				</button>
			</div>
		</main>
	)
}
