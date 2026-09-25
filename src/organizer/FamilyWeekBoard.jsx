import React from "react";
import { ITEM_TYPE_META } from "../data/itemTypes.js";
import { WINDOW_ORDER, WINDOW_LABELS } from "./rollingWeekBoard.js";
import { ownerMarker } from "./learnerAccent.js";

/* ─────────────────────── Family Week Board (presentational) ───────────────────────
 * Renders the rolling-5-day, execution-window-bucketed structure produced by
 * rollingWeekBoard.js's buildRollingWeekBoard — exactly 5 day columns, today
 * always first, weekends never skipped. Purely presentational: no
 * subscriptions, no date math, no filtering (every row it's handed is
 * always rendered — FOCUS is de-emphasis, never hiding). No Add Item / Edit
 * / Delete / management control of any kind (Family Board's execution-only
 * boundary, unchanged by this redesign).
 *
 * DENSITY CORRECTION (UX review): the original 7-equal-column layout was
 * too dense to read at a glance. Today's column is now roughly 3x the
 * width of each future-day column (`gridTemplateColumns: "3fr 1fr 1fr 1fr
 * 1fr"`) and renders larger, more legible cards (TodayRow); the 4 future
 * columns stay compact but keep title + owner directly readable without a
 * click (FutureRow) — "abbreviated," per spec, never "tiny unreadable
 * chips."
 *
 * The board's own `display: grid` + `gap` are set inline rather than via
 * Tailwind's `grid`/`gap-*` utility classes — this app's Tailwind is
 * CDN-loaded (index.html), and this is the one container whose entire
 * layout depends on `display: grid` actually taking effect; keeping it
 * inline, alongside `gridTemplateColumns` (already inline, for the 3fr/1fr
 * ratio no Tailwind utility expresses), means the column layout never
 * silently collapses to block stacking if the CDN stylesheet is ever slow
 * or unavailable.
 *
 * Sizing is still deliberately dense rather than scrollable — a
 * wall-mounted kiosk board has a fixed screen, not infinite height, so this
 * component never introduces its own scroll container. A day column's own
 * list can still, in principle, overflow a real screen on a very busy day;
 * rather than let that silently push the layout into scrolling, each
 * window caps how many rows it shows and surfaces the rest behind a "+N
 * more" indicator — a last-resort overflow state, never the normal case
 * (see MAX_VISIBLE_ROWS_TODAY/FUTURE).
 *
 * SCREENSHOT-REVIEW CORRECTION: the deployed board reached Today's "+N
 * more" too quickly, and future-day cards were too narrow/truncated to
 * read. Fixes, all presentation-only: (1) the learner points cards moved
 * out of this component entirely, into the new compact
 * LearnerPointsStrip.jsx, reclaiming vertical space for the board itself;
 * (2) MAX_VISIBLE_ROWS_TODAY raised 3 -> 6 via tighter card
 * padding/spacing, never smaller title text; (3) FutureRow now omits its
 * completion control entirely when a row isn't completion-eligible, drops
 * the decorative type icon, and wraps its title up to 2 lines instead of
 * truncating — reclaiming width/height for the one thing a future card
 * must communicate: who, and what.
 */

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// DENSITY CORRECTION (screenshot review): Today was reaching "+N more" too
// quickly. Raised from 3 -> 6 (spec's own "approximately 5-7 actionable
// rows" target) — achieved by tightening card padding/spacing (see
// TodayRow's prominent card below), never by shrinking title font size.
const MAX_VISIBLE_ROWS_TODAY = 6;
const MAX_VISIBLE_ROWS_FUTURE = 4;

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
// every row is equally in-focus — nobody de-emphasized).
function isProminent(row, focus) {
  if (!focus) return true; // "" = All
  if (focus === "family") return row.childIds.length === 0;
  return row.childIds.includes(focus);
}

// A test/quiz not yet completed gets a simple "Prep needed" indicator
// (existing `type`/`completed` fields only — no new field, no generated
// prep-task item; that generation is explicitly out of scope here).
function needsPrep(row) {
  return (row.type === "test" || row.type === "quiz") && !row.completed;
}

