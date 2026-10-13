import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createECDH, createPrivateKey, sign } from 'node:crypto'

export function parsePolicy(value: unknown) {
	if (!value || typeof value !== 'object') throw new Error('Invalid enclave policy')
	const policy = value as Record<string, unknown>
	if (
		policy.endpoint !== 'wss://selfie-enrollment-stage.worldcoin.dev/v1/embeddings' ||
		policy.audience !== 'selfie-enrollment-stage.worldcoin.dev' ||
		!Array.isArray(policy.releases) ||
		!policy.releases.length ||
		policy.releases.length > 8
	)
		throw new Error('Invalid staging enclave policy')
	for (const release of policy.releases) {
		if (
			!release ||
			typeof release !== 'object' ||
			!['pcr0', 'pcr1', 'pcr2', 'worker_sha384'].every(
				key =>
					typeof release[key] === 'string' &&
					/^[0-9a-f]{96}$/.test(release[key]) &&
					!/^0+$/.test(release[key])
			)
		)
			throw new Error('Invalid release measurements')
	}
	return { endpoint: policy.endpoint, audience: policy.audience, releases: policy.releases }
}

export async function loadPolicy(path: string) {
	const file = await open(path, 'r')
	try {
		if ((await file.stat()).size > 8192) throw new Error('Policy is too large')
		const buffer = Buffer.alloc(8193)
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
		if (bytesRead > 8192) throw new Error('Policy is too large')
		return parsePolicy(JSON.parse(buffer.toString('utf8', 0, bytesRead)))
	} finally {
		await file.close()
	}
}

export function parseChallenge(value: unknown, audience: string) {
	if (!value || typeof value !== 'object') throw new Error('Invalid challenge')
	const challenge = value as Record<string, unknown>
	if (
		Object.keys(challenge).sort().join(',') !== 'audience,nonce' ||
		challenge.audience !== audience ||
		!Array.isArray(challenge.nonce) ||
		challenge.nonce.length !== 32 ||
		!challenge.nonce.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
	)
		throw new Error('Invalid challenge')
	return { audience, nonce: challenge.nonce as number[] }
}

export function signChallenge(challenge: ReturnType<typeof parseChallenge>, privateHex: string, now: number) {
	if (!/^[0-9a-f]{64}$/.test(privateHex)) throw new Error('Invalid signing key')
	const ecdh = createECDH('prime256v1')
	ecdh.setPrivateKey(Buffer.from(privateHex, 'hex'))
	const publicKey = ecdh.getPublicKey()
	const key = createPrivateKey({
		format: 'jwk',
		key: {
			kty: 'EC',
			crv: 'P-256',
			d: Buffer.from(privateHex, 'hex').toString('base64url'),
			x: publicKey.subarray(1, 33).toString('base64url'),
			y: publicKey.subarray(33).toString('base64url'),
		},
	})
	const expires_at = now + 30
	const message = JSON.stringify(['selfie-enrollment/admission/v1', challenge.audience, challenge.nonce, expires_at])
	return {
		expires_at,
		signature: sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('hex'),
	}
}

export async function readSigningKey(path: string) {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const stat = await file.stat()
		if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 128) throw new Error('Invalid key file')
		// Descriptor read keeps permission checks and contents tied to the same file.
		const buffer = Buffer.alloc(129)
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
		if (bytesRead > 128) throw new Error('Invalid key file')
		return buffer.toString('utf8', 0, bytesRead).trim()
	} finally {
		await file.close()
	}
}
