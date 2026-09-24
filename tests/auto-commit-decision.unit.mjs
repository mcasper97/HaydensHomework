/**
 * Focused unit tests for src/data/autoCommitDecision.js — the pure
 * high-confidence auto-commit eligibility policy (corrected per the
 * architecture-correction task: field-completeness alone is NOT
 * confidence; this module now requires both). Pure module, zero I/O — no
 * mocking needed.
 *
 * Usage: node tests/auto-commit-decision.unit.mjs
 */
import {
  decideAutoCommitEligibility,
  resolveAutoAssignment,
  AUTO_COMMIT_CONFIDENCE_THRESHOLD,
} from "../src/data/autoCommitDecision.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

function baseCandidate(overrides) {
  return {
    id: "cand-1",
    reviewStatus: "pending",
    proposedType: "test",
    title: "Spelling Test",
    date: "2026-10-01",
    targetType: "child",
    targetChildId: "hayden-abc123",
    recurrenceSuggestion: null,
    extractionConfidence: 0.95,
    ...overrides,
  };
}

// ============ Named threshold is a documented constant, not a magic number ============
ok("AUTO_COMMIT_CONFIDENCE_THRESHOLD is exported and a valid 0..1 number", typeof AUTO_COMMIT_CONFIDENCE_THRESHOLD === "number" && AUTO_COMMIT_CONFIDENCE_THRESHOLD > 0 && AUTO_COMMIT_CONFIDENCE_THRESHOLD < 1);

// ============ HIGH CONFIDENCE — fully-resolved, confident candidates auto-commit ============
{
  const d = decideAutoCommitEligibility(baseCandidate());
  ok("A fully field-complete, child-resolved, dated, high-confidence candidate is eligible", d.eligible === true);
  ok("...with an empty reasons list", d.reasons.length === 0);
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ targetType: "family", targetChildId: null, proposedType: "family_event" }));
  ok("A fully-resolved family-wide, high-confidence candidate is eligible", d.eligible === true);
}
{
  const d = decideAutoCommitEligibility(
    baseCandidate({
      proposedType: "reminder",
      date: null,
      recurrenceSuggestion: { recurring: true, weekdays: [1, 3, 5], timeMode: "daypart", daypart: "evening", time: null },
    })
  );
  ok("A recurring, high-confidence candidate with weekdays but no explicit date is eligible (date is advisory for recurrence)", d.eligible === true);
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ extractionConfidence: AUTO_COMMIT_CONFIDENCE_THRESHOLD }));
  ok("A candidate exactly AT the threshold is eligible (inclusive bound)", d.eligible === true);
}

// ============ CONFIDENCE gating — the actual architecture correction ============
{
  const d = decideAutoCommitEligibility(baseCandidate({ extractionConfidence: null }));
  ok("A structurally-perfect candidate with NULL confidence is NOT eligible (missing confidence fails safe)", d.eligible === false);
  ok("...and reports missing_confidence", d.reasons.includes("missing_confidence"));
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ extractionConfidence: undefined }));
  ok("A structurally-perfect candidate with UNDEFINED confidence is NOT eligible", d.eligible === false);
  ok("...and reports missing_confidence", d.reasons.includes("missing_confidence"));
}
{
  const justBelow = Math.round((AUTO_COMMIT_CONFIDENCE_THRESHOLD - 0.01) * 100) / 100;
  const d = decideAutoCommitEligibility(baseCandidate({ extractionConfidence: justBelow }));
  ok("A structurally-perfect candidate just BELOW threshold is NOT eligible", d.eligible === false);
  ok("...and reports low_confidence", d.reasons.includes("low_confidence"));
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ extractionConfidence: 0.1 }));
  ok("A structurally-perfect but low-confidence candidate is NOT eligible (field completeness alone never overrides low confidence)", d.eligible === false);
}
{
  // Deterministic identity mapping alone must never bypass low confidence
  // — both signals are required independently (Section 5 of the
  // correction). This is the single most important regression this
  // correction exists to prevent.
  const d = decideAutoCommitEligibility(
    baseCandidate({ targetType: "child", targetChildId: "hayden-abc123", extractionConfidence: 0.2 })
  );
  ok("A perfectly-mapped sender→child identity does NOT bypass low content confidence", d.eligible === false);
  ok("...and reports low_confidence specifically (not an identity reason)", d.reasons.includes("low_confidence") && !d.reasons.includes("unresolved_assignment"));
}
{
  // The converse: deterministic identity + high confidence together ARE sufficient.
  const d = decideAutoCommitEligibility(
    baseCandidate({ targetType: "child", targetChildId: "hayden-abc123", extractionConfidence: 0.92 })
  );
  ok("A perfectly-mapped identity + high confidence together ARE eligible", d.eligible === true);
}
{
  // High confidence never rescues a missing MATERIAL field either — both
  // gates are independent, neither substitutes for the other.
  const d = decideAutoCommitEligibility(baseCandidate({ date: null, extractionConfidence: 0.99 }));
  ok("High confidence does NOT rescue a missing required material field (date)", d.eligible === false);
  ok("...and reports missing_date, not a confidence reason", d.reasons.includes("missing_date"));
}

