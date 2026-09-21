/**
 * Focused unit tests for Slice C's pure Item -> Google Calendar event
 * mapping — src/organizer/calendarEventMapping.js. Zero Firestore,
 * zero network, zero Node-only dependencies (deliberately — this module
 * is shared by the client and the server; see its own header comment).
 *
 * Usage: node tests/calendar-event-mapping.unit.mjs
 */
import {
  CALENDAR_ERROR_CODES,
  isItemEligibleForCalendarPublish,
  getEffectiveDateTime,
  buildCalendarEventFromItem,
} from "../src/organizer/calendarEventMapping.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

function baseItem(overrides) {
  return {
    id: "item-1",
    type: "school_event",
    title: "PTA Spirit Night",
    notes: "",
    allDay: true,
    startDate: "2026-10-01",
    dueDate: null,
    startTime: null,
    endTime: null,
    dueTime: null,
    childIds: [],
    schedule: null,
    ...overrides,
  };
}

// ============ isItemEligibleForCalendarPublish ============
ok("assignment is eligible", isItemEligibleForCalendarPublish(baseItem({ type: "assignment" })));
ok("test is eligible", isItemEligibleForCalendarPublish(baseItem({ type: "test" })));
ok("quiz is eligible", isItemEligibleForCalendarPublish(baseItem({ type: "quiz" })));
ok("project is eligible", isItemEligibleForCalendarPublish(baseItem({ type: "project" })));
ok("study_task is eligible", isItemEligibleForCalendarPublish(baseItem({ type: "study_task" })));
ok("school_event is eligible", isItemEligibleForCalendarPublish(baseItem({ type: "school_event" })));
ok("family_event is eligible", isItemEligibleForCalendarPublish(baseItem({ type: "family_event" })));
ok("reminder is eligible", isItemEligibleForCalendarPublish(baseItem({ type: "reminder" })));
ok("chore is NOT eligible", !isItemEligibleForCalendarPublish(baseItem({ type: "chore" })));
ok("a recurring item is NOT eligible regardless of type", !isItemEligibleForCalendarPublish(baseItem({ type: "reminder", schedule: { recurring: true, weekdays: [1] } })));
ok("null item is not eligible, does not throw", !isItemEligibleForCalendarPublish(null));

// ============ getEffectiveDateTime — due-vs-start routing ============
{
  const dt = getEffectiveDateTime(baseItem({ type: "assignment", startDate: "2026-09-01", dueDate: "2026-10-06", startTime: "08:00", dueTime: "23:59", endTime: "09:00" }));
  ok("MAPPING — assignment uses effective DUE date, not start date", dt.date === "2026-10-06");
  ok("MAPPING — assignment uses dueTime for its start time", dt.startTime === "23:59");
  ok("MAPPING — assignment (due-date type) never has an end time", dt.endTime === null);
}
{
  const dt = getEffectiveDateTime(baseItem({ type: "project", startDate: "2026-09-01", dueDate: "2026-10-06" }));
  ok("MAPPING — project uses effective DUE date", dt.date === "2026-10-06");
}
{
  const dt = getEffectiveDateTime(baseItem({ type: "study_task", startDate: "2026-09-01", dueDate: "2026-10-06" }));
  ok("MAPPING — study_task uses effective DUE date", dt.date === "2026-10-06");
}
{
  const dt = getEffectiveDateTime(baseItem({ type: "school_event", startDate: "2026-10-01", startTime: "17:00", endTime: "20:00" }));
  ok("MAPPING — school_event uses effective START date", dt.date === "2026-10-01");
  ok("MAPPING — school_event uses startTime/endTime", dt.startTime === "17:00" && dt.endTime === "20:00");
}
{
  const dt = getEffectiveDateTime(baseItem({ type: "test", startDate: "2026-10-01" }));
  ok("MAPPING — test uses effective START date", dt.date === "2026-10-01");
}
{
  const dt = getEffectiveDateTime(baseItem({ type: "quiz", startDate: "2026-10-01" }));
  ok("MAPPING — quiz uses effective START date", dt.date === "2026-10-01");
}
{
  const dt = getEffectiveDateTime(baseItem({ type: "reminder", startDate: "2026-10-01" }));
  ok("MAPPING — reminder uses effective START date", dt.date === "2026-10-01");
}

