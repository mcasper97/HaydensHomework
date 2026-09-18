/* ============================== Approved Gmail Senders Repository ==============================
 * Parent-managed list of exact email addresses email-led ingestion is
 * allowed to read from, once reading is wired up (#26, later commit). This
 * commit is management-only: add/remove/list. Lives at
 * users/{uid}/gmailApprovedSenders/{id} — covered by the existing
 * users/{uid}/{document=**} Firestore rule, no rules change needed (unlike
 * gmailConnections, this is normal parent-configured app data, not a
 * credential). Mirrors itemsRepository.js's exact ctx = { uid, isAdmin }
 * branching, guest localStorage fallback, and listener-notification pattern.
 */
import { collection, doc, addDoc, deleteDoc, onSnapshot, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "../Firebase.js";
import { normalizeSenderEmail, isValidSenderEmail } from "./gmailApprovedSenders.js";

const GUEST_SENDERS_KEY = "crestly_admin_gmail_approved_senders";

function readGuestSenders() {
  try {
    const raw = localStorage.getItem(GUEST_SENDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGuestSenders(senders) {
  try {
    localStorage.setItem(GUEST_SENDERS_KEY, JSON.stringify(senders));
  } catch {
    // ignore — same best-effort behavior as the rest of the guest/local path
  }
}

const guestListeners = new Set();
function notifyGuestListeners() {
  const senders = readGuestSenders();
  guestListeners.forEach((cb) => cb(senders));
}

let guestIdSeq = 0;
function genGuestId() {
  guestIdSeq += 1;
  return `local-sender-${Date.now().toString(36)}-${guestIdSeq}`;
}

function sendersCollection(uid) {
  return collection(db, "users", uid, "gmailApprovedSenders");
}

export function subscribeApprovedSenders(ctx, onChange) {
  if (ctx?.isAdmin) {
    guestListeners.add(onChange);
    onChange(readGuestSenders());
    return () => guestListeners.delete(onChange);
  }

  if (!db || !ctx?.uid) {
    onChange([]);
    return () => {};
  }

  const unsub = onSnapshot(
    sendersCollection(ctx.uid),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("gmailApprovedSendersRepository: subscribeApprovedSenders failed", err);
      onChange([]);
    }
  );
  return unsub;
}

export async function listApprovedSenders(ctx) {
  if (ctx?.isAdmin) return readGuestSenders();
  if (!db || !ctx?.uid) return [];
  const snap = await getDocs(sendersCollection(ctx.uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Adds one exact sender address. Throws a friendly Error on an invalid
 * address or a duplicate (case-insensitive) of one already in the list —
 * callers should catch and display the message as-is.
 */
export async function addApprovedSender(ctx, rawEmail) {
  const email = normalizeSenderEmail(rawEmail);
  if (!isValidSenderEmail(email)) {
    throw new Error("Enter a valid email address.");
  }

  const existing = await listApprovedSenders(ctx);
  if (existing.some((s) => s.email === email)) {
    throw new Error("That address is already approved.");
  }

  if (ctx?.isAdmin) {
    const sender = { id: genGuestId(), email, addedAt: new Date().toISOString() };
    const senders = readGuestSenders();
    senders.push(sender);
    writeGuestSenders(senders);
    notifyGuestListeners();
    return sender;
  }

  if (!db || !ctx?.uid) throw new Error("No signed-in account to save to.");
  const ref = await addDoc(sendersCollection(ctx.uid), { email, addedAt: serverTimestamp() });
  return { id: ref.id, email };
}

export async function removeApprovedSender(ctx, senderId) {
  if (ctx?.isAdmin) {
    writeGuestSenders(readGuestSenders().filter((s) => s.id !== senderId));
    notifyGuestListeners();
    return;
  }
  if (!db || !ctx?.uid) return;
  await deleteDoc(doc(db, "users", ctx.uid, "gmailApprovedSenders", senderId));
}
