/**
 * Focused unit tests for src/data/attentionSummary.js — the pure "Needs
 * Attention" derivation (MVP attention layer). Pure function, no I/O, no
 * mocking needed: every test just calls deriveAttentionSummary with
 * different injected state shapes and checks the returned summary.
 *
 * Usage: node tests/attention-summary.unit.mjs
 */
import { deriveAttentionSummary } from "../src/data/attentionSummary.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ No issues at all ============
{
  const summary = deriveAttentionSummary({ pendingCandidates: [], gmailStatus: { connected: true, needsReconnect: false }, calendarIssues: [] });
  ok("No issues: totalAttentionCount is 0", summary.totalAttentionCount === 0);
  ok("No issues: items is an empty array", Array.isArray(summary.items) && summary.items.length === 0);
}

// ============ Called with nothing at all (defaults) ============
{
  const summary = deriveAttentionSummary();
  ok("No arguments at all: totalAttentionCount is 0 (safe defaults, never crashes)", summary.totalAttentionCount === 0);
  ok("No arguments at all: items is an empty array", summary.items.length === 0);
}

// ============ Pending Review Inbox candidates produce Review Inbox attention ============
{
  const summary = deriveAttentionSummary({ pendingCandidates: [{ id: "a" }, { id: "b" }, { id: "c" }] });
  ok("3 pending candidates: exactly one review_inbox item", summary.items.filter((i) => i.type === "review_inbox").length === 1);
  const item = summary.items.find((i) => i.type === "review_inbox");
  ok("review_inbox item count is 3", item.count === 3);
  ok("review_inbox item title is 'Review Inbox'", item.title === "Review Inbox");
  ok("review_inbox item description mentions the count and pluralizes correctly", item.description === "3 items need review");
  ok("review_inbox item actionKey is open_review_inbox", item.actionKey === "open_review_inbox");
  ok("totalAttentionCount reflects the 3 pending candidates", summary.totalAttentionCount === 3);
}

// ============ Singular pluralization ============
{
  const summary = deriveAttentionSummary({ pendingCandidates: [{ id: "a" }] });
  const item = summary.items.find((i) => i.type === "review_inbox");
  ok("1 pending candidate: description uses singular 'item' and 'needs'", item.description === "1 item needs review");
}

// ============ Gmail reconnect state produces Gmail attention ============
{
  const summary = deriveAttentionSummary({ gmailStatus: { connected: false, needsReconnect: true } });
  ok("needsReconnect: exactly one gmail item", summary.items.filter((i) => i.type === "gmail").length === 1);
  const item = summary.items.find((i) => i.type === "gmail");
  ok("gmail item title is 'Gmail'", item.title === "Gmail");
  ok("gmail item description is 'Reconnect required'", item.description === "Reconnect required");
  ok("gmail item actionKey is open_gmail_settings", item.actionKey === "open_gmail_settings");
  ok("gmail item counts as 1 toward totalAttentionCount", item.count === 1 && summary.totalAttentionCount === 1);
}

// ============ Gmail connected (no reconnect needed) produces no attention ============
{
  const summary = deriveAttentionSummary({ gmailStatus: { connected: true, needsReconnect: false } });
  ok("Gmail connected, no reconnect needed: no gmail item", summary.items.filter((i) => i.type === "gmail").length === 0);
}

// ============ Gmail never connected at all (not yet set up) does NOT produce a reconnect row ============
{
  // needsReconnect is specifically "was connected, now needs re-auth" — a
  // household that has simply never connected Gmail must not show a
  // false "Reconnect required" attention row.
  const summary = deriveAttentionSummary({ gmailStatus: { connected: false, needsReconnect: false } });
  ok("Never connected (connected:false, needsReconnect:false): no gmail item", summary.items.filter((i) => i.type === "gmail").length === 0);
}

// ============ Calendar publish failures produce Calendar attention ============
{
  const summary = deriveAttentionSummary({ calendarIssues: [{ id: "item-1" }, { id: "item-2" }] });
  ok("2 calendar issues: exactly one calendar item", summary.items.filter((i) => i.type === "calendar").length === 1);
  const item = summary.items.find((i) => i.type === "calendar");
  ok("calendar item title is 'Google Calendar'", item.title === "Google Calendar");
  ok("calendar item description mentions the count and pluralizes correctly", item.description === "2 items need retry");
  ok("calendar item actionKey is open_review_inbox (the existing Calendar-issues/retry surface lives in Review Inbox)", item.actionKey === "open_review_inbox");
  ok("calendar item count is 2", item.count === 2);
}

// ============ Singular calendar pluralization ============
{
  const summary = deriveAttentionSummary({ calendarIssues: [{ id: "item-1" }] });
  const item = summary.items.find((i) => i.type === "calendar");
  ok("1 calendar issue: description uses singular 'item' and 'needs'", item.description === "1 item needs retry");
}

// ============ Multiple conditions appear together, with correct counts ============
{
  const summary = deriveAttentionSummary({
    pendingCandidates: [{ id: "a" }, { id: "b" }],
    gmailStatus: { connected: false, needsReconnect: true },
    calendarIssues: [{ id: "item-1" }],
  });
  ok("All three conditions present: exactly 3 items", summary.items.length === 3);
  ok("Items appear in Review Inbox, Gmail, Google Calendar order", summary.items.map((i) => i.type).join(",") === "review_inbox,gmail,calendar");
  ok("Review Inbox count is correct within the combined summary", summary.items.find((i) => i.type === "review_inbox").count === 2);
  ok("Gmail count is correct within the combined summary", summary.items.find((i) => i.type === "gmail").count === 1);
  ok("Calendar count is correct within the combined summary", summary.items.find((i) => i.type === "calendar").count === 1);
  ok("totalAttentionCount sums all three conditions (2 + 1 + 1 = 4)", summary.totalAttentionCount === 4);
}

// ============ Only some conditions present ============
{
  const summary = deriveAttentionSummary({
    pendingCandidates: [],
    gmailStatus: { connected: false, needsReconnect: true },
    calendarIssues: [{ id: "item-1" }, { id: "item-2" }, { id: "item-3" }],
  });
  ok("Review Inbox absent, Gmail + Calendar present: exactly 2 items", summary.items.length === 2);
  ok("No review_inbox item when there are no pending candidates", !summary.items.some((i) => i.type === "review_inbox"));
  ok("totalAttentionCount reflects only the present conditions (1 + 3 = 4)", summary.totalAttentionCount === 4);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