// ============ buildCalendarEventFromItem — all-day events ============
{
  const result = buildCalendarEventFromItem({ item: baseItem({ allDay: true, startDate: "2026-10-01" }), eventId: "evt-abc" });
  ok("All-day event uses start.date / end.date, no timeZone field", result.ok && result.event.start.date === "2026-10-01" && !("timeZone" in result.event.start));
  ok("MAPPING — one-day all-day event uses the EXCLUSIVE next-day end.date", result.event.end.date === "2026-10-02");
  ok("The event carries the passed-in deterministic id", result.event.id === "evt-abc");
  ok("The event summary is the Item's title", result.event.summary === "PTA Spirit Night");
}
{
  // Cross a month boundary correctly (UTC-anchored arithmetic).
  const result = buildCalendarEventFromItem({ item: baseItem({ allDay: true, startDate: "2026-01-31" }), eventId: "evt-x" });
  ok("Exclusive end.date correctly rolls over a month boundary", result.ok && result.event.end.date === "2026-02-01");
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ allDay: true, notes: "Bring a folding chair." }), eventId: "evt-y" });
  ok("Item.notes becomes the event description", result.ok && result.event.description === "Bring a folding chair.");
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ allDay: true, notes: "" }), eventId: "evt-z" });
  ok("Empty notes never produces an empty-string description field", result.ok && !("description" in result.event));
}

// ============ buildCalendarEventFromItem — due-based items (assignment/project/study_task) ============
// A due time means "due by," never "starts at" — these types must always
// publish as an all-day deadline event, regardless of item.allDay, and must
// never reach the timed-event/end-time branch below.
{
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "assignment", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "15:00" }), eventId: "evt-due-a" });
  ok("assignment + dueTime publishes as an all-day event (start.date/end.date, no timeZone)", result.ok && result.event.start.date === "2026-10-08" && result.event.end.date === "2026-10-09" && !("timeZone" in result.event.start));
  ok("assignment + dueTime shows a visible 'Due by' line in the description", result.event.description === "Due by 3:00 PM");
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "project", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "15:00" }), eventId: "evt-due-p" });
  ok("project + dueTime publishes as an all-day event with a visible due-time line", result.ok && result.event.start.date === "2026-10-08" && result.event.description === "Due by 3:00 PM");
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "study_task", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "15:00" }), eventId: "evt-due-s" });
  ok("study_task + dueTime publishes as an all-day event with a visible due-time line", result.ok && result.event.start.date === "2026-10-08" && result.event.description === "Due by 3:00 PM");
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "assignment", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: null }), eventId: "evt-due-none" });
  ok("A due-based item with NO dueTime is still all-day, with no 'Due by' line at all", result.ok && result.event.start.date === "2026-10-08" && !("description" in result.event));
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "assignment", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "15:00", notes: "Bring a printed copy." }), eventId: "evt-due-notes" });
  ok("dueTime and existing notes are both preserved, due line first then notes", result.ok && result.event.description === "Due by 3:00 PM\n\nBring a printed copy.");
}
{
  // Defensive: a due-based item found with allDay:false (legacy/malformed
  // data) must still publish as an all-day deadline event, never hit the
  // timed-event branch (no MISSING_END_TIME, no optionalEndTime handling).
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "assignment", allDay: false, startDate: null, dueDate: "2026-10-08", dueTime: "15:00" }), eventId: "evt-due-legacy" });
  ok("A due-based item with allDay:false still publishes as all-day, not a timed event", result.ok && result.event.start.date === "2026-10-08" && !("dateTime" in result.event.start));
  ok("...and never produces MISSING_END_TIME or any timed-event error", result.code !== CALENDAR_ERROR_CODES.MISSING_END_TIME);
}
{
  // No household timezone needed for a due-based all-day deadline event —
  // householdTimezone is intentionally omitted here.
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "study_task", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "09:30" }), eventId: "evt-due-notz" });
  ok("A due-based item never requires a household timezone", result.ok && result.event.description === "Due by 9:30 AM");
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ id: "item-secret-id-999", type: "assignment", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "15:00", notes: "See rubric." }), eventId: "evt-due-clean" });
  ok("No internal id/provenance text ever leaks into the due-based description", result.ok && !result.event.description.includes("item-secret-id-999") && !result.event.description.includes("sourceRecordId") && !result.event.description.includes("confidence"));
}

