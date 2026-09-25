/* ============================== Family Board theme tokens ==============================
 * Small, presentation-only color constants for the Family Board visual-
 * hierarchy correction (UX review): the board had gone too visually
 * monochrome/dark, with almost no distinction between the app background,
 * a day column's own surface, and a card sitting on top of it, and no way
 * to tell one execution window's header from another's at a glance.
 *
 * Every value here is inline-style-consumed, not a Tailwind utility class —
 * this app's Tailwind is CDN-loaded (index.html) and this environment's own
 * sandbox network policy blocks that CDN outright (confirmed while building
 * the rolling-day layout: cdn.tailwindcss.com fails with
 * ERR_TUNNEL_CONNECTION_FAILED here), so any layout- or color-critical
 * property has to be inline to render (and be testable) reliably —
 * consistent with FamilyWeekBoard.jsx's own `display: grid` precedent.
 *
 * Deliberately restrained throughout: muted/desaturated tones, never a
 * bright/neon/pastel fill, never a large saturated background block — the
 * accent is a thin border, a chip, or a small icon + tinted label text,
 * not a colored card surface.
 */

// Layered dark-neutral surfaces — darkest at the app shell, one step
// lighter per layer, so a day column and the cards inside it read as
// distinct surfaces rather than one flat block of near-identical gray.
export const SURFACE = {
  appBackground: "#131315", // charcoal / near-black
  panelFuture: "#1B1D20", // a future day's own dark-slate column surface
  panelToday: "#212328", // Today's column — one step lighter, the "active" surface
  cardFuture: "#26282C", // a future-day row/card surface
  cardToday: "#2B2D32", // a Today row/card surface — slightly lighter still
  border: "#33363B", // a neutral hairline border shared by panels/strips
};

// Execution-window accents — a thin border/icon/label-color cue per
// window, never a background fill (Section 4: "prefer a thin accent line,
// small icon, subtle header tint, distinct header text color... avoid
// large background blocks").
export const WINDOW_ACCENTS = {
  beforeSchool: { border: "#C99A3D", text: "#D9AF5F", icon: "🌅" }, // muted amber
  today: { border: "#5C7A9E", text: "#8FA8C4", icon: "🗓️" }, // slate / navy
  studyHall: { border: "#8478C9", text: "#A79CDE", icon: "📖" }, // muted indigo
  evening: { border: "#5A7080", text: "#8FA4B2", icon: "🌙" }, // blue-gray
};

// A test/quiz's "Prep needed" indicator — restrained amber/burnt-orange,
// distinct from beforeSchool's cooler amber so the two are never confused,
// and never the bright/neon orange the task explicitly calls out to avoid.
export const PREP_ACCENT = { bg: "#4A2E14", border: "#D98A3D", text: "#F0C08C" };
