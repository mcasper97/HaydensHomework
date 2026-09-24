import React, { useEffect, useMemo, useState } from "react";
import { subscribeItems, setItemStatus } from "../data/itemsRepository.js";
import { subscribeItemCompletions, setItemCompletion } from "../data/itemCompletionsRepository.js";
import { buildFamilyAgendaRows, filterAgendaRows } from "./familyAgenda.js";
import { todayStr, isOccurrenceCompleted } from "./itemBuckets.js";
import { householdTodayStr } from "../data/householdTimezone.js";
import FamilyAgenda from "./FamilyAgenda.jsx";

/* ─────────────────────── Family Agenda Board ───────────────────────
 * The data-fetching container both FamilyBoard.jsx (kiosk=false) and
 * OrganizerDisplay.jsx (kiosk=true) now render identically — the Family
 * Board admin boundary (Section 15) means both are execution-only
 * surfaces, so there is no longer a separate "admin" variant of this view
 * to maintain (the old split was ParentOrganizer allowManage=true/false;
 * this component has no allowManage concept at all, by design).
 *
 * Subscribes independently to items/itemCompletions (the exact same
 * subscribeItems/subscribeItemCompletions every sibling Organizer
 * component already calls independently — see e.g. AddItemPanel.jsx's own
 * doc comment on this established precedent) — chore templates/
 * completions are still owned and passed down by FamilyBoard.jsx (the one
 * place board-owned users/{uid} fields are read/written), never
 * re-subscribed here.
 *
 * householdTimezone — threaded down from FamilyBoard.jsx (which now loads
 * it alongside the rest of the household profile) so the SAME
 * household-local "today" familyAgenda.js uses to decide which section a
 * recurring item's row belongs in is also what handleToggleItem below
 * writes a completion against — using two different "today"s (one
 * household-local for display, one UTC for the write) would let a
 * completion toggle write against a different calendar date than the one
 * currently on screen near a midnight boundary.
 *
 * Filters (Section 20) — All / one per current learner / Family — kept as
 * simple local `filter` state, mirroring ParentOrganizer.jsx's own former
 * filterChild pattern exactly, just with the added "family" value.
 */
const FamilyAgendaBoard = ({ ctx, children = [], choreTemplates = {}, choreCompletions = {}, onToggleChore, householdTimezone }) => {
  const [items, setItems] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [filter, setFilter] = useState(""); // "" (All) | childId | "family"

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

  const rows = useMemo(
    () =>
      filterAgendaRows(
        buildFamilyAgendaRows({ items, choreTemplates, choreCompletions, children, completions, householdTimezone }),
        filter
      ),
    [items, choreTemplates, choreCompletions, children, completions, filter, householdTimezone]
  );

  // Identical logic to ParentOrganizer.jsx's former handleComplete — a
  // recurring Item's own `status` is never touched (stays "open" forever
  // by design); only its per-occurrence completion record changes. Uses
  // the SAME household-local `today` the row currently on screen was
  // grouped/checked against (see the module doc comment above).
  const handleToggleItem = (item) => {
    if (item.schedule?.recurring) {
      const done = isOccurrenceCompleted(item.id, today, completions);
      setItemCompletion(ctx, { itemId: item.id, occurrenceDate: today, completed: !done });
      return;
    }
    setItemStatus(ctx, item.id, item.status === "completed" ? "open" : "completed");
  };

  const filterButtonClass = (active) =>
    `px-4 py-2.5 rounded-full text-sm font-bold border-2 transition whitespace-nowrap ${
      active ? "bg-white text-gray-900 border-white" : "text-gray-300 border-gray-600"
    }`;

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <button data-testid="agenda-filter-all" onClick={() => setFilter("")} className={filterButtonClass(!filter)}>
          All
        </button>
        {children.map((c) => (
          <button
            key={c.id}
            data-testid="agenda-filter-child"
            onClick={() => setFilter(c.id)}
            className={filterButtonClass(filter === c.id)}
          >
            {c.emoji} {c.name}
          </button>
        ))}
        <button
          data-testid="agenda-filter-family"
          onClick={() => setFilter("family")}
          className={filterButtonClass(filter === "family")}
        >
          👨‍👩‍👧‍👧 Family
        </button>
      </div>

      <FamilyAgenda rows={rows} children={children} onToggleItem={handleToggleItem} onToggleChore={onToggleChore} />
    </div>
  );
};

export default FamilyAgendaBoard;
