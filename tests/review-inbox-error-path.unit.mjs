/**
 * Proves the Review Inbox slice's "a load failure must never look like an
 * empty inbox" requirement against the REAL (non-guest) Firestore
 * subscription path — the one branch that genuinely can fail (network,
 * permissions), unlike guest/localStorage mode, whose own read failures
 * are already swallowed silently by design (see
 * ingestionCandidatesRepository.js's readGuestCandidates try/catch) and so
 * cannot produce a distinguishable error state to test against. Same
 * module-mocking technique as tests/gmail-check-email-persistence.unit.mjs
 * — the only other file in this suite that needs to exercise this branch.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/review-inbox-error-path.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function setupFirestoreMock(t, { failOnSnapshot }) {
  t.mock.module("firebase/firestore", {
    namedExports: {
      collection: (_db, ...segments) => ({ __isCollection: true, path: segments.join("/") }),
      doc: (_db, ...segments) => ({ __isDoc: true, path: segments.join("/") }),
      addDoc: async () => ({ id: "unused" }),
      updateDoc: async () => {},
      getDoc: async () => ({ exists: () => false }),
      getDocs: async () => ({ docs: [] }),
      onSnapshot: (_colRef, onNext, onErr) => {
        if (failOnSnapshot) {
          onErr(new Error("simulated permission-denied"));
        } else {
          onNext({ docs: [] });
        }
        return () => {};
      },
      serverTimestamp: () => "SERVER_TIMESTAMP_SENTINEL",
    },
  });
  t.mock.module("../src/Firebase.js", { namedExports: { db: { __isFirestoreDb: true } } });
}

test("subscribeIngestionCandidates: a subscribe failure with no onError falls back to onChange([]) (unchanged pre-existing behavior)", async (t) => {
  setupFirestoreMock(t, { failOnSnapshot: true });
  const { subscribeIngestionCandidates } = await freshImport("../src/data/ingestionCandidatesRepository.js");

  let delivered = "not called";
  subscribeIngestionCandidates({ uid: "real-uid", isAdmin: false }, {}, (candidates) => { delivered = candidates; });

  assert.deepStrictEqual(delivered, [], "Existing callers (no onError arg) still just get an empty array on failure, exactly as before this slice");
});

test("subscribeIngestionCandidates: a subscribe failure WITH onError calls onError, not onChange", async (t) => {
  setupFirestoreMock(t, { failOnSnapshot: true });
  const { subscribeIngestionCandidates } = await freshImport("../src/data/ingestionCandidatesRepository.js");

  let onChangeCalled = false;
  let onErrorCalled = false;
  let errorArg = null;
  subscribeIngestionCandidates(
    { uid: "real-uid", isAdmin: false },
    {},
    () => { onChangeCalled = true; },
    (err) => { onErrorCalled = true; errorArg = err; }
  );

  assert.strictEqual(onChangeCalled, false, "onChange must NOT be called on failure when a caller has opted into onError");
  assert.strictEqual(onErrorCalled, true, "onError must be called");
  assert.ok(errorArg instanceof Error, "the underlying error is passed through, not swallowed");
});

test("subscribeIngestionCandidates: success path is unaffected by the presence of an onError argument", async (t) => {
  setupFirestoreMock(t, { failOnSnapshot: false });
  const { subscribeIngestionCandidates } = await freshImport("../src/data/ingestionCandidatesRepository.js");

  let delivered = null;
  let onErrorCalled = false;
  subscribeIngestionCandidates(
    { uid: "real-uid", isAdmin: false },
    {},
    (candidates) => { delivered = candidates; },
    () => { onErrorCalled = true; }
  );

  assert.deepStrictEqual(delivered, [], "A successful (empty) snapshot still delivers via onChange as normal");
  assert.strictEqual(onErrorCalled, false, "onError is never called on a successful subscription");
});

test("subscribePendingIngestionCandidates: a failure calls onError, distinguishable from a genuinely empty pending list", async (t) => {
  setupFirestoreMock(t, { failOnSnapshot: true });
  const { subscribePendingIngestionCandidates } = await freshImport("../src/data/ingestionCandidatesRepository.js");

  let onChangeCalled = false;
  let onErrorCalled = false;
  subscribePendingIngestionCandidates(
    { uid: "real-uid", isAdmin: false },
    () => { onChangeCalled = true; },
    () => { onErrorCalled = true; }
  );

  assert.strictEqual(onChangeCalled, false, "A load failure must never be reported through the same path as an empty list");
  assert.strictEqual(onErrorCalled, true);
});

test("subscribePendingIngestionCandidates: a genuinely empty (successful) collection calls onChange([]), never onError", async (t) => {
  setupFirestoreMock(t, { failOnSnapshot: false });
  const { subscribePendingIngestionCandidates } = await freshImport("../src/data/ingestionCandidatesRepository.js");

  let delivered = null;
  let onErrorCalled = false;
  subscribePendingIngestionCandidates(
    { uid: "real-uid", isAdmin: false },
    (list) => { delivered = list; },
    () => { onErrorCalled = true; }
  );

  assert.deepStrictEqual(delivered, []);
  assert.strictEqual(onErrorCalled, false, "A genuinely empty pending list is never mistaken for a load failure");
});
