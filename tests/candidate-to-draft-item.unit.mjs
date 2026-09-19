/**
 * Pure unit tests for src/organizer/candidateToDraftItem.js — the adapter
 * that shapes an IngestionCandidate as an ItemForm `existingItem`. Kept as
 * a plain-JS module (no JSX/React) specifically so it can be unit-tested
 * directly in Node.
 *
 * Usage: node tests/candidate-to-draft-item.unit.mjs
 */
import { candidateToDraftItem } from "../src/organizer/candidateToDraftItem.js";
import { todayStr } from "../src/organizer/itemBuckets.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const child = { id: "child-1", name: "Ava", emoji: "🦁" };

// ============ Due-date types (assignment/project/study_task) map date -> dueDate ============
for (const type of ["assignment", "project", "study_task"]) {
  const draft = candidateToDraftItem({ proposedType: type, title: "X", date: "2026-10-01" }, child);
  ok(`${type}: date maps to dueDate, not startDate`, draft.dueDate === "2026-10-01" && draft.startDate === null);
}

// ============ Non-due-date types map date -> startDate ============
for (const type of ["test", "quiz", "school_event", "family_event", "reminder"]) {
  const draft = candidateToDraftItem({ proposedType: type, title: "X", date: "2026-10-01" }, child);
  ok(`${type}: date maps to startDate, not dueDate`, draft.startDate === "2026-10-01" && draft.dueDate === null);
}

// ============ Child pre-selection: the single in-scope child is always
// pre-selected regardless of the AI's proposedChildName guess — there is
// only ever 0 or 1 child passed in (the one whose Parents Page is open),
// so this is a context default, not the AI silently assigning a child.
// Bug fix regression coverage: previously this only pre-selected on an
// exact proposedChildName match, which left the submit button genuinely
// disabled (ItemForm's `existingItem.childIds || fallback` never falls
// back for an explicit `[]`, since `[]` is truthy in JS) whenever the
// AI's guess didn't match — the common case for most real documents. ============
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: "Ava" }, child);
  ok("Matching proposedChildName: child is pre-selected", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: "Ben" }, child);
  ok("Mismatched proposedChildName: the in-scope child is still pre-selected (only slot this screen offers)", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: null }, child);
  ok("No proposedChildName at all: the in-scope child is still pre-selected", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: "Ava" }, null);
  ok("No child in scope at all: never throws, selection stays empty (nothing to pre-select)", draft.childIds.length === 0);
}

