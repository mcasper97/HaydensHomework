/**
 * Focused unit tests for api/email-ingestion-run-now.js — the parent-
 * authenticated "Run automatic check now" endpoint (observability/
 * manual-validation follow-up). Imports and CALLS the real, unmodified
 * handler (never a reimplemented/mirrored copy), mirroring
 * tests/calendar-publish-endpoint.unit.mjs's established mocking strategy:
 * mock every dependency module the handler's own import graph touches
 * (including api/_scheduledIngestionRunner.js's real, unmocked
 * executeHouseholdIngestionRun, which itself imports the mocked
 * api/_householdProfileStore.js/api/_gmailIngestionRunner.js — proving
 * this endpoint reuses the SAME lease-protected execution path the daily
 * cron uses, not a second copy of it).
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/email-ingestion-run-now-endpoint.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

function fakeReqRes(body = {}) {
  const req = { method: "POST", headers: { authorization: "Bearer fake-token" }, body };
  const state = { statusCode: null, body: null };
  const res = {
    status(code) { state.statusCode = code; return this; },
    json(payload) { state.body = payload; return this; },
  };
  return { req, res, state };
}

/**
 * Mocks every dependency api/email-ingestion-run-now.js imports.
 * `authenticated`/`uid` control requireFirebaseUser's resolved identity —
 * this is the ONLY source of `uid` the handler ever sees (see the test
 * below that proves a client-supplied uid in the request body is
 * ignored). `tryAcquire`/`runResult` let a test simulate overlap
 * protection or a failed/successful ingestion run.
 */
function setupMocks(t, {
  authenticated = true,
  uid = "parent-uid-1",
  timezone = "America/New_York",
  tryAcquire = async () => true,
  runResult = { ok: true, messagesScanned: 0 },
} = {}) {
  const calls = { requireFirebaseUser: 0, tryAcquireEmailIngestionLock: [], releaseEmailIngestionLock: [], runHouseholdEmailIngestion: [] };

  t.mock.module("../api/_auth.js", {
    namedExports: {
      requireFirebaseUser: async () => {
        calls.requireFirebaseUser += 1;
        if (!authenticated) throw new Error("no valid token");
        return { uid };
      },
      checkRateLimit: () => true,
    },
  });
  t.mock.module("../api/_householdProfileStore.js", {
    namedExports: {
      getHouseholdTimezone: async () => timezone,
      tryAcquireEmailIngestionLock: async (u) => { calls.tryAcquireEmailIngestionLock.push(u); return tryAcquire(u); },
      releaseEmailIngestionLock: async (u, patch) => { calls.releaseEmailIngestionLock.push({ uid: u, patch }); },
      // Unused by this endpoint itself, but api/_scheduledIngestionRunner.js
      // (executeHouseholdIngestionRun's real, unmocked home) statically
      // imports it from this same module — ES module linking is static, so
      // every name any importer in the graph needs must exist on the mock.
      listHouseholdsWithEmailIngestionEnabled: async () => [],
    },
  });
  t.mock.module("../api/_gmailIngestionRunner.js", {
    namedExports: {
      runHouseholdEmailIngestion: async (u) => { calls.runHouseholdEmailIngestion.push(u); return runResult; },
    },
  });

  return calls;
}

// ============ Run Now requires authentication ============
test("returns 401 when the request is not authenticated, and never touches the ingestion path", async (t) => {
  const calls = setupMocks(t, { authenticated: false });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 401);
  assert.strictEqual(calls.tryAcquireEmailIngestionLock.length, 0);
  assert.strictEqual(calls.runHouseholdEmailIngestion.length, 0);
});

test("rejects non-POST requests", async (t) => {
  setupMocks(t);
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res, state } = fakeReqRes();
  req.method = "GET";
  await handler(req, res);

  assert.strictEqual(state.statusCode, 405);
});

// ============ User can only trigger their own household ============
test("derives uid ONLY from the verified token — a client-supplied uid in the request body is completely ignored", async (t) => {
  const calls = setupMocks(t, { uid: "real-authenticated-uid" });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  // An attempted spoof: the request body claims a DIFFERENT household.
  const { req, res } = fakeReqRes({ uid: "someone-elses-household-uid" });
  await handler(req, res);

  assert.deepStrictEqual(calls.tryAcquireEmailIngestionLock, ["real-authenticated-uid"]);
  assert.deepStrictEqual(calls.runHouseholdEmailIngestion, ["real-authenticated-uid"]);
});

// ============ Run Now calls runHouseholdEmailIngestion (the same server-side path) ============
test("invokes runHouseholdEmailIngestion for the authenticated household via the shared executeHouseholdIngestionRun path", async (t) => {
  const calls = setupMocks(t, { uid: "parent-uid-7" });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.deepStrictEqual(calls.runHouseholdEmailIngestion, ["parent-uid-7"]);
  // The SAME lease pair the daily cron uses was exercised (acquire, then
  // release) — proving this went through executeHouseholdIngestionRun,
  // not a second/duplicated execution path.
  assert.deepStrictEqual(calls.tryAcquireEmailIngestionLock, ["parent-uid-7"]);
  assert.strictEqual(calls.releaseEmailIngestionLock.length, 1);
  // But a manual run releases with NO automatic-run bookkeeping payload —
  // status/lastRunAt/lastRunLocalDate are never persisted for a Run Now
  // (see the two dedicated tests below for why this matters).
  assert.deepStrictEqual(calls.releaseEmailIngestionLock[0].patch, {});
});

