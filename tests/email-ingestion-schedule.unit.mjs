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

ok(
  "A disabled household is skipped",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: false, localTime: "08:00" }),
    todayLocalDate: "2026-01-15",
    currentLocalTime: "09:00",
  }).reason === "disabled"
);

ok(
  "A missing schedule (null) is skipped as disabled",
  isHouseholdRunDue({
    schedule: null,
    todayLocalDate: "2026-01-15",
    currentLocalTime: "09:00",
  }).due === false
);

ok(
  "An enabled schedule with no localTime configured is skipped (no_schedule)",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: null }),
    todayLocalDate: "2026-01-15",
    currentLocalTime: "09:00",
  }).reason === "no_schedule"
);

ok(
  "A household not yet due (current local time before configured localTime) is skipped",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: "08:00" }),
    todayLocalDate: "2026-01-15",
    currentLocalTime: "07:59",
  }).reason === "not_yet_time"
);

ok(
  "A due household (current local time at/after configured localTime, not yet run today) is due",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: "08:00" }),
    todayLocalDate: "2026-01-15",
    currentLocalTime: "08:05",
  }).due === true
);

ok(
  "A household that already ran today (same household-local day) is skipped, even though it's past localTime",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: "08:00", lastRunLocalDate: "2026-01-15" }),
    todayLocalDate: "2026-01-15",
    currentLocalTime: "09:00",
  }).reason === "already_ran_today"
);

ok(
  "A household that ran on a DIFFERENT local day is due again today",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: "08:00", lastRunLocalDate: "2026-01-14" }),
    todayLocalDate: "2026-01-15",
    currentLocalTime: "09:00",
  }).due === true
);

ok(
  "Missing household timezone info (todayLocalDate/currentLocalTime null) is skipped (no_timezone), never guesses",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: "08:00" }),
    todayLocalDate: null,
    currentLocalTime: null,
  }).reason === "no_timezone"
);

// ============ Expiring lease (runLock) ============

ok(
  "A household with an ACTIVE (unexpired) runLock is skipped (already_running) — requirement 1",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({
      enabled: true,
      localTime: "08:00",
      runLock: { acquiredAt: "2026-01-15T09:00:00.000Z", expiresAt: "2026-01-15T09:10:00.000Z" },
    }),
    todayLocalDate: "2026-01-15",
    currentLocalTime: "09:00",
    nowIso: "2026-01-15T09:05:00.000Z", // before expiresAt
  }).reason === "already_running"
);

ok(
  "A household with an EXPIRED runLock is NOT blocked and is due again — requirement 2 / crash recovery (requirement 5)",
  isHouseholdRunDue({
    schedule: normalizeEmailIngestionSchedule({
      enabled: true,
      localTime: "08:00",
      runLock: { acquiredAt: "2026-01-15T08:50:00.000Z", expiresAt: "2026-01-15T09:00:00.000Z" },
    }),
    todayLocalDate: "2026-01-15",
    currentLocalTime: "09:30",
    nowIso: "2026-01-15T09:30:00.000Z", // well after expiresAt — simulates a crashed run's stale lease
  }).due === true
);

// ============ household timezone affects the due calculation ============
// Same schedule/localTime/today; only currentLocalTime differs (as it
// would for two households in different timezones evaluated at the same
// real-world instant — see householdCurrentTimeStr in
// tests/household-timezone.unit.mjs for the timezone->HH:MM half of this).
{
  const schedule = normalizeEmailIngestionSchedule({ enabled: true, localTime: "08:00" });
  const dueResult = isHouseholdRunDue({ schedule, todayLocalDate: "2026-01-15", currentLocalTime: "10:30" });
  const notDueResult = isHouseholdRunDue({ schedule, todayLocalDate: "2026-01-15", currentLocalTime: "05:30" });
  ok(
    "The same schedule is due in one timezone's local time and not yet due in another's, at the same instant",
    dueResult.due === true && notDueResult.due === false && notDueResult.reason === "not_yet_time"
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
