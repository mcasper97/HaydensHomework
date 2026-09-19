/* ============================== Compact source context for email review ==============================
 * Pure display-shaping for CandidateReviewModal's "Source" section (#26,
 * Commit 5 live-validation fix). No JSX/React — same testability
 * rationale as candidateToDraftItem.js — and no network/Firestore access
 * of its own: CandidateReviewModal.jsx fetches the SourceRecord(s) via
 * the existing sourceRecordsRepository.js and hands the plain data here.
 *
 * Read-only review context only. Never writes anything, never touches the
 * canonical Item, and never introduces a second place source provenance
 * is stored — it only reads what api/gmail-check-email.js and
 * src/AuthShell.jsx already persist onto SourceRecord.metadata.
 */

function formatSenderLine({ senderName, senderEmail }) {
  if (!senderEmail) return null;
  return senderName ? `${senderName} <${senderEmail}>` : senderEmail;
}

function formatReceivedDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function hostnameOf(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * buildSourceContext(sourceRecord, parentEmailSourceRecord?) ->
 *   { kind: "email", senderLine, subject, receivedDate } |
 *   { kind: "webpage", pageTitle, senderLine, subject } |
 *   { kind: "google_doc", pageTitle, senderLine, subject } |
 *   null
 *
 * `parentEmailSourceRecord` is only used (and only needed) when
 * `sourceRecord.sourceType` is "webpage" or "google_doc" — the
 * originating email's SourceRecord, resolved via
 * sourceRecord.metadata.parentEmailSourceRecordId.
 *
 * Returns null for any other sourceType (image_capture, csv_import,
 * legacy_family_event, manual, or a malformed/missing record) — a
 * photo/CSV-sourced candidate has no source context to show, so
 * CandidateReviewModal renders nothing in that case, unchanged from
 * before this fix.
 */
export function buildSourceContext(sourceRecord, parentEmailSourceRecord) {
  if (!sourceRecord) return null;

  if (sourceRecord.sourceType === "gmail_email") {
    const meta = sourceRecord.metadata || {};
    return {
      kind: "email",
      senderLine: formatSenderLine({ senderName: meta.senderName, senderEmail: meta.senderEmail }),
      subject: meta.subject || null,
      receivedDate: formatReceivedDate(meta.receivedAt),
    };
  }

  if (sourceRecord.sourceType === "webpage") {
    const meta = sourceRecord.metadata || {};
    const parentMeta = parentEmailSourceRecord?.metadata || {};
    return {
      kind: "webpage",
      pageTitle: sourceRecord.title || hostnameOf(meta.sourceUrl),
      senderLine: formatSenderLine({ senderName: parentMeta.senderName, senderEmail: parentMeta.senderEmail }),
      subject: parentMeta.subject || null,
    };
  }

  if (sourceRecord.sourceType === "google_doc") {
    // Google Docs never carry a fetched <title> (#26, Commit 6 — deliberately
    // not fetched, to avoid extra API complexity for a cosmetic detail; see
    // api/_googleDocFetch.js). Falls back to the URL's hostname
    // ("docs.google.com"), then a plain "Google Doc" label.
    const meta = sourceRecord.metadata || {};
    const parentMeta = parentEmailSourceRecord?.metadata || {};
    return {
      kind: "google_doc",
      pageTitle: sourceRecord.title || hostnameOf(meta.sourceUrl) || "Google Doc",
      senderLine: formatSenderLine({ senderName: parentMeta.senderName, senderEmail: parentMeta.senderEmail }),
      subject: parentMeta.subject || null,
    };
  }

  return null;
}
