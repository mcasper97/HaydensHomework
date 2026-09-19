/**
 * Unit tests for src/organizer/googleDocCheckSummary.js's
 * summarizeGoogleDocOutcomes (#26, Commit 6) — the concise, one-sentence
 * Check Email result banner distinguishing "requires access" from
 * "fetch failed" for linked Google Docs. Pure function, zero JSX/React —
 * takes the exact `results` shape checkGmailEmail() returns.
 *
 * Usage: node tests/google-doc-check-summary.unit.mjs
 */
import { summarizeGoogleDocOutcomes } from "../src/organizer/googleDocCheckSummary.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ No Google Doc links at all this run ============
ok("Empty results: null (nothing to say)", summarizeGoogleDocOutcomes([]) === null);
ok("No webpagePages at all on any result: null", summarizeGoogleDocOutcomes([{ webpagePages: [] }]) === null);
ok("Only webpage-type pages, none google_doc: null", summarizeGoogleDocOutcomes([{ webpagePages: [{ type: "webpage", fetched: true }] }]) === null);

// ============ Every Google Doc succeeded (with or without candidates) — no message ============
ok(
  "A fetched google_doc page produces no message, regardless of whether it had obligations",
  summarizeGoogleDocOutcomes([{ webpagePages: [{ type: "google_doc", fetched: true, documentId: "abc" }] }]) === null
);

// ============ requires_authentication ============
{
  const msg = summarizeGoogleDocOutcomes([{ webpagePages: [{ type: "google_doc", fetched: false, failureReason: "requires_authentication" }] }]);
  ok("Singular 'requires access' message for exactly one", msg === 'Google document requires access — share it ("Anyone with the link can view") and try Check Email again.');
}
{
  const results = [
    { webpagePages: [{ type: "google_doc", fetched: false, failureReason: "requires_authentication" }] },
    { webpagePages: [{ type: "google_doc", fetched: false, failureReason: "requires_authentication" }] },
  ];
  const msg = summarizeGoogleDocOutcomes(results);
  ok("Plural count across multiple emails in the same Check Email run", msg.startsWith("2 linked Google documents require access"));
}

// ============ fetch_failed (not an access issue) ============
{
  const msg = summarizeGoogleDocOutcomes([{ webpagePages: [{ type: "google_doc", fetched: false, failureReason: "fetch_failed" }] }]);
  ok("Singular 'couldn't be retrieved' message, distinct wording from requires_authentication", msg === "A linked Google document couldn't be retrieved.");
  ok("Does not claim access is the issue when it wasn't", !msg.toLowerCase().includes("access"));
}
{
  const results = [{ webpagePages: [
    { type: "google_doc", fetched: false, failureReason: "fetch_failed" },
    { type: "google_doc", fetched: false, failureReason: "fetch_failed" },
    { type: "google_doc", fetched: false, failureReason: "fetch_failed" },
  ] }];
  ok("Plural count for multiple fetch failures", summarizeGoogleDocOutcomes(results) === "3 linked Google documents couldn't be retrieved.");
}

// ============ Mixed outcomes ============
{
  const results = [{ webpagePages: [
    { type: "google_doc", fetched: false, failureReason: "requires_authentication" },
    { type: "google_doc", fetched: false, failureReason: "fetch_failed" },
    { type: "google_doc", fetched: true, documentId: "ok-one" }, // succeeded — doesn't affect the message
    { type: "webpage", fetched: false }, // a failed WEBPAGE — never counted here, webpage failures have their own precedent
  ] }];
  const msg = summarizeGoogleDocOutcomes(results);
  ok("A mix of requires_authentication and fetch_failed gets a generic combined message", msg.toLowerCase().includes("some linked google documents"));
}

// ============ A failed webpage never triggers a Google Doc message ============
ok(
  "A failed WEBPAGE (not a google_doc) produces no Google-Doc-specific message",
  summarizeGoogleDocOutcomes([{ webpagePages: [{ type: "webpage", fetched: false }] }]) === null
);

// ============ Malformed/missing input never throws ============
ok("null results doesn't throw, returns null", summarizeGoogleDocOutcomes(null) === null);
ok("undefined results doesn't throw, returns null", summarizeGoogleDocOutcomes(undefined) === null);
ok("A result with no webpagePages key at all doesn't throw", summarizeGoogleDocOutcomes([{}]) === null);
ok("A null entry in results doesn't throw", summarizeGoogleDocOutcomes([null, { webpagePages: [{ type: "google_doc", fetched: true }] }]) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
