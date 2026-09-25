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

export const LEARNER_PALETTE = [
  { name: "slate", bg: "#3A4756", border: "#6B7C90", text: "#E4E9EE" },
  { name: "sage", bg: "#47543F", border: "#7A8F6C", text: "#E7EDE2" },
  { name: "terracotta", bg: "#6E402D", border: "#B0714F", text: "#F3E4DB" },
  { name: "amber", bg: "#6B4E1D", border: "#B08A34", text: "#F5E9CF" },
  { name: "lavenderGray", bg: "#4B4560", border: "#7C749A", text: "#EAE7F0" },
  { name: "warmNeutral", bg: "#5A5049", border: "#8C8074", text: "#EFEAE4" },
];

export const FAMILY_ACCENT = { name: "family", bg: "#45454A", border: "#6B6B70", text: "#F0F0F0" };

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
