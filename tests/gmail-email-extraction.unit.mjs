/**
 * Focused unit tests for api/_emailExtraction.js — the text-only
 * counterpart to api/extract-obligations.js's photo pipeline (#26,
 * Commit 5; forced tool use added in the live-failure follow-up fix).
 * The Anthropic client is injected (a fake `messages.create`), so no live
 * ANTHROPIC_API_KEY or network access is needed — same constraint already
 * documented in tests/extract-obligations.unit.mjs.
 *
 * A live Vercel log showed "Model output was not valid JSON" thrown from
 * the old JSON.parse(message.content[0].text) approach. This file now
 * exercises the forced tool_use mechanism that replaced it — the fake
 * client returns a tool_use content block (an already-parsed `input`
 * object), exactly the shape the real Anthropic SDK returns when
 * `tool_choice: { type: "tool", name: "extract_obligations" }` is set.
 *
 * Usage: node tests/gmail-email-extraction.unit.mjs
 */
import { extractObligationsFromEmail, ExtractionError, EXTRACTION_ERROR_CODES } from "../api/_emailExtraction.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// Builds a fake Anthropic client whose messages.create() returns a
// tool_use content block with the given `input` object — the real SDK's
// shape when tool_choice forces a specific tool. No JSON string, no text
// block required at all (proving the extraction code never needs one).
function fakeClient(input, { capture, stopReason = "tool_use", toolName = "extract_obligations", extraContent = [] } = {}) {
  return {
    messages: {
      create: async (params) => {
        if (capture) capture(params);
        return {
          stop_reason: stopReason,
          content: [...extraContent, { type: "tool_use", id: "toolu_01", name: toolName, input }],
        };
      },
    },
  };
}

// ============ Basic extraction, sanitized via the reused contract ============
{
  const client = fakeClient({
    obligations: [
      { type: "assignment", title: "Reading log due Friday", childName: null, date: "2026-03-20", subject: "Language Arts - Reading/Comprehension", academicTopic: null, academicUnit: null, preparationRequired: false, description: null, extractionConfidence: 0.9 },
    ],
  });
  const result = await extractObligationsFromEmail({
    client,
    senderEmail: "teacher@school.edu",
    subject: "This week's homework",
    receivedAt: "2026-03-15T10:00:00.000Z",
    emailBodyText: "Reading logs are due Friday this week.",
    pages: [],
    todayIso: "2026-03-15",
  });
  ok("Returns one sanitized obligation", result.obligations.length === 1 && result.obligations[0].title === "Reading log due Friday");
}

// ============ Reuses sanitizeObligationsResponse's enum validation (invalid entries dropped, not trusted) ============
{
  const client = fakeClient({
    obligations: [
      { type: "assignment", title: "Valid one", extractionConfidence: 0.8 },
      { type: "not-a-real-type", title: "Should be dropped" }, // invalid type enum
      { type: "test", title: "x".repeat(1000) }, // exceeds MAX_TITLE_LENGTH
    ],
  });
  const result = await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  ok("Drops an obligation with an invalid type enum, same as the photo pipeline's sanitization", result.obligations.length === 1 && result.obligations[0].title === "Valid one");
}

// ============ Forced tool use: the request itself asks for the right tool ============
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  ok("Passes exactly one tool named extract_obligations", Array.isArray(captured.tools) && captured.tools.length === 1 && captured.tools[0].name === "extract_obligations");
  ok("Forces tool_choice to that exact tool (never lets the model choose freely)", captured.tool_choice?.type === "tool" && captured.tool_choice?.name === "extract_obligations");
  ok("The tool's input_schema requires an obligations array", captured.tools[0].input_schema?.type === "object" && captured.tools[0].input_schema?.required?.includes("obligations"));
  ok("max_tokens was raised from the old 2048 cap (live-failure fix)", captured.max_tokens === 4096);
}

// ============ No JSON.parse dependency remains — works with no text block at all ============
{
  const client = fakeClient({ obligations: [{ type: "assignment", title: "X" }] }); // no extraContent — content is ONLY the tool_use block, no text block whatsoever
  const result = await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  ok("Extraction succeeds with no text content block present at all (nothing to JSON.parse)", result.obligations.length === 1 && result.obligations[0].title === "X");
}
{
  // Even if a text block IS present alongside the tool_use block (real
  // models sometimes emit brief text plus a tool call), it must be
  // completely ignored — only toolUseBlock.input is ever read.
  const client = fakeClient(
    { obligations: [{ type: "assignment", title: "From the tool" }] },
    { extraContent: [{ type: "text", text: "not json at all — should be ignored entirely" }] }
  );
  const result = await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  ok("A malformed/non-JSON text block alongside a valid tool_use block is ignored — only the tool's input is read", result.obligations[0].title === "From the tool");
}

