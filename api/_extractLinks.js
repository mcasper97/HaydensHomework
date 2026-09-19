/* ============================== Qualifying link extraction ==============================
 * Pure HTML link extraction/classification for an email body (#26,
 * Commit 5). No network calls — this only decides WHICH links are worth
 * fetching; api/_urlSafety.js's safeFetch does the actual (SSRF-safe)
 * fetching, elsewhere. Deliberately regex-based, same approach as
 * api/_htmlToText.js, for the same reason: no HTML-parsing dependency is
 * installed and this is simple enough not to need one.
 */

const MAX_QUALIFYING_LINKS = 5;

// A best-effort, non-exhaustive keyword denylist for "obvious junk" —
// unsubscribe/preference-center/legal boilerplate links that are never
// meaningful obligation content. Matched against the full URL
// (case-insensitive). Not a general spam/ad classifier.
const JUNK_KEYWORDS = [
  "unsubscribe",
  "opt-out",
  "optout",
  "email-preferences",
  "emailpreferences",
  "manage-subscription",
  "managesubscription",
  "preference-center",
  "preferencecenter",
  "privacy-policy",
  "privacypolicy",
  "terms-of-service",
  "termsofservice",
  "view-in-browser",
  "viewinbrowser",
];

const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

function isJunkLink(url) {
  const lower = url.toLowerCase();
  return JUNK_KEYWORDS.some((kw) => lower.includes(kw));
}

function isGoogleDocLink(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === "docs.google.com" && pathname.startsWith("/document/");
  } catch {
    return false;
  }
}

function classify(rawUrl, { seen, results }) {
  if (results.length >= MAX_QUALIFYING_LINKS) return;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return; // relative/malformed href — nothing to resolve it against in an email
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const normalized = url.toString();
  if (seen.has(normalized)) return;
  // Deliberately keyword-based on the URL's path/query only (see
  // JUNK_KEYWORDS above) — NEVER a hostname denylist. A legitimate
  // content link sent through a school newsletter platform's own
  // click-tracking/redirect domain (e.g. "click.schoolmessenger.com",
  // "trk.icontact.com") is exactly the kind of real, meaningful link this
  // feature exists to surface — it must stay eligible. safeFetch already
  // follows and re-validates every redirect hop, so where the link
  // actually leads is what gets checked, not what its hostname looks like.
  if (isJunkLink(normalized)) return;

  seen.add(normalized);
  results.push({ url: normalized, type: isGoogleDocLink(normalized) ? "google_doc" : "webpage" });
}

/**
 * extractQualifyingLinks(html) -> [{ url, type: "webpage" | "google_doc" }]
 * At most MAX_QUALIFYING_LINKS entries, in document order, deduped,
 * junk-filtered, absolute http(s) URLs only. Used when the email has an
 * HTML body (the common case) — <a href> is a far more reliable link
 * source than scanning HTML text for bare URLs.
 */
export function extractQualifyingLinks(html) {
  if (typeof html !== "string" || html.length === 0) return [];
  const seen = new Set();
  const results = [];
  for (const match of html.matchAll(HREF_RE)) {
    if (results.length >= MAX_QUALIFYING_LINKS) break;
    classify(match[1], { seen, results });
  }
  return results;
}

// Matches a bare http(s) URL in plain text, stopping at whitespace or a
// character that's almost always trailing punctuation/wrapping rather than
// part of the URL itself (closing paren/quote, or a sentence-ending mark).
const BARE_URL_RE = /https?:\/\/[^\s<>"')]+/gi;

/**
 * extractLinksFromPlainText(text) -> [{ url, type }] — same shape, same
 * cap/dedupe/junk-filtering as extractQualifyingLinks, for the
 * plain-text-only email case (no HTML body at all, so there's no <a href>
 * to read — see api/gmail-check-email.js, which only calls this when
 * decoded.htmlBody is empty).
 */
export function extractLinksFromPlainText(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const seen = new Set();
  const results = [];
  for (const match of text.matchAll(BARE_URL_RE)) {
    if (results.length >= MAX_QUALIFYING_LINKS) break;
    // Strip common trailing punctuation a URL is often followed by in
    // prose (". ", ", ", "! ", etc.) that the regex otherwise swallows.
    const cleaned = match[0].replace(/[.,;:!?]+$/, "");
    classify(cleaned, { seen, results });
  }
  return results;
}
