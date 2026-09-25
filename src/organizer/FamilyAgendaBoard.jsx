import React, { useEffect, useMemo, useState } from "react";
import { subscribeItems, setItemStatus } from "../data/itemsRepository.js";
import { subscribeItemCompletions, setItemCompletion } from "../data/itemCompletionsRepository.js";
import { buildRollingWeekBoard } from "./rollingWeekBoard.js";
import { todayStr, isOccurrenceCompleted } from "./itemBuckets.js";
import { householdTodayStr } from "../data/householdTimezone.js";
import FamilyWeekBoard from "./FamilyWeekBoard.jsx";

/* ─────────────────────── Family Agenda Board ───────────────────────
 * The data-fetching container both FamilyBoard.jsx (kiosk=false) and
 * OrganizerDisplay.jsx (kiosk=true) render identically — the Family Board
 * admin boundary means both are execution-only surfaces, so there is no
 * separate "admin" variant of this view to maintain.
 *
 * Subscribes independently to items/itemCompletions (the same
 * subscribeItems/subscribeItemCompletions every sibling Organizer component
 * already calls independently) — chore templates/completions are still
 * owned and passed down by FamilyBoard.jsx, never re-subscribed here.
 *
 * householdTimezone — threaded down from FamilyBoard.jsx so the SAME
 * household-local "today" rollingWeekBoard.js uses to build the grid is
 * also what handleToggleItem below writes a completion against.
 *
 * FOCUS (rolling-week redesign) — All / one per current learner / Family.
 * This used to be a `filter` that HID non-matching rows (filterAgendaRows);
 * it is now de-emphasis only — every row buildRollingWeekBoard produces is
 * always passed down to FamilyWeekBoard, which decides prominence from
 * `focus`, never drops a row. Canonical child ids drive the per-child
 * buttons dynamically (never a hardcoded name) — see `children` below.
 */
const FamilyAgendaBoard = ({ ctx, children = [], choreTemplates = {}, choreCompletions = {}, onToggleChore, householdTimezone }) => {
  const [items, setItems] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [focus, setFocus] = useState(""); // "" (All) | childId | "family"

  useEffect(() => {
    const unsub = subscribeItems(ctx, {}, setItems);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  useEffect(() => {
    const unsub = subscribeItemCompletions(ctx, setCompletions);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  const today = useMemo(() => householdTodayStr(householdTimezone) || todayStr(), [householdTimezone]);

  const board = useMemo(
    () => buildRollingWeekBoard({ items, choreTemplates, choreCompletions, children, completions, householdTimezone }),
    [items, choreTemplates, choreCompletions, children, completions, householdTimezone]
  );

  // Identical logic to the pre-redesign handler — a recurring Item's own
  // `status` is never touched (stays "open" forever by design); only its
  // per-occurrence completion record changes, against the SAME
  // household-local `today` the row currently on screen was checked
  // against (unchanged completion behavior — presentation-only redesign).
  const handleToggleItem = (item) => {
    if (item.schedule?.recurring) {
      const done = isOccurrenceCompleted(item.id, today, completions);
      setItemCompletion(ctx, { itemId: item.id, occurrenceDate: today, completed: !done });
      return;
    }
    setItemStatus(ctx, item.id, item.status === "completed" ? "open" : "completed");
  };

  const focusButtonClass = (active) =>
    `flex items-center justify-center gap-1.5 px-5 rounded-2xl text-sm font-bold border-2 transition whitespace-nowrap ${
      active ? "bg-white text-gray-900 border-white" : "text-gray-300 border-gray-600"
    }`;
  // Section 3: large, obviously-touchable controls, ~56-64px tall.
  const focusButtonStyle = { height: 60, minWidth: 60 };

  return (
    <div data-testid="family-agenda" className="w-full">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {/* testid intentionally kept as "agenda-filter-all" (not renamed to
            "board-focus-all") — several unrelated test files across the
            suite (board-selector-navigation, household-timezone,
            parent-page-import-navigation, review-inbox,
            parent-tools-persistence, child-rename-settings,
            calendar-routing-ux, calendar-connection-panel) use this one
            testid purely as a "Family Board finished loading" landmark,
            not to exercise filtering — renaming it would break all of them
            for no reason related to this redesign. */}
        <button data-testid="agenda-filter-all" style={focusButtonStyle} onClick={() => setFocus("")} className={focusButtonClass(!focus)}>
          All
        </button>
        {children.map((c) => (
          <button
            key={c.id}
            data-testid={`board-focus-child-${c.id}`}
            style={focusButtonStyle}
            onClick={() => setFocus(c.id)}
            className={focusButtonClass(focus === c.id)}
          >
            {c.emoji} {c.name}
          </button>
        ))}
        <button
          data-testid="board-focus-family"
          style={focusButtonStyle}
          onClick={() => setFocus("family")}
          className={focusButtonClass(focus === "family")}
        >
          🏠 Family
        </button>
      </div>

      <FamilyWeekBoard days={board.days} children={children} focus={focus} onToggleItem={handleToggleItem} onToggleChore={onToggleChore} />
    </div>
  );
};

export default FamilyAgendaBoard;