// ============ Prompt content: today's date, sender, subject, email body ============
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({
    client,
    senderEmail: "principal@school.edu",
    subject: "Picture Day",
    receivedAt: "2026-03-10T12:00:00.000Z",
    emailBodyText: "Picture day is next Tuesday, wear your best smile.",
    pages: [],
    todayIso: "2026-03-11",
  });
  const userText = captured.messages[0].content[0].text;
  ok("Includes today's date as an explicit anchor (needed for date resolution)", userText.includes("Today's date is 2026-03-11"));
  ok("Includes the sender's email address", userText.includes("principal@school.edu"));
  ok("Includes the subject line", userText.includes("Picture Day"));
  ok("Includes the email body text", userText.includes("Picture day is next Tuesday"));
  ok("System prompt lists the app's actual type enum, same contract as the photo pipeline", captured.system.includes("assignment"));
}

// ============ Prompt content: linked pages, each labeled with its own URL ============
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({
    client,
    emailBodyText: "See the signup form linked below.",
    pages: [
      { url: "https://school.edu/signup", text: "Signup form: bring $5 by Friday." },
      { url: "https://school.edu/calendar", text: "Calendar: no school on the 20th." },
    ],
  });
  const userText = captured.messages[0].content[0].text;
  ok("Includes the first linked page's URL as a label", userText.includes("https://school.edu/signup"));
  ok("Includes the first linked page's text", userText.includes("bring $5 by Friday"));
  ok("Includes the second linked page's URL as a label", userText.includes("https://school.edu/calendar"));
  ok("Includes the second linked page's text", userText.includes("no school on the 20th"));
}

// ============ A page that failed to fetch is noted as unavailable, not silently omitted or invented ============
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({
    client,
    emailBodyText: "body",
    pages: [{ url: "https://school.edu/blocked", text: "" }],
  });
  const userText = captured.messages[0].content[0].text;
  ok("Still labels the page by URL even when its text is empty", userText.includes("https://school.edu/blocked"));
  ok("Explicitly notes the content could not be retrieved, rather than showing a blank section", userText.includes("could not be retrieved"));
}

// ============ Google Doc text is fed through the exact same `pages` mechanism
// as a webpage (#26, Commit 6) — api/gmail-check-email.js is the only place
// that distinguishes a Google Doc from an ordinary webpage; by the time
// text reaches this module, both are just "linked page" entries. A Google
// Doc that couldn't be fetched/requires access is simply absent from
// `pages`, exactly like a failed webpage fetch always has been — no
// separate "Google Docs linked" section exists anymore. ============
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({
    client,
    emailBodyText: "See the attached study guide.",
    pages: [{ url: "https://docs.google.com/document/d/abc123/edit", text: "Unit 3 Study Guide: covers fractions and decimals." }],
  });
  const userText = captured.messages[0].content[0].text;
  ok("A successfully-fetched Google Doc's text is included via the same LINKED PAGE labeling as a webpage", userText.includes("--- LINKED PAGE: https://docs.google.com/document/d/abc123/edit ---"));
  ok("The Google Doc's actual text content is present", userText.includes("Unit 3 Study Guide: covers fractions and decimals."));
}
{
  // A Google Doc obligation extracts and behaves exactly like a webpage
  // obligation end-to-end through the (now tool_use-based) pipeline.
  const client = fakeClient({
    obligations: [{ type: "test", title: "Unit 3 Math Test", sourceUrl: "https://docs.google.com/document/d/abc123/edit" }],
  });
  const result = await extractObligationsFromEmail({
    client,
    emailBodyText: "See the attached study guide.",
    pages: [{ url: "https://docs.google.com/document/d/abc123/edit", text: "Test on fractions Friday." }],
  });
  ok("A Google Doc's obligation is attributed via sourceUrl exactly like a webpage's", result.obligations[0].sourceUrl === "https://docs.google.com/document/d/abc123/edit");
}
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  const userText = captured.messages[0].content[0].text;
  ok("No 'GOOGLE DOCS LINKED' section exists at all anymore (obsolete Commit 5 mechanism, removed in Commit 6)", !userText.includes("GOOGLE DOCS"));
}
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  ok(
    "System prompt instructs the model that reference/learning material alone isn't automatically an obligation",
    captured.system.toLowerCase().includes("reference") && captured.system.toLowerCase().includes("not automatically an obligation")
  );
  ok("System prompt explicitly forbids inventing an obligation just to preserve a document's content", captured.system.toLowerCase().includes("preserve"));
}

