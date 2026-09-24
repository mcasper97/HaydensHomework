/**
 * Integration-style unit test proving the corrected auto-commit
 * architecture end-to-end at the data layer — using
 * finalizeExtractedCandidate (src/data/ingestionFinalization.js), the
 * SAME reusable, non-UI orchestration function GmailCheckEmailAction.jsx
 * calls, not a reimplementation of it. Guest/local-demo path only, same
 * rationale as candidate-commit-repository.unit.mjs's own header comment:
 * no Firestore network call is ever attempted for this path.
 *
 * Section 18 of the correction task specifically requires proving:
 *   - the auto-commit decision is callable without React/UI
 *   - GmailCheckEmailAction does not own the business decision
 *   - the same finalization helper can accept candidates from other
 *     ingestion sources (this file never imports anything React/JSX)
 *   - candidate commit remains deterministic/idempotent
 *   - a candidate cannot auto-commit twice
 *   - commitMode automatic/reviewed is correct
 *
 * Usage: node tests/auto-commit-integration.unit.mjs
 */
import { finalizeExtractedCandidate } from "../src/data/ingestionFinalization.js";
import { commitCandidateToItem } from "../src/data/candidateCommitRepository.js";
import { createIngestionCandidate, getIngestionCandidate } from "../src/data/ingestionCandidatesRepository.js";
import { getItem, readGuestItems } from "../src/data/itemsRepository.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const ctx = { uid: "guest-local", isAdmin: true };

// Simulates what ANY ingestion source (today's manual Check Email; a
// future scheduled job, website, or Google Doc processor) does: create
// the candidate, then hand it to the ONE shared finalizer. This file
// itself never imports React/JSX anywhere — proof by construction that
// the decision is callable without a UI.
async function simulateOneObligation(candidateFields) {
  const candidate = await createIngestionCandidate(ctx, candidateFields);
  const result = await finalizeExtractedCandidate(ctx, candidate);
  return { candidate, result };
}

// ============ HIGH CONFIDENCE: auto-commits with no parent approval ============
{
  const { candidate, result } = await simulateOneObligation({
    proposedType: "test",
    title: "Spelling Test",
    date: "2026-10-01",
    sourceRecordId: "source-email-1",
    targetType: "child",
    targetChildId: "hayden-canonical-id",
    extractionConfidence: 0.95,
  });

  ok("A high-confidence, field-complete, identity-resolved candidate auto-commits", result.outcome === "auto_committed");
  ok("finalizeExtractedCandidate returned the real, persisted Item", !!result.item);
  const item = result.item;
  ok("The Item's id equals the candidate's id (deterministic, idempotency-safe)", item.id === candidate.id);
  ok("Item is tagged commitMode:\"automatic\"", item.commitMode === "automatic");
  ok("Item's childIds resolves to the mapped canonical child id, not a name", item.childIds[0] === "hayden-canonical-id" && item.childIds.length === 1);
  ok("Item retains sourceRecordId provenance", item.sourceRecordId === "source-email-1");
  ok("Item retains sourceCandidateId provenance (points back at the candidate)", item.sourceCandidateId === candidate.id);

  const reloadedCandidate = await getIngestionCandidate(ctx, candidate.id);
  ok("Candidate transitions straight to \"committed\" with no intermediate parent decision", reloadedCandidate.reviewStatus === "committed");
  // extractionConfidence lives on the CANDIDATE (Item has no such field —
  // see itemsRepository.js's EMPTY_DEFAULTS), retained via the Item's
  // sourceCandidateId linkage rather than copied onto the Item itself —
  // the candidate document is never deleted on commit, so this is full,
  // queryable provenance, not a lost signal.
  ok("The confidence that justified auto-commit remains retrievable via the retained candidate (full provenance, not deleted on commit)", reloadedCandidate.extractionConfidence === 0.95);
  ok("Exactly one Item exists for this candidate", readGuestItems().filter((it) => it.id === candidate.id).length === 1);

  // ---- Idempotency: a candidate cannot auto-commit twice ----
  // `candidate` is the stale in-memory object from creation (still shows
  // reviewStatus:"pending" locally, since createIngestionCandidate's
  // return value is never re-fetched) — re-finalizing it still decides
  // "eligible" the same way, but commitCandidateToItem's own idempotent
  // transaction (candidateCommitRepository.js) is what actually prevents
  // a second Item: it recognizes the candidate is ALREADY "committed" in
  // storage and returns the existing Item unchanged rather than creating
  // another one.
  const secondResult = await finalizeExtractedCandidate(ctx, candidate);
  ok("Re-finalizing the same candidate resolves via the idempotent commit path, returning the SAME item", secondResult.outcome === "auto_committed" && secondResult.item.id === item.id);
  ok("Still exactly one item after re-finalizing (no duplicate auto-commit)", readGuestItems().filter((it) => it.id === candidate.id).length === 1);

  // ---- Idempotency: a direct retry of the underlying commit transaction never duplicates either ----
  const retryItem = await commitCandidateToItem(ctx, candidate.id, { title: "Spelling Test (different resubmitted title)" }, { commitMode: "automatic" });
  ok("Retrying the same candidate id via the commit transaction directly returns the EXISTING item", retryItem.id === candidate.id && retryItem.title === "Spelling Test");
  ok("The retry's different payload never overwrote the stored item", (await getItem(ctx, candidate.id)).title === "Spelling Test");
  ok("Still exactly one item after a direct retry too", readGuestItems().filter((it) => it.id === candidate.id).length === 1);
}

