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
import { canSubmitItemForm, resolveFamilyWideOption, resolveSubmittedChildIds } from "../src/organizer/itemFormValidation.js";
import { candidateToDraftItem } from "../src/organizer/candidateToDraftItem.js";

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

// ============ Live-validation defect fix (#26, Commit 5 correction): "review"-targeted
// candidates must offer Family, not just specific children ============
const CHILDREN = [
  { id: "hayden-1", name: "Hayden", emoji: "🦁" },
  { id: "payton-2", name: "Payton", emoji: "🐯" },
];

// 1. review-target candidate starts with neither child nor Family selected
{
  const draft = candidateToDraftItem({ proposedType: "school_event", title: "Back to School Night", targetType: "review", targetChildId: null }, null);
  const { allowFamilyWide, initialFamilyWide } = resolveFamilyWideOption("review");
  ok("A review-target candidate's draft starts with zero children selected", draft.childIds.length === 0);
  ok("A review-target candidate offers the Family option at all", allowFamilyWide === true);
  ok("A review-target candidate's Family option does NOT start checked", initialFamilyWide === false);
}

// 2. Approve & Add disabled initially (title present, but nothing assigned yet)
ok("Initial review-target state (childIds: [], familyWide: false) is NOT submittable", !canSubmitItemForm({ title: "Back to School Night", childIds: [], familyWide: false }));

// 3. selecting a child enables approval
ok("Picking a specific child makes it submittable", canSubmitItemForm({ title: "Back to School Night", childIds: ["hayden-1"], familyWide: false }));

// 4. selecting Family enables approval
ok("Checking Family makes it submittable, with zero children picked", canSubmitItemForm({ title: "Back to School Night", childIds: [], familyWide: true }));

// 5. Family saves with childIds: []
ok("Submitting with Family checked always resolves to childIds: []", JSON.stringify(resolveSubmittedChildIds({ childIds: [], familyWide: true })) === "[]");
ok("Family checked forces childIds: [] even if the (hidden) pill picker somehow still had a stale selection", JSON.stringify(resolveSubmittedChildIds({ childIds: ["hayden-1"], familyWide: true })) === "[]");
ok("Family-wide submission is never every current child — it's an explicit empty array, not CHILDREN.map(c => c.id)", resolveSubmittedChildIds({ childIds: [], familyWide: true }).length !== CHILDREN.length);

// 6. child selection saves with that childId
ok("Submitting with a specific child picked (Family unchecked) saves exactly that child", JSON.stringify(resolveSubmittedChildIds({ childIds: ["payton-2"], familyWide: false })) === '["payton-2"]');

// 7. family-target candidate defaults to Family
{
  const { allowFamilyWide, initialFamilyWide } = resolveFamilyWideOption("family");
  ok("A family-target candidate offers the Family option", allowFamilyWide === true);
  ok("A family-target candidate's Family option starts checked by default", initialFamilyWide === true);
}

// 8. child-target candidate defaults to the configured child (and never offers Family)
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "Spelling Test", targetType: "child", targetChildId: "hayden-1" }, null);
  const { allowFamilyWide } = resolveFamilyWideOption("child");
  ok("A child-target candidate's draft is preselected to the CONFIGURED child", draft.childIds.length === 1 && draft.childIds[0] === "hayden-1");
  ok("A child-target candidate never offers the Family option", allowFamilyWide === false);
}
{
  // AI's own childName guess must never override the configured child —
  // already proven in candidate-to-draft-item.unit.mjs; re-asserted here
  // in this defect's own context for completeness.
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: "Someone Else", targetType: "child", targetChildId: "hayden-1" }, null);
  ok("The AI's proposedChildName guess never overrides the sender-configured child", draft.childIds[0] === "hayden-1");
}

// 9. photo-ingestion review behavior remains unchanged (no household-wide context)
{
  // Photo/CSV candidates never set targetType at all. Called exactly as
  // the immediate single-child photo-capture flow calls it (no second
  // arg) — must be byte-for-byte unchanged by the legacy-family fix below.
  const { allowFamilyWide, initialFamilyWide } = resolveFamilyWideOption(undefined);
  ok("A candidate with no targetType (photo/CSV ingestion), called with no household-wide context, never offers Family", allowFamilyWide === false);
  ok("...and its Family option (moot, since it's never offered) is not checked either", initialFamilyWide === false);

  const photoChild = { id: "child-1", name: "Ava", emoji: "🦁" };
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: "Ava" }, photoChild);
  ok("Photo ingestion's single-in-scope-child prefill is completely unaffected by this fix", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
  ok("Photo ingestion's submit rule is unaffected: zero children (no ambient child) still blocks submit, exactly as before", !canSubmitItemForm({ title: "X", childIds: [] }));
}

// 10. Legacy-family compatibility fix: a null/undefined-targetType
// candidate ONLY gains Family when reviewed in a household-wide context
// (legacyFamilyWide: true — the Review Inbox, never the immediate
// single-child photo flow, which never passes this).
{
  const withoutContext = resolveFamilyWideOption(undefined, false);
  ok("Explicitly passing legacyFamilyWide: false behaves exactly like omitting it", withoutContext.allowFamilyWide === false && withoutContext.initialFamilyWide === false);

  const nullWithContext = resolveFamilyWideOption(null, true);
  ok("A null-targetType candidate reviewed with household-wide context now offers Family", nullWithContext.allowFamilyWide === true);
  ok("...but Family is never preselected for it (the parent must choose)", nullWithContext.initialFamilyWide === false);

  const undefinedWithContext = resolveFamilyWideOption(undefined, true);
  ok("An undefined-targetType candidate reviewed with household-wide context also offers Family", undefinedWithContext.allowFamilyWide === true);
  ok("...and is likewise never preselected", undefinedWithContext.initialFamilyWide === false);

  // Explicit targetType values must be completely unaffected by the new
  // second argument, whether household-wide context is present or not —
  // legacyFamilyWide only ever matters for null/undefined.
  for (const context of [false, true]) {
    const child = resolveFamilyWideOption("child", context);
    ok(`Explicit "child" targetType never offers Family, regardless of household-wide context (${context})`, child.allowFamilyWide === false && child.initialFamilyWide === false);

    const family = resolveFamilyWideOption("family", context);
    ok(`Explicit "family" targetType keeps offering Family, preselected, regardless of household-wide context (${context})`, family.allowFamilyWide === true && family.initialFamilyWide === true);

    const review = resolveFamilyWideOption("review", context);
    ok(`Explicit "review" targetType keeps offering Family, unchecked, regardless of household-wide context (${context})`, review.allowFamilyWide === true && review.initialFamilyWide === false);
  }

  // No child is ever inferred by this fix — candidateToDraftItem.js's own
  // childIds logic is untouched; a legacy candidate reviewed with no
  // ambient `child` (the Review Inbox's own calling convention) still
  // starts with zero children selected.
  const legacyDraft = candidateToDraftItem({ proposedType: "reminder", title: "Field Trip Form", targetType: null, targetChildId: null }, null);
  ok("A legacy null-targetType candidate reviewed with no ambient child still starts with zero children selected (no inference)", legacyDraft.childIds.length === 0);
  ok("...and is not submittable until the parent picks a learner or Family", !canSubmitItemForm({ title: "Field Trip Form", childIds: legacyDraft.childIds, familyWide: false }));
  ok("...but IS submittable once the parent checks Family, with zero children picked", canSubmitItemForm({ title: "Field Trip Form", childIds: legacyDraft.childIds, familyWide: true }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
