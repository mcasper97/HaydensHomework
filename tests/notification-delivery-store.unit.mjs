/**
 * Focused unit tests for api/_notificationDeliveryStore.js — the
 * server-only Admin-SDK persistence layer for the notification
 * decision/deduplication slice (src/data/notificationDecision.js). Every
 * function takes `db` as an explicit option, so the lazy `defaultDb()`
 * parameter (which would call firebase-admin/firestore's getFirestore())
 * is never reached — no live Firebase project needed (same convention as
 * tests/household-profile-store-lock.unit.mjs).
 *
 * Usage: node tests/notification-delivery-store.unit.mjs
 */
import {
  getNotificationDelivery,
  recordNotificationAttempt,
  markNotificationSent,
  markNotificationFailed,
  claimNotificationDelivery,
  NOTIFICATION_CLAIM_LEASE_MS,
} from "../api/_notificationDeliveryStore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

/**
 * Minimal in-memory Firestore-Admin-SDK-shaped fake, keyed by full path
 * string. runTransaction mirrors tests/household-profile-store-lock.unit.mjs's
 * own fake — no dot-notation merge logic is needed here since every write
 * in this store (including claimNotificationDelivery's tx.set) is always
 * a full-document replace, never a partial merge.
 */
function createFakeAdminDb() {
  const store = new Map();
  function docRef(path) {
    return {
      path,
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      set: async (data) => { store.set(path, data); },
    };
  }
  function collRef(name) {
    return { doc: (id) => docRef(`${name}/${id}`) };
  }
  return {
    db: {
      collection: (name) => collRef(name),
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => ref.get(),
          set: (ref, data) => { store.set(ref.path, data); },
        };
        return fn(tx);
      },
    },
    store,
  };
}

const UID = "household-1";

// ============ Read with nothing stored ============
{
  const { db } = createFakeAdminDb();
  const result = await getNotificationDelivery(UID, "review:cand-1", { db });
  ok("getNotificationDelivery returns null when nothing is stored yet", result === null);
}

// ============ Create records a pending delivery ============
{
  const { db, store } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");
  const created = await recordNotificationAttempt(UID, { type: "review", attentionKey: "review:cand-1" }, { now, db });

  ok("recordNotificationAttempt returns the new record", created.type === "review" && created.attentionKey === "review:cand-1");
  ok("A new record starts at status 'pending'", created.status === "pending");
  ok("A new record's createdAt is the injected now", created.createdAt === now.toISOString());
  ok("A new record's sentAt starts null", created.sentAt === null);

  const fetched = await getNotificationDelivery(UID, "review:cand-1", { db });
  ok("getNotificationDelivery now returns the just-recorded delivery", fetched && fetched.status === "pending");
  ok("Deterministic doc id: stored under exactly one key derived from uid + attentionKey", store.size === 1 && store.has(`notificationDeliveries/${UID}:review:cand-1`));
}

// ============ markNotificationSent resolves an existing record ============
{
  const { db } = createFakeAdminDb();
  const createdAt = new Date("2026-01-15T09:00:00.000Z");
  await recordNotificationAttempt(UID, { type: "calendar", attentionKey: "calendar:item-9" }, { now: createdAt, db });

  const sentAt = new Date("2026-01-15T09:05:00.000Z");
  const updated = await markNotificationSent(UID, "calendar:item-9", { now: sentAt, db });

  ok("markNotificationSent returns the updated record", updated.status === "sent");
  ok("markNotificationSent sets sentAt", updated.sentAt === sentAt.toISOString());
  ok("markNotificationSent preserves the original createdAt", updated.createdAt === createdAt.toISOString());
  ok("markNotificationSent preserves attentionKey/type", updated.attentionKey === "calendar:item-9" && updated.type === "calendar");

  const fetched = await getNotificationDelivery(UID, "calendar:item-9", { db });
  ok("The persisted record reflects the sent status", fetched.status === "sent" && fetched.sentAt === sentAt.toISOString());
}

// ============ markNotificationFailed resolves an existing record ============
{
  const { db } = createFakeAdminDb();
  await recordNotificationAttempt(UID, { type: "gmail", attentionKey: "gmail:reconnect" }, { db });

  const updated = await markNotificationFailed(UID, "gmail:reconnect", { db });
  ok("markNotificationFailed returns the updated record with status 'failed'", updated.status === "failed");
  ok("markNotificationFailed leaves sentAt null (never actually sent)", updated.sentAt === null);

  const fetched = await getNotificationDelivery(UID, "gmail:reconnect", { db });
  ok("The persisted record reflects the failed status", fetched.status === "failed");
}

// ============ Retry preserves createdAt but resets status to pending ============
{
  const { db } = createFakeAdminDb();
  const firstAttempt = new Date("2026-01-15T09:00:00.000Z");
  await recordNotificationAttempt(UID, { type: "calendar", attentionKey: "calendar:item-5" }, { now: firstAttempt, db });
  await markNotificationFailed(UID, "calendar:item-5", { db });

  const retryAt = new Date("2026-01-16T09:00:00.000Z");
  const retried = await recordNotificationAttempt(UID, { type: "calendar", attentionKey: "calendar:item-5" }, { now: retryAt, db });

  ok("A retry attempt resets status to 'pending'", retried.status === "pending");
  ok("A retry attempt preserves the ORIGINAL createdAt (same underlying condition, not a new delivery history)", retried.createdAt === firstAttempt.toISOString());
}

