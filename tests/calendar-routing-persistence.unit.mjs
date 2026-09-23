/**
 * Focused unit tests for Slice C.1B's client Google Calendar routing
 * persistence module — src/data/googleCalendarRouting.js.
 *
 * normalizeGoogleCalendarRouting and buildGoogleCalendarRoutingSave are
 * pure and tested directly with plain assertions, no mocking needed.
 * saveGoogleCalendarRouting is the one impure function (a real Firestore
 * setDoc call) — module-mocked here (firebase/firestore's doc/setDoc,
 * and ../src/Firebase.js's db) so its exact write shape (which document,
 * which payload, {merge:true}) is verified without needing a live
 * Firebase project, going a step further than this project's earlier
 * documented precedent of leaving a src/data/*.js module's real Firestore
 * round-trip untested (see tests/item-completions-repository.unit.mjs's
 * own header comment) — that precedent predates this session's later
 * module-mocking technique, which removes the actual reason for that
 * limitation here.
 *
 * REQUIRES Node's experimental module-mocking support for the
 * saveGoogleCalendarRouting tests. Run with:
 *   node --experimental-test-module-mocks tests/calendar-routing-persistence.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";
import { normalizeGoogleCalendarRouting, buildGoogleCalendarRoutingSave } from "../src/data/googleCalendarRouting.js";

// ============ normalizeGoogleCalendarRouting ============
test("normalize: absent profile routing (null) normalizes safely to defaults", () => {
  const result = normalizeGoogleCalendarRouting(null);
  assert.deepStrictEqual(result, { defaultCalendarId: null, childCalendarIds: {} });
});

test("normalize: undefined normalizes safely to defaults", () => {
  const result = normalizeGoogleCalendarRouting(undefined);
  assert.deepStrictEqual(result, { defaultCalendarId: null, childCalendarIds: {} });
});

test("normalize: a well-formed existing routing config round-trips unchanged", () => {
  const raw = { defaultCalendarId: "family@group.calendar.google.com", childCalendarIds: { "hayden-id": "hayden@group.calendar.google.com" } };
  assert.deepStrictEqual(normalizeGoogleCalendarRouting(raw), raw);
});

test("normalize: a malformed defaultCalendarId (non-string) is dropped to null", () => {
  const result = normalizeGoogleCalendarRouting({ defaultCalendarId: 12345, childCalendarIds: {} });
  assert.strictEqual(result.defaultCalendarId, null);
});

test("normalize: an empty-string defaultCalendarId is treated as null, not a real id", () => {
  const result = normalizeGoogleCalendarRouting({ defaultCalendarId: "", childCalendarIds: {} });
  assert.strictEqual(result.defaultCalendarId, null);
});

test("normalize: a malformed childCalendarIds entry (non-string value) is dropped, others kept", () => {
  const result = normalizeGoogleCalendarRouting({ defaultCalendarId: null, childCalendarIds: { "hayden-id": "hayden@group.calendar.google.com", "payton-id": 999 } });
  assert.deepStrictEqual(result.childCalendarIds, { "hayden-id": "hayden@group.calendar.google.com" });
});

test("normalize: childCalendarIds that isn't an object at all normalizes to {}", () => {
  const result = normalizeGoogleCalendarRouting({ defaultCalendarId: null, childCalendarIds: "not-an-object" });
  assert.deepStrictEqual(result.childCalendarIds, {});
});

// ============ buildGoogleCalendarRoutingSave ============
const AVAILABLE = ["primary", "family@group.calendar.google.com", "hayden@group.calendar.google.com", "payton@group.calendar.google.com"];
const CURRENT_CHILDREN = ["hayden-id", "payton-id"];

test("save: stores the actual selected calendar IDs verbatim", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: "family@group.calendar.google.com",
    childCalendarIds: { "hayden-id": "hayden@group.calendar.google.com" },
    currentChildIds: CURRENT_CHILDREN,
    availableCalendarIds: AVAILABLE,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.routing.defaultCalendarId, "family@group.calendar.google.com");
  assert.strictEqual(result.routing.childCalendarIds["hayden-id"], "hayden@group.calendar.google.com");
});

test("save: keys learner mappings by canonical child id, not display name", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: null,
    childCalendarIds: { "hayden-id": "hayden@group.calendar.google.com", "payton-id": "payton@group.calendar.google.com" },
    currentChildIds: CURRENT_CHILDREN,
    availableCalendarIds: AVAILABLE,
  });
  assert.deepStrictEqual(Object.keys(result.routing.childCalendarIds).sort(), ["hayden-id", "payton-id"]);
});

test("IDENTITY SAFETY: renaming a child (same id, new display name) never invalidates their existing calendar mapping — currentChildIds is id-only and never carries/compares a name", () => {
  // Simulates the Settings > Children rename flow: the child's canonical id
  // ("hayden-id") is unchanged, only their displayed name would have
  // changed elsewhere (in the separate `children` array, which this
  // function never even receives) — currentChildIds here is deliberately
  // just the bare id list a rename never touches.
  const existingMapping = { "hayden-id": "hayden@group.calendar.google.com" };
  const beforeRename = buildGoogleCalendarRoutingSave({
    defaultCalendarId: null,
    childCalendarIds: existingMapping,
    currentChildIds: ["hayden-id", "payton-id"], // e.g. child.name was "Hayden"
    availableCalendarIds: AVAILABLE,
  });
  const afterRename = buildGoogleCalendarRoutingSave({
    defaultCalendarId: null,
    childCalendarIds: existingMapping,
    currentChildIds: ["hayden-id", "payton-id"], // same ids — a rename never changes this list
    availableCalendarIds: AVAILABLE,
  });
  assert.deepStrictEqual(beforeRename.routing.childCalendarIds, afterRename.routing.childCalendarIds);
  assert.strictEqual(afterRename.routing.childCalendarIds["hayden-id"], "hayden@group.calendar.google.com");
});

test("save: a stale mapping for a learner who no longer exists is dropped, not an error", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: null,
    childCalendarIds: { "hayden-id": "hayden@group.calendar.google.com", "removed-child-id": "some-cal@group.calendar.google.com" },
    currentChildIds: ["hayden-id"], // removed-child-id no longer exists
    availableCalendarIds: AVAILABLE,
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.routing.childCalendarIds, { "hayden-id": "hayden@group.calendar.google.com" });
});

test("save: a blank/null selection for a current child removes the mapping (uses fallback), not an error", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: null,
    childCalendarIds: { "hayden-id": null, "payton-id": "payton@group.calendar.google.com" },
    currentChildIds: CURRENT_CHILDREN,
    availableCalendarIds: AVAILABLE,
  });
  assert.strictEqual(result.ok, true);
  assert.ok(!("hayden-id" in result.routing.childCalendarIds));
  assert.strictEqual(result.routing.childCalendarIds["payton-id"], "payton@group.calendar.google.com");
});

test("save: a blank defaultCalendarId (null) is accepted, means fallback, never an error", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: null,
    childCalendarIds: {},
    currentChildIds: CURRENT_CHILDREN,
    availableCalendarIds: AVAILABLE,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.routing.defaultCalendarId, null);
});

test("save: an invalid/non-listed defaultCalendarId is rejected before save", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: "stale-deleted-calendar@group.calendar.google.com",
    childCalendarIds: {},
    currentChildIds: CURRENT_CHILDREN,
    availableCalendarIds: AVAILABLE,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

test("save: an invalid/non-listed child calendarId is rejected before save (fails safe, nothing partially persisted)", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: null,
    childCalendarIds: { "hayden-id": "no-longer-writable@group.calendar.google.com" },
    currentChildIds: CURRENT_CHILDREN,
    availableCalendarIds: AVAILABLE,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

test("save: the literal string \"primary\" IS an acceptable explicit selection when it's actually in the available list (Google's own primary entry)", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: "primary",
    childCalendarIds: {},
    currentChildIds: CURRENT_CHILDREN,
    availableCalendarIds: AVAILABLE,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.routing.defaultCalendarId, "primary");
});

test("save: an unknown child key that was never in currentChildIds at all is silently dropped (never persisted)", () => {
  const result = buildGoogleCalendarRoutingSave({
    defaultCalendarId: null,
    childCalendarIds: { "never-existed-id": "hayden@group.calendar.google.com" },
    currentChildIds: CURRENT_CHILDREN,
    availableCalendarIds: AVAILABLE,
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.routing.childCalendarIds, {});
});

// ============ saveGoogleCalendarRouting (module-mocked Firestore write) ============
test("saveGoogleCalendarRouting: writes to users/{uid} with {merge:true}, only the googleCalendarRouting field", async (t) => {
  const calls = [];
  t.mock.module("../src/Firebase.js", {
    namedExports: { db: { __mockDb: true }, auth: {}, googleProvider: {} },
  });
  t.mock.module("firebase/firestore", {
    namedExports: {
      doc: (db, ...pathSegments) => ({ __mockRef: true, db, path: pathSegments.join("/") }),
      setDoc: async (ref, data, opts) => { calls.push({ ref, data, opts }); },
    },
  });
  const { saveGoogleCalendarRouting } = await import(`../src/data/googleCalendarRouting.js?t=1`);

  const routing = { defaultCalendarId: "family@group.calendar.google.com", childCalendarIds: { "hayden-id": "hayden@group.calendar.google.com" } };
  await saveGoogleCalendarRouting("parent-uid-1", routing);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].ref.path, "users/parent-uid-1", "must write to the SAME users/{uid} document as familyLastName/timezone, not a new collection");
  assert.deepStrictEqual(calls[0].data, { googleCalendarRouting: routing }, "must write ONLY the googleCalendarRouting field — {merge:true} is what actually preserves every other profile field, not this module filtering keys itself");
  assert.strictEqual(calls[0].opts.merge, true, "must use merge:true, exactly like saveTimezone/saveFamilyName, so unrelated profile fields (children, timezone, familyLastName) are preserved");
});

test("saveGoogleCalendarRouting: propagates a Firestore write failure rather than swallowing it", async (t) => {
  t.mock.module("../src/Firebase.js", {
    namedExports: { db: {}, auth: {}, googleProvider: {} },
  });
  t.mock.module("firebase/firestore", {
    namedExports: {
      doc: () => ({}),
      setDoc: async () => { throw new Error("simulated Firestore failure"); },
    },
  });
  const { saveGoogleCalendarRouting } = await import(`../src/data/googleCalendarRouting.js?t=2`);

  await assert.rejects(() => saveGoogleCalendarRouting("parent-uid-1", { defaultCalendarId: null, childCalendarIds: {} }), /simulated Firestore failure/);
});
