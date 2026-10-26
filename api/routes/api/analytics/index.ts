import { ANALYTICS_BATCH_SIZE, ANALYTICS_BODY_LIMIT, isAnalyticsEvent } from "../../../../packages/contracts/src/analytics";
import { createAnalyticsSink, type AnalyticsSink } from "../../../lib/analytics";
import { effectiveConsent } from "../../../lib/consent";

export function createAnalyticsHandler(sink: AnalyticsSink | null = createAnalyticsSink()) {
  let active = 0;
  return async (request: Request): Promise<Response> => {
    if (effectiveConsent(request) !== "granted" || request.headers.get("sec-fetch-site") !== "same-origin" ||
      request.headers.get("origin") !== new URL(request.url).origin ||
      request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
      return new Response(null, { status: 403 });
    }
    if (!sink) return new Response(null, { status: 204 });
    if (active >= 4) return new Response(null, { status: 429 });
    active++;
    try {
      const reader = request.body?.getReader();
      if (!reader) return new Response(null, { status: 400 });
      const chunks: Uint8Array[] = [];
      let size = 0;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 2_000);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > ANALYTICS_BODY_LIMIT) { await reader.cancel(); return new Response(null, { status: 413 }); }
          chunks.push(value);
        }
      } finally { clearTimeout(timeout); reader.releaseLock(); }
      if (timedOut) return new Response(null, { status: 408 });
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let body: unknown;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return new Response(null, { status: 400 }); }
      if (!Array.isArray(body) || body.length === 0 || body.length > ANALYTICS_BATCH_SIZE || !body.every(isAnalyticsEvent)) {
        return new Response(null, { status: 400 });
      }
      await sink(body);
      return new Response(null, { status: 204 });
    } catch {
      // Never log request material, upstream bodies or credentials.
      return new Response(null, { status: 503 });
    } finally { active--; }
  };
}
