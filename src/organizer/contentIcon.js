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
 * Used only by FullCardRow (Today's prominent cards + the overflow modal,
 * which intentionally keeps the same rich, full-detail treatment regardless
 * of which day the item came from). FutureRow never calls this — future-day
 * cards stay deliberately icon-free by construction, not by this resolver
 * ever returning an empty icon for them.
 */
import { ITEM_TYPE_META } from "../data/itemTypes.js";

const KEYWORD_ICON_RULES = [
  { pattern: /pajama|stuffy|stuffie|stuffed animal/i, icon: "🧸" },
  { pattern: /back.?to.?school/i, icon: "🏫" },
  { pattern: /gold folder|\bfolder\b/i, icon: "📁" },
  { pattern: /sign(ature)?|permission slip/i, icon: "✍️" },
  { pattern: /geography|\bglobe\b|\bmap\b/i, icon: "🌍" },
  { pattern: /reading|phonics|spelling|vocabulary/i, icon: "📖" },
  { pattern: /study guide|\bstudy\b/i, icon: "📚" },
  { pattern: /healthy snack|\bsnack\b|\blunch\b/i, icon: "🍎" },
  { pattern: /\bmath\b|worksheet/i, icon: "🔢" },
  { pattern: /\bbike\b|bicycle/i, icon: "🚲" },
  { pattern: /\bmovie\b|film night/i, icon: "🍿" },
  { pattern: /grocery|shopping/i, icon: "🛒" },
  { pattern: /game night|board game/i, icon: "🎲" },
];

export function resolveContentIcon(row) {
  const title = row?.title || "";
  const rule = KEYWORD_ICON_RULES.find((r) => r.pattern.test(title));
  if (rule) return rule.icon;
  return ITEM_TYPE_META[row?.type]?.icon || "";
}
