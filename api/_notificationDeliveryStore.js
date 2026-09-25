/* ============================== Notification delivery store (server-only, Admin SDK) ==============================
 * Persistence for the email-notification decision/deduplication layer
 * (src/data/notificationDecision.js). Stores ONLY what's needed to decide
 * whether a given attention condition has already been notified about —
 * never a notification queue, never notification preferences, never the
 * email itself (no provider is chosen or integrated in this slice — see
 * notificationDecision.js's own module doc for the full scope note).
 *
 * Record shape:
 *   { type, attentionKey, createdAt, sentAt, status }
 *   status: "pending" (recorded, not yet resolved) | "sent" | "failed"
 *
 * Lives in its OWN top-level collection (notificationDeliveries), not
 * beneath users/{uid}/..., for the same reason api/_gmailConnectionsStore.js
 * documents for gmailConnections: so no users/{uid}-style client rule can
 * ever accidentally grant the browser access to it (see firestore.rules'
 * explicit deny-all added for this collection). No client-side
 * counterpart exists for this store, by design.
 *
 * Deterministic document id: `${uid}:${attentionKey}` — one delivery
 * record per household per notification-worthy condition, so re-reading
 * or re-recording the same condition never creates a duplicate document
 * (the whole point of the dedupe key — see notificationDecision.js's
 * buildAttentionKey). Every function takes an optional injected `db`
 * (defaulting to the real Admin Firestore instance), mirroring every
 * other server store in this app (e.g. api/_householdProfileStore.js).
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";

function defaultDb() {
  return getFirestore();
}

function deliveryDocId(uid, attentionKey) {
  return `${uid}:${attentionKey}`;
}

/**
 * getNotificationDelivery(uid, attentionKey) -> delivery record | null
 * The one read this store offers — feeds directly into
 * notificationDecision.js's shouldNotify({ attention, existingDelivery }).
 */
export async function getNotificationDelivery(uid, attentionKey, { db = defaultDb() } = {}) {
  const snap = await db.collection("notificationDeliveries").doc(deliveryDocId(uid, attentionKey)).get();
  return snap.exists ? snap.data() : null;
}

/**
 * recordNotificationAttempt(uid, { type, attentionKey }) -> the created/
 * updated delivery record, left at status "pending" until
 * markNotificationSent/markNotificationFailed resolves it.
 *
 * createdAt is set only ONCE — the first time this attentionKey is ever
 * recorded for this household — and preserved on every later call. A
 * retry after a prior failure reuses the same document/createdAt rather
 * than starting a new delivery history for what is still the SAME
 * notification-worthy condition; only `status` resets to "pending" for
 * the fresh attempt.
 */
export async function recordNotificationAttempt(uid, { type, attentionKey }, { now = new Date(), db = defaultDb() } = {}) {
  const ref = db.collection("notificationDeliveries").doc(deliveryDocId(uid, attentionKey));
  const existing = await ref.get();
  const existingData = existing.exists ? existing.data() : null;

  const data = {
    type,
    attentionKey,
    createdAt: existingData?.createdAt ?? now.toISOString(),
    sentAt: existingData?.sentAt ?? null,
    status: "pending",
  };
  await ref.set(data);
  return data;
}

/**
 * markNotificationSent(uid, attentionKey) -> the updated record, or null
 * if no delivery record exists yet for this attentionKey (a no-op, same
 * convention as api/_gmailConnectionsStore.js's
 * markGmailConnectionNeedsReconnect — never creates a record that was
 * never actually recorded/attempted).
 */
export async function markNotificationSent(uid, attentionKey, { now = new Date(), db = defaultDb() } = {}) {
  const ref = db.collection("notificationDeliveries").doc(deliveryDocId(uid, attentionKey));
  const existing = await ref.get();
  if (!existing.exists) return null;
  const data = { ...existing.data(), status: "sent", sentAt: now.toISOString() };
  await ref.set(data);
  return data;
}

/**
 * markNotificationFailed(uid, attentionKey) -> the updated record, or
 * null if no delivery record exists yet (same no-op convention as
 * markNotificationSent above).
 */
export async function markNotificationFailed(uid, attentionKey, { db = defaultDb() } = {}) {
  const ref = db.collection("notificationDeliveries").doc(deliveryDocId(uid, attentionKey));
  const existing = await ref.get();
  if (!existing.exists) return null;
  const data = { ...existing.data(), status: "failed" };
  await ref.set(data);
  return data;
}
