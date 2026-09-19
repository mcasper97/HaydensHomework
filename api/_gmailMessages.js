/* ============================== Gmail message list/get ==============================
 * Thin, injectable-fetch wrapper around the two Gmail API calls Commit 5
 * needs: listing message IDs matching approved senders within the
 * lookback window, and fetching one message's full content. No MIME
 * parsing here (see api/_gmailMime.js) — this module only talks to Gmail.
 *
 * Only ever called with an access token this server just obtained via
 * api/_googleOAuth.js's refreshAccessToken — never with anything supplied
 * by a client request.
 */

const MESSAGES_LIST_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

function messageGetEndpoint(id) {
  return `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`;
}

/**
 * Builds a Gmail search query restricted to exact approved senders and a
 * lookback window — e.g. "after:2026/03/01 (from:a@x.com OR from:b@x.com)".
 * Gmail's `after:` operator takes a YYYY/MM/DD date (documented format),
 * not a Unix timestamp — avoids timezone/epoch ambiguity.
 */
export function buildGmailSearchQuery(senderEmails, sinceDate) {
  const senders = (Array.isArray(senderEmails) ? senderEmails : []).filter((e) => typeof e === "string" && e.length > 0);
  if (senders.length === 0) return null;

  const y = sinceDate.getUTCFullYear();
  const m = String(sinceDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(sinceDate.getUTCDate()).padStart(2, "0");
  const fromClause = senders.map((e) => `from:${e}`).join(" OR ");
  return `after:${y}/${m}/${d} (${fromClause})`;
}

/**
 * Returns [{ id, threadId }, ...] for messages matching the query — a
 * single page only (Gmail's default page size, generous for a family's
 * realistic email volume within a 14-day window). A mailbox with more
 * matches than one page returns would only see the first page; accepted
 * as a known limitation for this first slice, not paginated.
 */
export async function listGmailMessageIds({ accessToken, query, fetchFn = fetch }) {
  const url = new URL(MESSAGES_LIST_ENDPOINT);
  url.searchParams.set("q", query);
  const res = await fetchFn(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.message || "Gmail message list failed");
    err.status = res.status;
    throw err;
  }
  return Array.isArray(json.messages) ? json.messages : [];
}

/** Returns the raw Gmail API message JSON (format=full) for one message id. */
export async function getGmailMessage({ accessToken, messageId, fetchFn = fetch }) {
  const url = new URL(messageGetEndpoint(messageId));
  url.searchParams.set("format", "full");
  const res = await fetchFn(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.message || "Gmail message fetch failed");
    err.status = res.status;
    throw err;
  }
  return json;
}
