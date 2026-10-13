/**
 * Orb Tools staging admission, not an RP proof-response integrity bundle.
 * https://github.com/worldcoin/orb-tools/blob/a5c0848d/crates/signup-flow/src/orb_enrollment_harness.rs
 * The caller must create the real multipart payload and obtain its identity proof.
 */
export function buildStagingFaceEnrollmentRequest(input: {
	identityCommitment: string
	identityProof: string
	contentType: string
	body: Uint8Array<ArrayBuffer>
	signal: AbortSignal
}): Request {
	if (typeof window !== 'undefined') throw new Error('Staging face enrollment must run on the server.')
	if (!/^0x[0-9a-f]{64}$/.test(input.identityCommitment))
		throw new Error('Expected a 32-byte hex enrollment identity commitment.')
	if (!input.identityProof || input.identityProof.length > 65_536 || /[\r\n]/.test(input.identityProof))
		throw new Error('A bounded identity-proof header is required for staging enrollment.')
	if (!/^multipart\/form-data; boundary=[A-Za-z0-9_-]{1,70}$/.test(input.contentType))
		throw new Error('Expected a multipart enrollment content type with an explicit boundary.')
	if (!input.body.byteLength || input.body.byteLength > 8 * 1024 * 1024)
		throw new Error('Enrollment payload must contain between 1 byte and 8 MiB.')
	input.signal.throwIfAborted()
	const url = new URL('https://app.stage.face.worldcoin.org/api/v1/identity')
	url.searchParams.set('idComm', input.identityCommitment)
	return new Request(url, {
		method: 'PUT',
		headers: {
			'content-type': input.contentType,
			'x-zkp-proof': input.identityProof,
			'user-agent': 'WorldApp/1.0.0 Oxide/1.0.0 iOS',
			'integrity-token': 'staging-test-token',
			'integrity-signature': 'staging-test-token',
		},
		body: input.body,
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'error',
		signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
	})
}
