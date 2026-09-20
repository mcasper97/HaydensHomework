import React, { useState, useEffect } from "react";
import ItemForm from "./ItemForm.jsx";
import { updateIngestionCandidate } from "../data/ingestionCandidatesRepository.js";
import { commitCandidateToItem } from "../data/candidateCommitRepository.js";
import { getSourceRecord } from "../data/sourceRecordsRepository.js";
import { candidateToDraftItem } from "./candidateToDraftItem.js";
import { getSenderTargetLabel } from "../data/gmailApprovedSenders.js";
import { resolveFamilyWideOption } from "./itemFormValidation.js";
import { buildSourceContext } from "./sourceContext.js";

/**
 * Transient, single-purpose review surface for the candidates produced by
 * one capture (a photo upload, or now a Gmail Check Email run) — not the
 * full Review Inbox (out of scope). Steps through candidates one at a
 * time; each is resolved independently (approving one never auto-resolves
 * the others).
 *
 * ctx = { uid, isAdmin } (see itemsRepository.js).
 *
 * child = the one child in scope on this device's Parents Page
 * ({ id, name, emoji } or null) — photo/CSV ingestion's case, where review
 * only ever happens for a single child.
 *
 * familyChildren = the full family's children ([{ id, name, emoji }, ...])
 * — email ingestion's case (#26, Commit 5): Check Email runs from the
 * Parent Page, not any one child's page, and different senders can target
 * different children in the same batch, so review needs the whole family
 * available to pick from. When provided, this takes precedence over
 * `child` for what ItemForm offers; candidateToDraftItem.js still decides
 * the actual prefill from each candidate's own configured target.
 *
 * Four distinct exit actions (Review Inbox slice, product correction):
 *   "Approve & Add"  -> approve/commit (handleApprove, unchanged).
 *   "Reject" (ItemForm's Cancel button, relabeled) -> reject
 *     (reviewStatus: "rejected") via handleReject.
 *   "Review later"   -> onClose, writes nothing (the candidate is already
 *     "pending" by construction) — the modal just closes.
 *   "×"              -> does NOT reject immediately (a second product
 *     correction after the first one over-corrected this). It opens a
 *     small, local "Discard this suggestion?" confirmation
 *     (confirmingDiscard state below) with "Keep reviewing" (dismisses
 *     the confirmation only, changes nothing) and "Discard" (calls the
 *     SAME handleReject "Reject" already uses — never a second copy of
 *     that write, never a new lifecycle status). This is the one place a
 *     confirmation step exists in this component; it is not a reusable
 *     dialog component, just a local render branch.
 *
 * Recovery mode (Slice 2) — a candidate reopened here whose reviewStatus is
 * already "approved" (never written by a fresh approval anymore, see
 * handleApprove below; only reachable for a legacy candidate stranded there
 * by a partial failure from before Slice 2 existed) renders a deliberately
 * SMALLER action set than the four above, because a legacy-approved
 * candidate may already have a committed Item behind it:
 *   - No "Reject": rejecting here would never touch an Item that may
 *     already exist, silently orphaning it with no candidate pointing back
 *     at it.
 *   - No "Review later": that action's whole meaning ("still pending,
 *     nothing written yet") is false for a candidate already past pending —
 *     leaving it at "approved" is not a safe no-op the way it is from
 *     "pending".
 *   - "×" simply closes (onClose) with no confirmation — there is nothing
 *     to discard; the candidate's own status is left exactly as it was.
 *   - The submit button ("Finish Adding") calls the exact same
 *     handleApprove -> commitCandidateToItem used by a normal approval;
 *     commitCandidateToItem's own idempotent-recovery logic (existing Item
 *     left untouched, only the candidate's status finalized) is what makes
 *     this safe to resubmit.
 * See the isRecovery flag below — the only place this component branches
 * on reviewStatus.
 */
