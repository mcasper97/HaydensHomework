/**
 * Focused unit tests for src/organizer/itemBuckets.js's recurrence
 * additions (recurring-obligations increment): weekdayOf, normalizeSchedule,
 * isRecurringDueOn, isOccurrenceCompleted, and bucketItems's new
 * recurring-item handling. Pure logic, zero imports beyond this module
 * itself — safe to test directly in plain Node, same rationale as every
 * other *.unit.mjs in this suite.
 *
 * Usage: node tests/item-buckets-recurrence.unit.mjs
 */
import { weekdayOf, normalizeSchedule, isRecurringDueOn, isOccurrenceCompleted, bucketItems, todayStr } from "../src/organizer/itemBuckets.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const today = todayStr();
const todayWeekday = weekdayOf(today);
const otherWeekday = (todayWeekday + 1) % 7;
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

// ============ weekdayOf ============
ok("weekdayOf(known Sunday) === 0", weekdayOf("2026-09-20") === 0);
ok("weekdayOf(known Monday) === 1", weekdayOf("2026-09-21") === 1);
ok("weekdayOf(known Saturday) === 6", weekdayOf("2026-09-19") === 6);
ok("weekdayOf is stable across repeated calls for the same date (no timezone drift)", weekdayOf("2026-01-01") === weekdayOf("2026-01-01"));

// ============ normalizeSchedule ============
ok("null/absent schedule normalizes to null", normalizeSchedule(null) === null && normalizeSchedule(undefined) === null);
ok("recurring:false (or missing) normalizes to null regardless of other fields", normalizeSchedule({ recurring: false, weekdays: [1, 2, 3] }) === null);
ok("recurring:true with zero weekdays normalizes to null (not a usable schedule)", normalizeSchedule({ recurring: true, weekdays: [] }) === null);
ok("recurring:true with a non-array weekdays normalizes to null", normalizeSchedule({ recurring: true, weekdays: "everyday" }) === null);

{
  const s = normalizeSchedule({ recurring: true, weekdays: [1, 3, 5] });
  ok("A valid weekdays-only schedule normalizes to recurring:true with those weekdays, sorted", s.recurring === true && JSON.stringify(s.weekdays) === JSON.stringify([1, 3, 5]));
  ok("No timeMode given -> timeMode/daypart/time are all null (never fabricated)", s.timeMode === null && s.daypart === null && s.time === null);
  ok("active defaults to true when not specified", s.active === true);
}

ok("Duplicate weekdays are de-duplicated", JSON.stringify(normalizeSchedule({ recurring: true, weekdays: [1, 1, 2, 2] }).weekdays) === JSON.stringify([1, 2]));
ok("Out-of-range weekday values are dropped", JSON.stringify(normalizeSchedule({ recurring: true, weekdays: [1, 7, -1, 99] }).weekdays) === JSON.stringify([1]));
ok("Unsorted weekdays are sorted ascending", JSON.stringify(normalizeSchedule({ recurring: true, weekdays: [5, 1, 3] }).weekdays) === JSON.stringify([1, 3, 5]));

{
  const s = normalizeSchedule({ recurring: true, weekdays: [1], timeMode: "daypart", daypart: "morning" });
  ok("Valid daypart timeMode is preserved", s.timeMode === "daypart" && s.daypart === "morning");
  ok("daypart mode leaves time null (XOR invariant)", s.time === null);
}
{
  const s = normalizeSchedule({ recurring: true, weekdays: [1], timeMode: "exact", time: "07:30" });
  ok("Valid exact timeMode is preserved", s.timeMode === "exact" && s.time === "07:30");
  ok("exact mode leaves daypart null (XOR invariant)", s.daypart === null);
}
ok("timeMode:'daypart' with an invalid daypart value falls back to no time signal, not trusted as-is", normalizeSchedule({ recurring: true, weekdays: [1], timeMode: "daypart", daypart: "afternoon" }).timeMode === null);
ok("timeMode:'exact' with a malformed time string falls back to no time signal", normalizeSchedule({ recurring: true, weekdays: [1], timeMode: "exact", time: "7:30am" }).timeMode === null);
ok("timeMode:'exact' with BOTH daypart and time given still only keeps exact (never both)", (() => {
  const s = normalizeSchedule({ recurring: true, weekdays: [1], timeMode: "exact", time: "07:30", daypart: "morning" });
  return s.timeMode === "exact" && s.time === "07:30" && s.daypart === null;
})());
ok("active:false is preserved (not silently forced true)", normalizeSchedule({ recurring: true, weekdays: [1], active: false }).active === false);

