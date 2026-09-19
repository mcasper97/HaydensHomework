/* ============================== IngestionCandidate -> draft item mapping ==============================
 * Pure mapping logic, deliberately kept out of CandidateReviewModal.jsx (which
 * contains JSX) so it can be unit-tested directly in plain Node without a
 * React/JSX runtime — same rationale as keeping itemTypes.js import-free.
 */
import { todayStr } from "./itemBuckets.js";

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
  // Recurring obligations (recurring-obligations increment) — advisory
  // only; this is a PRE-FILL for ItemForm's Repeats section, never trusted
  // as final. `active` defaults true (nothing has deactivated it yet — the
  // parent hasn't even approved it). The suggestion's own weekdays/timeMode
  // are carried through as-is; ItemForm.jsx's own submit logic is what
  // actually re-validates/normalizes whatever the parent ends up with.
  const suggestion = candidate.recurrenceSuggestion;
  const isRecurring = !!suggestion?.recurring;

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
    // A recurring obligation owns its date/time signal entirely through
    // `schedule` below — startDate becomes the recurrence's effective
    // start boundary (see itemBuckets.js's isRecurringDueOn), never a
    // one-time due/start/occurrence date, regardless of the type's usual
    // due-vs-start routing. If the source gave an explicit date, it's
    // preserved as-is; if not, this defaults to today (household/local —
    // see itemBuckets.js's todayStr) as the app/parent's own operational
    // choice of when the recurrence starts. This is never presented as
    // something the teacher said — it's a UI default the parent can freely
    // change before (or after) approving.
    startDate: isRecurring ? candidate.date || todayStr() : isDue ? null : candidate.date || null,
    dueDate: isRecurring ? null : isDue ? candidate.date || null : null,
    // Time fields (#26, Commit 5 review-UX fix) — only ever populated by
    // the email pipeline, and only when the source text explicitly stated
    // a time (see api/_emailExtraction.js's "never fabricate" rule). For
    // due-date types, a stated start time maps onto the existing dueTime
    // field (there's no analogous "end" for a due date). For everything
    // else, allDay is derived from whether any time was actually
    // extracted — never fabricated true/false, just reflecting what the
    // extraction genuinely found. A recurring obligation's time lives
    // entirely in `schedule` instead (daypart/exact — see below); these
    // flat fields stay null/true for it, same as any other all-day item.
    dueTime: !isRecurring && isDue && candidate.startTime ? candidate.startTime : null,
    startTime: !isRecurring && !isDue && candidate.startTime ? candidate.startTime : null,
    endTime: !isRecurring && !isDue && candidate.endTime ? candidate.endTime : null,
    allDay: isRecurring ? true : isDue ? true : !(candidate.startTime || candidate.endTime),
    notes: candidate.description || "",
    // Recurring obligations — advisory pre-fill only (see above). null for
    // every non-recurring candidate, exactly like every other optional
    // field on this draft when the source didn't produce it.
    schedule: isRecurring
      ? {
          recurring: true,
          weekdays: Array.isArray(suggestion.weekdays) ? suggestion.weekdays : [],
          timeMode: suggestion.timeMode || null,
          daypart: suggestion.daypart || null,
          time: suggestion.time || null,
          active: true,
        }
      : null,
  };
}
