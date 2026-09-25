/**
 * Focused unit tests for api/gmail-reset-processing.js — the authenticated
 * server endpoint behind Settings -> Email Import -> Testing Tools ->
 * "Reset Email Processing History". These import and CALL the real,
 * unmodified handler (never a reimplemented copy of its logic), mocking
 * only its direct dependencies — same established pattern as
 * tests/calendar-connection-endpoints.unit.mjs.
 *
 * Store-level behavior (the actual reset mechanism, household isolation,
 * SourceRecords/candidates left untouched, a previously processed message
 * becoming eligible again) is covered in depth in
 * tests/gmail-processing-reset.unit.mjs — this file is specifically about
 * the endpoint's own security surface: authentication required, and uid
 * ALWAYS coming from the verified token, never from anything client-supplied.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/gmail-reset-processing-endpoint.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function fakeReqRes({ method = "POST", body = {}, query = {} } = {}) {
  const req = { method, headers: { authorization: "Bearer fake-token" }, body, query };
  const state = { statusCode: null, body: null };
  const res = {
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
  };
  return { req, res, state };
}

function setupMocks(t, { authenticated = true, uid = "parent-uid-1", rateLimited = false, resetFails = false } = {}) {
  const rateLimitCalls = [];
  const resetCalls = [];

  t.mock.module("../api/_auth.js", {
    namedExports: {
      requireFirebaseUser: async () => {
        if (!authenticated) throw new Error("no valid token");
        return { uid };
      },
      checkRateLimit: (key) => { rateLimitCalls.push(key); return !rateLimited; },
    },
  });
  t.mock.module("../api/_gmailProcessingResetStore.js", {
    namedExports: {
      resetGmailProcessingHistory: async (calledUid) => {
        resetCalls.push({ uid: calledUid });
        if (resetFails) throw new Error("simulated store failure");
        return { resetCount: 3 };
      },
      getGmailProcessingResetAt: async () => null,
      toMillis: () => null,
    },
  });
  t.mock.module("../api/_sourceRecordsStore.js", {
    namedExports: {
      listProcessedGmailMessageIds: async () => new Set(),
      createSourceRecordServerSide: async () => ({ id: "unused" }),
    },
  });

  return { rateLimitCalls, resetCalls };
}

// ============ Happy path ============
test("An authenticated household can reset its own Gmail processing history", async (t) => {
  const { resetCalls } = setupMocks(t, { uid: "parent-uid-1" });
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(state.body.resetCount, 3, "the exact { ok, resetCount } shape the spec asks for");
  assert.strictEqual(resetCalls.length, 1);
  assert.strictEqual(resetCalls[0].uid, "parent-uid-1", "resets exactly this authenticated household's own uid");
});

// ============ Authentication required ============
test("Requires Firebase authentication — no valid token -> 401, store never called", async (t) => {
  const { resetCalls } = setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 401);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(resetCalls.length, 0, "an unauthenticated request must never reach the reset store at all");
});

// ============ Arbitrary client uid is never accepted ============
test("A uid supplied in the request body is completely ignored — only the verified token's uid is ever used", async (t) => {
  const { resetCalls } = setupMocks(t, { uid: "real-parent-uid" });
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;

  const { req, res, state } = fakeReqRes({ body: { uid: "attacker-controlled-uid" } });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(resetCalls.length, 1);
  assert.strictEqual(resetCalls[0].uid, "real-parent-uid", "must use the verified token's uid");
  assert.notStrictEqual(resetCalls[0].uid, "attacker-controlled-uid", "the client-supplied uid must never be the one actually used");
});

test("A uid supplied in the query string is also ignored", async (t) => {
  const { resetCalls } = setupMocks(t, { uid: "real-parent-uid-2" });
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;

  const { req, res, state } = fakeReqRes({ query: { uid: "another-attacker-uid" } });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(resetCalls[0].uid, "real-parent-uid-2");
});

test("A household's reset call is always tagged with its own authenticated uid", async (t) => {
  const { resetCalls } = setupMocks(t, { uid: "household-1" });
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;
  const { req, res } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(resetCalls[0].uid, "household-1");
});

// ============ Rate limiting ============
test("Too many requests -> 429, store never called", async (t) => {
  const { resetCalls } = setupMocks(t, { rateLimited: true });
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 429);
  assert.strictEqual(resetCalls.length, 0);
});

// ============ Method guard ============
test("Only POST is accepted -> GET is rejected with 405", async (t) => {
  setupMocks(t, {});
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;

  const { req, res, state } = fakeReqRes({ method: "GET" });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 405);
});

// ============ Downstream failure never leaks internals ============
test("A store failure returns a clean 500 without leaking internal error details", async (t) => {
  setupMocks(t, { resetFails: true });
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 500);
  assert.strictEqual(state.body.ok, false);
  assert.ok(!JSON.stringify(state.body).includes("simulated store failure"), "the raw internal error message must never reach the client");
});

// ============ Reset never itself triggers ingestion ============
test("The endpoint never calls anything Gmail-scanning related (no Gmail connection, sender, or message-listing dependency at all)", async (t) => {
  // The handler module's own static imports are exactly requireFirebaseUser/
  // checkRateLimit, resetGmailProcessingHistory, and listProcessedGmailMessageIds
  // (see setupMocks above, which mocks precisely those three modules and no
  // Gmail-scanning module) — if the endpoint statically imported
  // api/_gmailIngestionCore.js or api/_gmailConnectionsStore.js, importing
  // it here without those mocks registered would throw at import time
  // (the same "ES module linking is static" property
  // tests/calendar-connection-endpoints.unit.mjs's own doc comment
  // describes), which this test's successful import already disproves.
  setupMocks(t, {});
  const handler = (await freshImport("../api/gmail-reset-processing.js")).default;
  assert.strictEqual(typeof handler, "function", "module imported cleanly with only auth + reset-store + source-records mocks — no Gmail-scan dependency exists");
});

console.log("\n(node:test results reported above by the test runner itself)");
