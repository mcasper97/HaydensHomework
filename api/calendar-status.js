/* ============================== Google Calendar OAuth — connection status ==============================
 * Slice B — mirrors api/gmail-status.js exactly. Small authenticated
 * endpoint returning only sanitized connection state (see
 * _googleCalendarConnectionsStore.js's sanitizeGoogleCalendarConnectionForClient)
 * — the refresh token and any other credential material never leaves the
 * server. No emailAddress field (Phase 1 never stores/displays it for
 * Calendar).
 */
import { requireFirebaseUser } from "./_auth.js";
import { getGoogleCalendarConnection, sanitizeGoogleCalendarConnectionForClient } from "./_googleCalendarConnectionsStore.js";

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

  try {
    const data = await getGoogleCalendarConnection(uid);
    return res.status(200).json({ ok: true, ...sanitizeGoogleCalendarConnectionForClient(data) });
  } catch (err) {
    console.error("calendar-status error:", err);
    return res.status(500).json({ ok: false, error: "Could not load Google Calendar connection status." });
  }
}
