import React, { useEffect, useState } from "react";
import { ITEM_TYPE_META } from "../data/itemTypes.js";
import { WINDOW_ORDER, WINDOW_LABELS } from "./rollingWeekBoard.js";
import { ownerMarker } from "./learnerAccent.js";
import { SURFACE, WINDOW_ACCENTS, PREP_ACCENT } from "./boardTheme.js";

/* ─────────────────────── Family Week Board (presentational) ───────────────────────
 * Renders the rolling-5-day, execution-window-bucketed structure produced by
 * rollingWeekBoard.js's buildRollingWeekBoard — exactly 5 day columns, today
 * always first, weekends never skipped. Purely presentational: no
 * subscriptions, no date math, no filtering (every row it's handed is
 * always rendered — FOCUS is de-emphasis, never hiding). No Add Item / Edit
 * / Delete / management control of any kind (Family Board's execution-only
 * boundary, unchanged by this redesign).
 *
 * DENSITY CORRECTION (UX review): Today's column is roughly 3x the width of
 * each future-day column (`gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr"`) and
 * renders larger, more legible cards (TodayRow); the 4 future columns stay
 * compact but keep title + owner directly readable without a click
 * (FutureRow).
 *
 * VISUAL-HIERARCHY + OVERFLOW CORRECTION (this pass): the board's colors
 * moved from ad hoc inline hex values into boardTheme.js's SURFACE/
 * WINDOW_ACCENTS/PREP_ACCENT tokens, giving each execution window a
 * distinct (but restrained) accent and layering the app/panel/card
 * surfaces so they read as distinct depths instead of one flat gray block.
 * Learner identity accents (learnerAccent.js) are unchanged in mechanism —
 * still positional-index-into-a-palette, still never the sole ownership
 * signal (every row also always carries an initial/name marker in text) —
 * only the palette's own hues were retuned. "+N more" is now a real
 * <button> (OverflowButton) that opens OverflowModal, a fixed-position
 * overlay showing every row in that exact (day, window) — never expanding
 * the board itself, which stays fixed/no-scroll.
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
 * window caps how many rows it shows and surfaces the rest behind the
 * overflow button — OverflowModal is the only thing in this component
 * allowed to scroll internally.
 */

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Today was reaching "+N more" too quickly with the old cap; 6 is the
// spec's own "approximately 5-7 actionable rows" target, achieved via
// tighter card padding/spacing, never smaller title text.
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

// A fuller label for the overflow modal/aria-label — "Friday Sep 25".
function dayHeaderFullLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${WEEKDAY_FULL[d.getDay()]} ${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
}

