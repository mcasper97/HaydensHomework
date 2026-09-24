/**
 * Focused unit tests for src/data/candidateCommitDecision.js — the
 * environment-neutral candidate-commit state machine shared by
 * src/data/candidateCommitRepository.js (client Firestore/localStorage)
 * and api/_scheduledIngestionAdapter.js (server Admin SDK), extracted so
 * neither maintains its own independent copy of these rules.
 *
 * Pure module, zero I/O — no mocking needed. Also proves, by directly
 * exercising the same {candidateExists, candidate, itemExists} inputs
 * both real callers construct from their own reads, that BOTH
 * environments would reach the identical decision for the same
 * candidate/Item state (the actual read/write mechanics differ and are
 * exercised separately by tests/candidate-commit-repository.unit.mjs,
 * tests/candidate-commit-transaction.unit.mjs, and
 * tests/scheduled-ingestion-adapter.unit.mjs).
 *
 * Usage: node tests/candidate-commit-decision.unit.mjs
 */
import { decideCandidateCommit, buildItemFields, COMMIT_ERROR_CODES, COMMITTABLE_STATUSES, commitError } from "../src/data/candidateCommitDecision.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

function candidate(overrides) {
  return { id: "cand-1", reviewStatus: "pending", title: "Spelling Test", ...overrides };
}

// ============ New eligible candidate ============
{
  const d = decideCandidateCommit({ candidateExists: true, candidate: candidate(), itemExists: false });
  ok("A pending candidate with no existing Item decides create_item", d.action === "create_item");
}
{
  const d = decideCandidateCommit({ candidateExists: true, candidate: candidate({ reviewStatus: "approved" }), itemExists: false });
  ok("An approved (legacy/recovery) candidate with no existing Item ALSO decides create_item", d.action === "create_item");
}

// ============ Already-committed candidate (idempotent) ============
{
  const d = decideCandidateCommit({ candidateExists: true, candidate: candidate({ reviewStatus: "committed" }), itemExists: true });
  ok("A committed candidate whose Item genuinely exists decides return_existing (idempotent, no writes)", d.action === "return_existing");
}

// ============ Committed candidate with missing Item (integrity error) ============
{
  const d = decideCandidateCommit({ candidateExists: true, candidate: candidate({ reviewStatus: "committed" }), itemExists: false });
  ok("A committed candidate whose Item is MISSING decides throw COMMITTED_ITEM_MISSING", d.action === "throw" && d.code === COMMIT_ERROR_CODES.COMMITTED_ITEM_MISSING);
  ok("...never create_item — a stale/resubmitted payload must never recreate a missing committed Item", d.action !== "create_item");
}

// ============ Retry cannot overwrite an existing Item ============
{
  const d = decideCandidateCommit({ candidateExists: true, candidate: candidate({ reviewStatus: "pending" }), itemExists: true });
  ok(
    "A pending/approved candidate whose Item ALREADY exists (a retried commit after a prior candidate-status write failed) decides mark_committed_only, never create_item",
    d.action === "mark_committed_only"
  );
}
{
  const d = decideCandidateCommit({ candidateExists: true, candidate: candidate({ reviewStatus: "approved" }), itemExists: true });
  ok("Same for reviewStatus 'approved'", d.action === "mark_committed_only");
}

// ============ Candidate missing entirely ============
{
  const d = decideCandidateCommit({ candidateExists: false, candidate: null, itemExists: false });
  ok("A nonexistent candidate decides throw CANDIDATE_NOT_FOUND", d.action === "throw" && d.code === COMMIT_ERROR_CODES.CANDIDATE_NOT_FOUND);
}

// ============ Not committable statuses ============
for (const reviewStatus of ["rejected", "corroborated", "some-future-status"]) {
  const d = decideCandidateCommit({ candidateExists: true, candidate: candidate({ reviewStatus }), itemExists: false });
  ok(`reviewStatus "${reviewStatus}" decides throw NOT_COMMITTABLE`, d.action === "throw" && d.code === COMMIT_ERROR_CODES.NOT_COMMITTABLE);
}

// ============ Allowed review statuses (allowlist, not exclusion) ============
{
  ok("COMMITTABLE_STATUSES is exactly {pending, approved}", COMMITTABLE_STATUSES.has("pending") && COMMITTABLE_STATUSES.has("approved") && COMMITTABLE_STATUSES.size === 2);
}

// ============ Item id = candidate id preservation (a caller-side contract, verified via buildItemFields) ============
{
  const cand = candidate({ id: "cand-xyz", sourceRecordId: "source-1" });
  const fields = buildItemFields({ childIds: [], status: "open" }, cand, { title: "Edited Title" }, "automatic");
  ok("buildItemFields preserves sourceCandidateId = candidate.id (Item id itself is assigned by the caller's own doc ref, always the candidate id)", fields.sourceCandidateId === "cand-xyz");
  ok("buildItemFields preserves sourceRecordId from the candidate when the payload doesn't override it", fields.sourceRecordId === "source-1");
  ok("buildItemFields applies commitMode", fields.commitMode === "automatic");
  ok("buildItemFields defaults commitMode to 'reviewed' when omitted", buildItemFields({}, cand, {}, undefined).commitMode === "reviewed");
  ok("buildItemFields merges the caller-supplied emptyDefaults shape", fields.status === "open" && Array.isArray(fields.childIds));
  ok("buildItemFields lets the reviewed payload override sourceRecordId explicitly", buildItemFields({}, cand, { sourceRecordId: "override" }, null).sourceRecordId === "override");
}

// ============ commitError shape ============
{
  const err = commitError(COMMIT_ERROR_CODES.NOT_COMMITTABLE, "nope");
  ok("commitError produces an Error with a .code property matching the given code", err instanceof Error && err.code === COMMIT_ERROR_CODES.NOT_COMMITTABLE && err.message === "nope");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
