/**
 * Focused unit tests for api/_gmailIngestionCore.js's scanApprovedSenderEmails
 * — the shared "find new qualifying emails from approved senders and
 * extract obligations from them" pipeline, extracted out of
 * api/gmail-check-email.js so both that manual endpoint and the automatic
 * scheduled-ingestion runner (api/_gmailIngestionRunner.js) call the exact
 * same function rather than duplicating it.
 *
 * Every external collaborator (Gmail connection/sender/dedupe reads,
 * token refresh, Gmail API calls, MIME decode, link extraction, webpage/
 * Google-Doc fetch, obligation extraction) is injectable via `deps`, so
 * these tests never touch real Firestore, Gmail, or the Anthropic API —
 * no module mocking needed.
 *
 * Usage: node tests/gmail-ingestion-core-scan.unit.mjs
 */
import { scanApprovedSenderEmails, SCAN_ERROR_CODES } from "../api/_gmailIngestionCore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const UID = "gmail-scan-uid-1";

function baseDeps(overrides = {}) {
  return {
    getConnection: async () => ({ refreshToken: "rt-1", emailAddress: "parent@example.com" }),
    getSenders: async () => [{ email: "school@example.com", targetType: "child", childId: "hayden" }],
    getProcessedIds: async () => new Set(),
    refreshAccessTokenFn: async () => ({ access_token: "at-1" }),
    listMessageIds: async () => [{ id: "msg-1", threadId: "thread-1" }],
    getMessage: async () => ({}), // raw payload unused — decodeMessage is faked below
    decodeMessage: () => ({
      gmailMessageId: "msg-1",
      gmailThreadId: "thread-1",
      senderEmail: "school@example.com",
      senderName: "School Office",
      subject: "Spelling test Friday",
      receivedAt: "2026-01-14T10:00:00.000Z",
      textBody: "There is a spelling test on Friday.",
      htmlBody: null,
    }),
    extractLinks: () => [],
    extractPlainTextLinks: () => [],
    fetchWebpage: async () => ({ ok: false }),
    toReadableText: (html) => html,
    getPageTitle: () => null,
    fetchGoogleDoc: async () => ({ status: "fetch_failed" }),
    extractObligations: async () => ({
      obligations: [{ type: "test", title: "Spelling Test", date: "2026-01-16", extractionConfidence: 0.9, sourceUrl: null }],
    }),
    now: new Date("2026-01-15T12:00:00.000Z"),
    ...overrides,
  };
}

async function run() {
  // ============ Approved sender message is processed ============
  {
    const scan = await scanApprovedSenderEmails(UID, baseDeps());
    ok("scan succeeds (ok:true) for a connected household with senders", scan.ok === true);
    ok("an approved sender's message is included in results", scan.results.length === 1);
    ok("the result carries the extracted obligation", scan.results[0]?.obligations?.length === 1);
    ok("matchedCount reflects the one new message found", scan.matchedCount === 1);
  }

  // ============ Unapproved sender is skipped ============
  {
    const calls = { extractObligations: 0 };
    const deps = baseDeps({
      decodeMessage: () => ({
        gmailMessageId: "msg-2",
        gmailThreadId: "thread-2",
        senderEmail: "stranger@unknown.com", // not in getSenders() above
        senderName: "Unknown",
        subject: "Not approved",
        receivedAt: "2026-01-14T10:00:00.000Z",
        textBody: "Should never be extracted.",
        htmlBody: null,
      }),
      extractObligations: async () => { calls.extractObligations += 1; return { obligations: [] }; },
    });
    const scan = await scanApprovedSenderEmails(UID, deps);
    ok("a message from an unapproved sender produces no result entry", scan.results.length === 0);
    ok("an unapproved sender's message is never even sent to extraction", calls.extractObligations === 0);
  }

  // ============ Sender mapping resolves the correct child ============
  {
    const deps = baseDeps({
      getSenders: async () => [
        { email: "teacher-a@example.com", targetType: "child", childId: "hayden" },
        { email: "teacher-b@example.com", targetType: "child", childId: "riley" },
      ],
      listMessageIds: async () => [{ id: "msg-a" }, { id: "msg-b" }],
      decodeMessage: (raw) => raw, // pass the fixture straight through (see getMessage below)
      getMessage: async ({ messageId }) => ({
        gmailMessageId: messageId,
        gmailThreadId: `${messageId}-thread`,
        senderEmail: messageId === "msg-a" ? "teacher-a@example.com" : "teacher-b@example.com",
        senderName: null,
        subject: "Homework",
        receivedAt: "2026-01-14T10:00:00.000Z",
        textBody: "Some homework.",
        htmlBody: null,
      }),
      extractObligations: async () => ({ obligations: [] }),
    });
    const scan = await scanApprovedSenderEmails(UID, deps);
    const a = scan.results.find((r) => r.gmailMessageId === "msg-a");
    const b = scan.results.find((r) => r.gmailMessageId === "msg-b");
    ok("teacher-a's message resolves to child hayden (not swapped)", a?.targetChildId === "hayden");
    ok("teacher-b's message resolves to child riley (not swapped)", b?.targetChildId === "riley");
  }

  // ============ Already-processed Gmail message is skipped idempotently ============
  {
    const calls = { getMessage: 0 };
    const deps = baseDeps({
      getProcessedIds: async () => new Set(["msg-1"]), // same id listMessageIds returns below
      listMessageIds: async () => [{ id: "msg-1" }],
      getMessage: async (args) => { calls.getMessage += 1; return {}; },
    });
    const scan = await scanApprovedSenderEmails(UID, deps);
    ok("an already-processed message produces no result entry", scan.results.length === 0);
    ok("an already-processed message is never even fetched (true idempotent skip, not just a later dedupe)", calls.getMessage === 0);
    ok("matchedCount excludes the already-processed message", scan.matchedCount === 0);
  }

  // ============ Auth/connection failure shapes ============
  {
    const scan = await scanApprovedSenderEmails(UID, baseDeps({ getConnection: async () => null }));
    ok("no Gmail connection returns ok:false with NOT_CONNECTED", scan.ok === false && scan.code === SCAN_ERROR_CODES.NOT_CONNECTED);
  }
  {
    const scan = await scanApprovedSenderEmails(UID, baseDeps({ getSenders: async () => [] }));
    ok("no approved senders returns ok:false with NO_SENDERS", scan.ok === false && scan.code === SCAN_ERROR_CODES.NO_SENDERS);
  }
  {
    const err = new Error("invalid_grant");
    err.isInvalidGrant = true;
    let reconnectMarked = false;
    const scan = await scanApprovedSenderEmails(UID, baseDeps({
      refreshAccessTokenFn: async () => { throw err; },
      markNeedsReconnect: async () => { reconnectMarked = true; },
    }));
    ok(
      "an invalid_grant token refresh returns ok:false with RECONNECT_REQUIRED and needsReconnect:true",
      scan.ok === false && scan.code === SCAN_ERROR_CODES.RECONNECT_REQUIRED && scan.needsReconnect === true
    );
    ok("the connection is marked needsReconnect", reconnectMarked === true);
  }
  {
    const scan = await scanApprovedSenderEmails(UID, baseDeps({
      refreshAccessTokenFn: async () => { throw new Error("network down"); },
    }));
    ok("a non-invalid_grant token refresh failure returns ok:false with UNREACHABLE", scan.ok === false && scan.code === SCAN_ERROR_CODES.UNREACHABLE);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