// ============ Manual success does not consume today's automatic-run slot ============
test("a successful manual run does not write lastRunLocalDate — it never consumes the same-day slot the daily cron's due-decision reads", async (t) => {
  const calls = setupMocks(t, { runResult: { ok: true, messagesScanned: 5 } });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.status, "success", "the manual run itself genuinely succeeded");
  const patch = calls.releaseEmailIngestionLock[0].patch;
  assert.ok(!("lastRunLocalDate" in patch), "lastRunLocalDate must never be written by a manual run, even on success");
  assert.ok(!("lastRunStatus" in patch) && !("status" in patch), "lastRunStatus must never be written by a manual run");
  assert.ok(!("lastRunAt" in patch), "lastRunAt must never be written by a manual run");
});

// ============ Persisted "Last automatic check" survives a manual Run Now unchanged ============
test("a successful manual run's release patch is empty — the persisted 'Last automatic check' display's source of truth is untouched", async (t) => {
  const calls = setupMocks(t, { runResult: { ok: true } });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res } = fakeReqRes();
  await handler(req, res);

  assert.deepStrictEqual(calls.releaseEmailIngestionLock[0].patch, {}, "a successful manual run's release patch must be empty — the daily cron's own persisted bookkeeping is untouched");
});

test("a failed manual run's release patch is also empty — a manual failure never overwrites the persisted 'Last automatic check' display either", async (t) => {
  const calls = setupMocks(t, { runResult: { ok: false, code: "SOME_FAILURE" } });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res } = fakeReqRes();
  await handler(req, res);

  assert.deepStrictEqual(calls.releaseEmailIngestionLock[0].patch, {}, "a failed manual run's release patch must also be empty");
});

// ============ Success updates visible status ============
test("success updates visible status", async (t) => {
  setupMocks(t, { runResult: { ok: true, messagesScanned: 2 } });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ok, true);
  assert.strictEqual(state.body.ran, true);
  assert.strictEqual(state.body.status, "success");
  assert.deepStrictEqual(state.body.outcome, { ok: true, messagesScanned: 2 });
});

// ============ Failure displays useful status ============
test("a failed ingestion outcome (e.g. Gmail auth failure) is reported as a normal failed status, not a 500", async (t) => {
  setupMocks(t, { runResult: { ok: false, code: "GMAIL_RECONNECT_REQUIRED", message: "Gmail needs to be reconnected." } });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ok, true, "the HTTP call itself succeeded — the FAILURE is in the run's own status");
  assert.strictEqual(state.body.status, "failed");
  assert.strictEqual(state.body.outcome.code, "GMAIL_RECONNECT_REQUIRED");
});

// ============ Overlap protection still applies to a manual run ============
test("a household whose lease is already held refuses the manual run without invoking ingestion", async (t) => {
  const calls = setupMocks(t, { tryAcquire: async () => false });
  const { default: handler } = await freshImport("../api/email-ingestion-run-now.js");

  const { req, res, state } = fakeReqRes();
  await handler(req, res);

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(state.body.ran, false);
  assert.strictEqual(state.body.reason, "already_running");
  assert.strictEqual(calls.runHouseholdEmailIngestion.length, 0);
});

// ============ CRON_SECRET is never exposed/used client-side ============
test("api/email-ingestion-run-now.js never references CRON_SECRET anywhere in its source", () => {
  const source = readFileSync(new URL("../api/email-ingestion-run-now.js", import.meta.url), "utf8");
  assert.ok(!source.includes("CRON_SECRET"), "this parent-authenticated endpoint must never read/require the Cron-only secret");
});

test("src/data/emailIngestionScheduleRepository.js (the client caller) never references CRON_SECRET anywhere in its source", () => {
  const source = readFileSync(new URL("../src/data/emailIngestionScheduleRepository.js", import.meta.url), "utf8");
  assert.ok(!source.includes("CRON_SECRET"));
});

test("src/settings/AutomaticEmailCheckingSection.jsx never references CRON_SECRET anywhere in its source", () => {
  const source = readFileSync(new URL("../src/settings/AutomaticEmailCheckingSection.jsx", import.meta.url), "utf8");
  assert.ok(!source.includes("CRON_SECRET"));
});

// ============ Manual run bypasses the daily due-decision entirely ============
test("api/email-ingestion-run-now.js never imports isHouseholdRunDue or reads emailIngestionSchedule directly — a manual run always attempts execution (subject only to the lease), even if today's automatic run already occurred", () => {
  const source = readFileSync(new URL("../api/email-ingestion-run-now.js", import.meta.url), "utf8");
  assert.ok(!source.includes("isHouseholdRunDue"));
  assert.ok(!source.includes("getEmailIngestionSchedule"));
});

console.log("email-ingestion-run-now-endpoint.unit.mjs: all tests defined (node:test reports results below)");
