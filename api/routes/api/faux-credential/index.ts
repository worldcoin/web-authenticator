import { boundedText, stagingIssuerGuard } from '../../../lib/staging-issuer-http';

const ISSUER = 'https://faux-issuer.us.id-infra.worldcoin.dev/issue';

export async function POST(request: Request): Promise<Response> {
  const denied = stagingIssuerGuard(request);
  if (denied) return denied;
  let sub: string;
  try {
    const body = JSON.parse(await boundedText(request.body, 1024));
    if (typeof body?.sub !== 'string' || !/^0x[0-9a-f]{64}$/.test(body.sub)) throw new Error('Invalid subject');
    sub = body.sub;
  } catch {
    return Response.json({ error: 'Expected a 32-byte lowercase hex subject.' }, { status: 400 });
  }
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  try {
    const upstream = await fetch(ISSUER, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub }),
      redirect: 'error', cache: 'no-store', signal: deadline,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      // eslint-disable-next-line no-console -- Bounded failure metadata; never log the credential or subject.
      console.warn('faux_issuer_failed', { upstreamStatus: upstream.status });
      return Response.json({ error: 'Staging Faux issuer rejected the request.' }, { status: 502 });
    }
    return new Response(await boundedText(upstream.body, 1_000_000), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    // eslint-disable-next-line no-console -- Dependency failure with no sensitive payload.
    console.warn('faux_issuer_failed', { failure: deadline.aborted ? 'aborted' : 'request_failed' });
    return Response.json({ error: 'Staging Faux issuer unavailable.' }, { status: deadline.aborted ? 504 : 502 });
  }
}
