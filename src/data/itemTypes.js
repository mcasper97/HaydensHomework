/* ============================== Canonical Item Types ==============================
 * Shared vocabulary for the Phase 1 Academic Organizer canonical item model
 * (users/{uid}/items/{itemId} — see itemsRepository.js). Both the Parent
 * Organizer/Calendar and App.jsx's minimal integrations read this file so the
 * type list, labels, and date-field defaults are defined exactly once.
 */

// "chore" is part of the canonical type vocabulary (for icons/labels when a
// chore is shown alongside items) but is NOT created through ItemForm — Phase
// 1 keeps the existing recurring chore template/completion model as-is and
// only projects it into the Organizer/Calendar views.
export const ITEM_TYPES = [
  "assignment",
  "test",
  "quiz",
  "project",
  "study_task",
  "school_event",
  "chore",
  "family_event",
  "reminder",
];

// Types creatable through the new type-aware manual form.
export const FORM_TYPES = ITEM_TYPES.filter((t) => t !== "chore");

export const ACADEMIC_TYPES = ["assignment", "test", "quiz", "project", "study_task"];

export const ITEM_TYPE_META = {
  assignment: { label: "Assignment", icon: "📘" },
  test: { label: "Test", icon: "📝" },
  quiz: { label: "Quiz", icon: "❓" },
  project: { label: "Project", icon: "🛠️" },
  study_task: { label: "Study Task", icon: "📚" },
  school_event: { label: "School Event", icon: "🏫" },
  chore: { label: "Chore", icon: "🧹" },
  family_event: { label: "Family Event", icon: "📌" },
  reminder: { label: "Reminder", icon: "🔔" },
};

export const SUBJECT_OPTIONS = [
  "Math",
  "Language Arts - Spelling",
  "Language Arts - Reading/Comprehension",
  "Science",
  "Social Studies",
  "Other",
];

export const ITEM_STATUSES = ["open", "in_progress", "completed", "cancelled"];
