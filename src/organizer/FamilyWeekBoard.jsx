import React from "react";
import { ITEM_TYPE_META } from "../data/itemTypes.js";
import { WINDOW_ORDER, WINDOW_LABELS } from "./rollingWeekBoard.js";
import { ownerMarker } from "./learnerAccent.js";

/* ─────────────────────── Family Week Board (presentational) ───────────────────────
 * Renders the rolling-7-day, execution-window-bucketed structure produced by
 * rollingWeekBoard.js's buildRollingWeekBoard — exactly seven day columns,
 * today always first, weekends never skipped. Purely presentational: no
 * subscriptions, no date math, no filtering (every row it's handed is
 * always rendered — FOCUS is de-emphasis, never hiding, per the task's own
 * Section 4). No Add Item / Edit / Delete / management control of any kind
 * (Family Board's execution-only boundary, unchanged by this redesign).
 *
 * Sizing is deliberately dense (small type, tight padding) rather than
 * scrollable — a wall-mounted kiosk board has a fixed screen, not infinite
 * height, so this component never introduces its own scroll container.
 * A day column's own list can still, in principle, overflow a real screen
 * on a very busy day; rather than let that silently push the layout into
 * scrolling, each window caps how many rows it shows and surfaces the rest
 * behind a "+N more" indicator — a last-resort overflow state, never the
 * normal case (see MAX_VISIBLE_ROWS_PER_WINDOW below).
 */

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_ROWS_PER_WINDOW = 4;

