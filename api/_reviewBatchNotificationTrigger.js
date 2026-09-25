/* ============================== Review Inbox batch notification trigger (server-only) ==============================
 * Wires api/_gmailIngestionRunner.js's EXISTING per-email review-required
 * tally (the same `reviewRequired` counting rules that function already
 * applies: a newly-created candidate that ends this run NOT corroborated,
 * NOT auto-committed, and NOT a same-run duplicate) to the already-built
 * notification pipeline (api/_notificationOrchestrator.js's
 * processAttentionNotification). No second candidate-counting rule, no
 * new dedupe logic, no template/provider change — this file only decides
 * WHEN to call the existing pipeline (once per source, after ALL of that
 * source's obligations have been processed) and WHAT trusted attention to
 * pass it.
 *
 * ONE EMAIL SHOULD PRODUCE ONE NOTIFICATION, NOT ONE PER CANDIDATE — the
 * whole point of this trigger existing as a separate, single post-loop
 * call rather than being inlined at each `reviewRequired += 1` site.
 *
 * BATCH IDENTITY: the caller passes a stable per-source id — the EXACT
 * SAME emailSourceRecord.id api/_gmailIngestionRunner.js already creates
 * for that email (task's preferred order: ingestion run id [not
 * currently available anywhere in this app], SourceRecord id [used],
 * Gmail message id [available but less directly tied to "this batch of
 * created candidates" than the SourceRecord actually written for them]).
 * Never a timestamp, never invented.
 *
 * ATTENTION IDENTITY: { type: "review_batch", id: sourceId, count } — a
 * dedicated attention type (src/data/notificationDecision.js), never the
 * existing per-candidate "review" type/key, so a batch notification can
 * never collide with a future per-candidate one. `count` is presentation
 * data only (used by the email body) and is never part of the dedupe key
 * — see notificationDecision.js's own doc comment.
 *
 * FAILURE ISOLATION: every path through this function is a no-throw,
 * best-effort side effect relative to Gmail ingestion. Any error inside
 * the notification pipeline (the atomic claim, recipient resolution, the
 * Resend call) is caught and logged here; it never propagates to
 * api/_gmailIngestionRunner.js, never changes any candidate's persisted
 * state, and never fails the household's ingestion run.
 */
import { processAttentionNotification } from "./_notificationOrchestrator.js";

/**
 * notifyReviewBatchRequired(uid, sourceId, count, deps?) -> void
 * Called by runHouseholdEmailIngestion exactly once per source (email),
 * after that source's obligations have all been processed, only when
 * count > 0. A missing sourceId or a non-positive/non-integer count is a
 * no-op (never fabricates an identity or a fake count).
 */
export async function notifyReviewBatchRequired(uid, sourceId, count, deps = {}) {
  const { notify = processAttentionNotification } = deps;
  if (!sourceId || !Number.isInteger(count) || count <= 0) return;

  try {
    await notify(uid, { type: "review_batch", id: sourceId, count });
  } catch (err) {
    console.error(`reviewBatchNotificationTrigger: notification delivery failed for ${uid}/${sourceId}`, err);
  }
}
