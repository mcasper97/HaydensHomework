/**
 * Focused unit tests for src/data/notificationDecision.js — the pure
 * email-notification dedupe decision layer (MVP attention -> notification
 * slice). Pure functions, no I/O, no mocking needed.
 *
 * Gmail episode-scoping correction: the Gmail attention key is now
 * "gmail:reconnect:<connectedAt>" (episode-scoped via EXISTING Gmail
 * connection state, never a fabricated timestamp) rather than the old
 * constant "gmail:reconnect" — see notificationDecision.js's own module
 * doc for why. Review/calendar keys are unchanged.
 *
 * Usage: node tests/notification-decision.unit.mjs
 */
import { buildAttentionKey, shouldNotify } from "../src/data/notificationDecision.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const CONNECTED_AT_1 = "2026-01-01T00:00:00.000Z";
const CONNECTED_AT_2 = "2026-03-01T00:00:00.000Z";

// ============ New Review Inbox candidate -> eligible ============
{
  const decision = shouldNotify({ attention: { type: "review", id: "cand-1" }, existingDelivery: null });
  ok("New Review Inbox candidate (no existing delivery): eligible", decision.eligible === true);
  ok("... reason is 'unseen'", decision.reason === "unseen");
  ok("... attentionKey is review:cand-1", decision.attentionKey === "review:cand-1");
}

// ============ Same candidate after successful notification -> suppressed ============
{
  const existingDelivery = { type: "review", attentionKey: "review:cand-1", createdAt: "2026-01-01T00:00:00.000Z", sentAt: "2026-01-01T00:05:00.000Z", status: "sent" };
  const decision = shouldNotify({ attention: { type: "review", id: "cand-1" }, existingDelivery });
  ok("Same candidate after a successful ('sent') notification: suppressed", decision.eligible === false);
  ok("... reason is 'already_sent'", decision.reason === "already_sent");
}

// ============ New Calendar failed Item -> eligible ============
{
  const decision = shouldNotify({ attention: { type: "calendar", id: "item-9" }, existingDelivery: null });
  ok("New Calendar publish failure (no existing delivery): eligible", decision.eligible === true);
  ok("... reason is 'unseen'", decision.reason === "unseen");
  ok("... attentionKey is calendar:item-9", decision.attentionKey === "calendar:item-9");
}

// ============ Same failed Item after successful notification -> suppressed ============
{
  const existingDelivery = { type: "calendar", attentionKey: "calendar:item-9", createdAt: "2026-01-01T00:00:00.000Z", sentAt: "2026-01-01T00:05:00.000Z", status: "sent" };
  const decision = shouldNotify({ attention: { type: "calendar", id: "item-9" }, existingDelivery });
  ok("Same failed Item after a successful notification: suppressed", decision.eligible === false);
  ok("... reason is 'already_sent'", decision.reason === "already_sent");
}

// ============ Gmail reconnect -> eligible initially ============
{
  const decision = shouldNotify({ attention: { type: "gmail", connectedAt: CONNECTED_AT_1 }, existingDelivery: null });
  ok("Gmail reconnect (no existing delivery): eligible", decision.eligible === true);
  ok("... reason is 'unseen'", decision.reason === "unseen");
  ok("... attentionKey is episode-scoped to connectedAt", decision.attentionKey === `gmail:reconnect:${CONNECTED_AT_1}`);
}

