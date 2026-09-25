/**
 * Focused, deterministic unit tests for src/organizer/rollingWeekBoard.js's
 * buildRollingWeekBoard — the pure projection behind the Family Board
 * rolling-day redesign (now 5 days, Today + next 4, per the UX density
 * correction). Uses the new, purely-additive `today` override (mirrors
 * itemBuckets.js's own bucketItems(items, { today }) precedent) so these
 * assertions are exact and reproducible regardless of which real calendar
 * day this file happens to run on — in particular, the spec's own "if
 * today is Friday" example (Fri/Sat/Sun/Mon/Tue) is proven exactly, not
 * approximately.
 *
 * Usage: node tests/rolling-week-board.unit.mjs
 */
import { buildRollingWeekBoard, executionWindowFor, ROLLING_WINDOW_DAYS, WINDOW_ORDER } from "../src/organizer/rollingWeekBoard.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ ROLLING_WINDOW_DAYS is exactly 5 ============
ok("ROLLING_WINDOW_DAYS is exactly 5 (Today + next 4)", ROLLING_WINDOW_DAYS === 5);

// ============ The spec's own worked example: today is Friday 2026-09-25 ============
{
  const board = buildRollingWeekBoard({ items: [], choreTemplates: {}, choreCompletions: {}, children: [], completions: [], today: "2026-09-25" });
  const dates = board.days.map((d) => d.dateStr);
  ok("Exactly 5 days are produced", board.days.length === 5);
  ok(
    "Friday 2026-09-25 -> Fri 25 | Sat 26 | Sun 27 | Mon 28 | Tue 29, exactly as the spec's own example",
    JSON.stringify(dates) === JSON.stringify(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"])
  );
  ok("Today (index 0) is the leftmost/first day", board.days[0].isToday === true && board.days[0].dateStr === "2026-09-25");
  ok("No other day is marked as today", board.days.slice(1).every((d) => d.isToday === false));
  ok("Saturday is NOT skipped — it's the 2nd column", new Date(`${dates[1]}T00:00:00`).getDay() === 6);
  ok("Sunday is NOT skipped — it's the 3rd column", new Date(`${dates[2]}T00:00:00`).getDay() === 0);
}

// ============ A Monday start — a window with NO weekend day at all is still exactly 5 consecutive days ============
{
  const board = buildRollingWeekBoard({ items: [], choreTemplates: {}, choreCompletions: {}, children: [], completions: [], today: "2026-09-28" }); // Monday
  const dates = board.days.map((d) => d.dateStr);
  ok(
    "Monday start -> 5 consecutive weekdays (Mon-Fri), never artificially padded or skipped to force a weekend in",
    JSON.stringify(dates) === JSON.stringify(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"])
  );
}

// ============ A Sunday start — only ONE weekend day (Sunday itself) falls in the window, and it's never skipped ============
{
  const board = buildRollingWeekBoard({ items: [], choreTemplates: {}, choreCompletions: {}, children: [], completions: [], today: "2026-09-27" }); // Sunday
  const dates = board.days.map((d) => d.dateStr);
  ok("Sunday start includes Sunday itself as today, not skipped forward to Monday", dates[0] === "2026-09-27");
  ok(
    "Sunday start -> Sun, Mon, Tue, Wed, Thu (still exactly 5 consecutive calendar days)",
    JSON.stringify(dates) === JSON.stringify(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"])
  );
}

// ============ One-time items land on their own date within the window, folded-overdue into Today ============
{
  const items = [
    { id: "i1", type: "assignment", title: "Worksheet due tomorrow", childIds: [], dueDate: "2026-09-26", status: "open" },
    { id: "i2", type: "school_event", title: "Field day", childIds: [], startDate: "2026-09-29", status: "open" }, // last day in window
    { id: "i3", type: "assignment", title: "Overdue slip", childIds: [], dueDate: "2026-09-20", status: "open" }, // before today
    { id: "i4", type: "assignment", title: "Too far out", childIds: [], dueDate: "2026-10-05", status: "open" }, // beyond the 5-day horizon
  ];
  const board = buildRollingWeekBoard({ items, choreTemplates: {}, choreCompletions: {}, children: [], completions: [], today: "2026-09-25" });
  const allRows = board.days.flatMap((d) => WINDOW_ORDER.flatMap((w) => d.windows[w]));
  ok("An item due tomorrow lands in the day+1 column", board.days[1].windows.today.some((r) => r.title === "Worksheet due tomorrow"));
  ok("An item on the last day of the window (day+4) still shows up", board.days[4].windows.today.some((r) => r.title === "Field day"));
  ok("An overdue item is folded into TODAY's column, not dropped", board.days[0].windows.today.some((r) => r.title === "Overdue slip"));
  ok("An item beyond the 5-day horizon does not appear anywhere on the board", !allRows.some((r) => r.title === "Too far out"));
}

// ============ Execution window mapping is unchanged by the density correction ============
{
  ok(
    "study_task -> studyHall",
    executionWindowFor({ type: "study_task", originalRecord: {} }) === "studyHall"
  );
  ok(
    "morning daypart -> beforeSchool",
    executionWindowFor({ type: "reminder", originalRecord: { schedule: { daypart: "morning" } } }) === "beforeSchool"
  );
  ok(
    "evening daypart -> evening",
    executionWindowFor({ type: "reminder", originalRecord: { schedule: { daypart: "evening" } } }) === "evening"
  );
  ok(
    "everything else -> today (the default/general bucket)",
    executionWindowFor({ type: "assignment", originalRecord: {} }) === "today" &&
      executionWindowFor({ type: "chore", originalRecord: {} }) === "today"
  );
}

// ============ Chores still project across every day in the (now 5-day) window, today-only completion-eligible ============
{
  const choreTemplates = { "child-1": [{ id: "c1", text: "Feed the cat", points: 1 }] };
  const board = buildRollingWeekBoard({
    items: [],
    choreTemplates,
    choreCompletions: {},
    children: [{ id: "child-1", name: "Tiger", emoji: "🐯" }],
    completions: [],
    today: "2026-09-25",
  });
  ok("The chore appears on every one of the 5 days", board.days.every((d) => d.windows.today.some((r) => r.title === "Feed the cat")));
  ok("Only today's occurrence is completion-eligible", board.days[0].windows.today.find((r) => r.title === "Feed the cat").completionEligible === true);
  ok(
    "Every future day's occurrence is view-only",
    board.days.slice(1).every((d) => d.windows.today.find((r) => r.title === "Feed the cat").completionEligible === false)
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
