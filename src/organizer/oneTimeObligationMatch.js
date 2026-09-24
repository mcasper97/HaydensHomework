/* ============================== One-time obligation reconciliation ==============================
 * Slice 3 — extends the recurring-obligations increment's reconciliation
 * approach to one-time obligations (school events, family events, tests,
 * quizzes, assignments, projects, reminders, one-time study tasks), so a
 * repeated source describing the same real-world one-time obligation
 * (e.g. a PTA newsletter followed by a linked webpage repeating the same
 * event, or next week's reminder about the same already-approved event)
 * does not create a duplicate review candidate or a duplicate canonical
 * Item.
 *
 * Deliberately a SEPARATE module from recurringObligationMatch.js, not a
 * generalization of it — recurring obligations have no discrete calendar
 * date to compare, and this module's title normalization intentionally
 * uses a much smaller filler-word list (see normalizeOneTimeAction below).
 * recurringObligationMatch.js's own `canReconcile` and
 * `buildObligationSignature` are untouched by this slice — only its
 * shape-agnostic `resolveTargetKey` is reused here, since resolving "who
 * is this for" into a comparable key has nothing recurring-specific
 * about it.
 *
 * Same trust posture as recurring reconciliation: every gate below is a
 * hard, exact requirement — no token-overlap/similarity score, no ML, no
 * fuzzy percentage threshold. If normalized wording isn't EXACTLY equal
 * (after deterministic normalization), or any other hard gate fails,
 * that's "uncertain," and uncertain always falls through to a normal
 * pending candidate for the parent to review — never silently merged,
 * never silently dropped. False negatives (an extra review card) are
 * preferable to a false-positive merge.
 *
 * This module is pure and Firestore-free — no reads, no writes, no
 * side effects. AuthShell.jsx's handleCheckEmail is the only caller: it
 * loads existing Items once, builds one signature per existing one-time
 * Item via buildOneTimeSignatureFromItem, then calls
 * decideOneTimeReconciliation once per newly extracted one-time
 * obligation. AuthShell owns orchestration (fetching, looping,
 * persisting, deciding what reaches the review queue) — it must never
 * reimplement any comparison logic itself; everything that decides
 * whether two obligations are "the same" lives here.
 */
import { resolveTargetKey } from "./recurringObligationMatch.js";
import { DUE_DATE_TYPES } from "./candidateToDraftItem.js";

// Deliberately much smaller than recurringObligationMatch.js's own
// FILLER_WORDS list. That list strips "day"/"night"/"each"/"every" because
// those are genuinely filler in a RECURRING instruction's phrasing
// ("each night", "every day"). A one-time event's title routinely uses
// those exact words as part of its actual name ("PTA Spirit Night",
// "Picture Day") — stripping them there would silently reduce a title's
// distinctiveness for no benefit (the primary defense against a
// false-positive merge is the hard type/target/date gates below, not
// title normalization). This list keeps only pure connective filler.
const FILLER_WORDS = new Set(["a", "an", "the", "please", "remember", "to"]);

/**
 * normalizeOneTimeAction(title) -> a normalized, order-preserving,
 * filler-stripped string. Deterministic: the same input always produces
 * the same output; no randomness, no scoring. Structurally identical to
 * recurringObligationMatch.js's normalizeObligationAction, just with the
 * narrower filler list above — intentionally NOT shared code, since the
 * two lists must be free to diverge without risk to the other domain.
 */
export function normalizeOneTimeAction(title) {
  if (typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !FILLER_WORDS.has(word))
    .join(" ")
    .trim();
}

function buildOneTimeSignature({ type, title, target, date, startTime, endTime }) {
  return {
    type: type || null,
    targetKey: resolveTargetKey(target),
    normalizedAction: normalizeOneTimeAction(title),
    date: date || null,
    startTime: startTime || null,
    endTime: endTime || null,
  };
}

/**
 * buildOneTimeSignatureFromItem(item) -> signature
 * The one place an existing canonical Item's "effective date/time" is
 * read for one-time matching — applies the exact same due-vs-start field
 * routing ItemForm.jsx's showsField() and candidateToDraftItem.js's own
 * mapping already use (DUE_DATE_TYPES), so a caller (AuthShell.jsx) never
 * has to know which flat field means "the date" for a given type. Reads
 * only content fields (type/title/dates/times/childIds) — never
 * sourceCandidateId or any other provenance field — so a legacy Item that
 * predates Slice 2's sourceCandidateId still matches normally.
 */
