/**
 * Focused unit tests for Slice 2 — Candidate-to-Item Idempotency + Recovery
 * — src/data/candidateCommitRepository.js's commitCandidateToItem, guest/
 * local-demo path only (no Firestore network call is ever attempted for
 * this path — see item-completions-repository.unit.mjs's header comment
 * for the same rationale on why this is safe to test directly). The real
 * (non-guest) Firestore transaction path is covered separately in
 * tests/candidate-commit-transaction.unit.mjs (module-mocked, since it
 * needs to exercise runTransaction).
 *
 * Usage: node tests/candidate-commit-repository.unit.mjs
 */
import { commitCandidateToItem, COMMIT_ERROR_CODES } from "../src/data/candidateCommitRepository.js";
import {
  createIngestionCandidate,
  getIngestionCandidate,
} from "../src/data/ingestionCandidatesRepository.js";
import { getItem, readGuestItems } from "../src/data/itemsRepository.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}
async function throws(name, fn, expectedCode) {
  try {
    await fn();
    fail++; console.log(`FAIL: ${name} (did not throw)`);
  } catch (err) {
    if (err?.code === expectedCode) { pass++; console.log(`PASS: ${name}`); }
    else { fail++; console.log(`FAIL: ${name} (threw code ${err?.code}, expected ${expectedCode})`); }
  }
}

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const ctx = { uid: "guest-local", isAdmin: true };

// ============ Fresh approval (pending -> committed) ============
{
  const candidate = await createIngestionCandidate(ctx, {
    title: "Math Worksheet",
    proposedType: "homework",
    reviewStatus: "pending",
    sourceRecordId: "source-1",
  });

  const item = await commitCandidateToItem(ctx, candidate.id, { title: "Math Worksheet", type: "homework" });

  ok("Returned item's id equals the candidate's id (deterministic id)", item.id === candidate.id);
  ok("Returned item carries sourceCandidateId pointing back at the candidate", item.sourceCandidateId === candidate.id);
  ok("Returned item falls back to the candidate's sourceRecordId when the payload has none", item.sourceRecordId === "source-1");

  const stored = await getItem(ctx, candidate.id);
  ok("Exactly one Item exists at items/{candidateId}", !!stored && stored.id === candidate.id);
  ok("readGuestItems has exactly one item for this candidate", readGuestItems().filter((it) => it.id === candidate.id).length === 1);

  const reloaded = await getIngestionCandidate(ctx, candidate.id);
  ok("Candidate's reviewStatus is now 'committed'", reloaded.reviewStatus === "committed");

  // ---- Retry with the SAME (now committed) candidate — idempotent, no duplicate ----
  const retryItem = await commitCandidateToItem(ctx, candidate.id, { title: "Math Worksheet (edited retry payload)", type: "homework" });
  ok("Retrying an already-committed candidate returns the EXISTING item unchanged", retryItem.id === candidate.id && retryItem.title === "Math Worksheet");
  ok("The retry's different payload never overwrote the stored item's title", (await getItem(ctx, candidate.id)).title === "Math Worksheet");
  ok("Still exactly one item for this candidate after the retry", readGuestItems().filter((it) => it.id === candidate.id).length === 1);
}

// ============ Legacy "approved" recovery — Item already exists ============
{
  const candidate = await createIngestionCandidate(ctx, {
    title: "Science Project",
    proposedType: "project",
    reviewStatus: "approved", // simulates a pre-Slice-2 partial failure that left the candidate here
  });

  // Simulate the Item having already been created by a prior (pre-Slice-2) partial run.
  const items = readGuestItems();
  items.push({ id: candidate.id, title: "Science Project (already created)", type: "project", sourceCandidateId: candidate.id });
  const { writeGuestItems } = await import("../src/data/itemsRepository.js");
  writeGuestItems(items);

  const result = await commitCandidateToItem(ctx, candidate.id, { title: "Science Project (different resubmitted title)", type: "project" });
  ok("Recovery commit returns the EXISTING item, not a new one built from the resubmitted payload", result.title === "Science Project (already created)");
  ok("The existing item's title was never overwritten", (await getItem(ctx, candidate.id)).title === "Science Project (already created)");
  ok("Exactly one item exists for this candidate (no duplicate created)", readGuestItems().filter((it) => it.id === candidate.id).length === 1);

  const reloaded = await getIngestionCandidate(ctx, candidate.id);
  ok("The stranded candidate is finalized to 'committed'", reloaded.reviewStatus === "committed");
}

