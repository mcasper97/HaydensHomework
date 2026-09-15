import React from "react";
import ParentOrganizer from "./ParentOrganizer.jsx";
import OrganizerCalendar from "./OrganizerCalendar.jsx";

/**
 * Organizer Mode — the display-first wall/kiosk experience (Phase 1.5).
 * Presentational only: FamilyBoard.jsx still owns loading the family
 * profile (Firestore/localStorage), the family-event migration, and the
 * chore CRUD functions — this component just renders a read-mostly view of
 * that same data via the same ParentOrganizer/OrganizerCalendar components
 * Parent Mode uses, with creation/editing/deleting turned off.
 *
 * allowManage is deliberately hard-set to false here — Organizer Mode must
 * never expose create/edit/delete or chore-template management (Phase 1.5).
 * allowComplete stays true so the one approved low-friction interaction —
 * marking an item or chore done — still works from the wall display.
 */
const OrganizerDisplay = ({
  children = [],
  choreTemplates = {},
  choreCompletions = {},
  chorePoints = {},
  childStats = {},
  ctx,
  onToggleChore,
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
        <div className="rounded-3xl p-5 mb-8" style={{ background: "#2a2a2c" }}>
          <ParentOrganizer
            ctx={ctx}
            children={children}
            choreTemplates={choreTemplates}
            choreCompletions={choreCompletions}
            onToggleChore={onToggleChore}
            allowManage={false}
            allowComplete
          />
        </div>
      )}

      {children.length > 0 && (
        <div className="w-full">
          <h2 className="text-xl font-display text-white mb-3">📅 Calendar</h2>
          <OrganizerCalendar ctx={ctx} children={children} choreTemplates={choreTemplates} choreCompletions={choreCompletions} />
        </div>
      )}
    </div>
  );
};

export default OrganizerDisplay;
