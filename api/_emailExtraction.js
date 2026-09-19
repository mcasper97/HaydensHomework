/* ============================== Email-led obligation extraction ==============================
 * Text-only counterpart to api/extract-obligations.js's photo pipeline
 * (#26, Commit 5; Google Doc text added in Commit 6; forced tool use
 * added in the live-failure follow-up fix below). Given an approved
 * sender's email body (already reduced to readable text via
 * api/_htmlToText.js) plus the readable text of up to several linked
 * pages — ordinary webpages (via api/_htmlToText.js) or public Google
 * Docs (via api/_googleDocFetch.js's plain-text export), both fetched
 * only through api/_urlSafety.js's SSRF-safe safeFetch — extracts the
 * same obligation shape the rest of the app already understands. This
 * module treats every linked page's text identically regardless of
 * whether it came from a webpage or a Google Doc — see
 * api/gmail-check-email.js, which is the only place that distinguishes
 * them (for SourceRecord attribution).
 *
 * Reuses api/extract-obligations.js's sanitizeObligationsResponse
 * directly — same enum/length validation, same untrusted-output boundary
 * discipline — rather than duplicating it. Only the prompt/output
 * mechanism differs (no vision/handwriting instructions; instead:
 * email-plus-linked-pages context, explicit instructions not to invent
 * content for a page that failed to load, and — unlike the photo
 * pipeline — forced tool use instead of free-text JSON).
 *
 * Live failure fix: a production Vercel log showed "Model output was not
 * valid JSON" thrown from this module's old JSON.parse(message.content[0]
 * .text) approach. Free-text JSON is fragile to leading/trailing prose and
 * to truncation (a long email + a full Google Doc's worth of linked text
 * makes a longer model reply more likely to hit the token cap mid-object).
 * Forced tool use (tools + tool_choice: {type:"tool", name:
 * "extract_obligations"}) makes the Anthropic Messages API itself return
 * an already-parsed input object on a tool_use content block — there is no
 * free-form text to JSON.parse, and no markdown-fence-stripping regex
 * needed at all anymore.
 *
 * The model here has no tool access beyond this one structured-output
 * tool (which is never actually "called" — it's the mechanism used to
 * shape output, not a capability the model exercises), no OAuth
 * credentials, and cannot fetch anything itself — every byte of untrusted
 * email/webpage/doc content is passed as inert text in a single user-turn
 * content block, never interpreted as instructions to this module or
 * given any way to cause a network request. Its output is still never
 * trusted directly just because the SDK handed back a parsed object
 * instead of a string — sanitizeObligationsResponse's exact same
 * enum/length validation still runs before anything becomes a
 * review-gated IngestionCandidate (see api/gmail-check-email.js).
 */
import { FORM_TYPES, SUBJECT_OPTIONS } from "../src/data/itemTypes.js";
import { sanitizeObligationsResponse } from "./extract-obligations.js";

const TYPE_ENUM_LIST = FORM_TYPES.join(" | ");
const SUBJECT_ENUM_LIST = SUBJECT_OPTIONS.join(" | ");

// Controlled failure codes (live failure fix) — distinct from a generic
// thrown Error, so api/gmail-check-email.js's catch block can log a
// specific, useful reason instead of an opaque "wasn't valid JSON".
// Never carries email/doc content — see the ExtractionError class below.
export const EXTRACTION_ERROR_CODES = {
  TRUNCATED: "MODEL_OUTPUT_TRUNCATED",
  TOOL_OUTPUT_MISSING: "MODEL_TOOL_OUTPUT_MISSING",
};

export class ExtractionError extends Error {
  constructor(code, message, { stopReason = null } = {}) {
    super(message || code);
    this.name = "ExtractionError";
    this.code = code;
    this.stopReason = stopReason;
  }
}

const EXTRACT_OBLIGATIONS_TOOL = {
  name: "extract_obligations",
  description:
    "Records every distinct actionable obligation (something a parent/student needs to know, do, or prepare for) found in the provided email and any linked page text.",
  input_schema: {
    type: "object",
    properties: {
      obligations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: FORM_TYPES },
            title: { type: "string" },
            childName: { type: ["string", "null"] },
            date: { type: ["string", "null"] },
            subject: { type: ["string", "null"], enum: [...SUBJECT_OPTIONS, null] },
            academicTopic: { type: ["string", "null"] },
            academicUnit: { type: ["string", "null"] },
            preparationRequired: { type: ["boolean", "null"] },
            description: { type: ["string", "null"] },
            sourceUrl: { type: ["string", "null"] },
            startTime: { type: ["string", "null"] },
            endTime: { type: ["string", "null"] },
          },
          required: ["type", "title"],
        },
      },
    },
    required: ["obligations"],
  },
};

