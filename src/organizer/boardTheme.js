/* ============================== Family Board theme tokens ==============================
 * K-5 KID-FRIENDLY REDESIGN (approved mockup): the Family Board moved from a
 * dark/charcoal "monitor" aesthetic to a bright, cheerful, kitchen-display
 * palette a K-5 kid actually wants to look at — warm cream app background,
 * white cards, sunny/sky/purple/twilight execution-window accents. Every
 * value here is still inline-style-consumed, not a Tailwind utility class —
 * this app's Tailwind is CDN-loaded (index.html) and this environment's own
 * sandbox network policy blocks that CDN outright (confirmed while building
 * the rolling-day layout: cdn.tailwindcss.com fails with
 * ERR_TUNNEL_CONNECTION_FAILED here), so any layout- or color-critical
 * property has to be inline to render (and be testable) reliably.
 *
 * Color is still used with restraint in the sense the earlier dark-theme
 * pass established — a header accent, an icon, a badge, a card's left-edge
 * marker — never a giant saturated background block flooding the whole
 * screen (Section 7: "avoid excessive pastel blocks similar to Skylight").
 * The difference from the prior pass is brightness/warmth, not the
 * restraint principle itself.
 */

// Layered light-neutral surfaces — a warm cream app shell, a slightly
// distinct tint per day-column "mood" (Today reads faintly green/fresh,
// future days read faintly cool/blue), and plain white cards on top so a
// card always pops off its own column's surface.
export const SURFACE = {
  appBackground: "#FFF6E8", // warm cream / pale sky — never black/charcoal
  panelFuture: "#EAF4FC", // very light blue/neutral future-day column surface
  panelToday: "#F0FAEE", // very light green/cream — Today's "active" surface
  cardFuture: "#FFFFFF",
  cardToday: "#FFFFFF",
  border: "#E3E9F2", // soft neutral hairline border shared by panels/strips
  headerBackground: "#FFFFFF", // top header band surface
  // Text tokens — set inline (never a Tailwind text-color utility) so
  // headings/body copy stay legible even if the Tailwind CDN never loads;
  // this also means the browser's own default (black) text already reads
  // fine against these light surfaces as a safety net.
  textPrimary: "#243046", // dark navy/slate — headings, card titles
  textSecondary: "#66738A", // muted slate-gray — secondary/meta text
  textMuted: "#9CA7B8", // faint slate — placeholders, "Nothing scheduled"
};

// Execution-window accents — each window gets its own kid-friendly hue: a
// light tint for the section background/badge, a saturated border/icon
// color, and a readable-on-cream text color. Still a thin border/icon/badge
// cue, never a large background fill across the whole column.
export const WINDOW_ACCENTS = {
  beforeSchool: { bg: "#FFF3D3", border: "#F0AD1E", text: "#8A5B00", icon: "☀️" }, // sunny yellow/gold
  today: { bg: "#DFF0FD", border: "#3D9BE0", text: "#155A8A", icon: "📋" }, // bright sky blue
  studyHall: { bg: "#EFE4FB", border: "#9B5FE0", text: "#63328F", icon: "📚" }, // playful purple
  evening: { bg: "#E2E7FB", border: "#5B6FD6", text: "#333F91", icon: "🌙" }, // deeper soft twilight blue
};

// A test/quiz's "Prep needed" badge — bright, friendly orange, distinct
// from beforeSchool's yellow-gold so the two are never confused.
export const PREP_ACCENT = { bg: "#FFE6CC", border: "#F28C28", text: "#9A4E0A" };

// A completed item's checkmark control — cheerful green, per Section 7.
export const COMPLETION_ACCENT = { done: "#3FBE7C", idleBorder: "#C7D0DC" };

// The "All" focus button's own accent — a friendly green distinct from any
// single learner's own color, so "everyone in focus" doesn't read as
// belonging to one child.
export const ALL_FOCUS_ACCENT = { bg: "#E1F5E6", border: "#3FBE7C", text: "#1E7A44" };