function formatTime12h(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function dayHeaderLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${WEEKDAY_LABELS[d.getDay()]} ${d.getDate()}`;
}

// Whether a row belongs to the currently-focused owner (or, under "All",
// every row is equally in-focus — Section 4: nobody de-emphasized).
function isProminent(row, focus) {
  if (!focus) return true; // "" = All
  if (focus === "family") return row.childIds.length === 0;
  return row.childIds.includes(focus);
}

// A test/quiz not yet completed gets a simple "Prep needed" indicator
// (existing `type`/`completed` fields only — no new field, no generated
// prep-task item; that generation is explicitly out of this slice's scope).
function needsPrep(row) {
  return (row.type === "test" || row.type === "quiz") && !row.completed;
}

const CompletionControl = ({ row, onToggle, size }) => {
  const dim = size === "compact" ? "w-6 h-6 text-xs" : "w-9 h-9 text-base";
  if (!row.completionEligible) {
    return (
      <div
        data-testid="agenda-row-view-only"
        aria-hidden="true"
        className={`${dim} flex-shrink-0 rounded-full border-2 border-gray-700 flex items-center justify-center text-gray-600`}
      >
        ·
      </div>
    );
  }
  return (
    <button
      onClick={onToggle}
      aria-label={row.completed ? "Mark not complete" : "Mark complete"}
      className={`${dim} flex-shrink-0 rounded-full border-2 flex items-center justify-center font-bold transition ${
        row.completed ? "bg-green-500 border-green-500 text-white" : "border-gray-500 text-transparent hover:border-gray-300"
      }`}
    >
      ✓
    </button>
  );
};

const WeekRow = ({ row, children, focus, onToggleItem, onToggleChore }) => {
  const owner = ownerMarker(row.childIds, children);
  const meta = ITEM_TYPE_META[row.type] || {};
  const prominent = isProminent(row, focus);
  const onToggle = () =>
    row.sourceType === "chore" ? onToggleChore(row.originalRecord.childId, row.originalRecord.chore) : onToggleItem(row.originalRecord);

  if (!prominent) {
    // Compact / muted — still fully visible, still tappable, just smaller
    // and lower-contrast than a prominent row (de-emphasis, never hiding).
    return (
      <div
        data-testid="agenda-row"
        data-emphasis="muted"
        className="flex items-center gap-1.5 py-1 px-1.5 rounded-lg opacity-70"
        style={{ background: "#2a2a2c" }}
      >
        <CompletionControl row={row} onToggle={onToggle} size="compact" />
        <span
          className="w-4 h-4 flex-shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold"
          style={{ background: owner.accent.bg, color: owner.accent.text, border: `1px solid ${owner.accent.border}` }}
          title={owner.label}
        >
          {owner.initial}
        </span>
        <span className={`text-[11px] text-gray-300 truncate ${row.completed ? "line-through opacity-60" : ""}`}>{row.title}</span>
      </div>
    );
  }

  return (
    <div
      data-testid="agenda-row"
      data-emphasis="prominent"
      className="flex items-center gap-2 p-2 rounded-xl"
      style={{ background: "#2a2a2c", borderLeft: `3px solid ${owner.accent.border}` }}
    >
      <CompletionControl row={row} onToggle={onToggle} size="standard" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5 truncate">
          <span
            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
            style={{ background: owner.accent.bg, color: owner.accent.text, border: `1px solid ${owner.accent.border}` }}
          >
            {owner.initial}
          </span>
          <span className="truncate">{owner.emoji ? `${owner.emoji} ${owner.label}` : owner.label}</span>
        </div>
        <div className={`text-sm font-bold text-white truncate ${row.completed ? "line-through opacity-50" : ""}`}>
          {meta.icon ? `${meta.icon} ` : ""}
          {row.title}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-500 truncate">
          {row.time && <span>{formatTime12h(row.time)}</span>}
          {needsPrep(row) && (
            <span data-testid="agenda-row-prep-needed" className="px-1 rounded bg-amber-900 text-amber-200 font-semibold">
              Prep needed
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const WeekWindow = ({ windowKey, rows, children, focus, onToggleItem, onToggleChore }) => {
  if (!rows || rows.length === 0) return null;
  const visible = rows.slice(0, MAX_VISIBLE_ROWS_PER_WINDOW);
  const overflowCount = rows.length - visible.length;
  return (
    <div data-testid={`week-window-${windowKey}`} className="mb-1.5">
      <div className="text-[9px] font-extrabold uppercase tracking-wide text-gray-500 mb-0.5">{WINDOW_LABELS[windowKey]}</div>
      <div className="space-y-1">
        {visible.map((row) => (
          <WeekRow key={row.key} row={row} children={children} focus={focus} onToggleItem={onToggleItem} onToggleChore={onToggleChore} />
        ))}
        {overflowCount > 0 && (
          <div data-testid="week-window-overflow" className="text-[10px] text-gray-500 px-1.5">
            +{overflowCount} more
          </div>
        )}
      </div>
    </div>
  );
};

const FamilyWeekBoard = ({ days, children = [], focus, onToggleItem, onToggleChore }) => {
  return (
    <div data-testid="family-week-board" className="grid grid-cols-7 gap-1.5 w-full" style={{ overflow: "hidden" }}>
      {days.map((day) => {
        const anyRows = WINDOW_ORDER.some((w) => day.windows[w].length > 0);
        return (
          <div
            key={day.dateStr}
            data-testid="week-day-column"
            data-date={day.dateStr}
            data-today={day.isToday ? "true" : "false"}
            className="flex flex-col rounded-xl p-1.5 min-w-0"
            style={{ background: day.isToday ? "#232326" : "#1f1f22", border: day.isToday ? "1px solid #4A4A55" : "1px solid transparent", overflow: "hidden" }}
          >
            <div className="flex items-baseline gap-1 mb-1 px-0.5">
              <span className={`text-xs font-extrabold ${day.isToday ? "text-white" : "text-gray-400"}`}>{dayHeaderLabel(day.dateStr)}</span>
              {day.isToday && <span className="text-[9px] font-bold text-emerald-400">TODAY</span>}
            </div>
            {anyRows ? (
              WINDOW_ORDER.map((windowKey) => (
                <WeekWindow
                  key={windowKey}
                  windowKey={windowKey}
                  rows={day.windows[windowKey]}
                  children={children}
                  focus={focus}
                  onToggleItem={onToggleItem}
                  onToggleChore={onToggleChore}
                />
              ))
            ) : (
              <div className="text-[10px] text-gray-600 px-0.5">Nothing scheduled</div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FamilyWeekBoard;
