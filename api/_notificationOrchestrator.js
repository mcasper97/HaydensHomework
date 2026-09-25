/* ============================== Notification orchestrator (server-only) ==============================
 * Wires the already-built decision/dedupe layer
 * (src/data/notificationDecision.js), delivery store
 * (api/_notificationDeliveryStore.js), and email transport
 * (api/_emailNotificationTransport.js) together into the one flow that
 * actually sends a parent notification email for a supported attention
 * condition. This file owns the FLOW only — it duplicates no decision
 * logic (buildAttentionKey/shouldNotify are called, never reimplemented)
 * and no provider logic (sendParentNotificationEmail is called, never
 * reimplemented).
 *
 * Supports exactly the three attention types notificationDecision.js
 * already supports: "gmail" | "review" | "calendar". Content is a fixed,
 * static plain-text template per type — never interpolates any external/
 * candidate/email content (task: "Do not include sensitive full email
 * contents"), so there is nothing here that could unsafely carry
 * untrusted text into the message body.
 */
import {
  claimNotificationDelivery,
  markNotificationSent,
  markNotificationFailed,
} from "./_notificationDeliveryStore.js";
import { sendParentNotificationEmail } from "./_emailNotificationTransport.js";
import { getHouseholdOwnerEmail } from "./_auth.js";

const EMAIL_CONTENT = {
  gmail: {
    subject: "Hayden's Homework needs Gmail reconnected",
    text: "Automatic email checking has stopped because Gmail needs to be reconnected.\n\nOpen Hayden's Homework and go to Settings to reconnect Gmail.",
  },
  review: {
    subject: "Hayden's Homework needs your review",
    text: "One or more school items need your review.\n\nOpen Hayden's Homework and go to Parent Board -> Review Inbox to review them.",
  },
  calendar: {
    subject: "Hayden's Homework couldn't update Google Calendar",
    text: "One or more items could not be published to Google Calendar and need your attention.\n\nOpen Hayden's Homework and go to Parent Board -> Review Inbox to retry.",
  },
};

/**
 * buildNotificationEmailContent(attention) -> { subject, text }
 * Pure — a fixed template keyed only by attention.type. Throws for an
 * unsupported type (same fail-closed convention as buildAttentionKey).
 */
export function buildNotificationEmailContent(attention) {
  const content = EMAIL_CONTENT[attention?.type];
  if (!content) throw new Error(`buildNotificationEmailContent: unsupported attention type "${attention?.type}"`);
  return content;
}

/**
 * processAttentionNotification(uid, attention, deps?) -> outcome
 *
 * Flow (reliability correction — replaces the old non-atomic
 * read-delivery / shouldNotify / record-pending sequence, which left a
 * window for two concurrent invocations to both observe "no delivery"
 * and both send):
 *   1. atomic claim (api/_notificationDeliveryStore.js's
 *      claimNotificationDelivery — derives the attentionKey, decides
 *      eligibility, AND claims the delivery for this attempt, all inside
 *      one Admin SDK transaction)
 *   2. if not claimed -> return suppressed/in-progress (claim.reason
 *      distinguishes "already_sent" from a concurrent "in_progress"
 *      attempt from another invocation)
 *   3. resolve trusted recipient (server-side account data — never
 *      client input; see getHouseholdOwnerEmail)
 *   4. send email
 *   5. mark sent on success / mark failed on provider failure (including
 *      "no recipient email on file", which is also a real failure to
 *      deliver, not left stuck at "pending" forever)
 *
 * Every collaborator is swappable via `deps` (same injected-dependency
 * convention used throughout this app's server modules, e.g.
 * api/_scheduledIngestionRunner.js's executeHouseholdIngestionRun) so
 * this function's own tests need no module mocking.
 */
export async function processAttentionNotification(uid, attention, deps = {}) {
  const {
    claimDelivery = claimNotificationDelivery,
    markSent = markNotificationSent,
    markFailed = markNotificationFailed,
    getRecipientEmail = getHouseholdOwnerEmail,
    sendEmail = sendParentNotificationEmail,
    buildContent = buildNotificationEmailContent,
  } = deps;

  const claim = await claimDelivery(uid, attention);
  if (!claim.claimed) {
    return { sent: false, suppressed: true, reason: claim.reason, attentionKey: claim.attentionKey };
  }

  const recipient = await getRecipientEmail(uid);
  if (!recipient) {
    await markFailed(uid, claim.attentionKey);
    return { sent: false, suppressed: false, reason: "no_recipient_email", attentionKey: claim.attentionKey };
  }

  const { subject, text } = buildContent(attention);
  const result = await sendEmail({ to: recipient, subject, text });

  if (result.ok) {
    await markSent(uid, claim.attentionKey);
    return { sent: true, suppressed: false, attentionKey: claim.attentionKey };
  }

  await markFailed(uid, claim.attentionKey);
  return { sent: false, suppressed: false, reason: "provider_failure", error: result.error, attentionKey: claim.attentionKey };
}
