/**
 * Focused unit tests for api/_scheduledIngestionAdapter.js — the narrow
 * server-side (Admin SDK) bridge that lets a future scheduled email
 * ingestion job call the SAME finalizeExtractedCandidate orchestration
 * (src/data/ingestionFinalization.js) the manual "Check Email" flow
 * already uses, without a browser and without duplicating any decision
 * rule.
 *
 * Mocks api/_auth.js (Admin app init side effect) and firebase-admin/firestore
 * (a real Admin project isn't available in this test environment) with a
 * minimal in-memory Firestore-like fake, mirroring the established
 * t.mock.module strategy already used by tests/calendar-publish-endpoint.unit.mjs
 * for the exact same reason. decideAutoCommitEligibility, candidateToDraftItem,
 * and finalizeExtractedCandidate itself are all imported and run for REAL
 * (never mocked) — proving this adapter reuses the actual, unmodified
 * decision/orchestration logic, not a reimplemented copy.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/scheduled-ingestion-adapter.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

/**
 * A minimal in-memory Firestore-Admin-SDK-shaped fake — supports exactly
 * what api/_scheduledIngestionAdapter.js's commitCandidateToItemServerSide
 * needs: collection().doc().collection().doc() chaining, get/set/update,
 * and runTransaction with the same tx.get/set/update surface. Keyed by
 * full path string, not a real Firestore instance.
 */
function createFakeAdminDb(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs));

  function docRef(path) {
    return {
      path,
      id: path.split("/").pop(),
      collection: (name) => collRef(`${path}/${name}`),
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, id: path.split("/").pop(), data: () => data };
      },
      set: async (data) => { store.set(path, data); },
      update: async (patch) => { store.set(path, { ...(store.get(path) || {}), ...patch }); },
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
          set: (ref, data) => { store.set(ref.path, data); },
          update: (ref, patch) => { store.set(ref.path, { ...(store.get(ref.path) || {}), ...patch }); },
        };
        return fn(tx);
      },
    },
    store,
  };
}

function setupMocks(t, { db } = {}) {
  t.mock.module("../api/_auth.js", { namedExports: { requireFirebaseUser: async () => ({}), checkRateLimit: () => true } });
  t.mock.module("firebase-admin/firestore", {
    namedExports: {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" },
    },
  });
  // Auto-publish disabled by default (household default) — keeps these
  // decision/commit-focused tests from needing to also mock the Google
  // Calendar client chain; Calendar-publish-specific behavior is already
  // covered in depth by tests/google-calendar-publish-durability.unit.mjs
  // (client) — this file only needs to prove commit-first/publish-second
  // SEQUENCING and that the seam is injectable, not re-prove Calendar
  // mechanics.
  t.mock.module("../api/_householdProfileStore.js", {
    namedExports: {
      getHouseholdTimezone: async () => null,
      getGoogleCalendarRouting: async () => ({ defaultCalendarId: null, childCalendarIds: {} }),
      getGoogleCalendarAutoPublishEnabled: async () => false,
    },
  });
  t.mock.module("../api/_googleCalendarConnectionsStore.js", {
    namedExports: { getGoogleCalendarConnection: async () => null },
  });
  t.mock.module("../api/_itemsStore.js", {
    namedExports: {
      getItem: async () => null,
      setItemGoogleCalendarFields: async () => {},
    },
  });
  t.mock.module("../api/_googleCalendarClient.js", {
    namedExports: {
      deriveGoogleEventId: (id) => `evt-${id}`,
      refreshCalendarAccessToken: async () => ({ ok: false, error: "not mocked" }),
      insertCalendarEvent: async () => ({ ok: false, error: "not mocked" }),
    },
  });
}

const UID = "server-parent-1";

function seedCandidate(store, overrides = {}) {
  const candidate = {
    id: "cand-scheduled-1",
    reviewStatus: "pending",
    proposedType: "test",
    title: "Spelling Test",
    date: "2026-10-01",
    sourceRecordId: "source-email-1",
    targetType: "child",
    targetChildId: "hayden-canonical-id",
    extractionConfidence: 0.95,
    ...overrides,
  };
  store.set(`users/${UID}/ingestionCandidates/${candidate.id}`, candidate);
  return candidate;
}

