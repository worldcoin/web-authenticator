import { createPublicClient, http, parseAbi } from 'viem'

import type { ProtocolEnvironment } from '../../packages/contracts/src/deployment'

// World ID protocol RP registries on World Chain (chain 480).
// Source: world-id-deploy/developer-portal/stacks/web/parameters.ts.
export const RP_REGISTRIES = {
  staging: '0x37d2462fE7B4a07987263AAd062C6593C4f567b9',
  production: '0xD9A213A92Bca460D56cDbBF4d775b48fB5925BbC',
} as const
const client = createPublicClient({
	transport: http('https://worldchain-mainnet.g.alchemy.com/public', { timeout: 10000, retryCount: 0 }),
})
const abi = parseAbi([
	'function getRp(uint64 rpId) view returns ((bool initialized, bool active, address manager, address signer, uint160 oprfKeyId, string unverifiedWellKnownDomain))',
])

export function readRp(rpId: bigint, environment: ProtocolEnvironment) {
	return client.readContract({ address: RP_REGISTRIES[environment], abi, functionName: 'getRp', args: [rpId] })
}
