/* ============================== Email notification transport (server-only) ==============================
 * The ONE module allowed to know about the email provider (Resend —
 * https://resend.com) this app uses to send parent notification emails.
 * See api/_notificationOrchestrator.js for the decision/dedupe
 * orchestration that calls this — provider logic never leaks into that
 * file, into src/data/notificationDecision.js, or into
 * src/data/attentionSummary.js.
 *
 * Uses Node's built-in fetch against Resend's plain HTTP API directly —
 * no new npm dependency, same established convention as
 * api/_googleOAuth.js's own token-exchange calls ("Deliberately built on
 * Node's built-in crypto/fetch only — no new npm dependency"). `fetchFn`
 * is injectable for offline unit testing, mirroring that same file's
 * pattern.
 *
 * SECURITY
 *   - server-only: never imported from anything under src/, so this
 *     never reaches the browser bundle.
 *   - the provider API key is read from process.env.RESEND_API_KEY only
 *     — never hardcoded, never accepted from a caller/request.
 *   - the sender ("from") address is read from
 *     process.env.RESEND_FROM_EMAIL — also never caller/client-supplied.
 *   - the recipient ("to") is whatever the CALLER passes; this module
 *     performs no recipient trust decision of its own — see
 *     api/_notificationOrchestrator.js for why its caller only ever
 *     resolves a recipient from trusted server-side account data, never
 *     from client/request input.
 *   - plain text body only (no HTML) — nothing here ever interpolates
 *     any external content into an HTML template, so there is no
 *     HTML-injection surface in this module.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * sendParentNotificationEmail({ to, subject, text }) -> { ok: true } | { ok: false, error }
 * Never throws — a missing API key/from address, a non-2xx provider
 * response, or a network error are all reported the same way, as
 * { ok: false, error }, so a caller (processAttentionNotification) can
 * uniformly markNotificationFailed rather than needing its own try/catch
 * around a provider-specific exception shape.
 */
export async function sendParentNotificationEmail({ to, subject, text }, { fetchFn = fetch } = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not configured" };
  if (!from) return { ok: false, error: "RESEND_FROM_EMAIL is not configured" };
  if (!to || typeof to !== "string") return { ok: false, error: "A recipient email is required" };

  try {
    const res = await fetchFn(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      return { ok: false, error: `Resend request failed (${res.status}): ${errorBody.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "Resend request threw" };
  }
}
