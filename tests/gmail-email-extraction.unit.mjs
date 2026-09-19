/**
 * Focused unit tests for api/_emailExtraction.js — the text-only
 * counterpart to api/extract-obligations.js's photo pipeline (#26,
 * Commit 5). The Anthropic client is injected (a fake `messages.create`),
 * so no live ANTHROPIC_API_KEY or network access is needed — same
 * constraint already documented in tests/extract-obligations.unit.mjs.
 *
 * Usage: node tests/gmail-email-extraction.unit.mjs
 */
import { extractObligationsFromEmail } from "../api/_emailExtraction.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

function fakeClient(responseJson, { capture } = {}) {
  return {
    messages: {
      create: async (params) => {
        if (capture) capture(params);
        return { content: [{ text: JSON.stringify(responseJson) }] };
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
    googleDocUrls: [],
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
    googleDocUrls: [],
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
    googleDocUrls: [],
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
    googleDocUrls: [],
  });
  const userText = captured.messages[0].content[0].text;
  ok("Still labels the page by URL even when its text is empty", userText.includes("https://school.edu/blocked"));
  ok("Explicitly notes the content could not be retrieved, rather than showing a blank section", userText.includes("could not be retrieved"));
}

// ============ Google Doc URLs are surfaced as identified-but-not-read ============
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({
    client,
    emailBodyText: "body",
    pages: [],
    googleDocUrls: ["https://docs.google.com/document/d/abc/edit"],
  });
  const userText = captured.messages[0].content[0].text;
  ok("Lists a linked Google Doc URL", userText.includes("https://docs.google.com/document/d/abc/edit"));
  ok("Explicitly instructs not to describe its content (it was never fetched)", userText.toLowerCase().includes("not retrieved"));
}
{
  let captured;
  const client = fakeClient({ obligations: [] }, { capture: (p) => (captured = p) });
  await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [], googleDocUrls: [] });
  const userText = captured.messages[0].content[0].text;
  ok("No Google Docs section appears at all when there are none linked", !userText.includes("GOOGLE DOCS"));
}

// ============ Malformed model output ============
{
  const client = { messages: { create: async () => ({ content: [{ text: "not json at all" }] }) } };
  let threw = false;
  try {
    await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  } catch {
    threw = true;
  }
  ok("Throws when the model's output isn't valid JSON", threw);
}

// ============ Markdown code-fence stripping (same as the photo pipeline) ============
{
  const client = {
    messages: {
      create: async () => ({ content: [{ text: "```json\n" + JSON.stringify({ obligations: [] }) + "\n```" }] }),
    },
  };
  const result = await extractObligationsFromEmail({ client, emailBodyText: "body", pages: [] });
  ok("Strips a markdown code fence around the JSON before parsing", Array.isArray(result.obligations));
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
    googleDocUrls: [],
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
    googleDocUrls: [],
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
  ok("The prompt's JSON schema documents the sourceUrl field", captured.system.includes('"sourceUrl"'));
  ok("The prompt instructs the model how to set sourceUrl correctly", captured.system.toLowerCase().includes("sourceurl"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
