/* ============================== Email ingestion schedule (pure) ==============================
 * The environment-neutral "is this household due for its scheduled
 * automatic email-ingestion run right now?" decision — used by
 * api/_scheduledIngestionRunner.js (the server-side Cron-triggered
 * runner). Deliberately pure and I/O-free, same rationale as every other
 * src/data/*Decision.js module in this app (itemFormValidation.js,
 * autoCommitDecision.js, candidateCommitDecision.js): no Firestore, no
 * Date.now(), no real clock — callers compute the household-local date
 * first (see src/data/householdTimezone.js's householdTodayStr) and pass
 * it in, so this module is directly unit-testable with fixed inputs and
 * never has an opinion on what "now" or "which timezone" means.
 *
 * emailIngestionSchedule lives on the same users/{uid} document every
 * other household-profile field already does (familyLastName, timezone,
 * googleCalendarRouting, googleCalendarAutoPublishEnabled) — see
 * api/_householdProfileStore.js's getEmailIngestionSchedule/
 * tryAcquireEmailIngestionLock/releaseEmailIngestionLock for the actual
 * Admin-SDK reads/writes. Timezone is deliberately NOT duplicated onto
 * this object — it always comes from the existing users/{uid}.timezone
 * field (see householdTimezone.js), read alongside this one.
 */

/**
 * DEFAULT_EMAIL_INGESTION_SCHEDULE — what a household with no configured
 * schedule at all has. `enabled: false` is the only requirement (task
 * spec: "Default behavior when config is missing: disabled") — every
 * other field is just the natural "never run yet" state.
 */
export const DEFAULT_EMAIL_INGESTION_SCHEDULE = {
  enabled: false,
  localTime: null,
  lastRunLocalDate: null,
  lastRunAt: null,
  lastRunStatus: null,
  runLock: null,
};

const LOCAL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * EMAIL_INGESTION_LOCK_LEASE_MS — the fixed duration a runLock (see below)
 * stays valid once acquired. Conservative for "one email-ingestion run"
 * (Gmail fetch + extraction + finalize, all server-side): long enough that
 * a normal run always finishes well inside it, short enough that a
 * crashed run's household isn't blocked for long. 10 minutes.
 */
export const EMAIL_INGESTION_LOCK_LEASE_MS = 10 * 60 * 1000;

function normalizeRunLock(raw) {
  if (!raw || typeof raw !== "object") return null;
  const acquiredAt = typeof raw.acquiredAt === "string" && raw.acquiredAt ? raw.acquiredAt : null;
  const expiresAt = typeof raw.expiresAt === "string" && raw.expiresAt ? raw.expiresAt : null;
  if (!acquiredAt || !expiresAt) return null;
  return { acquiredAt, expiresAt };
}

/**
 * isRunLockActive(runLock, nowIso) -> boolean
 * A lease with no expiresAt we could resolve is never treated as active
 * (fails open — same "never block forever" intent this whole correction
 * exists for). Otherwise active exactly while nowIso is still before the
 * lease's expiresAt (ISO 8601 UTC timestamps compare correctly as plain
 * strings, so no Date parsing is needed here).
 */
function isRunLockActive(runLock, nowIso) {
  if (!runLock || !nowIso) return false;
  return nowIso < runLock.expiresAt;
}

/**
 * normalizeEmailIngestionSchedule(raw) -> a fully-valid schedule object.
 * Never trusts the raw Firestore value's shape (parent-writable in a
 * future Settings UI, per the task's own "do not build UI for this yet"
 * — but the read path must already be defensive) — absent, missing, or
 * malformed fields all normalize to the same safe default.
 */
export function normalizeEmailIngestionSchedule(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_EMAIL_INGESTION_SCHEDULE };
  const localTime = typeof raw.localTime === "string" && LOCAL_TIME_RE.test(raw.localTime) ? raw.localTime : null;
  return {
    enabled: raw.enabled === true,
    localTime,
    lastRunLocalDate: typeof raw.lastRunLocalDate === "string" && raw.lastRunLocalDate ? raw.lastRunLocalDate : null,
    lastRunAt: typeof raw.lastRunAt === "string" && raw.lastRunAt ? raw.lastRunAt : null,
    lastRunStatus: raw.lastRunStatus === "success" || raw.lastRunStatus === "failed" ? raw.lastRunStatus : null,
    runLock: normalizeRunLock(raw.runLock),
  };
}

/**
 * isHouseholdRunDue({ schedule, todayLocalDate, nowIso }) ->
 *   { due: boolean, reason: string }
 *
 * Vercel Hobby cron correction: the server-side cron now fires once per
 * day (see vercel.json's "0 0 * * *"), not on a coarse interval — there is
 * no longer a specific local time-of-day to wait for, so execution is NO
 * LONGER gated on schedule.localTime at all. Every enabled household is
 * eligible on each (once-daily) cron tick, subject only to the same-day
 * and overlap guards below. localTime itself is still read/normalized
 * (see normalizeEmailIngestionSchedule above) — existing stored values are
 * left alone, simply unused for this decision now (task: "Simply stop
 * using localTime for scheduling. Existing stored schedule objects must
 * remain valid.").
 *
 * schedule — an already-normalized schedule (see above).
 * todayLocalDate — "YYYY-MM-DD", the household's own local today (see
 *   householdTodayStr(timezone)); null means the household has no valid
 *   timezone configured, which fails safe to never-due (this app never
 *   guesses/defaults a timezone — see householdTimezone.js's own
 *   established convention). Timezone is still needed here — it's what
 *   makes the same-day duplicate guard below household-local rather than
 *   UTC-local.
 * nowIso — the current instant as an ISO 8601 UTC string (e.g.
 *   `now.toISOString()`), used only to check whether schedule.runLock
 *   (see EMAIL_INGESTION_LOCK_LEASE_MS above) has expired. A lease that
 *   has expired never blocks — this is what stops a crashed run from
 *   blocking its household forever (see api/_householdProfileStore.js's
 *   tryAcquireEmailIngestionLock, the actual lease-holder).
 *
 * `reason` is one of: "disabled" | "no_timezone" | "already_running" |
 * "already_ran_today" | "due" — useful for tests and for a run-summary
 * log line, never used to branch on elsewhere.
 */
export function isHouseholdRunDue({ schedule, todayLocalDate, nowIso }) {
  const s = schedule || DEFAULT_EMAIL_INGESTION_SCHEDULE;

  if (!s.enabled) return { due: false, reason: "disabled" };
  if (!todayLocalDate) return { due: false, reason: "no_timezone" };
  if (isRunLockActive(s.runLock, nowIso)) return { due: false, reason: "already_running" };
  if (s.lastRunLocalDate === todayLocalDate) return { due: false, reason: "already_ran_today" };
  return { due: true, reason: "due" };
}
