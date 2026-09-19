/* ============================== Gmail connection storage (server-private) ==============================
 * Persists exactly two things needed to connect one Gmail account per
 * parent (#26, Commit 3): the OAuth credential itself, and short-lived
 * OAuth `state` values used to bind a callback back to the Firebase UID
 * that started it. Both live in their own top-level Firestore collections
 * — deliberately NOT beneath users/{uid}/... — because the browser must
 * never be able to read or write either one (see firestore.rules): a
 * refresh token is a durable credential, not application data the client
 * should ever hold or sync.
 *
 *   gmailConnections/{uid}      — one document per parent's Gmail connection
 *   gmailOAuthStates/{state}    — one document per in-flight OAuth attempt,
 *                                  short-lived, deleted once consumed
 *
 * Every function here takes an optional injected `db` (defaulting to the
 * real Admin Firestore instance) so this module is unit-testable with a
 * small in-memory fake, with no live Firebase project needed — mirroring
 * how api/_urlSafety.js injects `lookupFn`/`fetchFn`.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";

// Long enough for a parent to complete Google's consent screen, short
// enough that a stale/abandoned state doesn't linger.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function defaultDb() {
  return getFirestore();
}

export async function getGmailConnection(uid, { db = defaultDb() } = {}) {
  const snap = await db.collection("gmailConnections").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Creates or updates a parent's stored Gmail connection. If `patch`
 * doesn't include a refreshToken (Google does not always return a new one
 * — notably on a reconnect where the account already granted offline
 * access before), the previously stored refresh token is kept rather than
 * wiped out, since the old one is still valid and losing it would silently
 * break the connection. Throws if there is no refresh token to persist
 * either way (nothing to save).
 */
export async function upsertGmailConnection(uid, patch, { db = defaultDb() } = {}) {
  const ref = db.collection("gmailConnections").doc(uid);
  const existing = await ref.get();
  const existingData = existing.exists ? existing.data() : null;

  const refreshToken = patch.refreshToken ?? existingData?.refreshToken ?? null;
  if (!refreshToken) {
    throw new Error("upsertGmailConnection: no refresh token available (new or existing)");
  }

  const data = {
    refreshToken,
    emailAddress: patch.emailAddress ?? existingData?.emailAddress ?? null,
    needsReconnect: false,
    connectedAt: patch.connectedAt ?? new Date().toISOString(),
  };
  await ref.set(data);
  return data;
}

export async function deleteGmailConnection(uid, { db = defaultDb() } = {}) {
  await db.collection("gmailConnections").doc(uid).delete();
}

/**
 * Flags an existing connection as needing reconnect — called when
 * refreshing the access token fails with "invalid_grant" (the refresh
 * token has been revoked or expired; see api/gmail-check-email.js).
 * Targeted update, not a full upsertGmailConnection: it must never touch
 * refreshToken/emailAddress/connectedAt, and must never create a
 * connection that doesn't already exist (a no-op if it doesn't).
 */
export async function markGmailConnectionNeedsReconnect(uid, { db = defaultDb() } = {}) {
  const ref = db.collection("gmailConnections").doc(uid);
  const existing = await ref.get();
  if (!existing.exists) return;
  await ref.set({ ...existing.data(), needsReconnect: true });
}

/**
 * Sanitized view safe to send to the browser — never includes refreshToken
 * or any other credential material, by construction (it is built as an
 * explicit allow-list of fields, not by stripping keys from the stored doc).
 */
export function sanitizeGmailConnectionForClient(data) {
  if (!data) {
    return { connected: false, emailAddress: null, needsReconnect: false, connectedAt: null };
  }
  return {
    connected: true,
    emailAddress: data.emailAddress ?? null,
    needsReconnect: !!data.needsReconnect,
    connectedAt: data.connectedAt ?? null,
  };
}

export async function createOAuthState(state, { uid, codeVerifier }, { db = defaultDb() } = {}) {
  await db
    .collection("gmailOAuthStates")
    .doc(state)
    .set({ uid, codeVerifier, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
}

/**
 * Validates and consumes a state value: returns { uid, codeVerifier } if it
 * exists and has not expired, or null otherwise (unknown state, expired
 * state, or already-consumed state all look identical to a caller, by
 * design — nothing about *why* a state was rejected leaks). Always deletes
 * the document if found, so a state can never be used more than once even
 * if it was still within its TTL.
 */
export async function consumeOAuthState(state, { db = defaultDb() } = {}) {
  if (!state || typeof state !== "string") return null;
  const ref = db.collection("gmailOAuthStates").doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  await ref.delete();
  if (!data || typeof data.expiresAt !== "number" || Date.now() > data.expiresAt) {
    return null;
  }
  return { uid: data.uid, codeVerifier: data.codeVerifier };
}
