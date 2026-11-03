import { ANALYTICS_BATCH_SIZE, ANALYTICS_BODY_LIMIT, isAnalyticsEvent } from "../../../../packages/contracts/src/analytics";
import { CONSENT_VERSION } from "../../../../packages/contracts/src/consent";
import { createAnalyticsSink, type AnalyticsSink } from "../../../lib/analytics";

export function createAnalyticsHandler(sink?: AnalyticsSink | null) {
  let active = 0;
  return async (request: Request): Promise<Response> => {
    // Consent lives in localStorage (#25). Require an explicit assertion on every batch;
    // this is a client declaration, not a server-verified record of the stored preference.
    if (request.headers.get("x-analytics-consent") !== `${CONSENT_VERSION}.granted` ||
      request.headers.get("sec-fetch-site") !== "same-origin" ||
      request.headers.get("origin") !== new URL(request.url).origin ||
      request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
      return new Response(null, { status: 403 });
    }
    if (active >= 4) return new Response(null, { status: 429 });
    active++;
    try {
      const reader = request.body?.getReader();
      if (!reader) return new Response(null, { status: 400 });
      const chunks: Uint8Array[] = [];
      let size = 0;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        // Cancellation errors during timeout cleanup do not change the 408 response.
        void reader.cancel().catch(() => {});
      }, 2_000);
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
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)); }
      catch { return new Response(null, { status: 400 }); }
      if (!Array.isArray(body) || body.length === 0 || body.length > ANALYTICS_BATCH_SIZE || !body.every(isAnalyticsEvent)) {
        return new Response(null, { status: 400 });
      }
      // Resolve inside the request: a bad optional configuration only degrades analytics.
      const forward = sink === undefined ? createAnalyticsSink() : sink;
      if (forward) await forward(body);
      return new Response(null, { status: 204 });
    } catch {
      // eslint-disable-next-line no-console -- Bounded operation name without request or exception contents.
      console.warn("analytics_batch_failed");
      return new Response(null, { status: 503 });
    } finally { active--; }
  };
}
