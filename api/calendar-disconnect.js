/* ============================== Google Calendar OAuth — disconnect ==============================
 * Slice B. Requires Firebase authentication.
 *
 * CONDITIONAL revoke (verified design correction after inspecting Google's
 * documented OAuth behavior — see the Slice B design discussion): Google's
 * own documentation states that revoking a token belonging to a "combined
 * authorization" revokes every scope of that authorization at once, and
 * incremental-authorization guidance describes scopes for the same
 * client_id + user commonly being consolidated rather than kept as fully
 * independent, separately-revocable grants. Since Gmail and Calendar share
 * the same registered OAuth client (GOOGLE_CLIENT_ID) for the same Google
 * user, calling Google's /revoke endpoint on the Calendar refresh token
 * COULD cascade and invalidate Gmail's still-in-use access too — this was
 * never empirically verifiable from this environment, so the safe design
 * is to never risk it while another Hayden's Homework Google integration
 * is still active:
 *
 *   Gmail is ALSO connected  -> delete only the local Calendar credential;
 *                                do NOT call Google's revoke endpoint.
 *   Calendar is the LAST active Google integration for this user
 *                             -> best-effort remote revoke (see
 *                                _googleOAuth.js's revokeToken, which never
 *                                throws), then delete the local credential.
 *
 * "Gmail is connected" is decided by whether a gmailConnections/{uid}
 * record exists at all — including one currently flagged needsReconnect —
 * since that still represents an unresolved Google-side grant the parent
 * hasn't gone through Google's own account-level "remove access" flow for;
 * only the LOCAL credential being entirely deleted (via this same
 * conditional logic, symmetrically applied in gmail-disconnect.js) means
 * "no longer connected" for this purposes.
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { revokeToken } from "./_googleOAuth.js";
import { getGoogleCalendarConnection, deleteGoogleCalendarConnection } from "./_googleCalendarConnectionsStore.js";
import { getGmailConnection } from "./_gmailConnectionsStore.js";

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
    const existing = await getGoogleCalendarConnection(uid);
    if (existing?.refreshToken) {
      const gmailStillConnected = !!(await getGmailConnection(uid));
      if (!gmailStillConnected) {
        await revokeToken(existing.refreshToken);
      }
    }
    await deleteGoogleCalendarConnection(uid);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("calendar-disconnect error:", err);
    return res.status(500).json({ ok: false, error: "Could not disconnect Google Calendar. Please try again." });
  }
}
