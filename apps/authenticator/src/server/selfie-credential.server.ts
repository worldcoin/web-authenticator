import { EnrollmentError, issueOrPollSelfie } from './selfie-issuer.server'

export async function POST(request: Request) {
	const url = new URL(request.url)
	if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || request.headers.get('origin') !== url.origin)
		return Response.json(
			{ error: 'Synthetic staging issuance is available only from this localhost authenticator.' },
			{ status: 403 }
		)
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
		return Response.json({ error: 'Expected JSON.' }, { status: 415 })
	let body: { sub: string; token: string }
	try {
		const reader = request.body?.getReader()
		if (!reader) throw new Error('Missing body')
		let text = ''
		try {
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				text += new TextDecoder().decode(value)
				if (text.length > 1024) {
					await reader.cancel()
					throw new Error('Body too large')
				}
			}
		} finally {
			reader.releaseLock()
		}
		body = JSON.parse(text)
		if (!body || typeof body.sub !== 'string' || typeof body.token !== 'string' || !/^0x[0-9a-f]{64}$/.test(body.sub) || !/^[0-9a-f]{64}$/.test(body.token))
			throw new Error('Invalid input')
	} catch {
		return Response.json({ error: 'Expected a schema-11 subject and resume token.' }, { status: 400 })
	}
	try {
		const result = await issueOrPollSelfie(
			body.sub,
			body.token,
			AbortSignal.any([request.signal, AbortSignal.timeout(170_000)])
		)
		return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
	} catch (error) {
		const status = error instanceof EnrollmentError ? error.status : 502
		// eslint-disable-next-line no-console -- Operational failure; no request or identity material.
		console.warn('staging_selfie_issuance_failed', { status, operation: 'issue_or_poll' })
		return Response.json(
			{
				error:
					error instanceof EnrollmentError
						? error.message
						: 'Staging enrollment could not complete. Retry resumes the saved operation without enrolling again.',
			},
			{ status, headers: { 'Cache-Control': 'no-store' } }
		)
	}
}
