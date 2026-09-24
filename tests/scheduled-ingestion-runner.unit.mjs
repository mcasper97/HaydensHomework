/**
 * Focused unit tests for api/_scheduledIngestionRunner.js — the server-side
 * daily scheduler FRAMEWORK (household discovery, due-detection, overlap
 * locking, per-household failure isolation, run-status recording) invoked
 * by api/cron-email-ingestion.js on each Vercel Cron tick.
 *
 * runDueHouseholds({ now, deps }) takes its four collaborators
 * (listHouseholds/tryAcquireLock/releaseLock/runIngestion) as fully
 * injectable deps, so most of these tests never touch real Firestore/
 * Admin SDK — no module mocking needed for those (contrast with
 * tests/scheduled-ingestion-adapter.unit.mjs, which mocks firebase-admin
 * because its functions call Firestore directly). One test — proving the
 * DEFAULT runIngestion collaborator is now the real Gmail ingestion seam
 * (api/_gmailIngestionRunner.js), not the old placeholder — mocks that one
 * module instead of overriding `deps.runIngestion`, so it needs
 * `--experimental-test-module-mocks` for the whole file:
 *
 *   node --experimental-test-module-mocks --test tests/scheduled-ingestion-runner.unit.mjs
 *
 * api/_auth.js's Admin-app-init side effect is safe to import even with no
 * credentials configured — it defers any init error rather than throwing
 * at import time (see api/_auth.js).
 */
import { test } from "node:test";
import assert from "node:assert";
import { runDueHouseholds, RUN_STATUS } from "../api/_scheduledIngestionRunner.js";
import { normalizeEmailIngestionSchedule } from "../src/data/emailIngestionSchedule.js";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

const FIXED_NOW = new Date("2026-01-15T15:30:00Z"); // 15:30 UTC

function household(uid, scheduleOverrides = {}, timezone = "UTC") {
  return {
    uid,
    schedule: normalizeEmailIngestionSchedule({ enabled: true, localTime: "08:00", ...scheduleOverrides }),
    timezone,
  };
}

function makeDeps(households, overrides = {}) {
  const calls = { tryAcquireLock: [], releaseLock: [], runIngestion: [] };
  const deps = {
    listHouseholds: async () => households,
    tryAcquireLock: async (uid) => { calls.tryAcquireLock.push(uid); return true; },
    releaseLock: async (uid, patch) => { calls.releaseLock.push({ uid, patch }); },
    runIngestion: async (uid) => { calls.runIngestion.push(uid); return { ok: true }; },
    ...overrides,
  };
  return { deps, calls };
}

// ============ Disabled household is skipped ============
test("a disabled household is skipped and never locked/run", async () => {
  const households = [household("h1", { enabled: false })];
  const { deps, calls } = makeDeps(households);

  const summary = await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.strictEqual(summary.checked, 1);
  assert.strictEqual(summary.results[0].ran, false);
  assert.strictEqual(summary.results[0].reason, "disabled");
  assert.strictEqual(calls.tryAcquireLock.length, 0);
  assert.strictEqual(calls.runIngestion.length, 0);
});

// ============ Missing schedule is skipped ============
test("a household with no configured localTime (missing schedule) is skipped", async () => {
  const households = [household("h1", { enabled: true, localTime: null })];
  const { deps, calls } = makeDeps(households);

  const summary = await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.strictEqual(summary.results[0].ran, false);
  assert.strictEqual(summary.results[0].reason, "no_schedule");
  assert.strictEqual(calls.runIngestion.length, 0);
});

// ============ Not yet due is skipped ============
test("a household whose configured local run time hasn't arrived yet is skipped", async () => {
  // FIXED_NOW is 15:30 UTC; a household configured for 20:00 UTC hasn't hit it yet.
  const households = [household("h1", { enabled: true, localTime: "20:00" }, "UTC")];
  const { deps, calls } = makeDeps(households);

  const summary = await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.strictEqual(summary.results[0].ran, false);
  assert.strictEqual(summary.results[0].reason, "not_yet_time");
  assert.strictEqual(calls.runIngestion.length, 0);
});

// ============ Due household runs ============
test("a due household is locked, run via the injected ingestion seam, and the lock released with success status", async () => {
  const households = [household("h1", { enabled: true, localTime: "08:00" }, "UTC")];
  const { deps, calls } = makeDeps(households);

  const summary = await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.strictEqual(summary.results[0].ran, true);
  assert.strictEqual(summary.results[0].status, RUN_STATUS.SUCCESS);
  assert.deepStrictEqual(calls.tryAcquireLock, ["h1"]);
  assert.deepStrictEqual(calls.runIngestion, ["h1"]);
  assert.strictEqual(calls.releaseLock.length, 1);
  assert.strictEqual(calls.releaseLock[0].uid, "h1");
  assert.strictEqual(calls.releaseLock[0].patch.status, RUN_STATUS.SUCCESS);
  // Household-local today (UTC, FIXED_NOW = 2026-01-15T15:30:00Z) is consumed on success.
  assert.strictEqual(calls.releaseLock[0].patch.lastRunLocalDate, "2026-01-15");
});

// ============ Same household-local day does not run twice ============
test("a household that already ran today (same household-local date) is not run again", async () => {
  const households = [household("h1", { enabled: true, localTime: "08:00", lastRunLocalDate: "2026-01-15" }, "UTC")];
  const { deps, calls } = makeDeps(households);

  const summary = await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.strictEqual(summary.results[0].ran, false);
  assert.strictEqual(summary.results[0].reason, "already_ran_today");
  assert.strictEqual(calls.runIngestion.length, 0);
});

