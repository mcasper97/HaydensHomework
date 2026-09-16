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
  const childMatches =
    child?.id &&
    candidate.proposedChildName &&
    child.name?.trim().toLowerCase() === candidate.proposedChildName.trim().toLowerCase();

  return {
    type: candidate.proposedType,
    title: candidate.title || "",
    // Only pre-checked when the AI's guessed name matches this device's
    // child exactly — never auto-selected just because a name was present.
    // The parent still has to see and keep (or change) this selection.
    childIds: childMatches ? [child.id] : [],
    subject: candidate.subject || null,
    academicTopic: candidate.academicTopic || null,
    academicUnit: candidate.academicUnit || null,
    preparationRequired: candidate.preparationRequired,
    startDate: isDue ? null : candidate.date || null,
    dueDate: isDue ? candidate.date || null : null,
    notes: candidate.description || "",
  };
}
