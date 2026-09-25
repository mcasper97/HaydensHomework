import React from "react";
import { accentForChild } from "./learnerAccent.js";
import { SURFACE } from "./boardTheme.js";

/* ─────────────────────── Learner Points Strip (compact) ───────────────────────
 * A one-line-tall, horizontal points summary for Family Board — replaces the
 * old tall per-child purple cards (~140px each), which left too little
 * vertical room for the rolling-day board itself. Same underlying data
 * (chore points, homework points, learner emoji/name), same compact
 * horizontal pill layout, same placement, same height target. Informational
 * only — no click/tap target, nothing here manages or edits points.
 *
 * VISUAL-HIERARCHY CORRECTION (this pass): colors only, structure
 * untouched — each pill now sits on boardTheme.js's own card surface
 * (rather than an ad hoc hex value) and carries a small learner-accent
 * dot, using the SAME accentForChild derivation the board's own cards use,
 * so a learner's color reads consistently in both places. The strip
 * remains deliberately subtle/secondary — a small dot, not a colored
 * card fill.
 *
 * Height target: ~45-60px total (a single row of ~48px-tall pills, plus a
 * small bottom margin) — see tests asserting this directly against the
 * rendered pill height.
 *
 * `display: flex` (+ gap/wrap on the strip, + alignment on each pill) is
 * set inline rather than via Tailwind's `flex`/`gap-*` utility classes —
 * same reasoning as FamilyWeekBoard.jsx's own `display: grid` precedent:
 * this app's Tailwind is CDN-loaded, and a household with 2+ learners
 * needs this strip laid out horizontally (not stacked as full-width
 * blocks) to stay compact — confirmed the hard way while building this
 * pass's own tests, which measured a 2-learner strip at ~100px tall
 * (two stacked full-width rows) until this was made inline.
 */
const LearnerPointsStrip = ({ children = [], chorePoints = {}, childStats = {} }) => {
  if (children.length === 0) return null;
  return (
    <div data-testid="learner-points-strip" className="mb-2" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", flexShrink: 0 }}>
      {children.map((child) => {
        const hw = childStats[child.id]?.homeworkPoints ?? 0;
        const chore = chorePoints[child.id] || 0;
        const accent = accentForChild(children, child.id);
        return (
          <div
            key={child.id}
            className="rounded-full px-3"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              height: 48,
              background: SURFACE.cardFuture,
              border: `1px solid ${SURFACE.border}`,
            }}
          >
            <span
              aria-hidden="true"
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: accent.border }}
            />
            <span className="text-lg leading-none">{child.emoji}</span>
            <span className="text-white font-display text-sm font-bold whitespace-nowrap">{child.name}</span>
            <span className="text-gray-400 text-xs whitespace-nowrap">🧹 {chore}</span>
            <span className="text-gray-400 text-xs whitespace-nowrap">📚 {hw}</span>
          </div>
        );
      })}
    </div>
  );
};

export default LearnerPointsStrip;
