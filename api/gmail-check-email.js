/* ============================== Gmail — Check Email (shell) ==============================
 * Manual, parent-triggered action (#26, Commit 4). This is deliberately a
 * SHELL: it validates the two real preconditions actual email reading will
 * need — a live Gmail connection and at least one approved sender — and
 * reports the lookback window that will be used, but does NOT call the
 * Gmail API to list or read any message yet. No inbox extraction, no
 * message fetching, no cron/background polling — all of that is explicitly
 * out of scope for this commit (see the ingestion plan). This exists so
 * the button, its auth/validation path, and the lookback constant are all
 * real and wired end-to-end, ready for a later commit to slot the actual
 * Gmail API call in behind the same validated preconditions.
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { getGmailConnection } from "./_gmailConnectionsStore.js";
import { listApprovedSenderEmails } from "./_gmailApprovedSendersStore.js";

// How far back email checking will look once reading is implemented.
// Exported (pure, no I/O) so this exact windowing logic can be unit tested.
export const LOOKBACK_DAYS = 14;

export function computeLookbackSinceIso(days = LOOKBACK_DAYS, nowMs = Date.now()) {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

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
    const connection = await getGmailConnection(uid);
    if (!connection?.refreshToken) {
      return res.status(409).json({ ok: false, error: "Gmail is not connected yet." });
    }

    const senderEmails = await listApprovedSenderEmails(uid);
    if (senderEmails.length === 0) {
      return res.status(409).json({ ok: false, error: "Add at least one approved sender first." });
    }

    return res.status(200).json({
      ok: true,
      ready: true,
      connectedEmail: connection.emailAddress || null,
      senderCount: senderEmails.length,
      lookbackDays: LOOKBACK_DAYS,
      sinceIso: computeLookbackSinceIso(),
    });
  } catch (err) {
    console.error("gmail-check-email error:", err);
    return res.status(500).json({ ok: false, error: "Could not check email. Please try again." });
  }
}
