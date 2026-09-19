/* ============================== Gmail — Check Email ==============================
 * Manual, parent-triggered action (#26, Commit 5; Google Doc retrieval
 * added in Commit 6). For each approved sender, finds Gmail messages from
 * the last LOOKBACK_DAYS days not already processed (deduped by Gmail's
 * own message id), reads the body, extracts qualifying links, safely
 * fetches ordinary webpages and public Google Docs those links point to,
 * and asks the model to extract obligations from the email body plus
 * whatever linked text was retrieved.
 *
 * This endpoint does the entire pipeline server-side because every step
 * before extraction needs a secret this server alone holds (the Gmail
 * refresh token) or a capability only the server has (SSRF-safe
 * fetching). It still ends exactly where api/extract-obligations.js does:
 * validated, sanitized extraction results, one entry per qualifying
 * email. It does NOT create any SourceRecord or IngestionCandidate itself
 * — that write, and the mandatory parent review before anything becomes a
 * canonical Item, both stay entirely client-side (see src/AuthShell.jsx),
 * mirroring the existing photo-ingestion flow, extended with a second
 * provenance tier (see `webpagePages` below): the client creates one
 * "gmail_email" SourceRecord per qualifying email and one "webpage" or
 * "google_doc" SourceRecord per qualifying link (fetched or not,
 * distinguished by webpagePages[].type), and attributes each extracted
 * obligation to whichever one it actually came from via
 * `obligations[].sourceUrl` (see api/_emailExtraction.js).
 *
 * MIME/body handling: text/plain is used as-is for the extraction
 * prompt's email body whenever the message has one (no conversion
 * needed); HTML is converted via htmlToReadableText only when there's no
 * text/plain part at all. Link discovery is independent of that choice —
 * <a href> in the HTML body is used whenever HTML exists (even if
 * text/plain is what's used for the prompt), and only a plain-text-only
 * email falls back to scanning for bare http(s) URLs.
 *
 * Untrusted-content boundary: email, webpage, and Google Doc text is
 * passed to the model only as inert text content, never as instructions;
 * the model has no tool access, no OAuth credentials, and cannot fetch
 * anything itself (see api/_emailExtraction.js). Every field it returns
 * is enum/length validated by sanitizeObligationsResponse before this
 * endpoint will return it to the client at all.
 *
 * Scope: 14-day lookback, exact approved senders only, normal webpages,
 * and docs.google.com/document/... Google Docs retrieved only via their
 * anonymous public export (see api/_googleDocFetch.js) — no Drive OAuth,
 * no Sheets/Slides/Drive-folder support, no attachments, no
 * cron/background polling, no automatic Item creation.
 */
import Anthropic from "@anthropic-ai/sdk";
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { getGmailConnection, markGmailConnectionNeedsReconnect } from "./_gmailConnectionsStore.js";
import { listApprovedSenders } from "./_gmailApprovedSendersStore.js";
import { listProcessedGmailMessageIds } from "./_sourceRecordsStore.js";
import { refreshAccessToken } from "./_googleOAuth.js";
import { buildGmailSearchQuery, listGmailMessageIds, getGmailMessage } from "./_gmailMessages.js";
import { decodeGmailMessage } from "./_gmailMime.js";
import { extractQualifyingLinks, extractLinksFromPlainText } from "./_extractLinks.js";
import { safeFetch } from "./_urlSafety.js";
import { htmlToReadableText, extractPageTitle } from "./_htmlToText.js";
import { fetchGoogleDocText } from "./_googleDocFetch.js";
import { extractObligationsFromEmail } from "./_emailExtraction.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// How far back email checking looks. Exported (pure, no I/O) so this exact
// windowing logic can be unit tested.
export const LOOKBACK_DAYS = 14;

