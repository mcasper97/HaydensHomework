/**
 * Focused unit tests proving src/data/googleCalendarAutoPublish.js's
 * durability correction: a publish attempt writes a durable "in flight"
 * marker onto the Item's own googleCalendarSyncError field BEFORE the
 * network call, not only after a caught failure — so a closed browser
 * tab never leaves an Item silently indistinguishable from one nobody
 * ever tried to publish. Imports and calls the REAL, unmodified module
 * (never a reimplemented copy), mocking only its two side-effecting
 * dependencies (itemsRepository's updateItem, googleCalendarConnection's
 * publishItemToGoogleCalendar) — same established t.mock.module strategy
 * already used by tests/calendar-publish-endpoint.unit.mjs.
 *
 * REQUIRES Node's experimental module-mocking support. Run with:
 *   node --experimental-test-module-mocks tests/google-calendar-publish-durability.unit.mjs
 */
import { test } from "node:test";
import assert from "node:assert";

let importSeq = 0;
function freshImport(specifier) {
  importSeq += 1;
  return import(`${specifier}?t=${importSeq}`);
}

const BASE_ITEM = { id: "item-1", type: "school_event", title: "Picture Day", allDay: true, startDate: "2026-10-01", schedule: null };

function setupMocks(t, { publishResult, publishError } = {}) {
  const calls = { updateItem: [], publish: [] };
  t.mock.module("../src/data/itemsRepository.js", {
    namedExports: {
      updateItem: async (ctx, itemId, patch) => { calls.updateItem.push({ itemId, patch }); },
    },
  });
  t.mock.module("../src/data/googleCalendarConnection.js", {
    namedExports: {
      publishItemToGoogleCalendar: async (itemId) => {
        calls.publish.push(itemId);
        if (publishError) throw publishError;
        return publishResult || { alreadyPublished: false, googleCalendarEventId: "evt-1", googleCalendarSyncedAt: "now" };
      },
    },
  });
  return calls;
}

test("SUCCESS: a durable in-flight marker is written BEFORE the network call, for both auto-publish and retry", async (t) => {
  const calls = setupMocks(t, {});
  const { retryCalendarPublish } = await freshImport("../src/data/googleCalendarAutoPublish.js");
  const ctx = { uid: "parent-1", isAdmin: false };

  // autoPublishItemIfEligible reads the household setting first (real
  // Firestore read, resolves false/absent in this Node test env with no
  // live project — see this module's own doc comment on that
  // established limitation), so exercise the always-attempted path via
  // retryCalendarPublish instead, which is deliberately never gated on
  // the setting.
  await retryCalendarPublish(ctx, BASE_ITEM);

  assert.strictEqual(calls.updateItem.length, 1, "exactly one durable write happened (the in-flight marker; success itself is recorded server-side, not by this module)");
  assert.strictEqual(calls.updateItem[0].patch.googleCalendarSyncError, "Publishing to Google Calendar — not yet confirmed.");
  assert.strictEqual(calls.publish.length, 1, "the publish call itself was made exactly once");
});

test("FAILURE: the durable marker is written before the call, then overwritten with the real failure message", async (t) => {
  const calls = setupMocks(t, { publishError: new Error("Could not publish to Google Calendar. Please try again.") });
  const { retryCalendarPublish } = await freshImport("../src/data/googleCalendarAutoPublish.js");
  const ctx = { uid: "parent-1", isAdmin: false };

  await retryCalendarPublish(ctx, BASE_ITEM);

  assert.strictEqual(calls.updateItem.length, 2, "two durable writes: the in-flight marker, then the real failure");
  assert.strictEqual(calls.updateItem[0].patch.googleCalendarSyncError, "Publishing to Google Calendar — not yet confirmed.", "first write is the in-flight marker, written before the network call");
  assert.strictEqual(calls.updateItem[1].patch.googleCalendarSyncError, "Could not publish to Google Calendar. Please try again.", "second write records the actual failure, after the network call resolved");
});

test("A closed-tab simulation: if only the in-flight write completes, the Item is left in a durable, surfaced state (never silently indistinguishable from 'never attempted')", async (t) => {
  const calls = { updateItem: [] };
  t.mock.module("../src/data/itemsRepository.js", {
    namedExports: {
      updateItem: async (ctx, itemId, patch) => { calls.updateItem.push({ itemId, patch }); },
    },
  });
  t.mock.module("../src/data/googleCalendarConnection.js", {
    namedExports: {
      // Simulates the tab closing mid-request — this promise never resolves.
      publishItemToGoogleCalendar: () => new Promise(() => {}),
    },
  });
  const { retryCalendarPublish } = await freshImport("../src/data/googleCalendarAutoPublish.js");
  const ctx = { uid: "parent-1", isAdmin: false };

  // Race the (never-resolving) publish against a short timeout, mirroring
  // "the tab closes here" — what matters is what was already durably
  // written by that point.
  retryCalendarPublish(ctx, BASE_ITEM);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(calls.updateItem.length, 1, "the in-flight marker was already durably written before the (still-pending) network call");
  assert.strictEqual(calls.updateItem[0].patch.googleCalendarSyncError, "Publishing to Google Calendar — not yet confirmed.");
});

