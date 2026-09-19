/* ============================== IngestionCandidate Repository ==============================
 * Proposed-but-not-yet-real structured data extracted from a SourceRecord
 * capture (see sourceRecordsRepository.js), awaiting explicit parent review
 * before it may become a canonical item (see itemsRepository.js). This
 * module never writes canonical items itself — callers create the item only
 * after an explicit approval, per the ingestion vertical-slice plan.
 *
 * Lives at users/{uid}/ingestionCandidates/{candidateId} in Firestore —
 * covered by the existing users/{uid}/{document=**} rule, no rules change
 * needed. Mirrors itemsRepository.js / sourceRecordsRepository.js's exact
 * ctx = { uid, isAdmin } branching, guest localStorage fallback, and
 * listener-notification pattern.
 *
 * reviewStatus lifecycle (see the vertical-slice plan for the full
 * rationale):
 *   "pending"      — awaiting parent review (initial state on creation)
 *   "rejected"     — parent declined; no item created; kept for audit history
 *   "approved"     — parent approved; item creation about to be/being attempted
 *   "committed"    — canonical item was created successfully
 *   "corroborated" — recurring-obligations increment: this candidate was
 *                    recognized as describing the SAME standing obligation
 *                    as an existing recurring Item (see
 *                    src/organizer/recurringObligationMatch.js). Set once,
 *                    at creation, never transitioned into from any other
 *                    state. Preserves full provenance (this candidate and
 *                    its SourceRecord both exist and are queryable) without
 *                    ever entering the parent's review queue and without
 *                    ever writing to the existing Item — see
 *                    reconciledItemId below. No caller filters/queries
 *                    candidates by reviewStatus today (confirmed before
 *                    adding this value), so this is a safe additive enum
 *                    entry with no existing consumer to update.
 *
 * Approval and commit are deliberately two separate states/writes: on
 * approval the candidate is marked "approved" BEFORE createItem() is
 * called, and only flipped to "committed" after createItem() succeeds. If
 * createItem() fails, the candidate is left at "approved" (not reverted to
 * "pending") so a retry can simply re-attempt createItem() without asking
 * the parent to re-decide.
 */
