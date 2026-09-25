/* ============================== Calendar publish-failure notification trigger (server-only) ==============================
 * Wires api/_scheduledIngestionAdapter.js's EXISTING Calendar
 * publish-failure recording (recordPublishFailure — the single choke
 * point every real publish failure inside attemptCalendarPublishServerSide
 * already funnels through: not connected, invalid event mapping, token
 * refresh failure, insert failure, and the catch-all) to the
 * already-built notification pipeline
 * (api/_notificationOrchestrator.js's processAttentionNotification). No
 * second Calendar-failure detector, no new dedupe logic, no
 * template/provider change, and no change to Calendar publish/routing
 * logic itself — this file only decides WHEN to call the existing
 * pipeline and WHAT trusted attention to pass it.
 *
 * ATTENTION IDENTITY: { type: "calendar", id: itemId } — the existing
 * stable per-Item dedupe key ("calendar:<itemId>", see
 * src/data/notificationDecision.js's buildAttentionKey). itemId comes
 * directly from the Item the caller was already recording a failure for
 * — never client input, never a second lookup.
 *
 * SAME-ITEM RE-FAILURE LIMITATION (disclosed, not solved here): the key
 * is a stable per-Item id with no episode marker (unlike Gmail's
 * connectedAt, which changes on every successful reconnect and so
 * naturally re-opens a new episode — see
 * api/_gmailReconnectNotificationTrigger.js). Once a notification for
 * item X is marked "sent", a LATER failure for that SAME item — even
 * after an intervening successful publish — is suppressed by the
 * existing dedupe (same key, delivery still at status "sent"), because
 * nothing about a successful publish currently changes any value folded
 * into this key. The task explicitly asks to keep the current stable-key
 * semantics for now and report this as a limitation rather than
 * inventing new episode state (e.g. a publish-attempt counter or
 * timestamp folded into the key) — that would be a real product decision
 * outside this slice's surgical scope.
 *
 * FAILURE ISOLATION: every path through this function is a no-throw,
 * best-effort side effect relative to Calendar publish handling. Any
 * error inside the notification pipeline (the atomic claim, recipient
 * resolution, the Resend call) is caught and logged here; it never
 * propagates to api/_scheduledIngestionAdapter.js, never changes
 * googleCalendarSyncError, never un-commits the Item, and never blocks a
 * later retry.
 */
import { processAttentionNotification } from "./_notificationOrchestrator.js";

/**
 * notifyCalendarPublishFailure(uid, itemId, deps?) -> void
 * Called by api/_scheduledIngestionAdapter.js's recordPublishFailure
 * exactly when a real publish failure is recorded — the SAME transition
 * that writes googleCalendarSyncError, no new detection of its own.
 */
export async function notifyCalendarPublishFailure(uid, itemId, deps = {}) {
  const { notify = processAttentionNotification } = deps;
  if (!itemId) return;

  try {
    await notify(uid, { type: "calendar", id: itemId });
  } catch (err) {
    console.error(`calendarPublishFailureNotificationTrigger: notification delivery failed for ${uid}/${itemId}`, err);
  }
}
