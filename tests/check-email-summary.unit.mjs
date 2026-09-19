/**
 * Unit tests for src/organizer/checkEmailSummary.js's
 * summarizeCheckEmailResult (live-failure follow-up fix). Pure function,
 * zero JSX/React — takes the exact shape checkGmailEmail() returns.
 *
 * Usage: node tests/check-email-summary.unit.mjs
 */
import { summarizeCheckEmailResult } from "../src/organizer/checkEmailSummary.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ No checkResult at all yet (Check Email hasn't been run) ============
ok("null checkResult: null", summarizeCheckEmailResult(null) === null);
ok("undefined checkResult: null", summarizeCheckEmailResult(undefined) === null);

// ============ No new emails found ============
{
  const msg = summarizeCheckEmailResult({ results: [], senderCount: 2, lookbackDays: 14 });
  ok("Zero results: 'No new emails found' with sender/lookback details", msg === "No new emails found from your 2 approved senders in the last 14 days.");
}
{
  const msg = summarizeCheckEmailResult({ results: [], senderCount: 1, lookbackDays: 14 });
  ok("Singular sender count is grammatically correct", msg === "No new emails found from your 1 approved sender in the last 14 days.");
}

// ============ "review below" only appears when at least one candidate (obligation) actually exists ============
{
  const msg = summarizeCheckEmailResult({
    results: [{ obligations: [{ title: "X" }], extractionFailed: false }],
    senderCount: 1,
    lookbackDays: 14,
  });
  ok("At least one obligation found: says 'review below'", msg === "Checked 1 new email from the last 14 days — review below.");
}
{
  const msg = summarizeCheckEmailResult({
    results: [
      { obligations: [{ title: "X" }], extractionFailed: false },
      { obligations: [], extractionFailed: false },
    ],
    senderCount: 2,
    lookbackDays: 14,
  });
  ok("Pluralizes correctly for multiple emails checked", msg === "Checked 2 new emails from the last 14 days — review below.");
}
// ============ Mixed batch: candidates exist AND another email failed extraction
// (correction — this must never look like a fully-successful batch) ============
{
  // Candidates + exactly one extraction failure.
  const msg = summarizeCheckEmailResult({
    results: [
      { obligations: [{ title: "X" }], extractionFailed: false },
      { obligations: [], extractionFailed: true },
    ],
    senderCount: 2,
    lookbackDays: 14,
  });
  ok("Still says 'review below' — a real candidate is never hidden", msg.includes("review below"));
  ok("ALSO reports the extraction failure — never looks like a fully-successful batch", msg.includes("couldn't extract school information from 1 email"));
  ok("Exact combined wording", msg === "Checked 2 new emails from the last 14 days — review below. We couldn't extract school information from 1 email; please try again.");
}
{
  // Candidates + multiple extraction failures.
  const msg = summarizeCheckEmailResult({
    results: [
      { obligations: [{ title: "X" }], extractionFailed: false },
      { obligations: [], extractionFailed: true },
      { obligations: [], extractionFailed: true },
    ],
    senderCount: 3,
    lookbackDays: 14,
  });
  ok("Still says 'review below' with multiple failures present too", msg.includes("review below"));
  ok("Pluralizes the failure count correctly (2 emails, not '2 email')", msg.includes("couldn't extract school information from 2 emails"));
  ok("Exact combined wording for multiple failures", msg === "Checked 3 new emails from the last 14 days — review below. We couldn't extract school information from 2 emails; please try again.");
}
{
  // Multiple candidates, multiple failures, in the same batch.
  const msg = summarizeCheckEmailResult({
    results: [
      { obligations: [{ title: "X" }, { title: "Y" }], extractionFailed: false },
      { obligations: [{ title: "Z" }], extractionFailed: false },
      { obligations: [], extractionFailed: true },
    ],
    senderCount: 3,
    lookbackDays: 14,
  });
  ok("Multiple candidates across multiple emails still combines with the failure note", msg === "Checked 3 new emails from the last 14 days — review below. We couldn't extract school information from 1 email; please try again.");
}

// ============ Extraction failure (zero candidates) ============
{
  const msg = summarizeCheckEmailResult({
    results: [{ obligations: [], extractionFailed: true }],
    senderCount: 1,
    lookbackDays: 14,
  });
  ok("Exact wording for a single failed extraction", msg === "Checked 1 new email, but we couldn't extract its school information. Please try again.");
  ok("Never says 'review below' when extraction failed and nothing was found", !msg.includes("review below"));
}
{
  const msg = summarizeCheckEmailResult({
    results: [
      { obligations: [], extractionFailed: true },
      { obligations: [], extractionFailed: true },
    ],
    senderCount: 2,
    lookbackDays: 14,
  });
  ok("Sensible pluralization for multiple failed extractions", msg === "Checked 2 new emails, but we couldn't extract their school information. Please try again.");
}

// ============ Successfully processed, no actionable obligations ============
{
  const msg = summarizeCheckEmailResult({
    results: [{ obligations: [], extractionFailed: false }],
    senderCount: 1,
    lookbackDays: 14,
  });
  ok("Exact wording for zero actionable items", msg === "Checked 1 new email. No actionable items found.");
  ok("Never says 'review below' when there's nothing to review", !msg.includes("review below"));
}
{
  const msg = summarizeCheckEmailResult({
    results: [
      { obligations: [], extractionFailed: false },
      { obligations: [], extractionFailed: false },
    ],
    senderCount: 2,
    lookbackDays: 14,
  });
  ok("Pluralizes correctly for multiple no-actionable-items emails", msg === "Checked 2 new emails. No actionable items found.");
}

// ============ Malformed/missing input never throws ============
ok("results missing entirely on checkResult: treated as zero results", summarizeCheckEmailResult({ senderCount: 1, lookbackDays: 14 }).startsWith("No new emails found"));
ok("A null entry in results doesn't throw", (() => {
  try {
    summarizeCheckEmailResult({ results: [null, { obligations: [{ title: "X" }] }], senderCount: 1, lookbackDays: 14 });
    return true;
  } catch {
    return false;
  }
})());
ok("A result with no obligations key at all doesn't throw and counts as zero", summarizeCheckEmailResult({ results: [{}], senderCount: 1, lookbackDays: 14 }) === "Checked 1 new email. No actionable items found.");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
