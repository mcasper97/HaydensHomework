/* ============================== Organizer bucketing helpers ==============================
 * Pure functions shared by ParentOrganizer, OrganizerCalendar, and
 * ChildTodayView so "what counts as overdue/today/upcoming" and "which chores
 * are due today" are each defined exactly once.
 *
 * Recurring reminders (recurring-obligations increment): this file is also
 * the single centralized place for recurrence/date evaluation — weekdayOf,
 * isRecurringDueOn, isOccurrenceCompleted. No component computes a weekday
 * or "today" itself; every caller (ParentOrganizer, OrganizerCalendar,
 * ChildTodayView) goes through these exports. todayStr() itself is
 * unchanged (still a UTC-date slice — the known household-local-date
 * follow-up stays out of scope for this increment) so when that eventually
 * changes, every recurrence call site inherits the fix automatically.
 */

const ACTIONABLE_STATUSES = new Set(["open", "in_progress"]);

export const todayStr = () => new Date().toISOString().slice(0, 10);

// The one place a date string is ever turned into a day-of-week. Appending
// a local midnight time avoids the classic "YYYY-MM-DD alone parses as UTC
// midnight, then .getDay() reads it back in local time" off-by-one bug.
// 0=Sun..6=Sat (JS Date.getDay() convention).
export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay();
}

const VALID_DAYPARTS = new Set(["morning", "evening"]);
const SCHEDULE_TIME_RE = /^\d{2}:\d{2}$/;

/**
 * normalizeSchedule(raw) -> a fully-valid schedule object, or null.
 * The one place the timeMode invariant (daypart XOR exact time XOR
 * neither — never both, never invented) is enforced, for both untrusted
 * extraction output and parent-submitted form state. Any inconsistent or
 * malformed combination normalizes to the simplest safe state (no time
 * signal) rather than being trusted as-is. A schedule with no weekdays at
 * all isn't usable, so that normalizes to null too — the caller then
 * treats the item as one-time, exactly like schedule being absent.
 */
