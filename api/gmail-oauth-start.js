/* ============================== Gmail OAuth — start ==============================
 * Requires a real Firebase-authenticated parent (guest/local mode has no
 * account to attach a Gmail connection to — see api/_auth.js). Generates a
 * cryptographically strong, UID-bound, short-lived `state` value and a PKCE
 * pair, stores them server-side (see api/_gmailConnectionsStore.js), and
 * returns Google's authorization URL for the browser to navigate to.
 *
 * Returns JSON rather than issuing a redirect itself: a plain top-level
 * browser navigation can't carry an Authorization: Bearer header, so the
 * client calls this as an authenticated fetch and then performs the actual
 * navigation to the returned authUrl itself (see src/data/gmailConnection.js).
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { generateState, generatePkcePair, buildAuthorizationUrl, getOAuthConfig, GMAIL_SCOPES } from "./_googleOAuth.js";
import { createOAuthState } from "./_gmailConnectionsStore.js";

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

  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  if (!clientId || !clientSecret || !redirectUri) {
    console.error("gmail-oauth-start: missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_OAUTH_REDIRECT_URI");
    return res.status(500).json({ ok: false, error: "Gmail connection is not configured on this server." });
  }

  try {
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkcePair();
    await createOAuthState(state, { uid, codeVerifier });
    const authUrl = buildAuthorizationUrl({ state, codeChallenge, scopes: GMAIL_SCOPES });
    return res.status(200).json({ ok: true, authUrl });
  } catch (err) {
    console.error("gmail-oauth-start error:", err);
    return res.status(500).json({ ok: false, error: "Could not start Gmail connection. Please try again." });
  }
}
