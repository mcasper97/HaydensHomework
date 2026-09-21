/**
 * Focused unit tests for Slice B's actual serverless endpoint handlers —
 * api/calendar-status.js, api/calendar-disconnect.js, and the symmetric
 * conditional-revoke fix in api/gmail-disconnect.js. These import and
 * CALL the real, unmodified handler functions (never a reimplemented/
 * mirrored copy of their orchestration logic) — the exact production
 * conditional-revoke decision under test.
 *
 * Mocking strategy note: each handler's own connection-store dependency
 * (_googleCalendarConnectionsStore.js / _gmailConnectionsStore.js) is
 * mocked directly per test, rather than mocking the lower-level
 * firebase-admin/firestore package. Those store modules' OWN real
 * Firestore-reading logic is already fully covered, against a real fake
 * Firestore db, in tests/calendar-oauth.unit.mjs and
 * tests/gmail-oauth.unit.mjs — this file exists specifically to exercise
 * the DISCONNECT HANDLERS' conditional-revoke orchestration, which is
 * what's actually safety-critical here. Mocking one level lower
 * (firebase-admin/firestore) was tried first and found to bind stale
 * across tests once a store module had been evaluated once in this
 * process (an ES module's static import binds to whatever its dependency
 * resolved to at that module's own first evaluation, not per later
 * mock.module call) — mocking the store modules themselves side-steps
 * that entirely, since each test's freshImport of the HANDLER causes a
 * fresh resolution of its own static imports, which t.mock.module
 * correctly intercepts every time regardless of any earlier cached
 * (real) instance from another test.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/calendar-connection-endpoints.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function sanitizeCalendar(data) {
  if (!data) return { connected: false, needsReconnect: false, connectedAt: null };
  return { connected: true, needsReconnect: !!data.needsReconnect, connectedAt: data.connectedAt ?? null };
}

function fakeReqRes() {
  const req = { method: "POST", headers: { authorization: "Bearer fake-token" } };
  const state = { statusCode: null, body: null };
  const res = {
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
  };
  return { req, res, state };
}

/**
 * Registers fresh, per-test mocks for every dependency the endpoint
 * handlers under test import. `gmailConn`/`calendarConn` seed the
 * starting state (null = "not connected"); `authenticated: false` makes
 * requireFirebaseUser throw, exactly like a missing/invalid token would.
 * Returns mutable state so a test can assert what a handler actually did
 * (deleted the connection? called revoke, and with which token?).
 */
function setupMocks(t, { gmailConn = null, calendarConn = null, authenticated = true } = {}) {
  const revokeCalls = [];
  const gmailState = { conn: gmailConn };
  const calendarState = { conn: calendarConn };

  t.mock.module("../api/_auth.js", {
    namedExports: {
      requireFirebaseUser: async () => {
        if (!authenticated) throw new Error("no valid token");
        return { uid: "parent-uid-1" };
      },
      checkRateLimit: () => true,
    },
  });
  t.mock.module("../api/_googleOAuth.js", {
    namedExports: {
      revokeToken: async (token) => { revokeCalls.push(token); return true; },
    },
  });
  t.mock.module("../api/_googleCalendarConnectionsStore.js", {
    namedExports: {
      getGoogleCalendarConnection: async () => calendarState.conn,
      deleteGoogleCalendarConnection: async () => { calendarState.conn = null; },
      sanitizeGoogleCalendarConnectionForClient: sanitizeCalendar,
    },
  });
  t.mock.module("../api/_gmailConnectionsStore.js", {
    namedExports: {
      getGmailConnection: async () => gmailState.conn,
      deleteGmailConnection: async () => { gmailState.conn = null; },
    },
  });

  return { revokeCalls, gmailState, calendarState };
}

// ============ calendar-status.js: security — token never leaks ============
test("calendar-status: disconnected returns connected=false, no token field of any kind", async (t) => {
  const { } = setupMocks(t, {});
  const handler = (await freshImport("../api/calendar-status.js")).default;

  const { req, res, state } = fakeReqRes();
  req.method = "GET";
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.connected, false);
  assert.strictEqual(state.body.needsReconnect, false);
  assert.ok(!("refreshToken" in state.body), "refreshToken must never appear in the status response");
  assert.ok(!("accessToken" in state.body), "accessToken must never appear in the status response");
});

