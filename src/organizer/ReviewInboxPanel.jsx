import React from "react";
import { ITEM_TYPE_META } from "../data/itemTypes.js";
import { getSenderTargetLabel } from "../data/gmailApprovedSenders.js";
import { candidateCreatedAtMillis } from "../data/ingestionCandidatesRepository.js";

/**
 * Durable Review Inbox (Slice 1) — a compact, Parent-Tools-only list of
 * every persisted IngestionCandidate still awaiting review, so a candidate
 * that survives past the transient just-captured modal (closed via "×",
 * refresh, navigate away) remains reachable. Deliberately NOT a second
 * review workflow: each row's only action reopens the exact same
 * CandidateReviewModal the immediate-capture flow already uses — see
 * AuthShell.jsx's ChildSelector, which owns the single pending-candidate
 * subscription this component is purely presentational over (no
 * subscription, no Firestore access, no filtering/sorting logic here).
 *
 * candidates — already filtered to reviewStatus:"pending" and sorted
 * oldest-first by the caller (ingestionCandidatesRepository.js's
 * subscribePendingIngestionCandidates). This component never re-derives
 * that — a single source of truth for "what's pending," per the Slice 1
 * product decision.
 *
 * error — true when the subscription itself failed (distinct from a
 * genuinely empty list — "no items" and "couldn't load" must never look
 * the same to a parent).
 *
 * familyChildren — the household's children, used only to resolve a
 * "child" target id into a display name (getSenderTargetLabel, already
 * used identically by CandidateReviewModal's own "Configured for" line).
 * No SourceRecord is fetched here — full provenance stays inside
 * CandidateReviewModal once a row is actually opened, avoiding a read per
 * row for a list that may never be opened.
 *
 * onReview(candidate) — the only interactive action besides nothing.
 */
const ReviewInboxPanel = ({ candidates = [], error = false, familyChildren = [], onReview }) => {
  const formatCreatedAt = (candidate) => {
    const millis = candidateCreatedAtMillis(candidate);
    if (!Number.isFinite(millis)) return null;
    try {
      return new Date(millis).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return null;
    }
  };

  return (
    <div className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
      <h3 className="text-white font-display text-lg mb-1">Review Inbox</h3>
      {error ? (
        <p className="text-red-300 text-sm">Couldn't load pending items — please try again.</p>
      ) : candidates.length === 0 ? (
        <p className="text-gray-400 text-sm">No items waiting for review.</p>
      ) : (
        <>
          <p className="text-gray-400 text-sm mb-3">
            {candidates.length} item{candidates.length === 1 ? "" : "s"} awaiting review
          </p>
          <div className="space-y-2">
            {candidates.map((c) => {
              const meta = ITEM_TYPE_META[c.proposedType] || {};
              const targetLabel = getSenderTargetLabel({ targetType: c.targetType, childId: c.targetChildId }, familyChildren);
              const createdLabel = formatCreatedAt(c);
              return (
                <div key={c.id} data-testid="review-inbox-row" className="w-full flex items-center gap-3 p-3 rounded-2xl" style={{ background: "#1C1C1E" }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-bold text-sm truncate">
                      {meta.icon} {c.title || "(untitled)"}
                    </div>
                    <div className="text-gray-400 text-xs truncate">
                      {meta.label || c.proposedType}
                      {targetLabel ? ` · ${targetLabel}` : ""}
                      {c.date ? ` · ${c.date}` : ""}
                      {createdLabel ? ` · found ${createdLabel}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReview(c)}
                    className="flex-shrink-0 px-4 py-2 rounded-2xl font-extrabold text-sm"
                    style={{ background: "#A8FF3E", color: "#1C1C1E" }}
                  >
                    Review
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default ReviewInboxPanel;
