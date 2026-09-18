/* ============================== Gmail OAuth — callback ==============================
 * Google redirects the parent's browser here after consent
 * (?code=...&state=...), or with ?error=... if they declined. This is a
 * plain top-level browser navigation, so there is no Authorization header
 * to read — the Firebase UID this callback acts on comes ONLY from the
 * server-side state record created by gmail-oauth-start.js (see
 * api/_gmailConnectionsStore.js's consumeOAuthState). No client-supplied
 * identifier (query param, cookie, etc.) is ever trusted for this.
 *
 * Always redirects back into the app with only a bare success/failure
 * indicator — never a token, code, or any credential material.
 */
import { exchangeCodeForTokens, fetchGmailProfile } from "./_googleOAuth.js";
import { consumeOAuthState, upsertGmailConnection } from "./_gmailConnectionsStore.js";

function redirectWithResult(res, result) {
  res.writeHead(302, { Location: `/?gmail=${result}` });
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
    console.error("gmail-oauth-callback: state lookup failed:", err);
    return redirectWithResult(res, "error");
  }
  if (!stateRecord) {
    return redirectWithResult(res, "error");
  }
  const { uid, codeVerifier } = stateRecord;

  try {
    const tokens = await exchangeCodeForTokens({ code, codeVerifier });
    const emailAddress = await fetchGmailProfile(tokens.access_token);
    await upsertGmailConnection(uid, {
      refreshToken: tokens.refresh_token || undefined,
      emailAddress,
      connectedAt: new Date().toISOString(),
    });
    return redirectWithResult(res, "success");
  } catch (err) {
    console.error("gmail-oauth-callback error:", err);
    return redirectWithResult(res, "error");
  }
}
