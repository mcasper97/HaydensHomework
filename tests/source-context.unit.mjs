/**
 * Focused unit tests for src/organizer/sourceContext.js's buildSourceContext
 * (#26, Commit 5 live-validation fix — CandidateReviewModal's compact
 * "Source" section). Pure function, zero JSX/React/network — takes plain
 * SourceRecord-shaped objects (exactly what
 * src/data/sourceRecordsRepository.js's getSourceRecord returns) and
 * produces a plain display object.
 *
 * Usage: node tests/source-context.unit.mjs
 */
import { buildSourceContext } from "../src/organizer/sourceContext.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ 1/2/3. Email candidate: sender name + email, subject, received date ============
{
  const record = {
    sourceType: "gmail_email",
    metadata: {
      senderName: "Michelle Manson",
      senderEmail: "mmanson@school.org",
      subject: "Weekly Classroom Update",
      receivedAt: "2026-09-18T15:30:00.000Z",
    },
  };
  const ctx = buildSourceContext(record);
  ok("Email context reports kind: email", ctx.kind === "email");
  ok("Displays sender name + email together", ctx.senderLine === "Michelle Manson <mmanson@school.org>");
  ok("Displays the subject", ctx.subject === "Weekly Classroom Update");
  ok("Displays a formatted received date", ctx.receivedDate === "Sep 18, 2026");
}

// ============ 4. Missing sender name falls back to email address alone ============
{
  const record = {
    sourceType: "gmail_email",
    metadata: { senderName: null, senderEmail: "office@school.org", subject: "Reminder", receivedAt: "2026-09-01T00:00:00.000Z" },
  };
  const ctx = buildSourceContext(record);
  ok("With no senderName, senderLine is just the email address", ctx.senderLine === "office@school.org");
  ok("No stray angle brackets or 'null' text leak into the display", !ctx.senderLine.includes("null") && !ctx.senderLine.includes("<"));
}
ok("With no senderEmail at all, senderLine is null rather than a broken string", buildSourceContext({ sourceType: "gmail_email", metadata: {} }).senderLine === null);
ok("Missing receivedAt yields a null receivedDate rather than 'Invalid Date'", buildSourceContext({ sourceType: "gmail_email", metadata: { senderEmail: "a@b.com" } }).receivedDate === null);
ok("A malformed receivedAt string yields null rather than 'Invalid Date'", buildSourceContext({ sourceType: "gmail_email", metadata: { senderEmail: "a@b.com", receivedAt: "not-a-date" } }).receivedDate === null);
ok("Missing subject yields null, not an empty string", buildSourceContext({ sourceType: "gmail_email", metadata: { senderEmail: "a@b.com" } }).subject === null);

// ============ 5. Webpage candidate: page title, or hostname fallback ============
{
  const webpageRecord = {
    sourceType: "webpage",
    title: "Ms. Rivera's Classroom Page",
    metadata: { sourceUrl: "https://school.edu/rivera/classroom", parentEmailSourceRecordId: "email-1" },
  };
  const parentRecord = {
    sourceType: "gmail_email",
    metadata: { senderName: "Michelle Manson", senderEmail: "mmanson@school.org", subject: "Weekly Classroom Update" },
  };
  const ctx = buildSourceContext(webpageRecord, parentRecord);
  ok("Webpage context reports kind: webpage", ctx.kind === "webpage");
  ok("Uses the page's actual title when available", ctx.pageTitle === "Ms. Rivera's Classroom Page");
}
{
  // No <title> was found when the page was fetched.
  const webpageRecord = { sourceType: "webpage", title: null, metadata: { sourceUrl: "https://school.edu/rivera/classroom" } };
  const ctx = buildSourceContext(webpageRecord, null);
  ok("Falls back to the URL's hostname when there's no page title", ctx.pageTitle === "school.edu");
}
{
  const webpageRecord = { sourceType: "webpage", title: null, metadata: {} };
  ok("No title and no sourceUrl at all: pageTitle is null, not a crash", buildSourceContext(webpageRecord, null).pageTitle === null);
}

// ============ 6. Webpage candidate displays the originating email's sender ============
{
  const webpageRecord = { sourceType: "webpage", title: "Signup Page", metadata: { sourceUrl: "https://school.edu/signup", parentEmailSourceRecordId: "email-1" } };
  const parentRecord = { sourceType: "gmail_email", metadata: { senderName: "Michelle Manson", senderEmail: "mmanson@school.org", subject: "Weekly Classroom Update" } };
  const ctx = buildSourceContext(webpageRecord, parentRecord);
  ok("Webpage context's senderLine comes from the PARENT email record", ctx.senderLine === "Michelle Manson <mmanson@school.org>");
  ok("Webpage context's subject comes from the parent email too", ctx.subject === "Weekly Classroom Update");
}
{
  // The parent record couldn't be resolved (deleted, or lookup failed) —
  // must degrade gracefully, never throw.
  const webpageRecord = { sourceType: "webpage", title: "Signup Page", metadata: { sourceUrl: "https://school.edu/signup" } };
  let threw = false;
  let ctx;
  try {
    ctx = buildSourceContext(webpageRecord, null);
  } catch {
    threw = true;
  }
  ok("Missing parent email record doesn't throw", !threw);
  ok("Missing parent email record: senderLine and subject are null, not undefined/crash", ctx.senderLine === null && ctx.subject === null);
}

// ============ 7. Source display resolves through SourceRecord provenance (shape proof) ============
{
  // buildSourceContext's ONLY inputs are SourceRecord-shaped objects (what
  // getSourceRecord returns from Firestore) — proving it never reads
  // anything from a transient API response shape (e.g. no
  // gmailMessageId/obligations/targetType fields exist on its input here
  // at all) confirms the display is sourced from persisted provenance,
  // not ephemeral Check Email response data.
  const persistedOnly = {
    id: "sr-123", // a real Firestore doc id, not present on a transient result
    sourceType: "gmail_email",
    processingStatus: "extracted",
    capturedAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    metadata: { senderName: "Michelle Manson", senderEmail: "mmanson@school.org", subject: "Weekly Classroom Update", receivedAt: "2026-09-18T15:30:00.000Z" },
  };
  const ctx = buildSourceContext(persistedOnly);
  ok("Builds correctly from a full persisted SourceRecord shape (id/processingStatus/capturedAt present, as Firestore would return)", ctx.senderLine === "Michelle Manson <mmanson@school.org>" && ctx.subject === "Weekly Classroom Update");
}

// ============ 8. Photo-ingestion review remains unchanged: non-email/webpage sourceTypes produce no context ============
ok("An image_capture SourceRecord produces no source context (photo ingestion unaffected)", buildSourceContext({ sourceType: "image_capture", metadata: {} }) === null);
ok("A csv_import SourceRecord produces no source context", buildSourceContext({ sourceType: "csv_import", metadata: {} }) === null);
ok("A legacy_family_event SourceRecord produces no source context", buildSourceContext({ sourceType: "legacy_family_event", metadata: {} }) === null);
ok("A manual SourceRecord produces no source context", buildSourceContext({ sourceType: "manual", metadata: {} }) === null);
ok("A null sourceRecord (e.g. lookup failed) produces no source context, without throwing", buildSourceContext(null) === null);
ok("An undefined sourceRecord produces no source context, without throwing", buildSourceContext(undefined) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
