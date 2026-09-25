/* ============================== Notification delivery store (server-only, Admin SDK) ==============================
 * Persistence for the email-notification decision/deduplication layer
 * (src/data/notificationDecision.js). Stores ONLY what's needed to decide
 * whether a given attention condition has already been notified about —
 * never a notification queue, never notification preferences, never the
 * email itself (no provider is chosen or integrated in this slice — see
 * notificationDecision.js's own module doc for the full scope note).
 *
 * Record shape:
 *   { type, attentionKey, createdAt, sentAt, status, attemptedAt, claimExpiresAt }
 *   status: "pending" (claimed, not yet resolved) | "sent" | "failed"
 *   attemptedAt/claimExpiresAt: only meaningful while status is "pending"
 *   — see claimNotificationDelivery below. createdAt/sentAt keep their
 *   original meaning unchanged (first-ever-recorded time; time of the
 *   last successful send).
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
import { buildAttentionKey, shouldNotify } from "../src/data/notificationDecision.js";

// Same expiring-lease shape/duration convention as
// src/data/emailIngestionSchedule.js's EMAIL_INGESTION_LOCK_LEASE_MS —
// long enough to cover one real send attempt (network + provider round
// trip), short enough that a crashed/abandoned attempt doesn't block
// retries for long.
export const NOTIFICATION_CLAIM_LEASE_MS = 10 * 60 * 1000;

function defaultDb() {
  return getFirestore();
}

function deliveryDocId(uid, attentionKey) {
  return `${uid}:${attentionKey}`;
}

/**
 * claimNotificationDelivery(uid, attention) -> { claimed, reason, attentionKey }
 *
 * The atomic reliability correction: everywhere that used to do a
 * separate read (getNotificationDelivery) then a separate write
 * (recordNotificationAttempt) left a window where two concurrent
 * invocations could both observe "no delivery yet" and both send the
 * same notification. This performs the read-decide-write as ONE Admin
 * SDK transaction, same pattern as
 * api/_householdProfileStore.js's tryAcquireEmailIngestionLock.
 *
 * Rules, evaluated inside the transaction against the current document:
 *   - an ACTIVE (unexpired) "pending" claim already owned by another
 *     attempt -> not claimed ("in_progress") — this is the new rule that
 *     closes the race; nothing in notificationDecision.js's shouldNotify
 *     has any concept of an in-flight attempt, since that only exists at
 *     the persistence layer.
 *   - otherwise (missing, "sent", "failed", or an EXPIRED "pending" claim
 *     — task: "allow recovery from an abandoned pending attempt after a
 *     small fixed lease timeout") -> shouldNotify's EXISTING sent/failed/
 *     unseen rules decide eligibility, reused rather than reimplemented
 *     (an expired pending claim is treated exactly like a failed one, the
 *     same "retry eligible" outcome). If eligible, this transaction
 *     atomically writes status:"pending" with a fresh claimExpiresAt
 *     lease and returns claimed:true — no other concurrent call can also
 *     see and claim the same document, because both run inside
 *     Firestore's own serializable transactions, which abort and retry
 *     on a conflicting concurrent write rather than allowing both to
 *     "win".
 *
 * Never calls recordNotificationAttempt — this REPLACES that call site
 * for processAttentionNotification's flow; recordNotificationAttempt
 * itself is untouched and still available for any other caller.
 */
export async function claimNotificationDelivery(uid, attention, { now = new Date(), db = defaultDb() } = {}) {
  const attentionKey = buildAttentionKey(attention);
  const ref = db.collection("notificationDeliveries").doc(deliveryDocId(uid, attentionKey));
  const nowIso = now.toISOString();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? snap.data() : null;

    const activePendingClaim = existing?.status === "pending" && existing.claimExpiresAt && existing.claimExpiresAt > nowIso;
    if (activePendingClaim) {
      return { claimed: false, reason: "in_progress", attentionKey };
    }

    // An expired pending claim is an abandoned attempt — treat it as a
    // failure for eligibility purposes only (recovery), never mutating
    // the actual stored status until the transaction commits below.
    const effectiveExisting = existing?.status === "pending" ? { ...existing, status: "failed" } : existing;
    const decision = shouldNotify({ attention, existingDelivery: effectiveExisting });
    if (!decision.eligible) {
      return { claimed: false, reason: decision.reason, attentionKey };
    }

    const claimExpiresAt = new Date(now.getTime() + NOTIFICATION_CLAIM_LEASE_MS).toISOString();
    const data = {
      type: attention.type,
      attentionKey,
      createdAt: existing?.createdAt ?? nowIso,
      sentAt: existing?.sentAt ?? null,
      status: "pending",
      attemptedAt: nowIso,
      claimExpiresAt,
    };
    tx.set(ref, data);
    return { claimed: true, reason: decision.reason, attentionKey };
  });
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
