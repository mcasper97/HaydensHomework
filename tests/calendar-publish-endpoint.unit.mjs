/**
 * Focused unit tests for the "publish" action of the consolidated
 * api/calendar.js action router (formerly api/calendar-publish.js, its
 * own separate serverless function — folded in as part of the
 * post-Slice-C.1A Vercel-function-count consolidation). Imports and
 * CALLS the real, unmodified handler (never a reimplemented/mirrored
 * copy of its orchestration logic), mirroring
 * tests/calendar-connection-endpoints.unit.mjs's own established mocking
 * strategy: each of calendar.js's SEVEN dependency modules is mocked
 * directly per test via t.mock.module — all seven, every time, not just
 * the ones "publish" itself touches, because calendar.js is now one file
 * with one static import graph regardless of which action a request
 * dispatches to, and ES module linking is static (importing a name that
 * doesn't exist on a mocked module throws at import time). See
 * calendar-connection-endpoints.unit.mjs's own doc comment for the full
 * explanation. src/organizer/calendarEventMapping.js is NOT mocked —
 * it's pure, dependency-free, and already covered in detail by
 * tests/calendar-event-mapping.unit.mjs, so it runs for real here too,
 * proving the endpoint is actually wired to the real mapping logic (not
 * a duplicated copy of its validation rules).
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/calendar-publish-endpoint.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function fakeReqRes(body) {
  const req = { method: "POST", headers: { authorization: "Bearer fake-token" }, query: { action: "publish" }, body };
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
 * (mocked) dependencies, so tests can assert on behavior rather than on
 * implementation details.
 */
function setupMocks(t, {
  authenticated = true,
  connection = { refreshToken: "cal-rt", needsReconnect: false },
  item = null,
  householdTimezone = null,
  refreshResult = { ok: true, accessToken: "fresh-at" },
  insertResult = { ok: true, alreadyExisted: false, eventId: "derived-event-id" },
  linkageWriteError = null,
} = {}) {
  const calls = { getItem: [], setItemGoogleCalendarFields: [], insertCalendarEvent: [], refreshCalendarAccessToken: [] };

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
      getHouseholdTimezone: async () => householdTimezone,
    },
  });
  t.mock.module("../api/_itemsStore.js", {
    namedExports: {
      getItem: async (uid, itemId) => { calls.getItem.push({ uid, itemId }); return item; },
      setItemGoogleCalendarFields: async (uid, itemId, fields) => {
        if (linkageWriteError) throw linkageWriteError;
        calls.setItemGoogleCalendarFields.push({ uid, itemId, fields });
      },
    },
  });
  t.mock.module("../api/_googleCalendarClient.js", {
    namedExports: {
      deriveGoogleEventId: (itemId) => `derived-${itemId}`,
      refreshCalendarAccessToken: async (uid, conn) => { calls.refreshCalendarAccessToken.push({ uid, conn }); return refreshResult; },
      insertCalendarEvent: async (args) => { calls.insertCalendarEvent.push(args); return insertResult; },
      listCalendars: async () => ({ ok: true, calendars: [] }),
    },
  });

  return calls;
}

const BASE_ITEM = {
  id: "item-1",
  type: "school_event",
  title: "PTA Spirit Night",
  notes: "",
  allDay: true,
  startDate: "2026-10-01",
  dueDate: null,
  startTime: null,
  endTime: null,
  dueTime: null,
  childIds: [],
  schedule: null,
  googleCalendarEventId: null,
};

test("SECURITY: requires Firebase authentication", async (t) => {
  setupMocks(t, { authenticated: false });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 401);
});

test("SERVER: not connected returns a clear NOT_CONNECTED error, no Item read attempted", async (t) => {
  const calls = setupMocks(t, { connection: null });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(state.body.code, "NOT_CONNECTED");
  assert.strictEqual(calls.getItem.length, 0);
});

test("SERVER: needsReconnect connection is handled — clear result, no Google insert attempted", async (t) => {
  const calls = setupMocks(t, { connection: { refreshToken: "cal-rt", needsReconnect: true } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(state.body.needsReconnect, true);
  assert.strictEqual(calls.insertCalendarEvent.length, 0);
});

test("SERVER: item not found returns 404", async (t) => {
  setupMocks(t, { item: null });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "does-not-exist" });
  await handler(req, res);
  assert.strictEqual(state.statusCode, 404);
  assert.strictEqual(state.body.ok, false);
});

