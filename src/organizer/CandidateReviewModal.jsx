import React, { useState } from "react";
import ItemForm from "./ItemForm.jsx";
import { updateIngestionCandidate } from "../data/ingestionCandidatesRepository.js";
import { createItem } from "../data/itemsRepository.js";
import { candidateToDraftItem } from "./candidateToDraftItem.js";
import { getSenderTargetLabel } from "../data/gmailApprovedSenders.js";
import { resolveFamilyWideOption } from "./itemFormValidation.js";

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
 */
const CandidateReviewModal = ({ ctx, candidates, child, familyChildren, onClose }) => {
  const [queue, setQueue] = useState(candidates);
  const [error, setError] = useState("");

  const current = queue[0];
  const resolvedCount = candidates.length - queue.length;

  if (!current) return null;

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

  // Approval and commit are deliberately two separate writes: the candidate
  // is marked "approved" before createItem() runs. If createItem() throws,
  // the candidate is left at "approved" (never reverted to "pending") and
  // this same handler simply retries on the next submit — the parent is
  // never asked to re-decide something they already approved.
  const handleApprove = async (payload) => {
    await updateIngestionCandidate(ctx, current.id, { reviewStatus: "approved" });
    await createItem(ctx, { ...payload, sourceRecordId: current.sourceRecordId });
    await updateIngestionCandidate(ctx, current.id, { reviewStatus: "committed" });
    advance();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-extrabold text-gray-900">
            {familyChildren ? "Review email import" : "Review photo import"}
            {candidates.length > 1 ? ` (${resolvedCount + 1} of ${candidates.length})` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-2"
          >
            &times;
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-2">
          {familyChildren
            ? "Found in an approved sender's email — review, edit anything that's wrong, confirm who it's for, then add it."
            : "Found in your photo — review, edit anything that's wrong, confirm the child, then add it."}
        </p>
        {familyChildren && current.targetType && (
          <p className="text-sm text-indigo-700 font-semibold mb-2">
            Configured for: {getSenderTargetLabel({ targetType: current.targetType, childId: current.targetChildId }, familyChildren)}
          </p>
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
          onSubmit={async (payload) => {
            try {
              await handleApprove(payload);
            } catch (err) {
              setError(err?.message || "Couldn't add this item — please try again.");
              throw err;
            }
          }}
          onCancel={handleReject}
          submitLabel="Approve & Add"
        />
      </div>
    </div>
  );
};

export default CandidateReviewModal;
