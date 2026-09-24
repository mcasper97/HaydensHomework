/**
 * Focused unit tests for the server-side daily scheduler's pure decision
 * module — src/data/emailIngestionSchedule.js's normalizeEmailIngestionSchedule
 * and isHouseholdRunDue. Pure logic, zero Firestore/timezone I/O — all
 * inputs are fixed strings, so this is directly testable in plain Node.
 *
 * Usage: node tests/email-ingestion-schedule.unit.mjs
 */
import {
  DEFAULT_EMAIL_INGESTION_SCHEDULE,
  normalizeEmailIngestionSchedule,
  isHouseholdRunDue,
} from "../src/data/emailIngestionSchedule.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ normalizeEmailIngestionSchedule ============
ok(
  "null/missing raw normalizes to the default (disabled) schedule",
  JSON.stringify(normalizeEmailIngestionSchedule(null)) === JSON.stringify(DEFAULT_EMAIL_INGESTION_SCHEDULE)
);
ok(
  "A non-object raw normalizes to the default schedule",
  JSON.stringify(normalizeEmailIngestionSchedule("nonsense")) === JSON.stringify(DEFAULT_EMAIL_INGESTION_SCHEDULE)
);
ok(
  "A well-formed enabled schedule round-trips",
  (() => {
    const n = normalizeEmailIngestionSchedule({ enabled: true, localTime: "07:30" });
    return n.enabled === true && n.localTime === "07:30";
  })()
);
ok(
  "An invalid localTime (bad format) normalizes to null",
  normalizeEmailIngestionSchedule({ enabled: true, localTime: "7:30am" }).localTime === null
);
ok(
  "An invalid localTime (out of range hour) normalizes to null",
  normalizeEmailIngestionSchedule({ enabled: true, localTime: "25:00" }).localTime === null
);
ok(
  "lastRunStatus other than success/failed normalizes to null",
  normalizeEmailIngestionSchedule({ lastRunStatus: "bogus" }).lastRunStatus === null
);
ok(
  "lastRunStatus of success is preserved",
  normalizeEmailIngestionSchedule({ lastRunStatus: "success" }).lastRunStatus === "success"
);
ok(
  "A malformed runLock (missing expiresAt) normalizes to null",
  normalizeEmailIngestionSchedule({ runLock: { acquiredAt: "2026-01-15T08:00:00.000Z" } }).runLock === null
);
ok(
  "A well-formed runLock round-trips",
  (() => {
    const lock = { acquiredAt: "2026-01-15T08:00:00.000Z", expiresAt: "2026-01-15T08:10:00.000Z" };
    const n = normalizeEmailIngestionSchedule({ runLock: lock });
    return n.runLock?.acquiredAt === lock.acquiredAt && n.runLock?.expiresAt === lock.expiresAt;
  })()
);

// ============ isHouseholdRunDue ============
// Vercel Hobby once-daily-cron correction: no longer gated on localTime at
// all — an enabled household with no runLock and no same-day run is due,
// full stop. localTime itself may still be present/absent on the
// normalized schedule (see normalizeEmailIngestionSchedule tests above),
// it just no longer affects this decision.

ok(
  "A disabled household is skipped",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: false }),
    todayLocalDate: "2026-01-15",
  }).reason === "disabled"
);

ok(
  "A missing schedule (null) is skipped as disabled",
  isHouseholdRunDue({
    schedule: null,
    todayLocalDate: "2026-01-15",
  }).due === false
);

ok(
  "An enabled household with NO localTime configured at all is still due — localTime is no longer required",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: null }),
    todayLocalDate: "2026-01-15",
  }).due === true
);

ok(
  "An enabled household with a stored (now-unused) localTime is due, same as one with none — localTime never gates execution",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: "08:00" }),
    todayLocalDate: "2026-01-15",
  }).due === true
);

ok(
  "A household that already ran today (same household-local day) is skipped",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, lastRunLocalDate: "2026-01-15" }),
    todayLocalDate: "2026-01-15",
  }).reason === "already_ran_today"
);

ok(
  "A household that ran on a DIFFERENT local day is due again today",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, lastRunLocalDate: "2026-01-14" }),
    todayLocalDate: "2026-01-15",
  }).due === true
);

ok(
  "Missing household timezone info (todayLocalDate null) is skipped (no_timezone), never guesses",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true }),
    todayLocalDate: null,
  }).reason === "no_timezone"
);

// ============ Expiring lease (runLock) ============

ok(
  "A household with an ACTIVE (unexpired) runLock is skipped (already_running) — requirement 1",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({
      enabled: true,
      runLock: { acquiredAt: "2026-01-15T09:00:00.000Z", expiresAt: "2026-01-15T09:10:00.000Z" },
    }),
    todayLocalDate: "2026-01-15",
    nowIso: "2026-01-15T09:05:00.000Z", // before expiresAt
  }).reason === "already_running"
);

ok(
  "A household with an EXPIRED runLock is NOT blocked and is due again — requirement 2 / crash recovery (requirement 5)",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({
      enabled: true,
      runLock: { acquiredAt: "2026-01-15T08:50:00.000Z", expiresAt: "2026-01-15T09:00:00.000Z" },
    }),
    todayLocalDate: "2026-01-15",
    nowIso: "2026-01-15T09:30:00.000Z", // well after expiresAt — simulates a crashed run's stale lease
  }).due === true
);

// ============ household timezone still affects the same-day duplicate guard ============
// Timezone is no longer used for a time-of-day gate, but it's still what
// makes "today" household-local rather than UTC-local — two households
// that both last ran on 2026-01-14, evaluated at the same real-world
// instant, can land on different sides of the "already ran today" check
// purely because their timezones disagree about what today's date is.
{
  const schedule = normalizeEmailIngestionSchedule({ enabled: true, lastRunLocalDate: "2026-01-14" });
  const stillSameDay = isHouseholdRunDue({ schedule, todayLocalDate: "2026-01-14" });
  const rolledOverToNewDay = isHouseholdRunDue({ schedule, todayLocalDate: "2026-01-15" });
  ok(
    "The same schedule is already-ran-today in one household's local date and due again in another's, at the same instant",
    stillSameDay.due === false && stillSameDay.reason === "already_ran_today" && rolledOverToNewDay.due === true
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
