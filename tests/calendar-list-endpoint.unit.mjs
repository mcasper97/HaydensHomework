/**
 * Focused unit tests for the "list" action of the consolidated
 * api/calendar.js action router (formerly api/calendar-list.js, its own
 * separate serverless function — folded in as part of the
 * post-Slice-C.1A Vercel-function-count consolidation). Imports and
 * CALLS the real, unmodified handler (never a reimplemented/mirrored
 * copy of its orchestration logic), same mocking strategy as
 * tests/calendar-publish-endpoint.unit.mjs: all SEVEN of calendar.js's
 * dependency modules are mocked directly per test via t.mock.module —
 * every time, not just the ones "list" itself touches — because
 * calendar.js is now one file with one static import graph regardless of
 * which action a request dispatches to, and ES module linking is static.
 * See tests/calendar-connection-endpoints.unit.mjs's own doc comment for
 * the full explanation.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/calendar-list-endpoint.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function fakeReqRes() {
  const req = { method: "GET", headers: { authorization: "Bearer fake-token" }, query: { action: "list" } };
  const state = { statusCode: null, body: null };
  const res = {
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
  };
  return { req, res, state };
}

/**
 * Registers fresh, per-test mocks for every dependency api/calendar.js
 * imports (all seven — see the module doc comment above). Returns
 * `calls`, a record of what the (real) handler actually did with its
 * (mocked) dependencies.
 */
function setupMocks(t, {
  authenticated = true,
  connection = { refreshToken: "cal-rt", needsReconnect: false },
  refreshResult = { ok: true, accessToken: "fresh-at" },
  listResult = { ok: true, calendars: [{ id: "primary", summary: "Mike's", primary: true, accessRole: "owner" }] },
} = {}) {
  const calls = { refreshCalendarAccessToken: [], listCalendars: [] };

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
      revokeToken: async () => true,
      generateState: () => "unused-state",
      generatePkcePair: () => ({ codeVerifier: "unused-verifier", codeChallenge: "unused-challenge" }),
      buildAuthorizationUrl: () => "https://accounts.google.com/unused",
      getOAuthConfig: () => ({ clientId: "unused", clientSecret: "unused", redirectUri: "unused" }),
      CALENDAR_SCOPES: ["https://www.googleapis.com/auth/calendar.events"],
    },
  });
  t.mock.module("../api/_googleCalendarConnectionsStore.js", {
    namedExports: {
      getGoogleCalendarConnection: async () => connection,
      deleteGoogleCalendarConnection: async () => {},
      sanitizeGoogleCalendarConnectionForClient: () => ({ connected: false, needsReconnect: false, connectedAt: null }),
      createOAuthState: async () => {},
    },
  });
  t.mock.module("../api/_gmailConnectionsStore.js", {
    namedExports: {
      getGmailConnection: async () => null,
    },
  });
  t.mock.module("../api/_householdProfileStore.js", {
    namedExports: {
      getHouseholdTimezone: async () => null,
    },
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
      refreshCalendarAccessToken: async (uid, conn) => { calls.refreshCalendarAccessToken.push({ uid, conn }); return refreshResult; },
      insertCalendarEvent: async () => ({ ok: true, alreadyExisted: false, eventId: "unused-event-id" }),
      listCalendars: async (args) => { calls.listCalendars.push(args); return listResult; },
    },
  });

  return calls;
}

test("SECURITY: requires Firebase authentication", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(state.statusCode, 401);
});

test("SERVER: not connected returns a clear NOT_CONNECTED error, no refresh/list attempted", async (t) => {
  const calls = setupMocks(t, { connection: null });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(state.body.code, "NOT_CONNECTED");
  assert.strictEqual(calls.refreshCalendarAccessToken.length, 0);
  assert.strictEqual(calls.listCalendars.length, 0);
});

test("SERVER: an already-flagged needsReconnect connection is handled without attempting refresh/list", async (t) => {
  const calls = setupMocks(t, { connection: { refreshToken: "cal-rt", needsReconnect: true } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(state.body.needsReconnect, true);
  assert.strictEqual(calls.listCalendars.length, 0);
});

test("SERVER: a successful list returns only the sanitized writable calendars", async (t) => {
  setupMocks(t, {
    listResult: {
      ok: true,
      calendars: [
        { id: "primary", summary: "Mike's", primary: true, accessRole: "owner" },
        { id: "hayden-cal@group.calendar.google.com", summary: "Hayden", primary: false, accessRole: "writer" },
      ],
    },
  });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(state.body.calendars.length, 2);
  assert.deepStrictEqual(Object.keys(state.body.calendars[0]).sort(), ["accessRole", "id", "primary", "summary"]);
});

test("SECURITY: no response body ever contains a token field, on any path", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  const serialized = JSON.stringify(state.body);
  assert.ok(!serialized.includes("refreshToken"));
  assert.ok(!serialized.includes("accessToken"));
  assert.ok(!serialized.includes("fresh-at"));
  assert.ok(!serialized.includes("cal-rt"));
});

test("ERROR SEMANTICS: an old-scope 403 from listCalendars produces CALENDAR_LIST_SCOPE_MISSING, NOT needsReconnect", async (t) => {
  const calls = setupMocks(t, { listResult: { ok: false, scopeMissing: true } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(state.body.code, "CALENDAR_LIST_SCOPE_MISSING");
  assert.notStrictEqual(state.body.needsReconnect, true, "a scope-missing result must never be reported as needsReconnect — the connection itself still works for publishing");
  assert.strictEqual(calls.refreshCalendarAccessToken.length, 1, "the token refresh itself succeeded — only the list call failed");
});

test("ERROR SEMANTICS: invalid_grant during token refresh DOES mark needsReconnect (a genuinely broken connection)", async (t) => {
  const calls = setupMocks(t, { refreshResult: { ok: false, needsReconnect: true } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(state.body.needsReconnect, true);
  assert.strictEqual(state.body.code, undefined, "invalid_grant's needsReconnect must not also carry the scope-missing code — they are distinct failure modes");
  assert.strictEqual(calls.listCalendars.length, 0, "listCalendars is never attempted once the token refresh itself has already failed");
});

test("ERROR SEMANTICS: a transient (non-invalid_grant) refresh failure is a generic error, not needsReconnect", async (t) => {
  setupMocks(t, { refreshResult: { ok: false, needsReconnect: false, error: "server_error" } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.notStrictEqual(state.body.needsReconnect, true);
});

test("SERVER: a genuine (non-scope) listCalendars failure is a generic retryable error", async (t) => {
  setupMocks(t, { listResult: { ok: false, error: "Google Calendar could not list your calendars (status 500)." } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes();
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.notStrictEqual(state.body.code, "CALENDAR_LIST_SCOPE_MISSING");
  assert.notStrictEqual(state.body.needsReconnect, true);
});
