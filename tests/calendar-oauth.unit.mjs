/**
 * Focused unit tests for Slice B — Google Calendar connect/disconnect
 * OAuth foundation: api/_googleCalendarConnectionsStore.js (Firestore
 * admin access, tested against a small in-memory fake `db`, mirroring
 * tests/gmail-oauth.unit.mjs's exact technique so no live Firebase
 * project is needed). Scope minimality, redirect-URI parameterization,
 * and _googleOAuth.js's shared protocol logic are covered directly in the
 * (updated) tests/gmail-oauth.unit.mjs, since that's the one place both
 * Gmail's and Calendar's use of the shared module are compared side by
 * side — this file focuses on the Calendar-specific connection store.
 *
 * Deliberately does NOT attempt a live Google OAuth flow, and does NOT
 * mock the serverless req/res handlers in api/calendar-oauth-start.js
 * etc. here — see tests/calendar-disconnect.unit.mjs (module-mocked) for
 * the disconnect endpoints, which DO need to exercise the real handler
 * functions to prove the conditional-revoke behavior.
 *
 * Usage: node tests/calendar-oauth.unit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getGoogleCalendarConnection,
  upsertGoogleCalendarConnection,
  deleteGoogleCalendarConnection,
  markGoogleCalendarConnectionNeedsReconnect,
  sanitizeGoogleCalendarConnectionForClient,
  createOAuthState,
  consumeOAuthState,
} from "../api/_googleCalendarConnectionsStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

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

// ---- googleCalendarConnections: create, read, retain-refresh-token-on-reconnect, delete ----
{
  const db = createFakeDb();
  ok("No connection exists before anything is stored", await getGoogleCalendarConnection("uid-1", { db }) === null);

  await upsertGoogleCalendarConnection("uid-1", { refreshToken: "rt-1", connectedAt: "2026-01-01T00:00:00.000Z" }, { db });
  const first = await getGoogleCalendarConnection("uid-1", { db });
  ok("Stores the refresh token on first connect", first.refreshToken === "rt-1");
  ok("needsReconnect starts false", first.needsReconnect === false);
  ok("Never stores an emailAddress field — Phase 1 does not request an identity scope for Calendar", !("emailAddress" in first));

  // Reconnect: Google omits a fresh refresh_token this time (common,
  // expected behavior) — the previously stored one must be kept, not lost.
  await upsertGoogleCalendarConnection("uid-1", { connectedAt: "2026-02-01T00:00:00.000Z" }, { db });
  const second = await getGoogleCalendarConnection("uid-1", { db });
  ok("Retains the existing refresh token when reconnect omits a new one", second.refreshToken === "rt-1");
  ok("connectedAt still updates on reconnect", second.connectedAt === "2026-02-01T00:00:00.000Z");
}
{
  const db = createFakeDb();
  let threw = false;
  try {
    await upsertGoogleCalendarConnection("uid-2", { connectedAt: "2026-01-01T00:00:00.000Z" }, { db });
  } catch {
    threw = true;
  }
  ok("Throws rather than silently storing a connection with no refresh token at all", threw);
}
{
  const db = createFakeDb();
  await upsertGoogleCalendarConnection("uid-3", { refreshToken: "rt-3" }, { db });
  ok("Connection exists before delete", (await getGoogleCalendarConnection("uid-3", { db })) !== null);
  await deleteGoogleCalendarConnection("uid-3", { db });
  ok("deleteGoogleCalendarConnection removes the stored credential", (await getGoogleCalendarConnection("uid-3", { db })) === null);
}

// ---- sanitizeGoogleCalendarConnectionForClient: never leaks tokens, never includes email ----
{
  const sanitized = sanitizeGoogleCalendarConnectionForClient({ refreshToken: "super-secret", needsReconnect: false, connectedAt: "2026-01-01T00:00:00.000Z" });
  ok("Sanitized output never contains a refreshToken key", !("refreshToken" in sanitized));
  ok("Sanitized output never contains an accessToken key", !("accessToken" in sanitized));
  ok("Sanitized output never contains an emailAddress key at all (Phase 1 constraint)", !("emailAddress" in sanitized));
  ok("Sanitized output reports connected: true", sanitized.connected === true);
  ok("Sanitized output surfaces connectedAt", sanitized.connectedAt === "2026-01-01T00:00:00.000Z");
}
{
  const sanitized = sanitizeGoogleCalendarConnectionForClient(null);
  ok("No stored connection sanitizes to a clean disconnected shape", sanitized.connected === false && sanitized.needsReconnect === false && sanitized.connectedAt === null);
  ok("Disconnected sanitized shape has no emailAddress key", !("emailAddress" in sanitized));
}

// ---- OAuth state: create, consume-once, expiry, unknown-state — SEPARATE collection from Gmail's own state store ----
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
  await db.collection("googleCalendarOAuthStates").doc("expired-state").set({ uid: "uid-5", codeVerifier: "v", expiresAt: Date.now() - 1000 });
  const result = await consumeOAuthState("expired-state", { db });
  ok("An expired state is rejected even though it was found", result === null);
  const secondLookup = await db.collection("googleCalendarOAuthStates").doc("expired-state").get();
  ok("An expired state is still deleted on first consumption attempt (no lingering doc)", secondLookup.exists === false);
}
{
  const db = createFakeDb();
  await createOAuthState("shared-key-collision-check", { uid: "calendar-uid", codeVerifier: "calendar-verifier" }, { db });
  ok(
    "Calendar OAuth state is stored under the Calendar-specific collection, not gmailOAuthStates",
    (await db.collection("googleCalendarOAuthStates").doc("shared-key-collision-check").get()).exists === true
  );
  ok(
    "The same state id in the UNRELATED gmailOAuthStates collection is untouched (independent collections)",
    (await db.collection("gmailOAuthStates").doc("shared-key-collision-check").get()).exists === false
  );
}
{
  ok("consumeOAuthState fails closed on a non-string state", (await consumeOAuthState(["x", "y"], { db: createFakeDb() })) === null);
  ok("consumeOAuthState fails closed on an empty state", (await consumeOAuthState("", { db: createFakeDb() })) === null);
}

// ---- markGoogleCalendarConnectionNeedsReconnect ----
{
  const db = createFakeDb();
  await upsertGoogleCalendarConnection("uid-10", { refreshToken: "rt-10", connectedAt: "2026-01-01T00:00:00.000Z" }, { db });
  await markGoogleCalendarConnectionNeedsReconnect("uid-10", { db });
  const conn = await getGoogleCalendarConnection("uid-10", { db });
  ok("Flags an existing connection's needsReconnect as true", conn.needsReconnect === true);
  ok("Never touches the stored refresh token", conn.refreshToken === "rt-10");
}
{
  const db = createFakeDb();
  await markGoogleCalendarConnectionNeedsReconnect("uid-11", { db });
  ok("Never creates a connection that didn't already exist (no-op)", (await getGoogleCalendarConnection("uid-11", { db })) === null);
}

// ============ firestore.rules — client access to the two new collections is explicitly denied ============
{
  const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
  ok(
    "googleCalendarConnections has an explicit client-deny rule (mirrors gmailConnections)",
    /match\s+\/googleCalendarConnections\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rules)
  );
  ok(
    "googleCalendarOAuthStates has an explicit client-deny rule (mirrors gmailOAuthStates)",
    /match\s+\/googleCalendarOAuthStates\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rules)
  );
  ok(
    "The pre-existing gmailConnections deny rule is still present and unchanged",
    /match\s+\/gmailConnections\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rules)
  );
  ok(
    "The pre-existing gmailOAuthStates deny rule is still present and unchanged",
    /match\s+\/gmailOAuthStates\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rules)
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
