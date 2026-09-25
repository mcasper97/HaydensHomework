/* ============================== Family Board rolling 5-day projection ==============================
 * Pure, zero-JSX projection for the redesigned Family Board — a one-screen,
 * touchscreen-first, rolling 5-day execution board (Today + the next 4
 * calendar days; replaces the old chronological overdue/today/tomorrow/
 * laterThisWeek/upcoming agenda in familyAgenda.js, which this module
 * supersedes for Family Board's own rendering; familyAgenda.js itself is
 * left in place, unused by Family Board, rather than deleted, since
 * deleting it is outside this presentation-only task's scope).
 *
 * DENSITY CORRECTION (UX review): the board originally showed a full
 * rolling 7-day window with every column the same width. Visual review
 * found that too dense to read at a glance from a kitchen touchscreen, so
 * the window was narrowed to 5 days and Today is now rendered at roughly
 * 3x the width of each future-day column (see FamilyWeekBoard.jsx's
 * `gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr"`) — this file's own
 * projection logic is otherwise unchanged by that correction; only
 * ROLLING_WINDOW_DAYS (7 -> 5) moved.
 *
 * PRESENTATION ONLY — reuses itemBuckets.js's existing, already-correct
 * date/recurrence primitives (primaryDate, isRecurringDueOn,
 * isOccurrenceCompleted, choresDueOn, weekdayOf, ACTIONABLE_STATUSES)
 * rather than adding any new scheduling engine, canonical field, or
 * recurrence rule. "Execution window" (Before School / Today / Study Hall
 * / Evening) is a presentation-time grouping derived from fields that
 * already exist on an Item (`type`, and a recurring reminder's own
 * `schedule.daypart`) — no new `executionWindow` field is ever written or
 * read from a document.
 *
 * ───────────────────────── FUTURE PRODUCT RULE (documented, NOT implemented here) ─────────────────────────
 * Family Board intentionally displays all 5 calendar days in its window,
 * weekends included — it is a household execution board, not a school
 * calendar.
 * Hayden's Homework's own auto-scheduling of homework/study tasks/school
 * reminders is a SEPARATE, still-to-be-built concern and should eventually
 * respect actual school days: a non-school day (weekend, school holiday)
 * must not automatically receive school-generated work UNLESS the source
 * explicitly requires that date (e.g. a project due Saturday) or a future
 * scheduling policy intentionally allows it. Nothing in this module (or
 * anywhere else in this change) implements that rule yet — there is no
 * school-calendar/school-day concept anywhere in the codebase today. This
 * comment exists purely so the rule isn't lost before that work begins.
 *
 * CHORE PROJECTION — same rule already established by familyAgenda.js: the
 * legacy chore-template model has no per-chore recurrence pattern (every
 * listed chore is implicitly daily), so each day's occurrence list is a
 * plain choresDueOn(...) lookup, not a new recurrence engine. Only TODAY's
 * chore rows are completion-eligible — FamilyBoard.jsx's toggleChoreDone is
 * hardcoded to record completion against *today's* date, so marking a
 * future day's occurrence would silently write against the wrong date.
 *
 * RECURRING ITEM PROJECTION — deliberately UNCHANGED from the pre-redesign
 * behavior (itemBuckets.js's bucketItems/isRecurringDueOn, as used by the
 * old buildFamilyAgendaRows): a recurring item is only ever evaluated
 * against TODAY, never projected onto the other future columns. Two reasons,
 * both in-scope for a presentation-only task: (1) FamilyAgendaBoard.jsx's
 * handleToggleItem is (unchanged, per this task's instruction to preserve
 * completion behavior exactly) hardcoded to record a recurring item's
 * completion against *today's* occurrence date only, so a future column's
 * occurrence could never be safely marked done from there; (2) an existing
 * recurring-reminder still only shows once, exactly as parents already
 * expect it to today — widening that to every matching weekday is new
 * scheduling-presentation intelligence this task does not ask for.
 *
 * OVERDUE ONE-TIME ITEMS — this board has no separate "Overdue" column (the
 * grid is exactly 5 consecutive calendar days, today first); an actionable
 * one-time item whose date already passed is folded into TODAY's column
 * rather than silently dropped, so it stays visible until handled.
 *
 * Row shape — identical to familyAgenda.js's, so any future shared
 * rendering stays trivial:
 *   { key, sourceType: "item"|"chore", type, title, childIds, date, time,
 *     completed, completionEligible, originalRecord }
 */
import {
  choresDueOn,
  todayStr,
  weekdayOf,
  primaryDate,
  isOccurrenceCompleted,
  isRecurringDueOn,
  ACTIONABLE_STATUSES,
} from "./itemBuckets.js";
import { householdTodayStr } from "../data/householdTimezone.js";

export const ROLLING_WINDOW_DAYS = 5;

export const WINDOW_ORDER = ["beforeSchool", "today", "studyHall", "evening"];
export const WINDOW_LABELS = {
  beforeSchool: "Before School",
  today: "Today",
  studyHall: "Study Hall",
  evening: "Evening",
};

