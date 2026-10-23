import { boundedText, stagingIssuerGuard } from '../../../lib/staging-issuer-http';
import { EnrollmentError, issueOrPollSelfie } from '../../../lib/staging-selfie-issuer';

export async function POST(request: Request): Promise<Response> {
  const denied = stagingIssuerGuard(request);
  if (denied) return denied;
  let body: { sub: string; token: string };
  try {
    body = JSON.parse(await boundedText(request.body, 1024));
    if (typeof body?.sub !== 'string' || !/^0x[0-9a-f]{64}$/.test(body.sub)
      || typeof body?.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token)) throw new Error('Invalid input');
  } catch {
    return Response.json({ error: 'Expected a schema-11 subject and resume token.' }, { status: 400 });
  }
  try {
    const result = await issueOrPollSelfie(body.sub, body.token, AbortSignal.any([request.signal, AbortSignal.timeout(170_000)]));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof EnrollmentError ? error.status : 502;
    // eslint-disable-next-line no-console -- Log status only; no enrollment material.
    console.warn('staging_selfie_issuance_failed', { status });
    return Response.json({ error: error instanceof EnrollmentError ? error.message
      : 'Staging enrollment could not complete. Retry resumes the saved operation without enrolling again.' },
    { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
