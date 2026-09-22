/**
 * Focused unit tests for the Gmail OAuth connection foundation (#26,
 * Commit 3): api/_googleOAuth.js (pure protocol logic, DNS/network-free —
 * fetch is injected) and api/_gmailConnectionsStore.js (Firestore admin
 * access, tested against a small in-memory fake `db` so no live Firebase
 * project is needed).
 *
 * Deliberately does NOT attempt a live Google OAuth flow, and does NOT
 * mock the serverless req/res handlers in api/gmail-oauth-start.js etc. —
 * those require a live, configured Firebase Admin SDK to exercise
 * meaningfully (requireFirebaseUser calls the real Admin SDK's
 * verifyIdToken()), which this sandbox does not have, exactly the same
 * constraint already documented in tests/extract-obligations.unit.mjs.
 * What's tested here is every piece of logic those handlers are built
 * from: scope minimality (gmail.readonly only, no openid/email identity
 * scope), state generation/binding/expiry/consumption, PKCE, token
 * exchange request shape, revoke's never-throws contract, identity lookup
 * via the Gmail API's own profile endpoint, refresh-token retention on
 * reconnect, and the client-safe sanitization boundary that keeps tokens
 * out of any response the browser can see.
 *
 * Usage: node tests/gmail-oauth.unit.mjs
 */
import crypto from "node:crypto";
import {
  GMAIL_SCOPES,
  CALENDAR_SCOPES,
  generateState,
  generatePkcePair,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
  fetchGmailProfile,
} from "../api/_googleOAuth.js";
import {
  getGmailConnection,
  upsertGmailConnection,
  deleteGmailConnection,
  markGmailConnectionNeedsReconnect,
  sanitizeGmailConnectionForClient,
  createOAuthState,
  consumeOAuthState,
} from "../api/_gmailConnectionsStore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ _googleOAuth.js: scope minimality ============
ok("Requests gmail.readonly, not a broader Gmail scope", GMAIL_SCOPES.includes("https://www.googleapis.com/auth/gmail.readonly"));
ok("Does not request Gmail modify/send", !GMAIL_SCOPES.some((s) => /gmail\.(modify|send)/.test(s)));
ok("Does not request Drive/Calendar/Contacts", !GMAIL_SCOPES.some((s) => /drive|calendar|contacts/i.test(s)));
ok("Requests gmail.readonly and nothing else — no openid/email identity scope", GMAIL_SCOPES.length === 1);
ok("Does not request the openid scope", !GMAIL_SCOPES.includes("openid"));
ok("Does not request the email scope", !GMAIL_SCOPES.includes("email"));

// ============ _googleOAuth.js: Gmail and Calendar scope lists stay independent (Slice B) ============
ok("GMAIL_SCOPES and CALENDAR_SCOPES are two distinct, non-overlapping lists", !GMAIL_SCOPES.some((s) => CALENDAR_SCOPES.includes(s)));
ok("CALENDAR_SCOPES requests exactly calendar.events and calendar.calendarlist.readonly, nothing else (Slice C.1A)", CALENDAR_SCOPES.length === 2 && CALENDAR_SCOPES.includes("https://www.googleapis.com/auth/calendar.events") && CALENDAR_SCOPES.includes("https://www.googleapis.com/auth/calendar.calendarlist.readonly"));
ok("CALENDAR_SCOPES does not request the broader calendar scope", !CALENDAR_SCOPES.includes("https://www.googleapis.com/auth/calendar"));
ok("CALENDAR_SCOPES does not request the broader calendarlist scope (readonly variant only)", !CALENDAR_SCOPES.includes("https://www.googleapis.com/auth/calendar.calendarlist"));
ok("CALENDAR_SCOPES does not request an identity/profile scope", !CALENDAR_SCOPES.includes("openid") && !CALENDAR_SCOPES.includes("email"));
ok("Gmail scopes are unchanged by the Slice C.1A Calendar scope expansion", GMAIL_SCOPES.length === 1 && GMAIL_SCOPES[0] === "https://www.googleapis.com/auth/gmail.readonly");

