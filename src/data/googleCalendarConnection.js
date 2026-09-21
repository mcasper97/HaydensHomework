/* ============================== Google Calendar connection (client) ==============================
 * Slice B — mirrors src/data/gmailConnection.js's exact pattern. Thin
 * client wrapper around the Calendar-connection API endpoints
 * (api/calendar-oauth-start.js, api/calendar-status.js,
 * api/calendar-disconnect.js). The client never talks to Google directly
 * for any of this — every call goes through our own server, which is the
 * only thing that ever holds the OAuth credential (see
 * api/_googleCalendarConnectionsStore.js). No Calendar event API calls
 * exist yet (Slice C) — this module is connect/disconnect/status only.
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
