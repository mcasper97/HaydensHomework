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
 *
 * ONE-LINE-HEADER PASS: `focus` is now a read-only PROP, owned and set by
 * FamilyBoard.jsx (whose own header row renders the actual focus-pill
 * buttons, so they can sit on the SAME line as the brand/chips/clock,
 * matching the mockup literally) — this component no longer owns focus
 * state or renders any pill UI itself; it's purely the data-fetching +
 * board-rendering container the doc comment above already describes.
 */
const FamilyAgendaBoard = ({ ctx, children = [], choreTemplates = {}, choreCompletions = {}, onToggleChore, householdTimezone, focus = "" }) => {
  const [items, setItems] = useState([]);
  const [completions, setCompletions] = useState([]);

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

  // VIEWPORT-FIT CORRECTION: this root participates in FamilyBoard.jsx's
  // bounded-height chain (flex:1/minHeight:0) so FamilyWeekBoard's own
  // grid — the one thing that should actually grow/shrink with available
  // space — gets exactly the remaining height, now that the focus-pill row
  // has moved up into FamilyBoard.jsx's own header (ONE-LINE-HEADER PASS)
  // rather than being rendered as a second tier here.
  return (
    <div data-testid="family-agenda" className="w-full" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <FamilyWeekBoard days={board.days} children={children} focus={focus} onToggleItem={handleToggleItem} onToggleChore={onToggleChore} />
    </div>
  );
};

export default FamilyAgendaBoard;