export function buildOneTimeSignatureFromItem(item) {
  const isDue = DUE_DATE_TYPES.includes(item?.type);
  return buildOneTimeSignature({
    type: item?.type,
    title: item?.title,
    target: { childIds: item?.childIds },
    date: isDue ? item?.dueDate : item?.startDate,
    startTime: isDue ? item?.dueTime : item?.startTime,
    endTime: isDue ? null : item?.endTime,
  });
}

/**
 * canReconcileOneTime(signatureA, signatureB) -> boolean
 * All gates below are hard requirements:
 *   - same canonical type
 *   - same resolved target (targetKey — an exact set match, see
 *     resolveTargetKey; family-wide is never confused with a specific
 *     child, or vice versa)
 *   - same effective date (both present, exact string equality — a
 *     missing date on either side can never match)
 *   - strong normalized-title/action equivalence (both non-empty, exact
 *     string equality — no fuzzy threshold)
 * Time is NOT a hard gate on its own (its absence on one side must never
 * block an otherwise-exact match — school-event extraction often has no
 * stated time), but it IS a hard block when BOTH sides state a time and
 * they disagree: a conflicting explicit time means the two sources
 * disagree about the obligation itself (e.g. a moved/rescheduled time),
 * which must never be silently merged, even if every other gate matched.
 */
export function canReconcileOneTime(signatureA, signatureB) {
  if (!signatureA || !signatureB) return false;
  if (signatureA.type !== signatureB.type) return false;
  if (signatureA.targetKey !== signatureB.targetKey) return false;
  if (!signatureA.date || !signatureB.date || signatureA.date !== signatureB.date) return false;
  if (!signatureA.normalizedAction || !signatureB.normalizedAction) return false;
  if (signatureA.normalizedAction !== signatureB.normalizedAction) return false;
  if (signatureA.startTime && signatureB.startTime && signatureA.startTime !== signatureB.startTime) return false;
  if (signatureA.endTime && signatureB.endTime && signatureA.endTime !== signatureB.endTime) return false;
  return true;
}

/**
 * classifyOneTimeMatch(signatureA, signatureB) -> "match" | "conflict" | "none"
 * A strictly ADDITIVE, finer-grained view of the same comparison
 * canReconcileOneTime already makes — never changes that function's own
 * boolean contract or any of its existing call sites.
 *
 *   "match"    — canReconcileOneTime(signatureA, signatureB) would also be
 *                true.
 *   "conflict" — type, target, AND the exact normalized title all match
 *                (per this module's own hard-gate philosophy, that alone
 *                is already strong enough to call these two sources "the
 *                same real-world obligation" — see the module doc comment
 *                above), but the two sources disagree about WHEN it is:
 *                either a stated date that differs, or (when the dates
 *                agree) an explicit start/end time that differs. This is
 *                exactly the case canReconcileOneTime itself treats as a
 *                hard, unmergeable block — classifyOneTimeMatch exists
 *                only to let a caller DISTINGUISH that specific case from
 *                "unrelated obligation" ("none"), so it can route a
 *                genuine conflict to human review instead of silently
 *                treating it as a normal, independent new obligation (see
 *                decideOneTimeReconciliation's additive `conflict` field
 *                below, and api/_gmailIngestionRunner.js, its one caller
 *                that acts on it).
 *   "none"     — not recognizably the same obligation at all (including
 *                the fail-safe case where either side has no date at
 *                all — same as canReconcileOneTime, never claims a
 *                relationship without a comparable date on both sides).
 */
export function classifyOneTimeMatch(signatureA, signatureB) {
  if (!signatureA || !signatureB) return "none";
  if (signatureA.type !== signatureB.type) return "none";
  if (signatureA.targetKey !== signatureB.targetKey) return "none";
  if (!signatureA.normalizedAction || !signatureB.normalizedAction) return "none";
  if (signatureA.normalizedAction !== signatureB.normalizedAction) return "none";
  if (!signatureA.date || !signatureB.date) return "none";

  if (signatureA.date !== signatureB.date) return "conflict";

  const timeConflict =
    (signatureA.startTime && signatureB.startTime && signatureA.startTime !== signatureB.startTime) ||
    (signatureA.endTime && signatureB.endTime && signatureA.endTime !== signatureB.endTime);
  if (timeConflict) return "conflict";

  return "match";
}