export function normalizeSchedule(raw) {
  if (!raw || typeof raw !== "object" || raw.recurring !== true) return null;

  const weekdays = Array.isArray(raw.weekdays)
    ? [...new Set(raw.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  if (weekdays.length === 0) return null;

  let timeMode = null;
  let daypart = null;
  let time = null;
  if (raw.timeMode === "daypart" && VALID_DAYPARTS.has(raw.daypart)) {
    timeMode = "daypart";
    daypart = raw.daypart;
  } else if (raw.timeMode === "exact" && typeof raw.time === "string" && SCHEDULE_TIME_RE.test(raw.time)) {
    timeMode = "exact";
    time = raw.time;
  }

  return {
    recurring: true,
    weekdays,
    timeMode,
    daypart,
    time,
    active: raw.active !== false,
  };
}

/**
 * isRecurringDueOn(item, dateStr) -> boolean
 * The single place recurrence due-ness is decided: recurring, active,
 * on/after its effective start boundary (item.startDate — reused, not a
 * new field; see itemsRepository.js), and the date's weekday is in the
 * configured set. No component duplicates any part of this check.
 */
export function isRecurringDueOn(item, dateStr) {
  if (!item?.schedule?.recurring) return false;
  if (item.schedule.active === false) return false;
  if (!item.startDate || dateStr < item.startDate) return false;
  return !!item.schedule.weekdays?.includes(weekdayOf(dateStr));
}

/**
 * isOccurrenceCompleted(itemId, dateStr, completions) -> boolean
 * `completions` is the flat array from itemCompletionsRepository.js's
 * subscribeItemCompletions — this is the one place that array is matched
 * against a specific (item, date) pair.
 */
export function isOccurrenceCompleted(itemId, dateStr, completions) {
  const match = (completions || []).find((c) => c?.itemId === itemId && c?.occurrenceDate === dateStr);
  return !!match?.completed;
}

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
 * bucketItems(items, { childId?, today? }) -> { today, overdue, upcoming }
 * Chore items are excluded — chores stay in the legacy recurring-template
 * model (Phase 1 decision) and are projected in separately via choresDueToday.
 *
 * `today` (optional, Family Board unified-agenda addition) — overrides the
 * default todayStr() "what day is it" anchor. Every pre-existing caller
 * omits this and gets EXACTLY the previous behavior (todayStr(), UTC-date
 * based) — this is purely additive, so a caller that needs a
 * household-timezone-aware "today" (see householdTimezone.js's
 * householdTodayStr and organizer/familyAgenda.js, its one current
 * caller) can pass it in without this function or any of its existing
 * callers (ChildTodayView.jsx, OrganizerCalendar.jsx) changing behavior.
 *
 * Recurring Items (item.schedule?.recurring === true) are handled
 * separately from one-time items' date-field bucketing: each occurrence is
 * independent, so a recurring reminder only ever appears in `today` (via
 * isRecurringDueOn), never in `overdue` (missing Monday's occurrence
 * doesn't make Tuesday's "overdue") or `upcoming` (the same document would
 * otherwise show redundantly on every future matching weekday). A
 * recurring item's `status` stays "open" forever by design — its own
 * per-occurrence completion (itemCompletionsRepository.js) is a UI-layer
 * concern, checked separately by the caller, not by this function — a
 * completed-today recurring reminder still appears here, same as a
 * completed chore still appears in choresDueToday (checked, not hidden).
 */
export function bucketItems(items, { childId, today: todayOverride } = {}) {
  const today = todayOverride || todayStr();
  const scoped = filterByChild(items, childId).filter((it) => it.type !== "chore");
  const oneTime = scoped.filter((it) => !it.schedule?.recurring);
  const recurring = scoped.filter((it) => it.schedule?.recurring);

  const todayItems = [
    ...oneTime.filter((it) => isDueToday(it, today) && ACTIONABLE_STATUSES.has(it.status)),
    ...recurring.filter((it) => isRecurringDueOn(it, today)),
  ];
  const overdueItems = oneTime.filter((it) => isOverdue(it, today));
  const upcomingItems = oneTime
    .filter((it) => {
      const d = primaryDate(it);
      return !!d && d > today && ACTIONABLE_STATUSES.has(it.status);
    })
    .sort((a, b) => primaryDate(a).localeCompare(primaryDate(b)));

  return { today: todayItems, overdue: overdueItems, upcoming: upcomingItems };
}

/**
 * choresDueOn(choreTemplates, choreCompletions, childId, dateStr) -> [{...chore, done}]
 * The general form of choresDueToday (below), parameterized by date
 * (Family Board unified-agenda addition — organizer/familyAgenda.js's
 * only current caller, for projecting a chore's Tomorrow/Later-this-week
 * occurrences). The existing legacy chore-template model has no per-chore
 * recurrence pattern at all (see data/choreTemplatesRepository.js's
 * template shape: {id, text, points}, nothing else) — every listed chore
 * is implicitly "every day," so projecting a future date's occurrence list
 * is simply reading the SAME template list against that date's own
 * completion record (choreCompletions is already keyed per exact date,
 * unaffected by this addition) — not a new recurrence engine, since there
 * is no recurrence PATTERN to evaluate, only a calendar-date lookup.
 */
export function choresDueOn(choreTemplates, choreCompletions, childId, dateStr) {
  if (!childId || !dateStr) return [];
  const list = choreTemplates?.[childId] || [];
  const doneOnDate = new Set((choreCompletions?.[childId] || {})[dateStr] || []);
  return list.map((c) => ({ ...c, done: doneOnDate.has(c.id) }));
}

/**
 * Projects the existing legacy chore template/completion structures (stored
 * on users/{uid}.choreTemplates / .choreCompletions — see FamilyBoard.jsx)
 * into a flat "due today" list for one child, without migrating them into
 * canonical items. A thin wrapper over choresDueOn — every pre-existing
 * caller (ParentOrganizer.jsx, OrganizerDisplay.jsx before their own
 * unification, FamilyBoard.jsx) keeps exactly its previous behavior.
 */
export function choresDueToday(choreTemplates, choreCompletions, childId) {
  return choresDueOn(choreTemplates, choreCompletions, childId, todayStr());
}
