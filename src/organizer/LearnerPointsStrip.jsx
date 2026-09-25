import React from "react";
import { accentForChild } from "./learnerAccent.js";

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
 * Height target: ~45-60px (a single row of ~44-48px-tall pills) — see tests
 * asserting this directly against the rendered pill height.
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
    <div data-testid="learner-points-strip" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", flexShrink: 0 }}>
      {children.map((child) => {
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
              gap: 8,
              height: 44,
              padding: "0 14px 0 6px",
              borderRadius: 999,
              background: accent.bg,
              border: `1.5px solid ${accent.border}`,
              boxShadow: "0 1px 3px rgba(37, 48, 74, 0.08)",
            }}
          >
            {/* MOCKUP-FIDELITY PASS (Section 13): the learner's emoji now
                sits in its own small round white "avatar" badge, matching
                the mockup's circular avatar-chip treatment, rather than
                floating directly on the pill's own tinted background. */}
            <span
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "#FFFFFF",
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              {child.emoji}
            </span>
            <span className="font-display text-sm font-extrabold whitespace-nowrap" style={{ color: accent.text }}>{child.name}</span>
            <span className="text-xs font-bold whitespace-nowrap" style={{ color: accent.text }}>⭐ {totalPoints} pts</span>
          </div>
        );
      })}
    </div>
  );
};

export default LearnerPointsStrip;
