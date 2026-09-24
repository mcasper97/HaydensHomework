/**
 * Focused unit tests for api/_householdProfileStore.js's expiring-lease
 * lock pair — tryAcquireEmailIngestionLock / releaseEmailIngestionLock —
 * the follow-up correction that replaced the original plain-boolean
 * runInProgress lock (which could block a household forever if the server
 * process died mid-run) with a minimal { acquiredAt, expiresAt } lease.
 *
 * No module mocking is needed here (contrast with
 * tests/scheduled-ingestion-adapter.unit.mjs): both functions accept `db`
 * as an explicit option, so their lazy `defaultDb()` parameter (which
 * would call firebase-admin/firestore's getFirestore()) is never reached.
 * Only api/_auth.js's Admin-app-init side effect runs on import, and it
 * defers any init error rather than throwing (see api/_auth.js) — safe
 * with no real credentials configured.
 *
 * Usage: node --test tests/household-profile-store-lock.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";
import { tryAcquireEmailIngestionLock, releaseEmailIngestionLock } from "../api/_householdProfileStore.js";
import { EMAIL_INGESTION_LOCK_LEASE_MS } from "../src/data/emailIngestionSchedule.js";

const UID = "lease-household-1";

/**
 * applyMergePatch(existing, patch) — models real Firestore's documented
 * {merge: true} field-path behavior: a dot-notation key (e.g.
 * "emailIngestionSchedule.runLock", exactly what releaseEmailIngestionLock
 * writes) updates ONLY that nested leaf, leaving sibling fields (enabled,
 * localTime, ...) untouched; a plain key replaces that whole top-level
 * field (which is fine here — every plain-key write in this app already
 * passes the FULL sub-object, e.g. tryAcquireEmailIngestionLock's
 * emailIngestionSchedule write). A naive shallow `{...existing, ...data}`
 * merge (as used elsewhere in this suite's fakes, where nothing writes
 * dot-notation keys) would silently fail to clear the nested runLock here
 * and make these tests pass for the wrong reason.
 */
