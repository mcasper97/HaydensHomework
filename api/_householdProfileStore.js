/* ============================== Household profile (server-only, Admin SDK) ==============================
 * Slice C. Server-side read of the canonical household timezone
 * (users/{uid}.timezone — see src/data/householdTimezone.js and
 * src/AuthShell.jsx's Slice A UI, which owns writing it). Needed because
 * api/calendar-publish.js must resolve the household timezone
 * server-side to build a timed Google Calendar event — the browser's own
 * current timezone is never consulted at publish time (see the module
 * doc comment in api/calendar-publish.js).
 *
 * Deliberately narrow: read-only, one field. This module never writes
 * users/{uid} — that stays exactly as-is, owned by src/AuthShell.jsx's
 * client-side setDoc(..., {merge:true}) from Slice A.
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
