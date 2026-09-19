/**
 * Pure unit tests for api/extract-obligations.js's exported sanitization
 * functions — no network, no live Anthropic API key, no Firebase project
 * needed. This is the one piece of the photo-ingestion vertical slice that
 * CAN be tested in this sandbox without live credentials (see the
 * ingestion planning report's testing-strategy limitation note): the
 * actual Anthropic call and Firebase ID-token verification require a real
 * ANTHROPIC_API_KEY / Firebase project and are not exercised here.
 *
 * Usage: node tests/extract-obligations.unit.mjs
 */
import { sanitizeObligationsResponse, isAllowedMimeType } from "../api/extract-obligations.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ isAllowedMimeType ============
ok("Allows image/jpeg", isAllowedMimeType("image/jpeg"));
ok("Allows image/png", isAllowedMimeType("image/png"));
ok("Allows image/webp", isAllowedMimeType("image/webp"));
ok("Rejects application/pdf (out of scope for this slice)", !isAllowedMimeType("application/pdf"));
ok("Rejects image/gif", !isAllowedMimeType("image/gif"));
ok("Rejects text/plain", !isAllowedMimeType("text/plain"));

// ============ Malformed top-level shape ============
try {
  sanitizeObligationsResponse(null);
  ok("Throws on null input", false);
} catch {
  ok("Throws on null input", true);
}
try {
  sanitizeObligationsResponse({ notObligations: [] });
  ok("Throws when obligations key is missing", false);
} catch {
  ok("Throws when obligations key is missing", true);
}
try {
  sanitizeObligationsResponse({ obligations: "not an array" });
  ok("Throws when obligations is not an array", false);
} catch {
  ok("Throws when obligations is not an array", true);
}

// ============ Empty result (valid, not an error) ============
{
  const r = sanitizeObligationsResponse({ obligations: [] });
  ok("Empty obligations array is valid, not thrown", Array.isArray(r.obligations) && r.obligations.length === 0);
}

// ============ Valid obligation passes through with all fields ============
{
  const r = sanitizeObligationsResponse({
    obligations: [
      {
        type: "test",
        title: "Chapter 4 Math Test",
        childName: "Ava",
        date: "2026-10-01",
        subject: "Math",
        academicTopic: "Fractions",
        academicUnit: "Unit 3",
        preparationRequired: true,
        description: "Study the worksheet from Monday.",
        extractionConfidence: 0.9,
      },
    ],
  });
  const o = r.obligations[0];
  ok("Valid obligation kept", r.obligations.length === 1);
  ok("type preserved", o.type === "test");
  ok("title preserved", o.title === "Chapter 4 Math Test");
  ok("childName preserved", o.childName === "Ava");
  ok("date preserved", o.date === "2026-10-01");
  ok("subject preserved", o.subject === "Math");
  ok("academicTopic preserved", o.academicTopic === "Fractions");
  ok("academicUnit preserved", o.academicUnit === "Unit 3");
  ok("preparationRequired preserved", o.preparationRequired === true);
  ok("description preserved", o.description === "Study the worksheet from Monday.");
  ok("extractionConfidence preserved", o.extractionConfidence === 0.9);
}

// ============ Invalid type is dropped, not coerced ============
{
  const r = sanitizeObligationsResponse({
    obligations: [
      { type: "chore", title: "Chores are not creatable via the manual form either" },
      { type: "not_a_real_type", title: "Should be dropped" },
    ],
  });
  ok("Obligations with invalid/unsupported type are dropped entirely", r.obligations.length === 0);
}

// ============ Missing required title is dropped ============
{
  const r = sanitizeObligationsResponse({ obligations: [{ type: "assignment", title: "" }, { type: "assignment" }] });
  ok("Obligation missing a real title is dropped", r.obligations.length === 0);
}

// ============ Malformed date normalizes to null, never guessed ============
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "Field trip form due", date: "next Tuesday" }],
  });
  ok("Non-ISO date is normalized to null, not passed through", r.obligations[0].date === null);
}
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "Field trip form due", date: "2026-10-01" }],
  });
  ok("Valid ISO date is preserved", r.obligations[0].date === "2026-10-01");
}

// ============ Non-boolean preparationRequired normalizes to null ============
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "quiz", title: "Spelling quiz", preparationRequired: "yes" }],
  });
  ok("Non-boolean preparationRequired normalizes to null", r.obligations[0].preparationRequired === null);
}

