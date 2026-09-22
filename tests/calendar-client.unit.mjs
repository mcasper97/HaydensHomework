/**
 * Focused unit tests for Slice C's api/_googleCalendarClient.js —
 * deriveGoogleEventId, insertCalendarEvent, refreshCalendarAccessToken —
 * plus Slice C.1A's listCalendars.
 * `refreshCalendarAccessToken`'s invalid_grant path calls
 * markGoogleCalendarConnectionNeedsReconnect, which needs the real
 * Firebase Admin SDK unless mocked — hence this whole file uses Node's
 * test runner + module-mocking support, even for the tests that don't
 * strictly need mocking, for consistency.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/calendar-client.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";
import { deriveGoogleEventId, insertCalendarEvent, listCalendars } from "../api/_googleCalendarClient.js";

// ============ deriveGoogleEventId ============
test("IDEMPOTENCY — the same itemId always produces the same event id", () => {
  assert.strictEqual(deriveGoogleEventId("item-abc-123"), deriveGoogleEventId("item-abc-123"));
});
test("Different itemIds produce different event ids", () => {
  assert.notStrictEqual(deriveGoogleEventId("item-abc-123"), deriveGoogleEventId("item-xyz-789"));
});
test("The derived id uses ONLY Google's allowed base32hex charset and length", () => {
  const id = deriveGoogleEventId("some-firestore-generated-Id_With-Mixed-CASE");
  assert.match(id, /^[0-9a-v]+$/, "must be lowercase 0-9/a-v only");
  assert.ok(id.length >= 5 && id.length <= 1024, "must be within Google's allowed length");
  assert.strictEqual(id.length, 32, "a SHA-1-derived id is exactly 32 base32hex characters (160 bits / 5, no padding)");
});
test("A Firestore-style mixed-case id still round-trips deterministically", () => {
  assert.strictEqual(deriveGoogleEventId("AbCdEf123456789012"), deriveGoogleEventId("AbCdEf123456789012"));
});

// ============ insertCalendarEvent ============
test("insertCalendarEvent: a fresh 200/201 response returns the created event id", async () => {
  const fetchFn = async (url, options) => {
    assert.strictEqual(url, "https://www.googleapis.com/calendar/v3/calendars/primary/events");
    assert.strictEqual(options.method, "POST");
    assert.strictEqual(options.headers.Authorization, "Bearer test-access-token");
    const body = JSON.parse(options.body);
    assert.strictEqual(body.id, "det-id-1");
    return { ok: true, status: 200, json: async () => ({ id: "det-id-1", summary: "Test Event" }) };
  };
  const result = await insertCalendarEvent({ accessToken: "test-access-token", event: { id: "det-id-1", summary: "Test Event" }, fetchFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.alreadyExisted, false);
  assert.strictEqual(result.eventId, "det-id-1");
});

test("insertCalendarEvent: a 409 duplicate is treated as SUCCESS (already exists), not an error — the idempotency recovery path", async () => {
  const fetchFn = async () => ({ ok: false, status: 409, json: async () => ({ error: { message: "The requested identifier already exists." } }) });
  const result = await insertCalendarEvent({ accessToken: "test-access-token", event: { id: "det-id-2", summary: "Test Event" }, fetchFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.alreadyExisted, true);
  assert.strictEqual(result.eventId, "det-id-2");
});

test("insertCalendarEvent: a genuine failure (e.g. 400/500) is reported as an error, not treated as success", async () => {
  const fetchFn = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "Internal error" } }) });
  const result = await insertCalendarEvent({ accessToken: "test-access-token", event: { id: "det-id-3" }, fetchFn });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

test("insertCalendarEvent: a network failure is reported as an error, never throws", async () => {
  const fetchFn = async () => { throw new Error("network down"); };
  const result = await insertCalendarEvent({ accessToken: "t", event: { id: "det-id-4" }, fetchFn });
  assert.strictEqual(result.ok, false);
});

test("insertCalendarEvent: never logs/returns the raw Google response body verbatim on failure", async () => {
  const secretDetail = "SUPER_SENSITIVE_EVENT_DESCRIPTION_TEXT";
  const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "bad request", details: secretDetail } }) });
  const result = await insertCalendarEvent({ accessToken: "t", event: { id: "det-id-5" }, fetchFn });
  assert.ok(!result.error.includes(secretDetail), "the raw response body's content must never be echoed back in the error string");
});

// ============ listCalendars (Slice C.1A) ============
function calendarListFetch(items, { status = 200 } = {}) {
  return async (url, options) => {
    assert.strictEqual(url, "https://www.googleapis.com/calendar/v3/users/me/calendarList");
    assert.strictEqual(options.method, "GET");
    assert.strictEqual(options.headers.Authorization, "Bearer test-access-token");
    return { ok: status < 400, status, json: async () => ({ items }) };
  };
}

test("listCalendars: a writer calendar is included", async () => {
  const fetchFn = calendarListFetch([{ id: "cal-writer@group.calendar.google.com", summary: "Hayden", primary: false, accessRole: "writer" }]);
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.calendars.length, 1);
  assert.strictEqual(result.calendars[0].accessRole, "writer");
});

test("listCalendars: an owner calendar is included", async () => {
  const fetchFn = calendarListFetch([{ id: "mike@example.com", summary: "Mike's", primary: true, accessRole: "owner" }]);
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.calendars.length, 1);
  assert.strictEqual(result.calendars[0].accessRole, "owner");
});

test("listCalendars: a reader calendar is excluded (can't receive events.insert)", async () => {
  const fetchFn = calendarListFetch([{ id: "readonly-cal", summary: "Read only", primary: false, accessRole: "reader" }]);
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.calendars.length, 0);
});

test("listCalendars: a freeBusyReader calendar is excluded", async () => {
  const fetchFn = calendarListFetch([{ id: "fb-cal", summary: "Free/busy only", primary: false, accessRole: "freeBusyReader" }]);
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.calendars.length, 0);
});

test("listCalendars: writer/owner calendars are kept, reader/freeBusyReader are dropped, in a mixed list", async () => {
  const fetchFn = calendarListFetch([
    { id: "a", summary: "A", primary: false, accessRole: "owner" },
    { id: "b", summary: "B", primary: false, accessRole: "reader" },
    { id: "c", summary: "C", primary: false, accessRole: "writer" },
    { id: "d", summary: "D", primary: false, accessRole: "freeBusyReader" },
  ]);
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.deepStrictEqual(result.calendars.map((c) => c.id).sort(), ["a", "c"]);
});

test("listCalendars: result is stripped to exactly id/summary/primary/accessRole — no other Google fields leak through", async () => {
  const fetchFn = calendarListFetch([{
    id: "cal-1",
    summary: "Family",
    primary: true,
    accessRole: "owner",
    backgroundColor: "#ff0000",
    colorId: "12",
    timeZone: "America/New_York",
    description: "Secret household notes",
    conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
    notificationSettings: { notifications: [] },
  }]);
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.deepStrictEqual(Object.keys(result.calendars[0]).sort(), ["accessRole", "id", "primary", "summary"]);
});

// ---- Scope-missing classification (post-approval correction: a bare 403
// status is NOT sufficient on its own — see isCalendarListScopeMissingError
// in api/_googleCalendarClient.js) ----
test("listCalendars: 403 + reason 'insufficientPermissions' is reported as scopeMissing", async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { code: 403, message: "Insufficient Permission", errors: [{ domain: "global", reason: "insufficientPermissions", message: "Insufficient Permission" }] } }),
  });
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.scopeMissing, true);
  assert.strictEqual(result.error, undefined, "scopeMissing must be a distinct signal, not bundled with a generic error message");
});

test("listCalendars: 403 + 'insufficient authentication scopes' message (no reason code) is reported as scopeMissing", async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { code: 403, message: "Request had insufficient authentication scopes." } }),
  });
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.scopeMissing, true);
});

test("listCalendars: 403 + a quota/rate-limit reason is NOT scopeMissing — it's a generic failure", async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { code: 403, message: "User Rate Limit Exceeded", errors: [{ domain: "usageLimits", reason: "userRateLimitExceeded", message: "User Rate Limit Exceeded" }] } }),
  });
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.scopeMissing, undefined, "a quota/rate-limit 403 must never be misreported as scope-missing");
  assert.ok(result.error, "a quota/rate-limit 403 still surfaces as a generic, retryable error");
});

test("listCalendars: 403 with no parseable/matching body is NOT scopeMissing (status alone is not evidence)", async () => {
  const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "Forbidden" } }) });
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.scopeMissing, undefined);
  assert.ok(result.error);
});

test("listCalendars: a genuine failure (e.g. 500) is a generic error, not scopeMissing", async () => {
  const fetchFn = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "Internal error" } }) });
  const result = await listCalendars({ accessToken: "test-access-token", fetchFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.scopeMissing, undefined);
  assert.ok(result.error);
});

test("listCalendars: a network failure is reported as an error, never throws", async () => {
  const fetchFn = async () => { throw new Error("network down"); };
  const result = await listCalendars({ accessToken: "t", fetchFn });
  assert.strictEqual(result.ok, false);
});

// ============ refreshCalendarAccessToken — invalid_grant marks needsReconnect ============
test("refreshCalendarAccessToken: invalid_grant marks the Calendar connection needsReconnect and returns needsReconnect: true", async (t) => {
  let markCalls = 0;
  t.mock.module("../api/_googleCalendarConnectionsStore.js", {
    namedExports: {
      markGoogleCalendarConnectionNeedsReconnect: async () => { markCalls += 1; },
    },
  });
  t.mock.module("../api/_googleOAuth.js", {
    namedExports: {
      refreshAccessToken: async () => {
        const err = new Error("Token has been expired or revoked.");
        err.isInvalidGrant = true;
        throw err;
      },
    },
  });
  const { refreshCalendarAccessToken } = await import(`../api/_googleCalendarClient.js?t=1`);

  const result = await refreshCalendarAccessToken("uid-1", { refreshToken: "rt" });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.needsReconnect, true);
  assert.strictEqual(markCalls, 1, "markGoogleCalendarConnectionNeedsReconnect must be called exactly once");
});

test("refreshCalendarAccessToken: a non-invalid_grant failure is a transient error, does NOT mark needsReconnect", async (t) => {
  let markCalls = 0;
  t.mock.module("../api/_googleCalendarConnectionsStore.js", {
    namedExports: {
      markGoogleCalendarConnectionNeedsReconnect: async () => { markCalls += 1; },
    },
  });
  t.mock.module("../api/_googleOAuth.js", {
    namedExports: {
      refreshAccessToken: async () => { throw new Error("server_error"); },
    },
  });
  const { refreshCalendarAccessToken } = await import(`../api/_googleCalendarClient.js?t=2`);

  const result = await refreshCalendarAccessToken("uid-1", { refreshToken: "rt" });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.needsReconnect, false);
  assert.strictEqual(markCalls, 0);
});

test("refreshCalendarAccessToken: success returns the fresh access token", async (t) => {
  t.mock.module("../api/_googleCalendarConnectionsStore.js", {
    namedExports: { markGoogleCalendarConnectionNeedsReconnect: async () => {} },
  });
  t.mock.module("../api/_googleOAuth.js", {
    namedExports: { refreshAccessToken: async () => ({ access_token: "fresh-at" }) },
  });
  const { refreshCalendarAccessToken } = await import(`../api/_googleCalendarClient.js?t=3`);

  const result = await refreshCalendarAccessToken("uid-1", { refreshToken: "rt" });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.accessToken, "fresh-at");
});
