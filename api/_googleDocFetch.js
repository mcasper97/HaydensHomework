/* ============================== Google Doc public-export retrieval ==============================
 * Anonymous, no-OAuth retrieval of a Google Doc's readable text via its
 * public plain-text export endpoint (#26, Commit 6). Scope: only
 * docs.google.com/document/... links — Sheets, Slides, and Drive files
 * are never classified as "google_doc" in the first place (see
 * api/_extractLinks.js's isGoogleDocLink), so this module never sees them.
 *
 * No Drive OAuth, no service account, no Google account credentials of
 * any kind — this only ever attempts the same anonymous request a logged
 * -out browser tab could make, and reuses api/_urlSafety.js's SSRF-safe
 * safeFetch (SSRF protection, no cookies/headers sendable, existing
 * timeout/size caps) rather than a new fetch path.
 */
import { safeFetch } from "./_urlSafety.js";

const DOC_ID_RE = /^\/document\/d\/([a-zA-Z0-9_-]+)/;

/**
 * Extracts a Google Doc's document id from a docs.google.com/document/...
 * URL. Returns null for anything else — a Sheets/Slides/Drive URL, a
 * malformed URL, or a /document/ URL missing an id segment — never
 * guesses or falls back to a partial match.
 */
export function extractGoogleDocId(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "docs.google.com") return null;
  const match = DOC_ID_RE.exec(parsed.pathname);
  return match ? match[1] : null;
}

/** The simplest supported public-link export method: anonymous plain text. */
export function buildGoogleDocExportUrl(docId) {
  return `https://docs.google.com/document/d/${docId}/export?format=txt`;
}

// A page's hostname alone doesn't tell us whether Google served the doc's
// text or a sign-in wall — Google may legitimately serve a valid export
// through a different content host after redirecting. Detected instead by
// what the page actually says. Deliberately narrow: only the specific,
// well-known signals Google's own sign-in/access-request pages use, not a
// hostname allowlist and not a generic "contains the word Google" guess.
const GOOGLE_AUTH_PAGE_SIGNALS = [
  "accounts.google.com/servicelogin",
  "accounts.google.com/signin",
  "accounts.google.com/v3/signin",
  "sign in - google accounts",
  "you need permission",
  "request access",
  "sign in to continue",
];

function looksLikeGoogleAuthPage(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  const lower = text.toLowerCase();
  return GOOGLE_AUTH_PAGE_SIGNALS.some((signal) => lower.includes(signal));
}

/**
 * fetchGoogleDocText(url, { fetchFn?, lookupFn? }) -> one of:
 *   { status: "success", docId, text }
 *   { status: "requires_authentication", docId }
 *   { status: "failed", docId, reason }
 *
 * `docId` is null in the returned object only when the URL itself couldn't
 * be parsed as a Google Doc link at all (status is always "failed" in
 * that case). `fetchFn`/`lookupFn` are forwarded to safeFetch for the same
 * injectable-for-testing reason every other fetch in this app uses.
 *
 * Classification is by response BEHAVIOR, never by hostname allowlist
 * (safeFetch has already SSRF-validated every redirect hop, so where the
 * final response actually came from is not itself a signal of anything):
 *   - success: the response is ok and its content-type is text/plain —
 *     accepted regardless of the final hostname (Google may legitimately
 *     serve the export from a different Google content host after
 *     redirecting).
 *   - requires_authentication: an outright 401/403; a final destination
 *     hostname of accounts.google.com (Google's own sign-in domain,
 *     checked as the one specific, well-known exception where hostname
 *     genuinely is the signal); or a non-text/plain response whose body
 *     clearly reads as a Google sign-in/access-required page.
 *   - failed: any other non-ok response, an unexpected non-text response
 *     that isn't clearly an auth/access page, or a network/DNS/timeout
 *     error. No workaround is ever attempted for any outcome above
 *     "success" — the caller records it as a failed SourceRecord and
 *     moves on.
 */
export async function fetchGoogleDocText(url, { fetchFn, lookupFn } = {}) {
  const docId = extractGoogleDocId(url);
  if (!docId) {
    return { status: "failed", docId: null, reason: "invalid_doc_url" };
  }

  const exportUrl = buildGoogleDocExportUrl(docId);
  const result = await safeFetch(exportUrl, { fetchFn, lookupFn });

  if (!result.ok) {
    if (result.reason === "http_401" || result.reason === "http_403") {
      return { status: "requires_authentication", docId };
    }
    return { status: "failed", docId, reason: result.reason };
  }

  const contentType = (result.contentType || "").toLowerCase();
  if (contentType.includes("text/plain")) {
    return { status: "success", docId, text: result.body.toString("utf8") };
  }

  let finalHostname = "";
  try {
    finalHostname = new URL(result.url).hostname;
  } catch {
    // Unreachable in practice — safeFetch only ever returns a URL it
    // itself parsed successfully — but fails closed rather than throwing.
  }
  const bodyText = result.body.toString("utf8");
  if (finalHostname === "accounts.google.com" || looksLikeGoogleAuthPage(bodyText)) {
    return { status: "requires_authentication", docId };
  }

  return { status: "failed", docId, reason: "unexpected_response" };
}
