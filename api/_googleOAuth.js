/* ============================== Google OAuth (Gmail readonly) protocol helpers ==============================
 * Pure OAuth 2.0 protocol logic for connecting one Gmail account per parent
 * (#26, Commit 3 — connection only, no mail reading yet). Deliberately
 * built on Node's built-in `crypto`/`fetch` only — no
 * new npm dependency. `google-auth-library` is present in node_modules,
 * but only as a transitive dependency pulled in by firebase-admin's own
 * internals (several different versions coexist for that reason); it was
 * never declared in package.json, so importing it directly here would mean
 * silently depending on whatever version firebase-admin happens to vendor
 * on any given install — fragile, and not really "no new dependency" in
 * any meaningful sense. The actual protocol needed here is a handful of
 * well-documented HTTP calls plus standard crypto primitives, the same
 * reasoning that kept api/_urlSafety.js and api/_htmlToText.js dependency-free.
 *
 * PKCE (RFC 7636, S256) is used even though this is a confidential client
 * (we hold a client secret) — it's a few lines on top of the state
 * generation already needed, and adds real defense-in-depth against
 * authorization-code interception for negligible extra complexity.
 *
 * This module has no knowledge of Firestore, request/response objects, or
 * any specific user/uid — see api/_gmailConnectionsStore.js for storage,
 * and the api/gmail-oauth-*.js files for the actual HTTP endpoints.
 * `fetchFn` is injectable throughout for offline unit testing.
 */
import crypto from "node:crypto";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GMAIL_PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

// Exactly the one scope this feature needs. Nothing else (Drive, Calendar,
// Contacts, a profile/identity scope, Gmail modify/send) is requested. The
// connected account's email address is obtained after the token exchange
// via the Gmail API's own profile endpoint (see fetchGmailProfile below),
// which gmail.readonly already authorizes — no separate identity scope
// (openid/email) is needed just to learn which address got connected.
export const OAUTH_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function getOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || "",
  };
}

export function generateState() {
  return crypto.randomBytes(32).toString("base64url");
}

export function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizationUrl({ state, codeChallenge }) {
  const { clientId, redirectUri } = getOAuthConfig();
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  // Forces Google to hand back a refresh token even on a reconnect where
  // the account previously granted consent — without this, Google only
  // issues a refresh token the very first time an account consents.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Exchanges an authorization code for tokens. Returns Google's raw token
 * response ({ access_token, refresh_token?, expires_in, scope, token_type })
 * — callers decide what (if anything) to persist. No id_token is requested
 * or returned (no openid scope — see fetchGmailProfile for how the
 * connected account's identity is obtained instead).
 */
export async function exchangeCodeForTokens({ code, codeVerifier, fetchFn = fetch }) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  const res = await fetchFn(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error_description || json?.error || "Token exchange failed");
    err.tokenError = json;
    throw err;
  }
  return json;
}

/**
 * Best-effort revoke. Never throws — a failed remote revocation must never
 * block the local credential from being deleted (see gmail-disconnect.js).
 */
export async function revokeToken(token, { fetchFn = fetch } = {}) {
  if (!token) return false;
  try {
    const res = await fetchFn(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Looks up the connected Gmail account's address via the Gmail API's own
 * profile endpoint, using the access token from the just-completed token
 * exchange. This is the identity source for the connection — deliberately
 * used instead of an OIDC identity scope (openid/email) precisely because
 * gmail.readonly already authorizes it, so no additional consent scope is
 * needed just to learn which address got connected. Returns null (never
 * throws) on any failure — the connection can still be stored without an
 * email address; the caller decides what that means for the UI.
 */
export async function fetchGmailProfile(accessToken, { fetchFn = fetch } = {}) {
  if (!accessToken) return null;
  try {
    const res = await fetchFn(GMAIL_PROFILE_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.emailAddress === "string" ? json.emailAddress : null;
  } catch {
    return null;
  }
}
