import { useAuthenticatorSession } from '@/components/AuthenticatorSession'

/** Dedicated TEE status and log; the initial attempt starts on the Issue button. */
export default function LocalTeeConnection() {
	const { tee } = useAuthenticatorSession()
	return (
		<section aria-label="TEE connection log" className="min-w-0 rounded-2xl border border-border p-5 text-left">
			<h2 className="font-semibold">TEE connection</h2>
			<p role="status" className="mt-3 text-sm text-secondary">
				{tee.result.reason}
			</p>
			<button type="button" onClick={() => tee.start()} disabled={tee.pending} className="sheet-secondary mt-4">
				{tee.pending ? 'Connecting…' : 'Retry TEE connection'}
			</button>

			<ol
				role="log"
				aria-label="TEE events"
				aria-live="polite"
				aria-relevant="additions"
				className="mt-4 h-64 space-y-3 overflow-y-auto break-words font-mono text-xs"
			>
				{tee.logs.map((entry, index) => (
					<li key={index}>
						<time className="text-secondary">{entry.time}</time>
						<p>{entry.message}</p>
					</li>
				))}
			</ol>
			<p className="mt-3 text-xs text-secondary">Demo access is provisioned automatically.</p>
		</section>
	)
}
