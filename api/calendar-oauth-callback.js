/* ============================== Google Calendar OAuth — callback ==============================
 * Slice B — mirrors api/gmail-oauth-callback.js's exact structure. Google
 * redirects the parent's browser here after consent (?code=...&state=...),
 * or with ?error=... if they declined. This is a plain top-level browser
 * navigation, so there is no Authorization header to read — the Firebase
 * UID this callback acts on comes ONLY from the server-side state record
 * created by calendar-oauth-start.js (see
 * api/_googleCalendarConnectionsStore.js's consumeOAuthState). No
 * client-supplied identifier is ever trusted for this.
 *
 * Deliberately does NOT call any Gmail-profile-equivalent identity lookup
 * — Phase 1 never requests an identity scope or stores/displays the
 * connected account's email for Calendar (see the Slice A/B design
 * discussion: "It is acceptable for Phase 1 Calendar connection UI to say
 * 'Google Calendar connected' without displaying the Google account
 * email"). Only { refreshToken, connectedAt } is ever persisted here —
 * never mixed into gmailConnections/{uid}.
 *
 * Always redirects back into the app with only a bare success/failure
 * indicator — never a token, code, or any credential material.
 */
import { exchangeCodeForTokens } from "./_googleOAuth.js";
import { consumeOAuthState, upsertGoogleCalendarConnection } from "./_googleCalendarConnectionsStore.js";

const REDIRECT_URI_ENV_VAR = "GOOGLE_CALENDAR_OAUTH_REDIRECT_URI";

function redirectWithResult(res, result) {
  res.writeHead(302, { Location: `/?calendar=${result}` });
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { code, state, error } = req.query || {};

  if (error) {
    return redirectWithResult(res, "error");
  }
  if (!code || !state || typeof state !== "string") {
    return redirectWithResult(res, "error");
  }

  let stateRecord;
  try {
    stateRecord = await consumeOAuthState(state);
  } catch (err) {
    console.error("calendar-oauth-callback: state lookup failed:", err);
    return redirectWithResult(res, "error");
  }
  if (!stateRecord) {
    return redirectWithResult(res, "error");
  }
  const { uid, codeVerifier } = stateRecord;

  try {
    const tokens = await exchangeCodeForTokens({ code, codeVerifier, redirectUriEnvVar: REDIRECT_URI_ENV_VAR });
    await upsertGoogleCalendarConnection(uid, {
      refreshToken: tokens.refresh_token || undefined,
      connectedAt: new Date().toISOString(),
    });
    return redirectWithResult(res, "success");
  } catch (err) {
    console.error("calendar-oauth-callback error:", err);
    return redirectWithResult(res, "error");
  }
}
