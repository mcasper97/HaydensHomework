/* ============================== Google OAuth protocol helpers ==============================
 * Pure OAuth 2.0 protocol logic, shared by two independent Google
 * integrations that each get their own connect/disconnect flow and their
 * own stored credential (#26, Commit 3 — Gmail connection only, no mail
 * reading yet; Slice B — Google Calendar connect/disconnect only, no
 * Calendar API calls yet). Deliberately built on Node's built-in
 * `crypto`/`fetch` only — no new npm dependency. `google-auth-library` is
 * present in node_modules, but only as a transitive dependency pulled in
 * by firebase-admin's own internals (several different versions coexist
 * for that reason); it was never declared in package.json, so importing
 * it directly here would mean silently depending on whatever version
 * firebase-admin happens to vendor on any given install — fragile, and
 * not really "no new dependency" in any meaningful sense. The actual
 * protocol needed here is a handful of well-documented HTTP calls plus
 * standard crypto primitives, the same reasoning that kept
 * api/_urlSafety.js and api/_htmlToText.js dependency-free.
 *
 * Generalized narrowly (Slice B) so a caller supplies its own `scopes` —
 * this is NOT a multi-provider integration framework; it's still Google
 * OAuth only, with exactly two named scope lists below, one per feature.
 * `redirectUriEnvVar` is similarly parameterized: Gmail and Calendar each
 * need their own registered redirect URI (Google requires the exact
 * redirect_uri used at authorization time to also be used at token-exchange
 * time, and the two features use different callback endpoints), so each
 * reads a different environment variable. Every default below matches
 * Gmail's pre-existing behavior exactly, so gmail-oauth-start.js/
 * gmail-oauth-callback.js need no change to their own redirect-URI
 * handling — only to explicitly pass their own `scopes` now.
 *
 * PKCE (RFC 7636, S256) is used even though this is a confidential client
 * (we hold a client secret) — it's a few lines on top of the state
 * generation already needed, and adds real defense-in-depth against
 * authorization-code interception for negligible extra complexity.
 *
 * This module has no knowledge of Firestore, request/response objects, or
 * any specific user/uid — see api/_gmailConnectionsStore.js /
 * api/_googleCalendarConnectionsStore.js for storage, and the
 * api/gmail-oauth-*.js / api/calendar-oauth-*.js files for the actual HTTP
 * endpoints. `fetchFn` is injectable throughout for offline unit testing.
 */
import crypto from "node:crypto";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GMAIL_PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

const DEFAULT_REDIRECT_URI_ENV_VAR = "GOOGLE_OAUTH_REDIRECT_URI";

// Exactly the one scope Gmail ingestion needs. Nothing else (Drive,
// Calendar, Contacts, a profile/identity scope, Gmail modify/send) is
// requested. The connected account's email address is obtained after the
// token exchange via the Gmail API's own profile endpoint (see
// fetchGmailProfile below), which gmail.readonly already authorizes — no
// separate identity scope (openid/email) is needed just to learn which
// address got connected.
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// The two scopes Google Calendar publishing + routing configuration need
// (Slice B: calendar.events for event create/update/delete; Slice C.1A
// adds calendar.calendarlist.readonly, read-only access to the list of
// the account's calendars, so Parent Tools can offer them as routing
// targets — see api/calendar-list.js). Deliberately NOT the broader
// auth/calendar scope (which also grants settings/ACL management this app
// never needs) — calendarlist.readonly is the narrowest scope that
// exposes calendarList.list. No identity/profile scope is requested —
// Phase 1 never stores or displays the connected account's email address
// for Calendar (see api/calendar-oauth-callback.js).
//
// IMPORTANT: adding a scope here does NOT retroactively grant it to any
// already-connected account's stored refresh token — OAuth grants are
// per-consent, not per-code-change. An existing connection keeps working
// for event publishing (calendar.events, unchanged) but will get a 403
// from calendarList.list until the parent reconnects and re-consents to
// this new scope list (see api/calendar-list.js's own doc comment for how
// that distinction is surfaced without conflating it with a broken/
// invalid_grant connection).
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

/**
 * getOAuthConfig(redirectUriEnvVar) -> { clientId, clientSecret, redirectUri }
 * clientId/clientSecret are shared across every Google integration (one
 * registered OAuth client) — only the redirect URI differs per feature,
 * since each has its own callback endpoint registered with Google.
 */
export function getOAuthConfig(redirectUriEnvVar = DEFAULT_REDIRECT_URI_ENV_VAR) {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env[redirectUriEnvVar] || "",
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

/**
 * buildAuthorizationUrl({ state, codeChallenge, scopes, redirectUriEnvVar? })
 * `scopes` is required and explicit (no default) — every caller names the
 * exact scope list it wants (GMAIL_SCOPES or CALENDAR_SCOPES above),
 * rather than this shared builder silently favoring one feature's scope
 * over another's. `redirectUriEnvVar` defaults to Gmail's existing env var
 * name, so gmail-oauth-start.js needs no change to its own call there.
 */
export function buildAuthorizationUrl({ state, codeChallenge, scopes, redirectUriEnvVar = DEFAULT_REDIRECT_URI_ENV_VAR }) {
  const { clientId, redirectUri } = getOAuthConfig(redirectUriEnvVar);
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
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
 * connected account's identity is obtained instead). `redirectUriEnvVar`
 * must match whatever was used to build the authorization URL this code
 * came from (Google requires the two to agree).
 */
export async function exchangeCodeForTokens({ code, codeVerifier, fetchFn = fetch, redirectUriEnvVar = DEFAULT_REDIRECT_URI_ENV_VAR }) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig(redirectUriEnvVar);
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
 * Exchanges a stored refresh token for a fresh access token (#26, Commit 5
 * — needed to actually call the Gmail API). Returns Google's raw response
 * ({ access_token, expires_in, scope, token_type } — no new refresh_token
 * is issued on a refresh grant). Throws on failure; the caller (see
 * gmail-check-email.js) is expected to treat an "invalid_grant" error as
 * "this connection needs to be reconnected" and set needsReconnect
 * accordingly, rather than a generic failure.
 */
export async function refreshAccessToken(refreshToken, { fetchFn = fetch } = {}) {
  const { clientId, clientSecret } = getOAuthConfig();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetchFn(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error_description || json?.error || "Token refresh failed");
    err.tokenError = json;
    err.isInvalidGrant = json?.error === "invalid_grant";
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
