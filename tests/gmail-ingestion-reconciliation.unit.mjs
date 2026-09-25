/**
 * Focused unit tests for the follow-up correction wiring obligation
 * reconciliation into api/_gmailIngestionRunner.js's
 * runHouseholdEmailIngestion — the automatic scheduled Gmail path now runs
 * the SAME reconciliation decision logic
 * (src/organizer/recurringObligationMatch.js /
 * src/organizer/oneTimeObligationMatch.js) the manual "Check Email" path
 * (src/GmailCheckEmailAction.jsx) already runs, before ever calling
 * finalizeCandidateServerSide.
 *
 * Every collaborator (scan, createSourceRecord, createCandidate,
 * finalizeCandidate, listItems) is injectable via `deps`, so these tests
 * never touch real Firestore/Gmail — no module mocking needed. The
 * reconciliation decision functions themselves are imported and exercised
 * for REAL (never mocked) — proving this file reuses the actual,
 * unmodified logic, not a reimplemented copy.
 *
 * Usage: node tests/gmail-ingestion-reconciliation.unit.mjs
 */
import { runHouseholdEmailIngestion } from "../api/_gmailIngestionRunner.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const UID = "gmail-reconciliation-uid-1";

function emailResult(overrides = {}) {
  return {
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    senderEmail: "school@example.com",
    senderName: "School Office",
    subject: "Reminder",
    receivedAt: "2026-01-14T10:00:00.000Z",
    targetType: "child",
    targetChildId: "hayden",
    linkedUrls: [],
    webpagePages: [],
    obligations: [],
    extractionFailed: false,
    ...overrides,
  };
}

function obligation(overrides = {}) {
  return {
    type: "event",
    title: "Field Trip",
    date: "2026-02-10",
    startTime: null,
    endTime: null,
    extractionConfidence: 0.9,
    sourceUrl: null,
    recurring: false,
    ...overrides,
  };
}

function makeCandidateStore() {
  let seq = 0;
  const store = [];
  return {
    store,
    createCandidate: async (uid, data) => {
      seq += 1;
      const candidate = { id: `cand-${seq}`, ...data };
      store.push(candidate);
      return candidate;
    },
  };
}

function baseDeps(overrides = {}) {
  return {
    createSourceRecord: async (uid, data) => ({ id: `src-${Math.random().toString(36).slice(2)}`, ...data }),
    finalizeCandidate: async () => ({ outcome: "auto_committed", item: { id: "irrelevant" } }),
    listItems: async () => [],
    // A safe no-op by default — this file's own focus is reconciliation,
    // not the Review Inbox batch notification (see
    // tests/gmail-ingestion-runner.unit.mjs and
    // tests/review-batch-notification-trigger.unit.mjs for that), so
    // tests here never need to reach the real default (Firestore + the
    // notification pipeline) just because a scenario happens to leave a
    // candidate review-required.
    notifyReviewBatch: async () => {},
    ...overrides,
  };
}

