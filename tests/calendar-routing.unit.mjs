/**
 * Focused unit tests for Slice C.1B's pure Google Calendar routing helper
 * — src/organizer/calendarRouting.js's resolveGoogleCalendarId. Zero
 * Firestore, zero network, zero Node-only dependencies (client+server
 * safe, mirrors calendarEventMapping.js's own design).
 *
 * Usage: node tests/calendar-routing.unit.mjs
 */
import { resolveGoogleCalendarId } from "../src/organizer/calendarRouting.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const ROUTING = { defaultCalendarId: "family-cal@group.calendar.google.com", childCalendarIds: { "hayden-id": "hayden-cal@group.calendar.google.com", "payton-id": "payton-cal@group.calendar.google.com" } };
const NO_DEFAULT = { defaultCalendarId: null, childCalendarIds: { "hayden-id": "hayden-cal@group.calendar.google.com" } };
// A third learner with no explicit mapping of their own, but a household default exists.
const DEFAULT_ONLY_FOR_UNMAPPED = { defaultCalendarId: "family-cal@group.calendar.google.com", childCalendarIds: { "hayden-id": "hayden-cal@group.calendar.google.com" } };
const EMPTY = { defaultCalendarId: null, childCalendarIds: {} };

// ============ 1. Single child ============
{
  const result = resolveGoogleCalendarId({ childIds: ["hayden-id"] }, ROUTING);
  ok("single child + mapped -> child calendar", result.calendarId === "hayden-cal@group.calendar.google.com");
  ok("single child + mapped -> source: child", result.source === "child");
}
{
  const result = resolveGoogleCalendarId({ childIds: ["payton-id"] }, NO_DEFAULT);
  // payton-id has no mapping in NO_DEFAULT, but NO_DEFAULT also has no defaultCalendarId
  ok("single child + no child mapping + no default -> primary", result.calendarId === "primary");
  ok("single child + no child mapping + no default -> source: primary", result.source === "primary");
}
{
  const result = resolveGoogleCalendarId({ childIds: ["payton-id"] }, DEFAULT_ONLY_FOR_UNMAPPED);
  ok("single child + no child mapping + default exists -> default", result.calendarId === "family-cal@group.calendar.google.com");
  ok("single child + no child mapping + default exists -> source: default", result.source === "default");
}
{
  const result = resolveGoogleCalendarId({ childIds: ["unmapped-id"] }, EMPTY);
  ok("single child + no child/default mapping at all -> primary", result.calendarId === "primary");
  ok("single child + no child/default mapping at all -> source: primary", result.source === "primary");
}

// ============ 2. Family-wide (childIds: []) ============
{
  const result = resolveGoogleCalendarId({ childIds: [] }, ROUTING);
  ok("family-wide + default -> default", result.calendarId === "family-cal@group.calendar.google.com");
  ok("family-wide + default -> source: default", result.source === "default");
}
{
  const result = resolveGoogleCalendarId({ childIds: [] }, EMPTY);
  ok("family-wide + no default -> primary", result.calendarId === "primary");
  ok("family-wide + no default -> source: primary", result.source === "primary");
}

// ============ 3. Multiple children ============
{
  const result = resolveGoogleCalendarId({ childIds: ["hayden-id", "payton-id"] }, ROUTING);
  ok("multiple children + default -> default (never the individually-mapped child calendars)", result.calendarId === "family-cal@group.calendar.google.com");
  ok("multiple children + default -> source: default", result.source === "default");
}
{
  const result = resolveGoogleCalendarId({ childIds: ["hayden-id", "payton-id"] }, EMPTY);
  ok("multiple children + no default -> primary", result.calendarId === "primary");
  ok("multiple children + no default -> source: primary", result.source === "primary");
}

// ============ 4. Unknown child never cross-maps to another learner ============
{
  const result = resolveGoogleCalendarId({ childIds: ["some-other-unknown-child"] }, ROUTING);
  ok("An unknown child id never resolves to hayden-id's or payton-id's mapped calendar", result.calendarId !== "hayden-cal@group.calendar.google.com" && result.calendarId !== "payton-cal@group.calendar.google.com");
  ok("...it falls through to the default instead", result.calendarId === "family-cal@group.calendar.google.com" && result.source === "default");
}
{
  const result = resolveGoogleCalendarId({ childIds: ["some-other-unknown-child"] }, EMPTY);
  ok("An unknown child id with no default falls through all the way to primary", result.calendarId === "primary" && result.source === "primary");
}

// ============ Defensive: missing/malformed inputs never throw ============
ok("null item does not throw, falls back per an empty childIds list", resolveGoogleCalendarId(null, ROUTING).calendarId === "family-cal@group.calendar.google.com");
ok("null routing does not throw, falls back to primary", resolveGoogleCalendarId({ childIds: [] }, null).calendarId === "primary");
ok("item.childIds undefined (not an array) is treated as family-wide, not a crash", resolveGoogleCalendarId({}, ROUTING).calendarId === "family-cal@group.calendar.google.com");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
