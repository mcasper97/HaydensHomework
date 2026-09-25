/**
 * Focused unit tests for the Calendar publish-failure notification
 * trigger:
 *   - api/_calendarPublishFailureNotificationTrigger.js's
 *     notifyCalendarPublishFailure (the trigger module itself)
 *   - api/_scheduledIngestionAdapter.js's recordPublishFailure (the
 *     EXISTING single choke point every real Calendar publish failure
 *     already funnels through, now exported so this wiring can be
 *     proven directly — every collaborator is injectable via `deps`, so
 *     no real Firestore/Admin SDK/network call is ever reached and no
 *     ES module mocking is needed).
 *
 * One test ("same failed Item relies on the existing dedupe path")
 * deliberately uses the REAL api/_notificationOrchestrator.js's
 * processAttentionNotification together with the REAL
 * api/_notificationDeliveryStore.js's claimNotificationDelivery/
 * markNotificationSent/markNotificationFailed against an in-memory fake
 * Firestore (same fake used in
 * tests/notification-delivery-store.unit.mjs and
 * tests/gmail-reconnect-notification-trigger.unit.mjs) — not a
 * re-implementation of the dedupe decision — to prove this trigger
 * genuinely relies on the existing atomic-claim dedupe path.
 *
 * Usage: node tests/calendar-publish-failure-notification-trigger.unit.mjs
 */
import { readFileSync } from "node:fs";
import { notifyCalendarPublishFailure } from "../api/_calendarPublishFailureNotificationTrigger.js";
import { recordPublishFailure } from "../api/_scheduledIngestionAdapter.js";
import { processAttentionNotification } from "../api/_notificationOrchestrator.js";
import { claimNotificationDelivery, markNotificationSent, markNotificationFailed } from "../api/_notificationDeliveryStore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const UID = "calendar-publish-uid-1";
const ITEM_ID = "item-42";

function item(overrides = {}) {
  return {
    id: ITEM_ID,
    googleCalendarEventId: null,
    googleCalendarId: null,
    googleCalendarSyncedAt: null,
    ...overrides,
  };
}

/** Minimal in-memory Firestore-Admin-SDK-shaped fake — same pattern as the Gmail trigger's own test file. */
function createFakeAdminDb() {
  const store = new Map();
  function docRef(path) {
    return {
      path,
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      set: async (data) => { store.set(path, data); },
    };
  }
  function collRef(name) {
    return { doc: (id) => docRef(`${name}/${id}`) };
  }
  return {
    db: {
      collection: (name) => collRef(name),
      runTransaction: async (fn) => {
        const tx = { get: async (ref) => ref.get(), set: (ref, data) => { store.set(ref.path, data); } };
        return fn(tx);
      },
    },
    store,
  };
}

// ============ notifyCalendarPublishFailure: attention shape ============
{
  const calls = { notify: [] };
  await notifyCalendarPublishFailure(UID, ITEM_ID, {
    notify: async (uid, attention) => { calls.notify.push({ uid, attention }); return { sent: true }; },
  });

  ok("processAttentionNotification (the injected notify) is invoked exactly once", calls.notify.length === 1);
  ok("Called with this household's uid", calls.notify[0].uid === UID);
  ok("The attention has type 'calendar'", calls.notify[0].attention.type === "calendar");
  ok("The attention's id is the failing Item's id", calls.notify[0].attention.id === ITEM_ID);
  ok("The attention carries no other, unrelated fields", Object.keys(calls.notify[0].attention).sort().join(",") === "id,type");
}

// ============ Missing itemId never calls the pipeline, never throws ============
{
  let threw = false;
  const calls = { notify: 0 };
  try {
    await notifyCalendarPublishFailure(UID, null, { notify: async () => { calls.notify += 1; return { sent: true }; } });
  } catch { threw = true; }
  ok("A missing itemId never calls the notification pipeline", calls.notify === 0);
  ok("...and never throws", threw === false);
}

// ============ A downstream notification failure never throws out of the trigger ============
{
  let threw = false;
  let result;
  try {
    result = await notifyCalendarPublishFailure(UID, ITEM_ID, { notify: async () => { throw new Error("Resend request failed (500)"); } });
  } catch { threw = true; }
  ok("A downstream notification failure never propagates out of notifyCalendarPublishFailure", threw === false);
  ok("The function resolves rather than rejecting", result === undefined);
}

// ============ recordPublishFailure: Calendar publish failure invokes the trigger ============
{
  const calls = { setFields: [], notifyFailure: [] };
  await recordPublishFailure(UID, item(), "Could not publish to Google Calendar.", {
    setFields: async (uid, itemId, patch) => { calls.setFields.push({ uid, itemId, patch }); },
    notifyFailure: async (uid, itemId) => { calls.notifyFailure.push({ uid, itemId }); },
  });

  ok("recordPublishFailure still persists googleCalendarSyncError exactly as before", calls.setFields.length === 1 && calls.setFields[0].patch.googleCalendarSyncError === "Could not publish to Google Calendar.");
  ok("recordPublishFailure invokes the Calendar publish-failure notification trigger exactly once", calls.notifyFailure.length === 1);
  ok("...with this household's uid and the failing Item's id", calls.notifyFailure[0].uid === UID && calls.notifyFailure[0].itemId === ITEM_ID);
}

