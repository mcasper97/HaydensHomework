/* ============================== Email-led obligation extraction ==============================
 * Text-only counterpart to api/extract-obligations.js's photo pipeline
 * (#26, Commit 5). Given an approved sender's email body (already reduced
 * to readable text via api/_htmlToText.js) plus the readable text of up to
 * several linked webpages (also via api/_htmlToText.js, fetched only
 * through api/_urlSafety.js's SSRF-safe safeFetch), extracts the same
 * obligation shape the rest of the app already understands.
 *
 * Reuses api/extract-obligations.js's sanitizeObligationsResponse
 * directly — same enum/length validation, same untrusted-output boundary
 * discipline — rather than duplicating it. Only the prompt differs (no
 * vision/handwriting instructions; instead: email-plus-linked-pages
 * context, and explicit instructions not to invent content for a page
 * that failed to load).
 *
 * The model here has no tool access, no OAuth credentials, and cannot
 * fetch anything itself — every byte of untrusted email/webpage content is
 * passed as inert text in a single user-turn content block, never
 * interpreted as instructions to this module or given any way to cause a
 * network request. Its JSON output is never trusted directly; it only
 * ever becomes a review-gated IngestionCandidate after
 * sanitizeObligationsResponse validates it (see api/gmail-check-email.js).
 */
import { FORM_TYPES, SUBJECT_OPTIONS } from "../src/data/itemTypes.js";
import { sanitizeObligationsResponse } from "./extract-obligations.js";

const TYPE_ENUM_LIST = FORM_TYPES.join(" | ");
const SUBJECT_ENUM_LIST = SUBJECT_OPTIONS.join(" | ");

const SYSTEM_PROMPT = `You are a homework/school-communication parser for a family organizer app.
You will be given the text of one email from a school contact the parent has explicitly approved, and — when available — the readable text of webpages that email links to. Read everything provided carefully and extract every distinct obligation (something a parent/student needs to know, do, or prepare for) into structured JSON.

Return ONLY valid JSON with this exact shape — no markdown, no explanation:
{
  "obligations": [
    {
      "type": "${TYPE_ENUM_LIST}",
      "title": "string",
      "childName": "string or null",
      "date": "YYYY-MM-DD or null",
      "subject": "${SUBJECT_ENUM_LIST} | null",
      "academicTopic": "string or null",
      "academicUnit": "string or null",
      "preparationRequired": true/false/null,
      "description": "string or null",
      "sourceUrl": "string or null",
      "startTime": "HH:MM (24-hour) or null",
      "endTime": "HH:MM (24-hour) or null"
    }
  ]
}

Rules:
- type must be one of: ${TYPE_ENUM_LIST}. If unsure, pick the closest match.
- title is required and should be short and specific (e.g. "Field Trip Permission Slip Due", not "Permission Slip").
- childName: only fill in if a specific child's name is explicitly stated in the email or a linked page; otherwise null. Never guess from context.
- date: only output a real calendar date in YYYY-MM-DD format if one is explicitly stated or clearly computable from the provided text; otherwise null. Never invent a date. If a weekday name and a specific day/month both appear, use the specific day/month, and choose the year so the date falls on or after today's date (given below) rather than in the past.
- subject: must be exactly one of: ${SUBJECT_ENUM_LIST}, based strictly on the actual academic content described — use null when the obligation has no clear academic subject (e.g. a school event, permission slip, or general reminder).
- academicTopic / academicUnit: capture only when a specific unit, lesson, or skill is explicitly named.
- preparationRequired: true only for test/quiz-like obligations that need studying; otherwise null.
- description: a short plain-language summary of any instructions/details not captured by the other fields; otherwise null.
- sourceUrl: if this specific obligation's information came from a linked page's text (not the email body itself), set this to that exact page's URL, copied character-for-character from its "--- LINKED PAGE: <url> ---" label. If the obligation came from the email body itself (or you are not sure which source it came from), set this to null. Never invent a URL that wasn't given to you.
- startTime / endTime: only output a specific clock time, in 24-hour "HH:MM" format (e.g. "18:00" for 6:00 PM), if a specific time is explicitly stated in the source text; otherwise null. Never infer, estimate, or guess a time from vague context (e.g. do not assume "evening" or "after school" means any particular time). endTime must only be set when the source explicitly gives an end time or a time range (e.g. "6:00 PM to 7:30 PM" or "6:00-7:30 PM"); a single start time alone means endTime stays null. A date-only obligation with no time mentioned at all must leave both startTime and endTime null.
- The email body is the primary source. Linked page text, when provided, is supporting context that may explain something the email only references (e.g. "see the signup form linked below"). A linked page's text may be missing entirely if it could not be safely retrieved — never invent what an unavailable page might have said; rely on the email body alone in that case.
- If several linked pages are provided, each is clearly labeled with its own URL — treat them as independent sources, not one merged document.
- If the email (and any linked pages) contain no useful obligations, return { "obligations": [] }.
- Do not invent obligations that aren't actually present in the provided text.`;

function buildUserContent({ todayIso, senderEmail, subject, receivedAt, emailBodyText, pages, googleDocUrls }) {
  const parts = [
    `Today's date is ${todayIso}.`,
    `This email is from ${senderEmail || "an approved sender"}, subject: "${subject || "(no subject)"}"${receivedAt ? `, received ${receivedAt}` : ""}.`,
    "",
    "--- EMAIL BODY ---",
    emailBodyText || "(empty)",
  ];

  for (const page of pages || []) {
    parts.push("", `--- LINKED PAGE: ${page.url} ---`, page.text || "(this page's content could not be retrieved)");
  }

  if (googleDocUrls && googleDocUrls.length > 0) {
    parts.push(
      "",
      "--- GOOGLE DOCS LINKED IN THIS EMAIL (not retrieved in this version — do not describe their content) ---",
      googleDocUrls.join("\n")
    );
  }

  return parts.join("\n");
}

/**
 * extractObligationsFromEmail({ client, ... }) -> { obligations: [...] }
 * (sanitized, per sanitizeObligationsResponse). `client` is an Anthropic
 * SDK instance, injected so this is testable without a live API key.
 */
export async function extractObligationsFromEmail({
  client,
  senderEmail,
  subject,
  receivedAt,
  emailBodyText,
  pages,
  googleDocUrls,
  todayIso = new Date().toISOString().slice(0, 10),
}) {
  const userText = buildUserContent({ todayIso, senderEmail, subject, receivedAt, emailBodyText, pages, googleDocUrls });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
  });

  const raw = message.content[0].text.trim();
  const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Model output was not valid JSON");
  }

  const sanitized = sanitizeObligationsResponse(parsed);

  // Cross-validate sourceUrl against the actual page URLs this call was
  // given — sanitizeObligationsResponse only checks that it's a clean
  // string, not that it's a real, actually-fetched page. A value that
  // doesn't exactly match one of `pages`' URLs (a hallucination, a typo,
  // or simply "the model didn't attribute it") is never trusted; it's
  // treated the same as no attribution (the email body). This is what
  // lets api/gmail-check-email.js safely use sourceUrl to pick which
  // SourceRecord (the email's, or a specific linked webpage's) an
  // obligation is attributed to.
  const validPageUrls = new Set((pages || []).map((p) => p.url));
  const obligations = sanitized.obligations.map((o) => ({
    ...o,
    sourceUrl: o.sourceUrl && validPageUrls.has(o.sourceUrl) ? o.sourceUrl : null,
  }));

  return { obligations };
}
