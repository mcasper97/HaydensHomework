import React from "react";
import FamilyAgendaBoard from "./FamilyAgendaBoard.jsx";
import LearnerPointsStrip from "./LearnerPointsStrip.jsx";

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
  // VIEWPORT-FIT CORRECTION: mirrors FamilyBoard.jsx's own non-kiosk
  // wrapper — flex:1/minHeight:0 so this surface participates in the same
  // bounded-height chain (FamilyBoard.jsx's outer shell is the actual
  // `height: 100vh` + `overflow: hidden` root; this is the kiosk branch's
  // direct child of that shell).
  return (
    <div className="w-full max-w-6xl mx-auto" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <LearnerPointsStrip children={children} chorePoints={chorePoints} childStats={childStats} />

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
