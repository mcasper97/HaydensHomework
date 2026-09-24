/* ============================== Family Board unified agenda ==============================
 * Pure, zero-JSX projection + time-horizon grouping for the redesigned
 * Family Board (Section 14-18 of the task spec) — a single deterministic
 * layer that turns canonical Items + the existing legacy chore templates/
 * completions into one flat, chronologically-groupable row list, without
 * migrating chores into Items or creating Item copies of chore occurrences
 * (both explicitly forbidden).
 *
 * Deliberately reuses itemBuckets.js's existing, already-correct date
 * logic (primaryDate, isOverdue, isDueToday, isRecurringDueOn,
 * isOccurrenceCompleted, choresDueOn) rather than re-deriving any of it —
 * this module only adds the grouping "Today/Tomorrow/Later this
 * week/Upcoming" didn't already have, plus projecting chores across that
 * same horizon (see the CHORE PROJECTION note below).
 *
 * HOUSEHOLD TIMEZONE — "today" is resolved via householdTimezone.js's
 * householdTodayStr(timezone) when a timezone is configured, falling back
 * to itemBuckets.js's UTC-anchored todayStr() only when it isn't (a
 * household that hasn't set one yet — a pre-existing, already-disclosed
 * state elsewhere in this app). This is deliberately narrow: it does NOT
 * change todayStr() itself or any of its other existing callers
 * (ChildTodayView.jsx, OrganizerCalendar.jsx) — only this module's own
 * Today/Tomorrow/Later-this-week/Overdue boundary decisions use the
 * household-local value, via bucketItems' new optional `today` override
 * (itemBuckets.js) so the boundary used for actual date-bucket membership
 * and the boundary used for section labeling never disagree.
 *
 * CHORE PROJECTION — the existing chore-template model has no per-chore
 * recurrence pattern (data/choreTemplatesRepository.js's shape is just
 * {id, text, points} — every listed chore is implicitly "every day"), so
 * projecting a future day's occurrence list is a plain calendar-date
 * lookup against the SAME template list (see choresDueOn in
 * itemBuckets.js), not a new recurrence engine. Chores are projected into
 * TODAY, TOMORROW, and LATER THIS WEEK — not UPCOMING (an every-day,
 * no-end-date chore projected indefinitely into "upcoming" would be
 * unbounded and would dominate that section for no product benefit), and
 * NEVER OVERDUE (the existing model already has no concept of accumulated
 * chore debt — choresDueOn/choresDueToday only ever reads ONE date's own
 * completion record; a missed day's occurrence simply isn't re-surfaced
 * later, exactly as it always has been). Only TODAY's chore rows are
 * completion-eligible: FamilyBoard.jsx's existing toggleChoreDone is
 * hardcoded to always record completion against *today's* date
 * (todayStr()), so a Tomorrow/Later-this-week chore row is intentionally
 * view-only (completionEligible: false) rather than risk marking the
 * wrong day's occurrence — completing a chore that hasn't happened yet
 * also has no existing precedent anywhere in this app.
 *
 * Row shape (Section 17), deliberately small and presentation-focused:
 *   {
 *     key,               // stable, unique across items AND chores
 *     sourceType,        // "item" | "chore"
 *     type,              // item.type, or "chore" for a chore row
 *     title,
 *     childIds,          // [] means family-wide (items only; a chore
 *                         // always belongs to exactly one child)
 *     date,               // "YYYY-MM-DD" the row is grouped by
 *     time,               // "HH:MM" | null, display only
 *     completed,
 *     completionEligible, // whether marking this row done/undone is offered
 *     originalRecord,     // the source Item, or { childId, chore } for a chore
 *   }
 */
import {
  bucketItems,
  choresDueOn,
  todayStr,
  weekdayOf,
  primaryDate,
  isOccurrenceCompleted,
} from "./itemBuckets.js";
import { householdTodayStr } from "../data/householdTimezone.js";