const SYSTEM_PROMPT = `You are a homework/school-communication parser for a family organizer app.
You will be given the text of one email from a school contact the parent has explicitly approved, and — when available — the readable text of pages that email links to (ordinary webpages, or the full text of a linked Google Doc). Read everything provided carefully and extract every distinct obligation (something a parent/student needs to know, do, or prepare for) using the extract_obligations tool.

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
- A linked page (including a Google Doc) may be pure reference/learning material — a worksheet, a reading passage, study notes, a study guide — with no actionable obligation in it at all. That is not automatically an obligation: extract one only if the page itself states something actionable (a due date, an event, a task to do or prepare for). Do not create an obligation merely to "preserve" or summarize a document's content — if a linked page contains no actionable date or task, it simply contributes no obligations, even if the rest of the email produces some.
- The email body is the primary source. Linked page text, when provided, is supporting context that may explain something the email only references (e.g. "see the signup form linked below"). A linked page's text may be missing entirely if it could not be safely retrieved — never invent what an unavailable page might have said; rely on the email body alone in that case.
- If several linked pages are provided, each is clearly labeled with its own URL — treat them as independent sources, not one merged document.
- If the email (and any linked pages) contain no useful obligations, call the tool with an empty obligations list.
- Do not invent obligations that aren't actually present in the provided text.`;

function buildUserContent({ todayIso, senderEmail, subject, receivedAt, emailBodyText, pages }) {
  const parts = [
    `Today's date is ${todayIso}.`,
    `This email is from ${senderEmail || "an approved sender"}, subject: "${subject || "(no subject)"}"${receivedAt ? `, received ${receivedAt}` : ""}.`,
    "",
    "--- EMAIL BODY ---",
    emailBodyText || "(empty)",
  ];

  // `pages` holds every successfully-retrieved linked page's text —
  // ordinary webpages and Google Docs alike (see api/gmail-check-email.js).
  // A link that failed to fetch (an SSRF-unsafe target, a network error,
  // or — for a Google Doc — one that requires access) simply never
  // appears here at all, exactly like a failed webpage fetch always has:
  // the model is never told a link existed but couldn't be read, so it
  // has nothing to speculate about.
  for (const page of pages || []) {
    parts.push("", `--- LINKED PAGE: ${page.url} ---`, page.text || "(this page's content could not be retrieved)");
  }

  return parts.join("\n");
}

/**
 * extractObligationsFromEmail({ client, ... }) -> { obligations: [...] }
 * (sanitized, per sanitizeObligationsResponse). `client` is an Anthropic
 * SDK instance, injected so this is testable without a live API key.
 *
 * Throws an ExtractionError (see EXTRACTION_ERROR_CODES) for either
 * controlled failure mode below — the caller (api/gmail-check-email.js)
 * catches it the same way it caught the old generic Error, but can now
 * log a specific `.code`/`.stopReason` instead of an opaque message. No
 * regex/prose repair is attempted for either case — a truncated or
 * missing tool response is reported as exactly that, not silently
 * patched or guessed at.
 */
export async function extractObligationsFromEmail({
  client,
  senderEmail,
  subject,
  receivedAt,
  emailBodyText,
  pages,
  todayIso = new Date().toISOString().slice(0, 10),
}) {
  const userText = buildUserContent({ todayIso, senderEmail, subject, receivedAt, emailBodyText, pages });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACT_OBLIGATIONS_TOOL],
    tool_choice: { type: "tool", name: "extract_obligations" },
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
  });

  // Checked BEFORE looking at content at all — a truncated response may
  // still contain a tool_use block, but its `input` cannot be trusted to
  // be the model's actual complete/intended output. Reported as a
  // specific, distinguishable failure rather than however sanitization or
  // a missing-block check would happen to fail on partial data.
  if (message.stop_reason === "max_tokens") {
    throw new ExtractionError(EXTRACTION_ERROR_CODES.TRUNCATED, "Gmail extraction: model output was truncated at max_tokens", {
      stopReason: message.stop_reason,
    });
  }

  const toolUseBlock = (message.content || []).find((block) => block?.type === "tool_use" && block?.name === "extract_obligations");
  if (!toolUseBlock || typeof toolUseBlock.input !== "object" || toolUseBlock.input === null) {
    throw new ExtractionError(EXTRACTION_ERROR_CODES.TOOL_OUTPUT_MISSING, "Gmail extraction: model did not return the expected extract_obligations tool_use block", {
      stopReason: message.stop_reason ?? null,
    });
  }

  // Still untrusted output — the SDK handing back an already-parsed
  // object (rather than a JSON string) changes nothing about the trust
  // boundary. Same enum/length validation as every other extraction path.
  const sanitized = sanitizeObligationsResponse(toolUseBlock.input);

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
