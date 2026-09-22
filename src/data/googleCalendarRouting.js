/* ============================== Google Calendar routing config (client) ==============================
 * Slice C.1B. Household configuration — "which Google calendar does each
 * learner (or the family/default) use" — deliberately kept separate from
 * src/data/googleCalendarConnection.js (OAuth connect/disconnect/status/
 * list/publish): connection is a per-account credential concern, routing
 * is a household-profile config concern, and mixing them would blur that
 * boundary for no simplicity gain.
 *
 * Stored on the SAME users/{uid} document as familyLastName/timezone
 * (see src/AuthShell.jsx's saveFamilyName/saveTimezone), same
 * setDoc(..., {merge:true}) pattern, same Firestore rule coverage — no
 * new collection, no new server endpoint for saving. Shape:
 *
 *   users/{uid}.googleCalendarRouting = {
 *     defaultCalendarId: string | null,
 *     childCalendarIds: { [childId]: string }
 *   }
 *
 * "primary" (Google's well-known alias) is NEVER stored as a value here —
 * null/absence IS the fallback signal. Storing the literal string
 * "primary" as configuration would conflate "the parent explicitly chose
 * the calendar Google currently calls primary" with "nothing is
 * configured, fall back" — two different facts that null vs. a real
 * calendar id already distinguish cleanly. src/organizer/calendarRouting.js
 * is the one place "primary" is ever produced, and only as a resolved
 * OUTPUT, never read back in as configuration.
 *
 * Deliberately split into PURE functions (normalizeGoogleCalendarRouting,
 * buildGoogleCalendarRoutingSave — fully unit-testable, zero Firestore)
 * and one impure function (saveGoogleCalendarRouting — the actual write).
 * This mirrors this project's established testing boundary (see e.g.
 * tests/item-completions-repository.unit.mjs's own header comment): a
 * src/data/*.js module's real Firestore round-trip needs a live project
 * to exercise meaningfully, but every DECISION about what gets written —
 * validation, stale-mapping cleanup, defaulting — is pulled out into pure
 * functions so it's fully covered without one. saveGoogleCalendarRouting
 * itself is a thin, single-line wrapper around that already-validated
 * payload.
 */
import { doc, setDoc } from "firebase/firestore";
import { db } from "../Firebase.js";

/**
 * normalizeGoogleCalendarRouting(raw) -> { defaultCalendarId, childCalendarIds }
 * Safe default when the field is entirely absent (no migration/backfill —
 * a household that has never configured routing simply gets this shape).
 * Also defensively drops any malformed entry (non-string value, etc.)
 * rather than trusting whatever happens to be in Firestore verbatim.
 */
export function normalizeGoogleCalendarRouting(raw) {
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

/**
 * buildGoogleCalendarRoutingSave({ defaultCalendarId, childCalendarIds,
 *   currentChildIds, availableCalendarIds }) -> { ok: true, routing } | { ok: false, error }
 *
 * The one place "is this save actually safe to persist" is decided —
 * called by the Parent Tools routing panel right before saving, never
 * bypassed. `defaultCalendarId`/values in `childCalendarIds` are the
 * panel's current DRAFT selections (a blank/unselected value must be
 * passed as null, meaning "use primary" — never an empty string).
 *
 *   - A non-null defaultCalendarId must appear in `availableCalendarIds`
 *     (the sanitized writable Calendar List the panel just fetched) —
 *     rejected otherwise, so a stale/no-longer-writable id can never be
 *     silently persisted (e.g. the Calendar List changed between load and
 *     save). No client-typed/arbitrary id is ever accepted — the caller
 *     only ever supplies values that came from that same fetched list.
 *   - Every entry in `childCalendarIds` is dropped (not an error) if its
 *     key isn't in `currentChildIds` — a learner who no longer exists
 *     never keeps a stale mapping.
 *   - A null/blank value for a still-current child is simply omitted from
 *     the saved childCalendarIds (means "use fallback"), not an error.
 *   - A non-null, non-blank value for a still-current child must also
 *     appear in `availableCalendarIds`, exactly like defaultCalendarId.
 */
export function buildGoogleCalendarRoutingSave({ defaultCalendarId, childCalendarIds, currentChildIds, availableCalendarIds }) {
  const availableSet = new Set(availableCalendarIds || []);
  const currentSet = new Set(currentChildIds || []);

  let cleanDefault = null;
  if (defaultCalendarId) {
    if (typeof defaultCalendarId !== "string" || !availableSet.has(defaultCalendarId)) {
      return { ok: false, error: "Selected default calendar is no longer available. Reload and try again." };
    }
    cleanDefault = defaultCalendarId;
  }

  const cleanChildCalendarIds = {};
  for (const [childId, calendarId] of Object.entries(childCalendarIds || {})) {
    if (!currentSet.has(childId)) continue; // stale learner — dropped, not an error
    if (!calendarId) continue; // blank -> fallback, no entry stored
    if (typeof calendarId !== "string" || !availableSet.has(calendarId)) {
      return { ok: false, error: "One of the selected calendars is no longer available. Reload and try again." };
    }
    cleanChildCalendarIds[childId] = calendarId;
  }

  return { ok: true, routing: { defaultCalendarId: cleanDefault, childCalendarIds: cleanChildCalendarIds } };
}

/**
 * saveGoogleCalendarRouting(uid, routing) -> void
 * The one write this module performs. `routing` must already be the
 * output of buildGoogleCalendarRoutingSave above — this function trusts
 * its shape and does no further validation of its own. {merge:true}
 * preserves every other users/{uid} field (children, timezone,
 * familyLastName, etc.) exactly as saveTimezone/saveFamilyName already do.
 */
export async function saveGoogleCalendarRouting(uid, routing) {
  await setDoc(doc(db, "users", uid), { googleCalendarRouting: routing }, { merge: true });
}
