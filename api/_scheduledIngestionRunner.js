/* ============================== Scheduled email-ingestion runner (server-only) ==============================
 * The scheduler FRAMEWORK invoked by api/cron-email-ingestion.js (a
 * Vercel Cron-triggered endpoint — see vercel.json, now a single daily
 * "0 0 * * *" tick to fit Vercel Hobby's once-per-day cron limit). Its
 * only responsibilities, per the task spec, are:
 *   1. identify enabled households
 *   2. determine whether each is already accounted for today (same-day
 *      duplicate guard) or mid-run (lease/overlap guard) — NOT a specific
 *      local time-of-day; with only one daily tick there is nothing to
 *      wait for (see src/data/emailIngestionSchedule.js's own doc comment
 *      on isHouseholdRunDue)
 *   3. invoke the existing server-side email ingestion path
 *   4. record basic run status
 *
 * It deliberately contains NO extraction, confidence, candidate-commit,
 * Review Inbox, or Calendar business logic itself — those all already
 * exist elsewhere (api/_emailExtraction.js, src/data/autoCommitDecision.js,
 * src/data/ingestionFinalization.js, api/_scheduledIngestionAdapter.js)
 * and this file never reimplements any of them.
 *
 * THE SEAM (runDueHouseholds's default `runIngestion` below) is
 * api/_gmailIngestionRunner.js's runHouseholdEmailIngestion — the real
 * server-side Gmail-fetch + extract + persist + finalize pipeline (see
 * that file's own doc comment for exactly what it does and its one
 * disclosed scope limitation). This file's own due-detection/locking/
 * status-recording framework did not change to wire it in — `runIngestion`
 * was always called as `runIngestion(uid)` and still is.
 */
import {
  listHouseholdsWithEmailIngestionEnabled,
  tryAcquireEmailIngestionLock,
  releaseEmailIngestionLock,
} from "./_householdProfileStore.js";
import { isHouseholdRunDue } from "../src/data/emailIngestionSchedule.js";
import { householdTodayStr } from "../src/data/householdTimezone.js";
import { runHouseholdEmailIngestion } from "./_gmailIngestionRunner.js";

export const RUN_STATUS = { SUCCESS: "success", FAILED: "failed" };

/**
 * runDueHouseholds({ now?, deps? }) -> { checked, results: [...] }
 * The top-level entry point api/cron-email-ingestion.js calls on every
 * Cron tick. `now` is injectable (defaults to `new Date()`) purely for
 * deterministic tests. `deps` lets tests override any of the four
 * collaborators below without touching real Firestore/timezone I/O —
 * mirrors the same injected-dependency pattern already established by
 * src/data/ingestionFinalization.js's finalizeExtractedCandidate and
 * api/_scheduledIngestionAdapter.js's finalizeCandidateServerSide.
 *
 * Each household is evaluated/run independently inside its own
 * try/catch — task Section 6: "one household failure must not prevent
 * other households from being evaluated."
 */
export async function runDueHouseholds({ now = new Date(), deps = {} } = {}) {
  const {
    listHouseholds = listHouseholdsWithEmailIngestionEnabled,
    tryAcquireLock = tryAcquireEmailIngestionLock,
    releaseLock = releaseEmailIngestionLock,
    runIngestion = runHouseholdEmailIngestion,
  } = deps;

  const households = await listHouseholds();
  const results = [];

  for (const { uid, schedule, timezone } of households) {
    try {
      const nowIso = now.toISOString();
      const todayLocalDate = householdTodayStr(timezone, now);
      const decision = isHouseholdRunDue({ schedule, todayLocalDate, nowIso });

      if (!decision.due) {
        results.push({ uid, ran: false, reason: decision.reason });
        continue;
      }

      const acquired = await tryAcquireLock(uid, { now });
      if (!acquired) {
        // Overlap protection (task Section 4) — another invocation is
        // already processing this household (an unexpired lease, per the
        // Section-4-follow-up expiring-lease correction — see
        // src/data/emailIngestionSchedule.js's EMAIL_INGESTION_LOCK_LEASE_MS);
        // never start a second one.
        results.push({ uid, ran: false, reason: "already_running" });
        continue;
      }

      try {
        const outcome = await runIngestion(uid);
        const status = outcome?.ok ? RUN_STATUS.SUCCESS : RUN_STATUS.FAILED;
        // Only a genuine success consumes today's single-run slot — see
        // releaseEmailIngestionLock's own doc comment on why a failure
        // omits lastRunLocalDate entirely.
        await releaseLock(uid, {
          status,
          lastRunAt: nowIso,
          ...(status === RUN_STATUS.SUCCESS ? { lastRunLocalDate: todayLocalDate } : {}),
        });
        results.push({ uid, ran: true, status, outcome });
      } catch (err) {
        console.error(`scheduledIngestionRunner: household ${uid} run threw`, err);
        try {
          await releaseLock(uid, { status: RUN_STATUS.FAILED, lastRunAt: nowIso });
        } catch (releaseErr) {
          console.error(`scheduledIngestionRunner: failed to release lock for ${uid} after error`, releaseErr);
        }
        results.push({ uid, ran: true, status: RUN_STATUS.FAILED, error: err?.message || String(err) });
      }
    } catch (err) {
      console.error(`scheduledIngestionRunner: household ${uid} evaluation failed`, err);
      results.push({ uid, ran: false, reason: "evaluation_error", error: err?.message || String(err) });
    }
  }

  return { checked: households.length, results };
}
