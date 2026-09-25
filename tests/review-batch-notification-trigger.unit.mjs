/**
 * Focused unit tests for api/_reviewBatchNotificationTrigger.js's
 * notifyReviewBatchRequired — the small function
 * api/_gmailIngestionRunner.js calls ONCE per source (email), after all
 * of that source's obligations are processed, when one or more NEW
 * candidates are left review-required. See
 * tests/gmail-ingestion-runner.unit.mjs for the runner-level proof that
 * it's called at the right moment, with the right count, and only once
 * per email (never per candidate).
 *
 * One test ("same source relies on the existing dedupe path") uses the
 * REAL api/_notificationOrchestrator.js's processAttentionNotification
 * together with the REAL api/_notificationDeliveryStore.js's
 * claimNotificationDelivery/markNotificationSent/markNotificationFailed
 * against an in-memory fake Firestore (same fake used in
 * tests/notification-delivery-store.unit.mjs,
 * tests/gmail-reconnect-notification-trigger.unit.mjs, and
 * tests/calendar-publish-failure-notification-trigger.unit.mjs) — not a
 * re-implementation of the dedupe decision — proving this trigger
 * genuinely relies on the existing atomic-claim dedupe path.
 *
 * Usage: node tests/review-batch-notification-trigger.unit.mjs
 */
import { notifyReviewBatchRequired } from "../api/_reviewBatchNotificationTrigger.js";
import { processAttentionNotification, buildNotificationEmailContent } from "../api/_notificationOrchestrator.js";
import { claimNotificationDelivery, markNotificationSent, markNotificationFailed } from "../api/_notificationDeliveryStore.js";
import { buildAttentionKey } from "../src/data/notificationDecision.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const UID = "review-batch-uid-1";
const SOURCE_ID = "sourcerec-42";