// ============ Failed delivery -> retry eligible ============
{
  const existingDelivery = { type: "calendar", attentionKey: "calendar:item-9", createdAt: "2026-01-01T00:00:00.000Z", sentAt: null, status: "failed" };
  const decision = shouldNotify({ attention: { type: "calendar", id: "item-9" }, existingDelivery });
  ok("A prior failed delivery: eligible for retry", decision.eligible === true);
  ok("... reason is 'retry_after_failure'", decision.reason === "retry_after_failure");
}
{
  // Same rule for the other two types too — retry eligibility is not
  // type-specific.
  const gmailRetry = shouldNotify({ attention: { type: "gmail", connectedAt: CONNECTED_AT_1 }, existingDelivery: { status: "failed" } });
  ok("Gmail: a prior failed delivery is also retry-eligible", gmailRetry.eligible === true && gmailRetry.reason === "retry_after_failure");
  const reviewRetry = shouldNotify({ attention: { type: "review", id: "cand-2" }, existingDelivery: { status: "failed" } });
  ok("Review Inbox: a prior failed delivery is also retry-eligible", reviewRetry.eligible === true && reviewRetry.reason === "retry_after_failure");
}

// ============ An unresolved prior delivery (never reached sent/failed) stays eligible ============
{
  const decision = shouldNotify({ attention: { type: "review", id: "cand-3" }, existingDelivery: { status: "pending" } });
  ok("A delivery record stuck at 'pending' (e.g. crash mid-attempt): still eligible, never silently suppressed", decision.eligible === true);
  ok("... reason is 'unresolved_prior_delivery'", decision.reason === "unresolved_prior_delivery");
}

// ============ Deterministic attention key is stable ============
{
  const k1 = buildAttentionKey({ type: "review", id: "cand-1" });
  const k2 = buildAttentionKey({ type: "review", id: "cand-1" });
  ok("buildAttentionKey is stable across repeated calls with the same input (review)", k1 === k2 && k1 === "review:cand-1");
}
{
  const k1 = buildAttentionKey({ type: "calendar", id: "item-1" });
  const k2 = buildAttentionKey({ type: "calendar", id: "item-1" });
  ok("buildAttentionKey is stable across repeated calls with the same input (calendar)", k1 === k2 && k1 === "calendar:item-1");
}

// ============ Gmail: 1. same connectedAt -> same attention key ============
{
  const k1 = buildAttentionKey({ type: "gmail", connectedAt: CONNECTED_AT_1 });
  const k2 = buildAttentionKey({ type: "gmail", connectedAt: CONNECTED_AT_1 });
  ok("Same connectedAt (same broken-connection episode): stable, identical Gmail attention key across repeated checks", k1 === k2 && k1 === `gmail:reconnect:${CONNECTED_AT_1}`);
}

// ============ Gmail: 2. same episode after a sent delivery -> suppressed ============
{
  const attention = { type: "gmail", connectedAt: CONNECTED_AT_1 };
  const existingDelivery = { type: "gmail", attentionKey: `gmail:reconnect:${CONNECTED_AT_1}`, createdAt: CONNECTED_AT_1, sentAt: "2026-01-02T00:00:00.000Z", status: "sent" };
  const decision = shouldNotify({ attention, existingDelivery });
  ok("Repeated checks while still broken (same connectedAt, prior notification sent): suppressed", decision.eligible === false);
  ok("... reason is 'already_sent'", decision.reason === "already_sent");
}

// ============ Gmail: 3. different connectedAt -> different attention key ============
{
  const k1 = buildAttentionKey({ type: "gmail", connectedAt: CONNECTED_AT_1 });
  const k2 = buildAttentionKey({ type: "gmail", connectedAt: CONNECTED_AT_2 });
  ok("A different connectedAt produces a different Gmail attention key", k1 !== k2);
}