// ============ Configured sender target (#26, Commit 5 — email ingestion) takes
// precedence over the single-in-scope-child case, and is never overridden by
// the AI's own proposedChildName guess. ============
{
  const draft = candidateToDraftItem(
    { proposedType: "test", title: "X", proposedChildName: "Someone Else Entirely", targetType: "child", targetChildId: "hayden-1" },
    child // an ambient "in scope" child is present too — the configured target must win
  );
  ok("targetType child: pre-selects the CONFIGURED child, ignoring the AI's proposedChildName guess", draft.childIds.length === 1 && draft.childIds[0] === "hayden-1");
  ok("targetType child: does NOT fall back to the ambient in-scope child when a target is configured", draft.childIds[0] !== "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "school_event", title: "X", targetType: "family", targetChildId: null }, child);
  ok("targetType family: childIds is empty — the app's existing household-wide convention, no Item model change", draft.childIds.length === 0);
}
{
  const draft = candidateToDraftItem({ proposedType: "reminder", title: "X", targetType: "review", targetChildId: null }, child);
  ok("targetType review: childIds is left empty for the parent to resolve during review", draft.childIds.length === 0);
}
{
  // A candidate predating Commit 5 (photo/CSV ingestion) has no targetType
  // at all — behavior must be identical to before this field existed.
  const draft = candidateToDraftItem({ proposedType: "test", title: "X" }, child);
  ok("No targetType at all (legacy/photo/CSV candidate): falls back to the ambient in-scope child, unchanged", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", targetType: "child", targetChildId: null }, child);
  ok("targetType child with no targetChildId (shouldn't happen, but fails safe): falls through rather than assigning nothing meaningful", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}

// ============ Field passthrough ============
{
  const draft = candidateToDraftItem(
    {
      proposedType: "test",
      title: "Math Test",
      subject: "Math",
      academicTopic: "Fractions",
      academicUnit: "Unit 3",
      preparationRequired: true,
      description: "Study pages 12-15",
    },
    child
  );
  ok("title passes through", draft.title === "Math Test");
  ok("subject passes through", draft.subject === "Math");
  ok("academicTopic passes through", draft.academicTopic === "Fractions");
  ok("academicUnit passes through", draft.academicUnit === "Unit 3");
  ok("preparationRequired passes through", draft.preparationRequired === true);
  ok("description maps to notes", draft.notes === "Study pages 12-15");
}

// ============ Missing optional fields default sanely, never throw ============
{
  const draft = candidateToDraftItem({ proposedType: "reminder", title: "Bring lunch money" }, child);
  ok("Missing subject defaults to null", draft.subject === null);
  ok("Missing description defaults to empty notes string (matches ItemForm's own default)", draft.notes === "");
  ok("Missing date defaults to null on the relevant date field", draft.startDate === null);
}

// ============ No source/provenance metadata leaks into the canonical Item draft
// (#26, Commit 5 live-validation fix — the review UI's new "Source" section is
// read directly from SourceRecord provenance; candidateToDraftItem.js's output
// is exactly what becomes the Item, so it must never carry sender/subject/page
// fields, even though the candidate it was given may itself have them). ============
{
  // NOTE: candidate.subject is the Item's own ACADEMIC subject (e.g.
  // "Language Arts") — a real, existing, unrelated field. The provenance
  // fields probed as "forbidden" below (senderEmail, senderName, an
  // email's subject LINE, receivedAt, gmailMessageId, sourceUrl,
  // pageTitle) live only on SourceRecord.metadata / the transient Check
  // Email response — AuthShell.jsx's createIngestionCandidate call never
  // copies any of them onto an IngestionCandidate in the first place, so
  // they can never legitimately reach this function at all. Included
  // anyway here as a defensive contamination probe.
  const emailCandidate = {
    proposedType: "school_event",
    title: "Back to School Night",
    subject: "Language Arts - Reading/Comprehension",
    targetType: "review",
    targetChildId: null,
    senderEmail: "mmanson@school.org",
    senderName: "Michelle Manson",
    emailSubjectLine: "Weekly Classroom Update",
    receivedAt: "2026-09-18T15:30:00.000Z",
    gmailMessageId: "gmail-msg-123",
    sourceUrl: "https://school.edu/signup",
    pageTitle: "Ms. Rivera's Classroom",
  };
  const draft = candidateToDraftItem(emailCandidate, null);
  const draftKeys = Object.keys(draft);
  const forbidden = ["senderEmail", "senderName", "emailSubjectLine", "receivedAt", "gmailMessageId", "sourceUrl", "pageTitle"];
  ok("The draft item's keys are exactly the expected Item fields, nothing extra", JSON.stringify(draftKeys.sort()) === JSON.stringify(["academicTopic", "academicUnit", "allDay", "childIds", "dueDate", "dueTime", "endTime", "notes", "preparationRequired", "schedule", "startDate", "startTime", "subject", "title", "type"].sort()));
  ok("No sender/subject-line/received/source/webpage field ever appears on the draft item", forbidden.every((key) => !(key in draft)));
  ok("The draft's own 'subject' field is still correctly the Item's academic subject (unaffected, legitimately passed through)", draft.subject === "Language Arts - Reading/Comprehension");
}

// ============ Date/time review-UX simplification (#26, Commit 5 review-UX fix) ============
// Scenario: single-day timed event (e.g. "Back to School Night, Sept 15,
// 6:00 PM - 7:30 PM"). The compact review UI (ItemForm's compactDateTime
// prop) shows Date + Start Time + End Time for this — allDay must default
// to false so the time fields are actually visible.
{
  const draft = candidateToDraftItem({ proposedType: "school_event", title: "Back to School Night", date: "2026-09-15", startTime: "18:00", endTime: "19:30" }, null);
  ok("Date + start/end time: startDate is set", draft.startDate === "2026-09-15");
  ok("Date + start/end time: startTime is set", draft.startTime === "18:00");
  ok("Date + start/end time: endTime is set", draft.endTime === "19:30");
  ok("Date + start/end time: allDay is false so the time fields are shown", draft.allDay === false);
}

// Scenario: date + a start time but no end time (source gave one time, not
// a range) — endTime must stay null rather than being fabricated to match
// startTime or defaulted to anything.
{
  const draft = candidateToDraftItem({ proposedType: "school_event", title: "Assembly", date: "2026-10-01", startTime: "09:00" }, null);
  ok("Date + start time only: startTime is set", draft.startTime === "09:00");
  ok("Date + start time only: endTime is NOT fabricated, stays null", draft.endTime === null);
  ok("Date + start time only: allDay is still false (a real time was extracted)", draft.allDay === false);
}

// Scenario: single-day all-day event — no time at all extracted for a
// school/family event. Existing All Day behavior is retained (allDay true).
{
  const draft = candidateToDraftItem({ proposedType: "family_event", title: "No School Day", date: "2026-11-03" }, null);
  ok("All-day event: date is set", draft.startDate === "2026-11-03");
  ok("All-day event: no fabricated startTime", draft.startTime === null);
  ok("All-day event: no fabricated endTime", draft.endTime === null);
  ok("All-day event: allDay defaults to true, matching the existing All Day convention", draft.allDay === true);
}

// Scenario: test/assignment/reminder with only a date — normally Date
// only, since no time was ever extracted.
for (const type of ["test", "quiz", "reminder"]) {
  const draft = candidateToDraftItem({ proposedType: type, title: "X", date: "2026-09-20" }, null);
  ok(`${type}: date-only obligation has no fabricated startTime`, draft.startTime === null);
  ok(`${type}: date-only obligation has no fabricated endTime`, draft.endTime === null);
  ok(`${type}: date-only obligation defaults to allDay true (Date only, no time UI needed)`, draft.allDay === true);
}
// ...unless the extracted item genuinely has a time (e.g. a test period
// starting at a specific time) — never suppressed just because of type.
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "Timed Test", date: "2026-09-22", startTime: "08:30" }, null);
  ok("A non-event type WITH a genuinely extracted time still surfaces it (allDay false)", draft.allDay === false && draft.startTime === "08:30");
}

