/* ============================== Household profile (server-only, Admin SDK) ==============================
 * Slice C. Server-side read of the canonical household timezone
 * (users/{uid}.timezone — see src/data/householdTimezone.js and
 * src/AuthShell.jsx's Slice A UI, which owns writing it). Needed because
 * api/calendar.js's publish action must resolve the household timezone
 * server-side to build a timed Google Calendar event — the browser's own
 * current timezone is never consulted at publish time (see the module
 * doc comment in api/calendar.js).
 *
 * Slice C.1C adds getGoogleCalendarRouting — same read-only pattern, same
 * users/{uid} document, one more field (googleCalendarRouting). Owned for
 * writes by src/data/googleCalendarRouting.js's client-side
 * setDoc(..., {merge:true}) (Slice C.1B) — this module never writes
 * users/{uid} at all, for either field.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";

function defaultDb() {
  return getFirestore();
}

export async function getHouseholdTimezone(uid, { db = defaultDb() } = {}) {
  if (!uid) return null;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const timezone = snap.data()?.timezone;
  return typeof timezone === "string" && timezone ? timezone : null;
}

/**
 * getGoogleCalendarRouting(uid) -> { defaultCalendarId, childCalendarIds }
 * Reads users/{uid}.googleCalendarRouting (see
 * src/data/googleCalendarRouting.js's own doc comment for the shape and
 * why "primary" is never itself a stored value). Absent, missing, or
 * malformed data all normalize to the same safe default — this never
 * trusts the raw Firestore value's shape, since it's parent-writable
 * client-side and this read feeds directly into which Google calendar an
 * event gets inserted into (api/calendar.js's publish action).
 */
export async function getGoogleCalendarRouting(uid, { db = defaultDb() } = {}) {
  const empty = { defaultCalendarId: null, childCalendarIds: {} };
  if (!uid) return empty;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return empty;
  const raw = snap.data()?.googleCalendarRouting;

  const defaultCalendarId = typeof raw?.defaultCalendarId === "string" && raw.defaultCalendarId ? raw.defaultCalendarId : null;
  const childCalendarIds = {};
  if (raw?.childCalendarIds && typeof raw.childCalendarIds === "object") {
    for (const [childId, calendarId] of Object.entries(raw.childCalendarIds)) {
      if (typeof calendarId === "string" && calendarId) {
        childCalendarIds[childId] = calendarId;
      }
    }
  }
  return { defaultCalendarId, childCalendarIds };
}