/** Minimal in-memory Firestore-Admin-SDK-shaped fake — same pattern as the sibling trigger test files. */
function createFakeAdminDb() {
  const store = new Map();
  function docRef(path) {
    return {
      path,
      get: async () => {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      set: async (data) => { store.set(path, data); },
    };
  }
  function collRef(name) {
    return { doc: (id) => docRef(`${name}/${id}`) };
  }
  return {
    db: {
      collection: (name) => collRef(name),
      runTransaction: async (fn) => {
        const tx = { get: async (ref) => ref.get(), set: (ref, data) => { store.set(ref.path, data); } };
        return fn(tx);
      },
    },
    store,
  };
}

// ============ Attention shape: type=review_batch, correct id/count ============
{
  const calls = { notify: [] };
  await notifyReviewBatchRequired(UID, SOURCE_ID, 4, {
    notify: async (uid, attention) => { calls.notify.push({ uid, attention }); return { sent: true }; },
  });

  ok("processAttentionNotification (the injected notify) is invoked exactly once", calls.notify.length === 1);
  ok("Called with this household's uid", calls.notify[0].uid === UID);
  ok("The attention has type 'review_batch'", calls.notify[0].attention.type === "review_batch");
  ok("The attention's id is the stable source id", calls.notify[0].attention.id === SOURCE_ID);
  ok("The attention's count is the review-required count", calls.notify[0].attention.count === 4);
  ok("The attention carries no other, unrelated fields", Object.keys(calls.notify[0].attention).sort().join(",") === "count,id,type");
}

// ============ Missing/invalid inputs never call the pipeline, never throw ============
{
  const cases = [
    { sourceId: null, count: 4 },
    { sourceId: undefined, count: 4 },
    { sourceId: SOURCE_ID, count: 0 },
    { sourceId: SOURCE_ID, count: -1 },
    { sourceId: SOURCE_ID, count: 1.5 },
    { sourceId: SOURCE_ID, count: null },
    { sourceId: SOURCE_ID, count: undefined },
  ];
  for (const { sourceId, count } of cases) {
    let threw = false;
    let calls = 0;
    try {
      await notifyReviewBatchRequired(UID, sourceId, count, { notify: async () => { calls += 1; return { sent: true }; } });
    } catch { threw = true; }
    ok(`sourceId=${JSON.stringify(sourceId)} count=${JSON.stringify(count)}: never calls the pipeline, never throws`, calls === 0 && threw === false);
  }
}

// ============ A downstream notification failure never throws out of the trigger ============
{
  let threw = false;
  let result;
  try {
    result = await notifyReviewBatchRequired(UID, SOURCE_ID, 2, { notify: async () => { throw new Error("Resend request failed (500)"); } });
  } catch { threw = true; }
  ok("A downstream notification failure never propagates out of notifyReviewBatchRequired", threw === false);
  ok("The function resolves rather than rejecting", result === undefined);
}

// ============ Same source relies on the existing dedupe path (real claim store, not reimplemented) ============
{
  const { db } = createFakeAdminDb();
  const sendCalls = [];
  const realDedupeNotify = (uid, attention) =>
    processAttentionNotification(uid, attention, {
      claimDelivery: (u, a) => claimNotificationDelivery(u, a, { db }),
      markSent: (u, key) => markNotificationSent(u, key, { db }),
      markFailed: (u, key) => markNotificationFailed(u, key, { db }),
      getRecipientEmail: async () => "parent@example.com",
      sendEmail: async (payload) => { sendCalls.push(payload); return { ok: true }; },
    });

  // Three repeated calls for the SAME source (simulating, e.g., the same
  // email somehow being processed more than once) — the real atomic
  // claim must suppress the second and third.
  await notifyReviewBatchRequired(UID, SOURCE_ID, 4, { notify: realDedupeNotify });
  await notifyReviewBatchRequired(UID, SOURCE_ID, 4, { notify: realDedupeNotify });
  await notifyReviewBatchRequired(UID, SOURCE_ID, 4, { notify: realDedupeNotify });

  ok("Repeated processing of the same source sends exactly ONE email (real atomic claim suppresses duplicates)", sendCalls.length === 1);

  // A different source is a genuinely new, distinct attentionKey and is
  // eligible to notify independently.
  await notifyReviewBatchRequired(UID, "sourcerec-99", 2, { notify: realDedupeNotify });
  ok("A different source sends its own, separate email", sendCalls.length === 2);
}

// ============ Batch key never reuses the per-candidate "review:<id>" key ============
{
  const batchKey = buildAttentionKey({ type: "review_batch", id: SOURCE_ID });
  const candidateKey = buildAttentionKey({ type: "review", id: SOURCE_ID }); // same raw id, different type
  ok("The batch key uses the review-batch: prefix", batchKey === `review-batch:${SOURCE_ID}`);
  ok("The batch key never collides with the per-candidate review: key, even for the same raw id", batchKey !== candidateKey);
}

// ============ Email content: singular vs plural, no sensitive content ============
{
  const one = buildNotificationEmailContent({ type: "review_batch", id: SOURCE_ID, count: 1 });
  ok("1 item: singular phrasing exactly as specified", one.text.startsWith("1 new school item needs review."));
  ok("Subject reuses the existing Review Inbox subject", one.subject === "Hayden's Homework needs your review");

  const four = buildNotificationEmailContent({ type: "review_batch", id: SOURCE_ID, count: 4 });
  ok("4 items: plural phrasing exactly as specified", four.text.startsWith("4 new school items need review."));

  const missingCount = buildNotificationEmailContent({ type: "review_batch", id: SOURCE_ID });
  ok("A missing count fails safe to singular phrasing rather than a broken sentence", missingCount.text.startsWith("1 new school item needs review."));

  ok("Body never contains a raw email/teacher-message marker like 'Subject:' or 'From:'", !four.text.includes("Subject:") && !four.text.includes("From:"));
  ok("Body never embeds the source id itself (no candidate/source identifiers leaked)", !four.text.includes(SOURCE_ID));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
