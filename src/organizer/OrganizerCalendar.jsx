import React, { useEffect, useMemo, useState } from "react";
import { subscribeItems } from "../data/itemsRepository.js";
import { calendarAnchorDate, choresDueToday, todayStr } from "./itemBuckets.js";
import { ITEM_TYPE_META } from "../data/itemTypes.js";

const CHILD_COLORS = ["#7C3AED", "#0EA5A0", "#D97706", "#DB2777", "#2563EB", "#059669", "#DC2626"];
const colorForChild = (children, childId) => {
  const idx = Math.max(0, children.findIndex((c) => c.id === childId));
  return CHILD_COLORS[idx % CHILD_COLORS.length];
};

/**
 * Calendar — a 7-day strip (today -> +6 days) sourced from the same
 * canonical items ParentOrganizer reads, so Calendar and Organizer are two
 * views of the same records (spec requirement). Visual pattern reused from
 * FamilyBoard's original calendar strip. Chores (legacy model, not migrated)
 * are projected into today's column only, since the recurring template model
 * has no future-dated occurrences to show on later days.
 */
const OrganizerCalendar = ({ ctx, children = [], choreTemplates = {}, choreCompletions = {} }) => {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const unsub = subscribeItems(ctx, {}, setItems);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  const today = todayStr();
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)),
    [today]
  );

  const agendaByDate = useMemo(() => {
    const map = {};
    items.forEach((item) => {
      const date = calendarAnchorDate(item);
      if (!date) return;
      if (!map[date]) map[date] = [];
      map[date].push(item);
    });
    return map;
  }, [items]);

  const formatDateHeading = (d) => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (d === today) return "Today";
    if (d === tomorrow) return "Tomorrow";
    try {
      return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    } catch {
      return d;
    }
  };

  return (
    <div className="w-full">
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: "x proximity" }}>
        {weekDates.map((date) => {
          const heading = formatDateHeading(date);
          const isToday = date === today;
          const d = new Date(date + "T00:00:00");
          const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
          const dayNum = d.getDate();
          const dayItems = agendaByDate[date] || [];
          const choreGroups = isToday
            ? children
                .map((c) => ({ child: c, chores: choresDueToday(choreTemplates, choreCompletions, c.id) }))
                .filter((g) => g.chores.length > 0)
            : [];

          return (
            <div key={date} className="flex-shrink-0" style={{ width: 200, scrollSnapAlign: "start" }}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-gray-500 text-xs font-bold uppercase">{weekday}</span>
                <span
                  className="text-sm font-extrabold flex items-center justify-center rounded-full"
                  style={{ width: 24, height: 24, background: isToday ? "#DC2626" : "transparent", color: isToday ? "white" : "#6B7280" }}
                >
                  {dayNum}
                </span>
                {(isToday || heading === "Tomorrow") && (
                  <span className="text-xs font-bold" style={{ color: isToday ? "#DC2626" : "#D97706" }}>
                    {heading}
                  </span>
                )}
              </div>

              <div className="rounded-2xl p-2 space-y-2 min-h-[120px] bg-gray-50 border border-gray-100">
                {dayItems.length === 0 && choreGroups.length === 0 && (
                  <div className="text-gray-400 text-xs text-center py-6">—</div>
                )}
                {dayItems.map((item) => {
                  const meta = ITEM_TYPE_META[item.type] || {};
                  const urgency =
                    heading === "Today" ? "border-red-300 bg-red-50" : heading === "Tomorrow" ? "border-orange-300 bg-orange-50" : "border-gray-200 bg-white";
                  const childId = (item.childIds || [])[0];
                  const color = childId ? colorForChild(children, childId) : "#9CA3AF";
                  return (
                    <div key={item.id} className={`rounded-xl p-2.5 border ${urgency}`} style={{ borderLeftWidth: 3, borderLeftColor: color }}>
                      <div className="font-extrabold text-gray-900 text-xs leading-snug">
                        {meta.icon} {item.title}
                      </div>
                      {item.subject && <div className="text-gray-600 text-[11px] mt-0.5">{item.subject}</div>}
                    </div>
                  );
                })}
                {choreGroups.map((g) => (
                  <div key={g.child.id} className="rounded-xl p-2.5 border border-gray-200 bg-white">
                    <div className="text-[11px] font-bold text-gray-500 mb-1">
                      {g.child.emoji} {g.child.name}
                    </div>
                    {g.chores.map((c) => (
                      <div key={c.id} className={`text-xs font-semibold text-gray-800 ${c.done ? "line-through opacity-50" : ""}`}>
                        🧹 {c.text}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrganizerCalendar;
