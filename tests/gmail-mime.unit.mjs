/**
 * Focused unit tests for api/_gmailMime.js — pure parsing of a Gmail API
 * `messages.get(format=full)` JSON payload. No network calls; fixtures are
 * hand-built to match Gmail's documented message shape.
 *
 * Usage: node tests/gmail-mime.unit.mjs
 */
import { decodeGmailMessage } from "../api/_gmailMime.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const b64 = (text) => Buffer.from(text, "utf8").toString("base64url");

function headers(list) {
  return list.map(([name, value]) => ({ name, value }));
}

// ============ Single-part message (no `parts` array at all) ============
{
  const message = {
    id: "msg-1",
    threadId: "thread-1",
    internalDate: "1704067200000", // 2024-01-01T00:00:00.000Z
    payload: {
      mimeType: "text/html",
      headers: headers([
        ["From", "Ms. Teacher <teacher@school.edu>"],
        ["Subject", "Homework this week"],
        ["Date", "Mon, 1 Jan 2024 00:00:00 +0000"],
      ]),
      body: { data: b64("<p>Spelling test Friday</p>") },
    },
  };
  const decoded = decodeGmailMessage(message);
  ok("gmailMessageId comes from message.id", decoded.gmailMessageId === "msg-1");
  ok("gmailThreadId comes from message.threadId", decoded.gmailThreadId === "thread-1");
  ok("senderEmail extracts the bare address from a display-name From header", decoded.senderEmail === "teacher@school.edu");
  ok("subject comes from the Subject header", decoded.subject === "Homework this week");
  ok("receivedAt converts internalDate (ms epoch string) to an ISO date", decoded.receivedAt === "2024-01-01T00:00:00.000Z");
  ok("A single-part text/html message's body is read directly (no parts array needed)", decoded.htmlBody === "<p>Spelling test Friday</p>");
  ok("textBody is empty (not null) when no text/plain part exists", decoded.textBody === "");
}

// ============ multipart/alternative: text/plain + text/html, HTML preferred ============
{
  const message = {
    id: "msg-2",
    payload: {
      mimeType: "multipart/alternative",
      headers: headers([["From", "teacher@school.edu"], ["Subject", "Reminder"]]),
      parts: [
        { mimeType: "text/plain", body: { data: b64("Plain text version") } },
        { mimeType: "text/html", body: { data: b64("<p>HTML version</p>") } },
      ],
    },
  };
  const decoded = decodeGmailMessage(message);
  ok("A bare (no angle brackets) From header is used as-is", decoded.senderEmail === "teacher@school.edu");
  ok("Both html and text bodies are captured when both are present", decoded.htmlBody === "<p>HTML version</p>" && decoded.textBody === "Plain text version");
}

// ============ Plain-text-only message (no HTML part at all) ============
{
  const message = {
    id: "msg-3",
    payload: {
      mimeType: "text/plain",
      headers: headers([["From", "office@school.edu"]]),
      body: { data: b64("Picture day is next Tuesday.") },
    },
  };
  const decoded = decodeGmailMessage(message);
  ok("htmlBody is empty (not null) for a plain-text-only message", decoded.htmlBody === "");
  ok("textBody carries the plain-text content", decoded.textBody === "Picture day is next Tuesday.");
}

// ============ Nested multipart (mixed -> alternative) with an attachment sibling ============
{
  const message = {
    id: "msg-4",
    payload: {
      mimeType: "multipart/mixed",
      headers: headers([["From", "teacher@school.edu"]]),
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64("Plain nested") } },
            { mimeType: "text/html", body: { data: b64("<p>HTML nested</p>") } },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "permission-slip.pdf",
          body: { attachmentId: "att-1", size: 12345 },
        },
      ],
    },
  };
  const decoded = decodeGmailMessage(message);
  ok("Finds the HTML body nested two levels deep (multipart/mixed -> multipart/alternative)", decoded.htmlBody === "<p>HTML nested</p>");
  ok("Finds the plain-text body nested the same way", decoded.textBody === "Plain nested");
}

// ============ Attachment part is skipped even when it looks text-like ============
{
  const message = {
    id: "msg-5",
    payload: {
      mimeType: "multipart/mixed",
      headers: headers([["From", "teacher@school.edu"]]),
      parts: [
        { mimeType: "text/html", body: { data: b64("<p>Real body</p>") } },
        // A .txt attachment: text/plain mimeType, but has a filename — must
        // NOT be treated as the message's plain-text body.
        { mimeType: "text/plain", filename: "notes.txt", body: { data: b64("Attachment content, not the body") } },
      ],
    },
  };
  const decoded = decodeGmailMessage(message);
  ok("A part with a filename is treated as an attachment and skipped, even with a text/* mimeType", decoded.textBody === "");
  ok("The real (non-attachment) HTML part is still found", decoded.htmlBody === "<p>Real body</p>");
}

// ============ Graceful handling of missing/malformed input ============
{
  const decoded = decodeGmailMessage({});
  ok("An empty message object doesn't throw", true);
  ok("gmailMessageId is null when message.id is missing", decoded.gmailMessageId === null);
  ok("senderEmail is null when there's no From header", decoded.senderEmail === null);
  ok("subject is null when there's no Subject header", decoded.subject === null);
  ok("receivedAt is null when internalDate is missing", decoded.receivedAt === null);
  ok("htmlBody defaults to empty string, not null, when there's no payload at all", decoded.htmlBody === "");
  ok("textBody defaults to empty string, not null, when there's no payload at all", decoded.textBody === "");
}
{
  let threw = false;
  try { decodeGmailMessage(null); } catch { threw = true; }
  ok("decodeGmailMessage(null) does not throw", !threw);
}
{
  const decoded = decodeGmailMessage({ id: "msg-6", payload: { headers: headers([["From", "not-a-valid-header-format"]]) } });
  ok("A From header with no @ at all still returns something rather than throwing (best-effort, lowercased)", decoded.senderEmail === "not-a-valid-header-format");
}

// ============ senderName extraction (#26, Commit 5 live-validation fix — compact source context) ============
{
  const message = {
    id: "msg-name-1",
    payload: { headers: headers([["From", "Michelle Manson <mmanson@school.org>"]]) },
  };
  const decoded = decodeGmailMessage(message);
  ok("Extracts the display name from a \"Name <address>\" From header", decoded.senderName === "Michelle Manson");
  ok("senderEmail is still the bare, lowercased address", decoded.senderEmail === "mmanson@school.org");
}
{
  const message = { id: "msg-name-2", payload: { headers: headers([["From", '"Manson, Michelle" <mmanson@school.org>']]) } };
  ok("Strips surrounding quotes from a quoted display name (handles a comma inside it)", decodeGmailMessage(message).senderName === "Manson, Michelle");
}
{
  const message = { id: "msg-name-3", payload: { headers: headers([["From", "teacher@school.edu"]]) } };
  ok("A bare address with no display name: senderName is null (not the address, not an empty string)", decodeGmailMessage(message).senderName === null);
}
{
  const message = { id: "msg-name-4", payload: { headers: [] } };
  ok("No From header at all: senderName is null, without throwing", decodeGmailMessage(message).senderName === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