// ============ isRecurringDueOn ============
const baseRecurring = { schedule: { recurring: true, weekdays: [todayWeekday], active: true }, startDate: yesterday };
ok("Due today when today's weekday is in the schedule and startDate is in the past", isRecurringDueOn(baseRecurring, today));
ok("Not due when today's weekday isn't in the schedule", !isRecurringDueOn({ ...baseRecurring, schedule: { ...baseRecurring.schedule, weekdays: [otherWeekday] } }, today));
ok("Not due before its effective start boundary (startDate)", !isRecurringDueOn({ ...baseRecurring, startDate: tomorrow }, today));
ok("Due exactly on its startDate (inclusive boundary)", isRecurringDueOn({ ...baseRecurring, startDate: today }, today));
ok("Not due when active is explicitly false", !isRecurringDueOn({ ...baseRecurring, schedule: { ...baseRecurring.schedule, active: false } }, today));
ok("Not due when item.schedule is missing entirely", !isRecurringDueOn({ startDate: yesterday }, today));
ok("Not due when item.schedule.recurring is not true", !isRecurringDueOn({ schedule: { recurring: false, weekdays: [todayWeekday] }, startDate: yesterday }, today));
ok("Not due when item has no startDate at all (no effective start boundary)", !isRecurringDueOn({ schedule: { recurring: true, weekdays: [todayWeekday], active: true } }, today));

// ============ isOccurrenceCompleted ============
const completions = [
  { itemId: "item-1", occurrenceDate: today, completed: true },
  { itemId: "item-1", occurrenceDate: yesterday, completed: false },
  { itemId: "item-2", occurrenceDate: today, completed: false },
];
ok("Finds a completed record for the matching (itemId, date)", isOccurrenceCompleted("item-1", today, completions));
ok("Returns false for a record explicitly marked not completed", !isOccurrenceCompleted("item-1", yesterday, completions));
ok("Returns false for an item/date pair with no record at all", !isOccurrenceCompleted("item-3", today, completions));
ok("Never confuses two different items' completion state for the same date", !isOccurrenceCompleted("item-2", today, completions));
ok("Handles an empty/undefined completions array without throwing", !isOccurrenceCompleted("item-1", today, undefined) && !isOccurrenceCompleted("item-1", today, []));

// ============ bucketItems: recurring items ============
{
  const recurringItem = {
    id: "rec-1",
    type: "reminder",
    status: "open",
    startDate: yesterday,
    schedule: { recurring: true, weekdays: [todayWeekday], active: true },
    childIds: [],
  };
  const oneTimeToday = { id: "one-1", type: "reminder", status: "open", startDate: today, childIds: [] };
  const oneTimeOverdue = { id: "one-2", type: "reminder", status: "open", startDate: yesterday, childIds: [] };
  const oneTimeUpcoming = { id: "one-3", type: "reminder", status: "open", startDate: nextWeek, childIds: [] };

  const buckets = bucketItems([recurringItem, oneTimeToday, oneTimeOverdue, oneTimeUpcoming]);
  ok("A recurring item due today appears in today's bucket", buckets.today.some((it) => it.id === "rec-1"));
  ok("A recurring item never appears in the overdue bucket", !buckets.overdue.some((it) => it.id === "rec-1"));
  ok("A recurring item never appears in the upcoming bucket", !buckets.upcoming.some((it) => it.id === "rec-1"));
  ok("One-time items are still bucketed exactly as before (today)", buckets.today.some((it) => it.id === "one-1"));
  ok("One-time items are still bucketed exactly as before (overdue)", buckets.overdue.some((it) => it.id === "one-2"));
  ok("One-time items are still bucketed exactly as before (upcoming)", buckets.upcoming.some((it) => it.id === "one-3"));

  const inactiveRecurring = { ...recurringItem, id: "rec-2", schedule: { ...recurringItem.schedule, active: false } };
  const buckets2 = bucketItems([inactiveRecurring]);
  ok("An inactive recurring item never appears in today, even on a matching weekday", !buckets2.today.some((it) => it.id === "rec-2"));

  const notDueRecurring = { ...recurringItem, id: "rec-3", schedule: { ...recurringItem.schedule, weekdays: [otherWeekday] } };
  const buckets3 = bucketItems([notDueRecurring]);
  ok(
    "A recurring item not due today (different weekday) doesn't appear anywhere",
    !buckets3.today.some((it) => it.id === "rec-3") && !buckets3.overdue.some((it) => it.id === "rec-3") && !buckets3.upcoming.some((it) => it.id === "rec-3")
  );

  // Chore items stay excluded from canonical bucketing entirely, unaffected by this change.
  const chore = { id: "chore-1", type: "chore", status: "open", startDate: today, childIds: [] };
  const buckets4 = bucketItems([chore]);
  ok("Chore-type items remain excluded from bucketItems entirely (unchanged)", !buckets4.today.some((it) => it.id === "chore-1"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
