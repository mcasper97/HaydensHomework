/* ============================== Scheduled email ingestion — Cron entry point ==============================
 * The Vercel Cron-triggered HTTP endpoint (see vercel.json's `crons`
 * entry) — the smallest scheduled-function mechanism this repo's own
 * deployment stack (Vercel) already supports natively, so no new
 * platform/infrastructure was introduced (task Section 2: "Do not
 * introduce a new platform unless required").
 *
 * This file itself contains NO scheduling/business logic of its own — it
 * only (a) verifies the request genuinely came from Vercel's own Cron
 * trigger, and (b) calls api/_scheduledIngestionRunner.js's
 * runDueHouseholds(), which owns the actual due-detection/locking/
 * per-household logic. Runs once daily (see vercel.json's "0 0 * * *" —
 * the Vercel Hobby plan's once-per-day cron limit) — task Section 2
 * explicitly asks for "the smallest suitable... Avoid requiring one
 * infrastructure cron entry per household," which this satisfies: ONE
 * cron entry evaluates every enabled household on each tick, not one
 * entry per household.
 *
 * AUTH: Vercel signs every real Cron invocation with
 * `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET environment
 * variable is set (Vercel's own documented Cron-security convention —
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * This endpoint requires that header to match; a request without it (or a
 * missing CRON_SECRET configuration) is refused rather than silently
 * running an unauthenticated, uid-iterating job that reads every
 * household's schedule. This is a different trust boundary than every
 * other api/*.js endpoint in this app (requireFirebaseUser, api/_auth.js)
 * — there is no signed-in parent making this request, only Vercel's own
 * platform.
 */
import { runDueHouseholds } from "./_scheduledIngestionRunner.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("cron-email-ingestion: CRON_SECRET is not configured — refusing to run.");
    return res.status(500).json({ ok: false, error: "Scheduled ingestion is not configured on this server." });
  }
  const authHeader = req.headers?.authorization || "";
  if (authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const summary = await runDueHouseholds();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("cron-email-ingestion: runDueHouseholds threw", err);
    return res.status(500).json({ ok: false, error: "Scheduled ingestion run failed." });
  }
}
