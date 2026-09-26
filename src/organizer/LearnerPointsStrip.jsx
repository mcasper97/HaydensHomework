import React from "react";
import { accentForChild } from "./learnerAccent.js";
import { LearnerAvatar } from "./illustrations.jsx";

/* ─────────────────────── Learner Points Strip (compact) ───────────────────────
 * A one-line-tall, horizontal points summary for Family Board — a row of
 * small, kid-friendly pills, one per learner. Same underlying data (chore
 * points, homework points, learner emoji/name), same compact horizontal
 * layout, same height target. Informational only — no click/tap target,
 * nothing here manages or edits points.
 *
 * K-5 REDESIGN (approved mockup, Section 9): now renders once inside
 * FamilyBoard.jsx's shared header band (used by both the kiosk and
 * non-kiosk surfaces — no longer duplicated inside OrganizerDisplay.jsx),
 * so it no longer carries its own bottom margin; the header row's own gap
 * handles spacing. Each pill is now tinted with the SAME per-learner accent
 * (accentForChild) the board's own cards use — a light fill + saturated
 * border + accent-colored name, rather than the prior dark-theme pass's
 * neutral card surface + small accent dot — so a learner's color reads
 * immediately and consistently in both places, matching the mockup's own
 * colored chip treatment. Ownership is still never color-only: the emoji
 * and name are always present as text too.
 *
 * HEADER MEASURED-FIDELITY PASS: height target grew from ~45-60px to
 * ~80-100px (pinned to the approved mockup's own measured chip height, a
 * large ~72px avatar plus stacked name/points text) — a deliberate,
 * measured change, not scope creep; the three tests that asserted the old
 * compact bound were updated alongside this file to the new one.
 *

 * `display: flex` (+ gap/wrap on the strip, + alignment on each pill) is
 * set inline rather than via Tailwind's `flex`/`gap-*` utility classes —
 * same reasoning as FamilyWeekBoard.jsx's own `display: grid` precedent:
 * this app's Tailwind is CDN-loaded, and a household with 2+ learners
 * needs this strip laid out horizontally (not stacked as full-width
 * blocks) to stay compact — confirmed the hard way while building the
 * original version of this component, which measured a 2-learner strip at
 * ~100px tall (two stacked full-width rows) until this was made inline.
 */
const LearnerPointsStrip = ({ children = [], chorePoints = {}, childStats = {} }) => {
  if (children.length === 0) return null;
  return (
    <div data-testid="learner-points-strip" style={{ display: "flex", gap: 22, flexWrap: "wrap", flexShrink: 0 }}>
      {children.map((child, idx) => {
        const hw = childStats[child.id]?.homeworkPoints ?? 0;
        const chore = chorePoints[child.id] || 0;
        const accent = accentForChild(children, child.id);
        const totalPoints = hw + chore;
        return (
          <div
            key={child.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 88,
              padding: "0 22px 0 8px",
              borderRadius: 999,
              background: accent.bg,
              border: `1.5px solid ${accent.border}`,
              boxShadow: "0 1px 3px rgba(37, 48, 74, 0.08)",
            }}
          >
            {/* PICTURE-NOT-ICON PASS: a real illustrated avatar (the
                mockup's own cat/bear crop, illustrations.jsx) tinted by the
                learner's own accent, replacing the bare emoji-in-a-white-
                circle badge. HEADER MEASURED-FIDELITY PASS: sized 72px —
                the mockup's own measured avatar diameter — not a smaller
                approximation. */}
            <LearnerAvatar accent={accent} size={72} index={idx} />
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
              <span className="font-display font-extrabold whitespace-nowrap" style={{ fontSize: 24, color: accent.text }}>{child.name}</span>
              <span className="font-bold whitespace-nowrap" style={{ fontSize: 16, color: accent.text }}>⭐ {totalPoints} pts</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default LearnerPointsStrip;
