/* ============================== Gmail OAuth — disconnect ==============================
 * Requires Firebase authentication. Attempts to revoke the stored refresh
 * token with Google (best-effort — see _googleOAuth.js's revokeToken,
 * which never throws), then always deletes the local credential regardless
 * of whether remote revocation succeeded. This is the only account-
 * unlinking behavior in scope for this commit.
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { revokeToken } from "./_googleOAuth.js";
import { getGmailConnection, deleteGmailConnection } from "./_gmailConnectionsStore.js";

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
      await revokeToken(existing.refreshToken);
    }
    await deleteGmailConnection(uid);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("gmail-disconnect error:", err);
    return res.status(500).json({ ok: false, error: "Could not disconnect Gmail. Please try again." });
  }
}
