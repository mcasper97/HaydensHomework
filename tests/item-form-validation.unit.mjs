/**
 * Focused unit tests for src/organizer/itemFormValidation.js's
 * canSubmitItemForm (#26, Commit 5 correction). This is the exact rule
 * ItemForm.jsx uses both for its submit button's `disabled` state and its
 * handleSubmit's early return — proving it here proves both, without
 * needing a DOM/React test runner (none is set up in this project; see
 * candidateToDraftItem.js for the same zero-JSX-file rationale).
 *
 * The bug this corrects: a "family"-targeted email candidate is meant to
 * be approvable with zero children selected (childIds: []), but ItemForm's
 * original rule (`childIds.length === 0` always blocks submit) made that
 * literally impossible — the button stayed disabled forever unless the
 * parent picked a specific child, silently defeating "genuinely
 * household-wide." `familyWide` is the opt-in escape hatch for exactly
 * that one case; every other caller never sets it and gets the original,
 * unmodified rule.
 *
 * Usage: node tests/item-form-validation.unit.mjs
 */
import { canSubmitItemForm } from "../src/organizer/itemFormValidation.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ Original, unmodified rule (familyWide absent/false) ============
ok("Title + at least one child, no familyWide: submittable (unchanged normal case)", canSubmitItemForm({ title: "Field trip", childIds: ["c1"] }));
ok("Title but zero children, no familyWide: NOT submittable — this is the review-target case, must require a child", !canSubmitItemForm({ title: "Field trip", childIds: [] }));
ok("Empty title, even with children selected: NOT submittable", !canSubmitItemForm({ title: "", childIds: ["c1"] }));
ok("Whitespace-only title: NOT submittable", !canSubmitItemForm({ title: "   ", childIds: ["c1"] }));
ok("Missing title entirely: NOT submittable", !canSubmitItemForm({ childIds: ["c1"] }));
ok("familyWide explicitly false behaves identically to it being absent", !canSubmitItemForm({ title: "X", childIds: [], familyWide: false }));

// ============ Family-wide escape hatch (#26 fix) ============
ok("Title + familyWide true + zero children: submittable — the actual fix", canSubmitItemForm({ title: "Picture Day", childIds: [], familyWide: true }));
ok("Title + familyWide true, even with children ALSO selected: still submittable (not mutually exclusive at this pure-logic level)", canSubmitItemForm({ title: "X", childIds: ["c1"], familyWide: true }));
ok("familyWide true does NOT bypass the title requirement", !canSubmitItemForm({ title: "", childIds: [], familyWide: true }));
ok("familyWide true with missing childIds entirely (undefined) still submittable", canSubmitItemForm({ title: "X", familyWide: true }));

// ============ Equivalence check: familyWide falsy is mathematically identical to the pre-fix inline rule ============
{
  const cases = [
    { title: "X", childIds: ["a"] },
    { title: "X", childIds: [] },
    { title: "", childIds: ["a"] },
    { title: "  ", childIds: [] },
  ];
  for (const c of cases) {
    const oldRule = !!(c.title && c.title.trim()) && c.childIds.length > 0;
    const newRule = canSubmitItemForm(c);
    ok(`Matches the original pre-fix rule exactly for title=${JSON.stringify(c.title)}, childIds.length=${c.childIds.length}`, oldRule === newRule);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
