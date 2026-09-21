/* ============================== Google Calendar connection storage (server-private) ==============================
 * Slice B — mirrors api/_gmailConnectionsStore.js's exact pattern, on its
 * own SEPARATE collections, deliberately not sharing a document with
 * Gmail's connection (see AuthShell.jsx's Google Calendar panel and the
 * Slice A/B design discussion: Gmail and Calendar are independently
 * connectable/disconnectable features, each with its own least-privilege
 * scope, so each gets its own credential record).
 *
 *   googleCalendarConnections/{uid}    — one document per parent's Calendar
 *                                         connection
 *   googleCalendarOAuthStates/{state}  — one document per in-flight OAuth
 *                                         attempt, short-lived, deleted
 *                                         once consumed
 *
 * Unlike gmailConnections, this store never persists an emailAddress —
 * Phase 1 deliberately does not request an identity scope or display the
 * connected account's email for Calendar (see api/calendar-oauth-callback.js).
 *
 * Every function here takes an optional injected `db` (defaulting to the
 * real Admin Firestore instance), same as _gmailConnectionsStore.js, so
 * this module is unit-testable with a small in-memory fake.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";

// Long enough for a parent to complete Google's consent screen, short
// enough that a stale/abandoned state doesn't linger. Same value as
// Gmail's own OAUTH_STATE_TTL_MS.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function defaultDb() {
  return getFirestore();
}

export async function getGoogleCalendarConnection(uid, { db = defaultDb() } = {}) {
  const snap = await db.collection("googleCalendarConnections").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Creates or updates a parent's stored Calendar connection. If `patch`
 * doesn't include a refreshToken (Google does not always return a new one
 * — notably on a reconnect where the account already granted offline
 * access before), the previously stored refresh token is kept rather than
 * wiped out, since the old one is still valid and losing it would silently
 * break the connection. Throws if there is no refresh token to persist
 * either way (nothing to save) — same contract as upsertGmailConnection.
 */
export async function upsertGoogleCalendarConnection(uid, patch, { db = defaultDb() } = {}) {
  const ref = db.collection("googleCalendarConnections").doc(uid);
  const existing = await ref.get();
  const existingData = existing.exists ? existing.data() : null;

  const refreshToken = patch.refreshToken ?? existingData?.refreshToken ?? null;
  if (!refreshToken) {
    throw new Error("upsertGoogleCalendarConnection: no refresh token available (new or existing)");
  }

  const data = {
    refreshToken,
    needsReconnect: false,
    connectedAt: patch.connectedAt ?? new Date().toISOString(),
  };
  await ref.set(data);
  return data;
}

export async function deleteGoogleCalendarConnection(uid, { db = defaultDb() } = {}) {
  await db.collection("googleCalendarConnections").doc(uid).delete();
}

/**
 * Flags an existing connection as needing reconnect — called when
 * refreshing the access token fails with "invalid_grant". Not yet wired to
 * any live token-refresh call in Slice B (Calendar makes no API calls
 * yet), but the storage/status behavior is ready for Slice C to use.
 * Targeted update, not a full upsert: never touches refreshToken/
 * connectedAt, and never creates a connection that doesn't already exist.
 */
export async function markGoogleCalendarConnectionNeedsReconnect(uid, { db = defaultDb() } = {}) {
  const ref = db.collection("googleCalendarConnections").doc(uid);
  const existing = await ref.get();
  if (!existing.exists) return;
  await ref.set({ ...existing.data(), needsReconnect: true });
}

/**
 * Sanitized view safe to send to the browser — never includes
 * refreshToken or any other credential material, by construction (an
 * explicit allow-list of fields, not stripped keys). No emailAddress
 * field at all (see module doc comment above).
 */
export function sanitizeGoogleCalendarConnectionForClient(data) {
  if (!data) {
    return { connected: false, needsReconnect: false, connectedAt: null };
  }
  return {
    connected: true,
    needsReconnect: !!data.needsReconnect,
    connectedAt: data.connectedAt ?? null,
  };
}

export async function createOAuthState(state, { uid, codeVerifier }, { db = defaultDb() } = {}) {
  await db
    .collection("googleCalendarOAuthStates")
    .doc(state)
    .set({ uid, codeVerifier, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
}

/**
 * Validates and consumes a state value: returns { uid, codeVerifier } if it
 * exists and has not expired, or null otherwise (unknown state, expired
 * state, or already-consumed state all look identical to a caller, by
 * design). Always deletes the document if found, so a state can never be
 * used more than once even if it was still within its TTL.
 */
export async function consumeOAuthState(state, { db = defaultDb() } = {}) {
  if (!state || typeof state !== "string") return null;
  const ref = db.collection("googleCalendarOAuthStates").doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  await ref.delete();
  if (!data || typeof data.expiresAt !== "number" || Date.now() > data.expiresAt) {
    return null;
  }
  return { uid: data.uid, codeVerifier: data.codeVerifier };
}
