/* ============================== Gmail message MIME parsing ==============================
 * Pure parsing of the JSON payload returned by Gmail API's
 * `messages.get(id, format=full)` — no network calls here (see
 * api/_gmailMessages.js for the actual HTTP call). Walks the MIME part
 * tree to find the message's HTML and/or plain-text body, decodes the
 * From/Subject/Date headers, and deliberately skips every attachment part
 * (identified by a `filename`, per the Gmail API's own convention) — no
 * attachment handling in this commit, by design.
 */

function decodeBase64Url(data) {
  if (typeof data !== "string" || data.length === 0) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function isAttachmentPart(part) {
  // Gmail marks any part with a filename as a named attachment, regardless
  // of its declared mimeType — a text file sent as an attachment still
  // carries a filename and must be skipped, not treated as body text.
  return typeof part?.filename === "string" && part.filename.length > 0;
}

/**
 * Recursively collects the first text/html and first text/plain leaf part
 * bodies found in a MIME part tree (depth-first, document order) —
 * multipart/alternative and multipart/related nesting is common in real
 * email and both are walked the same way.
 */
function collectBodies(part, found) {
  if (!part || typeof part !== "object") return;
  if (isAttachmentPart(part)) return;

  if (Array.isArray(part.parts) && part.parts.length > 0) {
    for (const child of part.parts) collectBodies(child, found);
    return;
  }

  const data = part.body?.data;
  if (!data) return;
  if (part.mimeType === "text/html" && !found.html) {
    found.html = decodeBase64Url(data);
  } else if (part.mimeType === "text/plain" && !found.text) {
    found.text = decodeBase64Url(data);
  }
}

function getHeader(headers, name) {
  if (!Array.isArray(headers)) return null;
  const match = headers.find((h) => typeof h?.name === "string" && h.name.toLowerCase() === name.toLowerCase());
  return match?.value ?? null;
}

// Matches the bare address inside "Display Name <address@host>" — falls
// back to treating the whole header value as the address when there's no
// angle-bracket form (some senders send bare "address@host" From headers).
const ANGLE_ADDRESS_RE = /<([^<>]+)>/;

function extractAddress(fromHeader) {
  if (typeof fromHeader !== "string") return null;
  const match = ANGLE_ADDRESS_RE.exec(fromHeader);
  const raw = match ? match[1] : fromHeader;
  return raw.trim().toLowerCase() || null;
}

/**
 * decodeGmailMessage(message) -> {
 *   gmailMessageId, gmailThreadId, senderEmail, subject, receivedAt (ISO),
 *   htmlBody, textBody
 * }
 * `htmlBody`/`textBody` are "" (not null) when absent, so callers never
 * need a null check before checking `.length`.
 */
export function decodeGmailMessage(message) {
  const headers = message?.payload?.headers;
  const found = { html: null, text: null };
  collectBodies(message?.payload, found);

  const internalDateMs = Number(message?.internalDate);
  const receivedAt = Number.isFinite(internalDateMs) && internalDateMs > 0 ? new Date(internalDateMs).toISOString() : null;

  return {
    gmailMessageId: typeof message?.id === "string" ? message.id : null,
    gmailThreadId: typeof message?.threadId === "string" ? message.threadId : null,
    senderEmail: extractAddress(getHeader(headers, "From")),
    subject: getHeader(headers, "Subject") || null,
    receivedAt,
    htmlBody: found.html || "",
    textBody: found.text || "",
  };
}
