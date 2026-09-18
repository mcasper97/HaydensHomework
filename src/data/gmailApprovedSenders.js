/* ============================== Approved Gmail sender — pure validation ==============================
 * Zero-import module (mirrors src/data/itemTypes.js's pattern) so this
 * validation logic can be shared by the client repository
 * (gmailApprovedSendersRepository.js) and unit-tested directly in Node
 * without touching firebase/firestore or ./Firebase.js.
 *
 * Exact addresses only — deliberately no domain/wildcard matching (e.g. no
 * "@schoolname.edu" catch-all). This is the actual filter that will decide
 * whose email gets read once extraction is wired up in a later commit, so
 * it stays as narrow and explicit as what the parent typed.
 */

export function normalizeSenderEmail(raw) {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

// Deliberately simple (not a full RFC 5322 validator) — good enough to
// catch obvious typos without rejecting any real address a parent would
// plausibly type.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidSenderEmail(email) {
  return typeof email === "string" && EMAIL_PATTERN.test(email);
}

/* ─────────────────────── Sender target (#26, Commit 4.1) ───────────────────────
 * Each approved sender has exactly one target — who an obligation from that
 * sender belongs to. Deliberately one-to-one for now (see the work package
 * note: "Do NOT build many-to-many sender mappings yet").
 */
export const SENDER_TARGET_TYPES = ["child", "family", "review"];

/**
 * Normalizes a raw stored sender record's target for backward compatibility.
 * Any record predating this field (missing or invalid targetType) behaves
 * exactly as required: targetType "review", childId null — applied at read
 * time in the repository, so no migration write is ever needed.
 */
export function normalizeSenderTarget(raw) {
  const targetType = SENDER_TARGET_TYPES.includes(raw?.targetType) ? raw.targetType : "review";
  const childId = targetType === "child" && typeof raw?.childId === "string" && raw.childId ? raw.childId : null;
  return { targetType, childId };
}

/**
 * Validates a target before it's persisted. childId is required (a
 * non-empty string) exactly when targetType is "child", and must be
 * absent/null otherwise — never silently coerced either way.
 */
export function isValidSenderTarget({ targetType, childId } = {}) {
  if (!SENDER_TARGET_TYPES.includes(targetType)) return false;
  if (targetType === "child") return typeof childId === "string" && childId.length > 0;
  return childId === null || childId === undefined;
}

/** Builds the "Applies to" dropdown's options: every current child, then Family, then Ask during review. */
export function buildSenderTargetOptions(children) {
  const childOptions = (Array.isArray(children) ? children : []).map((c) => ({
    value: `child:${c.id}`,
    label: c.name,
  }));
  return [...childOptions, { value: "family", label: "Family" }, { value: "review", label: "Ask during review" }];
}

/** Parses one of buildSenderTargetOptions' `value`s back into a { targetType, childId } target. */
export function parseSenderTargetValue(value) {
  if (typeof value === "string" && value.startsWith("child:")) {
    return { targetType: "child", childId: value.slice("child:".length) };
  }
  if (value === "family") return { targetType: "family", childId: null };
  return { targetType: "review", childId: null };
}

/** The inverse of parseSenderTargetValue — what the dropdown should show as selected for a stored target. */
export function senderTargetToValue({ targetType, childId }) {
  if (targetType === "child" && childId) return `child:${childId}`;
  if (targetType === "family") return "family";
  return "review";
}

/**
 * Display label for a sender's current target (used as the select's
 * accessible label on the sender row — see AuthShell.jsx). Falls back
 * gracefully if the target child no longer exists.
 *
 * Deliberately stops here: how a target translates into a canonical Item's
 * childIds (or anything else) is NOT decided in this module. The Item
 * model's childIds field still serves both assignment and visibility, and
 * redesigning that is explicitly deferred — a "family" sender might end up
 * producing a family_event, a school_event, a reminder, or something else
 * entirely depending on what the email actually contains, which isn't
 * known until a later commit actually reads and classifies it. That exact
 * canonical mapping belongs with the commit that wires this into
 * CandidateReviewModal/the Item flow, not encoded here as an assumption.
 */
export function getSenderTargetLabel({ targetType, childId }, children) {
  if (targetType === "family") return "Family";
  if (targetType === "child") {
    const child = (Array.isArray(children) ? children : []).find((c) => c.id === childId);
    return child ? child.name : "Unknown learner";
  }
  return "Ask during review";
}