function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function itemTime(item) {
  return item.dueTime || item.startTime || null;
}

function itemRow(item, completions, date, isRecurring) {
  const completed = isRecurring
    ? isOccurrenceCompleted(item.id, date, completions)
    : item.status === "completed";
  return {
    key: `item:${item.id}`,
    sourceType: "item",
    type: item.type,
    title: item.title || "(untitled)",
    childIds: Array.isArray(item.childIds) ? item.childIds : [],
    date,
    time: itemTime(item),
    completed,
    completionEligible: true,
    originalRecord: item,
  };
}

function choreRow(childId, chore, date, isTodayColumn) {
  return {
    key: `chore:${childId}:${chore.id}:${date}`,
    sourceType: "chore",
    type: "chore",
    title: chore.text,
    childIds: [childId],
    date,
    time: null,
    completed: !!chore.done,
    completionEligible: isTodayColumn,
    originalRecord: { childId, chore },
  };
}

/**
 * executionWindowFor(row) -> one of WINDOW_ORDER
 * The smallest reasonable mapping from EXISTING Item data — no new field,
 * no invented scheduling intelligence. Anything that doesn't confidently
 * match a special window falls into "today" (the default/general bucket),
 * per the task's own instruction.
 */
export function executionWindowFor(row) {
  if (row.type === "study_task") return "studyHall";
  const daypart = row.originalRecord?.schedule?.daypart;
  if (daypart === "morning") return "beforeSchool";
  if (daypart === "evening") return "evening";
  return "today";
}

function byTimeThenTitle(a, b) {
  if (!a.time && !b.time) return (a.title || "").localeCompare(b.title || "");
  if (!a.time) return 1;
  if (!b.time) return -1;
  return a.time.localeCompare(b.time);
}

/**
 * buildRollingWeekBoard({ items, choreTemplates, choreCompletions, children, completions, householdTimezone })
 *   -> { today, days: [{ dateStr, weekday, isToday, windows: { beforeSchool, today, studyHall, evening } }, ...] }
 *
 * Exactly ROLLING_WINDOW_DAYS entries, days[0].dateStr always the
 * household-local "today" (see the same householdTodayStr(...) ||
 * todayStr() convention every other Family Board data path uses), days[1..4]
 * consecutive calendar dates after it — Saturday/Sunday are never skipped.
 * Every row is always included somewhere (focus/de-emphasis, not filtering,
 * is the caller's job) — this function never removes an obligation.
 */
export function buildRollingWeekBoard({
  items,
  choreTemplates,
  choreCompletions,
  children,
  completions,
  householdTimezone,
  today: todayOverride,
}) {
  // `today` override — purely additive, for deterministic tests (mirrors
  // itemBuckets.js's own bucketItems(items, { today }) precedent). Every
  // real caller omits it and gets exactly the existing household-local-
  // today behavior.
  const today = todayOverride || householdTodayStr(householdTimezone) || todayStr();

  const days = [];
  for (let i = 0; i < ROLLING_WINDOW_DAYS; i++) {
    const dateStr = i === 0 ? today : addDaysStr(today, i);
    days.push({
      dateStr,
      weekday: weekdayOf(dateStr),
      isToday: i === 0,
      windows: { beforeSchool: [], today: [], studyHall: [], evening: [] },
    });
  }
  const dayIndexByDate = new Map(days.map((d, i) => [d.dateStr, i]));

  const oneTimeItems = (items || []).filter((it) => it.type !== "chore" && !it.schedule?.recurring);
  const recurringItems = (items || []).filter((it) => it.type !== "chore" && it.schedule?.recurring);

  for (const item of oneTimeItems) {
    if (!ACTIONABLE_STATUSES.has(item.status)) continue;
    const itemDate = primaryDate(item);
    if (!itemDate) continue;
    const displayDate = itemDate < today ? today : itemDate; // fold overdue into Today rather than drop it
    const idx = dayIndexByDate.get(displayDate);
    if (idx === undefined) continue; // beyond this board's 5-day horizon
    const row = itemRow(item, completions, displayDate, false);
    days[idx].windows[executionWindowFor(row)].push(row);
  }

  // Recurring items are only ever evaluated against TODAY — see the module
  // doc comment's RECURRING ITEM PROJECTION note.
  for (const item of recurringItems) {
    if (!isRecurringDueOn(item, today)) continue;
    const row = itemRow(item, completions, today, true);
    days[0].windows[executionWindowFor(row)].push(row);
  }

  for (const child of children || []) {
    for (const day of days) {
      for (const chore of choresDueOn(choreTemplates, choreCompletions, child.id, day.dateStr)) {
        const row = choreRow(child.id, chore, day.dateStr, day.isToday);
        // Chores have no daypart signal at all in the legacy template model
        // ({id, text, points} only) — always the general "today" window.
        day.windows.today.push(row);
      }
    }
  }

  for (const day of days) {
    for (const key of WINDOW_ORDER) {
      day.windows[key].sort(byTimeThenTitle);
    }
  }

  return { today, days };
}
