/* ============================== Gmail ingestion — core scan (server-only) ==============================
 * The shared "find new qualifying emails from approved senders and extract
 * obligations from them" pipeline. Extracted out of api/gmail-check-email.js
 * — MOVED, not copied: that endpoint is now a thin HTTP wrapper around
 * scanApprovedSenderEmails below, and the automatic scheduled-ingestion
 * runner (api/_gmailIngestionRunner.js) is the second caller. Neither
 * caller reimplements Gmail auth/token handling, approved-sender
 * filtering, sender->child mapping, link discovery, webpage/Google-Doc
 * fetching, or obligation extraction — every one of those stays owned by
 * its own existing module, imported here unchanged, exactly as
 * api/gmail-check-email.js always imported them.
 *
 * This module does NOT create any SourceRecord/IngestionCandidate itself —
 * same division of responsibility this pipeline has always had. Each
 * caller decides what to do with `results`: the manual endpoint returns it
 * to the browser for client-side persistence (unchanged); the scheduled
 * runner persists it server-side (see api/_gmailIngestionRunner.js).
 *
 * `deps` lets a caller override any collaborator (used by this file's own
 * tests) — mirrors the {deps={}} injectable-dependency pattern already
 * established throughout this app's server-side ingestion code (see
 * api/_scheduledIngestionRunner.js's runDueHouseholds). The DEFAULT wiring
 * is exactly what api/gmail-check-email.js has always called.
 */
import Anthropic from "@anthropic-ai/sdk";
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

const defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// How far back email checking looks. Exported (pure, no I/O) so this exact
// windowing logic can be unit tested — unchanged from api/gmail-check-email.js.
export const LOOKBACK_DAYS = 14;

