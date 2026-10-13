import { useEffect, useState } from 'react'
import { abortable } from '@/lib/staging-registration'
import type { CredentialMetadata, WalletKit } from '../lib/walletkit'

export default function CredentialVault({
	wallet,
	revision,
	onLoaded,
	onDeleted,
	disabled,
}: {
	wallet: WalletKit
	revision: string | undefined
	onLoaded: (hasActiveFaux: boolean, hasActiveSelfie: boolean) => void
	onDeleted: () => void
	disabled: boolean
}) {
	const [credentials, setCredentials] = useState<CredentialMetadata[] | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [message, setMessage] = useState<string | null>(null)
	const [deleting, setDeleting] = useState(false)
	const [refresh, setRefresh] = useState(0)
	const [selection, setSelection] = useState<CredentialMetadata[] | null>(null)
	useEffect(() => {
		const controller = new AbortController()
		void abortable(wallet.listCredentials(), AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
			.then(records => {
				if (controller.signal.aborted) return
				setCredentials(records)
				onLoaded(
					records.some(record => record.issuerSchemaId === BigInt(128) && !record.isExpired),
					records.some(record => record.issuerSchemaId === BigInt(11) && !record.isExpired)
				)
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setError('Could not read credential metadata. Refresh the list or unlock again.')
			})
		return () => controller.abort()
	}, [wallet, revision, onLoaded, refresh])
	async function removeSelected() {
		if (!selection || deleting || disabled) return
		setDeleting(true)
		setError(null)
		setMessage(null)
		let removed = 0
		try {
			const signal = AbortSignal.timeout(15_000)
			for (const record of selection) {
				signal.throwIfAborted()
				await abortable(wallet.deleteCredential(record.credentialId), signal)
				removed++
			}
			setMessage(`Deleted ${removed} local credential${removed === 1 ? '' : 's'}.`)
		} catch {
			setError(
				`Deletion stopped after ${removed} confirmed deletions. Refresh the list to check the current state before retrying.`
			)
		} finally {
			setSelection(null)
			setDeleting(false)
			onDeleted()
			setRefresh(value => value + 1)
		}
	}
	return (
		<section aria-label="Credential vault" className="mt-6 rounded-2xl border border-border p-5">
			<h2 className="font-semibold">Credential vault</h2>
			<p className="mt-2 text-sm text-secondary">
				Encrypted browser storage · {credentials ? `${credentials.length} credentials` : 'Reading vault…'}
			</p>
			{error && (
				<p role="alert" className="mt-3">
					{error}
				</p>
			)}
			{message && (
				<p role="status" className="mt-3">
					{message}
				</p>
			)}
			<button
				type="button"
				disabled={deleting || disabled}
				onClick={() => {
					setError(null)
					setRefresh(value => value + 1)
				}}
				className="mt-3 min-h-10 underline disabled:opacity-50"
			>
				Refresh credential list
			</button>
			{credentials?.length === 0 && <p className="mt-3">No credentials stored.</p>}
			<ul className="mt-4 space-y-3">
				{credentials?.map(record => (
					<li key={record.credentialId.toString()} className="rounded-xl bg-[#f5f5f4] p-4">
						<p className="font-semibold">
							{record.issuerSchemaId === BigInt(128)
								? 'Faux credential'
								: record.issuerSchemaId === BigInt(11)
									? 'Selfie credential'
									: 'Credential'}{' '}
							· {record.isExpired ? 'Expired' : 'Active'}
						</p>
						<p className="text-sm">
							ID {record.credentialId.toString()} · Schema {record.issuerSchemaId.toString()}
						</p>
						<p className="text-sm text-secondary">
							Expires {new Date(Number(record.expiresAt) * 1000).toLocaleString()}
						</p>
						<button
							type="button"
							disabled={deleting || disabled}
							onClick={() => setSelection([record])}
							className="mt-3 min-h-10 text-red-700 underline disabled:opacity-50"
						>
							Delete credential {record.credentialId.toString()}
						</button>
					</li>
				))}
			</ul>
			<button
				type="button"
				disabled={deleting || disabled || !credentials?.length}
				onClick={() => setSelection(credentials)}
				className="mt-4 min-h-10 text-red-700 underline disabled:opacity-50"
			>
				Delete all local credentials
			</button>
			{selection && (
				<div
					role="group"
					aria-label="Confirm credential deletion"
					className="mt-4 space-y-3 rounded-xl border border-red-200 p-4"
				>
					<p>
						Delete {selection.length} selected local credential{selection.length === 1 ? '' : 's'}? Their
						local blinding factors will also be removed. Issuer records, passkey, authenticator
						registration, and PCP data are unchanged. This cannot be undone here.
					</p>
					<p className="break-all text-xs">
						Credential IDs: {selection.map(record => record.credentialId.toString()).join(', ')}
					</p>
					<button
						type="button"
						disabled={deleting || disabled}
						onClick={removeSelected}
						className="min-h-11 rounded-full bg-red-700 px-5 text-white disabled:opacity-50"
					>
						{deleting ? 'Deleting…' : 'Confirm deletion'}
					</button>
					<button
						type="button"
						disabled={deleting}
						onClick={() => setSelection(null)}
						className="ml-4 min-h-11 underline"
					>
						Cancel
					</button>
				</div>
			)}
			<div className="mt-6 border-t border-border pt-4">
				<h3 className="font-semibold">Local PCP storage</h3>
				<p className="mt-2 text-sm text-secondary">
					No local PCP stored. PCP creation and persistence are not connected yet; the synthetic selfie
					fixture is held only in memory.
				</p>
				<button type="button" disabled className="mt-3 min-h-10 text-red-700 opacity-50">
					Delete local PCP
				</button>
			</div>
		</section>
	)
}
