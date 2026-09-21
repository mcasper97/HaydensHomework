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
 *   "corroborated" — recurring-obligations increment, extended by Slice 3
 *                    to one-time obligations: this candidate was recognized
 *                    as describing the SAME obligation as either (a) an
 *                    existing canonical Item (see
 *                    src/organizer/recurringObligationMatch.js for
 *                    recurring obligations, src/organizer/
 *                    oneTimeObligationMatch.js for one-time ones), in which
 *                    case reconciledItemId points at that Item, or (b) an
 *                    earlier candidate created in the SAME ingestion run
 *                    that has no canonical Item yet (one-time only — see
 *                    reconciledCandidateId below). Set once, at creation,
 *                    never transitioned into from any other state.
 *                    Preserves full provenance (this candidate and its
 *                    SourceRecord both exist and are queryable) without
 *                    ever entering the parent's review queue and without
 *                    ever writing to the existing Item/candidate it
 *                    corroborates. No caller filters/queries candidates by
 *                    reviewStatus today (confirmed before adding this
 *                    value), so this is a safe additive enum entry with no
 *                    existing consumer to update.
 *
 * Approval and commit are deliberately two separate states/writes: on
 * approval the candidate is marked "approved" BEFORE createItem() is
 * called, and only flipped to "committed" after createItem() succeeds. If
 * createItem() fails, the candidate is left at "approved" (not reverted to
 * "pending") so a retry can simply re-attempt createItem() without asking
 * the parent to re-decide.
 *
 * targetType/targetChildId (Review Inbox slice) — originally email-only
 * (the approved sender's configured assignment). Now also set by the photo
 * capture path (targetType: "child", targetChildId: <the child whose
 * Parents Page the photo was captured from>) so a candidate reopened later
 * from the Review Inbox — with no ambient "which child's page is this"
 * context available, unlike the immediate in-the-moment review flow —
 * still resolves the correct child automatically via
 * candidateToDraftItem.js's existing targetType==="child" branch. No
 * schema change: both fields already existed. A candidate created before
 * this change (or CSV-imported, which never creates a candidate at all —
 * see App.jsx's importStructuredCSV, which writes canonical Items
 * directly) simply has targetType: null and falls back to manual child
 * selection on reopen, exactly like an unmapped "review"-targeted email
 * candidate already does today.
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
  // src/organizer/recurringObligationMatch.js for recurring obligations,
  // src/organizer/oneTimeObligationMatch.js for one-time ones — both wired
  // in src/AuthShell.jsx) as corroborating an EXISTING canonical Item
  // rather than describing a new one — reviewStatus is "corroborated" in
  // that case (see the reviewStatus lifecycle doc above), and this points
  // at the real Item it corroborates. Provenance only: creating this
  // candidate never writes anything onto that Item.
  //
  // reconciledItemId and reconciledCandidateId (below) are never both
  // non-null for the same candidate — a reconciliation decision resolves
  // to exactly one of "matches an existing Item" or "duplicates another
  // candidate from this same run", never both.
  reconciledItemId: null,
  // Slice 3 (one-time obligation reconciliation) — set only when this
  // candidate was recognized as a SAME-RUN duplicate of an earlier
  // candidate produced by this same ingestion run (e.g. an email body and
  // a linked webpage both describing the same one-time event), where that
  // earlier candidate has no canonical Item yet — it may still be
  // approved, rejected, or left pending. Deliberately a SEPARATE field
  // from reconciledItemId rather than overloading it with a candidate id:
  // reconciledItemId must always mean "an actual canonical Item exists at
  // this id," which is not true here. This field is never later mutated
  // to become a reconciledItemId once/if the earlier candidate is
  // eventually approved — it records what was true at the moment this
  // candidate was created (an honest audit trail), not the earlier
  // candidate's current state.
  reconciledCandidateId: null,
};

/**
 * subscribeIngestionCandidates(ctx, filter, onChange, onError?) -> unsubscribe
 * filter.sourceRecordId (optional) — when given, only candidates from that
 * capture are delivered (used by the review UI to show only the candidates
 * from the photo just uploaded).
 *
 * onError (optional, additive — Review Inbox slice) — when given, a
 * subscribe failure calls onError(err) INSTEAD of onChange([]), so a
 * caller that needs to show a distinct "couldn't load" state (rather than
 * silently rendering "nothing pending") can. Every pre-existing caller
 * omits this argument and keeps the original behavior exactly
 * (onChange([]) on failure) — this is purely additive.
 */
export function subscribeIngestionCandidates(ctx, filter, onChange, onError) {
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
      if (onError) onError(err);
      else onChange([]);
    }
  );
  return unsub;
}

// The one place an IngestionCandidate's createdAt (a Firestore Timestamp on
// the real path, a plain ISO string in guest mode, or briefly unresolved
// immediately after a fresh write before the server round-trip completes)
// is turned into a comparable number — Review Inbox's "oldest pending
// first" ordering is the only current consumer. An unresolved timestamp
// sorts as the NEWEST (Infinity), not the oldest (0): a candidate that
// hasn't gotten its server timestamp back yet is, in reality, the most
// recent thing in the collection, and sorting it to the front would put a
// brand-new item ahead of genuinely old unresolved ones for a moment
// before settling once the real timestamp arrives.
export function candidateCreatedAtMillis(candidate) {
  const v = candidate?.createdAt;
  if (!v) return Number.POSITIVE_INFINITY;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  }
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000 + (v.nanoseconds || 0) / 1e6;
  return Number.POSITIVE_INFINITY;
}

/**
 * subscribePendingIngestionCandidates(ctx, onChange, onError?) -> unsubscribe
 * Review Inbox's one subscription (per Slice 1's "single pending
 * subscription" requirement — this is the only place reviewStatus is
 * filtered and the only place candidates are sorted for this purpose).
 * Thin wrapper over subscribeIngestionCandidates — no Firestore query logic
 * is duplicated; filtering/sorting both happen client-side on the same
 * whole-collection snapshot every other consumer already reads.
 * Oldest-first, so an older unresolved obligation is never buried under
 * newer ingestion (Slice 1 product decision).
 *
 * Slice 2 addition: also includes candidates stranded at "approved" — a
 * status a fresh approval no longer passes through (see
 * candidateCommitRepository.js), but which legacy candidates from before
 * Slice 2 may still be sitting at after a partial failure. These need
 * attention (see ReviewInboxPanel.jsx's "Needs attention" treatment) rather
 * than being invisible, which was exactly Slice 2's "stranded, invisible
 * candidate" failure mode.
 */
export function subscribePendingIngestionCandidates(ctx, onChange, onError) {
  return subscribeIngestionCandidates(
    ctx,
    {},
    (candidates) => {
      const pending = candidates
        .filter((c) => c.reviewStatus === "pending" || c.reviewStatus === "approved")
        .sort((a, b) => candidateCreatedAtMillis(a) - candidateCreatedAtMillis(b));
      onChange(pending);
    },
    onError
  );
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