// ============ Webpage (non-Google-Doc) extraction still works, unaffected by tool_use switch ============
{
  const client = fakeClient({
    obligations: [{ type: "school_event", title: "From the webpage", sourceUrl: "https://school.edu/calendar" }],
  });
  const result = await extractObligationsFromEmail({
    client,
    emailBodyText: "See the calendar linked below.",
    pages: [{ url: "https://school.edu/calendar", text: "PTA meeting Thursday." }],
  });
  ok("Webpage-attributed extraction still works end-to-end", result.obligations[0].title === "From the webpage" && result.obligations[0].sourceUrl === "https://school.edu/calendar");
}

// ============ Email-body-only extraction (no linked pages at all) still works ============
{
  const client = fakeClient({ obligations: [{ type: "reminder", title: "Bring lunch money", sourceUrl: null }] });
  const result = await extractObligationsFromEmail({ client, emailBodyText: "Please send lunch money tomorrow.", pages: [] });
  ok("Email-body-only extraction (zero linked pages) still works", result.obligations.length === 1 && result.obligations[0].title === "Bring lunch money");
}

// ============ Successful empty obligations is not treated as failure ============
{
  const client = fakeClient({ obligations: [] });
  let threw = false;
  let result;
  try {
    result = await extractObligationsFromEmail({ client, emailBodyText: "Just a friendly note, nothing actionable.", pages: [] });
  } catch {
    threw = true;
  }
  ok("A genuinely empty obligations list does not throw", !threw);
  ok("Returns an empty (not missing/undefined) obligations array", Array.isArray(result.obligations) && result.obligations.length === 0);
}

// ============ Truncation: stop_reason === "max_tokens" produces a controlled MODEL_OUTPUT_TRUNCATED failure ============
{
  const client = fakeClient({ obligations: [{ type: "assignment", title: "Partial" }] }, { stopReason: "max_tokens" });
  let caught = null;
  try {
    await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  } catch (err) {
    caught = err;
  }
  ok("Throws when stop_reason is max_tokens, even if a tool_use block is present", caught !== null);
  ok("Thrown error is an ExtractionError instance", caught instanceof ExtractionError);
  ok("Uses the MODEL_OUTPUT_TRUNCATED code, not a generic error", caught?.code === EXTRACTION_ERROR_CODES.TRUNCATED);
  ok("Carries the stop_reason for logging", caught?.stopReason === "max_tokens");
  ok("Never treated as generic 'invalid JSON' — code is specific", caught?.code !== undefined && !caught.message.toLowerCase().includes("not valid json"));
}

// ============ Missing tool_use block produces a controlled MODEL_TOOL_OUTPUT_MISSING failure ============
{
  const client = { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "I could not find any obligations." }] }) } };
  let caught = null;
  try {
    await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  } catch (err) {
    caught = err;
  }
  ok("Throws a controlled error when no tool_use block is present at all", caught instanceof ExtractionError);
  ok("Uses the MODEL_TOOL_OUTPUT_MISSING code", caught?.code === EXTRACTION_ERROR_CODES.TOOL_OUTPUT_MISSING);
  ok("No regex/prose repair is attempted — the stray text block's content never leaks into the error", !caught.message.includes("I could not find"));
}
{
  // A tool_use block for a DIFFERENT tool name (shouldn't happen given
  // forced tool_choice, but fails safe rather than trusting it).
  const client = fakeClient({ obligations: [{ type: "assignment", title: "X" }] }, { toolName: "some_other_tool" });
  let caught = null;
  try {
    await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  } catch (err) {
    caught = err;
  }
  ok("A tool_use block for the wrong tool name is treated as missing, not trusted", caught?.code === EXTRACTION_ERROR_CODES.TOOL_OUTPUT_MISSING);
}
{
  const client = { messages: { create: async () => ({ stop_reason: "end_turn", content: [] }) } };
  let caught = null;
  try {
    await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  } catch (err) {
    caught = err;
  }
  ok("An empty content array is treated as a missing tool_use block, not a crash", caught?.code === EXTRACTION_ERROR_CODES.TOOL_OUTPUT_MISSING);
}

