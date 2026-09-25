/* ============================== Needs Attention (derivation) ==============================
 * MVP attention layer for Parent Board — a small, environment-neutral
 * function that turns state the app ALREADY computes/subscribes to
 * elsewhere into one normalized "Needs Attention" summary. Deliberately
 * derives-only: no new Firestore collection, no new subscription, no new
 * business rule. Each of the three supported conditions reuses the exact
 * shape an existing caller already produces:
 *
 *   - Review Inbox: pendingCandidates, the same list
 *     src/data/ingestionCandidatesRepository.js's
 *     subscribePendingIngestionCandidates already delivers to
 *     src/ParentBoard.jsx (its own reviewStatus "pending"/"approved"
 *     filtering is the one and only place that rule lives — never
 *     re-implemented here).
 *   - Gmail: gmailStatus, the same shape src/data/gmailConnection.js's
 *     fetchGmailStatus() already returns ({ needsReconnect, ... }) — its
 *     own reconnect determination is entirely server-side; this module
 *     only reads the boolean.
 *   - Google Calendar: calendarIssues, the same client-side filter
 *     ParentBoard.jsx already applies to its subscribeItems feed
 *     (items whose googleCalendarSyncError is set) — see
 *     src/data/googleCalendarAutoPublish.js for how that field gets set.
 *
 * Only these three conditions are supported — no new attention category
 * should be added here without a corresponding product decision.
 */

/**
 * deriveAttentionSummary({ pendingCandidates, gmailStatus, calendarIssues })
 *   -> { totalAttentionCount, items: [{ type, count, title, description, actionKey }] }
 *
 * Pure — no I/O, no subscriptions. Every argument defaults to "nothing to
 * report" so a caller mid-load (any of the three states not yet resolved)
 * never produces a false-positive attention row.
 *
 * actionKey identifies which existing recovery surface a row's click
 * should reuse (see src/ParentBoard.jsx's handleAttentionAction) — never
 * a new screen: "open_review_inbox" opens the existing Review Inbox tool
 * view (which already renders the Calendar-issues/retry section too —
 * see ReviewInboxPanel.jsx), and "open_gmail_settings" opens the existing
 * Settings page (whose GmailConnectionPanel already renders the
 * "Reconnect Gmail" control).
 */
export function deriveAttentionSummary({ pendingCandidates = [], gmailStatus = null, calendarIssues = [] } = {}) {
  const items = [];

  const reviewCount = Array.isArray(pendingCandidates) ? pendingCandidates.length : 0;
  if (reviewCount > 0) {
    items.push({
      type: "review_inbox",
      count: reviewCount,
      title: "Review Inbox",
      description: `${reviewCount} item${reviewCount === 1 ? "" : "s"} need${reviewCount === 1 ? "s" : ""} review`,
      actionKey: "open_review_inbox",
    });
  }

  if (gmailStatus?.needsReconnect) {
    items.push({
      type: "gmail",
      count: 1,
      title: "Gmail",
      description: "Reconnect required",
      actionKey: "open_gmail_settings",
    });
  }

  const calendarCount = Array.isArray(calendarIssues) ? calendarIssues.length : 0;
  if (calendarCount > 0) {
    items.push({
      type: "calendar",
      count: calendarCount,
      title: "Google Calendar",
      description: `${calendarCount} item${calendarCount === 1 ? "" : "s"} need${calendarCount === 1 ? "s" : ""} retry`,
      actionKey: "open_review_inbox",
    });
  }

  const totalAttentionCount = items.reduce((sum, item) => sum + item.count, 0);
  return { totalAttentionCount, items };
}
