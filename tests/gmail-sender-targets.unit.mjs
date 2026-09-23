/**
 * Focused unit tests for approved-sender targets (#26, Commit 4.1): who an
 * obligation from a given sender belongs to (a specific child, the whole
 * family, or "ask during review"). Tests the pure logic in
 * src/data/gmailApprovedSenders.js directly — zero imports, safe in Node.
 *
 * Deliberately scoped to storage/configuration only. How a target
 * translates into a canonical Item's childIds (or anything else) is NOT
 * decided here — that mapping is Commit 5's job, once it's actually
 * integrating with CandidateReviewModal/the Item flow and knows what an
 * email actually contains. This commit stores exactly targetType
 * ("child" | "family" | "review") and childId (required only for "child").
 *
 * The client repository's persistence of these fields
 * (gmailApprovedSendersRepository.js, including updateApprovedSenderTarget)
 * isn't independently unit-tested here, consistent with existing precedent
 * (no firebase/firestore-importing repository file in this project is) —
 * but its update path is a thin, direct pass-through of parseSenderTargetValue
 * + isValidSenderTarget, both fully tested below, so what's verified here is
 * exactly the transformation logic that path is built from: changing a
 * sender's target from the UI calls parseSenderTargetValue(selectedValue)
 * to build the new target, then persists it verbatim.
 *
 * Usage: node tests/gmail-sender-targets.unit.mjs
 */
import {
  SENDER_TARGET_TYPES,
  normalizeSenderTarget,
  isValidSenderTarget,
  buildSenderTargetOptions,
  parseSenderTargetValue,
  senderTargetToValue,
  getSenderTargetLabel,
} from "../src/data/gmailApprovedSenders.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const CHILDREN = [
  { id: "hayden-abc123", name: "Hayden", emoji: "🦁" },
  { id: "payton-def456", name: "Payton", emoji: "🐯" },
];

// ============ isValidSenderTarget / normalizeSenderTarget — the persisted shape ============
{
  // "child target persists with real childId"
  const target = { targetType: "child", childId: "hayden-abc123" };
  ok("A child target with a real childId is valid", isValidSenderTarget(target));
  ok("normalizeSenderTarget preserves a valid child target's childId", normalizeSenderTarget(target).childId === "hayden-abc123");
  ok("normalizeSenderTarget preserves targetType child", normalizeSenderTarget(target).targetType === "child");
}
ok("A child target with no childId is invalid (childId is required for targetType child)", !isValidSenderTarget({ targetType: "child", childId: null }));
ok("A child target with an empty-string childId is invalid", !isValidSenderTarget({ targetType: "child", childId: "" }));

{
  // "family target persists with no childId"
  const target = { targetType: "family", childId: null };
  ok("A family target with no childId is valid", isValidSenderTarget(target));
  const normalized = normalizeSenderTarget(target);
  ok("normalizeSenderTarget keeps family target's childId null", normalized.targetType === "family" && normalized.childId === null);
}
ok("A family target that smuggles in a childId is invalid (never silently coerced)", !isValidSenderTarget({ targetType: "family", childId: "hayden-abc123" }));

{
  // "review target persists with no childId"
  const target = { targetType: "review", childId: null };
  ok("A review target with no childId is valid", isValidSenderTarget(target));
  const normalized = normalizeSenderTarget(target);
  ok("normalizeSenderTarget keeps review target's childId null", normalized.targetType === "review" && normalized.childId === null);
}
ok("A review target that smuggles in a childId is invalid", !isValidSenderTarget({ targetType: "review", childId: "hayden-abc123" }));
ok("An unrecognized targetType is invalid", !isValidSenderTarget({ targetType: "teacher", childId: null }));
ok("isValidSenderTarget fails closed on missing input, without throwing", !isValidSenderTarget(undefined));

