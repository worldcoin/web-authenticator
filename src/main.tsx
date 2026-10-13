import './styles.css'
import { createRoot } from 'react-dom/client'
import SelfieDemoPage from '@/pages/SelfieDemoPage'
import AuthenticatorScreen from '@/components/AuthenticatorScreen'
import { AuthenticatorSession } from '@/components/AuthenticatorSession'
import SelfieCheckScreen from '@/components/selfie-check/SelfieCheckScreen'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'

function LegacyEntry() {
	const location = useLocation()
	return <Navigate replace to={{ pathname: '/', search: location.search, hash: location.hash }} />
}

createRoot(document.getElementById('root')!).render(
	<BrowserRouter>
		<AuthenticatorSession>
			<Routes>
				<Route path="/" element={<AuthenticatorScreen />} />
				<Route path="/verify" element={<LegacyEntry />} />
				<Route path="/selfie-check" element={<SelfieCheckScreen />} />
				<Route path="/selfie-demo" element={<SelfieDemoPage />} />
				<Route
					path="*"
					element={
						<main className="p-8">
							Page not found. <Link to="/">Open authenticator</Link>
						</main>
					}
				/>
			</Routes>
		</AuthenticatorSession>
	</BrowserRouter>
)
