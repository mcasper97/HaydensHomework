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
 *
 * executeHouseholdIngestionRun (observability/manual-validation follow-up)
 * — the acquire-lock/run/release-lock sequence below was extracted out of
 * runDueHouseholds's per-household loop into its own exported function so
 * api/email-ingestion-run-now.js (the parent-triggered "Run automatic
 * check now" endpoint) can reuse the EXACT SAME lease-protected execution
 * path, never a second copy of it. The one thing a manual run
 * deliberately skips is isHouseholdRunDue's due-decision itself (task:
 * "A manual Run Now should explicitly execute ingestion even if today's
 * automatic run already occurred") — it still goes through the real,
 * atomic tryAcquireEmailIngestionLock, so two runs (manual+manual,
 * manual+cron, or cron+cron) can still never process the same household
 * concurrently.
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
 * executeHouseholdIngestionRun(uid, { todayLocalDate, nowIso, now,
 *   tryAcquireLock, releaseLock, runIngestion, recordAutomaticRunStatus }) ->
 *   per-household result
 *
 * The shared "acquire the lease, run ingestion, release the lease with
 * status" sequence — the ONE place that sequence is implemented, called
 * by both runDueHouseholds (below, per due household) and
 * api/email-ingestion-run-now.js (a manual, parent-triggered run,
 * unconditionally — no due-decision). `todayLocalDate` may be null (a
 * household with no configured timezone) — releaseLock still receives it
 * verbatim on success, exactly matching releaseEmailIngestionLock's own
 * documented lastRunLocalDate contract; this function makes no timezone
 * decision of its own.
 *
 * `recordAutomaticRunStatus` (default true) controls whether this run's
 * outcome is PERSISTED as the household's lastRunStatus/lastRunAt/
 * lastRunLocalDate — the same fields the "Last automatic check" display
 * and the daily due-decision both read. runDueHouseholds (the daily cron
 * path) never overrides this, so its behavior is unchanged. A manual Run
 * Now (api/email-ingestion-run-now.js) passes `false`: the lease is still
 * acquired and released exactly as before — same overlap protection, same
 * runIngestion(uid) seam — but the release call omits status/lastRunAt/
 * lastRunLocalDate entirely, so a manual run neither consumes today's
 * cron slot nor overwrites the persisted "Last automatic check" info. The
 * function's OWN return value is unaffected either way — it always
 * reflects the real, just-observed status/outcome for the caller's
 * immediate use (e.g. Run Now's synchronous UI feedback).
 */
export async function executeHouseholdIngestionRun(uid, { todayLocalDate, nowIso, now, tryAcquireLock, releaseLock, runIngestion, recordAutomaticRunStatus = true }) {
  const acquired = await tryAcquireLock(uid, { now });
  if (!acquired) {
    // Overlap protection (task Section 4) — another invocation is already
    // processing this household (an unexpired lease — see
    // src/data/emailIngestionSchedule.js's EMAIL_INGESTION_LOCK_LEASE_MS);
    // never start a second one, whether the other invocation is the daily
    // cron or another manual Run Now.
    return { uid, ran: false, reason: "already_running" };
  }

  try {
    const outcome = await runIngestion(uid);
    const status = outcome?.ok ? RUN_STATUS.SUCCESS : RUN_STATUS.FAILED;
    // Only a genuine success consumes today's single-run slot — see
    // releaseEmailIngestionLock's own doc comment on why a failure omits
    // lastRunLocalDate entirely. This bookkeeping write is skipped
    // entirely when recordAutomaticRunStatus is false (a manual run) —
    // the lease is still released either way.
    await releaseLock(uid, recordAutomaticRunStatus ? {
      status,
      lastRunAt: nowIso,
      ...(status === RUN_STATUS.SUCCESS ? { lastRunLocalDate: todayLocalDate } : {}),
    } : {});
    return { uid, ran: true, status, outcome };
  } catch (err) {
    console.error(`scheduledIngestionRunner: household ${uid} run threw`, err);
    try {
      await releaseLock(uid, recordAutomaticRunStatus ? { status: RUN_STATUS.FAILED, lastRunAt: nowIso } : {});
    } catch (releaseErr) {
      console.error(`scheduledIngestionRunner: failed to release lock for ${uid} after error`, releaseErr);
    }
    return { uid, ran: true, status: RUN_STATUS.FAILED, error: err?.message || String(err) };
  }
}

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

      const result = await executeHouseholdIngestionRun(uid, { todayLocalDate, nowIso, now, tryAcquireLock, releaseLock, runIngestion });
      results.push(result);
    } catch (err) {
      console.error(`scheduledIngestionRunner: household ${uid} evaluation failed`, err);
      results.push({ uid, ran: false, reason: "evaluation_error", error: err?.message || String(err) });
    }
  }

  return { checked: households.length, results };
}
