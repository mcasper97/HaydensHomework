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
 * identical in shape to FamilyBoard.jsx's non-kiosk branch.
 *
 * K-5 REDESIGN: the learner points strip is no longer rendered here — it
 * now lives once, in FamilyBoard.jsx's shared header band, used by both the
 * kiosk and non-kiosk surfaces, so a kiosk display never shows two separate
 * points rows. chorePoints/childStats are accordingly no longer consumed by
 * this component (still read and passed to the header by FamilyBoard.jsx).
 *
 * Marking an item or chore done/undone remains the one interaction this
 * surface offers — no create/edit/delete, no chore-template management,
 * ever (Shared Display security boundary, unchanged).
 */
const OrganizerDisplay = ({
  children = [],
  choreTemplates = {},
  choreCompletions = {},
  ctx,
  onToggleChore,
  householdTimezone,
}) => {
  // No title/back-nav/points strip here — FamilyBoard.jsx's shared header
  // already renders the board title, learner chips, and back/home controls
  // for both its kiosk and parent branches; this component owns only the
  // board content below it.
  //
  // K-5 REDESIGN: the old `max-w-6xl mx-auto` centered desktop wrapper is
  // gone (Section 2 — no narrow centered shell; full viewport width). The
  // flex:1/minHeight:0 chain is unchanged — this surface still participates
  // in FamilyBoard.jsx's bounded-height chain (its outer shell is the
  // actual `height: 100vh`/`100dvh` + `overflow: hidden` root; this is the
  // kiosk branch's direct child of that shell).
  return (
    <div className="w-full" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