test("SERVER: correct household Item is loaded (uid from the verified token, itemId from the request)", async (t) => {
  const calls = setupMocks(t, { item: { ...BASE_ITEM } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(calls.getItem.length, 1);
  assert.strictEqual(calls.getItem[0].uid, "parent-uid-1");
  assert.strictEqual(calls.getItem[0].itemId, "item-1");
});

test("IDEMPOTENCY: an already-published Item returns alreadyPublished, never calls insert again", async (t) => {
  const calls = setupMocks(t, { item: { ...BASE_ITEM, googleCalendarEventId: "already-there", googleCalendarSyncedAt: "2026-01-01T00:00:00.000Z" } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(state.body.alreadyPublished, true);
  assert.strictEqual(state.body.googleCalendarEventId, "already-there");
  assert.strictEqual(calls.insertCalendarEvent.length, 0);
});

test("SERVER: successful publish (all-day item) writes all four Item Calendar fields", async (t) => {
  const calls = setupMocks(t, { item: { ...BASE_ITEM } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);

  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(calls.setItemGoogleCalendarFields.length, 1);
  const write = calls.setItemGoogleCalendarFields[0];
  assert.strictEqual(write.uid, "parent-uid-1");
  assert.strictEqual(write.itemId, "item-1");
  assert.strictEqual(write.fields.googleCalendarEventId, "derived-event-id");
  assert.strictEqual(write.fields.googleCalendarId, "primary");
  assert.ok(write.fields.googleCalendarSyncedAt);
  assert.strictEqual(write.fields.googleCalendarSyncError, null);
});

test("SECURITY: no response body ever contains a token field, on any path", async (t) => {
  setupMocks(t, { item: { ...BASE_ITEM } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  const serialized = JSON.stringify(state.body);
  assert.ok(!serialized.includes("refreshToken"));
  assert.ok(!serialized.includes("accessToken"));
  assert.ok(!serialized.includes("fresh-at"));
});

test("SERVER: a failed Google insert does NOT write any linkage, Item stays untouched", async (t) => {
  const calls = setupMocks(t, { item: { ...BASE_ITEM }, insertResult: { ok: false, error: "Google Calendar could not create this event (status 500)." } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(calls.setItemGoogleCalendarFields.length, 0);
});

test("RECONNECT: invalid_grant during token refresh returns needsReconnect, never attempts insert", async (t) => {
  const calls = setupMocks(t, { item: { ...BASE_ITEM }, refreshResult: { ok: false, needsReconnect: true } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(state.body.needsReconnect, true);
  assert.strictEqual(calls.insertCalendarEvent.length, 0);
  assert.strictEqual(calls.setItemGoogleCalendarFields.length, 0);
});

test("MAPPING (via the real, unmocked calendarEventMapping.js): a recurring item is rejected with RECURRING_NOT_SUPPORTED, no Google call attempted", async (t) => {
  const calls = setupMocks(t, { item: { ...BASE_ITEM, schedule: { recurring: true, weekdays: [1] } } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(state.body.code, "RECURRING_NOT_SUPPORTED");
  assert.strictEqual(calls.insertCalendarEvent.length, 0);
});

test("MAPPING: an unsupported type (chore) is rejected with UNSUPPORTED_TYPE", async (t) => {
  setupMocks(t, { item: { ...BASE_ITEM, type: "chore" } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.code, "UNSUPPORTED_TYPE");
});

test("MAPPING: a timed item with no household timezone is blocked with MISSING_HOUSEHOLD_TIMEZONE", async (t) => {
  setupMocks(t, { item: { ...BASE_ITEM, allDay: false, startTime: "17:00", endTime: "20:00" }, householdTimezone: null });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.code, "MISSING_HOUSEHOLD_TIMEZONE");
});

test("MAPPING: a startTime-only item with no optionalEndTime is blocked with MISSING_END_TIME", async (t) => {
  setupMocks(t, { item: { ...BASE_ITEM, allDay: false, startTime: "17:00", endTime: null }, householdTimezone: "America/New_York" });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);
  assert.strictEqual(state.body.code, "MISSING_END_TIME");
});

test("SERVER: a supplied optionalEndTime successfully publishes a start-only timed item", async (t) => {
  const calls = setupMocks(t, { item: { ...BASE_ITEM, allDay: false, startTime: "17:00", endTime: null }, householdTimezone: "America/New_York" });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1", optionalEndTime: "18:00" });
  await handler(req, res);
  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(calls.insertCalendarEvent.length, 1);
  assert.strictEqual(calls.insertCalendarEvent[0].event.end.dateTime, "2026-10-01T18:00:00");
});

test("MAPPING (via the real, unmocked calendarEventMapping.js): an assignment with dueTime publishes as an all-day deadline event, never asks for an end time", async (t) => {
  const calls = setupMocks(t, {
    item: { ...BASE_ITEM, id: "item-2", type: "assignment", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "15:00" },
    householdTimezone: null, // due-based items never need one — proves it's never required
  });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-2" });
  await handler(req, res);

  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(calls.insertCalendarEvent.length, 1);
  const event = calls.insertCalendarEvent[0].event;
  assert.strictEqual(event.start.date, "2026-10-08");
  assert.strictEqual(event.end.date, "2026-10-09");
  assert.ok(!("dateTime" in event.start), "must never be a timed event");
  assert.strictEqual(event.description, "Due by 3:00 PM");
});

test("MAPPING: an assignment with dueTime never triggers MISSING_END_TIME even without an optionalEndTime supplied", async (t) => {
  setupMocks(t, { item: { ...BASE_ITEM, id: "item-3", type: "assignment", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "15:00" } });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-3" }); // no optionalEndTime in the request body
  await handler(req, res);
  assert.strictEqual(state.body.ok, true);
  assert.notStrictEqual(state.body.code, "MISSING_END_TIME");
});

test("MAPPING: an assignment with dueTime never leaks internal/provenance metadata into the description", async (t) => {
  const calls = setupMocks(t, {
    item: { ...BASE_ITEM, id: "item-4", type: "assignment", allDay: true, startDate: null, dueDate: "2026-10-08", dueTime: "15:00", notes: "Bring calculator." },
  });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res } = fakeReqRes({ itemId: "item-4" });
  await handler(req, res);
  const description = calls.insertCalendarEvent[0].event.description;
  assert.strictEqual(description, "Due by 3:00 PM\n\nBring calculator.");
  assert.ok(!description.includes("item-4"));
  assert.ok(!description.includes("sourceRecordId"));
  assert.ok(!description.includes("parent-uid-1"));
});

test("IDEMPOTENCY / RECOVERY: Google insert recognizes a prior success (409-duplicate) and the linkage is (re)written — no duplicate event, retry recovers", async (t) => {
  // Simulates: a first publish attempt's Google insert succeeded, but its
  // OWN Firestore linkage write failed, leaving the Item still unlinked.
  // A retry recomputes the SAME deterministic event id, Google reports it
  // already exists (alreadyExisted: true — see insertCalendarEvent's own
  // 409 handling), and this endpoint must still persist the linkage.
  const calls = setupMocks(t, {
    item: { ...BASE_ITEM }, // still unlinked — googleCalendarEventId: null
    insertResult: { ok: true, alreadyExisted: true, eventId: "derived-event-id" },
  });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);

  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(calls.setItemGoogleCalendarFields.length, 1, "the retry must still persist the linkage");
  assert.strictEqual(calls.setItemGoogleCalendarFields[0].fields.googleCalendarEventId, "derived-event-id");
});

test("IDEMPOTENCY / RECOVERY: if the linkage write itself fails, the endpoint reports an error but the Google event already exists — a further retry (simulated separately above) recovers", async (t) => {
  const calls = setupMocks(t, { item: { ...BASE_ITEM }, linkageWriteError: new Error("simulated Firestore write failure") });
  const handler = (await freshImport("../api/calendar.js")).default;
  const { req, res, state } = fakeReqRes({ itemId: "item-1" });
  await handler(req, res);

  assert.strictEqual(state.body.ok, false);
  assert.strictEqual(calls.insertCalendarEvent.length, 1, "the Google insert was still attempted (and, in reality, would have succeeded)");
});
