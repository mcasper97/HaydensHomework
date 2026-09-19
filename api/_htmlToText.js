/* ============================== HTML → readable text ==============================
 * Server-side-only helper that turns raw HTML (an email-linked webpage, a
 * Google Doc export) into plain, readable text suitable for passing to an
 * obligation-extraction prompt. Deliberately built on plain regex/string
 * processing only — no new npm dependency (see the dependency inspection
 * that preceded this file: no HTML-parsing library, e.g. cheerio/jsdom/
 * html-to-text/parse5/linkedom, is currently installed, and this app's
 * scale doesn't justify adding one for what is fundamentally tag-stripping
 * plus whitespace normalization).
 *
 * This module knows nothing about where the HTML came from — no Gmail,
 * SourceRecord, Anthropic, child, assignment, or Item knowledge. It is a
 * pure function: HTML string in, plain text out.
 *
 * Explicitly NOT done here (by design, not oversight):
 *   - No JS execution, no following of any URL/resource the HTML
 *     references, no interpretation of any content as instructions — this
 *     is text extraction only.
 *   - No "main content" / article-extraction heuristics (readability-style
 *     boilerplate scoring). Only script/style/noscript content is removed
 *     entirely, and nav/header/footer are stripped where structurally
 *     identifiable — everything else's visible text is preserved.
 *
 * Known limitation: nav/header/footer stripping is a regex match on
 * <tag>...</tag>, which does not understand nesting. A <nav> containing
 * another <nav> (unusual, but possible in malformed HTML) will only have
 * its innermost match removed correctly; the outer tag's boundary can end
 * up in the wrong place. Accepted for this first slice — worst case is a
 * little extra/missing boilerplate text, never a crash or unsafe content.
 */

const REMOVE_ENTIRELY_TAGS = ["script", "style", "noscript"];
const REMOVE_BOILERPLATE_TAGS = ["nav", "header", "footer"];

// Tags whose open/close boundaries become a paragraph-style break.
const BLOCK_BREAK_TAGS = [
  "p",
  "div",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "tr",
  "table",
  "ul",
  "ol",
  "blockquote",
  "section",
  "article",
];

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function stripTagWithContent(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}\\s*>`, "gi");
  return html.replace(re, " ");
}

function breakOnTagBoundaries(html, tagName) {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const closeRe = new RegExp(`<\\/${tagName}\\s*>`, "gi");
  return html.replace(openRe, "\n").replace(closeRe, "\n");
}

function decodeEntities(text) {
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()] ?? "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return "";
      }
    });
}

function collapseWhitespace(text) {
  let out = text.replace(/[ \t]+/g, " ");
  out = out
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/**
 * htmlToReadableText(html, options?) -> string
 *
 * options.maxLength (optional) — if given, the returned text is truncated
 * to at most this many characters. No cap is applied by default.
 */
export function htmlToReadableText(html, options = {}) {
  if (typeof html !== "string" || html.length === 0) return "";

  const { maxLength } = options;

  let text = html;

  // HTML comments can carry hidden text (tracking, old content, or — in an
  // adversarial input — an attempted instruction). They're never part of a
  // page's visible/readable content, so drop them before anything else.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  for (const tag of REMOVE_ENTIRELY_TAGS) {
    text = stripTagWithContent(text, tag);
  }
  for (const tag of REMOVE_BOILERPLATE_TAGS) {
    text = stripTagWithContent(text, tag);
  }

  // <br> (and the self-closing/variant forms) become explicit line breaks.
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Table cells: separate adjacent cell text with a space so cell content
  // is never accidentally concatenated together, without breaking a whole
  // row onto multiple lines (the row itself breaks via BLOCK_BREAK_TAGS's
  // "tr" entry).
  text = text.replace(/<\/?t[dh]\b[^>]*>/gi, " ");

  for (const tag of BLOCK_BREAK_TAGS) {
    text = breakOnTagBoundaries(text, tag);
  }

  // Strip every remaining tag, keeping only text content.
  text = text.replace(/<[^>]+>/g, "");

  text = decodeEntities(text);
  text = collapseWhitespace(text);

  if (typeof maxLength === "number" && maxLength >= 0 && text.length > maxLength) {
    text = text.slice(0, maxLength);
  }

  return text;
}

/**
 * extractPageTitle(html) -> string | null
 *
 * Reads a page's <title> content, for the review UI's compact source
 * context (#26, Commit 5 live-validation fix — "Teacher webpage: <page
 * title if available, otherwise hostname>"). Purely cosmetic, read-only
 * display text: never used for anything else, and — like the rest of this
 * module — never executes anything or follows any reference the HTML
 * contains. Returns null when there's no non-empty <title>, so the caller
 * can fall back to the page's hostname.
 */
export function extractPageTitle(html) {
  if (typeof html !== "string" || html.length === 0) return null;
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = collapseWhitespace(decodeEntities(match[1]));
  return title.length > 0 ? title : null;
}