// Scenario: due-date types (assignment/project/study_task) map a stated
// start time onto dueTime (there's no "end" concept for a due date), and
// never populate startTime/endTime/allDay-as-false — those fields belong
// to the non-due-date review layout only.
for (const type of ["assignment", "project", "study_task"]) {
  const draft = candidateToDraftItem({ proposedType: type, title: "X", date: "2026-09-25", startTime: "23:59", endTime: "23:59" }, null);
  ok(`${type}: a stated time maps to dueTime, not startTime`, draft.dueTime === "23:59" && draft.startTime === null);
  ok(`${type}: endTime is never set for a due-date type (no "end" concept for a deadline)`, draft.endTime === null);
  ok(`${type}: allDay is always true for a due-date type (time UI lives in the separate Due date field, unaffected)`, draft.allDay === true);
}
{
  const draft = candidateToDraftItem({ proposedType: "assignment", title: "X", date: "2026-09-25" }, null);
  ok("Due-date type with no stated time: dueTime is not fabricated", draft.dueTime === null);
}

// Submitted-values-map-correctly-to-the-existing-Item-model shape proof:
// the draft's date/time keys are exactly itemsRepository.js's own field
// names (startDate/startTime/dueDate/dueTime/endTime/allDay) — no
// renaming, no new top-level shape.
{
  const draft = candidateToDraftItem({ proposedType: "school_event", title: "X", date: "2026-09-15", startTime: "18:00", endTime: "19:30" }, null);
  ok("Uses the canonical Item field name startTime (not e.g. 'time' or 'start')", "startTime" in draft);
  ok("Uses the canonical Item field name endTime (not e.g. 'endTimeOfDay')", "endTime" in draft);
  ok("Uses the canonical Item field name allDay", "allDay" in draft);
}

