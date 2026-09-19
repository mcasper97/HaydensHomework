/* ============================== Approved Gmail senders — server read access ==============================
 * Server-side read of the same users/{uid}/gmailApprovedSenders collection
 * src/data/gmailApprovedSendersRepository.js manages from the client.
 * Which senders it's allowed to read from — and who each one's obligations
 * belong to — is decided authoritatively here, server-side, from Firestore
 * itself, never by trusting a sender list a client request happens to
 * send. See api/gmail-check-email.js.
 *
 * `db` is injectable (defaults to the real Admin Firestore instance),
 * mirroring api/_gmailConnectionsStore.js, so this is unit-testable with a
 * small in-memory fake and no live Firebase project needed.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";
import { normalizeSenderTarget } from "../src/data/gmailApprovedSenders.js";

function defaultDb() {
  return getFirestore();
}

export async function listApprovedSenderEmails(uid, { db = defaultDb() } = {}) {
  const snap = await db.collection("users").doc(uid).collection("gmailApprovedSenders").get();
  return snap.docs.map((d) => d.data()?.email).filter((email) => typeof email === "string" && email.length > 0);
}

/**
 * Full approved-sender records, target-normalized the same way the client
 * repository normalizes them on read (see gmailApprovedSenders.js's
 * normalizeSenderTarget) — a sender predating the target field behaves as
 * targetType "review" here too. Used by the real Check Email pipeline
 * (#26, Commit 5) to resolve each matched Gmail message's configured
 * child/family/review assignment from the sender that sent it — never
 * from anything the AI extracts.
 */
export async function listApprovedSenders(uid, { db = defaultDb() } = {}) {
  const snap = await db.collection("users").doc(uid).collection("gmailApprovedSenders").get();
  return snap.docs
    .map((d) => d.data())
    .filter((data) => typeof data?.email === "string" && data.email.length > 0)
    .map((data) => ({ email: data.email, ...normalizeSenderTarget(data) }));
}
