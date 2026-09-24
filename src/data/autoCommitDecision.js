/* ============================== Auto-commit eligibility decision ==============================
 * The ONE place "is this candidate safe to commit without a parent
 * reviewing it first?" is decided. Pure, zero-Firestore, zero-JSX — same
 * testing-boundary discipline as itemFormValidation.js/candidateToDraftItem.js
 * so it's directly unit-testable and has exactly one implementation any
 * ingestion entry point (manual Check Email today, a future scheduled
 * check, a future capture source) can share — see
 * src/data/ingestionFinalization.js for the orchestration layer that
 * actually calls this and then commits/leaves pending.
 *
 * ARCHITECTURE CORRECTION: an earlier version of this module decided
 * eligibility from field completeness alone (title/date/type/identity all
 * present). That is NOT confidence — a structurally complete candidate can
 * still be wrong (a misread date, a misidentified obligation, a garbled
 * title). Both extraction prompts (api/extract-obligations.js's photo
 * prompt, api/_emailExtraction.js's forced-tool email schema) now
 * explicitly request extractionConfidence, with instructions that it must
 * reflect genuine uncertainty about correctness — never inflated merely
 * because every field happens to be filled in (see each prompt's own
 * rule). This module now requires BOTH: full field-completeness/identity
 * resolution AND a confidence score at or above AUTO_COMMIT_CONFIDENCE_THRESHOLD.
 * A missing confidence (extraction genuinely didn't produce one, or failed
 * validation) fails safe to Review Inbox — it is never treated as
 * "presumably fine."
 *
 * Deterministic identity resolution (the sender's CONFIGURED target — see
 * resolveAutoAssignment below) is independent of and does NOT substitute
 * for content confidence: a candidate whose sender is confidently mapped
 * to a specific child, but whose extracted date/title the model itself
 * was unsure about, still requires review — both signals must hold.
 */
import { FORM_TYPES } from "./itemTypes.js";

/**
 * AUTO_COMMIT_CONFIDENCE_THRESHOLD — a named, documented domain constant,
 * not a magic number buried in a component. Chosen conservatively for
 * this first Phase 1 slice: 0.8 matches the "high" end of the scale both
 * extraction prompts are instructed to use ("Score it high (0.8 or above)
 * only when the obligation and every material field you filled in are
 * clearly and unambiguously stated") — i.e. the threshold is set to
 * exactly the bar the prompts themselves define as "clearly and
 * unambiguously stated," not an arbitrary separate number. There is no
 * production extraction-accuracy data yet to calibrate against; this
 * value should be revisited once real usage data exists, favoring
 * Review Inbox over a wrong auto-commit until then.
 */
export const AUTO_COMMIT_CONFIDENCE_THRESHOLD = 0.8;

/**
 * resolveAutoAssignment(candidate) -> { resolved: boolean, childIds: string[] }
 * Mirrors candidateToDraftItem.js's own targetType-driven childIds mapping
 * for the two decisively-resolved cases only ("child" with a real id,
 * "family") — deliberately does NOT fall back to any ambient/positional
 * child (candidateToDraftItem.js's third branch, used only by the
 * single-child photo-capture review context), since that fallback exists
 * for a human reviewer's context, not as a fact this module can trust
 * unattended. Never keyed by name — targetChildId is the sender's
 * configured canonical child id, set server-side (api/gmail-check-email.js),
 * completely unaffected by a later child rename (BoardSelector.jsx's
 * renameChild only ever changes the child record's `name`, never its id).
 */
export function resolveAutoAssignment(candidate) {
  if (candidate?.targetType === "child" && typeof candidate.targetChildId === "string" && candidate.targetChildId) {
    return { resolved: true, childIds: [candidate.targetChildId] };
  }
  if (candidate?.targetType === "family") {
    return { resolved: true, childIds: [] };
  }
  return { resolved: false, childIds: [] };
}

/**
 * decideAutoCommitEligibility(candidate) -> { eligible: boolean, reasons: string[] }
 * reasons is non-empty exactly when eligible is false — every applicable
 * reason is reported (not just the first), so a caller/test can see the
 * complete picture rather than one gate at a time.
 */
export function decideAutoCommitEligibility(candidate) {
  const reasons = [];

  if (!candidate || candidate.reviewStatus !== "pending") {
    return { eligible: false, reasons: ["not_pending"] };
  }

  if (!FORM_TYPES.includes(candidate.proposedType)) reasons.push("unknown_type");
  if (!candidate.title || !candidate.title.trim()) reasons.push("missing_title");

  const assignment = resolveAutoAssignment(candidate);
  if (!assignment.resolved) reasons.push("unresolved_assignment");

  const isRecurring = !!candidate.recurrenceSuggestion?.recurring;
  if (isRecurring) {
    const weekdays = candidate.recurrenceSuggestion?.weekdays;
    if (!Array.isArray(weekdays) || weekdays.length === 0) reasons.push("missing_recurrence_days");
  } else if (!candidate.date) {
    reasons.push("missing_date");
  }

  // Confidence — checked independently of field completeness above; a
  // structurally complete, identity-resolved candidate whose confidence is
  // missing or below threshold still fails safe to Review Inbox.
  const confidence = candidate.extractionConfidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    reasons.push("missing_confidence");
  } else if (confidence < AUTO_COMMIT_CONFIDENCE_THRESHOLD) {
    reasons.push("low_confidence");
  }

  return { eligible: reasons.length === 0, reasons };
}
