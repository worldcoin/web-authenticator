import type { WalletKit } from '../lib/walletkit'
import { useLocalTeeConnection } from '@/hooks/useLocalTeeConnection'
import type { IncomingRequest } from '@/lib/requests/incoming-request'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

function useSessionState() {
	const tee = useLocalTeeConnection()
	const stopTee = tee.stop
	const wallet = useRef<WalletKit | null>(null)
	const [initialized, setInitialized] = useState(false)
	// Keep the decrypted request and bridge response capability across in-tab routes only.
	const [incoming, setIncoming] = useState<IncomingRequest | null>(null)
	const [shareStarted, setShareStarted] = useState(false)
	const clearRequest = useCallback(() => {
		setIncoming(null)
		setShareStarted(false)
	}, [])
	useEffect(() => {
		const close = () => {
			stopTee()
			wallet.current?.terminate()
			wallet.current = null
			setInitialized(false)
			clearRequest()
		}
		window.addEventListener('pagehide', close)
		return () => {
			window.removeEventListener('pagehide', close)
			close()
		}
	}, [clearRequest, stopTee])
	return {
		tee,
		wallet,
		initialized,
		setInitialized,
		incoming,
		setIncoming,
		shareStarted,
		setShareStarted,
		clearRequest,
	}
}
const SessionContext = createContext<ReturnType<typeof useSessionState> | null>(null)

export function AuthenticatorSession({ children }: { children: ReactNode }) {
	const session = useSessionState()
	return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export function useAuthenticatorSession() {
	const session = useContext(SessionContext)
	if (!session) throw new Error('Authenticator session provider is missing.')
	return session
}
