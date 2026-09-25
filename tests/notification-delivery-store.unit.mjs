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
} from "../api/_notificationDeliveryStore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

/** Minimal in-memory Firestore-Admin-SDK-shaped fake, keyed by full path string. */
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
  return { db: { collection: (name) => collRef(name) }, store };
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
