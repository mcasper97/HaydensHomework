/* ============================== Candidate Commit Repository ==============================
 * Slice 2 — Candidate-to-Item Idempotency + Recovery.
 *
 * The ONE place an IngestionCandidate becomes a canonical Item. Purpose-
 * specific and deliberately separate from itemsRepository.js's createItem()
 * (which remains completely unchanged and is still what every other,
 * non-ingestion Item creation path uses) — see the Slice 2 design
 * discussion: generalizing createItem() with an optional id parameter would
 * add a real-Firestore-path branch (an id-aware write) that only this one
 * caller would ever use, while every other caller keeps using plain
 * addDoc()'s auto id. A dedicated module keeps that transaction logic out
 * of createItem() entirely.
 *
 * Idempotency mechanism: the Item created here always uses the SAME
 * document id as the candidate that produced it (users/{uid}/items/{id} ==
 * users/{uid}/ingestionCandidates/{id}). Safe — Items and IngestionCandidates
 * live in separate Firestore collections/localStorage arrays, so there is no
 * id-namespace collision between them. "At most one Item per candidate" is
 * therefore enforced by Firestore's own "does this document exist" check
 * inside a transaction (real accounts) or a plain existence check (guest
 * mode), not by any new bookkeeping field on the candidate.
 *
 * reviewStatus handling — explicit ALLOWLIST (never an exclusion rule):
 *   pending      -> committable (normal, first-time approval)
 *   approved     -> committable (legacy/recovery: a candidate stranded at
 *                   "approved" by a partial failure from before this slice)
 *   committed    -> idempotent success if items/{id} already exists (retry
 *                   of an already-successful commit); COMMITTED_ITEM_MISSING
 *                   integrity error if it does not (see below — never
 *                   silently recreated)
 *   rejected     -> NOT_COMMITTABLE (a parent explicitly declined this)
 *   corroborated -> NOT_COMMITTABLE (recognized as a duplicate of an
 *                   existing recurring Item at creation time — see
 *                   ingestionCandidatesRepository.js; must never enter the
 *                   commit workflow)
 *   anything else (unknown/future status) -> NOT_COMMITTABLE, fail closed
 *
 * COMMITTED_ITEM_MISSING is a hard integrity error, not a repair
 * opportunity: once a candidate claims "committed", the payload a caller is
 * currently submitting (e.g. a stale retry, or a resubmission with edited
 * fields) is not necessarily the payload that originally produced the
 * missing Item, so it is never used to recreate it here.
 *
 * updatedAt — IngestionCandidate documents have no existing updatedAt
 * field/convention today (only createdAt is stamped, at creation only; see
 * ingestionCandidatesRepository.js's createIngestionCandidate/
 * updateIngestionCandidate). Per the Slice 2 instruction to update it "if
 * that is consistent with the current repository schema/convention" and to
 * never introduce a new timestamp field, this module does NOT add an
 * updatedAt write to the candidate — there is no existing field to update.
 *
 * Guest mode has no transaction primitive. Per Slice 2's explicit
 * "do not overengineer guest-mode atomicity" instruction, this applies the
 * exact same status/existence rules as the real path using plain
 * read-then-write calls (safe in practice — guest mode is single-tab,
 * single-threaded localStorage, not subject to the concurrent-write races a
 * multi-device real account can hit).
 */
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../Firebase.js";
import {
  EMPTY_DEFAULTS,
  getItem,
  readGuestItems,
  writeGuestItems,
  notifyGuestListeners,
} from "./itemsRepository.js";
import { getIngestionCandidate, updateIngestionCandidate } from "./ingestionCandidatesRepository.js";
import { decideCandidateCommit, buildItemFields, COMMIT_ERROR_CODES as SHARED_COMMIT_ERROR_CODES, commitError } from "./candidateCommitDecision.js";

// Re-exported for backward compatibility — every existing caller/test
// imports COMMIT_ERROR_CODES from this module. The values themselves now
// live in candidateCommitDecision.js (shared with the server-side
// adapter — see api/_scheduledIngestionAdapter.js), never duplicated.
export const COMMIT_ERROR_CODES = SHARED_COMMIT_ERROR_CODES;

async function commitReal(ctx, candidateId, reviewedItemPayload, commitMode) {
  const candRef = doc(db, "users", ctx.uid, "ingestionCandidates", candidateId);
  const itemRef = doc(db, "users", ctx.uid, "items", candidateId);

  return runTransaction(db, async (tx) => {
    const candSnap = await tx.get(candRef);
    const candidate = candSnap.exists() ? { id: candSnap.id, ...candSnap.data() } : null;
    const itemSnap = await tx.get(itemRef);

    const decision = decideCandidateCommit({
      candidateExists: candSnap.exists(),
      candidate,
      itemExists: itemSnap.exists(),
    });

    if (decision.action === "throw") {
      throw commitError(decision.code, decision.message);
    }
    if (decision.action === "return_existing" || decision.action === "mark_committed_only") {
      if (decision.action === "mark_committed_only") {
        tx.update(candRef, { reviewStatus: "committed" });
      }
      return { id: itemSnap.id, ...itemSnap.data() };
    }

    // decision.action === "create_item"
    const fields = buildItemFields(EMPTY_DEFAULTS, candidate, reviewedItemPayload, commitMode);
    tx.set(itemRef, {
      ...fields,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.update(candRef, { reviewStatus: "committed" });
    return { id: itemRef.id, ...fields };
  });
}

async function commitGuest(ctx, candidateId, reviewedItemPayload, commitMode) {
  const candidate = await getIngestionCandidate(ctx, candidateId);
  const existingItem = await getItem(ctx, candidateId);

  const decision = decideCandidateCommit({
    candidateExists: !!candidate,
    candidate,
    itemExists: !!existingItem,
  });

  if (decision.action === "throw") {
    throw commitError(decision.code, decision.message);
  }
  if (decision.action === "return_existing") {
    return existingItem;
  }

  let item = existingItem;
  if (decision.action === "create_item") {
    const now = new Date().toISOString();
    item = { id: candidateId, ...buildItemFields(EMPTY_DEFAULTS, candidate, reviewedItemPayload, commitMode), createdAt: now, updatedAt: now };
    const items = readGuestItems();
    items.push(item);
    writeGuestItems(items);
    notifyGuestListeners();
  }
  // decision.action === "mark_committed_only" falls through here with
  // `item` already set to the existing item, unchanged.

  await updateIngestionCandidate(ctx, candidateId, { reviewStatus: "committed" });
  return item;
}

/**
 * commitCandidateToItem(ctx, candidateId, reviewedItemPayload, opts?) -> item
 * The only supported way to turn an IngestionCandidate into a canonical
 * Item. Safe to call more than once with the same candidateId (retries,
 * double-submits, recovery from the Review Inbox) — see the module doc
 * comment above for the exact reviewStatus/existence rules.
 *
 * opts.commitMode ("automatic" | "reviewed", default "reviewed") — audit
 * metadata only, written onto the Item once at creation (see
 * buildItemFields above); never affects which candidates are committable
 * or how the transaction itself behaves.
 */
export async function commitCandidateToItem(ctx, candidateId, reviewedItemPayload, { commitMode } = {}) {
  if (ctx?.isAdmin) return commitGuest(ctx, candidateId, reviewedItemPayload, commitMode);
  if (!db || !ctx?.uid) throw new Error("No signed-in account to save to.");
  return commitReal(ctx, candidateId, reviewedItemPayload, commitMode);
}
