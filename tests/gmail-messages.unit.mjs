/**
 * Focused unit tests for api/_gmailMessages.js (Gmail message list/get,
 * fetch injected) and api/_sourceRecordsStore.js (Admin Firestore read for
 * dedupe, db injected) — #26, Commit 5.
 *
 * Usage: node tests/gmail-messages.unit.mjs
 */
import { buildGmailSearchQuery, listGmailMessageIds, getGmailMessage } from "../api/_gmailMessages.js";
import { listProcessedGmailMessageIds } from "../api/_sourceRecordsStore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ buildGmailSearchQuery ============
{
  const since = new Date("2026-03-01T00:00:00.000Z");
  const query = buildGmailSearchQuery(["a@school.edu", "b@school.edu"], since);
  ok("Includes an after: clause in YYYY/MM/DD format (Gmail's documented format)", query.includes("after:2026/03/01"));
  ok("Includes every sender as a from: clause", query.includes("from:a@school.edu") && query.includes("from:b@school.edu"));
  ok("Joins multiple senders with OR", query.includes("from:a@school.edu OR from:b@school.edu"));
}
{
  const query = buildGmailSearchQuery(["only@school.edu"], new Date("2026-01-05T00:00:00.000Z"));
  ok("Pads single-digit month/day with a leading zero", query.includes("after:2026/01/05"));
}
ok("Returns null when given no senders (nothing to search for)", buildGmailSearchQuery([], new Date()) === null);
ok("Returns null for non-array senders input, without throwing", buildGmailSearchQuery(null, new Date()) === null);

// ============ listGmailMessageIds ============
{
  let capturedUrl = null, capturedHeaders = null;
  const fetchFn = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return { ok: true, json: async () => ({ messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t1" }] }) };
  };
  const result = await listGmailMessageIds({ accessToken: "at-123", query: "from:a@school.edu", fetchFn });
  ok("Calls the Gmail messages.list endpoint", capturedUrl.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages"));
  ok("Includes the query as a q= param", new URL(capturedUrl).searchParams.get("q") === "from:a@school.edu");
  ok("Authenticates with the given access token", capturedHeaders.Authorization === "Bearer at-123");
  ok("Returns the list of {id, threadId} entries", result.length === 2 && result[0].id === "m1");
}
{
  const fetchFn = async () => ({ ok: true, json: async () => ({}) }); // no `messages` key — an empty result page
  const result = await listGmailMessageIds({ accessToken: "at", query: "q", fetchFn });
  ok("Returns an empty array when the response has no messages key (nothing matched)", Array.isArray(result) && result.length === 0);
}
{
  const fetchFn = async () => ({ ok: false, json: async () => ({ error: { message: "invalid credentials" } }) });
  let threw = false;
  try {
    await listGmailMessageIds({ accessToken: "bad", query: "q", fetchFn });
  } catch (err) {
    threw = true;
    ok("Throws with Gmail's own error message on failure", err.message === "invalid credentials");
  }
  ok("listGmailMessageIds throws on a non-ok response rather than silently returning []", threw);
}

// ============ getGmailMessage ============
{
  let capturedUrl = null;
  const fetchFn = async (url) => {
    capturedUrl = url;
    return { ok: true, json: async () => ({ id: "m1", payload: {} }) };
  };
  const result = await getGmailMessage({ accessToken: "at", messageId: "m1", fetchFn });
  ok("Calls the specific message's get endpoint", capturedUrl.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1"));
  ok("Requests format=full (needed to get the body/headers)", new URL(capturedUrl).searchParams.get("format") === "full");
  ok("Returns the raw message JSON", result.id === "m1");
}
{
  const fetchFn = async () => ({ ok: false, json: async () => ({ error: { message: "not found" } }) });
  let threw = false;
  try {
    await getGmailMessage({ accessToken: "at", messageId: "missing", fetchFn });
  } catch {
    threw = true;
  }
  ok("getGmailMessage throws on a non-ok response", threw);
}

// ============ listProcessedGmailMessageIds (dedupe) ============
function createFakeDb() {
  const store = new Map();
  return {
    collection(name) {
      return makeCollectionRef([name]);
    },
  };
  function makeCollectionRef(pathParts) {
    const key = pathParts.join("/");
    return {
      doc(id) {
        return makeDocRef([...pathParts, id]);
      },
      async get() {
        const docs = store.get(key) || [];
        return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
      },
    };
  }
  function makeDocRef(pathParts) {
    const collectionKey = pathParts.slice(0, -1).join("/");
    const id = pathParts[pathParts.length - 1];
    return {
      collection(name) {
        return makeCollectionRef([...pathParts, name]);
      },
      async set(data) {
        const docs = store.get(collectionKey) || [];
        const idx = docs.findIndex((d) => d.id === id);
        if (idx >= 0) docs[idx] = { id, data };
        else docs.push({ id, data });
        store.set(collectionKey, docs);
      },
    };
  }
}

{
  const db = createFakeDb();
  const ids = await listProcessedGmailMessageIds("uid-1", { db });
  ok("Returns an empty Set when no SourceRecords exist yet", ids instanceof Set && ids.size === 0);
}
{
  const db = createFakeDb();
  await db.collection("users").doc("uid-2").collection("sourceRecords").doc("sr1").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-abc" },
  });
  await db.collection("users").doc("uid-2").collection("sourceRecords").doc("sr2").set({
    sourceType: "gmail_email",
    metadata: { gmailMessageId: "msg-def" },
  });
  const ids = await listProcessedGmailMessageIds("uid-2", { db });
  ok("Collects gmailMessageId from every gmail_email SourceRecord", ids.has("msg-abc") && ids.has("msg-def") && ids.size === 2);
}
{
  const db = createFakeDb();
  // A non-gmail SourceRecord (photo capture) must never be mistaken for a
  // processed Gmail message, even if it happened to carry similar-looking
  // metadata.
  await db.collection("users").doc("uid-3").collection("sourceRecords").doc("sr1").set({
    sourceType: "image_capture",
    metadata: { gmailMessageId: "should-not-count" },
  });
  const ids = await listProcessedGmailMessageIds("uid-3", { db });
  ok("Ignores SourceRecords whose sourceType isn't gmail_email, even with matching-shaped metadata", ids.size === 0);
}
{
  const db = createFakeDb();
  await db.collection("users").doc("uid-4").collection("sourceRecords").doc("sr1").set({ sourceType: "gmail_email" }); // no metadata at all
  const ids = await listProcessedGmailMessageIds("uid-4", { db });
  ok("A gmail_email SourceRecord with no metadata.gmailMessageId doesn't throw and contributes nothing", ids.size === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
