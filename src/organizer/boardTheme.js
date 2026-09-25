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
//
// MOCKUP-FIDELITY PASS: panelFuture was pulled MUCH closer to white — a
// "very subtle tinting only" per the approved mockup's own review notes,
// not the "heavy blue block" the previous, more saturated value read as
// once real card shadows/borders were added on top of it. Two shadow
// tokens were added (cardShadow/panelShadow) so panels and cards read as
// physically layered/elevated surfaces (soft drop shadow), matching the
// mockup's polished, "premium kitchen display" feel instead of flat color
// fills with no depth.
export const SURFACE = {
  appBackground: "#FFF6E8", // warm cream / pale sky — never black/charcoal
  panelFuture: "#F7FAFD", // near-white with a whisper of cool blue
  panelToday: "#F1FAEE", // very light green/cream — Today's "active" surface
  cardFuture: "#FFFFFF",
  cardToday: "#FFFFFF",
  border: "#E7ECF3", // soft neutral hairline border shared by panels/strips
  headerBackground: "#FFFFFF", // top header band surface
  panelShadow: "0 2px 10px rgba(37, 48, 74, 0.07)", // future day-column / header elevation
  panelShadowToday: "0 4px 16px rgba(37, 48, 74, 0.10)", // Today's own panel reads slightly more elevated/prominent
  cardShadow: "0 1px 4px rgba(37, 48, 74, 0.08)", // individual task-card elevation
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
// cue at the row level, never a large background fill across the whole
// column — but the header BAND itself (Section 7 of the literal-match
// pass) is a full-width fill of `bg`, so `bg` was deliberately strengthened
// from a pale wash to a genuinely visible, saturated tint that reads as
// "sunny yellow" / "sky blue" / "playful purple" / "twilight blue" at a
// glance, not a barely-there pastel.
export const WINDOW_ACCENTS = {
  beforeSchool: { bg: "#FFE49A", border: "#E8A400", text: "#7A4D00", icon: "☀️" }, // sunny yellow/gold
  today: { bg: "#B9E0FB", border: "#1E88D6", text: "#0D4E76", icon: "📋" }, // bright sky blue
  studyHall: { bg: "#DEC4F7", border: "#8A3FE0", text: "#54267F", icon: "📚" }, // playful purple
  evening: { bg: "#C3CCF7", border: "#4457CC", text: "#2A3676", icon: "🌙" }, // deeper soft twilight blue
};

// A test/quiz's "Prep needed" badge — bright, friendly orange, distinct
// from beforeSchool's yellow-gold so the two are never confused.
export const PREP_ACCENT = { bg: "#FFD9AD", border: "#E87A0E", text: "#8A430A" };

// A completed item's checkmark control — cheerful green, per Section 7.
export const COMPLETION_ACCENT = { done: "#2FAE6C", idleBorder: "#C7D0DC" };

// The "All" focus button's own accent — a friendly green distinct from any
// single learner's own color, so "everyone in focus" doesn't read as
// belonging to one child.
export const ALL_FOCUS_ACCENT = { bg: "#BFEDCB", border: "#2FAE6C", text: "#186B3E" };
