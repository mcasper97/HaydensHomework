/**
 * Focused unit tests for the Review Inbox slice's additions to
 * src/data/ingestionCandidatesRepository.js: candidateCreatedAtMillis and
 * subscribePendingIngestionCandidates. Guest/local-demo path only (no
 * Firestore network call is ever attempted for this path — see
 * item-completions-repository.unit.mjs's header comment for the same
 * rationale on why this is safe to test directly, unlike most
 * src/data/*Repository.js files). The real (non-guest) Firestore error
 * path is covered separately in
 * tests/review-inbox-error-path.unit.mjs (module-mocked).
 *
 * Usage: node tests/review-inbox-repository.unit.mjs
 */
import {
  candidateCreatedAtMillis,
  subscribePendingIngestionCandidates,
  createIngestionCandidate,
  updateIngestionCandidate,
} from "../src/data/ingestionCandidatesRepository.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ candidateCreatedAtMillis ============
ok("A valid ISO string resolves to its real millis value", candidateCreatedAtMillis({ createdAt: "2020-01-01T00:00:00.000Z" }) === Date.parse("2020-01-01T00:00:00.000Z"));
ok("A malformed string resolves to +Infinity (never crashes, never sorts as oldest)", candidateCreatedAtMillis({ createdAt: "not a date" }) === Number.POSITIVE_INFINITY);
ok("A Firestore-Timestamp-shaped object (toMillis()) is used directly", candidateCreatedAtMillis({ createdAt: { toMillis: () => 12345 } }) === 12345);
ok("A {seconds, nanoseconds}-shaped object (raw Timestamp data) converts correctly", candidateCreatedAtMillis({ createdAt: { seconds: 10, nanoseconds: 500_000_000 } }) === 10_500);
ok("A {seconds}-only object (no nanoseconds) still works", candidateCreatedAtMillis({ createdAt: { seconds: 10 } }) === 10_000);
ok("Missing createdAt resolves to +Infinity (sorts as newest, not oldest)", candidateCreatedAtMillis({}) === Number.POSITIVE_INFINITY);
ok("null createdAt resolves to +Infinity", candidateCreatedAtMillis({ createdAt: null }) === Number.POSITIVE_INFINITY);
ok("A null candidate itself does not throw", candidateCreatedAtMillis(null) === Number.POSITIVE_INFINITY);
ok("An undefined candidate itself does not throw", candidateCreatedAtMillis(undefined) === Number.POSITIVE_INFINITY);

// ============ subscribePendingIngestionCandidates (guest path) ============
{
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const ctx = { uid: "guest-local", isAdmin: true };

  let delivered = null;
  let errorFired = false;
  const unsub = subscribePendingIngestionCandidates(
    ctx,
    (list) => { delivered = list; },
    () => { errorFired = true; }
  );
  ok("Initial delivery is an empty array before anything is created", Array.isArray(delivered) && delivered.length === 0);
  ok("onError is never invoked for a normal (non-failing) guest subscription", !errorFired);

  // Create one candidate of each lifecycle status, in a deliberately
  // scrambled order, to prove ONLY "pending" ever reaches the inbox.
  const pendingA = await createIngestionCandidate(ctx, { title: "Pending A", proposedType: "test", reviewStatus: "pending" });
  const approved = await createIngestionCandidate(ctx, { title: "Approved one", proposedType: "test", reviewStatus: "approved" });
  const pendingB = await createIngestionCandidate(ctx, { title: "Pending B", proposedType: "quiz", reviewStatus: "pending" });
  const rejected = await createIngestionCandidate(ctx, { title: "Rejected one", proposedType: "test", reviewStatus: "rejected" });
  const committed = await createIngestionCandidate(ctx, { title: "Committed one", proposedType: "test", reviewStatus: "committed" });
  const corroborated = await createIngestionCandidate(ctx, { title: "Corroborated one", proposedType: "reminder", reviewStatus: "corroborated" });
  const pendingC = await createIngestionCandidate(ctx, { title: "Pending C", proposedType: "project", reviewStatus: "pending" });

  ok("Exactly the 3 pending candidates are delivered, nothing else", delivered.length === 3);
  ok("Every delivered candidate has reviewStatus 'pending'", delivered.every((c) => c.reviewStatus === "pending"));
  ok("Approved candidate is excluded", !delivered.some((c) => c.id === approved.id));
  ok("Rejected candidate is excluded", !delivered.some((c) => c.id === rejected.id));
  ok("Committed candidate is excluded", !delivered.some((c) => c.id === committed.id));
  ok("Corroborated candidate is excluded", !delivered.some((c) => c.id === corroborated.id));
  ok("Each of the 3 pending candidates appears exactly once", [pendingA, pendingB, pendingC].every((p) => delivered.filter((c) => c.id === p.id).length === 1));

  // Force deterministic createdAt values (guest createIngestionCandidate
  // stamps real wall-clock time, too fast/unreliable to assert ordering
  // from directly) to prove oldest-first ordering precisely.
  await updateIngestionCandidate(ctx, pendingA.id, { createdAt: "2020-01-02T00:00:00.000Z" });
  await updateIngestionCandidate(ctx, pendingB.id, { createdAt: "2020-01-01T00:00:00.000Z" });
  await updateIngestionCandidate(ctx, pendingC.id, { createdAt: "2020-01-03T00:00:00.000Z" });

  ok(
    "Pending candidates are delivered oldest-first by createdAt (B, then A, then C)",
    delivered.length === 3 && delivered[0].id === pendingB.id && delivered[1].id === pendingA.id && delivered[2].id === pendingC.id
  );

  // Resolving one removes it from the live pending list without a second subscription/query.
  await updateIngestionCandidate(ctx, pendingA.id, { reviewStatus: "approved" });
  ok("Approving a previously-pending candidate removes it from the live delivered list", delivered.length === 2 && !delivered.some((c) => c.id === pendingA.id));
  ok("The remaining two stay in oldest-first order", delivered[0].id === pendingB.id && delivered[1].id === pendingC.id);

  await updateIngestionCandidate(ctx, pendingB.id, { reviewStatus: "rejected" });
  ok("Rejecting a previously-pending candidate removes it too", delivered.length === 1 && delivered[0].id === pendingC.id);

  unsub();
  delete global.localStorage;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
