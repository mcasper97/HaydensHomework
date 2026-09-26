/* ============================== Content-aware Today icon resolver ==============================
 * Presentation-layer only — never reads, writes, or infers anything about
 * canonical Item data/schemas (data/itemTypes.js, data/itemsRepository.js
 * are both untouched by this module). Given a row's existing `title` (and,
 * as the fallback, its existing `type`), returns the most specific,
 * kid-friendly icon a human would expect for that exact task — "Pajama/
 * Stuffy Day" gets a teddy bear, not the generic school-event icon — rather
 * than always falling back to the coarse per-TYPE icon every row of that
 * type already shares (ITEM_TYPE_META).
 *
 * Deterministic, ordered keyword match against the title only — no ML, no
 * network call, nothing that could vary run to run. Rules are checked
 * top-to-bottom and the FIRST match wins, so more specific keywords are
 * listed before more generic ones (e.g. "study guide" before bare "study").
 * A title matching nothing here falls back to ITEM_TYPE_META[row.type]'s
 * own icon — the exact behavior every row had before this resolver existed
 * — so nothing regresses for a title this list doesn't yet anticipate.
 *
 * MOCKUP-LITERAL PASS: the first six rules below (pajama, gold-folder
 * reminder, gold-folder-itself, geography, reading, healthy snack) are the
 * six task titles the approved mockup's own "Today" column actually shows,
 * and each now points at a real PNG cropped directly out of that mockup
 * image (public/family-board/icons/) rather than an emoji approximation —
 * an emoji glyph can never pixel-match a custom flat-vector illustration,
 * so these six are literal source pixels, not a redraw. Every rule after
 * those six is unchanged from before this pass: a plain emoji, because the
 * mockup has no corresponding illustration to crop for that keyword. A
 * title matching none of these still falls back to ITEM_TYPE_META's emoji,
 * exactly as before.
 *
 * Used only by FullCardRow (Today's prominent cards + the overflow modal,
 * which intentionally keeps the same rich, full-detail treatment regardless
 * of which day the item came from). FutureRow never calls this — future-day
 * cards stay deliberately icon-free by construction, not by this resolver
 * ever returning an empty icon for them.
 */
import { ITEM_TYPE_META } from "../data/itemTypes.js";

const image = (src, alt) => ({ kind: "image", src, alt });
const emoji = (value) => ({ kind: "emoji", value });

const ICONS_BASE = "/family-board/icons";

const KEYWORD_ICON_RULES = [
  { pattern: /pajama|stuffy|stuffie|stuffed animal/i, icon: image(`${ICONS_BASE}/pajama-teddy.png`, "") },
  // Distinguished from the plain "gold folder" rule below by this title's
  // own distinctive "on Fridays" wording — the mockup gives these two
  // gold-folder-themed rows two DIFFERENT icons (a reminder/certificate
  // icon here, the folder itself below), so a single "folder" keyword
  // can't serve both; matching this title's own distinctive phrase (rather
  // than guessing a general rule) keeps the two literal, not invented.
  { pattern: /on fridays/i, icon: image(`${ICONS_BASE}/certificate.png`, "") },
  { pattern: /back.?to.?school/i, icon: emoji("🏫") },
  { pattern: /gold folder|\bfolder\b/i, icon: image(`${ICONS_BASE}/folder.png`, "") },
  { pattern: /sign(ature)?|permission slip/i, icon: emoji("✍️") },
  { pattern: /geography|\bglobe\b|\bmap\b/i, icon: image(`${ICONS_BASE}/globe-stand.png`, "") },
  { pattern: /reading|phonics|spelling|vocabulary/i, icon: image(`${ICONS_BASE}/book-stack.png`, "") },
  { pattern: /study guide|\bstudy\b/i, icon: emoji("📚") },
  { pattern: /healthy snack|\bsnack\b|\blunch\b/i, icon: image(`${ICONS_BASE}/apple.png`, "") },
  { pattern: /\bmath\b|worksheet/i, icon: emoji("🔢") },
  { pattern: /\bbike\b|bicycle/i, icon: emoji("🚲") },
  { pattern: /\bmovie\b|film night/i, icon: emoji("🍿") },
  { pattern: /grocery|shopping/i, icon: emoji("🛒") },
  { pattern: /game night|board game/i, icon: emoji("🎲") },
];

// Returns { kind: "image", src, alt } or { kind: "emoji", value } — never a
// bare string anymore (MOCKUP-LITERAL PASS), so a consumer can render an
// <img> for a literal mockup crop and a plain glyph for everything else.
export function resolveContentIcon(row) {
  const title = row?.title || "";
  const rule = KEYWORD_ICON_RULES.find((r) => r.pattern.test(title));
  if (rule) return rule.icon;
  const typeIcon = ITEM_TYPE_META[row?.type]?.icon;
  return typeIcon ? emoji(typeIcon) : null;
}