// ============ Marking sent/failed with no prior record is a safe no-op ============
{
  const { db } = createFakeAdminDb();
  const result = await markNotificationSent(UID, "review:never-recorded", { db });
  ok("markNotificationSent on a never-recorded attentionKey is a no-op (returns null, creates nothing)", result === null);
  const fetched = await getNotificationDelivery(UID, "review:never-recorded", { db });
  ok("No record was created by the no-op markNotificationSent", fetched === null);
}
{
  const { db } = createFakeAdminDb();
  const result = await markNotificationFailed(UID, "review:never-recorded", { db });
  ok("markNotificationFailed on a never-recorded attentionKey is also a safe no-op", result === null);
}

// ============ Deterministic id keeps different households and different keys isolated ============
{
  const { db, store } = createFakeAdminDb();
  await recordNotificationAttempt("uid-a", { type: "review", attentionKey: "review:cand-1" }, { db });
  await recordNotificationAttempt("uid-b", { type: "review", attentionKey: "review:cand-1" }, { db });
  await recordNotificationAttempt("uid-a", { type: "calendar", attentionKey: "calendar:item-1" }, { db });

  ok("Three distinct (uid, attentionKey) pairs produce three distinct stored documents", store.size === 3);

  await markNotificationSent("uid-a", "review:cand-1", { db });
  const uidBRecord = await getNotificationDelivery("uid-b", "review:cand-1", { db });
  ok("Marking uid-a's delivery sent never affects uid-b's delivery for the SAME attentionKey", uidBRecord.status === "pending");
}

// ============ claimNotificationDelivery: atomic claim (reliability correction) ============

// 1. First unseen notification acquires claim
{
  const { db } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");
  const result = await claimNotificationDelivery(UID, { type: "review", id: "cand-1" }, { now, db });

  ok("First unseen notification acquires the claim", result.claimed === true);
  ok("... reason is 'unseen'", result.reason === "unseen");
  ok("... attentionKey is review:cand-1", result.attentionKey === "review:cand-1");

  const stored = await getNotificationDelivery(UID, "review:cand-1", { db });
  ok("Claiming writes a pending record", stored.status === "pending");
  ok("... with attemptedAt set to the injected now", stored.attemptedAt === now.toISOString());
  ok("... and claimExpiresAt set NOTIFICATION_CLAIM_LEASE_MS in the future", stored.claimExpiresAt === new Date(now.getTime() + NOTIFICATION_CLAIM_LEASE_MS).toISOString());
}

// 2. Second concurrent attempt does not acquire same claim
{
  const { db } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");
  const first = await claimNotificationDelivery(UID, { type: "review", id: "cand-2" }, { now, db });
  ok("Setup: first claim succeeds", first.claimed === true);

  const second = await claimNotificationDelivery(UID, { type: "review", id: "cand-2" }, { now: new Date(now.getTime() + 1000), db });
  ok("A second concurrent attempt (1s later, still inside the lease) does not acquire the same claim", second.claimed === false);
  ok("... reason is 'in_progress'", second.reason === "in_progress");
}

// 3. Sent delivery remains suppressed
{
  const { db } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");
  const first = await claimNotificationDelivery(UID, { type: "review", id: "cand-3" }, { now, db });
  await markNotificationSent(UID, first.attentionKey, { db });

  const again = await claimNotificationDelivery(UID, { type: "review", id: "cand-3" }, { now: new Date(now.getTime() + 1000), db });
  ok("A sent delivery remains suppressed — never re-claimed", again.claimed === false);
  ok("... reason is 'already_sent'", again.reason === "already_sent");
}

// 4. Failed delivery can be claimed again
{
  const { db } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");
  const first = await claimNotificationDelivery(UID, { type: "calendar", id: "item-4" }, { now, db });
  await markNotificationFailed(UID, first.attentionKey, { db });

  const retry = await claimNotificationDelivery(UID, { type: "calendar", id: "item-4" }, { now: new Date(now.getTime() + 1000), db });
  ok("A failed delivery can be claimed again", retry.claimed === true);
  ok("... reason is 'retry_after_failure'", retry.reason === "retry_after_failure");
}

// 5. Expired pending claim can be reclaimed (recovery from an abandoned attempt)
{
  const { db } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");
  const first = await claimNotificationDelivery(UID, { type: "gmail", connectedAt: "2026-01-01T00:00:00.000Z" }, { now, db });
  ok("Setup: first claim succeeds (simulated crash — never resolved to sent/failed)", first.claimed === true);

  const afterLeaseExpiry = new Date(now.getTime() + NOTIFICATION_CLAIM_LEASE_MS + 1000);
  const reclaimed = await claimNotificationDelivery(UID, { type: "gmail", connectedAt: "2026-01-01T00:00:00.000Z" }, { now: afterLeaseExpiry, db });
  ok("An expired pending claim (abandoned attempt) CAN be reclaimed once its lease elapses", reclaimed.claimed === true);
  ok("... treated the same as a failed delivery (retry-eligible)", reclaimed.reason === "retry_after_failure");
}

// 6. Active pending claim cannot be reclaimed (right up to the boundary)
{
  const { db } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");
  const first = await claimNotificationDelivery(UID, { type: "review", id: "cand-6" }, { now, db });
  ok("Setup: first claim succeeds", first.claimed === true);

  const justBeforeExpiry = new Date(now.getTime() + NOTIFICATION_CLAIM_LEASE_MS - 1000);
  const blocked = await claimNotificationDelivery(UID, { type: "review", id: "cand-6" }, { now: justBeforeExpiry, db });
  ok("An active (not-yet-expired) pending claim cannot be reclaimed, even 1s before its lease expires", blocked.claimed === false && blocked.reason === "in_progress");

  const stillOwned = await getNotificationDelivery(UID, "review:cand-6", { db });
  ok("The blocked attempt never overwrote the original claim's attemptedAt", stillOwned.attemptedAt === now.toISOString());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
