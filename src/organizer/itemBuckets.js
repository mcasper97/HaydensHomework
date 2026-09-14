/* ============================== Organizer bucketing helpers ==============================
 * Pure functions shared by ParentOrganizer, OrganizerCalendar, and
 * ChildTodayView so "what counts as overdue/today/upcoming" and "which chores
 * are due today" are each defined exactly once.
 */

const ACTIONABLE_STATUSES = new Set(["open", "in_progress"]);

export const todayStr = () => new Date().toISOString().slice(0, 10);

// The date that "counts" for Today/Upcoming/Needs-Attention bucketing: a
// deadline (dueDate) takes priority when present, otherwise the scheduled
// occurrence (startDate) — matches the spec's "assignments usually use due
// date, tests/quizzes usually use occurrence date" guidance while still
// allowing both fields to be set (per Phase 1 decision: not mutually exclusive).
export function primaryDate(item) {
  return item.dueDate || item.startDate || null;
}

// The date an item is anchored to on the Calendar view specifically: due-type
// items (assignment/project/study_task) anchor on their deadline when set;
// everything else anchors on its scheduled occurrence.
export function calendarAnchorDate(item) {
  if (item.type === "assignment" || item.type === "project" || item.type === "study_task") {
    return item.dueDate || item.startDate || null;
  }
  return item.startDate || item.dueDate || null;
}

export function isOverdue(item, today = todayStr()) {
  const d = primaryDate(item);
  return !!d && d < today && ACTIONABLE_STATUSES.has(item.status);
}

export function isDueToday(item, today = todayStr()) {
  return primaryDate(item) === today;
}

export function filterByChild(items, childId) {
  if (!childId) return items;
  return items.filter((it) => Array.isArray(it.childIds) && it.childIds.includes(childId));
}

/**
 * bucketItems(items, { childId? }) -> { today, overdue, upcoming }
 * Chore items are excluded — chores stay in the legacy recurring-template
 * model (Phase 1 decision) and are projected in separately via choresDueToday.
 */
export function bucketItems(items, { childId } = {}) {
  const today = todayStr();
  const scoped = filterByChild(items, childId).filter((it) => it.type !== "chore");

  const todayItems = scoped.filter((it) => isDueToday(it, today) && ACTIONABLE_STATUSES.has(it.status));
  const overdueItems = scoped.filter((it) => isOverdue(it, today));
  const upcomingItems = scoped
    .filter((it) => {
      const d = primaryDate(it);
      return !!d && d > today && ACTIONABLE_STATUSES.has(it.status);
    })
    .sort((a, b) => primaryDate(a).localeCompare(primaryDate(b)));

  return { today: todayItems, overdue: overdueItems, upcoming: upcomingItems };
}

/**
 * Projects the existing legacy chore template/completion structures (stored
 * on users/{uid}.choreTemplates / .choreCompletions — see FamilyBoard.jsx)
 * into a flat "due today" list for one child, without migrating them into
 * canonical items.
 */
export function choresDueToday(choreTemplates, choreCompletions, childId) {
  if (!childId) return [];
  const today = todayStr();
  const list = choreTemplates?.[childId] || [];
  const doneToday = new Set((choreCompletions?.[childId] || {})[today] || []);
  return list.map((c) => ({ ...c, done: doneToday.has(c.id) }));
}
