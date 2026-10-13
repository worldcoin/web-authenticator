export const BRIDGE_ORIGINS = ['https://bridge.worldcoin.org', 'https://staging-bridge.worldcoin.org']
export type Connector = { requestId: string; key: Uint8Array<ArrayBuffer>; bridgeUrl: string; returnUrl?: string }

export function decodeBase64(value: unknown, maxBytes: number): Uint8Array<ArrayBuffer> {
	if (
		typeof value !== 'string' ||
		value.length > Math.ceil(maxBytes / 3) * 4 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(value)
	)
		throw new Error('Invalid bridge encoding.')
	let raw: string
	try {
		raw = atob(value)
	} catch {
		throw new Error('Invalid bridge encoding.')
	}
	if (raw.length > maxBytes) throw new Error('Bridge payload is too large.')
	return Uint8Array.from(raw, char => char.charCodeAt(0))
}
export function returnUrl(value: string | null | undefined): string | undefined {
	if (!value) return undefined
	if (value.length > 2048) throw new Error('Return URL is too long.')
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error('Invalid return URL.')
	}
	if (
		url.username ||
		url.password ||
		!(
			url.protocol === 'https:' ||
			(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
		)
	)
		throw new Error('Return URL must use HTTPS or HTTP localhost.')
	return url.href
}
export function parseConnector(href: string): Connector | null {
	const params = new URL(href).searchParams
	if (!params.has('i') && !params.has('k')) return null
	for (const name of ['i', 'k', 'b', 't', 'return_to'])
		if (params.getAll(name).length > 1) throw new Error('Duplicate connector parameters.')
	const requestId = params.get('i') ?? ''
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId) ||
		(params.has('t') && params.get('t') !== 'wld')
	)
		throw new Error('Invalid World ID connector link.')
	const key = decodeBase64(params.get('k'), 32)
	if (key.byteLength !== 32) throw new Error('The connector needs a 32-byte bridge key.')
	const bridgeUrl = (params.get('b') || BRIDGE_ORIGINS[0]).replace(/\/$/, '')
	if (!BRIDGE_ORIGINS.includes(bridgeUrl))
		throw new Error('This authenticator only accepts the official World ID bridges.')
	return { requestId, key, bridgeUrl, returnUrl: returnUrl(params.get('return_to')) }
}
