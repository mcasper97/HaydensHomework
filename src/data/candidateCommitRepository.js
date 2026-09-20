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

export const COMMIT_ERROR_CODES = {
  CANDIDATE_NOT_FOUND: "CANDIDATE_NOT_FOUND",
  NOT_COMMITTABLE: "NOT_COMMITTABLE",
  COMMITTED_ITEM_MISSING: "COMMITTED_ITEM_MISSING",
};

function commitError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Explicit allowlist — only these reviewStatus values may attempt a
// fresh-or-recovery commit. "committed" is handled separately (idempotent
// success or COMMITTED_ITEM_MISSING, see above); every other value —
// including any future/unknown status — is refused rather than assumed
// committable.
const COMMITTABLE_STATUSES = new Set(["pending", "approved"]);

function buildItemFields(candidate, reviewedItemPayload) {
  return {
    ...EMPTY_DEFAULTS,
    ...reviewedItemPayload,
    sourceRecordId: reviewedItemPayload?.sourceRecordId ?? candidate.sourceRecordId ?? null,
    sourceCandidateId: candidate.id,
  };
}

async function commitReal(ctx, candidateId, reviewedItemPayload) {
  const candRef = doc(db, "users", ctx.uid, "ingestionCandidates", candidateId);
  const itemRef = doc(db, "users", ctx.uid, "items", candidateId);

  return runTransaction(db, async (tx) => {
    const candSnap = await tx.get(candRef);
    if (!candSnap.exists()) {
      throw commitError(COMMIT_ERROR_CODES.CANDIDATE_NOT_FOUND, "This suggestion no longer exists.");
    }
    const candidate = { id: candSnap.id, ...candSnap.data() };
    const itemSnap = await tx.get(itemRef);

    if (candidate.reviewStatus === "committed") {
      if (itemSnap.exists()) {
        return { id: itemSnap.id, ...itemSnap.data() };
      }
      throw commitError(
        COMMIT_ERROR_CODES.COMMITTED_ITEM_MISSING,
        "This item was already marked added, but its record is missing. Please contact support."
      );
    }

    if (!COMMITTABLE_STATUSES.has(candidate.reviewStatus)) {
      throw commitError(COMMIT_ERROR_CODES.NOT_COMMITTABLE, "This suggestion can no longer be added.");
    }

    // Item already exists (e.g. a retried commit after the candidate's
    // own status update failed on a previous attempt) — never overwrite it
    // with the currently submitted payload, just finish moving the
    // candidate to "committed".
    if (itemSnap.exists()) {
      tx.update(candRef, { reviewStatus: "committed" });
      return { id: itemSnap.id, ...itemSnap.data() };
    }

    const fields = buildItemFields(candidate, reviewedItemPayload);
    tx.set(itemRef, {
      ...fields,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.update(candRef, { reviewStatus: "committed" });
    return { id: itemRef.id, ...fields };
  });
}

async function commitGuest(ctx, candidateId, reviewedItemPayload) {
  const candidate = await getIngestionCandidate(ctx, candidateId);
  if (!candidate) {
    throw commitError(COMMIT_ERROR_CODES.CANDIDATE_NOT_FOUND, "This suggestion no longer exists.");
  }

  const existingItem = await getItem(ctx, candidateId);

  if (candidate.reviewStatus === "committed") {
    if (existingItem) return existingItem;
    throw commitError(
      COMMIT_ERROR_CODES.COMMITTED_ITEM_MISSING,
      "This item was already marked added, but its record is missing. Please contact support."
    );
  }

  if (!COMMITTABLE_STATUSES.has(candidate.reviewStatus)) {
    throw commitError(COMMIT_ERROR_CODES.NOT_COMMITTABLE, "This suggestion can no longer be added.");
  }

  let item = existingItem;
  if (!item) {
    const now = new Date().toISOString();
    item = { id: candidateId, ...buildItemFields(candidate, reviewedItemPayload), createdAt: now, updatedAt: now };
    const items = readGuestItems();
    items.push(item);
    writeGuestItems(items);
    notifyGuestListeners();
  }

  await updateIngestionCandidate(ctx, candidateId, { reviewStatus: "committed" });
  return item;
}

/**
 * commitCandidateToItem(ctx, candidateId, reviewedItemPayload) -> item
 * The only supported way to turn an IngestionCandidate into a canonical
 * Item. Safe to call more than once with the same candidateId (retries,
 * double-submits, recovery from the Review Inbox) — see the module doc
 * comment above for the exact reviewStatus/existence rules.
 */
export async function commitCandidateToItem(ctx, candidateId, reviewedItemPayload) {
  if (ctx?.isAdmin) return commitGuest(ctx, candidateId, reviewedItemPayload);
  if (!db || !ctx?.uid) throw new Error("No signed-in account to save to.");
  return commitReal(ctx, candidateId, reviewedItemPayload);
}
