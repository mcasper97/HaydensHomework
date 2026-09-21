/* ============================== ItemForm submit-eligibility ==============================
 * Kept as a plain-JS module (no JSX/React) specifically so it can be
 * unit-tested directly in Node, same rationale as candidateToDraftItem.js
 * and itemTypes.js. ItemForm.jsx imports this rather than defining the
 * check inline (previously duplicated once in the disabled button and
 * once in handleSubmit's early return — this is now the single source of
 * truth for both).
 */

/**
 * Whether the form's current state is submittable. `familyWide` true
 * bypasses the "at least one child" requirement — see ItemForm.jsx's
 * `allowFamilyWide` prop for when that's ever offered. When `familyWide`
 * is false/undefined this is exactly the form's original, unmodified rule:
 * title present AND at least one child selected.
 */
export function canSubmitItemForm({ title, childIds, familyWide }) {
  const hasTitle = !!(title && title.trim());
  const hasAssignment = !!familyWide || (Array.isArray(childIds) && childIds.length > 0);
  return hasTitle && hasAssignment;
}

/**
 * Derives CandidateReviewModal.jsx's ItemForm props for the "Family"
 * option from an email candidate's configured sender target (#26, Commit
 * 5 correction — a live-validation UX defect: "review"-targeted
 * candidates originally never offered Family at all, only specific
 * children, even for something genuinely school-wide like "Back to
 * School Night"). Single source of truth for both this rule and
 * CandidateReviewModal.jsx's usage of it, so they can never drift apart.
 *
 *   "family" -> Family is offered AND starts checked (preserves the
 *               sender's configured intent; the parent may still switch
 *               to a specific child during review).
 *   "review" -> Family is offered but starts UNCHECKED, and (via
 *               candidateToDraftItem.js, unchanged) childIds also starts
 *               empty — nothing is pre-selected, so Approve & Add stays
 *               disabled until the parent affirmatively picks a child or
 *               Family.
 *   "child" / anything else (including photo/CSV candidates, which have
 *               no targetType at all) -> Family is never offered. A
 *               "child"-targeted candidate keeps its configured child
 *               preselected via candidateToDraftItem.js; the AI is never
 *               consulted for any of this.
 *
 * legacyFamilyWide (Slice 2 live-validation fix) — a SECOND, independent
 * signal from the caller: true only when CandidateReviewModal is operating
 * in a household-wide review context (familyChildren is available — i.e.
 * the Review Inbox, never the immediate single-child photo-capture flow,
 * which only ever passes a single `child`). When true, a candidate whose
 * targetType is null/undefined — a legacy candidate that predates the
 * targetType field entirely, surfaced e.g. by Slice 2's "Needs attention"
 * recovery flow — is treated exactly like "review" above: Family becomes
 * an available (never preselected) choice, alongside every current
 * learner, with no child inferred. Defaults to false, so every existing
 * caller/behavior (explicit "family"/"review"/"child", and the immediate
 * single-child flow's null-targetType candidates) is completely
 * unchanged.
 */
export function resolveFamilyWideOption(targetType, legacyFamilyWide = false) {
  const effectiveType = targetType == null && legacyFamilyWide ? "review" : targetType;
  return {
    allowFamilyWide: effectiveType === "family" || effectiveType === "review",
    initialFamilyWide: effectiveType === "family",
  };
}

/**
 * The childIds ItemForm.jsx actually submits: forced to [] whenever
 * familyWide is checked (a genuinely household-wide item — never every
 * current child, regardless of what the hidden pill picker's own state
 * happens to be), otherwise exactly whatever the parent selected.
 */
export function resolveSubmittedChildIds({ childIds, familyWide }) {
  return familyWide ? [] : Array.isArray(childIds) ? childIds : [];
}
