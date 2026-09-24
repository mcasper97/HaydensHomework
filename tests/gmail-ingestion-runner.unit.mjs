/**
 * Focused unit tests for api/_gmailIngestionRunner.js's
 * runHouseholdEmailIngestion — the real server-side Gmail ingestion seam
 * that replaced api/_scheduledIngestionRunner.js's former
 * GMAIL_INGESTION_SEAM_MISSING placeholder. Every collaborator (scan,
 * createSourceRecord, createCandidate, finalizeCandidate) is injectable
 * via `deps`, so these tests never touch real Firestore, Gmail, or the
 * Anthropic API — no module mocking needed. finalizeCandidateServerSide's
 * OWN confidence/field-completeness/identity rules are already exhaustively
 * covered by tests/scheduled-ingestion-adapter.unit.mjs; these tests only
 * prove runHouseholdEmailIngestion correctly delegates to and respects
 * whatever that shared finalization decides, never reimplementing the
 * decision itself.
 *
 * Usage: node tests/gmail-ingestion-runner.unit.mjs
 */
import { runHouseholdEmailIngestion } from "../api/_gmailIngestionRunner.js";
import { SCAN_ERROR_CODES } from "../api/_gmailIngestionCore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const UID = "gmail-runner-uid-1";

function emailResult(overrides = {}) {
  return {
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    senderEmail: "school@example.com",
    senderName: "School Office",
    subject: "Spelling test Friday",
    receivedAt: "2026-01-14T10:00:00.000Z",
    targetType: "child",
    targetChildId: "hayden",
    linkedUrls: [],
    webpagePages: [],
    obligations: [{ type: "test", title: "Spelling Test", date: "2026-01-16", extractionConfidence: 0.9, sourceUrl: null }],
    extractionFailed: false,
    ...overrides,
  };
}

let sourceRecordSeq = 0;
function baseDeps(overrides = {}) {
  return {
    scan: async () => ({
      ok: true,
      connectedEmail: "parent@example.com",
      senderCount: 1,
      lookbackDays: 14,
      sinceIso: "2026-01-01T00:00:00.000Z",
      matchedCount: 1,
      results: [emailResult()],
    }),
    createSourceRecord: async (uid, data) => { sourceRecordSeq += 1; return { id: `src-${sourceRecordSeq}`, ...data }; },
    createCandidate: async (uid, data) => ({ id: "cand-1", ...data }),
    finalizeCandidate: async () => ({ outcome: "auto_committed", item: { id: "cand-1" } }),
    // No existing Items by default — reconciliation-specific behavior is
    // covered by tests/gmail-ingestion-reconciliation.unit.mjs; these
    // tests only need reconciliation to never MATCH anything.
    listItems: async () => [],
    ...overrides,
  };
}

