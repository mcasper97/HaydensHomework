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
 * `allowFamilyWide` prop for when that's ever offered (#26, Commit 5
 * correction: only a "family"-targeted email candidate). When `familyWide`
 * is false/undefined this is exactly the form's original, unmodified rule:
 * title present AND at least one child selected.
 */
export function canSubmitItemForm({ title, childIds, familyWide }) {
  const hasTitle = !!(title && title.trim());
  const hasAssignment = !!familyWide || (Array.isArray(childIds) && childIds.length > 0);
  return hasTitle && hasAssignment;
}
