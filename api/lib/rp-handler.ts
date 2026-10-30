import { readRp } from './rp-registry'

import type { ProtocolEnvironment } from '../../packages/contracts/src/deployment'

export async function lookupRp(request: Request, environment: ProtocolEnvironment) {
	const id = new URL(request.url).searchParams.get('id')
	if (!id || !/^rp_[0-9a-f]{1,16}$/i.test(id)) return Response.json({ error: 'Invalid RP ID.' }, { status: 400 })
	try {
		const rp = await readRp(BigInt('0x' + id.slice(3)), environment)
		if (!rp.initialized || !rp.active)
			return Response.json({ error: `This RP is not active on ${environment}.` }, { status: 422 })
		return Response.json(
			{ signer: rp.signer, oprfKeyId: `0x${rp.oprfKeyId.toString(16)}` },
			{ headers: { 'Cache-Control': 'no-store' } }
		)
	} catch {
		// eslint-disable-next-line no-console -- Operational failure; no request material.
		console.warn('rp_lookup_failed', { operation: 'read_rp_registry' })
		return Response.json({ error: `Could not validate this RP against the ${environment} registry.` }, { status: 502 })
	}
}
