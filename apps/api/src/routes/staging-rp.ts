import { createPublicClient, http, parseAbi } from 'viem'

// World ID protocol staging deployment on World Chain (chain 480).
const registry = '0x37d2462fE7B4a07987263AAd062C6593C4f567b9'
const client = createPublicClient({
	transport: http('https://worldchain-mainnet.g.alchemy.com/public', { timeout: 10000, retryCount: 0 }),
})
const abi = parseAbi([
	'function getRp(uint64 rpId) view returns ((bool initialized, bool active, address manager, address signer, uint160 oprfKeyId, string unverifiedWellKnownDomain))',
])
export async function GET(request: Request) {
	const id = new URL(request.url).searchParams.get('id')
	if (!id || !/^rp_[0-9a-f]{1,16}$/i.test(id)) return Response.json({ error: 'Invalid RP ID.' }, { status: 400 })
	try {
		const rp = await client.readContract({
			address: registry,
			abi,
			functionName: 'getRp',
			args: [BigInt('0x' + id.slice(3))],
		})
		if (!rp.initialized || !rp.active)
			return Response.json({ error: 'This RP is not active on staging.' }, { status: 422 })
		return Response.json(
			{ signer: rp.signer, oprfKeyId: `0x${rp.oprfKeyId.toString(16)}` },
			{ headers: { 'Cache-Control': 'no-store' } }
		)
	} catch {
		// eslint-disable-next-line no-console -- Operational failure; no request material.
		console.warn('staging_rp_lookup_failed', { operation: 'read_rp_registry' })
		return Response.json({ error: 'Could not validate this RP against the staging registry.' }, { status: 502 })
	}
}
