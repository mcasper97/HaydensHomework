/* ============================== IngestionCandidate -> draft item mapping ==============================
 * Pure mapping logic, deliberately kept out of CandidateReviewModal.jsx (which
 * contains JSX) so it can be unit-tested directly in plain Node without a
 * React/JSX runtime — same rationale as keeping itemTypes.js import-free.
 */

// Types whose primary date is a "due" date in ItemForm's showsField() rules
// (see organizer/ItemForm.jsx) — everything else treats a single extracted
// date as a start/occurrence date. Kept here (not exported from itemTypes.js)
// since it's specific to mapping a flat IngestionCandidate.date onto
// ItemForm's two-date model, not a property of the type vocabulary itself.
const DUE_DATE_TYPES = ["assignment", "project", "study_task"];

/**
 * Shapes one IngestionCandidate as an ItemForm `existingItem` so the exact
 * same type-aware create/edit form used for manual items can pre-fill and
 * let the parent edit a proposed item before it's ever created. ItemForm is
 * reused entirely unmodified — it has no idea this payload originated from
 * a photo instead of a blank "+ Add" click; the caller decides what to do
 * with the payload it hands back on submit.
 */
export function candidateToDraftItem(candidate, child) {
  const isDue = DUE_DATE_TYPES.includes(candidate.proposedType);

  return {
    type: candidate.proposedType,
    title: candidate.title || "",
    // Pre-selected whenever a child is in scope. `child` here is always
    // either the single child whose Parents Page is currently open, or
    // null (never a list to choose among) — see App.jsx's CandidateReviewModal
    // usage — so this isn't the AI silently assigning a child, it's
    // defaulting to the only slot this screen could ever offer. The parent
    // still sees it highlighted and must click Approve to confirm; nothing
    // is written until then. (Bug fix: `existingItem.childIds || fallback`
    // in ItemForm.jsx never falls back for an explicit `[]`, since an empty
    // array is truthy in JS — returning `[]` here on a name mismatch left
    // the submit button genuinely disabled with no available way to select
    // a child other than a click ItemForm's own fallback never offered.)
    childIds: child?.id ? [child.id] : [],
    subject: candidate.subject || null,
    academicTopic: candidate.academicTopic || null,
    academicUnit: candidate.academicUnit || null,
    preparationRequired: candidate.preparationRequired,
    startDate: isDue ? null : candidate.date || null,
    dueDate: isDue ? candidate.date || null : null,
    notes: candidate.description || "",
  };
}