// ============ Out-of-range confidence normalizes to null ============
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "quiz", title: "Spelling quiz", extractionConfidence: 1.5 }],
  });
  ok("Out-of-range confidence normalizes to null", r.obligations[0].extractionConfidence === null);
}

// ============ Oversized title is dropped, not truncated ============
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "assignment", title: "x".repeat(500) }],
  });
  ok("Obligation with an over-length title is dropped (not silently truncated)", r.obligations.length === 0);
}

// ============ Partial extraction: some valid, some invalid, in one response ============
{
  const r = sanitizeObligationsResponse({
    obligations: [
      { type: "test", title: "Valid one" },
      { type: "bogus", title: "Invalid type" },
      { type: "quiz", title: "" },
      { type: "project", title: "Valid two", date: "2026-11-05" },
    ],
  });
  ok("Partial extraction keeps only the valid entries (2 of 4)", r.obligations.length === 2);
  ok("Partial extraction preserves order of valid entries", r.obligations[0].title === "Valid one" && r.obligations[1].title === "Valid two");
}

// ============ Subject is enum-validated against SUBJECT_OPTIONS (Issue 2 fix) ============
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "quiz", title: "Phonics Quiz", subject: "Language Arts - Reading/Comprehension" }],
  });
  ok("A valid non-Math subject (e.g. reading/phonics) is preserved as-is", r.obligations[0].subject === "Language Arts - Reading/Comprehension");
}
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "quiz", title: "Phonics Quiz", subject: "Reading" }],
  });
  ok("A subject value outside the enum (not an exact SUBJECT_OPTIONS match) is dropped to null, not trusted as free text", r.obligations[0].subject === null);
}
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "school_event", title: "Field Day" }],
  });
  ok("Missing subject normalizes to null", r.obligations[0].subject === null);
}

// ============ Result is capped at MAX_OBLIGATIONS (20) ============
{
  const many = Array.from({ length: 30 }, (_, i) => ({ type: "assignment", title: `Item ${i}` }));
  const r = sanitizeObligationsResponse({ obligations: many });
  ok("Obligations list is capped at 20 even if the model returns more", r.obligations.length === 20);
}

// ============ sourceUrl passthrough (#26, Commit 5 correction — email-led ingestion's
// per-obligation source attribution; additive, only ever set by api/_emailExtraction.js) ============
{
  const result = sanitizeObligationsResponse({ obligations: [{ type: "assignment", title: "X", sourceUrl: "https://school.edu/page" }] });
  ok("A valid sourceUrl string passes through", result.obligations[0].sourceUrl === "https://school.edu/page");
}
{
  const result = sanitizeObligationsResponse({ obligations: [{ type: "assignment", title: "X" }] });
  ok("Missing sourceUrl (the photo pipeline's case — it never sets this field) normalizes to null", result.obligations[0].sourceUrl === null);
}
{
  const result = sanitizeObligationsResponse({ obligations: [{ type: "assignment", title: "X", sourceUrl: 12345 }] });
  ok("A non-string sourceUrl is dropped to null, not coerced", result.obligations[0].sourceUrl === null);
}
{
  const result = sanitizeObligationsResponse({ obligations: [{ type: "assignment", title: "X", sourceUrl: "" }] });
  ok("An empty-string sourceUrl normalizes to null", result.obligations[0].sourceUrl === null);
}

// ============ startTime/endTime passthrough (#26, Commit 5 review-UX fix — email-led
// ingestion's optional time fields; additive, only ever set by api/_emailExtraction.js) ============
{
  const result = sanitizeObligationsResponse({ obligations: [{ type: "school_event", title: "X", startTime: "18:00", endTime: "19:30" }] });
  ok("A valid HH:MM startTime passes through", result.obligations[0].startTime === "18:00");
  ok("A valid HH:MM endTime passes through", result.obligations[0].endTime === "19:30");
}
{
  const result = sanitizeObligationsResponse({ obligations: [{ type: "test", title: "X" }] });
  ok("Missing startTime (the photo pipeline's case — it never sets this field) normalizes to null", result.obligations[0].startTime === null);
  ok("Missing endTime normalizes to null", result.obligations[0].endTime === null);
}
{
  const result = sanitizeObligationsResponse({ obligations: [{ type: "school_event", title: "X", startTime: "6pm", endTime: "18:5" }] });
  ok("A startTime not matching HH:MM is dropped to null, not coerced", result.obligations[0].startTime === null);
  ok("An endTime not matching HH:MM (wrong digit count) is dropped to null", result.obligations[0].endTime === null);
}
{
  const result = sanitizeObligationsResponse({ obligations: [{ type: "school_event", title: "X", startTime: 1800, endTime: null }] });
  ok("A non-string startTime is dropped to null, not coerced", result.obligations[0].startTime === null);
  ok("An explicit null endTime stays null", result.obligations[0].endTime === null);
}

