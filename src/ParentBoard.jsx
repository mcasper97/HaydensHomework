import React, { useEffect, useState } from "react";
import { subscribePendingIngestionCandidates } from "./data/ingestionCandidatesRepository.js";
import { subscribeItems } from "./data/itemsRepository.js";
import { retryCalendarPublish } from "./data/googleCalendarAutoPublish.js";
import ReviewInboxPanel from "./organizer/ReviewInboxPanel.jsx";
import CandidateReviewModal from "./organizer/CandidateReviewModal.jsx";
import GmailCheckEmailAction from "./GmailCheckEmailAction.jsx";
import AddItemPanel from "./organizer/AddItemPanel.jsx";
import ManageItemsPanel from "./organizer/ManageItemsPanel.jsx";
import ChoreManagementPanel from "./ChoreManagementPanel.jsx";

/* ─────────────────────── Parent Board ───────────────────────
 * "What administrative action do I need to perform?" — split out of the
 * former ParentHome.jsx (navigation refactor), which used to also be the
 * signed-in landing page. That launcher role now belongs to
 * BoardSelector.jsx; this component owns only the five parent-admin
 * actions and their focused tool views.
 *
 * Tapping an action opens a FOCUSED view that replaces the action grid
 * entirely (parentTool state) — it does not expand underneath the grid
 * the way the old activePanel-driven layout did. Each tool view reuses
 * the exact same existing component/logic as before (AddItemPanel,
 * ChoreManagementPanel, ReviewInboxPanel, GmailCheckEmailAction, and the
 * inline Upload Homework/Photo picker) — no duplicated business logic,
 * only presentation/navigation changed.
 */