// ============ generateState ============
{
  const a = generateState();
  const b = generateState();
  ok("generateState produces a non-trivial-length string", typeof a === "string" && a.length >= 32);
  ok("generateState produces different values on each call", a !== b);
  ok("generateState output is URL-safe (no +, /, or = padding)", !/[+/=]/.test(a));
}

// ============ generatePkcePair (RFC 7636 S256) ============
{
  const { codeVerifier, codeChallenge } = generatePkcePair();
  ok("codeVerifier meets the minimum 43-character length RFC 7636 requires", codeVerifier.length >= 43);
  const expectedChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  ok("codeChallenge is exactly BASE64URL(SHA256(codeVerifier)) per S256", codeChallenge === expectedChallenge);
  const { codeVerifier: v2 } = generatePkcePair();
  ok("Each PKCE pair uses a fresh, different codeVerifier", codeVerifier !== v2);
}

// ============ buildAuthorizationUrl ============
{
  const prevId = process.env.GOOGLE_CLIENT_ID;
  const prevRedirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://example.test/api/gmail-oauth-callback";

  const url = new URL(buildAuthorizationUrl({ state: "abc123", codeChallenge: "xyz789", scopes: GMAIL_SCOPES }));
  ok("Authorization URL points at Google's OAuth endpoint", url.origin === "https://accounts.google.com");
  ok("Includes the configured client_id", url.searchParams.get("client_id") === "test-client-id");
  ok("Includes the configured redirect_uri", url.searchParams.get("redirect_uri") === "https://example.test/api/gmail-oauth-callback");
  ok("Includes response_type=code", url.searchParams.get("response_type") === "code");
  ok("Requests exactly the gmail.readonly scope string, nothing else", url.searchParams.get("scope") === "https://www.googleapis.com/auth/gmail.readonly");
  ok("Gmail auth URL still contains gmail.readonly (Slice B regression check)", url.searchParams.get("scope").includes("gmail.readonly"));
  ok("Gmail auth URL does NOT contain calendar.events", !url.searchParams.get("scope").includes("calendar.events"));
  ok("Includes the state value", url.searchParams.get("state") === "abc123");
  ok("Includes the PKCE code_challenge", url.searchParams.get("code_challenge") === "xyz789");
  ok("Uses S256 as the code_challenge_method", url.searchParams.get("code_challenge_method") === "S256");
  ok("Requests offline access (needed for a refresh token)", url.searchParams.get("access_type") === "offline");

  // ---- Slice B: passing CALENDAR_SCOPES to the SAME shared builder produces a Calendar-scoped URL, and doesn't disturb Gmail's own env var ----
  const calendarUrl = new URL(buildAuthorizationUrl({ state: "abc123", codeChallenge: "xyz789", scopes: CALENDAR_SCOPES }));
  ok("Calendar auth URL contains calendar.events", calendarUrl.searchParams.get("scope").includes("https://www.googleapis.com/auth/calendar.events"));
  // ---- Slice C.1A: the auth URL now requests BOTH Calendar scopes ----
  ok("Calendar auth URL also contains calendar.calendarlist.readonly (Slice C.1A)", calendarUrl.searchParams.get("scope").includes("https://www.googleapis.com/auth/calendar.calendarlist.readonly"));
  ok("Calendar auth URL does NOT contain gmail.readonly", !calendarUrl.searchParams.get("scope").includes("gmail.readonly"));
  ok(
    "Calendar auth URL (built with no redirectUriEnvVar override) still falls back to Gmail's default redirect env var — proving the default truly matches Gmail's pre-existing behavior",
    calendarUrl.searchParams.get("redirect_uri") === "https://example.test/api/gmail-oauth-callback"
  );

  process.env.GOOGLE_CLIENT_ID = prevId;
  process.env.GOOGLE_OAUTH_REDIRECT_URI = prevRedirect;
}