function applyMergePatch(existing, patch) {
  const result = { ...(existing || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (key.includes(".")) {
      const [topKey, ...rest] = key.split(".");
      result[topKey] = { ...(result[topKey] || {}), [rest.join(".")]: value };
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * A minimal in-memory Firestore-Admin-SDK-shaped fake — supports exactly
 * what tryAcquireEmailIngestionLock/releaseEmailIngestionLock need:
 * collection().doc().get()/set(), and runTransaction with the same
 * tx.get/set surface. Keyed by full path string, not a real Firestore
 * instance (same minimal-fake approach as
 * tests/scheduled-ingestion-adapter.unit.mjs's createFakeAdminDb).
 */
function createFakeAdminDb(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs));

  function docRef(path) {
    return {
      path,
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      set: async (data, opts) => {
        store.set(path, opts?.merge ? applyMergePatch(store.get(path), data) : data);
      },
    };
  }
  function collRef(path) {
    return { doc: (id) => docRef(`${path}/${id}`) };
  }

  return {
    db: {
      collection: (name) => collRef(name),
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => ref.get(),
          set: (ref, data, opts) => {
            store.set(ref.path, opts?.merge ? applyMergePatch(store.get(ref.path), data) : data);
          },
        };
        return fn(tx);
      },
    },
    store,
  };
}

function docPath(uid) {
  return `users/${uid}`;
}

// ============ 1. Active lease blocks overlap ============
test("an active (unexpired) lease blocks a second concurrent acquire", async () => {
  const { db } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");

  const first = await tryAcquireEmailIngestionLock(UID, { db, now });
  assert.strictEqual(first, true, "first acquire succeeds");

  const secondAttemptAt = new Date("2026-01-15T09:05:00.000Z"); // 5 min later, still inside the 10-min lease
  const second = await tryAcquireEmailIngestionLock(UID, { db, now: secondAttemptAt });
  assert.strictEqual(second, false, "second acquire is blocked by the still-active lease");
});

// ============ 2. Expired lease does not block a new run ============
test("an expired lease does not block a later acquire", async () => {
  const { db } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");

  const first = await tryAcquireEmailIngestionLock(UID, { db, now });
  assert.strictEqual(first, true);

  const laterAttemptAt = new Date(now.getTime() + EMAIL_INGESTION_LOCK_LEASE_MS + 1000); // 1s past expiry
  const second = await tryAcquireEmailIngestionLock(UID, { db, now: laterAttemptAt });
  assert.strictEqual(second, true, "the expired lease is replaced by a fresh one");
});

// ============ 3. Successful run clears lease ============
test("releaseEmailIngestionLock after a successful run clears the lease (runLock: null)", async () => {
  const { db, store } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");

  await tryAcquireEmailIngestionLock(UID, { db, now });
  await releaseEmailIngestionLock(UID, { status: "success", lastRunAt: now.toISOString(), lastRunLocalDate: "2026-01-15" }, { db });

  const stored = store.get(docPath(UID));
  assert.strictEqual(stored.emailIngestionSchedule.runLock, null);
  assert.strictEqual(stored.emailIngestionSchedule.lastRunStatus, "success");

  // And a subsequent acquire attempt succeeds immediately (lease is gone, not just expired).
  const reacquired = await tryAcquireEmailIngestionLock(UID, { db, now: new Date("2026-01-15T09:00:01.000Z") });
  assert.strictEqual(reacquired, true);
});

// ============ 4. Failed run clears lease ============
test("releaseEmailIngestionLock after a failed run also clears the lease (runLock: null)", async () => {
  const { db, store } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");

  await tryAcquireEmailIngestionLock(UID, { db, now });
  await releaseEmailIngestionLock(UID, { status: "failed", lastRunAt: now.toISOString() }, { db });

  const stored = store.get(docPath(UID));
  assert.strictEqual(stored.emailIngestionSchedule.runLock, null);
  assert.strictEqual(stored.emailIngestionSchedule.lastRunStatus, "failed");

  const reacquired = await tryAcquireEmailIngestionLock(UID, { db, now: new Date("2026-01-15T09:00:01.000Z") });
  assert.strictEqual(reacquired, true, "a failed run's cleared lease never blocks the very next attempt");
});

// ============ 5. Process-crash simulation: an expired lease never blocks forever ============
test("a lease acquired but never released (simulated process crash) stops blocking once it expires", async () => {
  const { db } = createFakeAdminDb();
  const crashInstant = new Date("2026-01-15T09:00:00.000Z");

  const acquired = await tryAcquireEmailIngestionLock(UID, { db, now: crashInstant });
  assert.strictEqual(acquired, true);
  // Simulate the process dying here — releaseEmailIngestionLock is
  // deliberately never called for this run.

  // Shortly after the crash, the lease is still active — still blocked.
  const soonAfter = new Date(crashInstant.getTime() + 60 * 1000); // 1 min later
  assert.strictEqual(await tryAcquireEmailIngestionLock(UID, { db, now: soonAfter }), false);

  // Once the lease's fixed duration has elapsed, a later invocation (e.g.
  // the next Cron tick) can acquire it again — the household is never
  // permanently blocked by the crashed run.
  const afterLeaseExpiry = new Date(crashInstant.getTime() + EMAIL_INGESTION_LOCK_LEASE_MS + 1000);
  assert.strictEqual(await tryAcquireEmailIngestionLock(UID, { db, now: afterLeaseExpiry }), true);
});

// ============ 6. Releasing with no bookkeeping payload only clears the lease ============
test("releaseEmailIngestionLock(uid, {}) clears runLock but writes none of status/lastRunAt/lastRunLocalDate (manual Run Now bookkeeping-free release)", async () => {
  const { db, store } = createFakeAdminDb();
  const now = new Date("2026-01-15T09:00:00.000Z");

  await tryAcquireEmailIngestionLock(UID, { db, now });
  // Seed a prior automatic run's bookkeeping so we can prove this release
  // leaves it untouched (the "Last automatic check" display must survive
  // a manual Run Now unchanged).
  store.set(docPath(UID), {
    emailIngestionSchedule: {
      runLock: { acquiredAt: now.toISOString(), expiresAt: now.toISOString() },
      lastRunStatus: "success",
      lastRunAt: "2026-01-14T09:00:00.000Z",
      lastRunLocalDate: "2026-01-14",
    },
  });

  await releaseEmailIngestionLock(UID, {}, { db });

  const stored = store.get(docPath(UID));
  assert.strictEqual(stored.emailIngestionSchedule.runLock, null, "the lease is still cleared");
  assert.strictEqual(stored.emailIngestionSchedule.lastRunStatus, "success", "yesterday's automatic lastRunStatus is untouched");
  assert.strictEqual(stored.emailIngestionSchedule.lastRunAt, "2026-01-14T09:00:00.000Z", "yesterday's automatic lastRunAt is untouched");
  assert.strictEqual(stored.emailIngestionSchedule.lastRunLocalDate, "2026-01-14", "yesterday's lastRunLocalDate is untouched — today's slot is not consumed");

  // And the lease is genuinely gone, not just expired — the very next attempt succeeds immediately.
  const reacquired = await tryAcquireEmailIngestionLock(UID, { db, now: new Date("2026-01-15T09:00:01.000Z") });
  assert.strictEqual(reacquired, true);
});

console.log("household-profile-store-lock.unit.mjs: all tests defined (node:test reports results below)");
