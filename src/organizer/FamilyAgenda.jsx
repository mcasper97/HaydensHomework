import React from "react";
import { ITEM_TYPE_META } from "../data/itemTypes.js";
import { DUE_DATE_TYPES } from "./candidateToDraftItem.js";

/* ─────────────────────── Family Agenda (presentational) ───────────────────────
 * The unified Family Board list (Section 14-19/24) — renders the already
 * grouped+filtered rows from familyAgenda.js's buildFamilyAgendaRows/
 * filterAgendaRows. Purely presentational: no subscriptions, no Firestore
 * access, no date/grouping logic of its own — see FamilyAgendaBoard.jsx for
 * the data-fetching container both FamilyBoard.jsx and OrganizerDisplay.jsx
 * render identically (both are execution-only surfaces now — Section 15).
 *
 * Deliberately offers only: viewing, ownership, and a single completion
 * toggle per row — no edit, no delete, no source configuration (Section 22).
 */

const SECTION_LABELS = {
  overdue: "OVERDUE",
  today: "TODAY",
  tomorrow: "TOMORROW",
  laterThisWeek: "LATER THIS WEEK",
  upcoming: "UPCOMING",
};
const SECTION_ORDER = ["overdue", "today", "tomorrow", "laterThisWeek", "upcoming"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime12h(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function weekdayLabel(dateStr) {
  return WEEKDAY_LABELS[new Date(`${dateStr}T00:00:00`).getDay()];
}

// Detail line text — type label + a when/time signal appropriate to the
// section the row is already grouped into, so "Today"'s rows say "Today"
// (or a time) rather than repeating a raw date that's already implied by
// the section heading above them.
function detailText(row, sectionKey) {
  if (row.sourceType === "chore") return "Chore · Today";

  const meta = ITEM_TYPE_META[row.type] || {};
  const label = meta.label || row.type;
  const isDue = DUE_DATE_TYPES.includes(row.type);
  const timeText = row.time ? (isDue ? `Due ${formatTime12h(row.time)}` : formatTime12h(row.time)) : null;

  let whenText;
  if (sectionKey === "tomorrow") whenText = "Tomorrow";
  else if (sectionKey === "laterThisWeek") whenText = row.date ? weekdayLabel(row.date) : null;
  else if (sectionKey === "today") whenText = "Today";
  else whenText = row.date; // overdue / upcoming — the actual date matters here

  return [label, timeText || whenText].filter(Boolean).join(" · ");
}

// Never exposes a raw child id — resolves every id to that child's
// CURRENT emoji/name (so a rename in Settings is reflected automatically,
// same live-data guarantee Board Selector's own learner buttons already
// have), and falls back to "Family" wording only for the genuinely
// household-wide (empty childIds) case.
function ownership(row, children) {
  if (row.childIds.length === 0) return { icon: "👨‍👩‍👧‍👧", text: "Family" };
  const matched = row.childIds.map((id) => children.find((c) => c.id === id)).filter(Boolean);
  if (matched.length === 0) return { icon: "👨‍👩‍👧‍👧", text: "Family" };
  if (matched.length === 1) return { icon: matched[0].emoji, text: matched[0].name };
  return { icon: matched[0].emoji, text: matched.map((c) => c.name).join(", ") };
}

const FamilyAgenda = ({ rows, children = [], onToggleItem, onToggleChore }) => {
  const anyRows = SECTION_ORDER.some((s) => rows[s]?.length > 0);

  if (!anyRows) {
    return (
      <p data-testid="family-agenda-empty" className="text-gray-400 text-center py-10">
        Nothing due — all clear!
      </p>
    );
  }

  return (
    <div data-testid="family-agenda" className="space-y-6">
      {SECTION_ORDER.map((sectionKey) => {
        const sectionRows = rows[sectionKey];
        if (!sectionRows || sectionRows.length === 0) return null;
        return (
          <div key={sectionKey} data-testid={`agenda-section-${sectionKey}`}>
            <h3
              className={`text-sm font-extrabold uppercase tracking-wide mb-2 ${
                sectionKey === "overdue" ? "text-red-400" : "text-gray-400"
              }`}
            >
              {SECTION_LABELS[sectionKey]}
            </h3>
            <div className="space-y-2">
              {sectionRows.map((row) => {
                const owner = ownership(row, children);
                const onToggle = () =>
                  row.sourceType === "chore"
                    ? onToggleChore(row.originalRecord.childId, row.originalRecord.chore)
                    : onToggleItem(row.originalRecord);
                return (
                  <div
                    key={row.key}
                    data-testid="agenda-row"
                    className="flex items-center gap-3 p-4 rounded-2xl"
                    style={{ background: "#2a2a2c" }}
                  >
                    {row.completionEligible ? (
                      <button
                        onClick={onToggle}
                        aria-label={row.completed ? "Mark not complete" : "Mark complete"}
                        className={`w-9 h-9 flex-shrink-0 rounded-full border-2 flex items-center justify-center text-base font-bold transition ${
                          row.completed
                            ? "bg-green-500 border-green-500 text-white"
                            : "border-gray-500 text-transparent hover:border-gray-300"
                        }`}
                      >
                        ✓
                      </button>
                    ) : (
                      // View-only — a future chore occurrence hasn't happened
                      // yet (see familyAgenda.js's own CHORE PROJECTION note);
                      // a plain, non-interactive indicator, never a checkbox
                      // that implies it can be toggled from here.
                      <div
                        data-testid="agenda-row-view-only"
                        aria-hidden="true"
                        className="w-9 h-9 flex-shrink-0 rounded-full border-2 border-gray-700 flex items-center justify-center text-base text-gray-600"
                      >
                        ·
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-400 mb-0.5 truncate">
                        {owner.icon} {owner.text}
                      </div>
                      <div
                        className={`font-bold text-white truncate ${row.completed ? "line-through opacity-50" : ""}`}
                      >
                        {row.title}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{detailText(row, sectionKey)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FamilyAgenda;
