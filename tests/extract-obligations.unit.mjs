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

// ============ Result is capped at MAX_OBLIGATIONS (20) ============
{
  const many = Array.from({ length: 30 }, (_, i) => ({ type: "assignment", title: `Item ${i}` }));
  const r = sanitizeObligationsResponse({ obligations: many });
  ok("Obligations list is capped at 20 even if the model returns more", r.obligations.length === 20);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
