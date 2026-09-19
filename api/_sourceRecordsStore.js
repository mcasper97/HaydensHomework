/* ============================== SourceRecords — server read access (dedupe only) ==============================
 * Server-side read of the same users/{uid}/sourceRecords collection
 * src/data/sourceRecordsRepository.js manages from the client. Used only
 * to compute which Gmail messages have already been processed, so a
 * repeat "Check Email" click within the same 14-day lookback window never
 * re-fetches or re-extracts a message it has already seen (see
 * api/gmail-check-email.js). Read-only — this module never writes a
 * SourceRecord; creation stays entirely client-side, unchanged from the
 * existing photo-ingestion/CSV-import flows.
 *
 * `db` is injectable (defaults to the real Admin Firestore instance),
 * mirroring api/_gmailConnectionsStore.js and api/_gmailApprovedSendersStore.js.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";

function defaultDb() {
  return getFirestore();
}

/**
 * Returns a Set of every gmailMessageId already recorded in this user's
 * "gmail_email" SourceRecords, for O(1) dedupe lookups against newly
 * listed Gmail messages.
 */
export async function listProcessedGmailMessageIds(uid, { db = defaultDb() } = {}) {
  const snap = await db.collection("users").doc(uid).collection("sourceRecords").get();
  const ids = new Set();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data?.sourceType === "gmail_email" && typeof data?.metadata?.gmailMessageId === "string") {
      ids.add(data.metadata.gmailMessageId);
    }
  }
  return ids;
}