// ============ buildAuthorizationUrl: redirectUriEnvVar parameterization (Slice B) ============
{
  const prevId = process.env.GOOGLE_CLIENT_ID;
  const prevGmailRedirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const prevCalendarRedirect = process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI;
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://example.test/api/gmail-oauth-callback";
  process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI = "https://example.test/api/calendar-oauth-callback";

  const gmailUrl = new URL(buildAuthorizationUrl({ state: "s", codeChallenge: "c", scopes: GMAIL_SCOPES }));
  const calendarUrl = new URL(buildAuthorizationUrl({ state: "s", codeChallenge: "c", scopes: CALENDAR_SCOPES, redirectUriEnvVar: "GOOGLE_CALENDAR_OAUTH_REDIRECT_URI" }));
  ok("Gmail's URL uses Gmail's own redirect_uri env var by default", gmailUrl.searchParams.get("redirect_uri") === "https://example.test/api/gmail-oauth-callback");
  ok("Calendar's URL uses its OWN, separate redirect_uri env var when explicitly named", calendarUrl.searchParams.get("redirect_uri") === "https://example.test/api/calendar-oauth-callback");
  ok("Gmail and Calendar authorization URLs use two DIFFERENT redirect_uri values", gmailUrl.searchParams.get("redirect_uri") !== calendarUrl.searchParams.get("redirect_uri"));

  process.env.GOOGLE_CLIENT_ID = prevId;
  process.env.GOOGLE_OAUTH_REDIRECT_URI = prevGmailRedirect;
  process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI = prevCalendarRedirect;
}

// ============ exchangeCodeForTokens ============
{
  let capturedBody = null;
  const fetchFn = async (url, options) => {
    capturedBody = new URLSearchParams(options.body);
    return { ok: true, json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }) };
  };
  const result = await exchangeCodeForTokens({ code: "auth-code-123", codeVerifier: "verifier-abc", fetchFn });
  ok("Sends grant_type=authorization_code", capturedBody.get("grant_type") === "authorization_code");
  ok("Sends the authorization code", capturedBody.get("code") === "auth-code-123");
  ok("Sends the PKCE code_verifier", capturedBody.get("code_verifier") === "verifier-abc");
  ok("Returns the parsed token response on success", result.access_token === "at" && result.refresh_token === "rt");
}
{
  const fetchFn = async () => ({ ok: false, json: async () => ({ error: "invalid_grant" }) });
  let threw = false;
  try {
    await exchangeCodeForTokens({ code: "bad", codeVerifier: "v", fetchFn });
  } catch {
    threw = true;
  }
  ok("Throws when Google's token endpoint reports an error", threw);
}

// ============ revokeToken: best-effort, never throws ============
{
  const fetchFn = async () => ({ ok: true });
  ok("Returns true on a successful revoke", await revokeToken("some-refresh-token", { fetchFn }) === true);
}
{
  const fetchFn = async () => ({ ok: false });
  ok("Returns false (not a throw) when Google reports revoke failure", await revokeToken("some-refresh-token", { fetchFn }) === false);
}
{
  const fetchFn = async () => { throw new Error("network down"); };
  let threw = false;
  let result;
  try {
    result = await revokeToken("some-refresh-token", { fetchFn });
  } catch {
    threw = true;
  }
  ok("Never throws even when the network call itself fails", !threw && result === false);
}
ok("Returns false immediately for an empty token, without calling fetch", await revokeToken(null) === false);

// ============ fetchGmailProfile: identity via the Gmail API, not an ID token ============
{
  let capturedUrl = null, capturedHeaders = null;
  const fetchFn = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return { ok: true, json: async () => ({ emailAddress: "parent@example.com", messagesTotal: 42 }) };
  };
  const email = await fetchGmailProfile("access-token-abc", { fetchFn });
  ok("Calls the Gmail API's users/me/profile endpoint", capturedUrl === "https://gmail.googleapis.com/gmail/v1/users/me/profile");
  ok("Authenticates the profile request with the access token, not a fabricated/decoded identity", capturedHeaders.Authorization === "Bearer access-token-abc");
  ok("Returns the emailAddress from the Gmail API response", email === "parent@example.com");
}
{
  const fetchFn = async () => ({ ok: false });
  ok("Returns null (not a throw) when the Gmail API profile call fails", await fetchGmailProfile("token", { fetchFn }) === null);
}
{
  const fetchFn = async () => { throw new Error("network down"); };
  let threw = false;
  const result = await (async () => { try { return await fetchGmailProfile("token", { fetchFn }); } catch { threw = true; return undefined; } })();
  ok("Never throws even when the network call itself fails", !threw && result === null);
}
ok("Returns null immediately for a missing access token, without calling fetch", await fetchGmailProfile(null) === null);
{
  const fetchFn = async () => ({ ok: true, json: async () => ({ messagesTotal: 42 }) }); // no emailAddress key
  ok("Returns null when the Gmail API response is missing emailAddress", await fetchGmailProfile("token", { fetchFn }) === null);
}

