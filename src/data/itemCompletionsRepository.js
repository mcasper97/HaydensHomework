/* ============================== Item Completions Repository ==============================
 * Per-occurrence completion state for recurring canonical Items (see
 * itemsRepository.js's `schedule` field). A recurring Item's own `status`
 * stays "open" forever by design — completing "today's occurrence" must
 * never permanently complete the underlying recurring Item (chores already
 * establish this exact pattern: a template is never mutated by completing
 * it; only a per-date record changes). This module is that per-date record
 * for canonical Items specifically.
 *
 * Lives at users/{uid}/itemCompletions/{completionId} in Firestore —
 * covered by the existing users/{uid}/{document=**} rule, no rules change
 * needed. Mirrors itemsRepository.js's exact ctx = { uid, isAdmin }
 * branching and guest localStorage fallback.
 *
 * A completion document is CURRENT STATE for one occurrence, not an
 * action/audit history — checking sets completed:true/completedAt:now,
 * unchecking sets completed:false/completedAt:null, both via the SAME
 * deterministic document id (an idempotent upsert, never a second
 * document). No document exists for an occurrence nobody has ever
 * interacted with, and no future-dated documents are ever pre-created —
 * "due today" is decided by itemBuckets.js's isRecurringDueOn from the
 * Item's own schedule, entirely independent of whether a completion
 * document exists for that date.
 */
import { collection, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "../Firebase.js";

const GUEST_COMPLETIONS_KEY = "crestly_admin_item_completions";

function readGuestCompletions() {
  try {
    const raw = localStorage.getItem(GUEST_COMPLETIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGuestCompletions(completions) {
  try {
    localStorage.setItem(GUEST_COMPLETIONS_KEY, JSON.stringify(completions));
  } catch {
    // ignore — same best-effort behavior as the rest of the guest/local path
  }
}

// Guest storage has no live Firestore-style listener, so subscribers are
// notified manually whenever a guest write happens.
const guestListeners = new Set();
function notifyGuestListeners() {
  const completions = readGuestCompletions();
  guestListeners.forEach((cb) => cb(completions));
}

function completionsCollection(uid) {
  return collection(db, "users", uid, "itemCompletions");
}

/**
 * completionIdFor(itemId, occurrenceDate) -> deterministic Firestore
 * document id. Same (itemId, occurrenceDate) always produces the same id,
 * making every completion write an idempotent upsert — never a second
 * document for the same occurrence.
 *
 * `:` is a reserved character encodeURIComponent always escapes (to
 * %3A) when it appears inside itemId, so it can never occur unescaped
 * within the encoded segment — the first unescaped `:` is always the
 * unambiguous boundary between the two parts, regardless of what
 * characters an item id happens to contain (this deliberately does not
 * assume ids will never contain "_", or any other specific character).
 * Firestore disallows a literal "/" in document ids; this scheme never
 * produces one (encodeURIComponent escapes "/" to %2F).
 */
export function completionIdFor(itemId, occurrenceDate) {
  return `${encodeURIComponent(itemId)}:${occurrenceDate}`;
}

/**
 * subscribeItemCompletions(ctx, onChange) -> unsubscribe
 * Delivers the full flat array of this household's completion records —
 * small and bounded by actual parent interactions (only occurrences ever
 * acted upon have a document at all), same "whole small collection, filter
 * client-side" pattern as subscribeItems/subscribeIngestionCandidates.
 */
export function subscribeItemCompletions(ctx, onChange) {
  if (ctx?.isAdmin) {
    const listener = (completions) => onChange(completions);
    guestListeners.add(listener);
    listener(readGuestCompletions());
    return () => guestListeners.delete(listener);
  }

  if (!db || !ctx?.uid) {
    onChange([]);
    return () => {};
  }

  const unsub = onSnapshot(
    completionsCollection(ctx.uid),
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error("itemCompletionsRepository: subscribeItemCompletions failed", err);
      onChange([]);
    }
  );
  return unsub;
}

export async function getItemCompletion(ctx, itemId, occurrenceDate) {
  if (!itemId || !occurrenceDate) return null;
  const id = completionIdFor(itemId, occurrenceDate);

  if (ctx?.isAdmin) {
    return readGuestCompletions().find((c) => c.id === id) || null;
  }
  if (!db || !ctx?.uid) return null;
  const snap = await getDoc(doc(db, "users", ctx.uid, "itemCompletions", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * setItemCompletion(ctx, { itemId, occurrenceDate, completed }) — the one
 * write path for this module. Idempotent upsert via the deterministic id:
 * checking sets completed:true/completedAt:now; unchecking sets
 * completed:false/completedAt:null. updatedAt is always stamped, either way.
 */
export async function setItemCompletion(ctx, { itemId, occurrenceDate, completed }) {
  if (!itemId || !occurrenceDate) throw new Error("itemId and occurrenceDate are required.");
  const id = completionIdFor(itemId, occurrenceDate);

  if (ctx?.isAdmin) {
    const now = new Date().toISOString();
    const payload = { id, itemId, occurrenceDate, completed: !!completed, completedAt: completed ? now : null, updatedAt: now };
    const existing = readGuestCompletions();
    const idx = existing.findIndex((c) => c.id === id);
    if (idx >= 0) existing[idx] = payload;
    else existing.push(payload);
    writeGuestCompletions(existing);
    notifyGuestListeners();
    return payload;
  }

  if (!db || !ctx?.uid) throw new Error("No signed-in account to save to.");
  const payload = {
    itemId,
    occurrenceDate,
    completed: !!completed,
    completedAt: completed ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "users", ctx.uid, "itemCompletions", id), payload, { merge: true });
  return { id, ...payload };
}