// ============ buildCalendarEventFromItem — timed events ============
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: "20:00" }),
    householdTimezone: "America/New_York",
    eventId: "evt-timed",
  });
  ok("MAPPING — timed event uses the stored household timezone", result.ok && result.event.start.timeZone === "America/New_York" && result.event.end.timeZone === "America/New_York");
  ok("Timed event start/end dateTime are correctly composed", result.event.start.dateTime === "2026-10-01T17:00:00" && result.event.end.dateTime === "2026-10-01T20:00:00");
}
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: null }),
    householdTimezone: "America/New_York",
    eventId: "evt-no-end",
  });
  ok("MAPPING — no endTime + no optionalEndTime is rejected", !result.ok && result.code === CALENDAR_ERROR_CODES.MISSING_END_TIME);
}
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: null }),
    householdTimezone: "America/New_York",
    optionalEndTime: "20:00",
    eventId: "evt-optional",
  });
  ok("MAPPING — optionalEndTime is used only when canonical endTime is absent", result.ok && result.event.end.dateTime === "2026-10-01T20:00:00");
}
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: "20:00" }),
    householdTimezone: "America/New_York",
    optionalEndTime: "21:00",
    eventId: "evt-unexpected",
  });
  ok("Supplying optionalEndTime when a canonical endTime already exists is rejected", !result.ok && result.code === CALENDAR_ERROR_CODES.UNEXPECTED_OPTIONAL_END_TIME);
}
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: null }),
    householdTimezone: "America/New_York",
    optionalEndTime: "8pm",
    eventId: "evt-invalid",
  });
  ok("MAPPING — invalid optionalEndTime is rejected", !result.ok && result.code === CALENDAR_ERROR_CODES.INVALID_OPTIONAL_END_TIME);
}
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: null }),
    householdTimezone: "America/New_York",
    optionalEndTime: "17:00",
    eventId: "evt-equal",
  });
  ok("MAPPING — end <= start is rejected (equal times)", !result.ok && result.code === CALENDAR_ERROR_CODES.END_NOT_AFTER_START);
}
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: null }),
    householdTimezone: "America/New_York",
    optionalEndTime: "16:00",
    eventId: "evt-before",
  });
  ok("MAPPING — end <= start is rejected (end before start)", !result.ok && result.code === CALENDAR_ERROR_CODES.END_NOT_AFTER_START);
}
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: "16:00" }),
    householdTimezone: "America/New_York",
    eventId: "evt-canonical-bad",
  });
  ok("A canonical (already-stored) end <= start is ALSO rejected, not just an optional one", !result.ok && result.code === CALENDAR_ERROR_CODES.END_NOT_AFTER_START);
}
{
  const result = buildCalendarEventFromItem({
    item: baseItem({ allDay: false, startDate: "2026-10-01", startTime: "17:00", endTime: "20:00" }),
    householdTimezone: null,
    eventId: "evt-no-tz",
  });
  ok("A timed item with no household timezone is blocked with a clear error", !result.ok && result.code === CALENDAR_ERROR_CODES.MISSING_HOUSEHOLD_TIMEZONE);
  ok("The missing-timezone message directs the parent to Parent Tools", result.message.includes("Parent Tools"));
}

// ============ buildCalendarEventFromItem — ineligible items ============
{
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "reminder", schedule: { recurring: true, weekdays: [1] } }), eventId: "evt-r" });
  ok("MAPPING — a recurring item is rejected", !result.ok && result.code === CALENDAR_ERROR_CODES.RECURRING_NOT_SUPPORTED);
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "chore" }), eventId: "evt-c" });
  ok("MAPPING — an unsupported type (chore) is rejected", !result.ok && result.code === CALENDAR_ERROR_CODES.UNSUPPORTED_TYPE);
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ type: "made_up_type" }), eventId: "evt-u" });
  ok("An entirely unrecognized type is also rejected", !result.ok && result.code === CALENDAR_ERROR_CODES.UNSUPPORTED_TYPE);
}
{
  const result = buildCalendarEventFromItem({ item: baseItem({ allDay: true, startDate: null, dueDate: null }), eventId: "evt-nodate" });
  ok("An item with no effective date at all is rejected", !result.ok && result.code === CALENDAR_ERROR_CODES.MISSING_EFFECTIVE_DATE);
}

// ============ Determinism ============
{
  const a = buildCalendarEventFromItem({ item: baseItem({ allDay: true }), eventId: "same-id" });
  const b = buildCalendarEventFromItem({ item: baseItem({ allDay: true }), eventId: "same-id" });
  ok("Building the same Item twice with the same eventId produces byte-identical event shapes", JSON.stringify(a.event) === JSON.stringify(b.event));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
