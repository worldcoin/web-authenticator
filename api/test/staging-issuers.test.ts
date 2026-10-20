import { expect, spyOn, test } from 'bun:test';
import { POST as faux } from '../routes/api/faux-credential';
import { POST as selfie } from '../routes/api/selfie-credential';
import * as issuer from '../lib/staging-selfie-issuer';
import { createRoutes } from '../routes';

const sub = '0x' + 'a'.repeat(64);
const token = 'b'.repeat(64);
const request = (body: unknown, origin = 'http://localhost:4173', url = 'http://localhost:4173/api/faux-credential') => new Request(url, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('synthetic routes require explicit server opt-in', () => {
  const normal = createRoutes({ staticRoot: '/tmp' });
  expect(normal['/api/faux-credential']).toBeUndefined();
  expect(normal['/api/selfie-credential']).toBeUndefined();
  const local = createRoutes({ staticRoot: '/tmp', stagingIssuers: true });
  expect(local['/api/faux-credential']).toBeDefined();
  expect(local['/api/selfie-credential']).toBeDefined();
});

test('both issuers reject non-local origins, cross-origin calls, and malformed input before dependency calls', async () => {
  for (const handler of [faux, selfie]) {
    expect((await handler(request({ sub, token }, 'https://other.example'))).status).toBe(403);
    expect((await handler(request({ sub, token }, 'https://app.example', 'https://app.example/api/faux-credential'))).status).toBe(403);
    expect((await handler(request({ sub: ['not a subject'], token }))).status).toBe(400);
    expect((await handler(request({ sub, token, padding: 'x'.repeat(1024) }))).status).toBe(400);
  }
  expect((await selfie(request({ sub, token: [] }))).status).toBe(400);
});

test('Faux proxy preserves credential bytes and bounds the upstream request', async () => {
  const body = '{"credential":{"id":90071992547409931234}}';
  const remote = spyOn(globalThis, 'fetch').mockImplementation((async (url: RequestInfo | URL, options?: RequestInit) => {
    expect(url).toBe('https://faux-issuer.us.id-infra.worldcoin.dev/issue');
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeDefined();
    return new Response(body);
  }) as typeof fetch);
  try {
    const response = await faux(request({ sub }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
  } finally { remote.mockRestore(); }
});

test('Faux upstream failure returns a bounded error without echoing the remote body', async () => {
  const remote = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private upstream data', { status: 500 }));
  try {
    const response = await faux(request({ sub }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private upstream data');
  } finally { remote.mockRestore(); }
});

test('Selfie endpoint preserves the retry capability and reports recoverable failures', async () => {
  const operation = spyOn(issuer, 'issueOrPollSelfie').mockImplementation(async (actualSub, actualToken) => {
    expect(actualSub).toBe(sub);
    expect(actualToken).toBe(token);
    throw new issuer.EnrollmentError('Helper unavailable', 503);
  });
  try {
    const response = await selfie(request({ sub, token }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Helper unavailable' });
  } finally { operation.mockRestore(); }
});
