/* ============================== Google Calendar — list writable calendars ==============================
 * Slice C.1A. Server-side support for future routing configuration
 * (Slice C.1B — the "which calendar does each learner use" Parent Tools
 * UI). This slice adds ONLY the backend capability; no routing config is
 * read or written anywhere, and api/calendar-publish.js is untouched.
 *
 * GET (no body) — returns the authenticated parent's writable Google
 * calendars, sanitized to exactly what a routing-selection UI needs.
 *
 * ERROR SEMANTICS — this is the one subtle part of this slice, so it's
 * spelled out here rather than only in code:
 *   - No connection at all (never connected, or disconnected) -> 400
 *     NOT_CONNECTED. Same meaning as calendar-publish.js's own check.
 *   - connection.needsReconnect (already flagged true from a PRIOR
 *     invalid_grant) -> 409 needsReconnect: true. Same meaning as
 *     everywhere else needsReconnect appears.
 *   - Token refresh itself fails with invalid_grant (discovered HERE, for
 *     the first time) -> 409 needsReconnect: true, via the exact same
 *     refreshCalendarAccessToken() path calendar-publish.js already uses,
 *     which itself calls markGoogleCalendarConnectionNeedsReconnect. This
 *     is a genuinely broken connection — publishing would fail too.
 *   - Token refresh SUCCEEDS, but Google's calendarList.list call itself
 *     returns 403 WHOSE BODY NARROWLY INDICATES INSUFFICIENT SCOPE (see
 *     isCalendarListScopeMissingError in api/_googleCalendarClient.js —
 *     Google's documented reason "insufficientPermissions", or a message
 *     like "insufficient authentication scopes"/"insufficient
 *     permission") -> this means the connection is otherwise healthy
 *     (calendar.events still works, so event publishing is UNAFFECTED)
 *     but this specific stored refresh token was never consented for
 *     calendar.calendarlist.readonly (see api/_googleOAuth.js's
 *     CALENDAR_SCOPES comment — adding a scope never retroactively grants
 *     it to an existing connection). This is intentionally NOT reported
 *     as needsReconnect (that would incorrectly suggest publishing is
 *     also broken, and would incorrectly point the existing "Reconnect"
 *     button's copy at the wrong problem). Instead: 403 with
 *     code: "CALENDAR_LIST_SCOPE_MISSING" — a parent still needs to
 *     reconnect to use this specific feature, but nothing else about
 *     their Calendar connection is broken. No scope string is stored or
 *     compared anywhere to reach this conclusion — Google's own live
 *     response is the only source of truth (see listCalendars's own doc
 *     comment in api/_googleCalendarClient.js).
 *   - A 403 whose body does NOT narrowly indicate insufficient scope
 *     (quota, rate limiting, or any other cause) -> a generic, retryable
 *     failure, same as any other non-ok status. Never reported as
 *     CALENDAR_LIST_SCOPE_MISSING and never as needsReconnect — a 403
 *     status code alone is not, by itself, evidence of either.
 *
 * Security: every Google API call and every token happens server-side
 * only; the response never includes an access or refresh token. Only the
 * sanitized { id, summary, primary, accessRole } shape listCalendars
 * already produces is ever returned.
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { getGoogleCalendarConnection } from "./_googleCalendarConnectionsStore.js";
import { refreshCalendarAccessToken, listCalendars } from "./_googleCalendarClient.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
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

  let connection;
  try {
    connection = await getGoogleCalendarConnection(uid);
  } catch (err) {
    console.error("calendar-list: getGoogleCalendarConnection failed:", err?.message);
    return res.status(500).json({ ok: false, error: "Could not load your Google Calendar connection." });
  }
  if (!connection?.refreshToken) {
    return res.status(400).json({ ok: false, code: "NOT_CONNECTED", error: "Connect Google Calendar in Parent Tools first." });
  }
  if (connection.needsReconnect) {
    return res.status(409).json({ ok: false, needsReconnect: true, error: "Reconnect Google Calendar in Parent Tools." });
  }

  const refreshed = await refreshCalendarAccessToken(uid, connection);
  if (!refreshed.ok) {
    if (refreshed.needsReconnect) {
      return res.status(409).json({ ok: false, needsReconnect: true, error: "Reconnect Google Calendar in Parent Tools." });
    }
    return res.status(502).json({ ok: false, error: refreshed.error || "Could not connect to Google Calendar. Please try again." });
  }

  const result = await listCalendars({ accessToken: refreshed.accessToken });
  if (!result.ok) {
    if (result.scopeMissing) {
      return res.status(403).json({
        ok: false,
        code: "CALENDAR_LIST_SCOPE_MISSING",
        error: "Reconnect Google Calendar to grant permission to list your calendars.",
      });
    }
    return res.status(502).json({ ok: false, error: result.error || "Could not load your Google calendars. Please try again." });
  }

  return res.status(200).json({ ok: true, calendars: result.calendars });
}
