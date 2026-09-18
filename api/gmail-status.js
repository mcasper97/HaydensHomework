/* ============================== Gmail OAuth — connection status ==============================
 * Small authenticated endpoint returning only sanitized connection state
 * (see _gmailConnectionsStore.js's sanitizeGmailConnectionForClient) — the
 * refresh token and any other credential material never leaves the server.
 */
import { requireFirebaseUser } from "./_auth.js";
import { getGmailConnection, sanitizeGmailConnectionForClient } from "./_gmailConnectionsStore.js";

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
    const data = await getGmailConnection(uid);
    return res.status(200).json({ ok: true, ...sanitizeGmailConnectionForClient(data) });
  } catch (err) {
    console.error("gmail-status error:", err);
    return res.status(500).json({ ok: false, error: "Could not load Gmail connection status." });
  }
}
