import { requestIp } from '@/lib/request-ip'

export function GET(request: Request) {
	return Response.json(requestIp(request.headers), { headers: { 'Cache-Control': 'no-store' } })
}