// ============ recurring/weekdays/timeMode/daypart/time sanitization
// (recurring-obligations increment; additive, only ever set by
// api/_emailExtraction.js — the photo pipeline's prompt never produces
// these fields) ============
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "Send a healthy snack daily", recurring: true, weekdays: [1, 2, 3, 4, 5] }],
  });
  const o = result.obligations[0];
  ok("recurring:true with valid weekdays is preserved", o.recurring === true);
  ok("weekdays array is preserved, sorted", JSON.stringify(o.weekdays) === JSON.stringify([1, 2, 3, 4, 5]));
  ok("No timeMode given -> timeMode/daypart/time are all null (never fabricated)", o.timeMode === null && o.daypart === null && o.time === null);
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "test", title: "X" }],
  });
  const o = result.obligations[0];
  ok("The photo pipeline's case (no recurring fields at all) normalizes to recurring:false", o.recurring === false);
  ok("...with an empty weekdays array", JSON.stringify(o.weekdays) === JSON.stringify([]));
  ok("...and no time signal", o.timeMode === null && o.daypart === null && o.time === null);
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "X", recurring: true, weekdays: [] }],
  });
  ok("recurring:true with zero weekdays normalizes to recurring:false — not a usable schedule, never trusted as-is", result.obligations[0].recurring === false);
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "X", recurring: true, weekdays: [1, 1, 8, -1, 3] }],
  });
  ok("Out-of-range/duplicate weekday values are dropped/de-duplicated, not trusted as-is", JSON.stringify(result.obligations[0].weekdays) === JSON.stringify([1, 3]));
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "X", recurring: "yes", weekdays: [1] }],
  });
  ok("A non-boolean-true recurring value never coerces to true", result.obligations[0].recurring === false);
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "Review study guides nightly", recurring: true, weekdays: [1, 2, 3, 4, 5], timeMode: "daypart", daypart: "evening" }],
  });
  const o = result.obligations[0];
  ok("Valid daypart timeMode is preserved", o.timeMode === "daypart" && o.daypart === "evening");
  ok("daypart mode leaves time null (XOR invariant enforced at the boundary, not just relied on from the prompt)", o.time === null);
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "Gold folder returns Monday", recurring: true, weekdays: [1], timeMode: "exact", time: "07:45" }],
  });
  const o = result.obligations[0];
  ok("Valid exact timeMode is preserved", o.timeMode === "exact" && o.time === "07:45");
  ok("exact mode leaves daypart null (XOR invariant)", o.daypart === null);
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "X", recurring: true, weekdays: [1], timeMode: "daypart", daypart: "afternoon" }],
  });
  ok("An invalid daypart value ('afternoon' — not morning/evening) falls back to no time signal, never trusted as-is", result.obligations[0].timeMode === null);
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "X", recurring: true, weekdays: [1], timeMode: "exact", time: "7:45am" }],
  });
  ok("A malformed exact time string falls back to no time signal, never coerced", result.obligations[0].timeMode === null);
}
{
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "reminder", title: "X", recurring: true, weekdays: [1], timeMode: "exact", time: "07:45", daypart: "morning" }],
  });
  const o = result.obligations[0];
  ok("timeMode governs which of daypart/time is kept — both given never both survive", o.timeMode === "exact" && o.time === "07:45" && o.daypart === null);
}
{
  // Non-recurring obligations must never carry a time-signal artifact even
  // if the model mistakenly included one.
  const result = sanitizeObligationsResponse({
    obligations: [{ type: "assignment", title: "X", recurring: false, weekdays: [1], timeMode: "exact", time: "07:45" }],
  });
  const o = result.obligations[0];
  ok("A non-recurring obligation never carries a timeMode/daypart/time, even if the model set one", o.timeMode === null && o.daypart === null && o.time === null);
  ok("...and its weekdays array is empty, not whatever the model happened to send", JSON.stringify(o.weekdays) === JSON.stringify([]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
