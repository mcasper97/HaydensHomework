/**
 * Focused unit tests for the "status" and "disconnect" actions of the
 * consolidated api/calendar.js action router, plus the symmetric
 * conditional-revoke fix in api/gmail-disconnect.js (untouched by the
 * consolidation — still its own separate file/function). These import and
 * CALL the real, unmodified handler (never a reimplemented/mirrored copy
 * of its orchestration logic) — the exact production conditional-revoke
 * decision under test.
 *
 * Post-consolidation note: api/calendar.js statically imports from SEVEN
 * dependency modules (_auth.js, _googleCalendarConnectionsStore.js,
 * _gmailConnectionsStore.js, _householdProfileStore.js, _itemsStore.js,
 * _googleCalendarClient.js, _googleOAuth.js) regardless of which `action`
 * a given request dispatches to, because it's all one file/module now.
 * setupMocks below therefore mocks ALL seven, every time, providing every
 * named export calendar.js actually imports from each — even the ones
 * irrelevant to the status/disconnect scenarios this file exercises —
 * because ES module linking is static: importing a name that doesn't
 * exist on a mocked module throws at import time regardless of whether
 * that name is ever called at runtime. calendarEventMapping.js is left
 * REAL/unmocked throughout (pure, dependency-free, already covered
 * separately — same principle as calendar-publish-endpoint.unit.mjs).
 *
 * Mocking strategy note (unchanged from before consolidation): each
 * dependency is mocked directly per test, rather than mocking a
 * lower-level shared package like firebase-admin/firestore — mocking a
 * lower-level dependency was found earlier in this project to bind stale
 * across tests once a module had been evaluated once in this process (an
 * ES module's static import binds to whatever its dependency resolved to
 * at that module's own first evaluation, not per later mock.module call).
 * Mocking each of calendar.js's OWN direct dependencies side-steps that
 * entirely, since each test's freshImport of calendar.js causes a fresh
 * resolution of its own static imports, which t.mock.module correctly
 * intercepts every time regardless of any earlier cached (real) instance
 * from another test.
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

function fakeReqRes({ method = "POST", query = {} } = {}) {
  const req = { method, headers: { authorization: "Bearer fake-token" }, query };
  const state = { statusCode: null, body: null };
  const res = {
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
  };
  return { req, res, state };
}

/**
 * Registers fresh, per-test mocks for every dependency api/calendar.js
 * imports (see the module doc comment above for why all seven are always
 * provided). `gmailConn`/`calendarConn` seed the starting state (null =
 * "not connected"); `authenticated: false` makes requireFirebaseUser
 * throw, exactly like a missing/invalid token would. Returns mutable
 * state so a test can assert what a handler actually did (deleted the
 * connection? called revoke, and with which token? rate-limited which
 * key?).
 */
function setupMocks(t, { gmailConn = null, calendarConn = null, authenticated = true, rateLimited = false } = {}) {
  const revokeCalls = [];
  const gmailState = { conn: gmailConn };
  const calendarState = { conn: calendarConn };
  const rateLimitCalls = [];

  t.mock.module("../api/_auth.js", {
    namedExports: {
      requireFirebaseUser: async () => {
        if (!authenticated) throw new Error("no valid token");
        return { uid: "parent-uid-1" };
      },
      checkRateLimit: (key) => { rateLimitCalls.push(key); return !rateLimited; },
    },
  });
  t.mock.module("../api/_googleOAuth.js", {
    namedExports: {
      revokeToken: async (token) => { revokeCalls.push(token); return true; },
      generateState: () => "unused-state",
      generatePkcePair: () => ({ codeVerifier: "unused-verifier", codeChallenge: "unused-challenge" }),
      buildAuthorizationUrl: () => "https://accounts.google.com/unused",
      getOAuthConfig: () => ({ clientId: "unused", clientSecret: "unused", redirectUri: "unused" }),
      CALENDAR_SCOPES: ["https://www.googleapis.com/auth/calendar.events"],
    },
  });
  t.mock.module("../api/_googleCalendarConnectionsStore.js", {
    namedExports: {
      getGoogleCalendarConnection: async () => calendarState.conn,
      deleteGoogleCalendarConnection: async () => { calendarState.conn = null; },
      sanitizeGoogleCalendarConnectionForClient: sanitizeCalendar,
      createOAuthState: async () => {},
    },
  });
  t.mock.module("../api/_gmailConnectionsStore.js", {
    namedExports: {
      getGmailConnection: async () => gmailState.conn,
      deleteGmailConnection: async () => { gmailState.conn = null; },
    },
  });
  t.mock.module("../api/_householdProfileStore.js", {
    namedExports: { getHouseholdTimezone: async () => null },
  });
  t.mock.module("../api/_itemsStore.js", {
    namedExports: {
      getItem: async () => null,
      setItemGoogleCalendarFields: async () => {},
    },
  });
  t.mock.module("../api/_googleCalendarClient.js", {
    namedExports: {
      deriveGoogleEventId: (itemId) => `derived-${itemId}`,
      refreshCalendarAccessToken: async () => ({ ok: true, accessToken: "unused-at" }),
      insertCalendarEvent: async () => ({ ok: true, alreadyExisted: false, eventId: "unused-event-id" }),
      listCalendars: async () => ({ ok: true, calendars: [] }),
    },
  });

  return { revokeCalls, gmailState, calendarState, rateLimitCalls };
}