const OwnerChip = ({ owner, size }) => (
  <span
    className={`${size} flex-shrink-0 rounded-full flex items-center justify-center font-bold`}
    style={{ background: owner.accent.bg, color: owner.accent.text, border: `1px solid ${owner.accent.border}` }}
    title={owner.label}
  >
    {owner.initial}
  </span>
);

const CompletionControl = ({ row, onToggle, size }) => {
  const dim = { large: "w-10 h-10 text-lg", standard: "w-7 h-7 text-sm", compact: "w-5 h-5 text-[10px]" }[size];
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

// TODAY'S column — the primary execution surface (Section 3): larger type,
// larger cards, learner identity spelled out, secondary context (time,
// type label, Prep needed) all readable without a click. Two tiers: a
// full-size card for a prominent (in-focus) row, and a still today-sized
// (just single-line) card for a de-emphasized one — de-emphasis is opacity
// + size, never hiding.
const TodayRow = ({ row, children, prominent, onToggleItem, onToggleChore }) => {
  const owner = ownerMarker(row.childIds, children);
  const meta = ITEM_TYPE_META[row.type] || {};
  const onToggle = () =>
    row.sourceType === "chore" ? onToggleChore(row.originalRecord.childId, row.originalRecord.chore) : onToggleItem(row.originalRecord);

  if (!prominent) {
    return (
      <div
        data-testid="agenda-row"
        data-emphasis="muted"
        data-column="today"
        className="flex items-center gap-2 py-1.5 px-2 rounded-lg opacity-70"
        style={{ background: "#2a2a2c" }}
      >
        <CompletionControl row={row} onToggle={onToggle} size="compact" />
        <OwnerChip owner={owner} size="w-5 h-5 text-[10px]" />
        <span className={`text-xs text-gray-300 truncate ${row.completed ? "line-through opacity-60" : ""}`}>{row.title}</span>
      </div>
    );
  }

  return (
    <div
      data-testid="agenda-row"
      data-emphasis="prominent"
      data-column="today"
      className="flex items-center gap-2.5 py-2 px-2.5 rounded-xl"
      style={{ background: "#2a2a2c", borderLeft: `4px solid ${owner.accent.border}` }}
    >
      <CompletionControl row={row} onToggle={onToggle} size="large" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5 truncate">
          <OwnerChip owner={owner} size="w-5 h-5 text-[10px]" />
          <span className="truncate">{owner.emoji ? `${owner.emoji} ${owner.label}` : owner.label}</span>
        </div>
        {/* Title font size is deliberately unchanged (text-base) — the
            screenshot-review correction reclaims vertical space via
            tighter padding/spacing above and below, never smaller text. */}
        <div className={`text-base font-bold text-white truncate ${row.completed ? "line-through opacity-50" : ""}`}>
          {meta.icon ? `${meta.icon} ` : ""}
          {row.title}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 truncate">
          {meta.label && <span>{meta.label}</span>}
          {row.time && <span>{formatTime12h(row.time)}</span>}
          {needsPrep(row) && (
            <span data-testid="agenda-row-prep-needed" className="px-1.5 py-0.5 rounded bg-amber-900 text-amber-200 font-semibold">
              Prep needed
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// A FUTURE day's column — an awareness surface, not a primary execution
// surface (Section 4). Prioritizes readable text over controls/icons:
// - the completion control is OMITTED ENTIRELY when the row isn't
//   completion-eligible (e.g. a future chore/recurring-item occurrence —
//   see rollingWeekBoard.js's own completionEligible rules, unchanged
//   here), freeing its width for the title (Section 5) — a genuinely
//   eligible future item (most one-time Items) still gets a small,
//   tappable control.
// - the decorative type icon is dropped (Section 7's own priority order:
//   decorative icons are lowest priority, dropped before the title is
//   ever shrunk or truncated).
// - the title wraps up to 2 lines instead of being truncated with an
//   ellipsis (Section 7 — "avoid ellipsis on the primary title whenever
//   reasonably possible").
// Emphasis is opacity-only here (prominent = full contrast, muted = still
// legible, just dimmer) — de-emphasis, never hiding (Section 9).
const FutureRow = ({ row, children, prominent, onToggleItem, onToggleChore }) => {
  const owner = ownerMarker(row.childIds, children);
  const onToggle = () =>
    row.sourceType === "chore" ? onToggleChore(row.originalRecord.childId, row.originalRecord.chore) : onToggleItem(row.originalRecord);

  return (
    <div
      data-testid="agenda-row"
      data-emphasis={prominent ? "prominent" : "muted"}
      data-column="future"
      className={`flex items-start gap-1.5 py-1.5 px-1.5 rounded-lg ${prominent ? "" : "opacity-65"}`}
      style={{ background: "#2a2a2c" }}
    >
      {row.completionEligible && <CompletionControl row={row} onToggle={onToggle} size="compact" />}
      <OwnerChip owner={owner} size="w-4 h-4 text-[9px]" />
      <div className="flex-1 min-w-0">
        <div
          className={`text-xs text-gray-100 font-semibold leading-snug ${row.completed ? "line-through opacity-60" : ""}`}
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {row.title}
        </div>
        {needsPrep(row) && (
          <span
            data-testid="agenda-row-prep-needed"
            className="inline-block mt-0.5 text-[9px] px-1 py-0.5 rounded bg-amber-900 text-amber-200 font-semibold"
          >
            Prep needed
          </span>
        )}
      </div>
    </div>
  );
};

const WeekWindow = ({ windowKey, rows, children, focus, onToggleItem, onToggleChore, isToday }) => {
  if (!rows || rows.length === 0) return null;
  const cap = isToday ? MAX_VISIBLE_ROWS_TODAY : MAX_VISIBLE_ROWS_FUTURE;
  const visible = rows.slice(0, cap);
  const overflowCount = rows.length - visible.length;
  const RowComponent = isToday ? TodayRow : FutureRow;
  return (
    <div data-testid={`week-window-${windowKey}`} className="mb-1.5">
      <div className={`font-extrabold uppercase tracking-wide text-gray-500 mb-0.5 ${isToday ? "text-xs" : "text-[9px]"}`}>
        {WINDOW_LABELS[windowKey]}
      </div>
      <div className="space-y-1">
        {visible.map((row) => (
          <RowComponent
            key={row.key}
            row={row}
            children={children}
            prominent={isProminent(row, focus)}
            onToggleItem={onToggleItem}
            onToggleChore={onToggleChore}
          />
        ))}
        {overflowCount > 0 && (
          <div data-testid="week-window-overflow" className={isToday ? "text-xs text-gray-500 px-2" : "text-[10px] text-gray-500 px-1"}>
            +{overflowCount} more
          </div>
        )}
      </div>
    </div>
  );
};

const FamilyWeekBoard = ({ days, children = [], focus, onToggleItem, onToggleChore }) => {
  return (
    <div
      data-testid="family-week-board"
      className="w-full"
      style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr", gap: "0.5rem", overflow: "hidden" }}
    >
      {days.map((day) => {
        const anyRows = WINDOW_ORDER.some((w) => day.windows[w].length > 0);
        return (
          <div
            key={day.dateStr}
            data-testid="week-day-column"
            data-date={day.dateStr}
            data-today={day.isToday ? "true" : "false"}
            data-column-density={day.isToday ? "today" : "future"}
            className={`flex flex-col rounded-xl min-w-0 ${day.isToday ? "p-3" : "p-1.5"}`}
            style={{
              background: day.isToday ? "#232326" : "#1f1f22",
              border: day.isToday ? "1px solid #4A4A55" : "1px solid transparent",
              overflow: "hidden",
            }}
          >
            <div className="flex items-baseline gap-1.5 mb-1.5 px-0.5">
              <span className={day.isToday ? "text-lg font-extrabold text-white" : "text-xs font-extrabold text-gray-400"}>
                {dayHeaderLabel(day.dateStr)}
              </span>
              {day.isToday && <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">Today</span>}
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
                  isToday={day.isToday}
                />
              ))
            ) : (
              <div className={day.isToday ? "text-sm text-gray-600 px-1" : "text-[10px] text-gray-600 px-0.5"}>Nothing scheduled</div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FamilyWeekBoard;
