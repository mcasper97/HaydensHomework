/* ============================== Learner identity accents ==============================
 * A distinctive, bright, kid-friendly per-learner color accent system for
 * the Family Board's K-5 redesign — used as a small accent (a marker chip +
 * a card's left-edge/border, plus a focus-button tint), never as the sole
 * ownership signal (every row also always carries an initial/name/emoji
 * marker in text — see FamilyWeekBoard.jsx's ownerMarker).
 *
 * Derivation is positional: a child's accent is simply LEARNER_PALETTE[the
 * child's index in the live `children` array], the same "index into a fixed
 * palette" precedent OrganizerCalendar.jsx's own (private, more saturated)
 * CHILD_COLORS/colorForChild already established elsewhere in this app —
 * stable as long as the children array's order doesn't change, consistent
 * with that existing precedent, and requires no new per-child color field
 * (and, per the approved mockup's own Section 8, no hardcoded child name —
 * whichever two learners are added first land on the first two slots below,
 * which happen to be the pink/coral and blue/aqua families the mockup's
 * own two example learners use).
 */

// K-5 REDESIGN: bright pink/coral first, blue/aqua second — the two
// families the approved mockup itself uses for its two example learners —
// then four more bright, distinct, non-babyish hues. Slots stay distinct
// from boardTheme.js's own WINDOW_ACCENTS hues (yellow/sky-blue/purple/
// twilight-blue reserved there for execution-window headers) so "whose
// card is this" and "which window is this" never look like the same cue.
export const LEARNER_PALETTE = [
  { name: "coral", bg: "#FFE1E9", border: "#FF6F91", text: "#B0224A" },
  { name: "aqua", bg: "#DCF4FA", border: "#2FB6D9", text: "#0E6E86" },
  { name: "sunshine", bg: "#FFF2C6", border: "#EAB308", text: "#8A6300" },
  { name: "grape", bg: "#EFE1FB", border: "#9B5FE0", text: "#5B3494" },
  { name: "mint", bg: "#DBF6E7", border: "#22B57A", text: "#146B3F" },
  { name: "tangerine", bg: "#FFE3CC", border: "#F2822E", text: "#9A4E0E" },
];

// Friendly blue/slate — deliberately neutral-but-still-bright so a
// family-wide item never reads as "belonging" to any one learner's accent
// color while still fitting the K-5 palette's overall energy.
export const FAMILY_ACCENT = { name: "family", bg: "#E3E9FB", border: "#6E85D6", text: "#33448F" };

export function accentForChild(children, childId) {
  const idx = (children || []).findIndex((c) => c.id === childId);
  if (idx < 0) return FAMILY_ACCENT;
  return LEARNER_PALETTE[idx % LEARNER_PALETTE.length];
}

// A short, always-present text marker — never relies on color alone.
// Family (childIds: []) or an unmatched/legacy id both fall back to the
// same neutral "Family" wording FamilyAgenda.jsx's own ownership() already
// used, so existing behavior/expectations carry over unchanged.
export function ownerMarker(childIds, children) {
  if (!childIds || childIds.length === 0) return { label: "Family", initial: "F", accent: FAMILY_ACCENT };
  const matched = childIds.map((id) => (children || []).find((c) => c.id === id)).filter(Boolean);
  if (matched.length === 0) return { label: "Family", initial: "F", accent: FAMILY_ACCENT };
  if (matched.length === 1) {
    const c = matched[0];
    return { label: c.name, initial: (c.name || "?").slice(0, 1).toUpperCase(), emoji: c.emoji, accent: accentForChild(children, c.id) };
  }
  return {
    label: matched.map((c) => c.name).join(", "),
    initial: (matched[0].name || "?").slice(0, 1).toUpperCase(),
    emoji: matched[0].emoji,
    accent: accentForChild(children, matched[0].id),
  };
}