// ============ calendar.js?action=status: security — token never leaks ============
test("calendar?action=status: disconnected returns connected=false, no token field of any kind", async (t) => {
  setupMocks(t, {});
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "status" } });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.connected, false);
  assert.strictEqual(state.body.needsReconnect, false);
  assert.ok(!("refreshToken" in state.body), "refreshToken must never appear in the status response");
  assert.ok(!("accessToken" in state.body), "accessToken must never appear in the status response");
});

test("calendar?action=status: connected returns connected=true, refreshToken never returned", async (t) => {
  setupMocks(t, { calendarConn: { refreshToken: "super-secret-rt", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" } });
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "status" } });
  await handler(req, res);

  assert.strictEqual(state.body.connected, true);
  assert.ok(!("refreshToken" in state.body), "refreshToken must never be exposed to the client");
  assert.ok(!JSON.stringify(state.body).includes("super-secret-rt"), "the raw token value must never appear anywhere in the response");
});

test("calendar?action=status: needsReconnect is surfaced correctly", async (t) => {
  setupMocks(t, { calendarConn: { refreshToken: "rt", needsReconnect: true, connectedAt: "2026-01-01T00:00:00.000Z" } });
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "status" } });
  await handler(req, res);

  assert.strictEqual(state.body.connected, true);
  assert.strictEqual(state.body.needsReconnect, true);
});

test("calendar?action=status: requires Firebase authentication", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "status" } });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 401);
});

test("calendar?action=status: is NEVER rate-limited (unthrottled, exactly like the pre-consolidation calendar-status.js)", async (t) => {
  const { rateLimitCalls } = setupMocks(t, {});
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "status" } });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(rateLimitCalls.length, 0, "status must call checkRateLimit zero times");
});

// ============ DISCONNECT SCENARIOS (action=disconnect) ============

test("Scenario A: Gmail + Calendar connected, disconnect Calendar -> local Calendar credential deleted, Google revoke NOT called, Gmail credential remains", async (t) => {
  const { revokeCalls, gmailState, calendarState } = setupMocks(t, {
    gmailConn: { refreshToken: "gmail-rt", emailAddress: "a@example.com", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" },
    calendarConn: { refreshToken: "calendar-rt", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" },
  });
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
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
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
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

  const { req, res, state } = fakeReqRes({ method: "POST" });
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

  const { req, res, state } = fakeReqRes({ method: "POST" });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.deepStrictEqual(revokeCalls, ["gmail-rt"], "Google revoke SHOULD be attempted — Gmail is the last active Google integration");
  assert.strictEqual(gmailState.conn, null, "Gmail's local credential must still be deleted");
});

test("calendar?action=disconnect: requires Firebase authentication", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 401);
});

test("calendar?action=disconnect: disconnecting when nothing was ever connected is a clean no-op, no revoke attempted", async (t) => {
  const { revokeCalls } = setupMocks(t, {});
  const handler = (await freshImport("../api/calendar.js")).default;

  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(revokeCalls.length, 0);
});

test("gmail-disconnect: requires Firebase authentication", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/gmail-disconnect.js")).default;

  const { req, res, state } = fakeReqRes({ method: "POST" });
  await handler(req, res);

  assert.strictEqual(state.statusCode, 401);
});

// ============ ROUTER: action-namespaced rate-limit keys (post-consolidation requirement) ============
test("calendar?action=disconnect and calendar?action=oauth-start use DIFFERENT rate-limit keys for the same uid (independent budgets, matching pre-consolidation isolation)", async (t) => {
  const { rateLimitCalls } = setupMocks(t, {});
  const handler = (await freshImport("../api/calendar.js")).default;

  const disconnectReq = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
  await handler(disconnectReq.req, disconnectReq.res);

  const oauthStartReq = fakeReqRes({ method: "POST", query: { action: "oauth-start" } });
  await handler(oauthStartReq.req, oauthStartReq.res);

  assert.strictEqual(rateLimitCalls.length, 2);
  assert.notStrictEqual(rateLimitCalls[0], rateLimitCalls[1], "disconnect and oauth-start must use distinct rate-limit keys, not a single shared bucket");
  assert.ok(rateLimitCalls[0].includes("disconnect"));
  assert.ok(rateLimitCalls[1].includes("oauth-start"));
});
