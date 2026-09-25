import React from "react";

/* ─────────────────────── Learner Points Strip (compact) ───────────────────────
 * A one-line-tall, horizontal points summary for Family Board — replaces the
 * old tall per-child purple cards (~140px each), which left too little
 * vertical room for the rolling-day board itself. Same underlying data
 * (chore points, homework points, learner emoji/name), just laid out as a
 * compact pill per child instead of a large card block. Informational only
 * — no click/tap target, nothing here manages or edits points.
 *
 * Height target: ~45-60px total (a single row of ~48px-tall pills, plus a
 * small bottom margin) — see tests asserting this directly against the
 * rendered pill height.
 */
const LearnerPointsStrip = ({ children = [], chorePoints = {}, childStats = {} }) => {
  if (children.length === 0) return null;
  return (
    <div data-testid="learner-points-strip" className="flex gap-2 mb-3 flex-wrap">
      {children.map((child) => {
        const hw = childStats[child.id]?.homeworkPoints ?? 0;
        const chore = chorePoints[child.id] || 0;
        return (
          <div
            key={child.id}
            className="flex items-center gap-2 px-3 rounded-full"
            style={{ height: 48, background: "#2a2a2c", border: "1px solid #3a3a3d" }}
          >
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
