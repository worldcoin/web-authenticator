import { join } from 'node:path'
import { homedir } from 'node:os'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { createPublicClient, http, parseAbi } from 'viem'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'

const FACE = 'https://app.stage.face.worldcoin.org'
const UA = 'WorldApp/1.0.0 Oxide/1.0.0 iOS'
const HELPER = process.env.STAGING_FACE_HELPER ?? join(process.cwd(), 'services/staging-issuance/face-enrollment-helper/target/debug/staging-face-crypto')
const ROOT = process.env.STAGING_SELFIE_STATE_DIR ?? join(homedir(), '.local/state/web-authenticator/synthetic-selfie-issuance')
const VERIFIER = '0x703a6316c975DEabF30b637c155edD53e24657DB'
const client = createPublicClient({
	transport: http('https://worldchain-mainnet.g.alchemy.com/public', { timeout: 20_000, retryCount: 0 }),
})
const abi = parseAbi([
	'function getCredentialSchemaIssuerRegistry() view returns (address)',
	'function issuerSchemaIdToPubkey(uint64) view returns ((uint256 x, uint256 y))',
])

type Operation = {
	version: 1
	commitmentEncoding?: 'hex'
	sub: string
	tokenHash: string
	seed: string
	captureId: string
	phase: 'prepared' | 'submitting' | 'submitted' | 'rejected'
	rejection?: number
}
export class EnrollmentError extends Error {
	constructor(
		message: string,
		public status = 502
	) {
		super(message)
	}
}

// Bound local cryptographic work. Persisted submission state also prevents a
// restarted process from re-enrolling an operation with an unknown outcome.
let busy = false
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

async function cryptoHelper<T>(input: object, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted()
	return new Promise((resolve, reject) => {
		const child = execFile(HELPER, [], { timeout: 90_000, maxBuffer: 262_144, signal }, (error, stdout) => {
			if (error) return reject(new EnrollmentError('The local staging cryptography helper failed or timed out.'))
			try {
				resolve(JSON.parse(stdout) as T)
			} catch {
				reject(new EnrollmentError('The staging cryptography helper returned an invalid response.'))
			}
		})
		// Secrets travel over stdin, never process arguments or logs.
		child.stdin?.on('error', () => {
			/* execFile reports process/pipe failure through its callback. */
		})
		child.stdin?.end(JSON.stringify(input))
	})
}

async function boundedText(response: Response, limit: number): Promise<string> {
	if (!response.body) throw new EnrollmentError('Staging returned an empty response.')
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) return Buffer.concat(chunks).toString('utf8')
			length += value.length
			if (length > limit) {
				await reader.cancel()
				throw new EnrollmentError('Staging response exceeded its size limit.')
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}
}
async function remote(path: string, init: RequestInit, signal: AbortSignal) {
	return fetch(path, {
		...init,
		cache: 'no-store',
		redirect: 'error',
		signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
	})
}
async function auth(operation: Operation, kind: 'getidentity' | 'usercentricenrollment', signal: AbortSignal) {
	const result = await cryptoHelper<{ identityCommitment: string; header: string }>(
		{
			operation: 'authenticate',
			seed: operation.seed,
			kind,
		},
		signal
	)
	if (!/^0x[0-9a-f]{64}$/.test(result.identityCommitment))
		throw new EnrollmentError(
			'The enrollment helper returned an invalid identity commitment. Rebuild it before retrying.',
			503
		)
	return result
}
async function save(path: string, operation: Operation) {
	const temporary = `${path}.${randomUUID()}.tmp`
	await writeFile(temporary, JSON.stringify(operation), { mode: 0o600, flag: 'wx' })
	await rename(temporary, path)
}

