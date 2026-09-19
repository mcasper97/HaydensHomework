/**
 * Focused unit tests for approved Gmail sender management + the Check
 * Email shell (#26, Commit 4):
 *   - src/data/gmailApprovedSenders.js — pure validation/normalization,
 *     zero imports, safe to test directly in Node (mirrors itemTypes.js).
 *   - api/_gmailApprovedSendersStore.js — server-side read, tested against
 *     a small in-memory fake Firestore `db`, no live project needed.
 *   - api/gmail-check-email.js — the pure LOOKBACK_DAYS/computeLookbackSinceIso
 *     helpers. The handler itself isn't independently tested here for the
 *     same reason established in tests/gmail-oauth.unit.mjs: it needs a
 *     live, configured Firebase Admin SDK to exercise meaningfully.
 *
 * The client Firestore repository (gmailApprovedSendersRepository.js) is
 * NOT imported/tested here, consistent with existing precedent — no
 * src/data/*Repository.js file that imports firebase/firestore is unit
 * tested directly in this project (see itemsRepository.js,
 * sourceRecordsRepository.js, ingestionCandidatesRepository.js).
 *
 * Usage: node tests/gmail-approved-senders.unit.mjs
 */
import { normalizeSenderEmail, isValidSenderEmail } from "../src/data/gmailApprovedSenders.js";
import { listApprovedSenderEmails, listApprovedSenders } from "../api/_gmailApprovedSendersStore.js";
import { LOOKBACK_DAYS, computeLookbackSinceIso } from "../api/gmail-check-email.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ normalizeSenderEmail ============
ok("Trims whitespace", normalizeSenderEmail("  teacher@school.edu  ") === "teacher@school.edu");
ok("Lowercases the address", normalizeSenderEmail("Teacher@School.EDU") === "teacher@school.edu");
ok("Non-string input normalizes to an empty string, without throwing", normalizeSenderEmail(undefined) === "");
ok("null input normalizes to an empty string, without throwing", normalizeSenderEmail(null) === "");

// ============ isValidSenderEmail ============
ok("Accepts an ordinary address", isValidSenderEmail("teacher@school.edu"));
ok("Accepts an address with a subdomain", isValidSenderEmail("office@mail.school.edu"));
ok("Rejects an address with no @", !isValidSenderEmail("not-an-email"));
ok("Rejects an address with no domain", !isValidSenderEmail("teacher@"));
ok("Rejects an address with no local part", !isValidSenderEmail("@school.edu"));
ok("Rejects an address with a space", !isValidSenderEmail("teacher @school.edu"));
ok("Rejects an address with no TLD", !isValidSenderEmail("teacher@school"));
ok("Rejects empty string", !isValidSenderEmail(""));
ok("Rejects non-string input, without throwing", !isValidSenderEmail(undefined));
ok("Rejects a bare domain-wildcard style entry (exact addresses only)", !isValidSenderEmail("@school.edu"));

// ============ _gmailApprovedSendersStore.js: fake Firestore db ============
function createFakeDb() {
  const store = new Map(); // key: `${path}` -> array of { id, data }
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
      async _add(id, data) {
        const docs = store.get(key) || [];
        docs.push({ id, data });
        store.set(key, docs);
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
  ok("No approved senders returns an empty array", (await listApprovedSenderEmails("uid-1", { db })).length === 0);
}
{
  const db = createFakeDb();
  await db.collection("users").doc("uid-2").collection("gmailApprovedSenders").doc("s1").set({ email: "a@school.edu" });
  await db.collection("users").doc("uid-2").collection("gmailApprovedSenders").doc("s2").set({ email: "b@school.edu" });
  const emails = await listApprovedSenderEmails("uid-2", { db });
  ok("Returns every stored approved sender's email", emails.length === 2 && emails.includes("a@school.edu") && emails.includes("b@school.edu"));
}
{
  const db = createFakeDb();
  await db.collection("users").doc("uid-3").collection("gmailApprovedSenders").doc("s1").set({ email: "a@school.edu" });
  await db.collection("users").doc("uid-3").collection("gmailApprovedSenders").doc("s2").set({ notEmail: "malformed" });
  const emails = await listApprovedSenderEmails("uid-3", { db });
  ok("Filters out a malformed doc missing an email field, rather than throwing", emails.length === 1 && emails[0] === "a@school.edu");
}
{
  const db = createFakeDb();
  await db.collection("users").doc("uid-4").collection("gmailApprovedSenders").doc("s1").set({});
  const emails = await listApprovedSenderEmails("uid-4", { db });
  ok("Filters out a doc with no email field at all", emails.length === 0);
}

// ============ listApprovedSenders (#26, Commit 5 — full records, target-normalized) ============
{
  const db = createFakeDb();
  await db.collection("users").doc("uid-5").collection("gmailApprovedSenders").doc("s1").set({ email: "teacherA@school.org", targetType: "child", childId: "hayden-1" });
  await db.collection("users").doc("uid-5").collection("gmailApprovedSenders").doc("s2").set({ email: "principal@school.org", targetType: "family", childId: null });
  await db.collection("users").doc("uid-5").collection("gmailApprovedSenders").doc("s3").set({ email: "noreply@school.org" }); // legacy — no targetType at all
  const senders = await listApprovedSenders("uid-5", { db });
  ok("Returns every approved sender's full record", senders.length === 3);
  const a = senders.find((s) => s.email === "teacherA@school.org");
  ok("A child-targeted sender keeps its targetType and childId", a?.targetType === "child" && a?.childId === "hayden-1");
  const p = senders.find((s) => s.email === "principal@school.org");
  ok("A family-targeted sender keeps its targetType with a null childId", p?.targetType === "family" && p?.childId === null);
  const legacy = senders.find((s) => s.email === "noreply@school.org");
  ok("A legacy sender (no targetType field at all) normalizes to review/null, same as the client repository's own read-time normalization", legacy?.targetType === "review" && legacy?.childId === null);
}
{
  const db = createFakeDb();
  await db.collection("users").doc("uid-6").collection("gmailApprovedSenders").doc("s1").set({ notEmail: "malformed" });
  const senders = await listApprovedSenders("uid-6", { db });
  ok("listApprovedSenders also filters out a malformed doc missing an email field", senders.length === 0);
}
{
  const db = createFakeDb();
  const senders = await listApprovedSenders("uid-7", { db });
  ok("listApprovedSenders returns an empty array when nothing is stored", senders.length === 0);
}

// ============ gmail-check-email.js: lookback window ============
ok("LOOKBACK_DAYS is 14, matching the approved product decision", LOOKBACK_DAYS === 14);
{
  const now = new Date("2026-03-15T12:00:00.000Z").getTime();
  const since = computeLookbackSinceIso(14, now);
  ok("computeLookbackSinceIso subtracts exactly the given number of days", since === "2026-03-01T12:00:00.000Z");
}
{
  const now = Date.now();
  const since = new Date(computeLookbackSinceIso()).getTime();
  ok("Default lookback is in the past relative to now", since < now);
  ok("Default lookback is approximately 14 days back (within a small tolerance)", Math.abs(now - since - 14 * 24 * 60 * 60 * 1000) < 5000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
