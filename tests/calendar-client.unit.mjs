/**
 * Focused unit tests for Slice C's api/_googleCalendarClient.js —
 * deriveGoogleEventId, insertCalendarEvent, refreshCalendarAccessToken.
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
import { deriveGoogleEventId, insertCalendarEvent } from "../api/_googleCalendarClient.js";

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
