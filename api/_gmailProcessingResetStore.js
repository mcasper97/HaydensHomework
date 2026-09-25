/* ============================== Gmail processing reset (server-private, testing control) ==============================
 * A LOGICAL, reversible reset of a household's Gmail dedupe state — never a
 * deletion of anything. See api/_sourceRecordsStore.js's
 * listProcessedGmailMessageIds: today, a Gmail message counts as
 * "processed" purely because a sourceType:"gmail_email" SourceRecord
 * exists for its gmailMessageId — there is no separate "processed
 * messages" ledger to clear, and the task this file exists for is explicit
 * that SourceRecords/Items/candidates must never be deleted just to
 * support testing.
 *
 * The mechanism: this household's own "reset marker" timestamp, stored
 * here — NOT inside SourceRecords, so no existing document is ever
 * touched. listProcessedGmailMessageIds reads this marker and simply
 * excludes any gmail_email SourceRecord captured BEFORE it from the
 * "processed" set, making that message eligible to be scanned/extracted
 * again on the next Check Email / automatic run — while the SourceRecord
 * itself, and every Item/IngestionCandidate/Calendar record downstream of
 * it, stays exactly as it was. Resetting again simply bumps the marker
 * forward; nothing is ever un-reset by this mechanism, which is fine — the
 * only intended use is "let me test the same emails again."
 *
 * `resetAt` is a plain server-computed ISO string (this endpoint's own
 * Node process clock), not a Firestore FieldValue.serverTimestamp()
 * sentinel — same convention api/_gmailConnectionsStore.js's own
 * `connectedAt` already uses for a server-authored-but-not-provenance
 * field. Unlike SourceRecords' capturedAt (real audit provenance, where a
 * Firestore-resolved server timestamp matters), this marker is a testing
 * utility; a Node-clock timestamp is precise enough and — unlike a
 * FieldValue sentinel — is directly comparable the moment it's written,
 * which keeps this module simply unit-testable against an injected fake
 * `db` with no Firestore-sentinel resolution to simulate.
 *
 *   gmailProcessingResets/{uid} — one document per household, deliberately
 *   a top-level collection (not beneath users/{uid}/...), mirroring
 *   gmailConnections/{uid} — server-private, never read or written by the
 *   client Firestore SDK directly (see firestore.rules); only this
 *   module's own authenticated endpoint (api/gmail-reset-processing.js)
 *   ever touches it.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";

function defaultDb() {
  return getFirestore();
}

function resetDocRef(uid, db) {
  return db.collection("gmailProcessingResets").doc(uid);
}

/**
 * toMillis(value) -> number | null
 * Accepts a Firestore Timestamp (has .toMillis()), a JS Date, an ISO
 * string, or a raw millis number — whichever shape a given field happens
 * to be in (SourceRecords' capturedAt resolves to a real Firestore
 * Timestamp in production; this module's own resetAt is a plain ISO
 * string) — and returns a comparable epoch-millis number, or null when the
 * value is missing/unrecognized (a caller treats null as "no signal,"
 * never as "epoch zero").
 */
export function toMillis(value) {
  if (value == null) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * getGmailProcessingResetAt(uid) -> epoch millis | null
 * null means this household has never reset its Gmail processing history —
 * every gmail_email SourceRecord counts as processed, exactly the
 * pre-existing (unreset) behavior.
 */
export async function getGmailProcessingResetAt(uid, { db = defaultDb() } = {}) {
  const snap = await resetDocRef(uid, db).get();
  if (!snap.exists) return null;
  return toMillis(snap.data()?.resetAt);
}

/**
 * resetGmailProcessingHistory(uid, { getProcessedIds, db? }) -> { resetCount }
 * `getProcessedIds` (typically api/_sourceRecordsStore.js's own
 * listProcessedGmailMessageIds — injected rather than imported directly,
 * so this module and _sourceRecordsStore.js never statically import each
 * other in a cycle) is called BEFORE the marker is bumped, so resetCount
 * reflects exactly how many previously-processed Gmail messages just
 * became eligible again. Writes only this one small marker document —
 * never touches SourceRecords, Items, or IngestionCandidates.
 */
export async function resetGmailProcessingHistory(uid, { db = defaultDb(), getProcessedIds } = {}) {
  if (typeof getProcessedIds !== "function") {
    throw new Error("resetGmailProcessingHistory: getProcessedIds is required");
  }
  const idsBefore = await getProcessedIds(uid, { db });
  await resetDocRef(uid, db).set({ resetAt: new Date().toISOString() });
  return { resetCount: idsBefore.size };
}
