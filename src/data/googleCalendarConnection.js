/* ============================== Google Calendar connection (client) ==============================
 * Slice B — mirrors src/data/gmailConnection.js's exact pattern. Thin
 * client wrapper around the Calendar API. The client never talks to
 * Google directly for any of this — every call goes through our own
 * server, which is the only thing that ever holds the OAuth credential
 * (see api/_googleCalendarConnectionsStore.js).
 *
 * Post-Slice-C.1A infrastructure change: every action below now goes
 * through the single consolidated api/calendar.js action router
 * (?action=status|list|oauth-start|disconnect|publish) instead of five
 * separate serverless functions — a route-shape change only, to stay
 * under Vercel's Hobby-plan function-count limit. Every return shape
 * below is unchanged. api/calendar-oauth-callback.js (Google's own
 * browser-redirect target) is untouched and not called from here at all.
 *
 * Slice C adds publishItemToGoogleCalendar — still no Calendar event data
 * or token of any kind is ever visible client-side; this only calls
 * api/calendar.js?action=publish and returns its browser-safe result.
 */
import { auth } from "../Firebase.js";

async function authedFetch(path, options = {}) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const err = new Error(data?.error || "Request failed");
    if (data?.needsReconnect) err.needsReconnect = true;
    // Slice C: machine-readable error code (e.g. MISSING_HOUSEHOLD_TIMEZONE,
    // MISSING_END_TIME) from calendarEventMapping.js's CALENDAR_ERROR_CODES,
    // when the server's response included one. Existing callers never set
    // this field in their own responses, so this is purely additive.
    if (data?.code) err.code = data.code;
    throw err;
  }
  return data;
}

export async function getCalendarStatus() {
  const data = await authedFetch("/api/calendar?action=status", { method: "GET" });
  return {
    connected: !!data.connected,
    needsReconnect: !!data.needsReconnect,
    connectedAt: data.connectedAt || null,
  };
}

/** Starts the Calendar OAuth flow and navigates the browser to Google's consent screen. */
export async function startCalendarOAuth() {
  const data = await authedFetch("/api/calendar?action=oauth-start", { method: "POST" });
  window.location.href = data.authUrl;
}

export async function disconnectCalendar() {
  await authedFetch("/api/calendar?action=disconnect", { method: "POST" });
}

/**
 * getCalendarList() -> [{ id, summary, primary, accessRole }, ...]
 * Slice C.1A server-side Calendar List support; consumed by Slice C.1B's
 * GoogleCalendarRoutingPanel (AuthShell.jsx) to populate its calendar
 * selectors. (Slice C.1A's own temporary "Test Calendar List" live-
 * validation control that first exercised this function has been removed
 * now that the real routing UI supersedes it.) Throws on failure — a
 * CALENDAR_LIST_SCOPE_MISSING code (see api/calendar.js's own doc
 * comment) arrives as `err.code`, exactly like every other authedFetch
 * caller's error-code handling here; the caller decides how to display
 * it. Never returns a token of any kind — see the server's own
 * listCalendars sanitization in api/_googleCalendarClient.js.
 */
export async function getCalendarList() {
  const data = await authedFetch("/api/calendar?action=list", { method: "GET" });
  return Array.isArray(data.calendars) ? data.calendars : [];
}

/**
 * publishItemToGoogleCalendar(itemId, { optionalEndTime? }) -> result
 * Manual, per-Item action (Slice C) — see ParentOrganizer.jsx's "Add to
 * Google Calendar" control. `optionalEndTime` is only ever sent when the
 * Item has a startTime but no endTime (see calendarEventMapping.js) —
 * ParentOrganizer.jsx's end-time confirmation prompt is the only place
 * this is ever collected.
 */
export async function publishItemToGoogleCalendar(itemId, { optionalEndTime } = {}) {
  const data = await authedFetch("/api/calendar?action=publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, ...(optionalEndTime ? { optionalEndTime } : {}) }),
  });
  return {
    alreadyPublished: !!data.alreadyPublished,
    googleCalendarEventId: data.googleCalendarEventId || null,
    googleCalendarSyncedAt: data.googleCalendarSyncedAt || null,
  };
}
