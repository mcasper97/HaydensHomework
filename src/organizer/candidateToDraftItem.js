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
    // Child assignment prefill — never the AI's choice. Two sources,
    // checked in order:
    //  1. A configured sender target (#26, Commit 5 — email ingestion):
    //     "child" -> that exact child; "family"/"review" -> [] (the app's
    //     existing household-wide/unresolved convention — see
    //     itemsRepository.js's migrateLegacyFamilyEvents, which already
    //     creates family_event items with childIds: []). This is parent
    //     configuration (the approved-sender's target), set long before
    //     any extraction ran — the model's own free-text `childName` guess
    //     is never consulted for this.
    //  2. The single child whose Parents Page is open (photo/CSV
    //     ingestion — child is always either that one child or null, never
    //     a list to choose among). (Bug fix: `existingItem.childIds ||
    //     fallback` in ItemForm.jsx never falls back for an explicit `[]`,
    //     since an empty array is truthy in JS — returning `[]` here on a
    //     name mismatch left the submit button genuinely disabled with no
    //     available way to select a child other than a click ItemForm's
    //     own fallback never offered.)
    // Either way the parent still sees the result and must click Approve
    // to confirm; nothing is written until then.
    childIds:
      candidate.targetType === "child" && candidate.targetChildId
        ? [candidate.targetChildId]
        : candidate.targetType === "family" || candidate.targetType === "review"
        ? []
        : child?.id
        ? [child.id]
        : [],
    subject: candidate.subject || null,
    academicTopic: candidate.academicTopic || null,
    academicUnit: candidate.academicUnit || null,
    preparationRequired: candidate.preparationRequired,
    startDate: isDue ? null : candidate.date || null,
    dueDate: isDue ? candidate.date || null : null,
    // Time fields (#26, Commit 5 review-UX fix) — only ever populated by
    // the email pipeline, and only when the source text explicitly stated
    // a time (see api/_emailExtraction.js's "never fabricate" rule). For
    // due-date types, a stated start time maps onto the existing dueTime
    // field (there's no analogous "end" for a due date). For everything
    // else, allDay is derived from whether any time was actually
    // extracted — never fabricated true/false, just reflecting what the
    // extraction genuinely found.
    dueTime: isDue && candidate.startTime ? candidate.startTime : null,
    startTime: !isDue && candidate.startTime ? candidate.startTime : null,
    endTime: !isDue && candidate.endTime ? candidate.endTime : null,
    allDay: isDue ? true : !(candidate.startTime || candidate.endTime),
    notes: candidate.description || "",
  };
}