// ============ Backward compatibility ============
{
  // "legacy sender without targetType behaves as review"
  const legacyRecord = { email: "noreply@school.org", addedAt: "2026-01-01T00:00:00.000Z" }; // no targetType/childId at all
  const normalized = normalizeSenderTarget(legacyRecord);
  ok("A legacy record (no targetType field) normalizes to targetType review", normalized.targetType === "review");
  ok("A legacy record normalizes to childId null", normalized.childId === null);
}
{
  const corruptRecord = { targetType: "not-a-real-type", childId: "hayden-abc123" };
  const normalized = normalizeSenderTarget(corruptRecord);
  ok("An invalid/corrupt stored targetType also falls back to review, not to the corrupt value", normalized.targetType === "review" && normalized.childId === null);
}
{
  // childId present but targetType isn't "child" — normalization must still null it out
  const inconsistentRecord = { targetType: "family", childId: "hayden-abc123" };
  const normalized = normalizeSenderTarget(inconsistentRecord);
  ok("A family record with a stray childId normalizes to childId null (never leaks a stale child assignment)", normalized.targetType === "family" && normalized.childId === null);
}

// ============ Dropdown options ============
{
  const options = buildSenderTargetOptions(CHILDREN);
  ok("Dropdown includes every current child profile", options.some((o) => o.label === "Hayden") && options.some((o) => o.label === "Payton"));
  ok("Dropdown includes Family", options.some((o) => o.label === "Family" && o.value === "family"));
  ok("Dropdown includes Ask during review", options.some((o) => o.label === "Ask during review" && o.value === "review"));
  ok("Dropdown has exactly children.length + 2 options (no duplicates, no extras)", options.length === CHILDREN.length + 2);
}
ok("Dropdown degrades gracefully with no children (still offers Family and Ask during review)", buildSenderTargetOptions([]).length === 2);
ok("Dropdown degrades gracefully with non-array input, without throwing", buildSenderTargetOptions(undefined).length === 2);

// ============ value <-> target round-trip ============
ok("Parses a child: value into the right target", JSON.stringify(parseSenderTargetValue("child:hayden-abc123")) === JSON.stringify({ targetType: "child", childId: "hayden-abc123" }));
ok("Parses the family value", JSON.stringify(parseSenderTargetValue("family")) === JSON.stringify({ targetType: "family", childId: null }));
ok("Parses the review value", JSON.stringify(parseSenderTargetValue("review")) === JSON.stringify({ targetType: "review", childId: null }));
ok("Unrecognized values fail closed to review", JSON.stringify(parseSenderTargetValue("garbage")) === JSON.stringify({ targetType: "review", childId: null }));
ok("senderTargetToValue is the exact inverse of parseSenderTargetValue for a child target", senderTargetToValue({ targetType: "child", childId: "hayden-abc123" }) === "child:hayden-abc123");
ok("senderTargetToValue is the exact inverse for a family target", senderTargetToValue({ targetType: "family", childId: null }) === "family");
ok("senderTargetToValue is the exact inverse for a review target", senderTargetToValue({ targetType: "review", childId: null }) === "review");

// ============ Display labels ============
ok("getSenderTargetLabel shows the child's real name", getSenderTargetLabel({ targetType: "child", childId: "hayden-abc123" }, CHILDREN) === "Hayden");
ok("getSenderTargetLabel shows Family", getSenderTargetLabel({ targetType: "family", childId: null }, CHILDREN) === "Family");
ok("getSenderTargetLabel shows Ask during review", getSenderTargetLabel({ targetType: "review", childId: null }, CHILDREN) === "Ask during review");
ok("getSenderTargetLabel degrades gracefully if the target child was since removed", getSenderTargetLabel({ targetType: "child", childId: "deleted-child-id" }, CHILDREN) === "Unknown learner");

