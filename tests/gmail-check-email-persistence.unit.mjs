/**
 * Regression coverage for a live-validation persistence defect report
 * (#26, Commit 5): "review candidates appear in the review UI, but no
 * users/{uid}/sourceRecords or users/{uid}/ingestionCandidates documents
 * exist in Firestore." A full investigation (ctx/uid tracing, Firestore
 * rules review, and an empirical replay of src/AuthShell.jsx's
 * handleCheckEmail write sequence below, against a mock that rejects
 * `undefined` field values exactly as real Firestore does) found the
 * client write path itself correct for every realistic shape (child /
 * family / review targets, a failed webpage fetch, an extraction
 * failure) — no code path was found where a candidate could reach the
 * review UI (src/AuthShell.jsx's `newCandidates`) without its
 * createSourceRecord()/createIngestionCandidate() call having already
 * resolved successfully via the real (non-guest) Firestore branch. The
 * one confirmed gap: a write failure was only console.error'd, never
 * shown to the parent (see AuthShell.jsx's `hadPersistenceError`/setError
 * addition) — fixed alongside this test file, so any FUTURE occurrence
 * is immediately visible in the UI instead of silently invisible.
 *
 * This file proves, going forward, that an authenticated ctx
 * (isAdmin: false) always takes the real users/{uid}/... Firestore path
 * and never falls back to localStorage — the exact thing live validation
 * couldn't rule out just by reading source. It mirrors (deliberately, not
 * imports — see the note above `processEmailResult` below)
 * src/AuthShell.jsx's handleCheckEmail write sequence exactly, against a
 * mock firebase/firestore that mimics the real SDK's behavior closely
 * enough to catch the most common real-world persistence footgun (an
 * `undefined` field anywhere in a written document throws, exactly as
 * addDoc()/setDoc() do in production).
 *
 * REQUIRES Node's experimental module-mocking support (t.mock.module),
 * unlike every other *.unit.mjs file in this suite. Run with:
 *   node --experimental-test-module-mocks tests/gmail-check-email-persistence.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

// Mimics Firestore's real, well-documented behavior: addDoc()/setDoc()
// reject a document containing an `undefined` value anywhere (a very
// common real-world footgun — a field that's merely omitted upstream
// becomes `undefined`, not `null`, and Firestore refuses to write it).
// Checked here purely defensively; none of the scenarios below are
// expected to trip it (see api/gmail-check-email.js and
// src/data/gmailApprovedSenders.js's normalizeSenderTarget, which always
// emit explicit nulls, never omitted/undefined fields).
function findUndefined(obj, path = "") {
  if (obj === undefined) return path || "(root)";
  if (obj === null || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    const found = findUndefined(v, path ? `${path}.${k}` : k);
    if (found) return found;
  }
  return null;
}

// Fresh mocked firebase/firestore + ../Firebase.js per test, plus a
// cache-busting query string on every dynamic import so each test gets
// its own freshly-evaluated copy of the repository modules bound to
// THIS test's mocks (Node's ESM module cache would otherwise hand back
// an earlier test's already-evaluated module, still bound to that
// earlier test's mock — a real footgun with t.mock.module + a shared
// specifier, confirmed while building this test).
let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function setupFirestoreMock(t, store) {
  t.mock.module("firebase/firestore", {
    namedExports: {
      collection: (_db, ...segments) => ({ __isCollection: true, path: segments.join("/") }),
      doc: (_db, ...segments) => ({ __isDoc: true, path: segments.join("/") }),
      addDoc: async (col, data) => {
        const badPath = findUndefined(data);
        if (badPath) {
          throw new Error(`Function addDoc() called with invalid data. Unsupported field value: undefined (found in field ${badPath})`);
        }
        const id = `doc-${store.writes.length + 1}`;
        store.writes.push({ collectionPath: col.path, id, data });
        return { id };
      },
      updateDoc: async () => {},
      getDoc: async () => ({ exists: () => false }),
      getDocs: async () => ({ docs: [] }),
      onSnapshot: () => () => {},
      serverTimestamp: () => "SERVER_TIMESTAMP_SENTINEL",
    },
  });
  t.mock.module("../src/Firebase.js", { namedExports: { db: { __isFirestoreDb: true } } });
}

// A minimal in-memory localStorage stand-in, so the guest-path test can
// prove it's actually used, and the authenticated-path tests can prove
// it's never touched at all (asserted via call count, not just absence
// of a thrown error).
function installLocalStorageSpy() {
  const backing = new Map();
  let getCalls = 0;
  let setCalls = 0;
  globalThis.localStorage = {
    getItem: (k) => { getCalls++; return backing.has(k) ? backing.get(k) : null; },
    setItem: (k, v) => { setCalls++; backing.set(k, String(v)); },
  };
  return { calls: () => getCalls + setCalls, backing };
}

// Mirrors src/AuthShell.jsx's handleCheckEmail write sequence exactly
// (see that file — not imported directly, since it's embedded in a JSX
// component with no exported pure function to call). Keep in sync with
// AuthShell.jsx if that sequence changes.
async function processEmailResult(ctx, emailResult, { createSourceRecord, createIngestionCandidate }) {
  const newCandidates = [];
  const emailSourceRecord = await createSourceRecord(ctx, {
    sourceType: "gmail_email",
    title: emailResult.subject || "(no subject)",
    processingStatus: emailResult.extractionFailed ? "failed" : emailResult.obligations.length === 0 ? "no_candidates" : "extracted",
    metadata: {
      gmailMessageId: emailResult.gmailMessageId,
      gmailThreadId: emailResult.gmailThreadId,
      senderEmail: emailResult.senderEmail,
      senderName: emailResult.senderName,
      subject: emailResult.subject,
      receivedAt: emailResult.receivedAt,
      targetType: emailResult.targetType,
      targetChildId: emailResult.targetChildId,
      linkedUrls: emailResult.linkedUrls,
      googleDocUrls: emailResult.googleDocUrls,
    },
  });

  const webpageSourceRecordIdByUrl = new Map();
  for (const page of emailResult.webpagePages || []) {
    const obligationsFromThisPage = emailResult.obligations.filter((o) => o.sourceUrl === page.url);
    const webpageSourceRecord = await createSourceRecord(ctx, {
      sourceType: "webpage",
      title: page.title || null,
      processingStatus: !page.fetched ? "failed" : obligationsFromThisPage.length === 0 ? "no_candidates" : "extracted",
      metadata: { sourceUrl: page.url, parentEmailSourceRecordId: emailSourceRecord.id },
    });
    webpageSourceRecordIdByUrl.set(page.url, webpageSourceRecord.id);
  }

  for (const o of emailResult.obligations) {
    const sourceRecordId = o.sourceUrl && webpageSourceRecordIdByUrl.has(o.sourceUrl)
      ? webpageSourceRecordIdByUrl.get(o.sourceUrl)
      : emailSourceRecord.id;
    const candidate = await createIngestionCandidate(ctx, {
      sourceRecordId,
      proposedType: o.type,
      title: o.title,
      proposedChildName: o.childName,
      date: o.date,
      subject: o.subject,
      academicTopic: o.academicTopic,
      academicUnit: o.academicUnit,
      preparationRequired: o.preparationRequired,
      description: o.description,
      extractionConfidence: o.extractionConfidence,
      startTime: o.startTime,
      endTime: o.endTime,
      targetType: emailResult.targetType,
      targetChildId: emailResult.targetChildId,
    });
    newCandidates.push(candidate);
  }

  return { emailSourceRecord, newCandidates };
}

const REVIEW_TARGET_EMAIL_RESULT = {
  gmailMessageId: "gm-1", gmailThreadId: "gt-1", senderEmail: "teacher@school.edu", senderName: "Ms. Rivera",
  subject: "Back to School Night", receivedAt: "2026-09-18T15:30:00.000Z",
  targetType: "review", targetChildId: null,
  linkedUrls: ["https://school.edu/signup"],
  webpagePages: [{ url: "https://school.edu/signup", fetched: true, title: "Signup Page" }],
  googleDocUrls: [],
  obligations: [
    { type: "school_event", title: "Back to School Night", childName: null, date: "2026-09-15", subject: null,
      academicTopic: null, academicUnit: null, preparationRequired: null, description: null, extractionConfidence: 0.9,
      sourceUrl: "https://school.edu/signup", startTime: "18:00", endTime: "19:30" },
  ],
  extractionFailed: false,
};

test("authenticated ctx: email SourceRecord is persisted to the real Firestore path", async (t) => {
  const store = { writes: [] };
  setupFirestoreMock(t, store);
  const { createSourceRecord } = await freshImport("../src/data/sourceRecordsRepository.js");
  const { createIngestionCandidate } = await freshImport("../src/data/ingestionCandidatesRepository.js");
  const ctx = { uid: "real-parent-uid-abc123", isAdmin: false };

  const { emailSourceRecord } = await processEmailResult(ctx, REVIEW_TARGET_EMAIL_RESULT, { createSourceRecord, createIngestionCandidate });

  const emailWrite = store.writes.find((w) => w.id === emailSourceRecord.id);
  assert.ok(emailWrite, "the email SourceRecord's createSourceRecord() call reached a real addDoc write");
  assert.strictEqual(emailWrite.collectionPath, "users/real-parent-uid-abc123/sourceRecords");
  assert.strictEqual(emailWrite.data.sourceType, "gmail_email");
  assert.strictEqual(emailWrite.data.title, "Back to School Night");
});

test("authenticated ctx: webpage SourceRecord is persisted, parentEmailSourceRecordId points to the real email SourceRecord id", async (t) => {
  const store = { writes: [] };
  setupFirestoreMock(t, store);
  const { createSourceRecord } = await freshImport("../src/data/sourceRecordsRepository.js");
  const { createIngestionCandidate } = await freshImport("../src/data/ingestionCandidatesRepository.js");
  const ctx = { uid: "real-parent-uid-abc123", isAdmin: false };

  const { emailSourceRecord } = await processEmailResult(ctx, REVIEW_TARGET_EMAIL_RESULT, { createSourceRecord, createIngestionCandidate });

  const webpageWrite = store.writes.find((w) => w.data.sourceType === "webpage");
  assert.ok(webpageWrite, "the webpage SourceRecord's createSourceRecord() call reached a real addDoc write");
  assert.strictEqual(webpageWrite.collectionPath, "users/real-parent-uid-abc123/sourceRecords");
  assert.strictEqual(webpageWrite.data.metadata.sourceUrl, "https://school.edu/signup");
  assert.strictEqual(webpageWrite.data.metadata.parentEmailSourceRecordId, emailSourceRecord.id, "points at the email SourceRecord's REAL (Firestore-assigned) id, not a placeholder");
});

test("authenticated ctx: IngestionCandidate is persisted, sourceRecordId points to the correct persisted source", async (t) => {
  const store = { writes: [] };
  setupFirestoreMock(t, store);
  const { createSourceRecord } = await freshImport("../src/data/sourceRecordsRepository.js");
  const { createIngestionCandidate } = await freshImport("../src/data/ingestionCandidatesRepository.js");
  const ctx = { uid: "real-parent-uid-abc123", isAdmin: false };

  const { newCandidates } = await processEmailResult(ctx, REVIEW_TARGET_EMAIL_RESULT, { createSourceRecord, createIngestionCandidate });

  assert.strictEqual(newCandidates.length, 1);
  const candidateWrite = store.writes.find((w) => w.collectionPath === "users/real-parent-uid-abc123/ingestionCandidates");
  assert.ok(candidateWrite, "createIngestionCandidate() reached a real addDoc write");
  assert.strictEqual(newCandidates[0].id, candidateWrite.id, "the object the review UI receives IS the Firestore-persisted document (same id)");

  const webpageWrite = store.writes.find((w) => w.data.sourceType === "webpage");
  assert.strictEqual(candidateWrite.data.sourceRecordId, webpageWrite.id, "obligation attributed via sourceUrl points to the webpage's real SourceRecord id, not the email's");
});

test("authenticated ctx: an obligation with no sourceUrl attributes to the email SourceRecord instead", async (t) => {
  const store = { writes: [] };
  setupFirestoreMock(t, store);
  const { createSourceRecord } = await freshImport("../src/data/sourceRecordsRepository.js");
  const { createIngestionCandidate } = await freshImport("../src/data/ingestionCandidatesRepository.js");
  const ctx = { uid: "real-parent-uid-abc123", isAdmin: false };

  const emailResult = {
    ...REVIEW_TARGET_EMAIL_RESULT,
    obligations: [{ ...REVIEW_TARGET_EMAIL_RESULT.obligations[0], sourceUrl: null }],
  };
  const { emailSourceRecord } = await processEmailResult(ctx, emailResult, { createSourceRecord, createIngestionCandidate });
  const candidateWrite = store.writes.find((w) => w.collectionPath === "users/real-parent-uid-abc123/ingestionCandidates");
  assert.strictEqual(candidateWrite.data.sourceRecordId, emailSourceRecord.id);
});

test("authenticated ctx (isAdmin: false) never falls back to localStorage — real Firestore writes only", async (t) => {
  const store = { writes: [] };
  setupFirestoreMock(t, store);
  const spy = installLocalStorageSpy();
  try {
    const { createSourceRecord } = await freshImport("../src/data/sourceRecordsRepository.js");
    const { createIngestionCandidate } = await freshImport("../src/data/ingestionCandidatesRepository.js");
    const ctx = { uid: "real-parent-uid-abc123", isAdmin: false };

    await processEmailResult(ctx, REVIEW_TARGET_EMAIL_RESULT, { createSourceRecord, createIngestionCandidate });

    assert.strictEqual(spy.calls(), 0, "localStorage was never touched for an authenticated (isAdmin: false) ctx");
    assert.strictEqual(store.writes.length, 3, "all 3 documents (email SourceRecord, webpage SourceRecord, candidate) went to the real Firestore mock");
    assert.ok(store.writes.every((w) => /^doc-\d+$/.test(w.id)), "every persisted id is a Firestore-shaped generated id, never a local-*/guest id");
  } finally {
    delete globalThis.localStorage;
  }
});