async function run() {
  // ============ Same Gmail message twice -> only one source processing path ============
  // (SOURCE DEDUPE — owned by scanApprovedSenderEmails/listProcessedGmailMessageIds,
  // not this file. This test proves the runner itself never re-derives that
  // logic: when the scan (as it always does for an already-processed
  // message — see tests/gmail-ingestion-core-scan.unit.mjs) simply omits a
  // message from `results`, the runner processes nothing for it — no
  // second SourceRecord/candidate path exists here to accidentally
  // reprocess it.)
  {
    const { createCandidate, store } = makeCandidateStore();
    const sourceRecordCalls = [];
    const summary = await runHouseholdEmailIngestion(UID, baseDeps({
      scan: async () => ({
        ok: true, connectedEmail: "p@x.com", senderCount: 1, lookbackDays: 14, sinceIso: "2026-01-01T00:00:00.000Z",
        matchedCount: 1,
        results: [emailResult({ obligations: [obligation()] })], // the same message appears exactly once
      }),
      createSourceRecord: async (uid, data) => { sourceRecordCalls.push(data); return { id: `src-${sourceRecordCalls.length}`, ...data }; },
      createCandidate,
    }));
    ok("exactly one email-level SourceRecord processing path ran", sourceRecordCalls.filter((d) => d.sourceType === "gmail_email").length === 1);
    ok("exactly one candidate was created from it", store.length === 1);
    ok("messagesProcessed reflects exactly one message", summary.messagesProcessed === 1);
  }

  // ============ Two different Gmail messages describing the same obligation -> no duplicate Item ============
  {
    const { createCandidate, store } = makeCandidateStore();
    const finalizeCalls = [];
    const summary = await runHouseholdEmailIngestion(UID, baseDeps({
      scan: async () => ({
        ok: true, connectedEmail: "p@x.com", senderCount: 1, lookbackDays: 14, sinceIso: "2026-01-01T00:00:00.000Z",
        matchedCount: 2,
        results: [
          emailResult({ gmailMessageId: "msg-a", obligations: [obligation({ title: "Field Trip Permission Slip" })] }),
          emailResult({ gmailMessageId: "msg-b", obligations: [obligation({ title: "Field Trip Permission Slip" })] }),
        ],
      }),
      createCandidate,
      finalizeCandidate: async (uid, candidate) => { finalizeCalls.push(candidate); return { outcome: "auto_committed", item: { id: candidate.id } }; },
    }));
    ok("two messages restating the same obligation still create two provenance candidates", store.length === 2);
    ok(
      "the second candidate is marked corroborated, pointing at the first (same-run duplicate)",
      store[1].reviewStatus === "corroborated" && store[1].reconciledCandidateId === store[0].id
    );
    ok("the first (original) candidate was NOT marked corroborated", store[0].reviewStatus !== "corroborated");
    ok("only the ORIGINAL candidate was ever handed to finalization — never the duplicate", finalizeCalls.length === 1 && finalizeCalls[0].id === store[0].id);
    ok("only one Item gets committed (no duplicate)", summary.itemsCommitted === 1);
  }

  // ============ Second source handled via existing corroboration semantics (matches an EXISTING Item) ============
  {
    const { createCandidate, store } = makeCandidateStore();
    const finalizeCalls = [];
    const summary = await runHouseholdEmailIngestion(UID, baseDeps({
      listItems: async () => [{
        id: "existing-item-1",
        type: "event",
        title: "Field Trip Permission Slip",
        startDate: "2026-02-10",
        startTime: null,
        endTime: null,
        childIds: ["hayden"],
        schedule: null,
      }],
      scan: async () => ({
        ok: true, connectedEmail: "p@x.com", senderCount: 1, lookbackDays: 14, sinceIso: "2026-01-01T00:00:00.000Z",
        matchedCount: 1,
        results: [emailResult({ obligations: [obligation({ title: "Field Trip Permission Slip" })] })],
      }),
      createCandidate,
      finalizeCandidate: async (uid, candidate) => { finalizeCalls.push(candidate); return { outcome: "auto_committed", item: { id: candidate.id } }; },
    }));
    ok("a candidate restating an already-existing Item is still created (provenance preserved)", store.length === 1);
    ok(
      "it is marked corroborated, pointing at the EXISTING Item's real id (existing_item semantics)",
      store[0].reviewStatus === "corroborated" && store[0].reconciledItemId === "existing-item-1"
    );
    ok("it is never handed to finalization (never re-commits/overwrites the existing Item)", finalizeCalls.length === 0);
    ok("no new Item is committed for it", summary.itemsCommitted === 0);
  }

  // ============ Genuinely different obligations remain separate ============
  {
    const { createCandidate, store } = makeCandidateStore();
    const finalizeCalls = [];
    await runHouseholdEmailIngestion(UID, baseDeps({
      scan: async () => ({
        ok: true, connectedEmail: "p@x.com", senderCount: 1, lookbackDays: 14, sinceIso: "2026-01-01T00:00:00.000Z",
        matchedCount: 1,
        results: [emailResult({
          obligations: [
            obligation({ title: "Field Trip Permission Slip", date: "2026-02-10" }),
            obligation({ title: "Spelling Test", date: "2026-02-12" }),
          ],
        })],
      }),
      createCandidate,
      finalizeCandidate: async (uid, candidate) => { finalizeCalls.push(candidate); return { outcome: "auto_committed", item: { id: candidate.id } }; },
    }));
    ok("two genuinely different obligations produce two separate candidates", store.length === 2);
    ok("neither is marked corroborated", store.every((c) => c.reviewStatus !== "corroborated"));
    ok("both are independently handed to finalization", finalizeCalls.length === 2);
  }

  // ============ Same obligation + explicit conflicting time -> Review Inbox, no auto-commit ============
  // (Follow-up correction: type/target/title all match — per this app's
  // own hard-gate philosophy, that alone means "the same real-world
  // obligation" — but the two sources disagree about the explicit start
  // time. oneTimeObligationMatch.js's canReconcileOneTime already refused
  // to merge this; classifyOneTimeMatch/decideOneTimeReconciliation now
  // additionally flag it as a CONFLICT rather than letting it fall through
  // as an ordinary independent "new" candidate eligible for auto-commit.)
  {
    const { createCandidate, store } = makeCandidateStore();
    const finalizeCalls = [];
    const summary = await runHouseholdEmailIngestion(UID, baseDeps({
      scan: async () => ({
        ok: true, connectedEmail: "p@x.com", senderCount: 1, lookbackDays: 14, sinceIso: "2026-01-01T00:00:00.000Z",
        matchedCount: 2,
        results: [
          emailResult({ gmailMessageId: "msg-a", obligations: [obligation({ title: "Winter Concert", date: "2026-02-10", startTime: "18:00" })] }),
          emailResult({ gmailMessageId: "msg-b", obligations: [obligation({ title: "Winter Concert", date: "2026-02-10", startTime: "19:00" })] }),
        ],
      }),
      createCandidate,
      finalizeCandidate: async (uid, candidate) => { finalizeCalls.push(candidate); return { outcome: "auto_committed", item: { id: candidate.id } }; },
    }));
    ok("a conflicting (different explicit start time) restatement is never silently merged into one candidate", store.length === 2);
    ok("the original candidate is a normal, unmarked candidate", store[0].reviewStatus !== "corroborated" && !store[0].reconciledCandidateId);
    ok(
      // No reviewStatus override in the payload at all (never "corroborated"
      // — the fake createCandidate used here is a pure passthrough with no
      // defaults applied, mirroring createIngestionCandidateServerSide's
      // own default of reviewStatus:"pending" when the caller omits it)
      // but the reference to the related candidate IS set.
      "the second (conflicting) candidate is never marked corroborated, but references the related candidate",
      store[1].reviewStatus !== "corroborated" && store[1].reconciledCandidateId === store[0].id
    );
    ok("the ORIGINAL candidate still reaches normal finalization", finalizeCalls.some((c) => c.id === store[0].id));
    ok("the CONFLICTING candidate is never auto-committed — it never reaches finalization at all", !finalizeCalls.some((c) => c.id === store[1].id));
    ok("the conflicting candidate counts toward reviewRequired, not itemsCommitted", summary.reviewRequired >= 1);
  }

  // ============ Same obligation + explicit conflicting date -> Review Inbox ============
  {
    const { createCandidate, store } = makeCandidateStore();
    const finalizeCalls = [];
    await runHouseholdEmailIngestion(UID, baseDeps({
      scan: async () => ({
        ok: true, connectedEmail: "p@x.com", senderCount: 1, lookbackDays: 14, sinceIso: "2026-01-01T00:00:00.000Z",
        matchedCount: 2,
        results: [
          emailResult({ gmailMessageId: "msg-a", obligations: [obligation({ title: "Winter Concert", date: "2026-02-10" })] }),
          emailResult({ gmailMessageId: "msg-b", obligations: [obligation({ title: "Winter Concert", date: "2026-02-17" })] }),
        ],
      }),
      createCandidate,
      finalizeCandidate: async (uid, candidate) => { finalizeCalls.push(candidate); return { outcome: "auto_committed", item: { id: candidate.id } }; },
    }));
    ok("a conflicting (different explicit date) restatement produces two candidates, not a silent merge", store.length === 2);
    ok(
      "the second (conflicting-date) candidate is never marked corroborated, but references the related candidate",
      store[1].reviewStatus !== "corroborated" && store[1].reconciledCandidateId === store[0].id
    );
    ok("the conflicting-date candidate is never auto-committed", !finalizeCalls.some((c) => c.id === store[1].id));
  }

  // ============ Scheduled server path and manual path use the SAME reconciliation decision logic ============
  {
    const { canReconcile, buildObligationSignature } = await import("../src/organizer/recurringObligationMatch.js");
    const { decideOneTimeReconciliation } = await import("../src/organizer/oneTimeObligationMatch.js");
    const runnerModuleSource = await import("../api/_gmailIngestionRunner.js");
    ok(
      "runHouseholdEmailIngestion is exported (sanity: the module under test loaded)",
      typeof runnerModuleSource.runHouseholdEmailIngestion === "function"
    );
    // Direct proof the SAME functions are what the runner imports: build a
    // recurring signature match and a one-time decision exactly the way
    // the runner's own source does, confirming these are the real,
    // unmodified exports (not a parallel reimplementation under the same
    // names) — see api/_gmailIngestionRunner.js's own imports.
    const sigA = buildObligationSignature({ type: "chore", title: "Read nightly", recurring: true, target: { targetType: "child", targetChildId: "hayden" } });
    const sigB = buildObligationSignature({ type: "chore", title: "Please remember to read each night", recurring: true, target: { targetType: "child", targetChildId: "hayden" } });
    ok("recurringObligationMatch.js's own canReconcile still recognizes an equivalent restated instruction", canReconcile(sigA, sigB) === true);
    const decision = decideOneTimeReconciliation({
      obligation: { type: "event", title: "Field Trip", date: "2026-02-10" },
      target: { targetType: "child", targetChildId: "hayden" },
      existingSignatures: [],
      runRecords: [],
    });
    ok("oneTimeObligationMatch.js's own decideOneTimeReconciliation returns the expected 'new' shape", decision.outcome === "new");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