// ============ IDENTITY SAFETY: renaming a child (same id, new display name) ============
{
  // Simulates the Settings > Children rename flow: "Hayden" -> "Henry",
  // canonical id ("hayden-abc123") unchanged. A sender's stored target
  // (targetChildId: "hayden-abc123") is keyed purely by that id and must
  // keep resolving to the SAME sender after the rename — never orphaned,
  // never silently reassigned to a different learner.
  const target = { targetType: "child", childId: "hayden-abc123" };
  const before = getSenderTargetLabel(target, CHILDREN);
  const renamedChildren = CHILDREN.map((c) => (c.id === "hayden-abc123" ? { ...c, name: "Henry" } : c));
  const after = getSenderTargetLabel(target, renamedChildren);
  ok("A sender's target label reflects the CURRENT name post-rename (still resolves the same child by id)", before === "Hayden" && after === "Henry");

  const optionsAfterRename = buildSenderTargetOptions(renamedChildren);
  ok("The dropdown option for that child's id shows the renamed display name", optionsAfterRename.some((o) => o.value === "child:hayden-abc123" && o.label === "Henry"));
  ok("The dropdown option's value (id-keyed) is unchanged by the rename", optionsAfterRename.some((o) => o.value === "child:hayden-abc123"));
  ok("No new/duplicate option was created for the renamed child (still exactly one entry for that id)", optionsAfterRename.filter((o) => o.value === "child:hayden-abc123").length === 1);
}

// ============ sender email normalization still works alongside targets ============
{
  // Re-import to confirm nothing about adding targetType broke the existing
  // email helpers (same module, same exports).
  const { normalizeSenderEmail, isValidSenderEmail } = await import("../src/data/gmailApprovedSenders.js");
  ok("normalizeSenderEmail still trims/lowercases", normalizeSenderEmail("  Teacher@School.EDU  ") === "teacher@school.edu");
  ok("isValidSenderEmail still validates ordinary addresses", isValidSenderEmail("teacher@school.edu"));
}

ok("SENDER_TARGET_TYPES is exactly the three approved values", JSON.stringify(SENDER_TARGET_TYPES) === JSON.stringify(["child", "family", "review"]));

// ============ Changing an existing sender's target ============
// The dropdown on an existing sender row (see src/GmailApprovedSendersPanel.jsx,
// moved out of AuthShell.jsx by a later UI/IA refactor, no logic change)
// calls parseSenderTargetValue(selectedValue) to
// build the new target, validates it, then persists it verbatim via
// updateApprovedSenderTarget — this is exactly that transformation.
{
  // "existing sender target can be changed" — a sender currently targeting
  // Hayden, changed to Family via the dropdown.
  const existing = { targetType: "child", childId: "hayden-abc123" };
  const newTarget = parseSenderTargetValue("family");
  ok("Changing a sender's selection to Family produces a valid target", isValidSenderTarget(newTarget));
  ok("The new target no longer resembles the old child target", newTarget.targetType !== existing.targetType);
}
{
  // "changing target from child to family clears childId"
  const newTarget = parseSenderTargetValue("family");
  ok("Switching from child to family yields childId: null (no carry-over of the old child)", newTarget.targetType === "family" && newTarget.childId === null);
}
{
  // Also verify switching child -> review clears childId the same way.
  const newTarget = parseSenderTargetValue("review");
  ok("Switching from child to review also yields childId: null", newTarget.targetType === "review" && newTarget.childId === null);
}
{
  // "changing target from family/review to child stores the selected childId"
  const fromFamily = parseSenderTargetValue("child:payton-def456");
  ok("Switching from family to a specific child stores that exact childId", fromFamily.targetType === "child" && fromFamily.childId === "payton-def456");
  const fromReview = parseSenderTargetValue("child:hayden-abc123");
  ok("Switching from review to a specific child stores that exact childId", fromReview.targetType === "child" && fromReview.childId === "hayden-abc123");
}
{
  // Round-trip: whatever the dropdown is changed to must itself be valid,
  // for every option the dropdown can actually offer.
  const options = buildSenderTargetOptions(CHILDREN);
  const allTransitionsValid = options.every((opt) => isValidSenderTarget(parseSenderTargetValue(opt.value)));
  ok("Every possible dropdown selection parses into a valid, persistable target", allTransitionsValid);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