function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * itemTime(item) -> "HH:MM" | null
 * Display-only "what time does this row show" — mirrors the due-vs-start
 * routing DUE_DATE_TYPES already established elsewhere (assignment/
 * project/study_task show a due time; everything else shows a start time),
 * without importing candidateToDraftItem.js's DUE_DATE_TYPES just for this
 * one read (avoids a cross-module coupling for a single field lookup —
 * the due-vs-start distinction is re-expressed locally, consistent with
 * primaryDate's own dueDate-first convention).
 */
function itemTime(item) {
  return item.dueTime || item.startTime || null;
}

function itemRow(item, completions, today) {
  const isRecurring = !!item.schedule?.recurring;
  const date = isRecurring ? today : primaryDate(item);
  const completed = isRecurring
    ? isOccurrenceCompleted(item.id, today, completions)
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

function choreRow(childId, chore, date, isToday) {
  return {
    key: `chore:${childId}:${chore.id}:${date}`,
    sourceType: "chore",
    type: "chore",
    title: chore.text,
    childIds: [childId],
    date,
    time: null,
    completed: !!chore.done,
    // See the module doc comment's CHORE PROJECTION note — only today's
    // occurrence can be safely marked complete with the existing
    // (date-hardcoded) toggleChoreDone.
    completionEligible: isToday,
    originalRecord: { childId, chore },
  };
}

/**
 * buildFamilyAgendaRows({ items, choreTemplates, choreCompletions, children, completions, householdTimezone })
 *   -> { overdue, today, tomorrow, laterThisWeek, upcoming }
 *
 * Each bucket is already sorted (date, then time — undated/all-day rows
 * sort after timed ones on the same date, a stable/deterministic tie-break
 * rather than arbitrary object-insertion order).
 */
export function buildFamilyAgendaRows({ items, choreTemplates, choreCompletions, children, completions, householdTimezone }) {
  const today = householdTodayStr(householdTimezone) || todayStr();
  const tomorrow = addDaysStr(today, 1);
  // "Later this week" runs through the coming Saturday (JS Date.getDay()
  // convention, 6 = Sat) — if today already IS Saturday, there is no
  // remaining room in "this week" beyond tomorrow, so that section simply
  // stays empty and everything else falls into `upcoming` (still correct,
  // still deterministic, per "only render populated sections").
  const todayWeekday = weekdayOf(today);
  const endOfWeek = addDaysStr(today, Math.max(0, 6 - todayWeekday));

  const { today: todayItems, overdue: overdueItems, upcoming: upcomingItems } = bucketItems(items, { today });

  const overdue = overdueItems.map((it) => itemRow(it, completions, today));
  const todayRows = todayItems.map((it) => itemRow(it, completions, today));

  const tomorrowRows = [];
  const laterThisWeekRows = [];
  const upcomingRows = [];
  for (const it of upcomingItems) {
    const row = itemRow(it, completions, today);
    if (row.date === tomorrow) tomorrowRows.push(row);
    else if (row.date > tomorrow && row.date <= endOfWeek) laterThisWeekRows.push(row);
    else upcomingRows.push(row);
  }

  // Chores — projected across Today/Tomorrow/Later-this-week for every
  // current child (see the module doc comment's CHORE PROJECTION note).
  for (const child of children || []) {
    for (const chore of choresDueOn(choreTemplates, choreCompletions, child.id, today)) {
      todayRows.push(choreRow(child.id, chore, today, true));
    }
    for (const chore of choresDueOn(choreTemplates, choreCompletions, child.id, tomorrow)) {
      tomorrowRows.push(choreRow(child.id, chore, tomorrow, false));
    }
    if (endOfWeek > tomorrow) {
      for (let d = addDaysStr(tomorrow, 1); d <= endOfWeek; d = addDaysStr(d, 1)) {
        for (const chore of choresDueOn(choreTemplates, choreCompletions, child.id, d)) {
          laterThisWeekRows.push(choreRow(child.id, chore, d, false));
        }
      }
    }
  }

  const byDateThenTime = (a, b) => {
    if (a.date !== b.date) return (a.date || "").localeCompare(b.date || "");
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1; // undated/all-day after timed, on the same date
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  };

  return {
    overdue: overdue.sort(byDateThenTime),
    today: todayRows.sort(byDateThenTime),
    tomorrow: tomorrowRows.sort(byDateThenTime),
    laterThisWeek: laterThisWeekRows.sort(byDateThenTime),
    upcoming: upcomingRows.sort(byDateThenTime),
  };
}

/**
 * filterAgendaRows(buckets, filter) -> same shape, each bucket filtered.
 * filter: "" (All) | a childId | "family" (household-wide only, childIds
 * empty — a chore row, whose childIds is always exactly one id, never
 * matches "family").
 */
export function filterAgendaRows(buckets, filter) {
  const matches = (row) => {
    if (!filter) return true;
    if (filter === "family") return row.childIds.length === 0;
    return row.childIds.includes(filter);
  };
  const out = {};
  for (const [section, rows] of Object.entries(buckets)) {
    out[section] = rows.filter(matches);
  }
  return out;
}
