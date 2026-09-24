/* ============================== Ingestion finalization ==============================
 * The ONE place a freshly-created IngestionCandidate is either
 * auto-committed or left pending for the Review Inbox — reusable by ANY
 * ingestion entry point, never owned by a React component.
 *
 * ARCHITECTURE CORRECTION: an earlier version of this logic lived inline
 * inside GmailCheckEmailAction.jsx's handleCheckEmail — a client
 * presentation/action component. That component must only ever TRIGGER
 * ingestion; it must never OWN the business rule deciding auto-commit vs.
 * review-required. This module is that rule's home instead, so it can be
 * called identically by:
 *   - the manual "Check Email" action (today — see GmailCheckEmailAction.jsx,
 *     which now calls finalizeExtractedCandidate once per obligation
 *     instead of inlining decide+commit+publish itself)
 *   - a future scheduled email job, website ingestion, Google Doc
 *     ingestion, or any other source processor — none of which render
 *     React at all.
 *
 * ctx = { uid, isAdmin } — the same shape every src/data/*.js module
 * already uses for its client-Firestore-vs-guest-localStorage branching.
 * A future scheduled SERVER job (a Vercel serverless function, running
 * with no browser at all) would need its own Admin-SDK-backed
 * implementations of createIngestionCandidate/commitCandidateToItem —
 * the client Firebase SDK this module's dependencies currently use cannot
 * run server-side. That parallel server-side data layer does not exist
 * yet and is intentionally NOT built in this slice ("architect for,
 * don't implement the scheduler yet" — see the task's own instruction).
 * What THIS module guarantees is that the DECISION and ORCHESTRATION
 * logic itself — decide, commit, trigger the post-commit Calendar
 * workflow — has exactly one implementation, so that when a server-side
 * data layer for candidates/items eventually exists, only the repository
 * functions this module calls need a parallel implementation; the
 * decision/orchestration sequence itself does not need to be
 * rewritten or re-derived.
 */
import { commitCandidateToItem } from "./candidateCommitRepository.js";
import { decideAutoCommitEligibility } from "./autoCommitDecision.js";
import { autoPublishItemIfEligible } from "./googleCalendarAutoPublish.js";
import { candidateToDraftItem } from "../organizer/candidateToDraftItem.js";

/**
 * finalizeExtractedCandidate(ctx, candidate, deps) -> {
 *   outcome: "auto_committed" | "pending" | "auto_commit_failed",
 *   item?, decision, error?
 * }
 *
 * candidate — an already-PERSISTED IngestionCandidate (see
 * ingestionCandidatesRepository.js's createIngestionCandidate) that has
 * already been through reconciliation. A corroborated candidate should
 * never even be passed here (the caller's own reconciliation branch
 * already routes those away — see GmailCheckEmailAction.jsx), but if one
 * ever is, decideAutoCommitEligibility's own reviewStatus gate refuses it
 * (reviewStatus !== "pending") — defense in depth, not the primary guard.
 *
 * deps — optional injected overrides for the two I/O calls this function
 * makes (commitCandidateToItem, autoPublishItemIfEligible), each
 * defaulting to the real repository/Calendar implementation. This exists
 * so a caller (a test, or a future non-browser ingestion source with its
 * own repository layer) can supply alternates without this module needing
 * to know which implementation it's running against — the decision and
 * orchestration sequence itself stays identical either way.
 *
 * Never throws — a commit failure falls back to "pending" (the
 * candidate's own reviewStatus is left untouched at "pending" by
 * commitCandidateToItem's transaction semantics, so it's safely
 * retryable from the Review Inbox exactly like any other pending
 * candidate).
 */
export async function finalizeExtractedCandidate(
  ctx,
  candidate,
  { commit = commitCandidateToItem, publish = autoPublishItemIfEligible } = {}
) {
  const decision = decideAutoCommitEligibility(candidate);
  if (!decision.eligible) {
    return { outcome: "pending", decision };
  }

  try {
    const draftPayload = candidateToDraftItem(candidate, null);
    const item = await commit(
      ctx,
      candidate.id,
      { ...draftPayload, sourceRecordId: candidate.sourceRecordId },
      { commitMode: "automatic" }
    );
    // Post-commit Calendar workflow (Section 8/9) — the same shared path
    // reviewed/manual commits use. Fire-and-forget from this module's own
    // perspective is fine: the durable "in flight" write inside
    // attemptCalendarPublish (googleCalendarAutoPublish.js) is what
    // actually protects against a closed browser, not awaiting this call.
    publish(ctx, item);
    return { outcome: "auto_committed", item, decision };
  } catch (err) {
    console.error("finalizeExtractedCandidate: auto-commit failed, falling back to review", err);
    return { outcome: "auto_commit_failed", decision, error: err };
  }
}
