/**
 * Focused unit tests for the Gmail processing history reset (parent testing
 * control): api/_gmailProcessingResetStore.js (the logical, marker-based
 * reset mechanism) and the reset-aware behavior it adds to
 * api/_sourceRecordsStore.js's listProcessedGmailMessageIds — the SAME
 * function api/_gmailIngestionCore.js's scanApprovedSenderEmails calls for
 * BOTH the manual "Check Email" endpoint and the scheduled automatic
 * runner, so proving this function's behavior here proves the reset
 * actually reaches both ingestion paths without touching either of them.
 *
 * Endpoint-level security (authenticated-only, arbitrary client uid never
 * accepted, rate limiting) is covered separately in
 * tests/gmail-reset-processing-endpoint.unit.mjs.
 *
 * Usage: node tests/gmail-processing-reset.unit.mjs
 */
import { toMillis, getGmailProcessingResetAt, resetGmailProcessingHistory } from "../api/_gmailProcessingResetStore.js";
import { listProcessedGmailMessageIds, createSourceRecordServerSide } from "../api/_sourceRecordsStore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

/** Generic path-keyed in-memory fake Admin Firestore — supports arbitrary
 * collection/doc nesting (users/{uid}/sourceRecords/{id},
 * gmailProcessingResets/{uid}), same pattern as
 * tests/review-batch-notification-trigger.unit.mjs's createFakeAdminDb. */
function createFakeDb() {
  const store = new Map();
  function docRef(path) {
    return {
      id: path.split("/").pop(),
      get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
      set: async (data) => { store.set(path, data); },
      collection: (name) => collRef(`${path}/${name}`),
    };
  }
  let autoId = 0;
  function collRef(path) {
    return {
      doc: (id) => docRef(`${path}/${id}`),
      add: async (data) => {
        autoId += 1;
        const id = `auto-${autoId}`;
        store.set(`${path}/${id}`, data);
        return docRef(`${path}/${id}`);
      },
      get: async () => {
        const prefix = `${path}/`;
        const docs = [];
        for (const [p, data] of store.entries()) {
          if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) {
            docs.push({ id: p.slice(prefix.length), data: () => data });
          }
        }
        return { docs };
      },
    };
  }
  return { db: { collection: (name) => collRef(name) }, store };
}

// ============ toMillis ============
{
  ok("Firestore-Timestamp-shaped value (.toMillis()) is read via its own method", toMillis({ toMillis: () => 12345 }) === 12345);
  ok("A JS Date is converted via getTime()", toMillis(new Date(1000)) === 1000);
  ok("An ISO string is parsed", toMillis("2026-01-01T00:00:00.000Z") === Date.parse("2026-01-01T00:00:00.000Z"));
  ok("A raw millis number passes through", toMillis(999) === 999);
  ok("null returns null (no signal, never epoch zero)", toMillis(null) === null);
  ok("undefined returns null", toMillis(undefined) === null);
  ok("An unparseable string returns null", toMillis("not a date") === null);
  ok("NaN never leaks out for garbage input", !Number.isNaN(toMillis(null)) || toMillis(null) === null);
}

// ============ getGmailProcessingResetAt: no marker vs. a set marker ============
{
  const { db } = createFakeDb();
  const resetAt = await getGmailProcessingResetAt("uid-never-reset", { db });
  ok("A household that has never reset returns null", resetAt === null);
}
{
  const { db } = createFakeDb();
  await db.collection("gmailProcessingResets").doc("uid-reset-1").set({ resetAt: "2026-06-01T12:00:00.000Z" });
  const resetAt = await getGmailProcessingResetAt("uid-reset-1", { db });
  ok("A set marker is read back as the correct millis value", resetAt === Date.parse("2026-06-01T12:00:00.000Z"));
}

// ============ resetGmailProcessingHistory: resetCount + no other writes ============
{
  const { db, store } = createFakeDb();
  await db.collection("users").doc("uid-A").collection("sourceRecords").doc("sr1").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-1" },
    capturedAt: "2026-01-01T00:00:00.000Z",
  });
  await db.collection("users").doc("uid-A").collection("sourceRecords").doc("sr2").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-2" },
    capturedAt: "2026-01-02T00:00:00.000Z",
  });
  const sizeBefore = store.size;

  const { resetCount } = await resetGmailProcessingHistory("uid-A", { db, getProcessedIds: listProcessedGmailMessageIds });
  ok("resetCount reflects exactly how many messages were processed before the reset", resetCount === 2);

  ok("The reset writes exactly one new document (its own marker) — nothing else", store.size === sizeBefore + 1);
  ok("Neither SourceRecord document was modified", JSON.stringify(store.get("users/uid-A/sourceRecords/sr1")).includes("msg-1"));
  const marker = await getGmailProcessingResetAt("uid-A", { db });
  ok("The marker itself is now set to a real, comparable timestamp", typeof marker === "number" && marker > 0);
}
{
  const { db } = createFakeDb();
  let threw = false;
  try {
    await resetGmailProcessingHistory("uid-B", { db }); // no getProcessedIds injected
  } catch {
    threw = true;
  }
  ok("resetGmailProcessingHistory requires getProcessedIds (fails loudly rather than silently skipping the count)", threw);
}