test("calendar-status: connected returns connected=true, refreshToken never returned", async (t) => {
  setupMocks(t, { calendarConn: { refreshToken: "super-secret-rt", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" } });
  const handler = (await freshImport("../api/calendar-status.js")).default;

  const { req, res, state } = fakeReqRes();
  req.method = "GET";
  await handler(req, res);

  assert.strictEqual(state.body.connected, true);
  assert.ok(!("refreshToken" in state.body), "refreshToken must never be exposed to the client");
  assert.ok(!JSON.stringify(state.body).includes("super-secret-rt"), "the raw token value must never appear anywhere in the response");
});

test("calendar-status: needsReconnect is surfaced correctly", async (t) => {
  setupMocks(t, { calendarConn: { refreshToken: "rt", needsReconnect: true, connectedAt: "2026-01-01T00:00:00.000Z" } });
  const handler = (await freshImport("../api/calendar-status.js")).default;

  const { req, res, state } = fakeReqRes();
  req.method = "GET";
  await handler(req, res);

  assert.strictEqual(state.body.connected, true);
  assert.strictEqual(state.body.needsReconnect, true);
});

test("calendar-status: requires Firebase authentication", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar-status.js")).default;

  const { req, res, state } = fakeReqRes();
  req.method = "GET";
  await handler(req, res);

  assert.strictEqual(state.statusCode, 401);
});

// ============ DISCONNECT SCENARIOS ============

test("Scenario A: Gmail + Calendar connected, disconnect Calendar -> local Calendar credential deleted, Google revoke NOT called, Gmail credential remains", async (t) => {
  const { revokeCalls, gmailState, calendarState } = setupMocks(t, {
    gmailConn: { refreshToken: "gmail-rt", emailAddress: "a@example.com", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" },
    calendarConn: { refreshToken: "calendar-rt", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" },
  });
  const handler = (await freshImport("../api/calendar-disconnect.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(revokeCalls.length, 0, "Google revoke must NOT be called while Gmail is still connected");
  assert.strictEqual(calendarState.conn, null, "Calendar's local credential must be deleted");
  assert.ok(gmailState.conn, "Gmail's credential must remain untouched");
});

test("Scenario B: Calendar only connected, disconnect Calendar -> Google revoke attempted, local Calendar credential deleted", async (t) => {
  const { revokeCalls, calendarState } = setupMocks(t, {
    calendarConn: { refreshToken: "calendar-rt", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" },
  });
  const handler = (await freshImport("../api/calendar-disconnect.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.deepStrictEqual(revokeCalls, ["calendar-rt"], "Google revoke SHOULD be attempted — Calendar is the last active Google integration");
  assert.strictEqual(calendarState.conn, null, "Calendar's local credential must still be deleted");
});

test("Scenario C: Gmail + Calendar connected, disconnect Gmail -> local Gmail credential deleted, Google revoke NOT called, Calendar credential remains", async (t) => {
  const { revokeCalls, gmailState, calendarState } = setupMocks(t, {
    gmailConn: { refreshToken: "gmail-rt", emailAddress: "a@example.com", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" },
    calendarConn: { refreshToken: "calendar-rt", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" },
  });
  const handler = (await freshImport("../api/gmail-disconnect.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(revokeCalls.length, 0, "Google revoke must NOT be called while Calendar is still connected");
  assert.strictEqual(gmailState.conn, null, "Gmail's local credential must be deleted");
  assert.ok(calendarState.conn, "Calendar's credential must remain untouched");
});

test("Scenario D: Gmail only connected, disconnect Gmail -> existing remote revoke behavior preserved", async (t) => {
  const { revokeCalls, gmailState } = setupMocks(t, {
    gmailConn: { refreshToken: "gmail-rt", emailAddress: "a@example.com", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" },
  });
  const handler = (await freshImport("../api/gmail-disconnect.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.deepStrictEqual(revokeCalls, ["gmail-rt"], "Google revoke SHOULD be attempted — Gmail is the last active Google integration");
  assert.strictEqual(gmailState.conn, null, "Gmail's local credential must still be deleted");
});

test("calendar-disconnect: requires Firebase authentication", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar-disconnect.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 401);
});

test("calendar-disconnect: disconnecting when nothing was ever connected is a clean no-op, no revoke attempted", async (t) => {
  const { revokeCalls } = setupMocks(t, {});
  const handler = (await freshImport("../api/calendar-disconnect.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(revokeCalls.length, 0);
});

test("gmail-disconnect: requires Firebase authentication", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/gmail-disconnect.js")).default;

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 401);
});
