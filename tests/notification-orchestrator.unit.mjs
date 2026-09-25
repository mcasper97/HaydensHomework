/**
 * Focused unit tests for api/_notificationOrchestrator.js —
 * processAttentionNotification, the flow that wires the atomic claim
 * (api/_notificationDeliveryStore.js's claimNotificationDelivery — the
 * reliability correction replacing the old non-atomic
 * read-delivery/shouldNotify/record-pending sequence), the trusted
 * recipient source, and the email transport
 * (api/_emailNotificationTransport.js) together. Every collaborator is
 * injected via `deps`, so no module mocking is needed and no real
 * Firestore/Admin SDK/network call is ever reached. The atomic claim's
 * OWN concurrency/lease behavior is covered separately and directly in
 * tests/notification-delivery-store.unit.mjs; these tests only prove the
 * orchestrator calls it correctly and reacts correctly to its result.
 *
 * Usage: node tests/notification-orchestrator.unit.mjs
 */
import { processAttentionNotification, buildNotificationEmailContent } from "../api/_notificationOrchestrator.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const UID = "household-1";
const TRUSTED_EMAIL = "trusted-parent@example.com";

/** A fully-stubbed deps bag, each collaborator individually overridable. */
function makeDeps(overrides = {}) {
  const calls = { claimDelivery: [], markSent: [], markFailed: [], getRecipientEmail: [], sendEmail: [] };
  const deps = {
    claimDelivery: async (uid, attention) => {
      calls.claimDelivery.push({ uid, attention });
      // Default stub mirrors the real claimNotificationDelivery's shape
      // for a fresh, unseen condition.
      const key = attention.type === "gmail" ? `gmail:reconnect:${attention.connectedAt}` : `${attention.type}:${attention.id}`;
      return { claimed: true, reason: "unseen", attentionKey: key };
    },
    markSent: async (uid, key) => { calls.markSent.push({ uid, key }); },
    markFailed: async (uid, key) => { calls.markFailed.push({ uid, key }); },
    getRecipientEmail: async (uid) => { calls.getRecipientEmail.push(uid); return TRUSTED_EMAIL; },
    sendEmail: async (payload) => { calls.sendEmail.push(payload); return { ok: true }; },
    ...overrides,
  };
  return { deps, calls };
}

// ============ Successful orchestration sends exactly once ============
{
  const { deps, calls } = makeDeps();
  const result = await processAttentionNotification(UID, { type: "review", id: "cand-1" }, deps);

  ok("Unseen attention: result reports sent", result.sent === true);
  ok("Successful orchestration sends exactly one email", calls.sendEmail.length === 1);
  ok("The atomic claim step was invoked exactly once", calls.claimDelivery.length === 1);
  ok("The attentionKey comes from the claim result (review:cand-1)", result.attentionKey === "review:cand-1");
}

// ============ Not claimed (already sent) -> suppressed, never sends ============
{
  const { deps, calls } = makeDeps({
    claimDelivery: async (uid, attention) => { calls.claimDelivery.push({ uid, attention }); return { claimed: false, reason: "already_sent", attentionKey: "review:cand-1" }; },
  });
  const result = await processAttentionNotification(UID, { type: "review", id: "cand-1" }, deps);

  ok("Not claimed (already sent): suppressed, not sent", result.sent === false && result.suppressed === true);
  ok("... reason is 'already_sent'", result.reason === "already_sent");
  ok("No email is sent when the claim reports already_sent", calls.sendEmail.length === 0);
  ok("No recipient is even resolved for a suppressed notification", calls.getRecipientEmail.length === 0);
}

// ============ Not claimed (concurrent in-progress attempt) -> suppressed/in-progress, never sends ============
{
  const { deps, calls } = makeDeps({
    claimDelivery: async (uid, attention) => { calls.claimDelivery.push({ uid, attention }); return { claimed: false, reason: "in_progress", attentionKey: "calendar:item-9" }; },
  });
  const result = await processAttentionNotification(UID, { type: "calendar", id: "item-9" }, deps);

  ok("Not claimed (concurrent attempt already owns it): reported as suppressed/in-progress", result.sent === false && result.suppressed === true && result.reason === "in_progress");
  ok("No email is sent while another attempt already owns the claim", calls.sendEmail.length === 0);
  ok("The old non-atomic path (a separate read then a separate record-pending write) is not used: only ONE claim call decided this, no getDelivery/recordAttempt step exists anymore", calls.claimDelivery.length === 1);
}

// ============ A claimed retry (delivery previously failed) still sends ============
{
  const { deps, calls } = makeDeps({
    claimDelivery: async (uid, attention) => { calls.claimDelivery.push({ uid, attention }); return { claimed: true, reason: "retry_after_failure", attentionKey: "calendar:item-9" }; },
  });
  const result = await processAttentionNotification(UID, { type: "calendar", id: "item-9" }, deps);

  ok("A retry-eligible claim (prior failure) still results in a send", result.sent === true);
  ok("The retried email actually goes out", calls.sendEmail.length === 1);
}

// ============ Provider success -> mark sent ============
{
  const { deps, calls } = makeDeps({ sendEmail: async () => ({ ok: true }) });
  const result = await processAttentionNotification(UID, { type: "review", id: "cand-2" }, deps);

  ok("Provider success: result.sent is true", result.sent === true);
  ok("markSent was called exactly once, with the claimed attentionKey", calls.markSent.length === 1 && calls.markSent[0].key === "review:cand-2");
  ok("markFailed was never called on success", calls.markFailed.length === 0);
}