export function computeLookbackSinceIso(days = LOOKBACK_DAYS, nowMs = Date.now()) {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

// Keeps a single email's prompt content bounded — unchanged from
// api/gmail-check-email.js.
const MAX_EMAIL_BODY_LENGTH = 20_000;
const MAX_PAGE_TEXT_LENGTH = 20_000;

// Controlled, distinguishable failure codes a scan can return instead of
// `results` — the caller (HTTP handler or scheduled runner) maps each to
// its own status/behavior (see api/gmail-check-email.js and
// api/_gmailIngestionRunner.js).
export const SCAN_ERROR_CODES = {
  NOT_CONNECTED: "GMAIL_NOT_CONNECTED",
  NO_SENDERS: "GMAIL_NO_SENDERS",
  RECONNECT_REQUIRED: "GMAIL_RECONNECT_REQUIRED",
  UNREACHABLE: "GMAIL_UNREACHABLE",
};

/**
 * scanApprovedSenderEmails(uid, deps?) ->
 *   { ok:true, connectedEmail, senderCount, lookbackDays, sinceIso,
 *     matchedCount, results } | { ok:false, code, error, needsReconnect? }
 *
 * `results` has the exact same per-email shape api/gmail-check-email.js's
 * HTTP response has always returned. `matchedCount` is additive (not part
 * of the manual endpoint's HTTP response — see that file) — the total
 * number of new, not-yet-processed Gmail messages this scan found, before
 * any per-message fetch/decode failure; a message that could not be
 * fetched/decoded is silently skipped (never added to `results`, same
 * "naturally retried next run" behavior this pipeline has always had) —
 * `matchedCount - results.length` is how many were skipped that way. The
 * scheduled runner uses this to report messagesSkipped.
 */
export async function scanApprovedSenderEmails(uid, deps = {}) {
  const {
    client = defaultClient,
    getConnection = getGmailConnection,
    markNeedsReconnect = markGmailConnectionNeedsReconnect,
    getSenders = listApprovedSenders,
    getProcessedIds = listProcessedGmailMessageIds,
    refreshAccessTokenFn = refreshAccessToken,
    listMessageIds = listGmailMessageIds,
    getMessage = getGmailMessage,
    decodeMessage = decodeGmailMessage,
    extractLinks = extractQualifyingLinks,
    extractPlainTextLinks = extractLinksFromPlainText,
    fetchWebpage = safeFetch,
    toReadableText = htmlToReadableText,
    getPageTitle = extractPageTitle,
    fetchGoogleDoc = fetchGoogleDocText,
    extractObligations = extractObligationsFromEmail,
    now = new Date(),
  } = deps;

  const connection = await getConnection(uid);
  if (!connection?.refreshToken) {
    return { ok: false, code: SCAN_ERROR_CODES.NOT_CONNECTED, error: "Gmail is not connected yet." };
  }

  const senders = await getSenders(uid);
  if (senders.length === 0) {
    return { ok: false, code: SCAN_ERROR_CODES.NO_SENDERS, error: "Add at least one approved sender first." };
  }
  const senderByEmail = new Map(senders.map((s) => [s.email, s]));

  let accessToken;
  try {
    const tokens = await refreshAccessTokenFn(connection.refreshToken);
    accessToken = tokens.access_token;
  } catch (err) {
    if (err?.isInvalidGrant) {
      await markNeedsReconnect(uid).catch(() => {});
      return { ok: false, code: SCAN_ERROR_CODES.RECONNECT_REQUIRED, error: "Gmail needs to be reconnected.", needsReconnect: true };
    }
    console.error("gmailIngestionCore: access token refresh failed:", err);
    return { ok: false, code: SCAN_ERROR_CODES.UNREACHABLE, error: "Could not reach Gmail. Please try again." };
  }

  const sinceDate = new Date(computeLookbackSinceIso(LOOKBACK_DAYS, now.getTime()));
  const query = buildGmailSearchQuery(Array.from(senderByEmail.keys()), sinceDate);

  const matches = await listMessageIds({ accessToken, query });
  const processedIds = await getProcessedIds(uid);
  const newMatches = matches.filter((m) => m?.id && !processedIds.has(m.id));

  const results = [];

  for (const match of newMatches) {
    let decoded;
    try {
      const raw = await getMessage({ accessToken, messageId: match.id });
      decoded = decodeMessage(raw);
    } catch (err) {
      // Not enough information to create a meaningful SourceRecord — skip
      // it. It was never marked processed, so it's naturally retried on
      // the next run (manual click or scheduled tick alike).
      console.error("gmailIngestionCore: could not fetch/decode message", match.id, err);
      continue;
    }

    const sender = senderByEmail.get(decoded.senderEmail);
    if (!sender) {
      // Defensive only — the Gmail search query itself was already scoped
      // to exactly the approved senders, so this should never actually
      // happen.
      continue;
    }

    const emailBodyText = decoded.textBody
      ? decoded.textBody.slice(0, MAX_EMAIL_BODY_LENGTH)
      : decoded.htmlBody
      ? toReadableText(decoded.htmlBody, { maxLength: MAX_EMAIL_BODY_LENGTH })
      : "";

    const qualifyingLinks = decoded.htmlBody
      ? extractLinks(decoded.htmlBody)
      : extractPlainTextLinks(decoded.textBody);
    const webpageLinks = qualifyingLinks.filter((l) => l.type === "webpage");
    const googleDocLinks = qualifyingLinks.filter((l) => l.type === "google_doc");

    const webpagePages = [];
    const pages = [];
    for (const link of webpageLinks) {
      try {
        const fetchResult = await fetchWebpage(link.url);
        if (fetchResult.ok) {
          const rawHtml = fetchResult.body.toString("utf8");
          pages.push({ url: link.url, text: toReadableText(rawHtml, { maxLength: MAX_PAGE_TEXT_LENGTH }) });
          webpagePages.push({ url: link.url, type: "webpage", fetched: true, title: getPageTitle(rawHtml) });
        } else {
          webpagePages.push({ url: link.url, type: "webpage", fetched: false });
        }
      } catch (err) {
        console.error("gmailIngestionCore: webpage fetch failed", link.url, err);
        webpagePages.push({ url: link.url, type: "webpage", fetched: false });
      }
    }

    for (const link of googleDocLinks) {
      try {
        const fetchResult = await fetchGoogleDoc(link.url);
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
        console.error("gmailIngestionCore: google doc fetch failed", link.url, err);
        webpagePages.push({ url: link.url, type: "google_doc", fetched: false, documentId: null, failureReason: "fetch_failed" });
      }
    }

    let obligations = [];
    let extractionFailed = false;
    try {
      const extraction = await extractObligations({
        client,
        senderEmail: decoded.senderEmail,
        subject: decoded.subject,
        receivedAt: decoded.receivedAt,
        emailBodyText,
        pages,
      });
      obligations = extraction.obligations;
    } catch (err) {
      console.error("gmailIngestionCore: extraction failed", {
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

  return {
    ok: true,
    connectedEmail: connection.emailAddress || null,
    senderCount: senders.length,
    lookbackDays: LOOKBACK_DAYS,
    sinceIso: sinceDate.toISOString(),
    matchedCount: newMatches.length,
    results,
  };
}
