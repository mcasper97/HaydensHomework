/**
 * Focused unit tests for src/organizer/recurringObligationMatch.js
 * (recurring-obligations increment) — the narrow, deterministic
 * reconciliation used to avoid creating duplicate recurring Items or
 * repeatedly asking a parent to approve the same standing obligation.
 * Pure logic, zero imports — safe to test directly in plain Node.
 *
 * Usage: node tests/recurring-obligation-match.unit.mjs
 */
import { normalizeObligationAction, resolveTargetKey, buildObligationSignature, canReconcile } from "../src/organizer/recurringObligationMatch.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ normalizeObligationAction ============
ok(
  "The user's own worked example: 'Send a healthy snack daily' and 'Remember to send a healthy snack each day' normalize identically",
  normalizeObligationAction("Send a healthy snack daily") === normalizeObligationAction("Remember to send a healthy snack each day")
);
ok(
  "'Nightly Agenda Initialing by Parent' normalizes the same way regardless of casing/filler-word placement",
  normalizeObligationAction("Nightly Agenda Initialing by Parent") === normalizeObligationAction("Agenda Initialing by Parent nightly")
);
ok(
  "No stemming/fuzzy matching: a different word form ('initial' vs 'initialing') is NOT normalized to the same string — deterministic, not similarity-based",
  normalizeObligationAction("Please initial the agenda each night") !== normalizeObligationAction("Nightly Agenda Initialing by Parent")
);
ok("Case-insensitive", normalizeObligationAction("Review Study Guides") === normalizeObligationAction("review study guides"));
ok("Punctuation is stripped", normalizeObligationAction("Gold Folder: Review, Sign, and Return Monday") === normalizeObligationAction("Gold Folder Review Sign and Return Monday"));
ok("Filler words (a/an/the/please/remember/to/daily/nightly/each/every/night/nights/day/days) are stripped", normalizeObligationAction("please remember to send the snack") === "send snack");
ok("Genuinely different actions do NOT normalize to the same string", normalizeObligationAction("Send a healthy snack daily") !== normalizeObligationAction("Send a permission slip Monday"));
ok("A non-string input normalizes to an empty string rather than throwing", normalizeObligationAction(null) === "" && normalizeObligationAction(undefined) === "");
ok("Extra whitespace collapses/trims", normalizeObligationAction("  send   snack  ") === normalizeObligationAction("send snack"));

// ============ resolveTargetKey ============
ok("null/undefined input resolves to 'family'", resolveTargetKey(null) === "family" && resolveTargetKey(undefined) === "family");
ok("Item-shaped input with empty childIds resolves to 'family'", resolveTargetKey({ childIds: [] }) === "family");
ok("Item-shaped input with one child resolves to a children: key", resolveTargetKey({ childIds: ["hayden-1"] }) === "children:hayden-1");
ok("Item-shaped input with multiple children is order-independent (sorted)", resolveTargetKey({ childIds: ["b", "a"] }) === resolveTargetKey({ childIds: ["a", "b"] }));
ok("Candidate-shaped 'child' target resolves the same way an Item with that one childId would", resolveTargetKey({ targetType: "child", targetChildId: "hayden-1" }) === resolveTargetKey({ childIds: ["hayden-1"] }));
ok("Candidate-shaped 'family' target resolves to 'family'", resolveTargetKey({ targetType: "family" }) === "family");
ok("Candidate-shaped 'review' (unresolved) target also resolves to 'family', matching the app's existing convention", resolveTargetKey({ targetType: "review" }) === "family");
ok("A single-child household-wide target is never confused with a two-child one", resolveTargetKey({ childIds: ["a"] }) !== resolveTargetKey({ childIds: ["a", "b"] }));

// ============ buildObligationSignature + canReconcile ============
function sig({ type = "reminder", title, recurring = true, target = null }) {
  return buildObligationSignature({ type, title, recurring, target });
}

// The user's own worked "should reconcile" example.
ok(
  "Same type/target: 'Send a healthy snack daily' reconciles with 'Remember to send a healthy snack each day'",
  canReconcile(
    sig({ title: "Send a healthy snack daily", target: { targetType: "family" } }),
    sig({ title: "Remember to send a healthy snack each day", target: { childIds: [] } })
  )
);

// Hard gates — every one must hold; a single mismatch blocks reconciliation.
ok("Different type never reconciles, even with identical wording", !canReconcile(sig({ type: "reminder", title: "Send snack daily" }), sig({ type: "chore", title: "Send snack daily" })));
ok("Non-recurring on either side never reconciles", !canReconcile(sig({ title: "Send snack daily", recurring: true }), sig({ title: "Send snack daily", recurring: false })));
ok("Both non-recurring never reconciles either (this module only ever applies when BOTH sides are recurring)", !canReconcile(sig({ title: "Send snack daily", recurring: false }), sig({ title: "Send snack daily", recurring: false })));
ok(
  "Different child target never reconciles (different child, same wording)",
  !canReconcile(sig({ title: "Review study guides nightly", target: { targetType: "child", targetChildId: "hayden-1" } }), sig({ title: "Review study guides nightly", target: { targetType: "child", targetChildId: "payton-2" } }))
);
ok(
  "Family-wide vs a specific child is never reconciled even with identical wording",
  !canReconcile(sig({ title: "Review study guides nightly", target: { targetType: "family" } }), sig({ title: "Review study guides nightly", target: { targetType: "child", targetChildId: "hayden-1" } }))
);
ok(
  "Materially different action text never reconciles — no loose token-overlap/similarity scoring",
  !canReconcile(sig({ title: "Send a healthy snack daily" }), sig({ title: "Send a permission slip Monday" }))
);
ok(
  "Partial word overlap alone is NOT enough (guards against a token-overlap heuristic sneaking back in)",
  !canReconcile(sig({ title: "Review Study Guides with Child Nightly" }), sig({ title: "Review Math Homework Nightly" }))
);
ok("An empty/unusable normalized action never reconciles with anything, even itself", !canReconcile(sig({ title: "" }), sig({ title: "" })));
ok("null/undefined signatures never reconcile", !canReconcile(null, sig({ title: "X" })) && !canReconcile(sig({ title: "X" }), undefined));

// Explicitly-stopped / substantially-changed obligations must surface for review, not silently merge.
ok(
  "A candidate describing a DIFFERENT standing instruction for the same child never reconciles just because both are recurring reminders",
  !canReconcile(
    sig({ title: "Gold Folder: Review, Sign, and Return Monday", target: { targetType: "child", targetChildId: "hayden-1" } }),
    sig({ title: "Nightly Agenda Initialing by Parent", target: { targetType: "child", targetChildId: "hayden-1" } })
  )
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