// ============ REVIEWED (human-approved) commit still defaults to "reviewed" ============
{
  const candidate = await createIngestionCandidate(ctx, {
    proposedType: "assignment",
    title: "Book Report",
    date: "2026-10-05",
    targetType: "review",
    targetChildId: null,
  });
  // No opts passed — exactly how CandidateReviewModal.jsx's handleApprove calls this.
  const item = await commitCandidateToItem(ctx, candidate.id, { title: "Book Report", type: "assignment", childIds: ["hayden-canonical-id"] });
  ok("A commit with no explicit commitMode defaults to \"reviewed\" (every pre-existing caller's behavior unchanged)", item.commitMode === "reviewed");
}

// ============ LOW CONFIDENCE: stays pending, never auto-commits ============
{
  const { candidate, result } = await simulateOneObligation({
    proposedType: "test",
    title: "Fuzzy Test",
    date: "2026-10-08",
    sourceRecordId: "source-email-2",
    targetType: "child",
    targetChildId: "hayden-canonical-id",
    extractionConfidence: 0.3, // structurally complete, but low confidence
  });

  ok("A structurally-complete but LOW-confidence candidate does NOT auto-commit", result.outcome === "pending");
  ok("...and the decision reports low_confidence", result.decision.reasons.includes("low_confidence"));
  const reloaded = await getIngestionCandidate(ctx, candidate.id);
  ok("Candidate remains \"pending\" — exactly what feeds the Review Inbox", reloaded.reviewStatus === "pending");
  ok("No Item exists at all for this candidate's id", (await getItem(ctx, candidate.id)) === null);
}
{
  const { candidate, result } = await simulateOneObligation({
    proposedType: "test",
    title: "No Confidence Given",
    date: "2026-10-09",
    sourceRecordId: "source-email-2b",
    targetType: "child",
    targetChildId: "hayden-canonical-id",
    extractionConfidence: null, // missing confidence fails safe
  });
  ok("A candidate with MISSING confidence fails safe to Review Inbox (never auto-commits)", result.outcome === "pending");
  ok("...and the decision reports missing_confidence", result.decision.reasons.includes("missing_confidence"));
  ok("No Item exists for it", (await getItem(ctx, candidate.id)) === null);
}
{
  const { result } = await simulateOneObligation({
    proposedType: "test",
    title: "Missing Date",
    date: null, // ambiguous date
    sourceRecordId: "source-email-2c",
    targetType: "child",
    targetChildId: "hayden-canonical-id",
    extractionConfidence: 0.99, // high confidence never rescues a missing material field
  });
  ok("HIGH confidence + a missing required material field still stays pending", result.outcome === "pending");
  ok("...and the decision reports missing_date, not a confidence problem", result.decision.reasons.includes("missing_date"));
}

// ============ IDENTITY: unmapped sender target prevents auto-commit even with high confidence ============
{
  const { result } = await simulateOneObligation({
    proposedType: "school_event",
    title: "Back to School Night",
    date: "2026-10-10",
    sourceRecordId: "source-email-3",
    targetType: "review", // unmapped sender — parent must choose
    targetChildId: null,
    extractionConfidence: 0.97,
  });
  ok("An uncertain-learner (unmapped sender) candidate does NOT auto-commit even at high confidence", result.outcome === "pending");
  ok("...and the decision reports unresolved_assignment", result.decision.reasons.includes("unresolved_assignment"));
}
{
  // Deterministic identity mapping + high confidence together DO commit —
  // the converse proof that both signals, present together, are sufficient.
  const { result } = await simulateOneObligation({
    proposedType: "school_event",
    title: "Back to School Night",
    date: "2026-10-11",
    sourceRecordId: "source-email-3b",
    targetType: "child",
    targetChildId: "hayden-canonical-id",
    extractionConfidence: 0.9,
  });
  ok("Deterministic identity + high confidence together DO auto-commit", result.outcome === "auto_committed");
}

// ============ DEPENDENCY INJECTION: commit/publish are overridable without touching the decision ============
{
  const candidate = await createIngestionCandidate(ctx, {
    proposedType: "test",
    title: "Injected Deps Test",
    date: "2026-10-13",
    sourceRecordId: "source-email-4",
    targetType: "child",
    targetChildId: "hayden-canonical-id",
    extractionConfidence: 0.9,
  });
  let commitCalledWith = null;
  let publishCalledWith = null;
  const fakeItem = { id: candidate.id, title: "Injected Deps Test" };
  const result = await finalizeExtractedCandidate(ctx, candidate, {
    commit: async (...args) => {
      commitCalledWith = args;
      return fakeItem;
    },
    publish: (...args) => {
      publishCalledWith = args;
    },
  });
  ok("finalizeExtractedCandidate accepts injected commit/publish deps and uses them instead of the real ones", commitCalledWith !== null && publishCalledWith !== null);
  ok("The injected commit fn's result is what's returned as the item (no real Firestore/localStorage write occurred)", result.item === fakeItem);
  ok("No real Item was actually persisted for this candidate id (the injected commit was the only thing called)", (await getItem(ctx, candidate.id)) === null);
}

// ============ CONFLICTS: a corroborated candidate never reaches auto-commit ============
{
  const candidate = await createIngestionCandidate(ctx, {
    proposedType: "family_event",
    title: "PTA Night",
    date: "2026-10-12",
    targetType: "family",
    targetChildId: null,
    extractionConfidence: 0.95,
    reviewStatus: "corroborated",
    reconciledItemId: "some-existing-item-id",
  });
  const result = await finalizeExtractedCandidate(ctx, candidate);
  ok("A corroborated (reconciliation-duplicate) candidate is decided NOT eligible even at high confidence", result.outcome === "pending");
  ok("It was never even attempted for commit (still exactly zero Items for this candidate id)", (await getItem(ctx, candidate.id)) === null);
}

delete global.localStorage;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
