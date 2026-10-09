import {
	type Authenticator,
	type CredentialStore,
	type FieldElement,
	type InitializingAuthenticator,
	type InitializeOptions as WorkerOptions,
	type WalletKit as PublishedWalletKit,
} from '@worldcoin/walletkit-web'
export type { RecoveryData, RegistrationStatus } from '@worldcoin/walletkit-web'
export type { CredentialRecord as CredentialMetadata } from '@worldcoin/walletkit-web'

export interface InitializeOptions extends WorkerOptions {
	databaseKey: Uint8Array
	storageId: string
	environment: 'staging' | 'production'
	region: 'us' | 'eu' | 'ap'
}

const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000))

/** Owns the account session; all Rust objects remain in the published worker. */
export class WalletKit {
	private authenticator?: Authenticator
	private registration?: InitializingAuthenticator

	constructor(
		private readonly client: PublishedWalletKit,
		private readonly store: CredentialStore,
		private readonly environment: InitializeOptions['environment'],
		private readonly region: InitializeOptions['region']
	) {}

	terminate() {
		this.client.terminate()
	}

	async close() {
		await this.client.close()
	}

	recoveryDataFromSeed(seed: Uint8Array) {
		return this.client.recoveryDataFromSeed(seed)
	}

	async register(seed: Uint8Array) {
		if (this.registration) throw new Error('Registration already started')
		this.registration = await this.client.InitializingAuthenticator.registerWithDefaults(
			seed,
			undefined,
			this.environment,
			this.region,
			undefined
		)
	}

	pollRegistration() {
		if (!this.registration) throw new Error('Start registration first')
		return this.registration.pollStatus()
	}

	async initializeAuthenticator(seed: Uint8Array, now = nowSeconds()) {
		if (this.authenticator) throw new Error('Authenticator already initialized')
		const artifacts = await this.client.EmbeddedZkArtifacts.new()
		let authenticator: Authenticator | undefined
		try {
			authenticator = await this.client.Authenticator.initWithDefaults(
				seed,
				undefined,
				this.environment,
				this.region,
				artifacts,
				this.store
			)
			await authenticator.initStorage(now)
			this.authenticator = authenticator
		} catch (error) {
			authenticator?.free()
			throw error
		} finally {
			artifacts.free()
		}
	}

	private currentAuthenticator() {
		if (!this.authenticator) throw new Error('Initialize the authenticator first')
		return this.authenticator
	}

	listCredentials(now = nowSeconds()) {
		this.currentAuthenticator()
		return this.store.listCredentials(undefined, now)
	}

	deleteCredential(id: bigint) {
		this.currentAuthenticator()
		return this.store.deleteCredential(id)
	}

	async prepareCredential(issuerSchemaId: bigint) {
		const authenticator = this.currentAuthenticator()
		const factor = await authenticator.generateCredentialBlindingFactorRemote(issuerSchemaId)
		let sub: FieldElement | undefined
		try {
			sub = await authenticator.computeCredentialSub(factor)
			return { blindingFactor: await factor.toHexString(), sub: await sub.toHexString() }
		} finally {
			sub?.free()
			factor.free()
		}
	}

	async storeCredential(serialized: Uint8Array, factor: string, now = nowSeconds()) {
		const authenticator = this.currentAuthenticator()
		const credential = await this.client.Credential.fromBytes(serialized)
		let blindingFactor: FieldElement | undefined
		let expectedSub: FieldElement | undefined
		let actualSub: FieldElement | undefined
		try {
			blindingFactor = await this.client.FieldElement.tryFromHexString(factor)
			expectedSub = await authenticator.computeCredentialSub(blindingFactor)
			actualSub = await credential.sub()
			if ((await expectedSub.toHexString()) !== (await actualSub.toHexString())) {
				throw new Error('Credential subject does not match this authenticator')
			}
			const issuerSchemaId = await credential.issuerSchemaId()
			const credentialId = await this.store.storeCredential(
				credential,
				blindingFactor,
				await credential.expiresAt(),
				undefined,
				now
			)
			return { credentialId, issuerSchemaId }
		} finally {
			actualSub?.free()
			expectedSub?.free()
			blindingFactor?.free()
			credential.free()
		}
	}

	async generateProof(json: string, now = nowSeconds()) {
		const authenticator = this.currentAuthenticator()
		const request = await this.client.ProofRequest.fromJson(json)
		try {
			const response = await authenticator.generateProof(request, now)
			try {
				const result = JSON.parse(await response.toJson())
				for (const item of result.responses ?? []) {
					if (String(item.issuer_schema_id) !== '11') continue
					const credential = await this.store.fetchCredential(BigInt(11), now)
					try {
						const claims = await credential?.claimsHex()
						if (!claims?.length) throw new Error('Selfie credential score is unavailable')
						// Preserve schema-11 z-score disclosure; this does not assert user presence.
						item.claims = [claims[0]]
					} finally {
						credential?.free()
					}
				}
				return JSON.stringify(result)
			} finally {
				response.free()
			}
		} finally {
			request.free()
		}
	}
}
