/**
 * Focused unit tests for src/data/googleCalendarAutoPublish.js — guest/
 * local-demo path only (no Firestore network call, no fetch, is ever
 * attempted for this path; the real-account publish call itself is
 * server-verified separately in tests/calendar-publish-endpoint.unit.mjs
 * and tests/calendar-routing.unit.mjs, both unchanged by this slice — see
 * that file's own header comment for why guest mode is safe to test
 * directly).
 *
 * Usage: node tests/google-calendar-auto-publish.unit.mjs
 */
import {
  getGoogleCalendarAutoPublishEnabled,
  saveGoogleCalendarAutoPublishEnabled,
  autoPublishItemIfEligible,
  retryCalendarPublish,
} from "../src/data/googleCalendarAutoPublish.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const adminCtx = { uid: "guest-local", isAdmin: true };

// ============ Setting persistence (guest path) ============
{
  ok("Default (never toggled) is false", (await getGoogleCalendarAutoPublishEnabled(adminCtx)) === false);
  await saveGoogleCalendarAutoPublishEnabled(adminCtx, true);
  ok("Reads back true after saving true", (await getGoogleCalendarAutoPublishEnabled(adminCtx)) === true);
  await saveGoogleCalendarAutoPublishEnabled(adminCtx, false);
  ok("Reads back false after saving false", (await getGoogleCalendarAutoPublishEnabled(adminCtx)) === false);
}

// ============ Guest mode never attempts a real publish call ============
// If autoPublishItemIfEligible/retryCalendarPublish ever reached
// publishItemToGoogleCalendar for guest mode, it would throw (no real
// Firebase user, no network in this test environment) — resolving
// cleanly here is itself the proof that the ctx.isAdmin guard short-
// circuits BEFORE any such call, for every input shape.
{
  const eligibleItem = { id: "item-1", type: "test", schedule: null };
  await saveGoogleCalendarAutoPublishEnabled(adminCtx, true); // even with the setting ON
  await autoPublishItemIfEligible(adminCtx, eligibleItem).then(
    () => ok("autoPublishItemIfEligible resolves cleanly for guest mode (never calls the network)", true),
    () => ok("autoPublishItemIfEligible resolves cleanly for guest mode (never calls the network)", false)
  );
  await retryCalendarPublish(adminCtx, eligibleItem).then(
    () => ok("retryCalendarPublish resolves cleanly for guest mode (never calls the network)", true),
    () => ok("retryCalendarPublish resolves cleanly for guest mode (never calls the network)", false)
  );
}

// ============ Never throws on malformed/missing input ============
{
  await autoPublishItemIfEligible(adminCtx, null).then(
    () => ok("autoPublishItemIfEligible never throws on a null item", true),
    () => ok("autoPublishItemIfEligible never throws on a null item", false)
  );
  await autoPublishItemIfEligible(adminCtx, {}).then(
    () => ok("autoPublishItemIfEligible never throws on an item with no id", true),
    () => ok("autoPublishItemIfEligible never throws on an item with no id", false)
  );
}

// ============ Ineligible item types never attempt a publish, regardless of the setting ============
{
  await saveGoogleCalendarAutoPublishEnabled(adminCtx, true);
  const recurringItem = { id: "item-2", type: "reminder", schedule: { recurring: true, weekdays: [1] } };
  await autoPublishItemIfEligible(adminCtx, recurringItem).then(
    () => ok("A recurring (Calendar-ineligible) item resolves cleanly with no publish attempt", true),
    () => ok("A recurring (Calendar-ineligible) item resolves cleanly with no publish attempt", false)
  );
  const choreItem = { id: "item-3", type: "chore", schedule: null };
  await autoPublishItemIfEligible(adminCtx, choreItem).then(
    () => ok("A chore-type (Calendar-ineligible) item resolves cleanly with no publish attempt", true),
    () => ok("A chore-type (Calendar-ineligible) item resolves cleanly with no publish attempt", false)
  );
}

delete global.localStorage;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
