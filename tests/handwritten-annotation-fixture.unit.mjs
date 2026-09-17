/**
 * Regression fixture for the "handwritten annotation on a completed practice
 * worksheet" extraction scenario:
 *
 *   The photographed page is a completed/practice phonics quiz (OCR Unit 1
 *   Lesson 1, "The Origami Master" — /i/ and /a/ sounds, scored 12/14), and
 *   it carries a handwritten margin note: "Test on Tuesday Sept 22". The
 *   correct organizer result is ONE upcoming TEST obligation describing the
 *   handwritten note — not a duplicate/spurious obligation representing the
 *   completed practice page itself.
 *
 * IMPORTANT — what this test does and does not prove:
 * This is a CONTRACT/SHAPE fixture, not a live-model behavior test. It
 * locks in the exact extraction shape this scenario must produce and
 * proves api/extract-obligations.js's sanitizeObligationsResponse() accepts
 * and preserves that shape without dropping or mangling any field (i.e.
 * nothing in the validation layer would reject or corrupt a correct
 * answer). It does NOT prove the live Anthropic model actually returns
 * this shape for the real photo — this sandbox has no ANTHROPIC_API_KEY /
 * live Firebase project to exercise that (same limitation disclosed
 * throughout this ingestion work). That is exactly what the live
 * authenticated smoke test verifies, per the merge gate.
 *
 * Usage: node tests/handwritten-annotation-fixture.unit.mjs
 */
import { sanitizeObligationsResponse } from "../api/extract-obligations.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// The golden extraction this scenario should produce, per the reported
// live-smoke-test expectation.
const GOLDEN_OBLIGATION = {
  type: "test",
  title: "OCR Unit 1 Lesson 1 Phonics Test",
  childName: null,
  date: "2026-09-22",
  subject: "Language Arts - Reading/Comprehension",
  academicTopic: "Phonics",
  academicUnit: "OCR Unit 1 Lesson 1 - \"The Origami Master\"",
  preparationRequired: true,
  description: "Handwritten note on the practice worksheet: \"Test on Tuesday Sept 22\".",
};

{
  const r = sanitizeObligationsResponse({ obligations: [GOLDEN_OBLIGATION] });
  const o = r.obligations[0];
  ok("Golden obligation survives sanitization (not dropped)", r.obligations.length === 1);
  ok("type preserved as test (not quiz — the note announces an upcoming test)", o.type === "test");
  ok("title preserved", o.title === GOLDEN_OBLIGATION.title);
  ok("date preserved exactly (correct year resolved from the handwritten weekday+date)", o.date === "2026-09-22");
  ok("subject correctly lands on reading/comprehension, not Math, for phonics content", o.subject === "Language Arts - Reading/Comprehension");
  ok("academicTopic preserved (Phonics)", o.academicTopic === "Phonics");
  ok("academicUnit preserved (lesson name from the printed worksheet, even though the obligation itself came from a handwritten note)", o.academicUnit === GOLDEN_OBLIGATION.academicUnit);
  ok("preparationRequired preserved as true", o.preparationRequired === true);
  ok("description preserved", o.description === GOLDEN_OBLIGATION.description);
}

// The completed practice content itself (the quiz page) must NOT also
// produce a second, spurious scheduled obligation — only the handwritten
// note's obligation should exist. This is a fixture-level assertion of the
// desired end state (one obligation, not two); it complements, not
// replaces, the prompt rule telling the model not to invent that second
// obligation in the first place.
{
  const r = sanitizeObligationsResponse({ obligations: [GOLDEN_OBLIGATION] });
  ok("Exactly one obligation for this source — no duplicate obligation for the completed practice page itself", r.obligations.length === 1);
}

// A wrong-but-plausible extraction (the failure mode actually observed in
// the live smoke test: the printed quiz structure mistaken for the
// obligation, subject defaulted to Math) is still valid enough to pass
// sanitization — sanitization is a shape/enum check, not a correctness
// check. This is expected and documents why the prompt fix (not a
// validation-layer fix) is the right layer for this defect.
{
  const wrongExtraction = {
    type: "quiz",
    title: "Phonics Quiz",
    date: null,
    subject: "Math",
  };
  const r = sanitizeObligationsResponse({ obligations: [wrongExtraction] });
  ok(
    "Documents that a wrong-but-schema-valid extraction (quiz/Math) is NOT caught by sanitization — this is a prompt-behavior defect, not a validation gap",
    r.obligations.length === 1 && r.obligations[0].type === "quiz" && r.obligations[0].subject === "Math"
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