// ============ Household timezone affects due calculation ============
test("household timezone affects whether the same real-world instant is due", async () => {
  // FIXED_NOW = 2026-01-15T15:30:00Z.
  // UTC local time = 15:30 -> past an 08:00 localTime -> due.
  // America/Los_Angeles (UTC-8 in January) local time = 07:30 -> before 08:00 -> not yet time.
  const households = [
    household("utc-household", { enabled: true, localTime: "08:00" }, "UTC"),
    household("la-household", { enabled: true, localTime: "08:00" }, "America/Los_Angeles"),
  ];
  const { deps } = makeDeps(households);

  const summary = await runDueHouseholds({ now: FIXED_NOW, deps });

  const utcResult = summary.results.find((r) => r.uid === "utc-household");
  const laResult = summary.results.find((r) => r.uid === "la-household");
  assert.strictEqual(utcResult.ran, true);
  assert.strictEqual(laResult.ran, false);
  assert.strictEqual(laResult.reason, "not_yet_time");
});

// ============ Overlapping run is prevented ============
test("a household whose lock is already held (overlapping run) is skipped without invoking ingestion", async () => {
  const households = [household("h1", { enabled: true, localTime: "08:00" }, "UTC")];
  const { deps, calls } = makeDeps(households, { tryAcquireLock: async () => false });

  const summary = await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.strictEqual(summary.results[0].ran, false);
  assert.strictEqual(summary.results[0].reason, "already_running");
  assert.strictEqual(calls.runIngestion.length, 0);
  assert.strictEqual(calls.releaseLock.length, 0, "a lock that was never acquired is never released");
});

// ============ One household failure does not prevent another ============
test("one household's ingestion throwing does not prevent the next household from being evaluated and run", async () => {
  const households = [
    household("failing-household", { enabled: true, localTime: "08:00" }, "UTC"),
    household("ok-household", { enabled: true, localTime: "08:00" }, "UTC"),
  ];
  const trackedCalls = [];
  const { deps } = makeDeps(households, {
    runIngestion: async (uid) => {
      trackedCalls.push(uid);
      if (uid === "failing-household") throw new Error("boom");
      return { ok: true };
    },
  });

  const summary = await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.deepStrictEqual(trackedCalls.sort(), ["failing-household", "ok-household"]);
  const failingResult = summary.results.find((r) => r.uid === "failing-household");
  const okResult = summary.results.find((r) => r.uid === "ok-household");
  assert.strictEqual(failingResult.ran, true);
  assert.strictEqual(failingResult.status, RUN_STATUS.FAILED);
  assert.strictEqual(okResult.ran, true);
  assert.strictEqual(okResult.status, RUN_STATUS.SUCCESS);
});

// ============ Failed run releases the lock and stays retry-eligible ============
test("a failed household run releases the lock and omits lastRunLocalDate so it stays retry-eligible today", async () => {
  const households = [household("h1", { enabled: true, localTime: "08:00" }, "UTC")];
  const { deps, calls } = makeDeps(households, {
    runIngestion: async () => ({ ok: false, code: "SOME_FAILURE" }),
  });

  await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.strictEqual(calls.releaseLock.length, 1);
  assert.strictEqual(calls.releaseLock[0].patch.status, RUN_STATUS.FAILED);
  assert.strictEqual(
    "lastRunLocalDate" in calls.releaseLock[0].patch,
    false,
    "a failed run must not consume today's run slot"
  );
});

// ============ Scheduler invokes the shared server ingestion entry point, not business logic ============
test("runDueHouseholds invokes the injected ingestion seam (not any extraction/confidence/commit logic itself)", async () => {
  const households = [household("h1", { enabled: true, localTime: "08:00" }, "UTC")];
  let received;
  const { deps } = makeDeps(households, {
    runIngestion: async (uid) => { received = uid; return { ok: true }; },
  });

  await runDueHouseholds({ now: FIXED_NOW, deps });

  assert.strictEqual(received, "h1", "runIngestion was called with just the uid — the scheduler passes through to the seam rather than doing business logic itself");
});

test("the DEFAULT runIngestion collaborator is the real Gmail ingestion seam (api/_gmailIngestionRunner.js), not a placeholder", async (t) => {
  const seamCalls = [];
  t.mock.module("../api/_gmailIngestionRunner.js", {
    namedExports: {
      runHouseholdEmailIngestion: async (uid) => {
        seamCalls.push(uid);
        return { ok: true, messagesScanned: 0, messagesProcessed: 0, messagesSkipped: 0, candidatesCreated: 0, itemsCommitted: 0, reviewRequired: 0, errors: [] };
      },
    },
  });
  const { runDueHouseholds: freshRunDueHouseholds } = await freshImport("../api/_scheduledIngestionRunner.js");

  const households = [household("h1", { enabled: true, localTime: "08:00" }, "UTC")];
  // Deliberately do NOT override runIngestion — exercise the real default
  // wiring, proving runDueHouseholds now calls into
  // api/_gmailIngestionRunner.js's real seam rather than the old
  // GMAIL_INGESTION_SEAM_MISSING placeholder.
  const { deps } = makeDeps(households);
  delete deps.runIngestion;

  const summary = await freshRunDueHouseholds({ now: FIXED_NOW, deps });

  assert.deepStrictEqual(seamCalls, ["h1"], "the default runIngestion collaborator invoked the real Gmail ingestion seam with just the uid");
  assert.strictEqual(summary.results[0].status, RUN_STATUS.SUCCESS);
});

console.log("scheduled-ingestion-runner.unit.mjs: all tests defined (node:test reports results below)");