// ============ Gmail: 4. a later reconnect episode is eligible again ============
{
  // The delivery on file was recorded for the OLD episode (old connectedAt).
  // A successful reconnect changes connectedAt (existing Gmail connection
  // state, per api/_gmailConnectionsStore.js's upsertGmailConnection); a
  // LATER disconnect is evaluated with the NEW connectedAt, producing a
  // key the old delivery record never matches.
  const oldEpisodeDelivery = { type: "gmail", attentionKey: `gmail:reconnect:${CONNECTED_AT_1}`, createdAt: CONNECTED_AT_1, sentAt: "2026-01-02T00:00:00.000Z", status: "sent" };
  const newEpisodeAttention = { type: "gmail", connectedAt: CONNECTED_AT_2 };

  // A real caller looks up the delivery record by the NEW episode's key,
  // which was never recorded — simulated here as no existingDelivery for
  // the new key (the old one is simply a different document/key).
  const decision = shouldNotify({ attention: newEpisodeAttention, existingDelivery: null });
  ok("A later reconnect episode (new connectedAt, no delivery recorded for ITS key yet): eligible again", decision.eligible === true);
  ok("... reason is 'unseen'", decision.reason === "unseen");
  ok("... its attentionKey does not match the old episode's delivery record's key", decision.attentionKey !== oldEpisodeDelivery.attentionKey);
}

// ============ Gmail: 5. missing connectedAt does not create an unstable key ============
{
  let threw = false;
  let err = null;
  try { buildAttentionKey({ type: "gmail" }); } catch (e) { threw = true; err = e; }
  ok("buildAttentionKey throws for a 'gmail' attention with no connectedAt (fails safely, never fabricates a timestamp)", threw);
  ok("The failure is a real Error, not a silently-swallowed undefined key", err instanceof Error);
}
{
  let threw = false;
  try { buildAttentionKey({ type: "gmail", connectedAt: null }); } catch { threw = true; }
  ok("buildAttentionKey also throws for an explicit null connectedAt", threw);
}
{
  let threw = false;
  try { shouldNotify({ attention: { type: "gmail" }, existingDelivery: null }); } catch { threw = true; }
  ok("shouldNotify likewise fails safely (throws) for a gmail attention missing connectedAt, rather than inventing a key", threw);
}

// ============ 6. Review and Calendar keys remain unchanged by the Gmail correction ============
{
  ok("Review key format is unchanged: review:<id>, no timestamp involved", buildAttentionKey({ type: "review", id: "cand-42" }) === "review:cand-42");
  ok("Calendar key format is unchanged: calendar:<id>, no timestamp involved", buildAttentionKey({ type: "calendar", id: "item-42" }) === "calendar:item-42");
}

// ============ Different attention objects do not collide ============
{
  const keys = [
    buildAttentionKey({ type: "review", id: "cand-1" }),
    buildAttentionKey({ type: "review", id: "cand-2" }),
    buildAttentionKey({ type: "calendar", id: "cand-1" }), // same raw id as a review candidate, different type
    buildAttentionKey({ type: "calendar", id: "item-1" }),
    buildAttentionKey({ type: "gmail", connectedAt: CONNECTED_AT_1 }),
    buildAttentionKey({ type: "gmail", connectedAt: CONNECTED_AT_2 }),
  ];
  ok("6 distinct attention conditions (including a cross-type same-raw-id pair and two Gmail episodes) produce 6 distinct keys", new Set(keys).size === 6);
}

// ============ No timestamp is ever part of a review/calendar key's identity ============
{
  const k = buildAttentionKey({ type: "review", id: "cand-1" });
  ok("The review key contains no digits beyond the id itself (never a timestamp-derived identity)", k === "review:cand-1");
  ok("Calling buildAttentionKey twice at different real times yields the identical key", buildAttentionKey({ type: "review", id: "cand-1" }) === k);
}

// ============ Invalid input fails closed, never silently colliding ============
{
  let threw = false;
  try { buildAttentionKey({ type: "review" }); } catch { threw = true; }
  ok("buildAttentionKey throws for a 'review' attention with no id (never produces a colliding 'review:undefined')", threw);
}
{
  let threw = false;
  try { buildAttentionKey({ type: "calendar" }); } catch { threw = true; }
  ok("buildAttentionKey throws for a 'calendar' attention with no id", threw);
}
{
  let threw = false;
  try { buildAttentionKey({ type: "unsupported_type" }); } catch { threw = true; }
  ok("buildAttentionKey throws for an unsupported attention type", threw);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
