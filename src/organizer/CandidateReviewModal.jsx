import React, { useState } from "react";
import ItemForm from "./ItemForm.jsx";
import { updateIngestionCandidate } from "../data/ingestionCandidatesRepository.js";
import { createItem } from "../data/itemsRepository.js";
import { candidateToDraftItem } from "./candidateToDraftItem.js";

/**
 * Transient, single-purpose review surface for the candidates produced by
 * one photo upload — not the full Review Inbox (out of scope for this
 * vertical slice). Steps through candidates one at a time; each is resolved
 * independently (approving one never auto-resolves the others).
 *
 * ctx = { uid, isAdmin } (see itemsRepository.js). child = the one child in
 * scope on this device's Parents Page ({ id, name, emoji } or null) — used
 * only to offer/pre-check a match against the AI's proposed child name,
 * never to silently assign an item.
 */
const CandidateReviewModal = ({ ctx, candidates, child, onClose }) => {
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
            Review photo import
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
        <p className="text-sm text-gray-600 mb-4">
          Found in your photo — review, edit anything that's wrong, confirm the child, then add it.
        </p>

        {error && <p className="text-red-600 text-sm font-semibold mb-2">{error}</p>}

        <ItemForm
          key={current.id}
          children={child ? [child] : []}
          candidateParentItems={[]}
          initialType={current.proposedType}
          existingItem={candidateToDraftItem(current, child)}
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
