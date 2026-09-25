/* ============================== Learner identity accents ==============================
 * A distinctive, muted (never pastel/candy) per-learner color accent system
 * for the Family Board redesign — used only as a small accent (a marker
 * chip + a card's left-edge/border), never as the sole ownership signal
 * (every row also always carries an initial/name/emoji marker in text — see
 * FamilyWeekBoard.jsx's ownerMarker).
 *
 * Derivation is positional: a child's accent is simply LEARNER_PALETTE[the
 * child's index in the live `children` array], the same "index into a fixed
 * palette" precedent OrganizerCalendar.jsx's own (private, more saturated)
 * CHILD_COLORS/colorForChild already established elsewhere in this app —
 * stable as long as the children array's order doesn't change, consistent
 * with that existing precedent, and requires no new per-child color field.
 */

// VISUAL-HIERARCHY CORRECTION (UX review): reordered so the first two
// learners in a household — the common case — land on the two accents the
// task calls out by name: a restrained sage/green first, a restrained
// terracotta/coral second. The remaining slots stay distinct from BOTH
// those two and from boardTheme.js's own WINDOW_ACCENTS hues (indigo/
// amber/blue-gray are reserved there for execution-window headers, so
// learner accents 3+ deliberately avoid them here to keep "whose card is
// this" and "which window is this" from ever looking like the same cue).
export const LEARNER_PALETTE = [
  { name: "sage", bg: "#3C4A38", border: "#7FA06B", text: "#E6EFE0" },
  { name: "terracotta", bg: "#5A3226", border: "#C97B54", text: "#F5E3D6" },
  { name: "plum", bg: "#4A2F44", border: "#9B6B8F", text: "#EFE0EA" },
  { name: "goldenOlive", bg: "#4A431F", border: "#A69245", text: "#EFE9CE" },
  { name: "dustyBlue", bg: "#2E3F4A", border: "#6E93A8", text: "#DCE9EF" },
  { name: "warmNeutral", bg: "#4A423A", border: "#8C7E6B", text: "#EDE6DC" },
];

// Cool slate/gray — deliberately neutral so a family-wide item never reads
// as "belonging" to any one learner's accent color.
export const FAMILY_ACCENT = { name: "family", bg: "#333A42", border: "#7A8798", text: "#E8ECF0" };

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
