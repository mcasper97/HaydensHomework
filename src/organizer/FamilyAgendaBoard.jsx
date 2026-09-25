import React, { useEffect, useMemo, useState } from "react";
import { subscribeItems, setItemStatus } from "../data/itemsRepository.js";
import { subscribeItemCompletions, setItemCompletion } from "../data/itemCompletionsRepository.js";
import { buildRollingWeekBoard } from "./rollingWeekBoard.js";
import { todayStr, isOccurrenceCompleted } from "./itemBuckets.js";
import { householdTodayStr } from "../data/householdTimezone.js";
import { accentForChild, FAMILY_ACCENT } from "./learnerAccent.js";
import { ALL_FOCUS_ACCENT } from "./boardTheme.js";
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

  // K-5 REDESIGN (Section 10): each focus pill always carries its own
  // owner's accent (green for All, each learner's own palette slot, the
  // Family accent for Family) so identity reads at a glance even before
  // picking one; the ACTIVE pill gets a bolder filled treatment (solid
  // accent background, white text) so which one is selected is still
  // unambiguous. Still large/obviously-touchable (Section 3/10: ~56-64px).
  const focusPillStyle = (accent, active) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 56,
    minWidth: 56,
    padding: "0 20px",
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 14,
    whiteSpace: "nowrap",
    border: `2px solid ${accent.border}`,
    background: active ? accent.border : accent.bg,
    color: active ? "#FFFFFF" : accent.text,
    transition: "background 0.15s ease, color 0.15s ease",
  });

  // VIEWPORT-FIT CORRECTION: this root participates in FamilyBoard.jsx's
  // bounded-height chain (flex:1/minHeight:0) so FamilyWeekBoard's own
  // grid — the one thing that should actually grow/shrink with available
  // space — gets exactly the remaining height once the focus-button row's
  // own fixed height is subtracted, rather than the whole page growing to
  // fit whatever the board naturally wants.
  return (
    <div data-testid="family-agenda" className="w-full" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0, marginBottom: 8, marginTop: 8 }}>
        {/* testid intentionally kept as "agenda-filter-all" (not renamed to
            "board-focus-all") — several unrelated test files across the
            suite (board-selector-navigation, household-timezone,
            parent-page-import-navigation, review-inbox,
            parent-tools-persistence, child-rename-settings,
            calendar-routing-ux, calendar-connection-panel) use this one
            testid purely as a "Family Board finished loading" landmark,
            not to exercise filtering — renaming it would break all of them
            for no reason related to this redesign. */}
        <button data-testid="agenda-filter-all" style={focusPillStyle(ALL_FOCUS_ACCENT, !focus)} onClick={() => setFocus("")}>
          👪 All
        </button>
        {children.map((c) => (
          <button
            key={c.id}
            data-testid={`board-focus-child-${c.id}`}
            style={focusPillStyle(accentForChild(children, c.id), focus === c.id)}
            onClick={() => setFocus(c.id)}
          >
            {c.emoji} {c.name}
          </button>
        ))}
        <button
          data-testid="board-focus-family"
          style={focusPillStyle(FAMILY_ACCENT, focus === "family")}
          onClick={() => setFocus("family")}
        >
          🏠 Family
        </button>
      </div>

      <FamilyWeekBoard days={board.days} children={children} focus={focus} onToggleItem={handleToggleItem} onToggleChore={onToggleChore} />
    </div>
  );
};

export default FamilyAgendaBoard;