/**
 * decideOneTimeReconciliation({ obligation, target, existingSignatures, runRecords }) -> decision
 *
 * The one production decision function AuthShell.jsx's handleCheckEmail
 * calls for every one-time (non-recurring) extracted obligation — the
 * SAME code path unit tests exercise directly (no mirrored/reimplemented
 * copy of this logic exists anywhere else).
 *
 *   obligation — { type, title, date, startTime, endTime }, the raw
 *     extracted one-time obligation (flat fields, as produced by
 *     api/_emailExtraction.js / api/extract-obligations.js — never a
 *     candidate or Item shape).
 *   target — { targetType, targetChildId }, the sender's CONFIGURED
 *     target (never the AI's own guess) — same shape
 *     resolveTargetKey's candidate-shaped branch already accepts.
 *   existingSignatures — [{ itemId, signature }], one entry per existing
 *     one-time canonical Item in this household (signature built via
 *     buildOneTimeSignatureFromItem by the caller).
 *   runRecords — [{ candidateId, signature }], one entry per candidate
 *     ALREADY CREATED as a fresh ("new") candidate earlier in this SAME
 *     Check Email run — never includes a corroborated candidate (a
 *     duplicate must always trace back to the original first occurrence,
 *     not chain onto another duplicate).
 *
 * Returns exactly one of three outcomes:
 *   "existing_item"      — corroborates an already-existing canonical
 *                           Item. reconciledItemId is that Item's real
 *                           id; reconciledCandidateId is always null.
 *   "same_run_duplicate"  — corroborates an earlier candidate created
 *                           in this SAME run, which has no canonical Item
 *                           yet (it may still be approved, rejected, or
 *                           deferred). reconciledCandidateId is that
 *                           earlier candidate's real id; reconciledItemId
 *                           is always null — it must never be populated
 *                           with a candidate id standing in for an Item
 *                           id that may never exist. The two id fields
 *                           are never both non-null for the same decision.
 *   "new"                 — no match; a normal pending candidate. The
 *                           caller is responsible for appending this
 *                           decision's own signature (paired with the
 *                           newly created candidate's real id) to
 *                           runRecords before deciding the next
 *                           obligation, so a LATER same-run duplicate can
 *                           be found.
 *
 * `conflict` (additive field, always present, only ever non-null alongside
 * outcome "new") — set when classifyOneTimeMatch (above) recognizes this
 * obligation as almost certainly the SAME real-world obligation as an
 * existing Item or an earlier same-run candidate, but disagreeing about
 * when it is (a conflicting date, or a conflicting explicit time on a
 * shared date) — exactly the case canReconcileOneTime itself refuses to
 * treat as a match. Shape: { itemId, candidateId } with exactly one of the
 * two non-null, mirroring reconciledItemId/reconciledCandidateId's own
 * "never both non-null" convention. This NEVER changes the outcome string
 * itself or either reconciled*Id field on THIS return value — a caller
 * that only reads `outcome`/`reconciledItemId`/`reconciledCandidateId`
 * (as src/GmailCheckEmailAction.jsx's handleCheckEmail already does) sees
 * no behavior change at all; `conflict` is there only for a caller that
 * explicitly wants to detect this case and route it to review rather than
 * normal automatic finalization (see api/_gmailIngestionRunner.js).
 */
export function decideOneTimeReconciliation({ obligation, target, existingSignatures = [], runRecords = [] }) {
  const signature = buildOneTimeSignature({
    type: obligation?.type,
    title: obligation?.title,
    target,
    date: obligation?.date,
    startTime: obligation?.startTime,
    endTime: obligation?.endTime,
  });

  const existingMatch = existingSignatures.find((entry) => canReconcileOneTime(signature, entry.signature));
  if (existingMatch) {
    return { outcome: "existing_item", signature, reconciledItemId: existingMatch.itemId, reconciledCandidateId: null, conflict: null };
  }

  const runMatch = runRecords.find((entry) => canReconcileOneTime(signature, entry.signature));
  if (runMatch) {
    return { outcome: "same_run_duplicate", signature, reconciledItemId: null, reconciledCandidateId: runMatch.candidateId, conflict: null };
  }

  const existingConflict = existingSignatures.find((entry) => classifyOneTimeMatch(signature, entry.signature) === "conflict");
  const runConflict = !existingConflict ? runRecords.find((entry) => classifyOneTimeMatch(signature, entry.signature) === "conflict") : null;
  const conflict = existingConflict
    ? { itemId: existingConflict.itemId, candidateId: null }
    : runConflict
    ? { itemId: null, candidateId: runConflict.candidateId }
    : null;

  return { outcome: "new", signature, reconciledItemId: null, reconciledCandidateId: null, conflict };
}
