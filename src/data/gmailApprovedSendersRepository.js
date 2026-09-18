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
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "../Firebase.js";
import { normalizeSenderEmail, isValidSenderEmail, normalizeSenderTarget, isValidSenderTarget } from "./gmailApprovedSenders.js";

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

/**
 * Applies backward-compatible target normalization at read time (see
 * normalizeSenderTarget) — a record created before Commit 4.1 has no
 * targetType field at all and reads back as targetType "review", childId
 * null, with no migration write ever needed.
 */
function withNormalizedTarget(record) {
  return { ...record, ...normalizeSenderTarget(record) };
}

export function subscribeApprovedSenders(ctx, onChange) {
  if (ctx?.isAdmin) {
    const listener = (senders) => onChange(senders.map(withNormalizedTarget));
    guestListeners.add(listener);
    listener(readGuestSenders());
    return () => guestListeners.delete(listener);
  }

  if (!db || !ctx?.uid) {
    onChange([]);
    return () => {};
  }

  const unsub = onSnapshot(
    sendersCollection(ctx.uid),
    (snap) => onChange(snap.docs.map((d) => withNormalizedTarget({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("gmailApprovedSendersRepository: subscribeApprovedSenders failed", err);
      onChange([]);
    }
  );
  return unsub;
}

export async function listApprovedSenders(ctx) {
  if (ctx?.isAdmin) return readGuestSenders().map(withNormalizedTarget);
  if (!db || !ctx?.uid) return [];
  const snap = await getDocs(sendersCollection(ctx.uid));
  return snap.docs.map((d) => withNormalizedTarget({ id: d.id, ...d.data() }));
}

/**
 * Adds one exact sender address with its target (who it applies to — see
 * gmailApprovedSenders.js). Throws a friendly Error on an invalid address,
 * a duplicate (case-insensitive) of one already in the list, or an invalid
 * target — callers should catch and display the message as-is. `target`
 * defaults to { targetType: "review", childId: null } when omitted,
 * matching the same backward-compatible default applied on read.
 */
export async function addApprovedSender(ctx, rawEmail, target = { targetType: "review", childId: null }) {
  const email = normalizeSenderEmail(rawEmail);
  if (!isValidSenderEmail(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (!isValidSenderTarget(target)) {
    throw new Error("Choose who this sender applies to.");
  }
  const { targetType, childId } = target;

  const existing = await listApprovedSenders(ctx);
  if (existing.some((s) => s.email === email)) {
    throw new Error("That address is already approved.");
  }

  if (ctx?.isAdmin) {
    const sender = { id: genGuestId(), email, targetType, childId, addedAt: new Date().toISOString() };
    const senders = readGuestSenders();
    senders.push(sender);
    writeGuestSenders(senders);
    notifyGuestListeners();
    return sender;
  }

  if (!db || !ctx?.uid) throw new Error("No signed-in account to save to.");
  const ref = await addDoc(sendersCollection(ctx.uid), { email, targetType, childId, addedAt: serverTimestamp() });
  return { id: ref.id, email, targetType, childId };
}

/**
 * Changes an existing sender's target without touching its email — the
 * dropdown on an existing sender row calls this. Throws the same friendly
 * Error as addApprovedSender on an invalid target.
 */
export async function updateApprovedSenderTarget(ctx, senderId, target) {
  if (!isValidSenderTarget(target)) {
    throw new Error("Choose who this sender applies to.");
  }
  const { targetType, childId } = target;

  if (ctx?.isAdmin) {
    const senders = readGuestSenders().map((s) => (s.id === senderId ? { ...s, targetType, childId } : s));
    writeGuestSenders(senders);
    notifyGuestListeners();
    return;
  }
  if (!db || !ctx?.uid) return;
  await updateDoc(doc(db, "users", ctx.uid, "gmailApprovedSenders", senderId), { targetType, childId });
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