const ParentBoard = ({ user, children, onOpenChildImport, onBack }) => {
  // null | "add-item" | "upload" | "review" | "check-email" | "chores"
  const [parentTool, setParentTool] = useState(null);

  // Review Inbox — the single pending-candidate subscription for this
  // board, driving BOTH the action-grid badge and the inbox tool view
  // (never two subscriptions for the same data). Runs unconditionally so
  // the badge is accurate even while the grid itself is showing.
  // pendingError is distinct from an empty list — a load failure must
  // never render as "nothing to review."
  const [pendingCandidates, setPendingCandidates] = useState([]);
  const [pendingError, setPendingError] = useState(false);
  // The one candidate currently reopened from the inbox into the existing
  // CandidateReviewModal — a single-item array, mirroring exactly how the
  // immediate-capture flow already uses that same modal, just sourced
  // from a persisted list instead of a just-created batch. Rendered
  // unconditionally (not gated on parentTool) so it stays visible even if
  // the parent somehow navigates away from the Review Inbox tool while a
  // candidate is still open.
  const [reviewInboxCandidate, setReviewInboxCandidate] = useState(null);

  // Calendar-issue attention state (Section 13) — Items whose most recent
  // publish attempt failed (googleCalendarSyncError set by
  // googleCalendarAutoPublish.js), surfaced in the Review Inbox as a
  // durable, distinctly-styled "Needs attention" card, separate from a
  // normal not-yet-reviewed candidate. Reuses the existing whole-collection
  // subscribeItems (already used throughout this app) and filters
  // client-side — no new repository function, no new collection.
  const [calendarIssues, setCalendarIssues] = useState([]);
  const [retryingItemId, setRetryingItemId] = useState(null);

  useEffect(() => {
    const ctx = { uid: user?.uid, isAdmin: !!user?.isAdmin };
    const unsub = subscribePendingIngestionCandidates(
      ctx,
      (list) => {
        setPendingCandidates(list);
        setPendingError(false);
      },
      () => {
        setPendingCandidates([]);
        setPendingError(true);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.isAdmin]);

  useEffect(() => {
    // Not gated on user.isAdmin, matching subscribeItems' own precedent
    // (subscribePendingIngestionCandidates above runs unconditionally
    // too) — guest mode will simply never have a real Item with
    // googleCalendarSyncError set through normal use (autoPublishItemIfEligible
    // never attempts a real publish for guest mode), but the subscription
    // itself is unconditional so the UI stays correct/testable regardless.
    const ctx = { uid: user?.uid, isAdmin: !!user?.isAdmin };
    const unsub = subscribeItems(ctx, {}, (items) => {
      setCalendarIssues(items.filter((it) => it.googleCalendarSyncError));
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.isAdmin]);

  const handleRetryCalendarPublish = async (item) => {
    setRetryingItemId(item.id);
    const ctx = { uid: user?.uid, isAdmin: !!user?.isAdmin };
    await retryCalendarPublish(ctx, item);
    setRetryingItemId(null);
  };

  useEffect(() => {
    if (!reviewInboxCandidate) return;
    const stillPending = pendingCandidates.some((c) => c.id === reviewInboxCandidate.id);
    if (!stillPending) setReviewInboxCandidate(null);
  }, [pendingCandidates, reviewInboxCandidate]);

  const ctx = { uid: user?.uid, isAdmin: !!user?.isAdmin };

  const ActionCard = ({ testId, icon, label, badge, onClick }) => (
    <button
      data-testid={testId}
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-2 p-5 rounded-3xl text-center transition hover:opacity-90 relative"
      style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}
    >
      {badge > 0 && (
        <span
          className="absolute top-2 right-2 text-xs font-extrabold rounded-full px-2 py-0.5"
          style={{ background: "#DC2626", color: "white" }}
        >
          {badge}
        </span>
      )}
      <span className="text-3xl">{icon}</span>
      <span className="text-white font-bold text-sm">
        {label}{badge > 0 ? ` · ${badge}` : ""}
      </span>
    </button>
  );

  const modal = reviewInboxCandidate && (
    <CandidateReviewModal
      ctx={ctx}
      candidates={[reviewInboxCandidate]}
      familyChildren={children}
      onClose={() => setReviewInboxCandidate(null)}
    />
  );

  if (parentTool) {
    return (
      <div className="min-h-screen flex flex-col items-center p-6" style={{ background: "#1C1C1E" }}>
        <div className="w-full max-w-lg" data-testid="parent-tool-view">
          <button
            onClick={() => setParentTool(null)}
            className="text-gray-400 hover:text-white text-sm font-semibold mb-4"
          >
            ← Back to Parent Board
          </button>

          {parentTool === "add-item" && (
            <div data-testid="add-item-panel" className="rounded-3xl p-5 border border-gray-700" style={{ background: "#2a2a2c" }}>
              <h3 className="text-white font-display text-lg mb-4">Add Item</h3>
              <AddItemPanel ctx={ctx} children={children} />
            </div>
          )}

          {parentTool === "manage-items" && (
            <div data-testid="manage-items-panel" className="rounded-3xl p-5 border border-gray-700" style={{ background: "#2a2a2c" }}>
              <h3 className="text-white font-display text-lg mb-4">Manage Items</h3>
              <ManageItemsPanel ctx={ctx} children={children} />
            </div>
          )}

          {parentTool === "upload" && (
            <div data-testid="parent-organizer-panel" className="rounded-3xl p-5 border border-gray-700" style={{ background: "#2a2a2c" }}>
              <h3 className="text-white font-display text-lg mb-1">Upload Homework/Photo</h3>
              <p className="text-gray-400 text-sm mb-4">
                Pull homework details from a photo or spreadsheet into a learner's organizer.
              </p>
              {children.length === 0 ? (
                <p className="text-gray-400 text-sm">Add a learner in Settings first to import for them.</p>
              ) : (
                <div className="space-y-2">
                  {children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => onOpenChildImport(child)}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl text-left transition hover:opacity-90"
                      style={{ background: "#1C1C1E" }}
                    >
                      <span className="text-xl">{child.emoji}</span>
                      <span className="text-white font-semibold">{child.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {parentTool === "review" && (
            <ReviewInboxPanel
              candidates={pendingCandidates}
              error={pendingError}
              familyChildren={children}
              onReview={setReviewInboxCandidate}
              calendarIssues={calendarIssues}
              retryingItemId={retryingItemId}
              onRetryCalendarPublish={handleRetryCalendarPublish}
            />
          )}

          {parentTool === "check-email" && (
            user.isAdmin ? (
              <div className="rounded-3xl p-5 border border-gray-700" style={{ background: "#2a2a2c" }}>
                <h3 className="text-white font-display text-lg mb-1">Check Email</h3>
                <p className="text-gray-400 text-sm">Email import isn't available in guest/demo mode.</p>
              </div>
            ) : (
              <GmailCheckEmailAction ctx={{ uid: user.uid, isAdmin: false }} childProfiles={children} />
            )
          )}

          {parentTool === "chores" && (
            <ChoreManagementPanel ctx={ctx} children={children} />
          )}
        </div>

        {modal}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-6" style={{ background: "#1C1C1E" }}>
      <div className="w-full max-w-lg" data-testid="parent-board">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-display text-white">Parent Board</h1>
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white text-sm font-semibold px-4 py-2 rounded-full border border-gray-700 hover:border-gray-500 transition"
          >
            ← All Boards
          </button>
        </div>

        {/* What can I do as the parent? Tapping any of these opens a focused
            tool view (above) that replaces this grid entirely — it never
            renders underneath the grid. */}
        <div className="grid grid-cols-2 gap-3">
          <ActionCard testId="action-add-item" icon="➕" label="Add Item" onClick={() => setParentTool("add-item")} />
          <ActionCard testId="action-manage-items" icon="📋" label="Manage Items" onClick={() => setParentTool("manage-items")} />
          <ActionCard testId="action-upload-homework" icon="📸" label="Upload Homework/Photo" onClick={() => setParentTool("upload")} />
          <ActionCard testId="action-review-inbox" icon="📥" label="Review Inbox" badge={pendingCandidates.length + calendarIssues.length} onClick={() => setParentTool("review")} />
          <ActionCard testId="action-check-email" icon="✉️" label="Check Email" onClick={() => setParentTool("check-email")} />
          <ActionCard testId="action-manage-chores" icon="🧹" label="Manage Chores" onClick={() => setParentTool("chores")} />
        </div>
      </div>

      {modal}
    </div>
  );
};

export default ParentBoard;