// ============ finalizeCandidateServerSide: high confidence auto-commits ============
test("finalizeCandidateServerSide commits a high-confidence, field-complete, identity-resolved candidate", async (t) => {
  const { db, store } = createFakeAdminDb();
  setupMocks(t, { db });
  const { finalizeCandidateServerSide } = await freshImport("../api/_scheduledIngestionAdapter.js");

  const candidate = seedCandidate(store);
  const result = await finalizeCandidateServerSide(UID, candidate);

  assert.strictEqual(result.outcome, "auto_committed");
  assert.ok(result.item);
  assert.strictEqual(result.item.id, candidate.id, "Item id equals candidate id (deterministic idempotency key)");
  assert.strictEqual(result.item.commitMode, "automatic");
  assert.deepStrictEqual(result.item.childIds, ["hayden-canonical-id"]);

  const storedItem = store.get(`users/${UID}/items/${candidate.id}`);
  assert.ok(storedItem, "the Item was actually persisted in the fake Admin Firestore");
  const storedCandidate = store.get(`users/${UID}/ingestionCandidates/${candidate.id}`);
  assert.strictEqual(storedCandidate.reviewStatus, "committed");
});

// ============ Low confidence stays review-required ============
test("finalizeCandidateServerSide leaves a low-confidence candidate pending (review-required), no Item created", async (t) => {
  const { db, store } = createFakeAdminDb();
  setupMocks(t, { db });
  const { finalizeCandidateServerSide } = await freshImport("../api/_scheduledIngestionAdapter.js");

  const candidate = seedCandidate(store, { extractionConfidence: 0.2 });
  const result = await finalizeCandidateServerSide(UID, candidate);

  assert.strictEqual(result.outcome, "pending");
  assert.strictEqual(result.decision.eligible, false);
  assert.ok(result.decision.reasons.includes("low_confidence"));
  assert.strictEqual(store.get(`users/${UID}/items/${candidate.id}`), undefined, "no Item was persisted");
  assert.strictEqual(store.get(`users/${UID}/ingestionCandidates/${candidate.id}`).reviewStatus, "pending", "candidate untouched, stays pending for Review Inbox");
});

// ============ Missing confidence also fails safe ============
test("finalizeCandidateServerSide fails safe to pending when confidence is missing entirely", async (t) => {
  const { db, store } = createFakeAdminDb();
  setupMocks(t, { db });
  const { finalizeCandidateServerSide } = await freshImport("../api/_scheduledIngestionAdapter.js");

  const candidate = seedCandidate(store, { extractionConfidence: null });
  const result = await finalizeCandidateServerSide(UID, candidate);

  assert.strictEqual(result.outcome, "pending");
  assert.ok(result.decision.reasons.includes("missing_confidence"));
});

// ============ Idempotency: finalizing the same candidate twice never duplicates the Item ============
test("finalizing the same candidate twice does not create a duplicate Item", async (t) => {
  const { db, store } = createFakeAdminDb();
  setupMocks(t, { db });
  const { finalizeCandidateServerSide } = await freshImport("../api/_scheduledIngestionAdapter.js");

  const candidate = seedCandidate(store);
  const first = await finalizeCandidateServerSide(UID, candidate);
  assert.strictEqual(first.outcome, "auto_committed");

  // Re-finalize the SAME (stale, still-"pending"-in-memory) candidate
  // object — decideAutoCommitEligibility re-evaluates it as eligible
  // again, but commitCandidateToItemServerSide's own idempotent
  // transaction recognizes the candidate is already "committed" in
  // storage and returns the existing Item unchanged, never creating a
  // second one — same idempotency guarantee the client-side
  // commitCandidateToItem transaction provides (see
  // tests/candidate-commit-repository.unit.mjs).
  const second = await finalizeCandidateServerSide(UID, candidate);
  assert.strictEqual(second.outcome, "auto_committed");
  assert.strictEqual(second.item.id, first.item.id);

  const allItemKeys = [...store.keys()].filter((k) => k.startsWith(`users/${UID}/items/`));
  assert.strictEqual(allItemKeys.length, 1, "still exactly one Item after finalizing twice");
});