async function run() {
  // ============ Extracted candidate calls finalizeCandidateServerSide (the shared seam) ============
  {
    const finalizeCalls = [];
    const summary = await runHouseholdEmailIngestion(UID, baseDeps({
      finalizeCandidate: async (uid, candidate) => { finalizeCalls.push({ uid, candidate }); return { outcome: "auto_committed", item: { id: candidate.id } }; },
    }));
    ok("run succeeds", summary.ok === true);
    ok("exactly one candidate was created", summary.candidatesCreated === 1);
    ok("finalizeCandidate (the shared finalization entry point) was called exactly once", finalizeCalls.length === 1);
    ok("finalizeCandidate was called with this household's uid", finalizeCalls[0]?.uid === UID);
    ok("finalizeCandidate was called with the just-created candidate (not the raw obligation)", finalizeCalls[0]?.candidate?.id === "cand-1");
    ok("an auto_committed outcome counts toward itemsCommitted", summary.itemsCommitted === 1);
    ok("one processed message is counted", summary.messagesProcessed === 1);
  }

  // ============ Low-confidence candidate remains review-required through shared finalization ============
  {
    const summary = await runHouseholdEmailIngestion(UID, baseDeps({
      // Mirrors exactly what finalizeCandidateServerSide itself returns for
      // a low-confidence candidate (see tests/scheduled-ingestion-adapter.unit.mjs)
      // — this test proves the RUNNER respects that outcome, not that the
      // confidence math itself is correct (already proven elsewhere).
      finalizeCandidate: async () => ({ outcome: "pending", decision: { eligible: false, reasons: ["low_confidence"] } }),
    }));
    ok("a non-auto_committed outcome never counts toward itemsCommitted", summary.itemsCommitted === 0);
    ok("a non-auto_committed outcome counts toward reviewRequired instead", summary.reviewRequired === 1);
    ok("the candidate itself was still created (left for Review Inbox, not lost)", summary.candidatesCreated === 1);
  }

  // ============ One message failure does not stop another message ============
  {
    const created = [];
    const summary = await runHouseholdEmailIngestion(UID, baseDeps({
      scan: async () => ({
        ok: true,
        connectedEmail: "parent@example.com",
        senderCount: 1,
        lookbackDays: 14,
        sinceIso: "2026-01-01T00:00:00.000Z",
        matchedCount: 2,
        results: [
          emailResult({ gmailMessageId: "msg-fail" }),
          emailResult({ gmailMessageId: "msg-ok" }),
        ],
      }),
      createSourceRecord: async (uid, data) => {
        if (data.metadata?.gmailMessageId === "msg-fail") throw new Error("Firestore write failed");
        created.push(data.metadata?.gmailMessageId);
        return { id: `src-${created.length}`, ...data };
      },
    }));
    ok("the failing message is recorded as an error, not thrown out of the run", summary.errors.some((e) => e.gmailMessageId === "msg-fail"));
    ok("the failing message does not count as processed", summary.messagesProcessed === 1);
    ok("the OTHER message in the same run was still processed", created.includes("msg-ok"));
    ok("the run as a whole still reports ok:true (a per-message failure is not a household-level auth failure)", summary.ok === true);
  }

  // ============ Gmail auth failure returns reconnect-required and stops household processing ============
  {
    const calls = { createSourceRecord: 0, createCandidate: 0, finalizeCandidate: 0 };
    const summary = await runHouseholdEmailIngestion(UID, {
      scan: async () => ({ ok: false, code: SCAN_ERROR_CODES.RECONNECT_REQUIRED, error: "Gmail needs to be reconnected.", needsReconnect: true }),
      createSourceRecord: async () => { calls.createSourceRecord += 1; return { id: "should-not-be-called" }; },
      createCandidate: async () => { calls.createCandidate += 1; return { id: "should-not-be-called" }; },
      finalizeCandidate: async () => { calls.finalizeCandidate += 1; return { outcome: "auto_committed" }; },
    });
    ok("an auth failure is reported as ok:false", summary.ok === false);
    ok("the auth failure carries the reconnect-required code", summary.code === SCAN_ERROR_CODES.RECONNECT_REQUIRED);
    ok("needsReconnect:true is surfaced on the run summary", summary.needsReconnect === true);
    ok("no SourceRecord was ever created (no Review Inbox noise)", calls.createSourceRecord === 0);
    ok("no candidate was ever created (no Review Inbox noise)", calls.createCandidate === 0);
    ok("finalizeCandidate was never reached", calls.finalizeCandidate === 0);
  }

  // ============ Not-connected / no-senders also stop cleanly (same ok:false shape) ============
  {
    const summary = await runHouseholdEmailIngestion(UID, {
      ...baseDeps(),
      scan: async () => ({ ok: false, code: SCAN_ERROR_CODES.NOT_CONNECTED, error: "Gmail is not connected yet." }),
    });
    ok("a not-connected household stops with ok:false and the right code", summary.ok === false && summary.code === SCAN_ERROR_CODES.NOT_CONNECTED);
    ok("needsReconnect is omitted (not a genuine auth failure) rather than falsely true", !summary.needsReconnect);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
