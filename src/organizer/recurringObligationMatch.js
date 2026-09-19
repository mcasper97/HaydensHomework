/* ============================== Recurring obligation reconciliation ==============================
 * Deliberately narrow, deterministic, dependency-free reconciliation for
 * recurring obligations only (recurring-obligations increment). A weekly
 * teacher update repeating a standing instruction ("send a healthy snack
 * daily" this week, "remember to send a healthy snack each day" next week)
 * must not create a second recurring Item or re-ask the parent to approve
 * the same standing reminder — but a false-positive merge of two genuinely
 * different obligations is worse than asking the parent an extra time, so
 * every check here is a hard, exact gate. No token-overlap/similarity
 * score, no ML, no embeddings — if normalized wording isn't EXACTLY equal,
 * that's "uncertain," and uncertain always falls through to a normal
 * review candidate (never silently merged, never silently dropped).
 *
 * Only ever applied to obligations BOTH sides mark recurring — a one-time
 * obligation never reaches this module at all, so existing one-time
 * ingestion behavior (and its dedupe, which stays Gmail-message-id-only)
 * is completely unaffected.
 */

// Deliberately small and explicit — every word here is one this
// application's own worked examples ("nightly" / "each night" / "daily")
// actually use. Not a general stop-word list; a general-purpose one would
// risk stripping words that are actually part of the obligation's action.
const FILLER_WORDS = new Set([
  "a", "an", "the",
  "please", "remember", "to",
  "daily", "nightly", "each", "every", "night", "nights", "day", "days",
]);

/**
 * normalizeObligationAction(title) -> a normalized, order-preserving,
 * filler-stripped string. Deterministic: the same input always produces
 * the same output; no randomness, no scoring.
 */
export function normalizeObligationAction(title) {
  if (typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !FILLER_WORDS.has(word))
    .join(" ")
    .trim();
}

/**
 * resolveTargetKey({ targetType, targetChildId } | { childIds }) -> a
 * canonical string identifying who an obligation/Item is for, used as one
 * of the hard reconciliation gates. Built the same way from either an
 * IngestionCandidate-shaped input (targetType/targetChildId — "family" and
 * "review" both resolve the same way "family"/"review" already resolve to
 * household-wide elsewhere in this app, e.g. candidateToDraftItem.js) or
 * an Item-shaped input (its actual childIds array). An exact set match is
 * required — never a subset/overlap — so a two-child household-wide
 * reminder is never confused with a single-child one.
 */
export function resolveTargetKey(input) {
  if (!input) return "family";
  if (Array.isArray(input.childIds)) {
    return input.childIds.length === 0 ? "family" : `children:${[...input.childIds].sort().join(",")}`;
  }
  if (input.targetType === "child" && input.targetChildId) {
    return `children:${input.targetChildId}`;
  }
  return "family";
}

/**
 * A comparable, pre-normalized signature for one side of a reconciliation
 * check. Built once per obligation/Item by the caller (see
 * buildObligationSignature below) so canReconcile itself never has to know
 * whether it's looking at an IngestionCandidate shape or an Item shape.
 */
export function buildObligationSignature({ type, title, recurring, target }) {
  return {
    type: type || null,
    recurring: !!recurring,
    targetKey: resolveTargetKey(target),
    normalizedAction: normalizeObligationAction(title),
  };
}

/**
 * canReconcile(signatureA, signatureB) -> boolean
 * All gates are hard requirements — every one must hold, and the action
 * comparison is exact-string equality on the normalized form, never a
 * threshold/percentage. Used identically for same-run duplicate collapse
 * and for comparing a new candidate against an existing recurring Item —
 * there is no separate, looser rule for either case.
 */
export function canReconcile(signatureA, signatureB) {
  if (!signatureA || !signatureB) return false;
  if (!signatureA.recurring || !signatureB.recurring) return false;
  if (signatureA.type !== signatureB.type) return false;
  if (signatureA.targetKey !== signatureB.targetKey) return false;
  if (!signatureA.normalizedAction || !signatureB.normalizedAction) return false;
  return signatureA.normalizedAction === signatureB.normalizedAction;
}