export async function issueOrPollSelfie(sub: string, token: string, signal: AbortSignal) {
	if (busy) throw new EnrollmentError('A staging enrollment operation is already running. Try again shortly.', 409)
	busy = true
	try {
		try {
			await access(HELPER, constants.X_OK)
		} catch {
			throw new EnrollmentError(
				'Build the local staging helper with bun run build:selfie-helper before issuing.',
				503
			)
		}
		await mkdir(ROOT, { recursive: true, mode: 0o700 })
		const path = join(ROOT, `${hash(sub)}.json`)
		let operation: Operation
		try {
			operation = JSON.parse(await readFile(path, 'utf8')) as Operation
			if (operation.version !== 1 || operation.sub !== sub || operation.tokenHash !== hash(token))
				throw new EnrollmentError(
					'An enrollment already exists for this subject, but its resume token is unavailable. No new enrollment was submitted.',
					409
				)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
			operation = {
				version: 1,
				commitmentEncoding: 'hex',
				sub,
				tokenHash: hash(token),
				seed: randomBytes(32).toString('hex'),
				captureId: randomUUID(),
				phase: 'prepared',
			}
			await save(path, operation)
		}
		// The original helper sent decimal idComm, which the handler rejects
		// before storing enrollment. Only that explicit 400 can be retried after
		// this encoding fix; ambiguous submissions remain poll-only.
		if (!operation.commitmentEncoding && operation.phase === 'rejected' && operation.rejection === 400) {
			operation.commitmentEncoding = 'hex'
			operation.phase = 'prepared'
			delete operation.rejection
			await save(path, operation)
		}
		if (operation.phase === 'rejected')
			throw new EnrollmentError(
				`Staging rejected this enrollment (HTTP ${operation.rejection}). It will not be resubmitted.`,
				422
			)
		if (operation.phase === 'prepared') {
			operation.commitmentEncoding = 'hex'
			const keys = await Promise.all(
				[0, 1, 2].map(async index => {
					const response = await remote(
						`https://pki-face-ampc-stage.worldcoin.dev/public-key-${index}`,
						{},
						signal
					)
					if (!response.ok) {
						await response.body?.cancel()
						throw new EnrollmentError(`Staging share-key download failed (HTTP ${response.status}).`)
					}
					return boundedText(response, 1024)
				})
			)
			const { shares } = await cryptoHelper<{ shares: string[] }>(
				{ operation: 'shares', public_keys: keys },
				signal
			)
			if (shares.length !== 3 || shares.some(share => typeof share !== 'string' || share.length > 16_384))
				throw new EnrollmentError('Invalid encrypted shares.')
			const proof = await auth(operation, 'usercentricenrollment', signal)
			const body = new FormData()
			const fields = {
				capture_id: operation.captureId,
				timestamp: Math.floor(Date.now() / 1000).toString(),
				face_embedding_shares_0: shares[0],
				face_embedding_shares_1: shares[1],
				face_embedding_shares_2: shares[2],
				face_embedding_version: '2.0.0',
				face_embedding_type: 'ghostfacenet_flipped_mean',
				face_embedding_inference_backend: 'face-engine',
				pcp_version: '2.5',
				sub,
				// Orb Tools staging fixture: no recoverable PCP and no attested hash binding.
				associated_data_hash: `0x${randomBytes(31).toString('hex').padStart(64, '0')}`,
			}
			for (const [key, value] of Object.entries(fields)) body.set(key, value)
			signal.throwIfAborted()
			operation.phase = 'submitting'
			await save(path, operation)
			const response = await remote(
				`${FACE}/api/v1/identity?idComm=${encodeURIComponent(proof.identityCommitment)}`,
				{
					method: 'PUT',
					body,
					headers: {
						'user-agent': UA,
						'x-zkp-proof': proof.header,
						'integrity-token': 'staging-test-token',
						'integrity-signature': 'staging-test-token',
					},
				},
				signal
			)
			await response.body?.cancel()
			if (!response.ok) {
				if (response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)) {
					operation.phase = 'rejected'
					operation.rejection = response.status
					await save(path, operation)
				}
				throw new EnrollmentError(
					operation.phase === 'rejected'
						? `Staging rejected the enrollment request (HTTP ${response.status}). No credential was issued; the request needs correcting before another submission.`
						: `Staging enrollment returned HTTP ${response.status}. Retry checks the saved operation; it does not submit again.`,
					operation.phase === 'rejected' ? 422 : 502
				)
			}
			operation.phase = 'submitted'
			await save(path, operation)
			return { status: 'pending' as const, stage: 'Enrollment submitted. Waiting for staging issuance…' }
		}
		const proof = await auth(operation, 'getidentity', signal)
		const response = await remote(
			`${FACE}/api/v1/identity?idComm=${encodeURIComponent(proof.identityCommitment)}`,
			{ headers: { 'user-agent': UA, 'x-zkp-proof': proof.header } },
			signal
		)
		if (!response.ok) {
			await response.body?.cancel()
			throw new EnrollmentError(
				`Staging enrollment status failed (HTTP ${response.status}). Retry resumes the same operation.`
			)
		}
		const result = JSON.parse(await boundedText(response, 131_072))
		const enrollment = result.enrollment_status
		if (!enrollment || enrollment.capture_id !== operation.captureId)
			return {
				status: 'pending' as const,
				stage: 'Waiting for this capture. No duplicate enrollment will be submitted.',
			}
		if (['ENROLLMENT_FAILED', 'ENROLLMENT_NOT_UNIQUE'].includes(enrollment.status))
			throw new EnrollmentError(
				`Staging enrollment finished with ${enrollment.status}. No credential was stored.`,
				422
			)
		if (enrollment.status === 'ENROLLMENT_IN_PROGRESS')
			return { status: 'pending' as const, stage: 'Staging is processing the synthetic enrollment…' }
		if (
			enrollment.status !== 'ENROLLMENT_UNIQUE_SUCCESSFUL' ||
			typeof enrollment.credential !== 'string' ||
			!/^[A-Za-z0-9+/]+={0,2}$/.test(enrollment.credential) ||
			enrollment.credential.length > 90_000
		)
			throw new EnrollmentError('Staging returned an invalid credential issuance response.')
		if ((await client.getChainId()) !== 480) throw new EnrollmentError('Unexpected staging verifier chain.')
		const registry = await client.readContract({
			address: VERIFIER,
			abi,
			functionName: 'getCredentialSchemaIssuerRegistry',
		})
		const key = await client.readContract({
			address: registry,
			abi,
			functionName: 'issuerSchemaIdToPubkey',
			args: [BigInt(11)],
		})
		const verification = await cryptoHelper<{ verified: boolean }>(
			{
				operation: 'verify',
				credential: enrollment.credential,
				sub,
				public_key: [key.x.toString(), key.y.toString()],
			},
			signal
		)
		if (verification.verified !== true)
			throw new EnrollmentError('Staging credential signature verification failed.')
		return { status: 'issued' as const, credential: enrollment.credential }
	} finally {
		busy = false
	}
}