// ============ Provider failure marks failed and permits later retry ============
{
  const { deps, calls } = makeDeps({ sendEmail: async () => ({ ok: false, error: "Resend request failed (500): oops" }) });
  const first = await processAttentionNotification(UID, { type: "calendar", id: "item-retry" }, deps);

  ok("Provider failure: result.sent is false", first.sent === false);
  ok("... reason is 'provider_failure' with the error preserved", first.reason === "provider_failure" && first.error === "Resend request failed (500): oops");
  ok("markFailed was called exactly once", calls.markFailed.length === 1 && calls.markFailed[0].key === "calendar:item-retry");
  ok("markSent was never called on failure", calls.markSent.length === 0);

  // A later retry: the real claimNotificationDelivery (tested separately
  // in tests/notification-delivery-store.unit.mjs) allows this because
  // the delivery was left at status "failed", never "sent". Here the
  // stub simply reports claimed:true again — the orchestrator itself
  // imposes no additional block beyond what the claim step decides.
  const retryDeps = { ...deps, sendEmail: async (payload) => { calls.sendEmail.push(payload); return { ok: true }; } };
  const second = await processAttentionNotification(UID, { type: "calendar", id: "item-retry" }, retryDeps);

  ok("A later retry succeeds and is marked sent", second.sent === true);
  ok("markSent was called for the retry", calls.markSent.length === 1 && calls.markSent[0].key === "calendar:item-retry");
}

// ============ Recipient comes from the trusted server-side source, not the attention object ============
{
  const { deps, calls } = makeDeps();
  await processAttentionNotification(UID, { type: "review", id: "cand-4" }, deps);

  ok("getRecipientEmail was called with the uid (server-side household/account lookup)", calls.getRecipientEmail.length === 1 && calls.getRecipientEmail[0] === UID);
  ok("The email actually sent uses that resolved recipient", calls.sendEmail[0].to === TRUSTED_EMAIL);
}

// ============ Client cannot supply an arbitrary recipient ============
{
  const { deps, calls } = makeDeps();
  // An attention object carrying spoofed recipient-shaped fields, as if a
  // caller further up the stack had (incorrectly) forwarded client input
  // straight through. processAttentionNotification must never read any of
  // these — recipient can ONLY come from getRecipientEmail(uid).
  const spoofedAttention = { type: "review", id: "cand-5", to: "attacker@evil.com", email: "attacker@evil.com", recipient: "attacker@evil.com" };
  await processAttentionNotification(UID, spoofedAttention, deps);

  ok("The sent email's recipient is the trusted server-resolved address, never the spoofed field", calls.sendEmail[0].to === TRUSTED_EMAIL);
  ok("The spoofed recipient never appears anywhere in the sendEmail payload", JSON.stringify(calls.sendEmail[0]).includes("attacker@evil.com") === false);
}
{
  // No recipient on file at all (e.g. a real account with no email, or a
  // guest/admin uid) -> a real failure, never silently invented.
  const { deps, calls } = makeDeps({ getRecipientEmail: async () => null });
  const result = await processAttentionNotification(UID, { type: "review", id: "cand-6" }, deps);

  ok("No recipient email on file: never sends, reports a real failure", result.sent === false && result.reason === "no_recipient_email");
  ok("No email send was attempted with a missing/fabricated recipient", calls.sendEmail.length === 0);
  ok("The failed attempt is still recorded as failed (never left stuck at 'pending')", calls.markFailed.length === 1);
}

// ============ Gmail reconnect key still uses connectedAt episode identity ============
{
  const { deps, calls } = makeDeps();
  const result = await processAttentionNotification(UID, { type: "gmail", connectedAt: "2026-01-01T00:00:00.000Z" }, deps);
  ok("Gmail attentionKey is episode-scoped via connectedAt (unchanged by this slice)", result.attentionKey === "gmail:reconnect:2026-01-01T00:00:00.000Z");
  ok("The attention object (with connectedAt) was passed through to the claim step unmodified", calls.claimDelivery[0].attention.connectedAt === "2026-01-01T00:00:00.000Z");
}

// ============ Review and Calendar keys remain stable ============
{
  const { deps: deps1 } = makeDeps();
  const r1 = await processAttentionNotification(UID, { type: "review", id: "cand-stable" }, deps1);
  ok("Review key format is unchanged: review:<id>", r1.attentionKey === "review:cand-stable");

  const { deps: deps2 } = makeDeps();
  const r2 = await processAttentionNotification(UID, { type: "calendar", id: "item-stable" }, deps2);
  ok("Calendar key format is unchanged: calendar:<id>", r2.attentionKey === "calendar:item-stable");
}

// ============ Email content templates (task-specified subjects, no external content interpolated) ============
{
  const gmail = buildNotificationEmailContent({ type: "gmail", connectedAt: "2026-01-01T00:00:00.000Z" });
  ok("Gmail subject matches the task-specified text exactly", gmail.subject === "Hayden's Homework needs Gmail reconnected");
  ok("Gmail body mentions Settings as the recovery path", /Settings/.test(gmail.text));

  const review = buildNotificationEmailContent({ type: "review", id: "cand-1" });
  ok("Review subject matches the task-specified text exactly", review.subject === "Hayden's Homework needs your review");
  ok("Review body never embeds the candidate id or any external content", !review.text.includes("cand-1"));

  const calendar = buildNotificationEmailContent({ type: "calendar", id: "item-1" });
  ok("Calendar subject matches the task-specified text exactly", calendar.subject === "Hayden's Homework couldn't update Google Calendar");
  ok("Calendar body never embeds the item id or any external content", !calendar.text.includes("item-1"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
