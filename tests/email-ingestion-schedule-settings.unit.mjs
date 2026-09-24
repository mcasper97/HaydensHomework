/**
 * Focused unit tests for the Settings UI slice of scheduled Gmail
 * ingestion — src/data/emailIngestionScheduleRepository.js (client read/
 * write + the pure gate/formatting helpers the Settings component uses).
 *
 * This repo has no React-rendering test harness (no testing-library/
 * jsdom — every *.unit.mjs file here tests underlying pure/data logic
 * directly, real rendering is covered by Playwright, explicitly out of
 * scope for this task). So "toggle can be enabled when Gmail+timezone
 * configured" / "Gmail disconnected prevents enable" / "missing timezone
 * prevents enable" / "last run/status display renders when present" are
 * tested against the pure decision/formatting functions
 * AutomaticEmailCheckingSection.jsx actually calls
 * (canEnableAutomaticEmailChecking / formatLastRunInfo), not by rendering
 * the component.
 *
 * getEmailIngestionScheduleSetting/saveEmailIngestionScheduleSetting are
 * module-mocked (firebase/firestore's doc/getDoc/updateDoc/setDoc, and
 * ../src/Firebase.js's db) exactly like tests/calendar-routing-persistence.unit.mjs
 * already does for the same kind of client repository, so the exact write
 * shape AND the exact SDK function used (updateDoc, not setDoc) are both
 * verified without needing a live Firebase project.
 *
 * WHY updateDoc() specifically: verified directly against the installed
 * Web SDK's source (firebase 12.9.0 — see
 * src/data/emailIngestionScheduleRepository.js's own doc comment for the
 * full trace) that setDoc(...,{merge:true}) does NOT parse a dotted
 * object key ("emailIngestionSchedule.enabled") as a nested field path —
 * it writes a literal top-level field with a dot IN its name. Only
 * updateDoc() (or an update()-style call) parses dot-separated keys as
 * real nested paths. mockFirestore's `setDocCalls` below exists
 * specifically so a test can assert setDoc is NEVER called — a mock-only
 * assertion would not have caught the original bug (a mock that just
 * records whatever shape it's given can't tell you the real SDK would
 * have silently done something different with that same shape); the
 * fix here is chosen from reading the actual installed SDK's parsing
 * code, not from what the mock happens to accept.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/email-ingestion-schedule-settings.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";
import {
  canEnableAutomaticEmailChecking,
  formatLastRunInfo,
  resolveInitialLocalTime,
  DEFAULT_DISPLAY_LOCAL_TIME,
} from "../src/data/emailIngestionScheduleRepository.js";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function mockFirestore(t, { docData } = {}) {
  const updateCalls = [];
  // setDocCalls is tracked (never populated by a correct implementation)
  // purely so a test can assert setDoc was NEVER invoked — see the module
  // doc comment above for why that specifically matters here.
  const setDocCalls = [];
  t.mock.module("../src/Firebase.js", {
    namedExports: { db: { __mockDb: true }, auth: {}, googleProvider: {} },
  });
  t.mock.module("firebase/firestore", {
    namedExports: {
      doc: (db, ...pathSegments) => ({ __mockRef: true, db, path: pathSegments.join("/") }),
      getDoc: async (ref) => ({
        exists: () => docData !== undefined,
        data: () => docData,
      }),
      updateDoc: async (ref, data) => { updateCalls.push({ ref, data }); },
      setDoc: async (ref, data, opts) => { setDocCalls.push({ ref, data, opts }); },
    },
  });
  return { updateCalls, setDocCalls };
}

// ============ Schedule defaults OFF when missing ============
test("getEmailIngestionScheduleSetting: a household with no emailIngestionSchedule field at all defaults to disabled", async (t) => {
  mockFirestore(t, { docData: { familyLastName: "Smith" } }); // real doc, but no emailIngestionSchedule key
  const { getEmailIngestionScheduleSetting } = await freshImport("../src/data/emailIngestionScheduleRepository.js");

  const result = await getEmailIngestionScheduleSetting({ uid: "parent-1", isAdmin: false });

  assert.strictEqual(result.enabled, false);
  assert.strictEqual(result.localTime, null);
});

test("getEmailIngestionScheduleSetting: a household document that doesn't exist yet also defaults to disabled", async (t) => {
  mockFirestore(t, { docData: undefined });
  const { getEmailIngestionScheduleSetting } = await freshImport("../src/data/emailIngestionScheduleRepository.js");

  const result = await getEmailIngestionScheduleSetting({ uid: "parent-1", isAdmin: false });
  assert.strictEqual(result.enabled, false);
});

test("getEmailIngestionScheduleSetting: guest/admin mode defaults to disabled without any Firestore read", async () => {
  // Deliberately NOT module-mocked — src/Firebase.js's own real init is
  // wrapped in try/catch and never throws outside a browser (same
  // established precedent as tests/google-calendar-auto-publish.unit.mjs);
  // ctx.isAdmin short-circuits before this repository ever touches db.
  const { getEmailIngestionScheduleSetting } = await import("../src/data/emailIngestionScheduleRepository.js");
  const result = await getEmailIngestionScheduleSetting({ uid: "guest-local", isAdmin: true });
  assert.strictEqual(result.enabled, false);
});

// ============ Toggle can be enabled when Gmail + timezone are configured ============
test("canEnableAutomaticEmailChecking: allows enabling when Gmail is connected and a timezone is set", () => {
  const result = canEnableAutomaticEmailChecking({ gmailConnected: true, timezone: "America/New_York" });
  assert.strictEqual(result.ok, true);
});

// ============ Gmail disconnected prevents enable ============
test("canEnableAutomaticEmailChecking: refuses to enable when Gmail is not connected", () => {
  const result = canEnableAutomaticEmailChecking({ gmailConnected: false, timezone: "America/New_York" });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "gmail_not_connected");
});

// ============ Missing timezone prevents enable ============
test("canEnableAutomaticEmailChecking: refuses to enable when no household timezone is configured", () => {
  const result = canEnableAutomaticEmailChecking({ gmailConnected: true, timezone: null });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "no_timezone");
});

test("canEnableAutomaticEmailChecking: Gmail disconnected is checked before timezone (either failure alone is sufficient to block)", () => {
  const result = canEnableAutomaticEmailChecking({ gmailConnected: false, timezone: null });
  assert.strictEqual(result.ok, false);
});

// ============ localTime saves in HH:MM format ============
test("saveEmailIngestionScheduleSetting: uses updateDoc (not setDoc) with dot-notation, localTime kept exactly as HH:MM", async (t) => {
  const { updateCalls, setDocCalls } = mockFirestore(t, { docData: {} });
  const { saveEmailIngestionScheduleSetting } = await freshImport("../src/data/emailIngestionScheduleRepository.js");

  await saveEmailIngestionScheduleSetting({ uid: "parent-1", isAdmin: false }, { enabled: true, localTime: "07:30" });

  assert.strictEqual(updateCalls.length, 1, "must call updateDoc exactly once");
  assert.strictEqual(setDocCalls.length, 0, "must NEVER call setDoc — setDoc(...,{merge:true}) does not parse a dotted key as a nested path (verified against the installed SDK source)");
  assert.strictEqual(updateCalls[0].ref.path, "users/parent-1");
  assert.strictEqual(updateCalls[0].data["emailIngestionSchedule.enabled"], true);
  assert.strictEqual(updateCalls[0].data["emailIngestionSchedule.localTime"], "07:30");
});

test("saveEmailIngestionScheduleSetting: rejects enabling with no resolvable time rather than silently persisting it", async (t) => {
  mockFirestore(t, { docData: {} });
  const { saveEmailIngestionScheduleSetting } = await freshImport("../src/data/emailIngestionScheduleRepository.js");

  await assert.rejects(() => saveEmailIngestionScheduleSetting({ uid: "parent-1", isAdmin: false }, { enabled: true, localTime: "not-a-time" }));
});

// ============ Disabling preserves configured time ============
test("saveEmailIngestionScheduleSetting: turning the schedule OFF still saves the previously-chosen time, not null", async (t) => {
  const { updateCalls } = mockFirestore(t, { docData: {} });
  const { saveEmailIngestionScheduleSetting } = await freshImport("../src/data/emailIngestionScheduleRepository.js");

  await saveEmailIngestionScheduleSetting({ uid: "parent-1", isAdmin: false }, { enabled: false, localTime: "07:30" });

  assert.strictEqual(updateCalls[0].data["emailIngestionSchedule.enabled"], false);
  assert.strictEqual(updateCalls[0].data["emailIngestionSchedule.localTime"], "07:30", "disabling must not erase the configured time — re-enabling later should remember it");
});

// ============ Saving preserves server-owned schedule fields ============
test("saveEmailIngestionScheduleSetting: the write payload contains ONLY enabled/localTime — never lastRunLocalDate/lastRunAt/lastRunStatus/runLock", async (t) => {
  const { updateCalls } = mockFirestore(t, { docData: {} });
  const { saveEmailIngestionScheduleSetting } = await freshImport("../src/data/emailIngestionScheduleRepository.js");

  await saveEmailIngestionScheduleSetting({ uid: "parent-1", isAdmin: false }, { enabled: true, localTime: "20:00" });

  assert.deepStrictEqual(
    Object.keys(updateCalls[0].data).sort(),
    ["emailIngestionSchedule.enabled", "emailIngestionSchedule.localTime"],
    "dot-notation updateDoc write must touch exactly these two leaf fields — structurally impossible to also write lastRunLocalDate/lastRunAt/lastRunStatus/runLock"
  );
  // And explicitly, none of the server-owned field NAMES appear anywhere
  // in the written keys, even as a substring of a different path.
  const writtenKeys = Object.keys(updateCalls[0].data).join(" ");
  for (const serverOwned of ["lastRunLocalDate", "lastRunAt", "lastRunStatus", "runLock"]) {
    assert.ok(!writtenKeys.includes(serverOwned), `must never write ${serverOwned}`);
  }
});

test("saveEmailIngestionScheduleSetting: guest/admin mode never attempts a Firestore write", async (t) => {
  const { updateCalls, setDocCalls } = mockFirestore(t, { docData: {} });
  const { saveEmailIngestionScheduleSetting } = await freshImport("../src/data/emailIngestionScheduleRepository.js");

  await saveEmailIngestionScheduleSetting({ uid: "guest-local", isAdmin: true }, { enabled: true, localTime: "20:00" });

  assert.strictEqual(updateCalls.length, 0);
  assert.strictEqual(setDocCalls.length, 0);
});

// ============ updateDoc requirement: document must already exist ============
test("saveEmailIngestionScheduleSetting: a Firestore write failure (e.g. document doesn't exist) propagates rather than being swallowed", async (t) => {
  t.mock.module("../src/Firebase.js", {
    namedExports: { db: { __mockDb: true }, auth: {}, googleProvider: {} },
  });
  t.mock.module("firebase/firestore", {
    namedExports: {
      doc: () => ({ __mockRef: true }),
      getDoc: async () => ({ exists: () => false, data: () => undefined }),
      updateDoc: async () => { const err = new Error("No document to update"); err.code = "not-found"; throw err; },
      setDoc: async () => { throw new Error("setDoc should never be called"); },
    },
  });
  const { saveEmailIngestionScheduleSetting } = await freshImport("../src/data/emailIngestionScheduleRepository.js");

  await assert.rejects(
    () => saveEmailIngestionScheduleSetting({ uid: "parent-1", isAdmin: false }, { enabled: true, localTime: "20:00" }),
    /No document to update/
  );
});

// ============ Last run/status display renders when present ============
test("formatLastRunInfo: returns null when the household has never run (nothing to show)", () => {
  const result = formatLastRunInfo({ enabled: false, localTime: null, lastRunAt: null, lastRunStatus: null });
  assert.strictEqual(result, null);
});

test("formatLastRunInfo: returns display text for both lastRunAt and lastRunStatus when present", () => {
  const result = formatLastRunInfo({ lastRunAt: "2026-01-15T13:00:00.000Z", lastRunStatus: "success" });
  assert.ok(result);
  assert.ok(result.lastRunAtText && result.lastRunAtText.length > 0);
  assert.strictEqual(result.lastRunStatusText, "Success");
});

test("formatLastRunInfo: renders even when only lastRunStatus is present (no lastRunAt yet)", () => {
  const result = formatLastRunInfo({ lastRunAt: null, lastRunStatus: "failed" });
  assert.ok(result);
  assert.strictEqual(result.lastRunAtText, null);
  assert.strictEqual(result.lastRunStatusText, "Failed");
});

// ============ resolveInitialLocalTime (component's picker starting value) ============
test("resolveInitialLocalTime: falls back to the display default (20:00) when no time is configured yet", () => {
  assert.strictEqual(resolveInitialLocalTime({ localTime: null }), DEFAULT_DISPLAY_LOCAL_TIME);
  assert.strictEqual(DEFAULT_DISPLAY_LOCAL_TIME, "20:00");
});

test("resolveInitialLocalTime: uses the household's already-configured time when one exists", () => {
  assert.strictEqual(resolveInitialLocalTime({ localTime: "06:45" }), "06:45");
});

console.log("email-ingestion-schedule-settings.unit.mjs: all tests defined (node:test reports results below)");
