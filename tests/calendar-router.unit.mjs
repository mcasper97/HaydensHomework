/**
 * Focused unit tests for api/calendar.js's own DISPATCH layer — the part
 * that's genuinely new as of the post-Slice-C.1A consolidation (folding
 * api/calendar-status.js, api/calendar-list.js, api/calendar-oauth-start.js,
 * api/calendar-disconnect.js, and api/calendar-publish.js into one file
 * to stay under Vercel's Hobby-plan 12-Serverless-Function limit).
 * Per-action business logic is already covered in full by
 * tests/calendar-connection-endpoints.unit.mjs (status, disconnect),
 * tests/calendar-publish-endpoint.unit.mjs (publish), and
 * tests/calendar-list-endpoint.unit.mjs (list) — this file exists
 * specifically to prove the ROUTER ITSELF: action validation, method
 * validation, fail-closed behavior, and that auth always runs before any
 * protected action's own logic.
 *
 * Same "mock all seven direct dependencies, every time" strategy as the
 * other three calendar.js test files — see
 * tests/calendar-connection-endpoints.unit.mjs's own doc comment for why.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/calendar-router.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function fakeReqRes({ method = "GET", query = {}, body } = {}) {
  const req = { method, headers: { authorization: "Bearer fake-token" }, query, body };
  const state = { statusCode: null, body: null };
  const res = {
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
  };
  return { req, res, state };
}

/**
 * Registers fresh, per-test mocks for every one of api/calendar.js's seven
 * direct dependencies, all wired to succeed cleanly — this file cares
 * about DISPATCH, not the individual actions' business outcomes (those
 * are covered elsewhere), so every dependency here returns a benign,
 * "everything is fine" result whenever it's reached.
 */
function setupMocks(t, { authenticated = true, rateLimited = false } = {}) {
  const rateLimitCalls = [];
  const authCalls = { count: 0 };

  t.mock.module("../api/_auth.js", {
    namedExports: {
      requireFirebaseUser: async () => {
        authCalls.count += 1;
        if (!authenticated) throw new Error("no valid token");
        return { uid: "parent-uid-1" };
      },
      checkRateLimit: (key) => { rateLimitCalls.push(key); return !rateLimited; },
    },
  });
  t.mock.module("../api/_googleOAuth.js", {
    namedExports: {
      revokeToken: async () => true,
      generateState: () => "state-abc",
      generatePkcePair: () => ({ codeVerifier: "verifier-abc", codeChallenge: "challenge-abc" }),
      buildAuthorizationUrl: () => "https://accounts.google.com/o/oauth2/v2/auth?mock=1",
      getOAuthConfig: () => ({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "https://example.test/api/calendar-oauth-callback" }),
      CALENDAR_SCOPES: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
    },
  });
  t.mock.module("../api/_googleCalendarConnectionsStore.js", {
    namedExports: {
      getGoogleCalendarConnection: async () => ({ refreshToken: "cal-rt", needsReconnect: false }),
      deleteGoogleCalendarConnection: async () => {},
      sanitizeGoogleCalendarConnectionForClient: (data) => (data ? { connected: true, needsReconnect: false, connectedAt: null } : { connected: false, needsReconnect: false, connectedAt: null }),
      createOAuthState: async () => {},
    },
  });
  t.mock.module("../api/_gmailConnectionsStore.js", {
    namedExports: { getGmailConnection: async () => null },
  });
  t.mock.module("../api/_householdProfileStore.js", {
    namedExports: { getHouseholdTimezone: async () => "America/New_York" },
  });
  t.mock.module("../api/_itemsStore.js", {
    namedExports: {
      getItem: async () => ({
        id: "item-1", type: "school_event", title: "Spring Concert", notes: "", allDay: true,
        startDate: "2026-10-01", dueDate: null, startTime: null, endTime: null, dueTime: null,
        childIds: [], schedule: null, googleCalendarEventId: null,
      }),
      setItemGoogleCalendarFields: async () => {},
    },
  });
  t.mock.module("../api/_googleCalendarClient.js", {
    namedExports: {
      deriveGoogleEventId: (itemId) => `derived-${itemId}`,
      refreshCalendarAccessToken: async () => ({ ok: true, accessToken: "fresh-at" }),
      insertCalendarEvent: async (args) => ({ ok: true, alreadyExisted: false, eventId: args.event.id }),
      listCalendars: async () => ({ ok: true, calendars: [{ id: "primary", summary: "Mike's", primary: true, accessRole: "owner" }] }),
    },
  });

  return { rateLimitCalls, authCalls };
}

