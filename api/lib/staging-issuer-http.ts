/** Synthetic issuers are explicitly enabled on the server and restricted to loopback origins. */
export function stagingIssuerGuard(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || request.headers.get('origin') !== url.origin) {
    return Response.json({ error: 'Staging issuers require a same-origin localhost request.' }, { status: 403 });
  }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 });
  }
}

export async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) throw new Error('Missing response body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Issuer payload exceeds its size limit'); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
