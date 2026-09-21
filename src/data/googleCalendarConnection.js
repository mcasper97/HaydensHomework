/* ============================== Google Calendar connection (client) ==============================
 * Slice B — mirrors src/data/gmailConnection.js's exact pattern. Thin
 * client wrapper around the Calendar-connection API endpoints
 * (api/calendar-oauth-start.js, api/calendar-status.js,
 * api/calendar-disconnect.js). The client never talks to Google directly
 * for any of this — every call goes through our own server, which is the
 * only thing that ever holds the OAuth credential (see
 * api/_googleCalendarConnectionsStore.js).
 *
 * Slice C adds publishItemToGoogleCalendar — still no Calendar event data
 * or token of any kind is ever visible client-side; this only calls
 * api/calendar-publish.js and returns its browser-safe result.
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
  const data = await authedFetch("/api/calendar-status", { method: "GET" });
  return {
    connected: !!data.connected,
    needsReconnect: !!data.needsReconnect,
    connectedAt: data.connectedAt || null,
  };
}

/** Starts the Calendar OAuth flow and navigates the browser to Google's consent screen. */
export async function startCalendarOAuth() {
  const data = await authedFetch("/api/calendar-oauth-start", { method: "POST" });
  window.location.href = data.authUrl;
}

export async function disconnectCalendar() {
  await authedFetch("/api/calendar-disconnect", { method: "POST" });
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
  const data = await authedFetch("/api/calendar-publish", {
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