// ============ _gmailConnectionsStore.js: fake Firestore db ============
function createFakeDb() {
  const store = new Map();
  return {
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async get() {
              const data = store.get(key);
              return { exists: data !== undefined, data: () => data };
            },
            async set(data) {
              store.set(key, data);
            },
            async delete() {
              store.delete(key);
            },
          };
        },
      };
    },
  };
}

// ---- gmailConnections: create, read, retain-refresh-token-on-reconnect, delete ----
{
  const db = createFakeDb();
  ok("No connection exists before anything is stored", await getGmailConnection("uid-1", { db }) === null);

  await upsertGmailConnection("uid-1", { refreshToken: "rt-1", emailAddress: "a@example.com", connectedAt: "2026-01-01T00:00:00.000Z" }, { db });
  const first = await getGmailConnection("uid-1", { db });
  ok("Stores the refresh token on first connect", first.refreshToken === "rt-1");
  ok("Stores the connected email address", first.emailAddress === "a@example.com");
  ok("needsReconnect starts false", first.needsReconnect === false);

  // Reconnect: Google omits a fresh refresh_token this time (common,
  // expected behavior) — the previously stored one must be kept, not lost.
  await upsertGmailConnection("uid-1", { emailAddress: "a@example.com", connectedAt: "2026-02-01T00:00:00.000Z" }, { db });
  const second = await getGmailConnection("uid-1", { db });
  ok("Retains the existing refresh token when reconnect omits a new one", second.refreshToken === "rt-1");
  ok("connectedAt still updates on reconnect", second.connectedAt === "2026-02-01T00:00:00.000Z");
}
{
  const db = createFakeDb();
  let threw = false;
  try {
    await upsertGmailConnection("uid-2", { emailAddress: "a@example.com" }, { db });
  } catch {
    threw = true;
  }
  ok("Throws rather than silently storing a connection with no refresh token at all", threw);
}
{
  const db = createFakeDb();
  await upsertGmailConnection("uid-3", { refreshToken: "rt-3" }, { db });
  ok("Connection exists before delete", (await getGmailConnection("uid-3", { db })) !== null);
  await deleteGmailConnection("uid-3", { db });
  ok("deleteGmailConnection removes the stored credential", (await getGmailConnection("uid-3", { db })) === null);
}

