/**
 * Focused unit test proving BOTH extraction paths (photo:
 * api/extract-obligations.js, email: api/_emailExtraction.js) actually
 * request extractionConfidence from the model — not merely accept it if
 * offered. This is the exact gap the auto-commit architecture correction
 * identified: neither prompt used to ask for it at all, so the field was
 * effectively always null in production despite existing in the candidate
 * schema and being read by sanitizeObligation.
 *
 * Usage: node tests/extraction-confidence.unit.mjs
 */
import fs from "node:fs";
import { sanitizeObligationsResponse } from "../api/extract-obligations.js";
import { EXTRACT_OBLIGATIONS_TOOL } from "../api/_emailExtraction.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ Photo prompt actually asks for confidence ============
{
  const source = fs.readFileSync(new URL("../api/extract-obligations.js", import.meta.url), "utf8");
  ok('The photo prompt\'s JSON shape example includes "extractionConfidence"', /"extractionConfidence"\s*:/.test(source));
  ok(
    "The photo prompt explains extractionConfidence is about obligation/field correctness, not field presence",
    /extractionConfidence is REQUIRED/.test(source) && /is NOT[\s\S]{0,20}about whether/i.test(source)
  );
  ok(
    'The photo prompt instructs the model NOT to inflate confidence merely for filling in every field',
    /[Nn]ever[\s\S]{0,20}inflate this score merely because/.test(source)
  );
  ok(
    "The photo prompt explicitly calls out an inferred/guessed date as a reason to score confidence low",
    /a date you had to infer or guess at/.test(source)
  );
}

// ============ Email tool schema requires confidence ============
{
  const props = EXTRACT_OBLIGATIONS_TOOL.input_schema.properties.obligations.items.properties;
  ok('The email tool schema documents extractionConfidence as a number', props.extractionConfidence?.type === "number");
  ok(
    "The email tool schema's per-obligation required list includes extractionConfidence (forced tool use cannot omit it)",
    EXTRACT_OBLIGATIONS_TOOL.input_schema.properties.obligations.items.required.includes("extractionConfidence")
  );

  const source = fs.readFileSync(new URL("../api/_emailExtraction.js", import.meta.url), "utf8");
  ok(
    "The email prompt explains extractionConfidence is about obligation/field correctness, not field presence",
    /extractionConfidence is REQUIRED/.test(source) && /is NOT[\s\S]{0,20}about whether/i.test(source)
  );
  ok(
    "The email prompt instructs the model NOT to inflate confidence merely for filling in every field",
    /[Nn]ever[\s\S]{0,20}inflate this score merely because/.test(source)
  );
  ok(
    "The email prompt explicitly calls out an inferred (not directly read) date/time as a reason to score confidence low",
    /a date or time you had to infer rather than read directly/.test(source)
  );
}

// ============ Sanitization still normalizes/validates whatever confidence is given ============
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "quiz", title: "Spelling quiz", extractionConfidence: 0.42 }],
  });
  ok("A valid in-range confidence passes through sanitization unchanged", r.obligations[0].extractionConfidence === 0.42);
}
{
  const r = sanitizeObligationsResponse({
    obligations: [{ type: "quiz", title: "Spelling quiz" }], // model somehow omitted it despite being required
  });
  ok("A missing confidence normalizes to null (never defaulted to a trusting value)", r.obligations[0].extractionConfidence === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
