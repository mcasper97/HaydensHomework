import React from "react";
import FamilyAgendaBoard from "./FamilyAgendaBoard.jsx";

/**
 * Organizer Mode — the display-first wall/kiosk experience. Presentational
 * only: FamilyBoard.jsx still owns loading the family profile (Firestore/
 * localStorage), the family-event migration, and the chore CRUD functions
 * — this component just renders the same unified FamilyAgendaBoard the
 * normal (non-kiosk) Family Board now renders (Section 23 — "reusable for
 * the shared/kiosk experience where practical"). There is no longer a
 * separate allowManage=false variant to maintain: both surfaces are
 * execution-only now (Section 15), so this component's own render is
 * identical in shape to FamilyBoard.jsx's non-kiosk branch, just without
 * its Points strip (kiosk keeps its own, below) sharing any admin state.
 *
 * Marking an item or chore done/undone remains the one interaction this
 * surface offers — no create/edit/delete, no chore-template management,
 * ever (Shared Display security boundary, unchanged).
 */
const OrganizerDisplay = ({
  children = [],
  choreTemplates = {},
  choreCompletions = {},
  chorePoints = {},
  childStats = {},
  ctx,
  onToggleChore,
  householdTimezone,
}) => {
  // No title/back-nav here — FamilyBoard.jsx's header already renders the
  // board title and back/home controls for both its kiosk and parent
  // branches; this component owns only the display content below it.
  return (
    <div className="w-full max-w-6xl mx-auto">
      {children.length > 0 && (
        <div className="flex gap-3 mb-6 flex-wrap">
          {children.map((child) => {
            const hw = childStats[child.id]?.homeworkPoints ?? 0;
            const chore = chorePoints[child.id] || 0;
            return (
              <div key={child.id} className="flex-1 rounded-3xl p-4" style={{ minWidth: 160, background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{child.emoji}</span>
                  <div className="text-white font-display text-lg">{child.name}</div>
                </div>
                <div className="flex gap-4">
                  <div>
                    <div className="text-purple-300 text-xs uppercase font-bold">Chore pts</div>
                    <div className="text-white font-display text-xl">🧹 {chore}</div>
                  </div>
                  <div>
                    <div className="text-purple-300 text-xs uppercase font-bold">Homework pts</div>
                    <div className="text-white font-display text-xl">📚 {hw}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {children.length > 0 && (
        <FamilyAgendaBoard
          ctx={ctx}
          children={children}
          choreTemplates={choreTemplates}
          choreCompletions={choreCompletions}
          onToggleChore={onToggleChore}
          householdTimezone={householdTimezone}
        />
      )}
    </div>
  );
};

export default OrganizerDisplay;