// ============ fail closed: missing / unknown action ============
test("ROUTER: a request with no `action` at all fails closed (400), no auth or dependency call attempted", async (t) => {
  const { authCalls } = setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: {} });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 400);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(authCalls.count, 0, "an invalid request should be rejected before ever checking auth");
});

test("ROUTER: an unknown action fails closed (400)", async (t) => {
  const { authCalls } = setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "delete-everything" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 400);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(authCalls.count, 0, "an unknown action should be rejected before ever checking auth");
});

// ============ method/action mismatch -> 405, for every action ============
test("ROUTER: POST to action=status (a GET-only action) returns 405", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "status" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 405);
});

test("ROUTER: POST to action=list (a GET-only action) returns 405", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "list" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 405);
});

test("ROUTER: GET to action=oauth-start (a POST-only action) returns 405", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "oauth-start" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 405);
});

test("ROUTER: GET to action=disconnect (a POST-only action) returns 405", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "disconnect" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 405);
});

test("ROUTER: GET to action=publish (a POST-only action) returns 405", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "publish" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 405);
});

// ============ auth is required before ANY protected action executes ============
test("ROUTER: auth is checked for every action, before that action's own logic runs — status", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "status" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 401);
});

test("ROUTER: auth is checked for every action, before that action's own logic runs — list", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "list" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 401);
});

test("ROUTER: auth is checked for every action, before that action's own logic runs — oauth-start", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "oauth-start" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 401);
});

test("ROUTER: auth is checked for every action, before that action's own logic runs — disconnect", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 401);
});

test("ROUTER: auth is checked for every action, before that action's own logic runs — publish", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "publish" }, body: { itemId: "item-1" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 401);
});

// ============ each action works end-to-end through the router (smoke test) ============
test("ROUTER: GET ?action=status works end-to-end", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "status" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(state.body.connected, true);
});

test("ROUTER: GET ?action=list works end-to-end", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "GET", query: { action: "list" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ok, true);
  assert.ok(Array.isArray(state.body.calendars));
});

test("ROUTER: POST ?action=oauth-start works end-to-end", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "oauth-start" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ok, true);
  assert.ok(typeof state.body.authUrl === "string" && state.body.authUrl.length > 0);
});

test("ROUTER: POST ?action=disconnect works end-to-end", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ok, true);
});

test("ROUTER: POST ?action=publish works end-to-end", async (t) => {
  setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "publish" }, body: { itemId: "item-1" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ok, true);
});

// ============ rate-limit semantics (the required correction) ============
test("ROUTER: status is NEVER rate-limited, matching pre-consolidation api/calendar-status.js exactly", async (t) => {
  const { rateLimitCalls } = setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res } = fakeReqRes({ method: "GET", query: { action: "status" } });
  await handler(req, res);
  assert.strictEqual(rateLimitCalls.length, 0);
});

test("ROUTER: list/oauth-start/disconnect/publish each use their OWN action-namespaced rate-limit key (four independent budgets for the same uid)", async (t) => {
  const { rateLimitCalls } = setupMocks(t);
  const handler = (await freshImport("../api/calendar.js")).default;

  const listReq = fakeReqRes({ method: "GET", query: { action: "list" } });
  await handler(listReq.req, listReq.res);
  const oauthStartReq = fakeReqRes({ method: "POST", query: { action: "oauth-start" } });
  await handler(oauthStartReq.req, oauthStartReq.res);
  const disconnectReq = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
  await handler(disconnectReq.req, disconnectReq.res);
  const publishReq = fakeReqRes({ method: "POST", query: { action: "publish" }, body: { itemId: "item-1" } });
  await handler(publishReq.req, publishReq.res);

  assert.strictEqual(rateLimitCalls.length, 4);
  const uniqueKeys = new Set(rateLimitCalls);
  assert.strictEqual(uniqueKeys.size, 4, "all four rate-limited actions must use distinct keys, never a single shared bucket");
  assert.ok(rateLimitCalls[0].includes("list"));
  assert.ok(rateLimitCalls[1].includes("oauth-start"));
  assert.ok(rateLimitCalls[2].includes("disconnect"));
  assert.ok(rateLimitCalls[3].includes("publish"));
  assert.ok(rateLimitCalls.every((k) => k.includes("parent-uid-1")), "every key must still be scoped to the requesting uid");
});

test("ROUTER: a rate-limited action returns 429 without reaching its own business logic", async (t) => {
  setupMocks(t, { rateLimited: true });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ method: "POST", query: { action: "disconnect" } });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 429);
});