const CandidateReviewModal = ({ ctx, candidates, child, familyChildren, onClose }) => {
  const [queue, setQueue] = useState(candidates);
  const [error, setError] = useState("");
  const [sourceContext, setSourceContext] = useState(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const current = queue[0];
  const resolvedCount = candidates.length - queue.length;

  // Reset the confirmation whenever the candidate on screen changes (e.g.
  // advancing to the next item in a multi-candidate batch after a
  // Reject/Discard/Approve) — a confirmation about candidate A must never
  // linger onto candidate B.
  useEffect(() => {
    setConfirmingDiscard(false);
  }, [current?.id]);

  // Compact "Source" context (#26, Commit 5 live-validation fix) — reads
  // persisted SourceRecord provenance, not the transient Check Email
  // response, so it works correctly even if this modal is ever reopened
  // later. Only fetched for email-sourced review (familyChildren is only
  // ever passed by the Gmail flow) — photo/CSV ingestion never triggers
  // this effect at all, so it stays exactly as it was before this fix.
  useEffect(() => {
    let cancelled = false;
    setSourceContext(null);
    if (!familyChildren || !current?.sourceRecordId) return undefined;
    (async () => {
      const record = await getSourceRecord(ctx, current.sourceRecordId);
      if (cancelled || !record) return;
      let parentRecord = null;
      if ((record.sourceType === "webpage" || record.sourceType === "google_doc") && record.metadata?.parentEmailSourceRecordId) {
        parentRecord = await getSourceRecord(ctx, record.metadata.parentEmailSourceRecordId);
      }
      if (cancelled) return;
      setSourceContext(buildSourceContext(record, parentRecord));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.sourceRecordId, familyChildren]);

  if (!current) return null;

  // Legacy/recovery candidate (Slice 2) — see the module doc comment above.
  // A fresh approval never produces this state anymore; only a candidate
  // stranded at "approved" from before Slice 2 reaches it.
  const isRecovery = current.reviewStatus === "approved";

  const advance = () => {
    setError("");
    setQueue((prev) => prev.slice(1));
  };

  const handleReject = async () => {
    setError("");
    try {
      await updateIngestionCandidate(ctx, current.id, { reviewStatus: "rejected" });
      advance();
    } catch (err) {
      setError(err?.message || "Couldn't skip this item — please try again.");
    }
  };

  // Single atomic commit (Slice 2) — see candidateCommitRepository.js.
  // Replaces the earlier two-write "approved" then createItem() then
  // "committed" sequence: a fresh approval now goes pending -> committed in
  // one transaction, so a failed commit leaves the candidate untouched at
  // "pending" (safely retryable from here or from the Review Inbox) instead
  // of stranding it at an intermediate "approved" state. Also used to
  // resubmit a legacy-approved recovery candidate (isRecovery above) —
  // commitCandidateToItem's own idempotent logic leaves any already-created
  // Item untouched and only finalizes the candidate's status.
  const handleApprove = async (payload) => {
    await commitCandidateToItem(ctx, current.id, { ...payload, sourceRecordId: current.sourceRecordId });
    advance();
  };

  // Small, local confirmation — deliberately not a reusable dialog
  // component or a second copy of the reject write. "Keep reviewing"
  // touches only this component's own confirmingDiscard state; "Discard"
  // calls the exact same handleReject the "Reject" button already uses.
  if (confirmingDiscard) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-3xl shadow-xl p-6 w-full max-w-sm">
          <h3 className="text-lg font-extrabold text-gray-900 mb-1">Discard this suggestion?</h3>
          <p className="text-sm text-gray-600 mb-4">It won't appear in your Review Inbox.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDiscard(false)}
              className="flex-1 px-4 py-2 rounded-2xl font-extrabold text-gray-500 border border-gray-300"
            >
              Keep reviewing
            </button>
            <button
              type="button"
              onClick={handleReject}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-extrabold py-2 rounded-2xl"
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-extrabold text-gray-900">
            {isRecovery ? "Needs attention" : familyChildren ? "Review email import" : "Review photo import"}
            {candidates.length > 1 ? ` (${resolvedCount + 1} of ${candidates.length})` : ""}
          </h2>
          {/* Recovery mode (Slice 2): "×" is a plain close, no confirmation
              — there is nothing to discard, and the candidate's own status
              is left exactly as it was. Normal mode (Review Inbox slice,
              second product correction): "×" no longer rejects immediately
              — it opens the local "Discard this suggestion?" confirmation
              above. Nothing is written until the parent explicitly picks
              Discard there (which reuses handleReject, the exact same
              write "Reject" below performs). A parent who wants to defer
              without deciding uses "Review later" instead (see its own
              comment). */}
          <button
            type="button"
            onClick={isRecovery ? onClose : () => setConfirmingDiscard(true)}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-2"
          >
            &times;
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-2">
          {isRecovery
            ? "This item was approved earlier but wasn't finished. Nothing has been added yet — review it below and finish adding it."
            : familyChildren
            ? "Found in an approved sender's email — review, edit anything that's wrong, confirm who it's for, then add it."
            : "Found in your photo — review, edit anything that's wrong, confirm the child, then add it."}
        </p>

        {/* Explicit defer action — closes without writing anything (the
            candidate is already "pending" by construction, so there's
            nothing to set). Reuses the same onClose prop the caller
            already passes, no new state or handler. Recovery mode omits
            this entirely — see the module doc comment: leaving a
            legacy-approved candidate at "approved" is not the same safe
            no-op that leaving a "pending" one is. */}
        {!isRecovery && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-indigo-700 underline hover:text-indigo-900 mb-3"
          >
            Review later — save to your Review Inbox
          </button>
        )}
        {familyChildren && current.targetType && (
          <p className="text-sm text-indigo-700 font-semibold mb-2">
            Configured for: {getSenderTargetLabel({ targetType: current.targetType, childId: current.targetChildId }, familyChildren)}
          </p>
        )}

        {/* Compact, read-only review context — plain text only (React
            text content is always escaped, never rendered as HTML), no
            link-out, no OAuth/Gmail internals. This is provenance a
            parent may need to decide who an "Ask during review" item
            belongs to — not a provenance dashboard. */}
        {sourceContext && (
          <div className="text-xs text-gray-500 bg-gray-50 rounded-xl p-2 mb-3 border border-gray-200">
            <div className="font-bold uppercase tracking-wide text-gray-400 mb-0.5">Source</div>
            {sourceContext.kind === "email" ? (
              <>
                <div>Email from {sourceContext.senderLine || "unknown sender"}</div>
                {sourceContext.subject && <div>Subject: {sourceContext.subject}</div>}
                {sourceContext.receivedDate && <div>Received: {sourceContext.receivedDate}</div>}
              </>
            ) : sourceContext.kind === "google_doc" ? (
              <>
                <div>Google Doc: {sourceContext.pageTitle || "unknown document"}</div>
                <div>Linked from email by {sourceContext.senderLine || "unknown sender"}</div>
                {sourceContext.subject && <div>Subject: {sourceContext.subject}</div>}
              </>
            ) : (
              <>
                <div>Teacher webpage: {sourceContext.pageTitle || "unknown page"}</div>
                <div>Linked from email by {sourceContext.senderLine || "unknown sender"}</div>
                {sourceContext.subject && <div>Subject: {sourceContext.subject}</div>}
              </>
            )}
          </div>
        )}

        {error && <p className="text-red-600 text-sm font-semibold mb-2">{error}</p>}

        <ItemForm
          key={current.id}
          children={familyChildren || (child ? [child] : [])}
          candidateParentItems={[]}
          initialType={current.proposedType}
          existingItem={candidateToDraftItem(current, child)}
          // Both "family" and "review" targeted email candidates offer a
          // Family option — a school-wide event from an unmapped
          // ("review") sender must be assignable to the whole family, not
          // just to one child. See resolveFamilyWideOption's doc comment
          // for exactly what each targetType starts with. Photo/CSV
          // candidates (targetType is never set) get neither prop —
          // completely unchanged from before this fix.
          {...resolveFamilyWideOption(current.targetType)}
          // Compact Date / Start Time / End Time review UI (#26, Commit 5
          // review-UX fix) — only for email review (familyChildren is only
          // ever passed by the Gmail flow); photo/CSV review keeps the
          // full manual Start/End-date entry UI, completely unchanged.
          compactDateTime={!!familyChildren}
          showRecurrence
          onSubmit={async (payload) => {
            try {
              await handleApprove(payload);
            } catch (err) {
              setError(err?.message || "Couldn't add this item — please try again.");
              throw err;
            }
          }}
          // Recovery mode omits onCancel entirely — ItemForm hides its
          // Cancel/Reject button whenever onCancel is falsy (see
          // ItemForm.jsx: `{onCancel && (...)}`) — never offering a Reject
          // here is exactly the point (see the module doc comment above).
          onCancel={isRecovery ? undefined : handleReject}
          submitLabel={isRecovery ? "Finish Adding" : "Approve & Add"}
          // "Cancel" undersells what this button actually does here — it's
          // a real, persisted reject (reviewStatus: "rejected"), not a
          // no-op close like every other ItemForm caller's Cancel. Opt-in
          // relabel only; every other caller keeps the default "Cancel".
          cancelLabel="Reject"
        />
      </div>
    </div>
  );
};

export default CandidateReviewModal;