test("guest ctx (isAdmin: true): unchanged — uses localStorage, never touches Firestore's addDoc", async (t) => {
  const store = { writes: [] };
  let addDocCalled = false;
  t.mock.module("firebase/firestore", {
    namedExports: {
      collection: () => ({}), doc: () => ({}),
      addDoc: async () => { addDocCalled = true; return { id: "SHOULD-NEVER-HAPPEN-FOR-GUEST" }; },
      updateDoc: async () => {}, getDoc: async () => ({ exists: () => false }), getDocs: async () => ({ docs: [] }),
      onSnapshot: () => () => {}, serverTimestamp: () => "SERVER_TIMESTAMP_SENTINEL",
    },
  });
  t.mock.module("../src/Firebase.js", { namedExports: { db: { __isFirestoreDb: true } } });
  const spy = installLocalStorageSpy();
  try {
    const { createSourceRecord } = await freshImport("../src/data/sourceRecordsRepository.js");
    const { createIngestionCandidate } = await freshImport("../src/data/ingestionCandidatesRepository.js");
    const ctx = { uid: "guest-local", isAdmin: true };

    const { emailSourceRecord, newCandidates } = await processEmailResult(ctx, REVIEW_TARGET_EMAIL_RESULT, { createSourceRecord, createIngestionCandidate });

    assert.strictEqual(addDocCalled, false, "guest mode's behavior is unchanged: real Firestore's addDoc is never invoked");
    assert.ok(spy.calls() > 0, "guest mode still persists via localStorage, exactly as before this investigation");
    assert.ok(emailSourceRecord.id.startsWith("local-src-"));
    assert.ok(newCandidates[0].id.startsWith("local-cand-"));
    assert.strictEqual(store.writes.length, 0);
  } finally {
    delete globalThis.localStorage;
  }
});

console.log("\n(all assertions above ran via node:test — see the pass/fail summary below)");