function dayWeekdayFull(dateStr) {
  return WEEKDAY_FULL[new Date(`${dateStr}T00:00:00`).getDay()];
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

const PrepBadge = ({ compact }) => (
  <span
    data-testid="agenda-row-prep-needed"
    className={`inline-block rounded font-semibold ${compact ? "text-[9px] px-1 py-0.5 mt-0.5" : "px-1.5 py-0.5"}`}
    style={{ background: PREP_ACCENT.bg, color: PREP_ACCENT.text, border: `1px solid ${PREP_ACCENT.border}` }}
  >
    Prep needed
  </span>
);

// Only ever rendered when the row IS completion-eligible — a non-eligible
// row gets no control at all (see FutureRow/FullCardRow), never a disabled
// placeholder, so its width goes to the title instead.
const CompletionControl = ({ row, onToggle, size }) => {
  const dim = { large: "w-10 h-10 text-lg", standard: "w-7 h-7 text-sm", compact: "w-5 h-5 text-[10px]" }[size];
  return (
    <button
      onClick={onToggle}
      aria-label={row.completed ? "Mark not complete" : "Mark complete"}
      className={`${dim} flex-shrink-0 rounded-full border-2 flex items-center justify-center font-bold transition`}
      style={
        row.completed
          ? { background: "#3F8F5C", borderColor: "#3F8F5C", color: "#fff" }
          : { borderColor: "#6B7280", color: "transparent" }
      }
    >
      ✓
    </button>
  );
};

// A readable, full-detail card — used for a prominent Today row AND for
// every row inside OverflowModal (Section 8: "use readable full cards"),
// so a modal opened for a busy future day's window is at least as legible
// as Today itself. `muted` only dims it (opacity) — the full detail stays,
// consistent with focus being de-emphasis, never a reduced information set.
const FullCardRow = ({ row, children, prominent, onToggleItem, onToggleChore, dataColumn }) => {
  const owner = ownerMarker(row.childIds, children);
  const meta = ITEM_TYPE_META[row.type] || {};
  const onToggle = () =>
    row.sourceType === "chore" ? onToggleChore(row.originalRecord.childId, row.originalRecord.chore) : onToggleItem(row.originalRecord);

  return (
    <div
      data-testid="agenda-row"
      data-emphasis={prominent ? "prominent" : "muted"}
      data-column={dataColumn}
      className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-xl"
      style={{ background: SURFACE.cardToday, borderLeft: `4px solid ${owner.accent.border}`, opacity: prominent ? 1 : 0.6 }}
    >
      {row.completionEligible && <CompletionControl row={row} onToggle={onToggle} size="large" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5 truncate">
          <OwnerChip owner={owner} size="w-5 h-5 text-[10px]" />
          <span className="truncate">{owner.emoji ? `${owner.emoji} ${owner.label}` : owner.label}</span>
        </div>
        {/* Title font size is deliberately unchanged (text-base) — vertical
            space is reclaimed via tighter padding/spacing, never smaller text. */}
        <div className={`text-base font-bold text-white truncate ${row.completed ? "line-through opacity-50" : ""}`}>
          {meta.icon ? `${meta.icon} ` : ""}
          {row.title}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 truncate">
          {meta.label && <span>{meta.label}</span>}
          {row.time && <span>{formatTime12h(row.time)}</span>}
          {needsPrep(row) && <PrepBadge />}
        </div>
      </div>
    </div>
  );
};

// TODAY'S column — the primary execution surface: larger type, larger
// cards, learner identity spelled out. A prominent row uses FullCardRow; a
// de-emphasized one collapses to a single, still today-sized line — still
// carrying its own (thinner) learner accent edge, per Section 3 ("Today
// cards may show slightly stronger learner accent than future-day cards").
const TodayRow = ({ row, children, prominent, onToggleItem, onToggleChore }) => {
  const owner = ownerMarker(row.childIds, children);
  const onToggle = () =>
    row.sourceType === "chore" ? onToggleChore(row.originalRecord.childId, row.originalRecord.chore) : onToggleItem(row.originalRecord);

  if (!prominent) {
    return (
      <div
        data-testid="agenda-row"
        data-emphasis="muted"
        data-column="today"
        className="flex items-center gap-2 py-1.5 px-2 rounded-lg opacity-70"
        style={{ background: SURFACE.cardToday, borderLeft: `2px solid ${owner.accent.border}` }}
      >
        {row.completionEligible && <CompletionControl row={row} onToggle={onToggle} size="compact" />}
        <OwnerChip owner={owner} size="w-5 h-5 text-[10px]" />
        <span className={`text-xs text-gray-300 truncate ${row.completed ? "line-through opacity-60" : ""}`}>{row.title}</span>
      </div>
    );
  }

  return (
    <FullCardRow row={row} children={children} prominent onToggleItem={onToggleItem} onToggleChore={onToggleChore} dataColumn="today" />
  );
};

// A FUTURE day's column — an awareness surface, not a primary execution
// surface. Prioritizes readable text over controls/icons: the completion
// control is omitted entirely when the row isn't completion-eligible (a
// future chore/recurring-item occurrence — see rollingWeekBoard.js's
// completionEligible rules, unchanged here); the title wraps up to 2 lines
// instead of truncating; a slate learner-accent edge (thinner than
// Today's) keeps ownership visible at a glance without a large color fill.
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
      style={{ background: SURFACE.cardFuture, borderLeft: `3px solid ${owner.accent.border}` }}
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
        {needsPrep(row) && <PrepBadge compact />}
      </div>
    </div>
  );
};

// The "+N more" control — a real, accessible button (never plain text): a
// pointer cursor and native focus/hover state come from being a genuine
// <button>, a descriptive aria-label carries day + window + hidden count
// for anyone not reading it visually, and a comfortable minimum touch
// target (44px in Today's roomier column, 32px in a future column, where
// the full 44px isn't practical inside a 1fr-wide list).
const OverflowButton = ({ day, windowKey, overflowCount, isToday, onOpen }) => (
  <button
    data-testid="week-window-overflow"
    onClick={onOpen}
    aria-label={`Show ${overflowCount} more items for ${dayWeekdayFull(day.dateStr)} ${WINDOW_LABELS[windowKey]}`}
    className={`w-full text-left rounded-lg font-semibold transition hover:brightness-125 focus:outline-none focus:ring-2 ${
      isToday ? "text-xs px-3" : "text-[10px] px-1.5"
    }`}
    style={{ minHeight: isToday ? 44 : 32, color: "#9CA3AF", background: "transparent", border: "1px dashed #4B5058" }}
  >
    +{overflowCount} more
  </button>
);

const WeekWindow = ({ windowKey, day, rows, children, focus, onToggleItem, onToggleChore, isToday, onOpenOverflow }) => {
  if (!rows || rows.length === 0) return null;
  const cap = isToday ? MAX_VISIBLE_ROWS_TODAY : MAX_VISIBLE_ROWS_FUTURE;
  const visible = rows.slice(0, cap);
  const overflowCount = rows.length - visible.length;
  const RowComponent = isToday ? TodayRow : FutureRow;
  const accent = WINDOW_ACCENTS[windowKey];
  return (
    <div data-testid={`week-window-${windowKey}`} className="mb-1">
      <div
        className="flex items-center gap-1 mb-0.5 pb-0.5"
        style={{ borderBottom: `2px solid ${accent.border}` }}
      >
        <span aria-hidden="true" className={isToday ? "text-xs" : "text-[9px]"}>
          {accent.icon}
        </span>
        <span
          data-testid="window-header-label"
          className={`font-extrabold uppercase tracking-wide ${isToday ? "text-xs" : "text-[9px]"}`}
          style={{ color: accent.text }}
        >
          {WINDOW_LABELS[windowKey]}
        </span>
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
          <OverflowButton
            day={day}
            windowKey={windowKey}
            overflowCount={overflowCount}
            isToday={isToday}
            onOpen={() => onOpenOverflow({ day, windowKey, rows })}
          />
        )}
      </div>
    </div>
  );
};

