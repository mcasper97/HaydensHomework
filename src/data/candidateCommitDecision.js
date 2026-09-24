/* ============================== Candidate commit decision (environment-neutral) ==============================
 * The ONE place the candidate-commit STATE MACHINE lives — reviewStatus
 * allowlist, idempotent "already committed" handling, the
 * COMMITTED_ITEM_MISSING integrity condition, "never overwrite an
 * existing Item on retry," and Item id === candidate id field
 * construction. Extracted out of src/data/candidateCommitRepository.js
 * (the client Firestore/localStorage implementation) so
 * api/_scheduledIngestionAdapter.js (the Admin-SDK server implementation)
 * can share the exact same RULES without a second, independently
 * maintained copy of them.
 *
 * Deliberately pure and I/O-free: it takes plain booleans/objects
 * describing what a caller already read (candidateExists, candidate,
 * itemExists, existingItem) and returns a plain decision object — it
 * never reads or writes Firestore/localStorage itself, and never knows
 * which SDK (client `firebase/firestore` vs `firebase-admin/firestore`)
 * or storage (real Firestore vs guest localStorage) its caller uses. The
 * Firestore/Admin-SDK TRANSACTION APIS themselves are deliberately NOT
 * unified here — each caller keeps its own tx.get/tx.set/tx.update (or
 * localStorage read/write) calls, translating this module's decision into
 * whichever reads/writes its own environment needs.
 *
 * decideCandidateCommit(...) returns exactly one of:
 *   { action: "throw", code, message }
 *     — candidate missing, not committable, or committed-but-Item-missing
 *       (a hard integrity error, never a repair opportunity — see below).
 *   { action: "return_existing" }
 *     — candidate already reports "committed" and the Item genuinely
 *       exists: idempotent success, no writes at all.
 *   { action: "mark_committed_only" }
 *     — the Item already exists (e.g. a retried commit after a previous
 *       attempt's candidate-status write failed) but the candidate's own
 *       reviewStatus hasn't caught up yet: only the candidate write is
 *       needed; the existing Item is returned completely unchanged — the
 *       payload currently being submitted must NEVER overwrite it.
 *   { action: "create_item" }
 *     — genuinely new: caller should build the Item fields (see
 *       buildItemFields below), write both the Item and the candidate's
 *       committed status.
 *
 * COMMITTED_ITEM_MISSING is a hard integrity error, not a repair
 * opportunity: once a candidate claims "committed", the payload a caller
 * is currently submitting (e.g. a stale retry, or a resubmission with
 * edited fields) is not necessarily the payload that originally produced
 * the missing Item, so it is never used to recreate it.
 */

export const COMMIT_ERROR_CODES = {
  CANDIDATE_NOT_FOUND: "CANDIDATE_NOT_FOUND",
  NOT_COMMITTABLE: "NOT_COMMITTABLE",
  COMMITTED_ITEM_MISSING: "COMMITTED_ITEM_MISSING",
};

// Explicit allowlist — never an exclusion rule. "committed" is handled
// separately (idempotent success or COMMITTED_ITEM_MISSING); every other
// value — including any future/unknown status — is refused rather than
// assumed committable.
export const COMMITTABLE_STATUSES = new Set(["pending", "approved"]);

/**
 * commitError(code, message) -> Error with a `.code` property.
 * The one place a commit-decision error is constructed, shared so both
 * environments' thrown errors are structurally identical (same `.code`
 * values callers/tests already assert on via COMMIT_ERROR_CODES).
 */
export function commitError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * buildItemFields(emptyDefaults, candidate, reviewedItemPayload, commitMode)
 * -> the full field set for a newly-committed Item.
 *
 * emptyDefaults is supplied by the caller (itemsRepository.js's
 * EMPTY_DEFAULTS on the client; a mirrored plain-data copy server-side —
 * see api/_scheduledIngestionAdapter.js's own doc comment on why that
 * copy exists instead of an import) rather than owned here, so this
 * module never needs to know which environment's Item-defaults shape it
 * is completing — only the PROVENANCE fields below are this module's own
 * rule, and those are identical either way.
 */
export function buildItemFields(emptyDefaults, candidate, reviewedItemPayload, commitMode) {
  return {
    ...emptyDefaults,
    ...reviewedItemPayload,
    sourceRecordId: reviewedItemPayload?.sourceRecordId ?? candidate.sourceRecordId ?? null,
    sourceCandidateId: candidate.id,
    commitMode: commitMode || "reviewed",
  };
}

/**
 * decideCandidateCommit({ candidateExists, candidate, itemExists }) -> decision
 * See the module doc comment above for the four possible `action` values.
 * `candidate` must include its own `id` and `reviewStatus` when
 * `candidateExists` is true; `existingItem`/`item` themselves are never
 * read or returned by this function — callers already have them from
 * their own read and attach them to the result themselves if needed
 * (kept this way so this module never has an opinion on what an "item"
 * looks like in either environment).
 */
export function decideCandidateCommit({ candidateExists, candidate, itemExists }) {
  if (!candidateExists) {
    return { action: "throw", code: COMMIT_ERROR_CODES.CANDIDATE_NOT_FOUND, message: "This suggestion no longer exists." };
  }

  if (candidate.reviewStatus === "committed") {
    if (itemExists) {
      return { action: "return_existing" };
    }
    return {
      action: "throw",
      code: COMMIT_ERROR_CODES.COMMITTED_ITEM_MISSING,
      message: "This item was already marked added, but its record is missing. Please contact support.",
    };
  }

  if (!COMMITTABLE_STATUSES.has(candidate.reviewStatus)) {
    return { action: "throw", code: COMMIT_ERROR_CODES.NOT_COMMITTABLE, message: "This suggestion can no longer be added." };
  }

  if (itemExists) {
    return { action: "mark_committed_only" };
  }

  return { action: "create_item" };
}
