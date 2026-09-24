/* ============================== Email ingestion — "Run automatic check now" ==============================
 * The parent-triggered manual-validation endpoint for Settings' Automatic
 * Email Checking section (see src/settings/AutomaticEmailCheckingSection.jsx).
 * Invokes the EXACT SAME server-side household ingestion path the daily
 * Vercel Cron uses — api/_scheduledIngestionRunner.js's
 * executeHouseholdIngestionRun (acquire lease -> runHouseholdEmailIngestion
 * -> release lease with status), never a second/duplicated execution path,
 * and never the client/manual "Check Email" implementation
 * (api/gmail-check-email.js / src/GmailCheckEmailAction.jsx), which writes
 * SourceRecords/candidates client-side and has no server-side lease at
 * all — a different flow entirely.
 *
 * AUTH: a completely different trust boundary than api/cron-email-ingestion.js.
 * That endpoint verifies Vercel's own Cron-only bearer secret (no signed-in
 * user exists for a Cron invocation) — a secret this file never reads,
 * checks, or references anywhere, so it can never leak to or be required
 * by the browser through this path. This endpoint is the opposite: a real
 * signed-in parent, verified via requireFirebaseUser (api/_auth.js) — the
 * SAME convention every other authenticated api/*.js endpoint in this app
 * already uses (see api/gmail-check-email.js).
 *
 * SCOPE: `uid` comes ONLY from the verified ID token — this file never
 * reads a uid from the request body/query, so there is no code path here
 * that could let a signed-in parent trigger ingestion for any household
 * but their own (same structural guarantee api/_itemsStore.js's own doc
 * comment describes for its own functions).
 *
 * DUE-DECISION BYPASS (task Section 2/4): unlike the daily cron, this
 * endpoint does NOT call the scheduler's own due-decision function — a
 * manual run is explicitly allowed to execute even if today's automatic
 * run already happened, without needing the household's
 * emailIngestionSchedule.enabled to be true at all (useful for testing/
 * troubleshooting before ever turning the toggle on). It still goes
 * through the exact same atomic tryAcquireEmailIngestionLock/
 * releaseEmailIngestionLock lease pair the scheduler uses, via the shared
 * executeHouseholdIngestionRun — so a concurrent cron run (or a second
 * manual click) for the same household is still refused with
 * "already_running", never processed twice at once.
 *
 * BOOKKEEPING: a manual run passes recordAutomaticRunStatus: false to
 * executeHouseholdIngestionRun, so a successful (or failed) manual run
 * does NOT write emailIngestionSchedule.lastRunStatus/lastRunAt/
 * lastRunLocalDate — those fields, and the "Last automatic check" display
 * they feed, are reserved for the daily cron's own runs. A manual run
 * therefore never consumes today's same-day slot and never causes the
 * daily cron to skip this household. The lease itself is still acquired
 * and released exactly as the cron does (see DUE-DECISION BYPASS above),
 * so overlap protection is unaffected — only the persisted bookkeeping
 * write is skipped. The run's real success/failure is still returned
 * synchronously in the HTTP response for the caller's immediate feedback;
 * it is simply never persisted as a distinct "last manual run" record
 * (no lastManualRunAt/status field exists yet — out of this task's scope).
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { getHouseholdTimezone, tryAcquireEmailIngestionLock, releaseEmailIngestionLock } from "./_householdProfileStore.js";
import { householdTodayStr } from "../src/data/householdTimezone.js";
import { executeHouseholdIngestionRun } from "./_scheduledIngestionRunner.js";
import { runHouseholdEmailIngestion } from "./_gmailIngestionRunner.js";

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
    const now = new Date();
    const timezone = await getHouseholdTimezone(uid);
    const todayLocalDate = householdTodayStr(timezone, now);
    const nowIso = now.toISOString();

    const result = await executeHouseholdIngestionRun(uid, {
      todayLocalDate,
      nowIso,
      now,
      tryAcquireLock: tryAcquireEmailIngestionLock,
      releaseLock: releaseEmailIngestionLock,
      runIngestion: runHouseholdEmailIngestion,
      recordAutomaticRunStatus: false,
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("email-ingestion-run-now error:", err);
    return res.status(500).json({ ok: false, error: "Could not run automatic email checking. Please try again." });
  }
}
