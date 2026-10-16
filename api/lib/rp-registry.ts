import { createPublicClient, http, parseAbi } from 'viem'

// World ID protocol staging deployment on World Chain (chain 480).
const registry = '0x37d2462fE7B4a07987263AAd062C6593C4f567b9'
const client = createPublicClient({
	transport: http('https://worldchain-mainnet.g.alchemy.com/public', { timeout: 10000, retryCount: 0 }),
})
const abi = parseAbi([
	'function getRp(uint64 rpId) view returns ((bool initialized, bool active, address manager, address signer, uint160 oprfKeyId, string unverifiedWellKnownDomain))',
])

export function readStagingRp(rpId: bigint) {
	return client.readContract({ address: registry, abi, functionName: 'getRp', args: [rpId] })
}
