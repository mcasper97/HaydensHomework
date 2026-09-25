/* ============================== SourceRecords — server access ==============================
 * Server-side access to the same users/{uid}/sourceRecords collection
 * src/data/sourceRecordsRepository.js manages from the client.
 * listProcessedGmailMessageIds is used to compute which Gmail messages
 * have already been processed, so a repeat "Check Email" click within the
 * same 14-day lookback window never re-fetches or re-extracts a message it
 * has already seen (see api/_gmailIngestionCore.js). createSourceRecordServerSide
 * is the write half, added for the automatic scheduled-ingestion runner
 * (api/_gmailIngestionRunner.js), which — unlike the manual "Check Email"
 * flow (still entirely client-side, see src/GmailCheckEmailAction.jsx) —
 * has no browser to persist through.
 *
 * `db` is injectable (defaults to the real Admin Firestore instance),
 * mirroring api/_gmailConnectionsStore.js and api/_gmailApprovedSendersStore.js.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getGmailProcessingResetAt, toMillis } from "./_gmailProcessingResetStore.js";

function defaultDb() {
  return getFirestore();
}

// Mirrors src/data/sourceRecordsRepository.js's own EMPTY_DEFAULTS exactly
// (field names/values only — a plain data shape, not a rule) — copied
// rather than imported so this module never statically pulls in the
// client Firebase SDK (firebase/firestore + src/Firebase.js), the same
// established convention api/_scheduledIngestionAdapter.js already uses
// for its own ITEM_EMPTY_DEFAULTS. Keep in sync if that file's
// EMPTY_DEFAULTS ever changes.
const SOURCE_RECORD_EMPTY_DEFAULTS = {
  sourceType: "manual",
  title: null,
  mimeType: null,
  processingStatus: "captured",
  createdByUid: null,
  metadata: {},
};

/**
 * createSourceRecordServerSide(uid, data) -> { id, ...payload }
 * The Admin-SDK counterpart to src/data/sourceRecordsRepository.js's
 * createSourceRecord (real-Firestore branch) — same defaults, same
 * users/{uid}/sourceRecords/{id} document shape, same capturedAt/updatedAt
 * server-timestamp fields, translated to firebase-admin/firestore's API.
 */
export async function createSourceRecordServerSide(uid, data, { db = defaultDb() } = {}) {
  const payload = { ...SOURCE_RECORD_EMPTY_DEFAULTS, ...data };
  const ref = await db
    .collection("users")
    .doc(uid)
    .collection("sourceRecords")
    .add({ ...payload, capturedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return { id: ref.id, ...payload };
}

/**
 * Returns a Set of every gmailMessageId already recorded in this user's
 * "gmail_email" SourceRecords, for O(1) dedupe lookups against newly
 * listed Gmail messages.
 *
 * Gmail processing reset (testing control — api/_gmailProcessingResetStore.js):
 * a gmail_email SourceRecord captured BEFORE this household's own reset
 * marker is excluded from the returned set, so that message is treated as
 * not-yet-processed again — without the SourceRecord itself, or anything
 * downstream of it, ever being touched. No marker set (the common case) ->
 * every gmail_email SourceRecord still counts, exactly the original,
 * unreset behavior.
 */
export async function listProcessedGmailMessageIds(uid, { db = defaultDb() } = {}) {
  const [snap, resetAtMs] = await Promise.all([
    db.collection("users").doc(uid).collection("sourceRecords").get(),
    getGmailProcessingResetAt(uid, { db }),
  ]);
  const ids = new Set();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data?.sourceType === "gmail_email" && typeof data?.metadata?.gmailMessageId === "string") {
      if (resetAtMs != null) {
        const capturedAtMs = toMillis(data.capturedAt);
        if (capturedAtMs != null && capturedAtMs < resetAtMs) continue; // reset out — eligible again
      }
      ids.add(data.metadata.gmailMessageId);
    }
  }
  return ids;
}