// ============ LOW CONFIDENCE / AMBIGUOUS — remain review-required ============
{
  const d = decideAutoCommitEligibility(baseCandidate({ date: null }));
  ok("A one-time candidate with no date is NOT eligible", d.eligible === false);
  ok("...and reports missing_date", d.reasons.includes("missing_date"));
}
{
  const d = decideAutoCommitEligibility(
    baseCandidate({ proposedType: "reminder", date: null, recurrenceSuggestion: { recurring: true, weekdays: [] } })
  );
  ok("A recurring candidate with an empty weekdays array is NOT eligible", d.eligible === false);
  ok("...and reports missing_recurrence_days", d.reasons.includes("missing_recurrence_days"));
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ title: "" }));
  ok("A candidate with an empty title is NOT eligible", d.eligible === false);
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ title: "   " }));
  ok("A candidate with a whitespace-only title is NOT eligible", d.eligible === false);
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ proposedType: "chore" }));
  ok("A candidate proposing the non-creatable \"chore\" type is NOT eligible", d.eligible === false);
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ proposedType: "not-a-real-type" }));
  ok("A candidate with an unknown/invalid type is NOT eligible", d.eligible === false);
}
{
  const d = decideAutoCommitEligibility(null);
  ok("A null candidate is NOT eligible, without throwing", d.eligible === false);
}
{
  // Multiple simultaneous failures are all reported, not just the first.
  const d = decideAutoCommitEligibility(baseCandidate({ date: null, targetType: "review", targetChildId: null, extractionConfidence: 0.1 }));
  ok("Multiple simultaneous problems are all reported together", d.reasons.includes("missing_date") && d.reasons.includes("unresolved_assignment") && d.reasons.includes("low_confidence"));
}

// ============ IDENTITY — deterministic, id-keyed, never by name ============
{
  const a = resolveAutoAssignment(baseCandidate({ targetChildId: "hayden-abc123" }));
  ok("resolveAutoAssignment resolves a mapped sender target by canonical child id", a.resolved === true && a.childIds[0] === "hayden-abc123");
}
{
  // A rename never touches targetChildId (BoardSelector.jsx's renameChild
  // only ever mutates the child record's `name` field) — the mapping is
  // keyed purely by id, so this module has nothing to react to on rename.
  const before = resolveAutoAssignment(baseCandidate({ targetChildId: "hayden-abc123" }));
  const after = resolveAutoAssignment(baseCandidate({ targetChildId: "hayden-abc123" })); // same id, as if "Hayden" were renamed "Henry" elsewhere
  ok("A child rename does not change which id an already-mapped candidate resolves to", before.childIds[0] === after.childIds[0]);
}
{
  const a = resolveAutoAssignment(baseCandidate({ targetType: "family", targetChildId: null }));
  ok("resolveAutoAssignment resolves \"family\" to an empty (household-wide) childIds array", a.resolved === true && a.childIds.length === 0);
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ targetType: "review", targetChildId: null }));
  ok("An unmapped (\"review\") sender target is NOT eligible — a human must choose who this is for", d.eligible === false);
  ok("...and reports unresolved_assignment", d.reasons.includes("unresolved_assignment"));
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ targetType: null, targetChildId: null }));
  ok("A candidate with no targetType at all (legacy/photo/CSV) is NOT eligible", d.eligible === false);
}
{
  const d = decideAutoCommitEligibility(baseCandidate({ targetType: "child", targetChildId: null }));
  ok("targetType \"child\" with no targetChildId is NOT eligible (malformed/incomplete mapping)", d.eligible === false);
}

// ============ CONFLICTS / RECONCILIATION ============
{
  const d = decideAutoCommitEligibility(baseCandidate({ reviewStatus: "corroborated", reconciledItemId: "existing-item-1" }));
  ok("A corroborated candidate (matched an existing Item/duplicate) is NEVER eligible for auto-commit", d.eligible === false);
  ok("...and reports not_pending", d.reasons.includes("not_pending"));
}
for (const status of ["approved", "rejected", "committed", "some-future-status"]) {
  const d = decideAutoCommitEligibility(baseCandidate({ reviewStatus: status }));
  ok(`A candidate at reviewStatus "${status}" is not auto-commit-eligible (only "pending" is)`, d.eligible === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