test("a direct retry of the underlying Admin-SDK commit transaction never overwrites the stored Item", async (t) => {
  const { db, store } = createFakeAdminDb();
  setupMocks(t, { db });
  const { commitCandidateToItemServerSide } = await freshImport("../api/_scheduledIngestionAdapter.js");

  const candidate = seedCandidate(store);
  const first = await commitCandidateToItemServerSide(UID, candidate.id, { title: "Spelling Test" }, { commitMode: "automatic" });
  const retry = await commitCandidateToItemServerSide(UID, candidate.id, { title: "Spelling Test (resubmitted, different)" }, { commitMode: "automatic" });

  assert.strictEqual(retry.id, first.id);
  assert.strictEqual(retry.title, "Spelling Test", "the retry's different payload never overwrote the stored item");
  const allItemKeys = [...store.keys()].filter((k) => k.startsWith(`users/${UID}/items/`));
  assert.strictEqual(allItemKeys.length, 1);
});

// ============ Provenance ============
test("provenance fields (sourceRecordId, sourceCandidateId, commitMode) are preserved on the committed Item", async (t) => {
  const { db, store } = createFakeAdminDb();
  setupMocks(t, { db });
  const { finalizeCandidateServerSide } = await freshImport("../api/_scheduledIngestionAdapter.js");

  const candidate = seedCandidate(store);
  const result = await finalizeCandidateServerSide(UID, candidate);

  assert.strictEqual(result.item.sourceRecordId, "source-email-1");
  assert.strictEqual(result.item.sourceCandidateId, candidate.id);
  assert.strictEqual(result.item.commitMode, "automatic");
  // extractionConfidence lives on the CANDIDATE, not copied onto the Item
  // (same established convention as the client path — see
  // tests/auto-commit-integration.unit.mjs) — full provenance is retained
  // via the candidate document itself, never deleted on commit.
  const storedCandidate = store.get(`users/${UID}/ingestionCandidates/${candidate.id}`);
  assert.strictEqual(storedCandidate.extractionConfidence, 0.95);
});

// ============ Commit-mechanics parity with the client-side rules ============
test("commitCandidateToItemServerSide refuses a nonexistent candidate (CANDIDATE_NOT_FOUND)", async (t) => {
  const { db } = createFakeAdminDb();
  setupMocks(t, { db });
  const { commitCandidateToItemServerSide, COMMIT_ERROR_CODES } = await freshImport("../api/_scheduledIngestionAdapter.js");

  await assert.rejects(
    () => commitCandidateToItemServerSide(UID, "no-such-candidate", {}, {}),
    (err) => err.code === COMMIT_ERROR_CODES.CANDIDATE_NOT_FOUND
  );
});

test("commitCandidateToItemServerSide refuses a rejected candidate (NOT_COMMITTABLE)", async (t) => {
  const { db, store } = createFakeAdminDb();
  setupMocks(t, { db });
  const { commitCandidateToItemServerSide, COMMIT_ERROR_CODES } = await freshImport("../api/_scheduledIngestionAdapter.js");

  const candidate = seedCandidate(store, { reviewStatus: "rejected" });
  await assert.rejects(
    () => commitCandidateToItemServerSide(UID, candidate.id, {}, {}),
    (err) => err.code === COMMIT_ERROR_CODES.NOT_COMMITTABLE
  );
});

// ============ No React/browser dependency ============
test("this entire test file, and every module it exercises, runs in plain Node with no DOM/React/localStorage present", () => {
  assert.strictEqual(typeof window, "undefined");
  assert.strictEqual(typeof document, "undefined");
  assert.strictEqual(typeof localStorage, "undefined");
});

test("finalizeCandidateServerSide's injected deps path works with zero real I/O (proves the seam, not just the default wiring)", async (t) => {
  setupMocks(t, { db: createFakeAdminDb().db });
  const { finalizeCandidateServerSide } = await freshImport("../api/_scheduledIngestionAdapter.js");

  const calls = { commit: 0, publish: 0 };
  const fakeItem = { id: "cand-injected-1", title: "Injected" };
  const candidate = { id: "cand-injected-1", reviewStatus: "pending", proposedType: "test", title: "Injected", date: "2026-10-01", targetType: "family", targetChildId: null, extractionConfidence: 0.9 };

  const result = await finalizeCandidateServerSide(UID, candidate, {
    commit: async (...args) => { calls.commit += 1; return fakeItem; },
    publish: async (...args) => { calls.publish += 1; },
  });

  assert.strictEqual(result.outcome, "auto_committed");
  assert.strictEqual(result.item, fakeItem);
  assert.strictEqual(calls.commit, 1);
  assert.strictEqual(calls.publish, 1);
});

console.log("scheduled-ingestion-adapter.unit.mjs: all tests defined (node:test reports results below)");