// ============ Recurring obligations (recurring-obligations increment) —
// recurrenceSuggestion is an ADVISORY-ONLY pre-fill for ItemForm's Repeats
// section, never trusted as final. ============
{
  const draft = candidateToDraftItem(
    { proposedType: "reminder", title: "Send a healthy snack daily", date: "2026-09-14", recurrenceSuggestion: { recurring: true, weekdays: [1, 2, 3, 4, 5], timeMode: null, daypart: null, time: null } },
    null
  );
  ok("A recurring suggestion produces a schedule object with recurring:true", draft.schedule?.recurring === true);
  ok("The suggested weekdays are carried through as-is", JSON.stringify(draft.schedule.weekdays) === JSON.stringify([1, 2, 3, 4, 5]));
  ok("A newly-suggested recurring item's schedule.active defaults to true (nothing has deactivated it — the parent hasn't even approved it yet)", draft.schedule.active === true);
  ok("The source-given date becomes the recurrence's effective start boundary (startDate), not a one-time occurrence date", draft.startDate === "2026-09-14");
  ok("A recurring draft never sets dueDate", draft.dueDate === null);
  ok("A recurring draft's own date/time fields (startTime/endTime) stay null — time lives entirely in schedule", draft.startTime === null && draft.endTime === null);
  ok("A recurring draft defaults allDay to true (same as any other all-day item)", draft.allDay === true);
}
{
  // No source date at all -> defaults to today (household/local, the
  // app/parent's own operational choice, never presented as something the
  // teacher said).
  const draft = candidateToDraftItem(
    { proposedType: "reminder", title: "Review study guides nightly", date: null, recurrenceSuggestion: { recurring: true, weekdays: [1, 2, 3, 4, 5] } },
    null
  );
  ok("A recurring suggestion with no source date defaults startDate to today", draft.startDate === todayStr());
}
{
  // Daypart suggestion carried through.
  const draft = candidateToDraftItem(
    { proposedType: "reminder", title: "Gold folder review", date: "2026-09-14", recurrenceSuggestion: { recurring: true, weekdays: [1], timeMode: "daypart", daypart: "evening" } },
    null
  );
  ok("A daypart timeMode suggestion is carried through", draft.schedule.timeMode === "daypart" && draft.schedule.daypart === "evening");
  ok("daypart mode leaves time null on the draft", draft.schedule.time === null);
}
{
  // Exact-time suggestion carried through.
  const draft = candidateToDraftItem(
    { proposedType: "reminder", title: "Agenda initialing", date: "2026-09-14", recurrenceSuggestion: { recurring: true, weekdays: [1], timeMode: "exact", time: "19:30" } },
    null
  );
  ok("An exact timeMode suggestion is carried through", draft.schedule.timeMode === "exact" && draft.schedule.time === "19:30");
  ok("exact mode leaves daypart null on the draft", draft.schedule.daypart === null);
}
{
  // No recurrenceSuggestion at all (every existing candidate type: photo,
  // CSV, and any non-recurring email obligation) -> schedule stays null,
  // completely unaffected by this increment.
  const draft = candidateToDraftItem({ proposedType: "test", title: "Spelling Test", date: "2026-09-20" }, null);
  ok("A candidate with no recurrenceSuggestion at all produces a null schedule (unaffected, pre-existing behavior)", draft.schedule === null);
  ok("...and is routed through the original non-recurring date logic (a non-due type's date is a startDate)", draft.startDate === "2026-09-20");
}
{
  // recurrenceSuggestion.recurring explicitly false is treated the same as
  // absent — never produces a truthy schedule.
  const draft = candidateToDraftItem({ proposedType: "reminder", title: "X", date: "2026-09-20", recurrenceSuggestion: { recurring: false } }, null);
  ok("recurrenceSuggestion.recurring: false produces a null schedule, same as no suggestion at all", draft.schedule === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
