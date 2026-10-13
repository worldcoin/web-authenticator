import { requestDemoToken } from '@/lib/tee-admission'
import { useCallback, useEffect, useRef, useState } from 'react'
import { connect, type ConnectionPreparation } from '@/lib/tee-connection'

/** Keeps an in-flight admission request across the button-to-camera navigation. */
export function useLocalTeeConnection() {
	const operation = useRef<AbortController | null>(null)
	const [pending, setPending] = useState(false)
	const [logs, setLogs] = useState<{ time: string; message: string }[]>([])
	const [result, setResult] = useState<ConnectionPreparation>({
		status: 'unavailable',
		reason: 'TEE: not connected. Upload disabled.',
	})
	const log = useCallback((message: string) => {
		setLogs(entries => [...entries, { time: new Date().toLocaleTimeString(), message }].slice(-50))
	}, [])
	const stop = useCallback(() => {
		if (operation.current) {
			operation.current.abort()
			operation.current = null
			log('Connection attempt cancelled.')
		}
		setPending(false)
		setResult({ status: 'unavailable', reason: 'TEE: not connected. Upload disabled.' })
	}, [log])
	const start = useCallback(() => {
		if (operation.current) return
		const controller = new AbortController()
		operation.current = controller
		setPending(true)
		setResult({ status: 'unavailable', reason: 'Connecting to local TEE… Upload disabled.' })
		log('Requesting the demo token from the local admission provider.')
		void requestDemoToken(controller.signal)
			.then(token => {
				controller.signal.throwIfAborted()
				log('Demo token provisioned. Starting POST /v1/connect.')
				return connect(controller.signal, token)
			})
			.then(next => {
				if (!controller.signal.aborted) {
					setResult(next)
					log(`${next.httpStatus ? `HTTP ${next.httpStatus} · ` : ''}${next.reason}`)
				}
			})
			.catch(error => {
				if (!controller.signal.aborted) {
					const reason = error instanceof Error ? error.message : 'Local TEE connection failed.'
					setResult({ status: 'unavailable', reason })
					log(reason)
				}
			})
			.finally(() => {
				if (operation.current === controller) {
					operation.current = null
					setPending(false)
				}
			})
	}, [log])
	useEffect(() => () => operation.current?.abort(), [])
	useEffect(() => {
		if (result.status !== 'connected') return
		const timer = setTimeout(
			() => {
				const reason = 'Local token expired. Reconnect with a new token. Upload disabled.'
				setResult({ status: 'forbidden', reason })
				log(reason)
			},
			Math.max(0, result.expiresAt - Date.now())
		)
		return () => clearTimeout(timer)
	}, [result, log])
	return { start, stop, pending, result, logs }
}