// ---- sanitizeGmailConnectionForClient: never leaks tokens ----
{
  const sanitized = sanitizeGmailConnectionForClient({ refreshToken: "super-secret", accessToken: "also-secret", emailAddress: "a@example.com", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" });
  ok("Sanitized output never contains a refreshToken key", !("refreshToken" in sanitized));
  ok("Sanitized output never contains an accessToken key", !("accessToken" in sanitized));
  ok("Sanitized output reports connected: true", sanitized.connected === true);
  ok("Sanitized output surfaces the email address", sanitized.emailAddress === "a@example.com");
}
{
  const sanitized = sanitizeGmailConnectionForClient(null);
  ok("No stored connection sanitizes to a clean disconnected shape", sanitized.connected === false && sanitized.emailAddress === null && sanitized.needsReconnect === false);
}

// ---- OAuth state: create, consume-once, expiry, unknown-state ----
{
  const db = createFakeDb();
  await createOAuthState("state-1", { uid: "uid-9", codeVerifier: "verifier-9" }, { db });
  const consumed = await consumeOAuthState("state-1", { db });
  ok("Consuming a valid, unexpired state returns the bound uid", consumed?.uid === "uid-9");
  ok("Consuming a valid state returns the bound codeVerifier (for the token exchange)", consumed?.codeVerifier === "verifier-9");

  const consumedAgain = await consumeOAuthState("state-1", { db });
  ok("The same state cannot be consumed a second time (replay protection)", consumedAgain === null);
}
{
  const db = createFakeDb();
  ok("Consuming a state that was never created returns null", (await consumeOAuthState("never-existed", { db })) === null);
}
{
  const db = createFakeDb();
  // Write an already-expired state directly (bypassing createOAuthState's
  // own TTL math) to test the expiry branch deterministically.
  await db.collection("gmailOAuthStates").doc("expired-state").set({ uid: "uid-5", codeVerifier: "v", expiresAt: Date.now() - 1000 });
  const result = await consumeOAuthState("expired-state", { db });
  ok("An expired state is rejected even though it was found", result === null);
  const secondLookup = await db.collection("gmailOAuthStates").doc("expired-state").get();
  ok("An expired state is still deleted on first consumption attempt (no lingering doc)", secondLookup.exists === false);
}
{
  ok("consumeOAuthState fails closed on a non-string state (e.g. an array from a repeated query param)", (await consumeOAuthState(["x", "y"], { db: createFakeDb() })) === null);
  ok("consumeOAuthState fails closed on an empty state", (await consumeOAuthState("", { db: createFakeDb() })) === null);
}

// ============ refreshAccessToken (#26, Commit 5) ============
{
  let capturedBody = null;
  const fetchFn = async (url, options) => {
    capturedBody = new URLSearchParams(options.body);
    return { ok: true, json: async () => ({ access_token: "new-at", expires_in: 3600, scope: "gmail.readonly", token_type: "Bearer" }) };
  };
  const result = await refreshAccessToken("stored-refresh-token", { fetchFn });
  ok("Sends grant_type=refresh_token", capturedBody.get("grant_type") === "refresh_token");
  ok("Sends the stored refresh token", capturedBody.get("refresh_token") === "stored-refresh-token");
  ok("Returns the new access token on success", result.access_token === "new-at");
}
{
  const fetchFn = async () => ({ ok: false, json: async () => ({ error: "invalid_grant", error_description: "Token has been expired or revoked." }) });
  let caught = null;
  try {
    await refreshAccessToken("revoked-token", { fetchFn });
  } catch (err) {
    caught = err;
  }
  ok("Throws when Google reports invalid_grant", caught !== null);
  ok("Flags the error as isInvalidGrant so the caller can distinguish it from a transient failure", caught?.isInvalidGrant === true);
}
{
  const fetchFn = async () => ({ ok: false, json: async () => ({ error: "server_error" }) });
  let caught = null;
  try {
    await refreshAccessToken("token", { fetchFn });
  } catch (err) {
    caught = err;
  }
  ok("A non-invalid_grant failure is NOT flagged isInvalidGrant (so it isn't mistaken for a needs-reconnect case)", caught !== null && !caught.isInvalidGrant);
}

// ============ markGmailConnectionNeedsReconnect (#26, Commit 5) ============
{
  const db = createFakeDb();
  await upsertGmailConnection("uid-10", { refreshToken: "rt-10", emailAddress: "a@example.com", connectedAt: "2026-01-01T00:00:00.000Z" }, { db });
  await markGmailConnectionNeedsReconnect("uid-10", { db });
  const conn = await getGmailConnection("uid-10", { db });
  ok("Flags an existing connection's needsReconnect as true", conn.needsReconnect === true);
  ok("Never touches the stored refresh token", conn.refreshToken === "rt-10");
  ok("Never touches the stored email address", conn.emailAddress === "a@example.com");
}
{
  const db = createFakeDb();
  // No connection exists for this uid at all.
  await markGmailConnectionNeedsReconnect("uid-11", { db });
  ok("Never creates a connection that didn't already exist (no-op)", (await getGmailConnection("uid-11", { db })) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
