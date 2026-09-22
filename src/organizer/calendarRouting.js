/* ============================== Google Calendar routing helper (Slice C.1B) ==============================
 * Pure logic, zero Firestore/network dependency — deliberately importable
 * from both the client (the routing config Parent Tools UI, deciding what
 * a publish action would resolve to) and the server (Slice C.1C's
 * calendar-publish.js, deciding which actual Google calendar to insert
 * into). This module never reads or writes household config itself — see
 * src/data/googleCalendarRouting.js for persistence — and never talks to
 * Google Calendar's API.
 *
 * routing shape (see src/data/googleCalendarRouting.js's own doc comment
 * for the full normalization contract):
 *   { defaultCalendarId: string | null, childCalendarIds: { [childId]: string } }
 *
 * Fallback to the literal string "primary" (Google's own well-known alias
 * for the connected account's primary calendar) happens ONLY here, at
 * resolution time — routing config itself never stores "primary" as a
 * value; an absent/null defaultCalendarId or child mapping IS the
 * fallback signal (see the module doc comment in
 * src/data/googleCalendarRouting.js for why "primary" is never persisted
 * as configuration).
 */

/**
 * resolveGoogleCalendarId(item, routing) -> { calendarId, source }
 *   source: "child"   — item.childIds has exactly one child, and that
 *                        child has an explicit mapping.
 *           "default" — routing.defaultCalendarId is used (family-wide,
 *                        multi-child, or a single child with no explicit
 *                        mapping of their own).
 *           "primary" — no applicable mapping exists at all; falls back
 *                        to Google's "primary" alias.
 *
 * Rules (Slice C.1B/C.1C spec):
 *   1. Exactly one child assigned (item.childIds.length === 1):
 *        routing.childCalendarIds[childId] exists -> that calendarId ("child")
 *        else routing.defaultCalendarId exists     -> defaultCalendarId ("default")
 *        else                                       -> "primary" ("primary")
 *   2. Family-wide (item.childIds.length === 0) or
 *      multiple children (item.childIds.length > 1) — same rule for both:
 *        routing.defaultCalendarId exists -> defaultCalendarId ("default")
 *        else                              -> "primary" ("primary")
 *
 * Unknown/unmapped child ids NEVER cross-map to another child's calendar —
 * this is a direct object-key lookup (childCalendarIds[childId]), which is
 * structurally incapable of matching a different key, by construction.
 *
 * Never creates multiple Google events for a multi-child Item — this
 * function returns exactly ONE calendarId per call, always.
 */
export function resolveGoogleCalendarId(item, routing) {
  const childIds = Array.isArray(item?.childIds) ? item.childIds : [];
  const defaultCalendarId = routing?.defaultCalendarId || null;
  const childCalendarIds = routing?.childCalendarIds || {};

  if (childIds.length === 1) {
    const mapped = childCalendarIds[childIds[0]];
    if (mapped) {
      return { calendarId: mapped, source: "child" };
    }
  }

  if (defaultCalendarId) {
    return { calendarId: defaultCalendarId, source: "default" };
  }

  return { calendarId: "primary", source: "primary" };
}
