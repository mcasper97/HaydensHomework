/* ============================== Google Calendar — publish an Item ==============================
 * Slice C. Manual, parent-triggered action (see src/organizer/ParentOrganizer.jsx's
 * "Add to Google Calendar" control) that publishes ONE existing, saved,
 * one-time canonical Item to the connected Google Calendar. Creation
 * only — no update/resync (Slice D), no delete/unpublish (Slice E), no
 * recurring Item support, no inbound sync of any kind.
 *
 * POST { itemId, optionalEndTime? }
 *   optionalEndTime — only meaningful (and only ever used) when the Item
 *   has a startTime but no endTime; supplied by the parent via
 *   ParentOrganizer.jsx's minimal end-time confirmation prompt. Used ONLY
 *   to build this one Google event — never written back onto the
 *   canonical Item (see src/organizer/calendarEventMapping.js's own doc
 *   comment).
 *
 * IDEMPOTENCY / RECOVERY DESIGN — the actual safety mechanism this
 * endpoint is built around:
 *   1. If the Item already has googleCalendarEventId, this returns an
 *      "already published" result immediately, without calling Google's
 *      API again at all.
 *   2. Otherwise, the Google event id used is ALWAYS
 *      deriveGoogleEventId(itemId) (api/_googleCalendarClient.js) — a
 *      deterministic hash of the Item's own Firestore id, never a
 *      randomly-generated one. The SAME Item always maps to the SAME
 *      Google event id, on every attempt, forever.
 *   3. This means a retry — whether from a genuine double-click, a
 *      network blip that caused the FIRST attempt's response to be lost,
 *      or (the case that matters most) the Google insert having already
 *      succeeded on a prior attempt whose Firestore linkage write then
 *      failed — always targets the exact same Google event. Google
 *      itself rejects a second insert at an id that already exists with
 *      a 409 ("duplicate"), which api/_googleCalendarClient.js's
 *      insertCalendarEvent treats as success (`alreadyExisted: true`),
 *      not an error. Either way (a fresh 201 or a recovered 409), this
 *      endpoint proceeds to (re)write the Item's four linkage fields —
 *      so a retry after a partial failure SELF-HEALS the missing
 *      linkage without ever creating a duplicate Google event.
 *   4. googleCalendarEventId is written ONLY after Google has confirmed
 *      the event exists (fresh insert or recognized duplicate) — never
 *      before, and never on any failure path.
 *
 * Security: every Google API call and every token happens server-side
 * only (api/_googleCalendarClient.js) — the response this endpoint
 * returns never includes an access or refresh token. "itemId alone
 * cannot access another user's Item" is structural: the Item is always
 * read from users/{uid}/items/{itemId} where uid comes only from the
 * caller's own verified Firebase token (see api/_itemsStore.js's own doc
 * comment) — there is no code path that reads an Item by id alone.
 * Google's raw response bodies are never logged verbatim (see
 * api/_googleCalendarClient.js) since they may contain the event's own
 * content (a child's homework title/notes).
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { getGoogleCalendarConnection } from "./_googleCalendarConnectionsStore.js";
import { getHouseholdTimezone } from "./_householdProfileStore.js";
import { getItem, setItemGoogleCalendarFields } from "./_itemsStore.js";
import { deriveGoogleEventId, refreshCalendarAccessToken, insertCalendarEvent } from "./_googleCalendarClient.js";
import { buildCalendarEventFromItem } from "../src/organizer/calendarEventMapping.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let uid;
  try {
    ({ uid } = await requireFirebaseUser(req));
  } catch {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  if (!checkRateLimit(uid)) {
    return res.status(429).json({ ok: false, error: "Too many requests — please wait a few minutes and try again." });
  }

  const { itemId, optionalEndTime } = req.body || {};
  if (!itemId || typeof itemId !== "string") {
    return res.status(400).json({ ok: false, error: "Missing itemId." });
  }

  let connection;
  try {
    connection = await getGoogleCalendarConnection(uid);
  } catch (err) {
    console.error("calendar-publish: getGoogleCalendarConnection failed:", err?.message);
    return res.status(500).json({ ok: false, error: "Could not load your Google Calendar connection." });
  }
  if (!connection?.refreshToken) {
    return res.status(400).json({ ok: false, code: "NOT_CONNECTED", error: "Connect Google Calendar in Parent Tools before publishing." });
  }
  if (connection.needsReconnect) {
    return res.status(409).json({ ok: false, needsReconnect: true, error: "Reconnect Google Calendar in Parent Tools before publishing." });
  }

  let item;
  try {
    item = await getItem(uid, itemId);
  } catch (err) {
    console.error("calendar-publish: getItem failed:", err?.message);
    return res.status(500).json({ ok: false, error: "Could not load this item." });
  }
  if (!item) {
    return res.status(404).json({ ok: false, error: "This item no longer exists." });
  }

  // Idempotency step 1 — see the module doc comment above. No Google API
  // call at all for an already-linked Item.
  if (item.googleCalendarEventId) {
    return res.status(200).json({
      ok: true,
      alreadyPublished: true,
      googleCalendarEventId: item.googleCalendarEventId,
      googleCalendarSyncedAt: item.googleCalendarSyncedAt || null,
    });
  }

  const eventId = deriveGoogleEventId(itemId);

  let householdTimezone;
  try {
    householdTimezone = await getHouseholdTimezone(uid);
  } catch (err) {
    console.error("calendar-publish: getHouseholdTimezone failed:", err?.message);
    return res.status(500).json({ ok: false, error: "Could not load your household timezone." });
  }

  const mapped = buildCalendarEventFromItem({ item, householdTimezone, optionalEndTime, eventId });
  if (!mapped.ok) {
    return res.status(400).json({ ok: false, code: mapped.code, error: mapped.message });
  }

  const refreshed = await refreshCalendarAccessToken(uid, connection);
  if (!refreshed.ok) {
    if (refreshed.needsReconnect) {
      return res.status(409).json({ ok: false, needsReconnect: true, error: "Reconnect Google Calendar in Parent Tools before publishing." });
    }
    return res.status(502).json({ ok: false, error: refreshed.error || "Could not connect to Google Calendar. Please try again." });
  }

  const inserted = await insertCalendarEvent({ accessToken: refreshed.accessToken, event: mapped.event });
  if (!inserted.ok) {
    // The canonical Item is left completely unchanged — no linkage,
    // no googleCalendarSyncError — there is nothing Item-level yet to
    // mark as stale; the parent can simply retry the same action.
    return res.status(502).json({ ok: false, error: inserted.error || "Could not publish to Google Calendar. Please try again." });
  }

  try {
    await setItemGoogleCalendarFields(uid, itemId, {
      googleCalendarEventId: inserted.eventId,
      googleCalendarId: "primary",
      googleCalendarSyncedAt: new Date().toISOString(),
      googleCalendarSyncError: null,
    });
  } catch (err) {
    console.error("calendar-publish: setItemGoogleCalendarFields failed:", err?.message);
    // The Google event now exists (fresh or recovered-duplicate) but the
    // linkage write itself failed — a retry of this same action will
    // recover cleanly (see the module doc comment's idempotency design),
    // never creating a second event.
    return res.status(502).json({ ok: false, error: "Published to Google Calendar, but couldn't save the link — please try again." });
  }

  return res.status(200).json({
    ok: true,
    alreadyPublished: false,
    googleCalendarEventId: inserted.eventId,
    googleCalendarSyncedAt: new Date().toISOString(),
  });
}