import { collection, doc, addDoc, updateDoc, onSnapshot, getDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "../Firebase.js";

const GUEST_CANDIDATES_KEY = "crestly_admin_ingestion_candidates";

function readGuestCandidates() {
  try {
    const raw = localStorage.getItem(GUEST_CANDIDATES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGuestCandidates(candidates) {
  try {
    localStorage.setItem(GUEST_CANDIDATES_KEY, JSON.stringify(candidates));
  } catch {
    // ignore — same best-effort behavior as the rest of the guest/local path
  }
}

// Guest storage has no live Firestore-style listener, so subscribers are
// notified manually whenever a guest write happens (create/update).
const guestListeners = new Set();
function notifyGuestListeners() {
  const candidates = readGuestCandidates();
  guestListeners.forEach((cb) => cb(candidates));
}

let guestIdSeq = 0;
function genGuestId() {
  guestIdSeq += 1;
  return `local-cand-${Date.now().toString(36)}-${guestIdSeq}`;
}

function candidatesCollection(uid) {
  return collection(db, "users", uid, "ingestionCandidates");
}

const EMPTY_DEFAULTS = {
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
  // Email-led ingestion (#26, Commit 5) — the sender's CONFIGURED
  // assignment (see src/data/gmailApprovedSenders.js), never the AI's own
  // guess. null/"review" for every pre-Commit-5 candidate (photo/CSV),
  // which have no sender to configure a target for. targetType is one of
  // "child" | "family" | "review" (or null for a candidate that predates
  // this field); targetChildId is set only when targetType is "child".
  targetType: null,
  targetChildId: null,
  // Optional, additive (#26, Commit 5 review-UX fix) — HH:MM 24-hour
  // strings, only ever populated by the email pipeline when the source
  // text explicitly states a time (see api/_emailExtraction.js). null for
  // every pre-existing candidate type (photo/CSV) and for any email
  // obligation with no stated time.
  startTime: null,
  endTime: null,
  // Recurring reminders — optional, additive, advisory only. Same shape as
  // Item.schedule (minus `active` — a not-yet-approved suggestion has no
  // on/off concept), but this is NEVER authoritative: it only pre-fills
  // ItemForm's Repeats section (see candidateToDraftItem.js) before the
  // parent reviews/edits it. The Item's own parent-approved `schedule`,
  // written only at approval time, is what actually controls behavior.
  recurrenceSuggestion: null,
  // Set only when this candidate was recognized (see
  // src/organizer/recurringObligationMatch.js, wired in src/AuthShell.jsx)
  // as corroborating an EXISTING recurring Item rather than describing a
  // new one — reviewStatus is "corroborated" in that case (see the
  // reviewStatus lifecycle doc above), and this points at the Item it
  // corroborates. Provenance only: creating this candidate never writes
  // anything onto that Item.
  reconciledItemId: null,
};

/**
 * subscribeIngestionCandidates(ctx, filter, onChange) -> unsubscribe
 * filter.sourceRecordId (optional) — when given, only candidates from that
 * capture are delivered (used by the review UI to show only the candidates
 * from the photo just uploaded).
 */
export function subscribeIngestionCandidates(ctx, filter, onChange) {
  const applyFilter = (candidates) => {
    if (!filter?.sourceRecordId) return candidates;
    return candidates.filter((c) => c.sourceRecordId === filter.sourceRecordId);
  };

  if (ctx?.isAdmin) {
    const listener = (candidates) => onChange(applyFilter(candidates));
    guestListeners.add(listener);
    listener(readGuestCandidates());
    return () => guestListeners.delete(listener);
  }

  if (!db || !ctx?.uid) {
    onChange([]);
    return () => {};
  }

  const unsub = onSnapshot(
    candidatesCollection(ctx.uid),
    (snap) => {
      const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange(applyFilter(candidates));
    },
    (err) => {
      console.error("ingestionCandidatesRepository: subscribeIngestionCandidates failed", err);
      onChange([]);
    }
  );
  return unsub;
}

export async function listIngestionCandidates(ctx, filter) {
  let candidates;
  if (ctx?.isAdmin) {
    candidates = readGuestCandidates();
  } else if (!db || !ctx?.uid) {
    candidates = [];
  } else {
    const snap = await getDocs(candidatesCollection(ctx.uid));
    candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  if (!filter?.sourceRecordId) return candidates;
  return candidates.filter((c) => c.sourceRecordId === filter.sourceRecordId);
}

export async function getIngestionCandidate(ctx, candidateId) {
  if (!candidateId) return null;
  if (ctx?.isAdmin) {
    return readGuestCandidates().find((c) => c.id === candidateId) || null;
  }
  if (!db || !ctx?.uid) return null;
  const snap = await getDoc(doc(db, "users", ctx.uid, "ingestionCandidates", candidateId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createIngestionCandidate(ctx, data) {
  const payload = { ...EMPTY_DEFAULTS, ...data };

  if (ctx?.isAdmin) {
    const now = new Date().toISOString();
    const candidate = { id: genGuestId(), ...payload, createdAt: now };
    const candidates = readGuestCandidates();
    candidates.push(candidate);
    writeGuestCandidates(candidates);
    notifyGuestListeners();
    return candidate;
  }

  if (!db || !ctx?.uid) throw new Error("No signed-in account to save to.");
  const ref = await addDoc(candidatesCollection(ctx.uid), {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, ...payload };
}

export async function updateIngestionCandidate(ctx, candidateId, patch) {
  if (ctx?.isAdmin) {
    const candidates = readGuestCandidates().map((c) => (c.id === candidateId ? { ...c, ...patch } : c));
    writeGuestCandidates(candidates);
    notifyGuestListeners();
    return;
  }
  if (!db || !ctx?.uid) return;
  await updateDoc(doc(db, "users", ctx.uid, "ingestionCandidates", candidateId), patch);
}
