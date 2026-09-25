/* ============================== Notification decision (pure) ==============================
 * MVP email-notification decision/deduplication layer — the smallest
 * mechanism needed to decide whether a newly detected attention condition
 * should generate ONE parent email notification. This module sends
 * nothing and knows nothing about any email provider (no SendGrid/Resend/
 * Postmark/Gmail API/SES chosen or integrated here) — it is only:
 * attention -> dedupe decision. Persistence lives separately in
 * api/_notificationDeliveryStore.js; this file is pure, no I/O.
 *
 * Supports the attention types the MVP attention layer
 * (src/data/attentionSummary.js) surfaces on Parent Board, plus one
 * batched variant — this module is a sibling to that one, never a
 * replacement or modification of it:
 *   "gmail"        — Gmail connection needs reconnect/auth
 *   "review"       — a single Review Inbox item (IngestionCandidate)
 *                    needs review (per-candidate identity — reserved for
 *                    a future non-batched caller; no current trigger
 *                    uses this type)
 *   "review_batch" — one or more NEW Review Inbox candidates created by
 *                    processing a single source (e.g. one email) need
 *                    review — see api/_reviewBatchNotificationTrigger.js.
 *                    A deliberately SEPARATE key namespace from "review"
 *                    (never `review:<id>`) so a batch notification can
 *                    never collide with, or be confused with, a
 *                    per-candidate one in the delivery store.
 *   "calendar"     — a committed Item's Google Calendar publish failed
 *
 * NOTIFICATION IDENTITY — buildAttentionKey(attention)
 * A stable, non-timestamp-as-identity dedupe key per notification-worthy
 * condition:
 *   gmail:        "gmail:reconnect:<connectedAt>" (episode-scoped — see below)
 *   review:       "review:<candidateId>"          (one per IngestionCandidate)
 *   review_batch: "review-batch:<sourceId>"       (one per source/run —
 *                                                   e.g. per email's own
 *                                                   SourceRecord id; an
 *                                                   optional `count` on
 *                                                   the attention is NEVER
 *                                                   part of the key, only
 *                                                   used later for the
 *                                                   email's own text)
 *   calendar:     "calendar:<itemId>"             (one per committed Item)
 * review/review_batch/calendar keys never include a timestamp — a key
 * must identify the SAME underlying condition across repeated
 * evaluations (e.g. every scheduled check), not a single moment in time.
 *
 * GMAIL RECONNECT — EPISODE-SCOPED KEY
 * A bare "gmail:reconnect" key would be a single, constant, household-wide
 * key forever: once a delivery for it is marked "sent", every future
 * reconnect-required episode would be suppressed too, even a genuinely
 * NEW one (the parent successfully reconnects, and the connection later
 * breaks again). To distinguish episodes without inventing any new
 * persisted state, the key incorporates the household's EXISTING
 * connectedAt value (see api/_gmailConnectionsStore.js's
 * upsertGmailConnection, which sets a fresh connectedAt on every
 * successful reconnect — never touched by this module). The same broken
 * connection is the same connectedAt, so repeated checks during one
 * episode produce the identical key and dedupe correctly; a later
 * successful reconnect changes connectedAt, so a subsequent disconnect
 * naturally produces a NEW key and is eligible to notify again — no
 * lastManualRunAt-style extra field needed, no episode counter invented.
 * connectedAt is required for a "gmail" attention: if it is missing (an
 * unexpected state — reconnect-required with no prior successful
 * connection on record at all), buildAttentionKey throws rather than
 * falling back to some other timestamp (e.g. "now") — a fabricated
 * timestamp would itself be a fresh, unstable key on every evaluation,
 * defeating dedupe entirely, which is exactly the failure mode timestamps
 * are excluded from identity to prevent.
 */

/**
 * buildAttentionKey({ type, id, connectedAt }) -> string
 * Throws for an unsupported type, a missing id where one is required
 * (review/review_batch/calendar), or a missing connectedAt for a "gmail"
 * attention — never silently falls back to a colliding or unstable key.
 */
export function buildAttentionKey({ type, id, connectedAt } = {}) {
  if (type === "gmail") {
    if (!connectedAt) throw new Error('buildAttentionKey: "gmail" attention requires connectedAt (existing Gmail connection state) — never fabricated');
    return `gmail:reconnect:${connectedAt}`;
  }
  if (type === "review") {
    if (!id) throw new Error('buildAttentionKey: "review" attention requires an id (the IngestionCandidate id)');
    return `review:${id}`;
  }
  if (type === "review_batch") {
    if (!id) throw new Error('buildAttentionKey: "review_batch" attention requires an id (a stable source/run identity, e.g. the email\'s own SourceRecord id)');
    return `review-batch:${id}`;
  }
  if (type === "calendar") {
    if (!id) throw new Error('buildAttentionKey: "calendar" attention requires an id (the Item id)');
    return `calendar:${id}`;
  }
  throw new Error(`buildAttentionKey: unsupported attention type "${type}"`);
}

/**
 * shouldNotify({ attention, existingDelivery }) -> { eligible, reason, attentionKey }
 *
 * attention: { type: "gmail"|"review"|"review_batch"|"calendar", id?,
 *   connectedAt?, count? } — the notification-worthy condition instance
 *   being evaluated right now (id for review/review_batch/calendar,
 *   connectedAt for gmail — see buildAttentionKey; count is
 *   review_batch-only, presentation data never read by this function or
 *   folded into the key).
 * existingDelivery: the previously stored delivery record for this
 *   condition's attentionKey (see api/_notificationDeliveryStore.js's
 *   shape), or null/undefined if none exists yet.
 *
 * Rules:
 *   - no existingDelivery at all      -> eligible ("unseen")
 *   - existingDelivery.status "sent"  -> suppressed ("already_sent")
 *   - existingDelivery.status "failed" -> eligible ("retry_after_failure")
 *   - any other/unresolved status (e.g. a record created but never
 *     resolved to sent/failed, such as after a server crash mid-attempt)
 *     -> eligible ("unresolved_prior_delivery"), since nothing here
 *     confirms a notification was ever actually delivered
 */
export function shouldNotify({ attention, existingDelivery = null } = {}) {
  const attentionKey = buildAttentionKey(attention);

  if (!existingDelivery) {
    return { eligible: true, reason: "unseen", attentionKey };
  }
  if (existingDelivery.status === "sent") {
    return { eligible: false, reason: "already_sent", attentionKey };
  }
  if (existingDelivery.status === "failed") {
    return { eligible: true, reason: "retry_after_failure", attentionKey };
  }
  return { eligible: true, reason: "unresolved_prior_delivery", attentionKey };
}
