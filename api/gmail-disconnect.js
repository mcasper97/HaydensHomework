/* ============================== Gmail OAuth — disconnect ==============================
 * Requires Firebase authentication. Always deletes the local credential
 * regardless of remote revocation outcome.
 *
 * CONDITIONAL revoke (Slice B correction — applied symmetrically with
 * api/calendar-disconnect.js; see that file's doc comment for the full
 * reasoning about Google's documented "combined authorization" revocation
 * behavior). Gmail and Calendar share the same registered OAuth client for
 * the same Google user, so calling Google's /revoke endpoint on Gmail's
 * refresh token while Calendar is still connected could cascade and break
 * Calendar too — never risk that while another integration is active:
 *
 *   Calendar is ALSO connected -> delete only the local Gmail credential;
 *                                  do NOT call Google's revoke endpoint.
 *   Gmail is the LAST active Google integration for this user
 *                               -> best-effort remote revoke (see
 *                                  _googleOAuth.js's revokeToken, which
 *                                  never throws), then delete the local
 *                                  credential — the original, unchanged
 *                                  behavior for that case.
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { revokeToken } from "./_googleOAuth.js";
import { getGmailConnection, deleteGmailConnection } from "./_gmailConnectionsStore.js";
import { getGoogleCalendarConnection } from "./_googleCalendarConnectionsStore.js";

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

  try {
    const existing = await getGmailConnection(uid);
    if (existing?.refreshToken) {
      const calendarStillConnected = !!(await getGoogleCalendarConnection(uid));
      if (!calendarStillConnected) {
        await revokeToken(existing.refreshToken);
      }
    }
    await deleteGmailConnection(uid);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("gmail-disconnect error:", err);
    return res.status(500).json({ ok: false, error: "Could not disconnect Gmail. Please try again." });
  }
}
