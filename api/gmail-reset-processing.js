/* ============================== Gmail processing history reset (parent testing control) ==============================
 * Settings -> Email Import -> Testing Tools -> "Reset Email Processing
 * History". Lets a parent make previously processed Gmail messages
 * eligible to be scanned again by Check Email / automatic ingestion,
 * WITHOUT deleting any SourceRecord, Item, IngestionCandidate, or Calendar
 * record — see api/_gmailProcessingResetStore.js for the logical
 * (marker-based) reset mechanism, and api/_sourceRecordsStore.js's
 * listProcessedGmailMessageIds for how that marker is honored. This
 * endpoint itself only verifies the caller, resolves their own uid, and
 * calls that store — it never scans Gmail and never touches ingestion.
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { resetGmailProcessingHistory } from "./_gmailProcessingResetStore.js";
import { listProcessedGmailMessageIds } from "./_sourceRecordsStore.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let uid;
  try {
    // The ONLY source of uid — never req.body/req.query, so a client can
    // never point this reset at another household's data.
    ({ uid } = await requireFirebaseUser(req));
  } catch {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  if (!checkRateLimit(`gmail-reset-processing:${uid}`)) {
    return res.status(429).json({ ok: false, error: "Too many requests — please wait a few minutes and try again." });
  }

  try {
    const { resetCount } = await resetGmailProcessingHistory(uid, { getProcessedIds: listProcessedGmailMessageIds });
    return res.status(200).json({ ok: true, resetCount });
  } catch (err) {
    console.error("gmail-reset-processing error:", err);
    return res.status(500).json({ ok: false, error: "Could not reset email processing history. Please try again." });
  }
}
