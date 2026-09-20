/**
 * Focused unit tests for Slice 2 — Candidate-to-Item Idempotency + Recovery
 * — src/data/candidateCommitRepository.js's commitCandidateToItem, REAL
 * (non-guest) Firestore path only. Exercises the actual runTransaction
 * call against a small in-memory mock of firebase/firestore's transaction
 * API (tx.get/tx.set/tx.update against a path-keyed Map), since this is
 * the one branch guest/localStorage mode can never cover. Same
 * module-mocking technique as tests/gmail-check-email-persistence.unit.mjs
 * and tests/review-inbox-error-path.unit.mjs.
 *
 * Test data is seeded directly into the mock's `docs` Map (not via
 * createIngestionCandidate/updateIngestionCandidate) and assertions read
 * directly from that same Map — deliberately avoiding importing
 * ingestionCandidatesRepository.js/itemsRepository.js a second time for
 * setup/assertions, since commitCandidateToItem's REAL-path branch
 * (commitReal) never calls into those modules itself (only its GUEST-path
 * branch does — see candidateCommitRepository.js) — a second freshImport
 * of them here would risk binding to a different cached module instance
 * than the one candidateCommitRepository.js's own plain (non-query-string)
 * imports resolved, per the module-identity pitfall documented in
 * gmail-check-email-persistence.unit.mjs.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/candidate-commit-transaction.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function candPath(uid, id) {
  return `users/${uid}/ingestionCandidates/${id}`;
}
function itemPath(uid, id) {
  return `users/${uid}/items/${id}`;
}

function setupFirestoreMock(t, docs) {
  let seq = 0;
  t.mock.module("firebase/firestore", {
    namedExports: {
      collection: (_db, ...segments) => ({ __isCollection: true, path: segments.join("/") }),
      doc: (_db, ...segments) => ({ __isDoc: true, path: segments.join("/"), id: segments[segments.length - 1] }),
      addDoc: async (col, data) => {
        seq += 1;
        const id = `doc-${seq}`;
        docs.set(`${col.path}/${id}`, data);
        return { id };
      },
      updateDoc: async (ref, patch) => {
        docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...patch });
      },
      deleteDoc: async (ref) => { docs.delete(ref.path); },
      onSnapshot: (_col, onNext) => { onNext({ docs: [] }); return () => {}; },
      getDoc: async (ref) => {
        const data = docs.get(ref.path);
        return { exists: () => data !== undefined, data: () => data, id: ref.id };
      },
      getDocs: async () => ({ docs: [] }),
      serverTimestamp: () => "SERVER_TIMESTAMP_SENTINEL",
      runTransaction: async (_db, updateFn) => {
        const tx = {
          get: async (ref) => {
            const data = docs.get(ref.path);
            return { exists: () => data !== undefined, data: () => data, id: ref.id };
          },
          set: (ref, data) => { docs.set(ref.path, data); },
          update: (ref, patch) => {
            docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...patch });
          },
        };
        return updateFn(tx);
      },
    },
  });
  t.mock.module("../src/Firebase.js", { namedExports: { db: { __isFirestoreDb: true } } });
}

const UID = "real-uid";
const ctx = { uid: UID, isAdmin: false };

test("commitCandidateToItem (real): fresh pending candidate commits atomically, creating one Item at items/{candidateId}", async (t) => {
  const docs = new Map();
  setupFirestoreMock(t, docs);
  docs.set(candPath(UID, "cand-1"), { reviewStatus: "pending", sourceRecordId: "src-1", title: "Math HW" });
  const { commitCandidateToItem } = await freshImport("../src/data/candidateCommitRepository.js");

  const item = await commitCandidateToItem(ctx, "cand-1", { title: "Math HW", type: "homework" });

  assert.strictEqual(item.id, "cand-1", "the created Item's id equals the candidate's id");
  assert.strictEqual(item.sourceCandidateId, "cand-1");
  assert.ok(docs.get(itemPath(UID, "cand-1")), "an Item document now exists at items/{candidateId}");
  assert.strictEqual(docs.get(candPath(UID, "cand-1")).reviewStatus, "committed", "the candidate is finalized to committed");
});

test("commitCandidateToItem (real): retrying an already-committed candidate is idempotent and never overwrites the existing Item", async (t) => {
  const docs = new Map();
  setupFirestoreMock(t, docs);
  docs.set(candPath(UID, "cand-2"), { reviewStatus: "committed" });
  docs.set(itemPath(UID, "cand-2"), { title: "Original Title", sourceCandidateId: "cand-2" });
  const { commitCandidateToItem } = await freshImport("../src/data/candidateCommitRepository.js");

  const result = await commitCandidateToItem(ctx, "cand-2", { title: "A different retried title" });

  assert.strictEqual(result.title, "Original Title", "the existing Item is returned unchanged, never overwritten by the retry payload");
  assert.strictEqual(docs.get(itemPath(UID, "cand-2")).title, "Original Title");
});

test("commitCandidateToItem (real): committed candidate with a missing Item throws COMMITTED_ITEM_MISSING and writes nothing", async (t) => {
  const docs = new Map();
  setupFirestoreMock(t, docs);
  docs.set(candPath(UID, "cand-3"), { reviewStatus: "committed" });
  const { commitCandidateToItem, COMMIT_ERROR_CODES } = await freshImport("../src/data/candidateCommitRepository.js");

  await assert.rejects(
    () => commitCandidateToItem(ctx, "cand-3", { title: "Should not recreate anything" }),
    (err) => err.code === COMMIT_ERROR_CODES.COMMITTED_ITEM_MISSING
  );
  assert.strictEqual(docs.get(itemPath(UID, "cand-3")), undefined, "no Item was created as a side effect");
  assert.strictEqual(docs.get(candPath(UID, "cand-3")).reviewStatus, "committed", "the candidate's status is left untouched, not silently repaired");
});

test("commitCandidateToItem (real): legacy 'approved' candidate with an existing Item recovers without overwriting it", async (t) => {
  const docs = new Map();
  setupFirestoreMock(t, docs);
  docs.set(candPath(UID, "cand-4"), { reviewStatus: "approved" });
  docs.set(itemPath(UID, "cand-4"), { title: "Already created by a partial run", sourceCandidateId: "cand-4" });
  const { commitCandidateToItem } = await freshImport("../src/data/candidateCommitRepository.js");

  const result = await commitCandidateToItem(ctx, "cand-4", { title: "Resubmitted different title" });

  assert.strictEqual(result.title, "Already created by a partial run");
  assert.strictEqual(docs.get(candPath(UID, "cand-4")).reviewStatus, "committed", "the stranded candidate is finalized");
});

test("commitCandidateToItem (real): legacy 'approved' candidate with no Item yet creates exactly one", async (t) => {
  const docs = new Map();
  setupFirestoreMock(t, docs);
  docs.set(candPath(UID, "cand-5"), { reviewStatus: "approved", sourceRecordId: "src-5" });
  const { commitCandidateToItem } = await freshImport("../src/data/candidateCommitRepository.js");

  const item = await commitCandidateToItem(ctx, "cand-5", { title: "Field Trip Form" });

  assert.strictEqual(item.id, "cand-5");
  assert.ok(docs.get(itemPath(UID, "cand-5")));
  assert.strictEqual(docs.get(candPath(UID, "cand-5")).reviewStatus, "committed");
});

for (const status of ["rejected", "corroborated", "some-future-unknown-status"]) {
  test(`commitCandidateToItem (real): a candidate with reviewStatus "${status}" cannot commit`, async (t) => {
    const docs = new Map();
    setupFirestoreMock(t, docs);
    docs.set(candPath(UID, "cand-x"), { reviewStatus: status });
    const { commitCandidateToItem, COMMIT_ERROR_CODES } = await freshImport("../src/data/candidateCommitRepository.js");

    await assert.rejects(
      () => commitCandidateToItem(ctx, "cand-x", { title: "Should never be added" }),
      (err) => err.code === COMMIT_ERROR_CODES.NOT_COMMITTABLE
    );
    assert.strictEqual(docs.get(itemPath(UID, "cand-x")), undefined, "no Item was created");
    assert.strictEqual(docs.get(candPath(UID, "cand-x")).reviewStatus, status, "the candidate's status is unchanged");
  });
}

test("commitCandidateToItem (real): a nonexistent candidate id throws CANDIDATE_NOT_FOUND", async (t) => {
  const docs = new Map();
  setupFirestoreMock(t, docs);
  const { commitCandidateToItem, COMMIT_ERROR_CODES } = await freshImport("../src/data/candidateCommitRepository.js");

  await assert.rejects(
    () => commitCandidateToItem(ctx, "does-not-exist", { title: "x" }),
    (err) => err.code === COMMIT_ERROR_CODES.CANDIDATE_NOT_FOUND
  );
});

test("commitCandidateToItem (real): two unrelated pending candidates commit to two independent Items", async (t) => {
  const docs = new Map();
  setupFirestoreMock(t, docs);
  docs.set(candPath(UID, "cand-a"), { reviewStatus: "pending" });
  docs.set(candPath(UID, "cand-b"), { reviewStatus: "pending" });
  const { commitCandidateToItem } = await freshImport("../src/data/candidateCommitRepository.js");

  const itemA = await commitCandidateToItem(ctx, "cand-a", { title: "A" });
  const itemB = await commitCandidateToItem(ctx, "cand-b", { title: "B" });

  assert.notStrictEqual(itemA.id, itemB.id);
  assert.strictEqual(docs.get(candPath(UID, "cand-a")).reviewStatus, "committed");
  assert.strictEqual(docs.get(candPath(UID, "cand-b")).reviewStatus, "committed");
});