// ============ sourceUrl attribution + cross-validation (#26, Commit 5 correction) ============
{
  const client = fakeClient({
    obligations: [
      { type: "assignment", title: "From the email body", sourceUrl: null },
      { type: "school_event", title: "From the linked page", sourceUrl: "https://school.edu/signup" },
    ],
  });
  const result = await extractObligationsFromEmail({
    client,
    emailBodyText: "body",
    pages: [{ url: "https://school.edu/signup", text: "Signup details." }],
  });
  const fromBody = result.obligations.find((o) => o.title === "From the email body");
  const fromPage = result.obligations.find((o) => o.title === "From the linked page");
  ok("An obligation with sourceUrl: null is kept as email-body-attributed", fromBody.sourceUrl === null);
  ok("An obligation whose sourceUrl matches an actually-fetched page is kept as-is", fromPage.sourceUrl === "https://school.edu/signup");
}
{
  // The model hallucinates/mistypes a URL that was never actually fetched
  // for this email — must never be trusted as a real attribution.
  const client = fakeClient({
    obligations: [{ type: "assignment", title: "X", sourceUrl: "https://not-a-real-page.example/made-up" }],
  });
  const result = await extractObligationsFromEmail({
    client,
    emailBodyText: "body",
    pages: [{ url: "https://school.edu/signup", text: "Signup details." }],
  });
  ok("A sourceUrl that doesn't match any actually-fetched page is discarded (falls back to email-body attribution)", result.obligations[0].sourceUrl === null);
}
{
  // No pages were fetched at all for this email — any sourceUrl the model
  // returns must be discarded, since there is nothing it could validly
  // refer to.
  const client = fakeClient({ obligations: [{ type: "assignment", title: "X", sourceUrl: "https://school.edu/signup" }] });
  const result = await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  ok("With no pages provided at all, any sourceUrl the model returns is discarded", result.obligations[0].sourceUrl === null);
}
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [{ url: "https://school.edu/x", text: "y" }] });
  ok("The tool's input_schema documents the sourceUrl field", "sourceUrl" in (captured.tools[0].input_schema.properties.obligations.items.properties));
}

// ============ startTime/endTime passthrough + schema content (#26, Commit 5 review-UX fix) ============
{
  const client = fakeClient({
    obligations: [
      { type: "school_event", title: "Back to School Night", date: "2026-09-15", startTime: "18:00", endTime: "19:30" },
    ],
  });
  const result = await extractObligationsFromEmail({ client, emailBodyText: "Back to School Night is 6:00 PM - 7:30 PM on Sept 15.", pages: [] });
  ok("startTime passes through the shared sanitization contract unchanged", result.obligations[0].startTime === "18:00");
  ok("endTime passes through the shared sanitization contract unchanged", result.obligations[0].endTime === "19:30");
}
{
  // No time mentioned in the source at all — sanitizeObligation (shared
  // with the photo pipeline) already defaults missing/invalid fields to
  // null; nothing in this module invents a value.
  const client = fakeClient({ obligations: [{ type: "test", title: "Spelling Test", date: "2026-09-20" }] });
  const result = await extractObligationsFromEmail({ client, emailBodyText: "Spelling test Friday.", pages: [] });
  ok("No fabricated startTime when the source gives none", result.obligations[0].startTime === null);
  ok("No fabricated endTime when the source gives none", result.obligations[0].endTime === null);
}
{
  // A malformed/non-HH:MM time from the model is dropped, never trusted
  // as-is (same defensive posture as every other sanitized field).
  const client = fakeClient({ obligations: [{ type: "school_event", title: "X", startTime: "6pm", endTime: "not-a-time" }] });
  const result = await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  ok("A malformed startTime is dropped to null rather than trusted as-is", result.obligations[0].startTime === null);
  ok("A malformed endTime is dropped to null rather than trusted as-is", result.obligations[0].endTime === null);
}
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  const obligationSchema = captured.tools[0].input_schema.properties.obligations.items.properties;
  ok("The tool's input_schema documents startTime", "startTime" in obligationSchema);
  ok("The tool's input_schema documents endTime", "endTime" in obligationSchema);
  ok("The prompt explicitly instructs never to infer/guess a time", captured.system.toLowerCase().includes("never infer"));
  ok("The prompt explicitly instructs not to set endTime from a single start time alone", captured.system.includes("endTime stays null"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
