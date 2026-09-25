/* ============================== Gmail reconnect notification trigger (server-only) ==============================
 * Wires api/_gmailIngestionRunner.js's EXISTING GMAIL_RECONNECT_REQUIRED /
 * needsReconnect detection (api/_gmailIngestionCore.js's
 * scanApprovedSenderEmails, surfaced unchanged through
 * runHouseholdEmailIngestion's existing ok:false result — see that file's
 * own doc comment) to the already-built notification pipeline
 * (api/_notificationOrchestrator.js's processAttentionNotification). No
 * second Gmail-status detector, no new dedupe logic, no template/provider
 * change — this file only decides WHEN to call the existing pipeline and
 * WHAT trusted attention to pass it.
 *
 * CONNECTED-AT: read from the trusted server-side Gmail connection record
 * (api/_gmailConnectionsStore.js's getGmailConnection — the same store
 * every other server-side Gmail-connection read already uses), never from
 * client input, never fabricated. If connectedAt is missing (an
 * unexpected state — e.g. a reconnect-required failure with no successful
 * connection ever recorded), this logs the problem and returns WITHOUT
 * calling the notification pipeline at all. This is a deliberate
 * pre-check, not reliance on buildAttentionKey's own throw-on-missing-
 * connectedAt behavior (src/data/notificationDecision.js) — the task
 * requires this to "not throw in a way that breaks the ingestion run,"
 * and checking first, here, keeps that guarantee visible and explicit
 * rather than depending on a caught exception from three layers down.
 *
 * FAILURE ISOLATION: every path through this function is a no-throw,
 * best-effort side effect relative to Gmail ingestion. Any error —
 * reading the connection record, or anything inside the notification
 * pipeline (the atomic claim, recipient resolution, the Resend call) — is
 * caught and logged here; it never propagates to
 * api/_gmailIngestionRunner.js, never changes Gmail connection state, and
 * never creates a SourceRecord/IngestionCandidate (no Review Inbox
 * noise). The existing notification delivery store already owns retry
 * state for a failed send — this file does not retry anything itself.
 */
import { getGmailConnection } from "./_gmailConnectionsStore.js";
import { processAttentionNotification } from "./_notificationOrchestrator.js";

/**
 * notifyGmailReconnectRequired(uid, deps?) -> void
 * Called by runHouseholdEmailIngestion exactly when a run's scan result
 * carries needsReconnect: true — the SAME transition
 * api/_gmailIngestionCore.js's SCAN_ERROR_CODES.RECONNECT_REQUIRED /
 * needsReconnect already represents.
 *
 * Dedupe is entirely delegated to the existing pipeline: repeated calls
 * during the same broken-connection episode (same connectedAt) all
 * produce the same "gmail:reconnect:<connectedAt>" attention key, and
 * processAttentionNotification's atomic claim (see
 * api/_notificationDeliveryStore.js's claimNotificationDelivery) is what
 * actually suppresses a duplicate successful send — nothing here
 * re-implements that decision.
 */
export async function notifyGmailReconnectRequired(uid, deps = {}) {
  const { getConnection = getGmailConnection, notify = processAttentionNotification } = deps;

  let connectedAt;
  try {
    const connection = await getConnection(uid);
    connectedAt = connection?.connectedAt;
  } catch (err) {
    console.error(`gmailReconnectNotificationTrigger: could not read the Gmail connection record for ${uid}`, err);
    return;
  }

  if (!connectedAt) {
    console.error(
      `gmailReconnectNotificationTrigger: Gmail reconnect-required notification skipped for ${uid} — no connectedAt on file (never fabricating a timestamp-based attention identity)`
    );
    return;
  }

  try {
    await notify(uid, { type: "gmail", connectedAt });
  } catch (err) {
    console.error(`gmailReconnectNotificationTrigger: notification delivery failed for ${uid}`, err);
  }
}
