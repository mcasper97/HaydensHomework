/* ============================== Google Calendar OAuth — start ==============================
 * Slice B — mirrors api/gmail-oauth-start.js's exact structure and
 * requirements, on Calendar's own OAuth state collection and scope.
 * Requires a real Firebase-authenticated parent (guest/local mode has no
 * account to attach a Calendar connection to — see api/_auth.js).
 * Generates a cryptographically strong, UID-bound, short-lived `state`
 * value and a PKCE pair, stores them server-side (see
 * api/_googleCalendarConnectionsStore.js), and returns Google's
 * authorization URL for the browser to navigate to. Requests
 * CALENDAR_SCOPES only (calendar.events) — never Gmail's scope, never a
 * broader Calendar scope, never an identity/profile scope.
 *
 * Returns JSON rather than issuing a redirect itself, for the same reason
 * as gmail-oauth-start.js: a plain top-level browser navigation can't
 * carry an Authorization: Bearer header, so the client calls this as an
 * authenticated fetch and then performs the actual navigation to the
 * returned authUrl itself (see src/data/googleCalendarConnection.js).
 *
 * Requires GOOGLE_CALENDAR_OAUTH_REDIRECT_URI to be configured (pointing
 * at api/calendar-oauth-callback.js) — deliberately a SEPARATE env var
 * from Gmail's GOOGLE_OAUTH_REDIRECT_URI, since each feature has its own
 * registered callback endpoint. GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are
 * shared (one registered OAuth client for both features).
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { generateState, generatePkcePair, buildAuthorizationUrl, getOAuthConfig, CALENDAR_SCOPES } from "./_googleOAuth.js";
import { createOAuthState } from "./_googleCalendarConnectionsStore.js";

const REDIRECT_URI_ENV_VAR = "GOOGLE_CALENDAR_OAUTH_REDIRECT_URI";

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

  const { clientId, clientSecret, redirectUri } = getOAuthConfig(REDIRECT_URI_ENV_VAR);
  if (!clientId || !clientSecret || !redirectUri) {
    console.error("calendar-oauth-start: missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_CALENDAR_OAUTH_REDIRECT_URI");
    return res.status(500).json({ ok: false, error: "Google Calendar connection is not configured on this server." });
  }

  try {
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkcePair();
    await createOAuthState(state, { uid, codeVerifier });
    const authUrl = buildAuthorizationUrl({ state, codeChallenge, scopes: CALENDAR_SCOPES, redirectUriEnvVar: REDIRECT_URI_ENV_VAR });
    return res.status(200).json({ ok: true, authUrl });
  } catch (err) {
    console.error("calendar-oauth-start error:", err);
    return res.status(500).json({ ok: false, error: "Could not start Google Calendar connection. Please try again." });
  }
}
