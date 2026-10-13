import { isIP } from 'node:net'

export function requestIp(headers: Pick<Headers, 'get'>) {
	// No deployment-specific trusted proxy is configured. These are observations,
	// not verified client identity; never use them for an authorization decision.
	for (const source of ['x-forwarded-for', 'x-real-ip'] as const) {
		const header = headers.get(source)
		if (!header || header.length > 1024) continue
		const candidate = header.split(',')[0].trim()
		if (isIP(candidate)) return { ip: candidate, source, verified: false as const }
	}
	return { ip: null, source: 'unavailable' as const, verified: false as const }
}