// ============ Legacy "approved" recovery — Item does NOT exist (true partial failure) ============
{
  const candidate = await createIngestionCandidate(ctx, {
    title: "Field Trip Form",
    proposedType: "form",
    reviewStatus: "approved",
  });

  const item = await commitCandidateToItem(ctx, candidate.id, { title: "Field Trip Form", type: "form" });
  ok("Recovery commit creates exactly one Item when none existed yet", item.id === candidate.id);
  ok("Created item carries sourceCandidateId", item.sourceCandidateId === candidate.id);

  const reloaded = await getIngestionCandidate(ctx, candidate.id);
  ok("Candidate is finalized to 'committed'", reloaded.reviewStatus === "committed");

  // Retrying again must not duplicate.
  await commitCandidateToItem(ctx, candidate.id, { title: "Field Trip Form" });
  ok("A further retry after recovery still yields exactly one item", readGuestItems().filter((it) => it.id === candidate.id).length === 1);
}

// ============ committed + missing Item is a hard integrity error ============
{
  const candidate = await createIngestionCandidate(ctx, {
    title: "Orphaned Committed Candidate",
    proposedType: "test",
    reviewStatus: "committed", // no matching item was ever created for this id
  });

  await throws(
    "committed candidate with no matching Item throws COMMITTED_ITEM_MISSING",
    () => commitCandidateToItem(ctx, candidate.id, { title: "Orphaned" }),
    COMMIT_ERROR_CODES.COMMITTED_ITEM_MISSING
  );

  ok("No item was created as a side effect of the failed recovery attempt", (await getItem(ctx, candidate.id)) === null);
  const reloaded = await getIngestionCandidate(ctx, candidate.id);
  ok("The candidate's reviewStatus is untouched (still 'committed', not silently repaired)", reloaded.reviewStatus === "committed");
}

// ============ Non-committable statuses fail closed (explicit allowlist) ============
for (const status of ["rejected", "corroborated", "some-future-unknown-status"]) {
  const candidate = await createIngestionCandidate(ctx, {
    title: `Candidate at ${status}`,
    proposedType: "test",
    reviewStatus: status,
  });

  await throws(
    `A candidate with reviewStatus "${status}" cannot commit (NOT_COMMITTABLE)`,
    () => commitCandidateToItem(ctx, candidate.id, { title: "Should never be added" }),
    COMMIT_ERROR_CODES.NOT_COMMITTABLE
  );

  ok(`No item was created for the "${status}" candidate`, (await getItem(ctx, candidate.id)) === null);
  const reloaded = await getIngestionCandidate(ctx, candidate.id);
  ok(`The "${status}" candidate's reviewStatus is unchanged`, reloaded.reviewStatus === status);
}

// ============ A missing candidate id throws CANDIDATE_NOT_FOUND ============
await throws(
  "Committing a nonexistent candidate id throws CANDIDATE_NOT_FOUND",
  () => commitCandidateToItem(ctx, "does-not-exist", { title: "x" }),
  COMMIT_ERROR_CODES.CANDIDATE_NOT_FOUND
);

// ============ Unrelated candidates produce independent items ============
{
  const a = await createIngestionCandidate(ctx, { title: "Candidate A", proposedType: "test", reviewStatus: "pending" });
  const b = await createIngestionCandidate(ctx, { title: "Candidate B", proposedType: "test", reviewStatus: "pending" });

  const itemA = await commitCandidateToItem(ctx, a.id, { title: "Candidate A" });
  const itemB = await commitCandidateToItem(ctx, b.id, { title: "Candidate B" });

  ok("Two different candidates produce two different item ids", itemA.id !== itemB.id);
  ok("Each item's id matches its own candidate's id", itemA.id === a.id && itemB.id === b.id);
  ok("Committing A never affected B's candidate status", (await getIngestionCandidate(ctx, b.id)).reviewStatus === "committed");
}

delete global.localStorage;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