export function computeLookbackSinceIso(days = LOOKBACK_DAYS, nowMs = Date.now()) {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

// Keeps a single email's prompt content bounded — an unusually large
// email or webpage never blows up the extraction call's size.
const MAX_EMAIL_BODY_LENGTH = 20_000;
const MAX_PAGE_TEXT_LENGTH = 20_000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let uid;
  try {
    ({ uid } = await requireFirebaseUser(req));
  } catch {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  if (!checkRateLimit(uid)) {
    return res.status(429).json({ ok: false, error: "Too many requests — please wait a few minutes and try again." });
  }

  try {
    const connection = await getGmailConnection(uid);
    if (!connection?.refreshToken) {
      return res.status(409).json({ ok: false, error: "Gmail is not connected yet." });
    }

    const senders = await listApprovedSenders(uid);
    if (senders.length === 0) {
      return res.status(409).json({ ok: false, error: "Add at least one approved sender first." });
    }
    const senderByEmail = new Map(senders.map((s) => [s.email, s]));

    let accessToken;
    try {
      const tokens = await refreshAccessToken(connection.refreshToken);
      accessToken = tokens.access_token;
    } catch (err) {
      if (err?.isInvalidGrant) {
        await markGmailConnectionNeedsReconnect(uid).catch(() => {});
        return res.status(409).json({ ok: false, error: "Gmail needs to be reconnected.", needsReconnect: true });
      }
      console.error("gmail-check-email: access token refresh failed:", err);
      return res.status(502).json({ ok: false, error: "Could not reach Gmail. Please try again." });
    }

    const sinceDate = new Date(computeLookbackSinceIso());
    const query = buildGmailSearchQuery(Array.from(senderByEmail.keys()), sinceDate);

    const matches = await listGmailMessageIds({ accessToken, query });
    const processedIds = await listProcessedGmailMessageIds(uid);
    const newMatches = matches.filter((m) => m?.id && !processedIds.has(m.id));

    const results = [];

    for (const match of newMatches) {
      let decoded;
      try {
        const raw = await getGmailMessage({ accessToken, messageId: match.id });
        decoded = decodeGmailMessage(raw);
      } catch (err) {
        // Not enough information to create a meaningful SourceRecord — skip
        // it. It was never marked processed, so it's naturally retried on
        // the next Check Email click.
        console.error("gmail-check-email: could not fetch/decode message", match.id, err);
        continue;
      }

      const sender = senderByEmail.get(decoded.senderEmail);
      if (!sender) {
        // Defensive only — the Gmail search query itself was already
        // scoped to exactly the approved senders, so this should never
        // actually happen.
        continue;
      }

      // Body text used as the email's own extraction context: text/plain
      // is preferred as-is (it's already readable, no conversion needed)
      // whenever the message has one; HTML is only converted to text
      // (via htmlToReadableText) when there is no text/plain part at all.
      // Exactly one of these is ever used — never both, so the email body
      // is never duplicated into the prompt.
      const emailBodyText = decoded.textBody
        ? decoded.textBody.slice(0, MAX_EMAIL_BODY_LENGTH)
        : decoded.htmlBody
        ? htmlToReadableText(decoded.htmlBody, { maxLength: MAX_EMAIL_BODY_LENGTH })
        : "";

      // Link discovery is independent of which body text is used above:
      // <a href> in the HTML body is the richer, more reliable source
      // whenever HTML exists (even if text/plain is what's used for the
      // prompt); bare http(s)://... URLs are scanned from the plain-text
      // body only when there's no HTML at all to read hrefs from.
      const qualifyingLinks = decoded.htmlBody
        ? extractQualifyingLinks(decoded.htmlBody)
        : extractLinksFromPlainText(decoded.textBody);
      const webpageLinks = qualifyingLinks.filter((l) => l.type === "webpage");
      const googleDocLinks = qualifyingLinks.filter((l) => l.type === "google_doc");

      // One entry per qualifying link (webpage OR google_doc), fetched or
      // not — this is what the client uses to create a "webpage" or
      // "google_doc" SourceRecord per link (see src/AuthShell.jsx),
      // including a "failed" one for a legitimate link that could not be
      // safely/successfully retrieved. `pages` (text content) only ever
      // holds the ones that succeeded — that's what actually goes into the
      // extraction prompt. Both link types feed the exact same `pages`
      // array/prompt mechanism — the model doesn't need to know or care
      // whether a given page's text came from an ordinary webpage fetch or
      // a Google Doc export; only the client-side SourceRecord it's later
      // attributed to differs by `type`.
      const webpagePages = [];
      const pages = [];
      for (const link of webpageLinks) {
        try {
          const fetchResult = await safeFetch(link.url);
          if (fetchResult.ok) {
            const rawHtml = fetchResult.body.toString("utf8");
            pages.push({ url: link.url, text: htmlToReadableText(rawHtml, { maxLength: MAX_PAGE_TEXT_LENGTH }) });
            // Cosmetic only (the review UI's compact source context) —
            // never used for extraction or anything else.
            webpagePages.push({ url: link.url, type: "webpage", fetched: true, title: extractPageTitle(rawHtml) });
          } else {
            webpagePages.push({ url: link.url, type: "webpage", fetched: false });
          }
        } catch (err) {
          console.error("gmail-check-email: webpage fetch failed", link.url, err);
          webpagePages.push({ url: link.url, type: "webpage", fetched: false });
        }
      }

      // Google Docs (#26, Commit 6): anonymous public-export retrieval
      // only — see api/_googleDocFetch.js. No Drive OAuth, no workaround
      // attempted when a doc requires access; that outcome is recorded
      // (failureReason) for the client to turn into a failed SourceRecord
      // and a concise parent-facing message, never silently dropped.
      for (const link of googleDocLinks) {
        try {
          const fetchResult = await fetchGoogleDocText(link.url);
          if (fetchResult.status === "success") {
            pages.push({ url: link.url, text: fetchResult.text.slice(0, MAX_PAGE_TEXT_LENGTH) });
            webpagePages.push({ url: link.url, type: "google_doc", fetched: true, documentId: fetchResult.docId });
          } else {
            webpagePages.push({
              url: link.url,
              type: "google_doc",
              fetched: false,
              documentId: fetchResult.docId,
              failureReason: fetchResult.status === "requires_authentication" ? "requires_authentication" : "fetch_failed",
            });
          }
        } catch (err) {
          console.error("gmail-check-email: google doc fetch failed", link.url, err);
          webpagePages.push({ url: link.url, type: "google_doc", fetched: false, documentId: null, failureReason: "fetch_failed" });
        }
      }

      let obligations = [];
      let extractionFailed = false;
      try {
        const extraction = await extractObligationsFromEmail({
          client,
          senderEmail: decoded.senderEmail,
          subject: decoded.subject,
          receivedAt: decoded.receivedAt,
          emailBodyText,
          pages,
        });
        obligations = extraction.obligations;
      } catch (err) {
        // Structured, content-free logging only — a controlled failure
        // code (see api/_emailExtraction.js's ExtractionError) plus the
        // Gmail message id and stop_reason when available. Deliberately
        // never logs the raw error object, the built prompt, the email
        // body, or any linked/Google-Doc text — none of those are read
        // here at all.
        console.error("gmail-check-email: extraction failed", {
          gmailMessageId: decoded.gmailMessageId,
          code: err?.code || err?.name || "unknown_error",
          stopReason: err?.stopReason ?? null,
          message: err?.message || null,
        });
        extractionFailed = true;
      }

      results.push({
        gmailMessageId: decoded.gmailMessageId,
        gmailThreadId: decoded.gmailThreadId,
        senderEmail: decoded.senderEmail,
        senderName: decoded.senderName,
        subject: decoded.subject,
        receivedAt: decoded.receivedAt,
        targetType: sender.targetType,
        targetChildId: sender.childId,
        linkedUrls: qualifyingLinks.map((l) => l.url),
        webpagePages,
        obligations,
        extractionFailed,
      });
    }

    return res.status(200).json({
      ok: true,
      connectedEmail: connection.emailAddress || null,
      senderCount: senders.length,
      lookbackDays: LOOKBACK_DAYS,
      sinceIso: sinceDate.toISOString(),
      results,
    });
  } catch (err) {
    console.error("gmail-check-email error:", err);
    return res.status(500).json({ ok: false, error: "Could not check email. Please try again." });
  }
}