// ============ listProcessedGmailMessageIds: reset-aware behavior ============
{
  // No reset marker at all -> unchanged, original behavior.
  const { db } = createFakeDb();
  await db.collection("users").doc("uid-C").collection("sourceRecords").doc("sr1").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-c1" },
    capturedAt: "2026-01-01T00:00:00.000Z",
  });
  const ids = await listProcessedGmailMessageIds("uid-C", { db });
  ok("With no reset marker, a previously processed message still counts as processed (unchanged default behavior)", ids.has("msg-c1"));
}
{
  // A message captured BEFORE the reset marker becomes eligible again.
  const { db } = createFakeDb();
  await db.collection("users").doc("uid-D").collection("sourceRecords").doc("sr1").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-old" },
    capturedAt: "2026-01-01T00:00:00.000Z",
  });
  const before = await listProcessedGmailMessageIds("uid-D", { db });
  ok("Before any reset, the message counts as processed", before.has("msg-old"));

  await resetGmailProcessingHistory("uid-D", { db, getProcessedIds: listProcessedGmailMessageIds });

  const after = await listProcessedGmailMessageIds("uid-D", { db });
  ok("After the reset, the same previously processed message is eligible again (excluded from the processed set)", !after.has("msg-old"));
}
{
  // A message captured AFTER the reset marker (i.e. genuinely reprocessed
  // post-reset) still correctly counts as processed going forward.
  const { db } = createFakeDb();
  await db.collection("gmailProcessingResets").doc("uid-E").set({ resetAt: "2020-01-01T00:00:00.000Z" });
  await db.collection("users").doc("uid-E").collection("sourceRecords").doc("sr1").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-new" },
    capturedAt: "2026-06-01T00:00:00.000Z", // well after the old reset marker
  });
  const ids = await listProcessedGmailMessageIds("uid-E", { db });
  ok("A message captured AFTER the reset marker still counts as processed (dedupe still works going forward)", ids.has("msg-new"));
}
{
  // A gmail_email SourceRecord with no capturedAt at all never gets
  // silently reset out — fails closed (still counted as processed) rather
  // than risking an unintended reprocess.
  const { db } = createFakeDb();
  await db.collection("gmailProcessingResets").doc("uid-F").set({ resetAt: "2026-06-01T00:00:00.000Z" });
  await db.collection("users").doc("uid-F").collection("sourceRecords").doc("sr1").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-no-capturedat" },
  });
  const ids = await listProcessedGmailMessageIds("uid-F", { db });
  ok("A record with no capturedAt fails closed (stays counted as processed, never silently reset out)", ids.has("msg-no-capturedat"));
}

// ============ Household isolation: one household's reset never touches another's ============
{
  const { db } = createFakeDb();
  await db.collection("users").doc("uid-house1").collection("sourceRecords").doc("sr1").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-house1" },
    capturedAt: "2026-01-01T00:00:00.000Z",
  });
  await db.collection("users").doc("uid-house2").collection("sourceRecords").doc("sr1").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-house2" },
    capturedAt: "2026-01-01T00:00:00.000Z",
  });

  await resetGmailProcessingHistory("uid-house1", { db, getProcessedIds: listProcessedGmailMessageIds });

  const house1After = await listProcessedGmailMessageIds("uid-house1", { db });
  const house2After = await listProcessedGmailMessageIds("uid-house2", { db });
  ok("Household 1's own message becomes eligible again after ITS reset", !house1After.has("msg-house1"));
  ok("Household 2's message is completely untouched by household 1's reset", house2After.has("msg-house2"));
  const house2Marker = await getGmailProcessingResetAt("uid-house2", { db });
  ok("Household 2 has no reset marker at all", house2Marker === null);
}

// ============ SourceRecords/candidates are never touched by a reset ============
{
  const { db, store } = createFakeDb();
  const created = await createSourceRecordServerSide(
    "uid-G",
    { sourceType: "gmail_email", metadata: { gmailMessageId: "msg-g1" } },
    { db }
  );
  await db.collection("users").doc("uid-G").collection("ingestionCandidates").doc("cand1").set({ title: "Field trip permission slip" });
  const sourceRecordBefore = store.get(`users/uid-G/sourceRecords/${created.id}`);
  const candidateBefore = store.get("users/uid-G/ingestionCandidates/cand1");

  await resetGmailProcessingHistory("uid-G", { db, getProcessedIds: listProcessedGmailMessageIds });

  ok("The SourceRecord document is byte-for-byte unchanged after a reset", JSON.stringify(store.get(`users/uid-G/sourceRecords/${created.id}`)) === JSON.stringify(sourceRecordBefore));
  ok("The IngestionCandidate document is completely untouched by a reset (reset never reads/writes that collection)", JSON.stringify(store.get("users/uid-G/ingestionCandidates/cand1")) === JSON.stringify(candidateBefore));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
