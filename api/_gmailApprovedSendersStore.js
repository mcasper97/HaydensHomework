/* ============================== Approved Gmail senders — server read access ==============================
 * Server-side read of the same users/{uid}/gmailApprovedSenders collection
 * src/data/gmailApprovedSendersRepository.js manages from the client. Once
 * email reading is wired up (a later commit), which senders it's allowed
 * to read from must be decided authoritatively here — server-side, from
 * Firestore itself — never by trusting a sender list the client happens to
 * send in a request body. This commit only needs to validate that at least
 * one approved sender exists before the (currently shell) Check Email
 * action proceeds; see api/gmail-check-email.js.
 *
 * `db` is injectable (defaults to the real Admin Firestore instance),
 * mirroring api/_gmailConnectionsStore.js, so this is unit-testable with a
 * small in-memory fake and no live Firebase project needed.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";

function defaultDb() {
  return getFirestore();
}

export async function listApprovedSenderEmails(uid, { db = defaultDb() } = {}) {
  const snap = await db.collection("users").doc(uid).collection("gmailApprovedSenders").get();
  return snap.docs.map((d) => d.data()?.email).filter((email) => typeof email === "string" && email.length > 0);
}
