import { createPublicClient, http, parseAbi } from 'viem'

import { ENVIRONMENTS, type ProtocolEnvironment } from '../../config/environment'

const client = createPublicClient({
	transport: http('https://worldchain-mainnet.g.alchemy.com/public', { timeout: 10000, retryCount: 0 }),
})
const abi = parseAbi([
	'function getRp(uint64 rpId) view returns ((bool initialized, bool active, address manager, address signer, uint160 oprfKeyId, string unverifiedWellKnownDomain))',
])

export function readRp(rpId: bigint, environment: ProtocolEnvironment) {
	return client.readContract({ address: ENVIRONMENTS[environment].rpRegistry, abi, functionName: 'getRp', args: [rpId] })
}