// ============ Notification failure does not change the Calendar failure result/state ============
{
  const calls = { setFields: [] };
  const result = await recordPublishFailure(UID, item(), "Could not publish to Google Calendar.", {
    setFields: async (uid, itemId, patch) => { calls.setFields.push({ uid, itemId, patch }); },
    notifyFailure: async () => { throw new Error("Resend is down"); },
  });

  ok("recordPublishFailure itself never throws even when the notification trigger throws", result === undefined);
  ok("googleCalendarSyncError is still persisted exactly as it would be without any notification failure", calls.setFields.length === 1 && calls.setFields[0].patch.googleCalendarSyncError === "Could not publish to Google Calendar.");
  ok("The persisted patch is otherwise unaffected (event id/calendar id/synced-at all pass through unchanged)", calls.setFields[0].patch.googleCalendarEventId === null && calls.setFields[0].patch.googleCalendarId === null && calls.setFields[0].patch.googleCalendarSyncedAt === null);
}
{
  // The reverse isolation direction: even if PERSISTING the failure
  // itself throws, the notification trigger is still attempted (the two
  // steps are independent), and recordPublishFailure as a whole still
  // never throws — retry remains possible either way (the caller's Item
  // stays committed regardless).
  const calls = { notifyFailure: [] };
  let threw = false;
  try {
    await recordPublishFailure(UID, item(), "Could not publish to Google Calendar.", {
      setFields: async () => { throw new Error("Firestore write failed"); },
      notifyFailure: async (uid, itemId) => { calls.notifyFailure.push({ uid, itemId }); },
    });
  } catch { threw = true; }
  ok("recordPublishFailure never throws even when persisting the failure itself throws", threw === false);
  ok("The notification trigger is still attempted independently of the persistence outcome", calls.notifyFailure.length === 1);
}

// ============ Successful Calendar publish sends no notification ============
{
  // recordPublishFailure (and therefore the notification trigger) is
  // structurally reached ONLY from the failure branches inside
  // attemptCalendarPublishServerSide — the success branch calls
  // setItemGoogleCalendarFields directly and never recordPublishFailure
  // at all (see api/_scheduledIngestionAdapter.js). Verified here at the
  // source level: notifyCalendarPublishFailure/notifyFailure is invoked
  // from exactly one place in the whole adapter file (inside
  // recordPublishFailure itself), never from the success write.
  const source = readFileSync(new URL("../api/_scheduledIngestionAdapter.js", import.meta.url), "utf8");
  const notifyCallSites = source.match(/notifyFailure\(/g) || [];
  ok("notifyFailure(...) is called from exactly one place in the adapter (inside recordPublishFailure) — never from the success path", notifyCallSites.length === 1);

  const successBlockMatch = source.match(/await setItemGoogleCalendarFields\(uid, item\.id, \{\s*googleCalendarEventId: inserted\.eventId[\s\S]{0,200}?\}\);/);
  ok("The success write block exists and does not itself call notifyFailure", !!successBlockMatch && !successBlockMatch[0].includes("notifyFailure"));
}

// ============ Same failed Item relies on the existing dedupe path (real claim store, not reimplemented) ============
{
  const { db } = createFakeAdminDb();
  const sendCalls = [];
  const realDedupeNotify = (uid, attention) =>
    processAttentionNotification(uid, attention, {
      claimDelivery: (u, a) => claimNotificationDelivery(u, a, { db }),
      markSent: (u, key) => markNotificationSent(u, key, { db }),
      markFailed: (u, key) => markNotificationFailed(u, key, { db }),
      getRecipientEmail: async () => "parent@example.com",
      sendEmail: async (payload) => { sendCalls.push(payload); return { ok: true }; },
    });

  // Three repeated failure recordings for the SAME Item (e.g. three
  // retries that all still fail) — simulating a parent clicking Retry
  // repeatedly, or a future scheduled retry mechanism.
  await recordPublishFailure(UID, item(), "Could not publish to Google Calendar.", { notifyFailure: (uid, itemId) => notifyCalendarPublishFailure(uid, itemId, { notify: realDedupeNotify }) });
  await recordPublishFailure(UID, item(), "Could not publish to Google Calendar.", { notifyFailure: (uid, itemId) => notifyCalendarPublishFailure(uid, itemId, { notify: realDedupeNotify }) });
  await recordPublishFailure(UID, item(), "Could not publish to Google Calendar.", { notifyFailure: (uid, itemId) => notifyCalendarPublishFailure(uid, itemId, { notify: realDedupeNotify }) });

  ok("Repeated failure recordings for the same Item send exactly ONE email (the real atomic claim suppresses the rest)", sendCalls.length === 1);
}

// ============ Same-item re-failure limitation: a later failure after a successful notification is ALSO suppressed (disclosed, not fixed) ============
{
  const { db } = createFakeAdminDb();
  const sendCalls = [];
  const realDedupeNotify = (uid, attention) =>
    processAttentionNotification(uid, attention, {
      claimDelivery: (u, a) => claimNotificationDelivery(u, a, { db }),
      markSent: (u, key) => markNotificationSent(u, key, { db }),
      markFailed: (u, key) => markNotificationFailed(u, key, { db }),
      getRecipientEmail: async () => "parent@example.com",
      sendEmail: async (payload) => { sendCalls.push(payload); return { ok: true }; },
    });

  await notifyCalendarPublishFailure(UID, ITEM_ID, { notify: realDedupeNotify });
  ok("Setup: the first failure notification for this item sends", sendCalls.length === 1);

  // Unlike Gmail's connectedAt, nothing about a successful publish
  // changes any value folded into "calendar:<itemId>" — the key stays
  // identical forever for this Item, so a LATER failure (even long after
  // an intervening success) is suppressed by the existing dedupe rather
  // than treated as a new episode. This is the disclosed limitation, not
  // a bug: current stable-key semantics are kept as-is per the task.
  await notifyCalendarPublishFailure(UID, ITEM_ID, { notify: realDedupeNotify });
  ok("A later failure for the SAME item (same stable key, no episode marker) is suppressed — the disclosed limitation, kept as-is", sendCalls.length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