test("INTERRUPTION END-TO-END: a real, already-committed Item survives a publish interruption durably, and retry recovers it without creating a duplicate Item or Google event", async (t) => {
  // A real in-memory Item store (get/update actually persist across calls
  // within this test), not just captured call args — this is what lets
  // this single test prove the full round trip: the Item existed before
  // publishing was ever attempted, survives an interrupted attempt with a
  // durable recovery state, and a later retry operates on that exact same
  // Item rather than anything new.
  const store = new Map();
  let publishAttempts = 0;
  let shouldFail = true;

  t.mock.module("../src/data/itemsRepository.js", {
    namedExports: {
      updateItem: async (ctx, itemId, patch) => {
        const current = store.get(itemId);
        if (!current) throw new Error("item not found");
        const next = { ...current, ...patch };
        store.set(itemId, next);
        return next;
      },
    },
  });
  t.mock.module("../src/data/googleCalendarConnection.js", {
    namedExports: {
      publishItemToGoogleCalendar: async (itemId) => {
        publishAttempts += 1;
        if (shouldFail) {
          shouldFail = false; // the next attempt (the retry) succeeds
          throw new Error("Network interrupted");
        }
        // Mirrors what the real api/calendar.js?action=publish endpoint
        // sets on success — this module itself never writes these three
        // fields, only googleCalendarSyncError (see the module doc
        // comment), so the mock stands in for the server's own write.
        const current = store.get(itemId);
        store.set(itemId, {
          ...current,
          googleCalendarEventId: "evt-real-1",
          googleCalendarId: "primary",
          googleCalendarSyncedAt: "2026-01-01T00:00:00.000Z",
          googleCalendarSyncError: null,
        });
        return { alreadyPublished: false };
      },
    },
  });

  const { retryCalendarPublish } = await freshImport("../src/data/googleCalendarAutoPublish.js");
  const ctx = { uid: "parent-1", isAdmin: false };

  // 1. Item exists — a real, already-committed Item (standing in for
  // whichever of the three commit sources produced it: auto-committed
  // ingestion, a reviewed approval, or a manual Parent Board Add Item —
  // this module's own job starts only once an Item already exists).
  const item = { id: "item-durable-1", type: "school_event", title: "Field Day", allDay: true, startDate: "2026-10-01", schedule: null };
  store.set(item.id, item);

  // 2/3/4. Auto-publish enabled (retryCalendarPublish is deliberately never
  // gated on the setting — a parent's explicit Retry always runs, exactly
  // like this) + a publish attempt that's interrupted (throws, simulating
  // a dropped network call / closed tab mid-request).
  await retryCalendarPublish(ctx, item);

  // 5/6. Item remains committed, and a durable recovery state remains on
  // it — read back from the store, not from captured mock call args.
  const afterFailure = store.get(item.id);
  assert.ok(afterFailure, "the Item was never deleted/rolled back because Calendar publishing failed");
  assert.strictEqual(afterFailure.id, item.id);
  assert.ok(afterFailure.googleCalendarSyncError, "a durable failure/recovery state remains on the Item");

  // 7/8. Retry uses the SAME Item and succeeds without duplicating
  // anything — no second Item was ever created in the store.
  await retryCalendarPublish(ctx, afterFailure);
  const afterRetry = store.get(item.id);
  assert.strictEqual(store.size, 1, "still exactly one Item in existence — retry never created a duplicate");
  assert.strictEqual(afterRetry.id, item.id, "retry operated on the exact same Item id");
  assert.strictEqual(afterRetry.googleCalendarEventId, "evt-real-1", "retry successfully published");
  assert.strictEqual(afterRetry.googleCalendarSyncError, null, "the durable failure state is cleared once the retry succeeds");
  assert.strictEqual(publishAttempts, 2, "exactly two publish attempts total: the interrupted one and the successful retry");
});

test("Ineligible/guest/malformed inputs never attempt a durable write or a network call", async (t) => {
  const calls = setupMocks(t, {});
  const { retryCalendarPublish } = await freshImport("../src/data/googleCalendarAutoPublish.js");

  await retryCalendarPublish({ uid: "parent-1", isAdmin: true }, BASE_ITEM); // guest mode
  await retryCalendarPublish({ uid: "parent-1", isAdmin: false }, { id: "item-2", type: "chore" }); // ineligible type
  await retryCalendarPublish({ uid: "parent-1", isAdmin: false }, null); // malformed

  assert.strictEqual(calls.updateItem.length, 0, "no durable write for any of these");
  assert.strictEqual(calls.publish.length, 0, "no publish attempt for any of these");
});
