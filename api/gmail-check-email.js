/* ============================== Gmail — Check Email ==============================
 * Manual, parent-triggered action (#26, Commit 5; Google Doc retrieval
 * added in Commit 6). Thin HTTP wrapper around
 * api/_gmailIngestionCore.js's scanApprovedSenderEmails — the actual
 * pipeline (Gmail auth/token handling, approved-sender filtering,
 * sender->child mapping, link discovery, webpage/Google-Doc fetching,
 * obligation extraction) was extracted there so the automatic scheduled-
 * ingestion runner (api/_gmailIngestionRunner.js) could reuse it unchanged
 * rather than duplicating it. This file's own behavior — status codes,
 * error messages, and response shape — is unchanged from before that
 * extraction.
 *
 * It still ends exactly where api/extract-obligations.js does: validated,
 * sanitized extraction results, one entry per qualifying email. It does
 * NOT create any SourceRecord or IngestionCandidate itself for THIS
 * (manual) path — that write, and the mandatory parent review before
 * anything becomes a canonical Item, both stay entirely client-side (see
 * src/GmailCheckEmailAction.jsx), mirroring the existing photo-ingestion
 * flow. (The automatic scheduled path is different: api/_gmailIngestionRunner.js
 * persists server-side, with no parent review step, gated by confidence —
 * see that file.)
 *
 * Scope: 14-day lookback, exact approved senders only, normal webpages,
 * and docs.google.com/document/... Google Docs retrieved only via their
 * anonymous public export (see api/_googleDocFetch.js) — no Drive OAuth,
 * no Sheets/Slides/Drive-folder support, no attachments, no
 * cron/background polling, no automatic Item creation (from THIS path).
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { scanApprovedSenderEmails, SCAN_ERROR_CODES, LOOKBACK_DAYS, computeLookbackSinceIso } from "./_gmailIngestionCore.js";

// Re-exported unchanged — tests/gmail-approved-senders.unit.mjs imports
// these directly from this file; the pure windowing logic itself now
// lives in api/_gmailIngestionCore.js (shared with the scheduled runner)
// but this endpoint's own public surface is unchanged.
export { LOOKBACK_DAYS, computeLookbackSinceIso };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let uid;
  try {
    ({ uid } = await requireFirebaseUser(req));
  } catch {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  if (!checkRateLimit(uid)) {
    return res.status(429).json({ ok: false, error: "Too many requests — please wait a few minutes and try again." });
  }

  try {
    const scan = await scanApprovedSenderEmails(uid);

    if (!scan.ok) {
      const status = scan.code === SCAN_ERROR_CODES.UNREACHABLE ? 502 : 409;
      return res.status(status).json({
        ok: false,
        error: scan.error,
        ...(scan.needsReconnect ? { needsReconnect: true } : {}),
      });
    }

    return res.status(200).json({
      ok: true,
      connectedEmail: scan.connectedEmail,
      senderCount: scan.senderCount,
      lookbackDays: scan.lookbackDays,
      sinceIso: scan.sinceIso,
      results: scan.results,
    });
  } catch (err) {
    console.error("gmail-check-email error:", err);
    return res.status(500).json({ ok: false, error: "Could not check email. Please try again." });
  }
}