// A fixed-position overlay, never inline board expansion (Section 7: "Do
// not expand the Family Board inline. The board must remain fixed and
// no-scroll.") — shows every row for one exact (day, window), each as a
// FullCardRow, so a future day's overflow gets the same readable detail
// Today's own cards already have. Only this modal's own inner list scrolls
// (`overflow-y: auto`); the backdrop itself never causes page scroll since
// it's position: fixed, outside document flow.
const OverflowModal = ({ day, windowKey, rows, children, focus, onToggleItem, onToggleChore, onClose }) => {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const accent = WINDOW_ACCENTS[windowKey];

  // Every structural (position/display/flex) property below is inline —
  // same CDN-independence reasoning as the board's own `display: grid` and
  // LearnerPointsStrip's `display: flex` — a modal that isn't actually
  // `position: fixed` + centered would be a functionally broken overlay,
  // not just a cosmetic miss.
  return (
    <div
      data-testid="overflow-modal-backdrop"
      className="p-4"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.72)",
        zIndex: 1000,
      }}
    >
      <div
        data-testid="overflow-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${dayHeaderFullLabel(day.dateStr)} — ${WINDOW_LABELS[windowKey]}`}
        className="w-full rounded-2xl"
        style={{
          display: "flex",
          flexDirection: "column",
          background: SURFACE.panelToday,
          border: `1px solid ${SURFACE.border}`,
          maxWidth: 480,
          maxHeight: "80vh",
        }}
      >
        <div className="p-4" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${SURFACE.border}` }}>
          <div>
            <div className="text-white font-display text-lg font-bold">{dayHeaderFullLabel(day.dateStr)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, color: accent.text }} className="text-sm font-semibold">
              <span aria-hidden="true">{accent.icon}</span>
              <span data-testid="overflow-modal-window-label">{WINDOW_LABELS[windowKey]}</span>
            </div>
          </div>
          <button
            data-testid="overflow-modal-close"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 rounded-full font-bold text-gray-300 hover:text-white transition"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              background: SURFACE.cardToday,
              border: `1px solid ${SURFACE.border}`,
            }}
          >
            ✕
          </button>
        </div>
        <div data-testid="overflow-modal-scroll" className="p-3 space-y-2" style={{ overflowY: "auto" }}>
          {rows.map((row) => (
            <FullCardRow
              key={row.key}
              row={row}
              children={children}
              prominent={isProminent(row, focus)}
              onToggleItem={onToggleItem}
              onToggleChore={onToggleChore}
              dataColumn="overflow-modal"
            />
          ))}
        </div>
        <div className="p-3" style={{ borderTop: `1px solid ${SURFACE.border}` }}>
          <button
            data-testid="overflow-modal-done"
            onClick={onClose}
            className="w-full rounded-xl font-semibold text-white transition hover:brightness-110"
            style={{ minHeight: 48, background: SURFACE.cardToday, border: `1px solid ${SURFACE.border}` }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const FamilyWeekBoard = ({ days, children = [], focus, onToggleItem, onToggleChore }) => {
  const [overflowState, setOverflowState] = useState(null); // { day, windowKey, rows } | null

  return (
    <>
      <div
        data-testid="family-week-board"
        className="w-full"
        style={{
          display: "grid",
          gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr",
          gap: "0.5rem",
          overflow: "hidden",
          flex: 1,
          minHeight: 0,
        }}
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
              className={`flex flex-col rounded-xl min-w-0 ${day.isToday ? "p-2" : "p-1.5"}`}
              style={{
                background: day.isToday ? SURFACE.panelToday : SURFACE.panelFuture,
                border: day.isToday ? `1px solid ${SURFACE.border}` : "1px solid transparent",
                overflow: "hidden",
                height: "100%",
                minHeight: 0,
              }}
            >
              <div className="flex items-baseline gap-1.5 mb-1 px-0.5">
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
                    day={day}
                    rows={day.windows[windowKey]}
                    children={children}
                    focus={focus}
                    onToggleItem={onToggleItem}
                    onToggleChore={onToggleChore}
                    isToday={day.isToday}
                    onOpenOverflow={setOverflowState}
                  />
                ))
              ) : (
                <div className={day.isToday ? "text-sm text-gray-600 px-1" : "text-[10px] text-gray-600 px-0.5"}>Nothing scheduled</div>
              )}
            </div>
          );
        })}
      </div>

      {overflowState && (
        <OverflowModal
          day={overflowState.day}
          windowKey={overflowState.windowKey}
          rows={overflowState.rows}
          children={children}
          focus={focus}
          onToggleItem={onToggleItem}
          onToggleChore={onToggleChore}
          onClose={() => setOverflowState(null)}
        />
      )}
    </>
  );
};

export default FamilyWeekBoard;
