/* ============================== IngestionCandidates — server write access ==============================
 * Server-side write of the same users/{uid}/ingestionCandidates collection
 * src/data/ingestionCandidatesRepository.js manages from the client. Added
 * for the automatic scheduled-ingestion runner (api/_gmailIngestionRunner.js),
 * which — unlike the manual "Check Email" flow (still entirely
 * client-side, see src/GmailCheckEmailAction.jsx) — has no browser to
 * persist a newly-extracted candidate through before handing it to
 * api/_scheduledIngestionAdapter.js's finalizeCandidateServerSide.
 *
 * `db` is injectable (defaults to the real Admin Firestore instance),
 * mirroring every other api/_*Store.js module in this app.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function defaultDb() {
  return getFirestore();
}

// Mirrors src/data/ingestionCandidatesRepository.js's own EMPTY_DEFAULTS
// exactly (field names/values only — a plain data shape, not a rule) —
// copied rather than imported so this module never statically pulls in
// the client Firebase SDK (firebase/firestore + src/Firebase.js), the
// same established convention api/_scheduledIngestionAdapter.js already
// uses for its own ITEM_EMPTY_DEFAULTS. Keep in sync if that file's
// EMPTY_DEFAULTS ever changes.
//
// reconciledItemId/reconciledCandidateId default to null here, same as
// the client repository's own EMPTY_DEFAULTS — api/_gmailIngestionRunner.js
// (the one caller that creates candidates server-side) explicitly passes
// one of them, plus reviewStatus:"corroborated", when its reconciliation
// step (see that file's own doc comment) recognizes a newly-extracted
// obligation as corroborating an existing Item or same-run candidate.
const CANDIDATE_EMPTY_DEFAULTS = {
  sourceRecordId: null,
  proposedType: null,
  title: null,
  proposedChildName: null,
  date: null,
  subject: null,
  academicTopic: null,
  academicUnit: null,
  preparationRequired: null,
  description: null,
  extractionConfidence: null,
  reviewStatus: "pending",
  targetType: null,
  targetChildId: null,
  startTime: null,
  endTime: null,
  recurrenceSuggestion: null,
  reconciledItemId: null,
  reconciledCandidateId: null,
};

/**
 * createIngestionCandidateServerSide(uid, data) -> { id, ...payload }
 * The Admin-SDK counterpart to src/data/ingestionCandidatesRepository.js's
 * createIngestionCandidate (real-Firestore branch) — same defaults, same
 * users/{uid}/ingestionCandidates/{id} document shape, same createdAt
 * server-timestamp field, translated to firebase-admin/firestore's API.
 */
export async function createIngestionCandidateServerSide(uid, data, { db = defaultDb() } = {}) {
  const payload = { ...CANDIDATE_EMPTY_DEFAULTS, ...data };
  const ref = await db
    .collection("users")
    .doc(uid)
    .collection("ingestionCandidates")
    .add({ ...payload, createdAt: FieldValue.serverTimestamp() });
  return { id: ref.id, ...payload };
}
