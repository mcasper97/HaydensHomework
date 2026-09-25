/**
 * Focused unit tests for api/_gmailReconnectNotificationTrigger.js's
 * notifyGmailReconnectRequired — the small function
 * api/_gmailIngestionRunner.js calls at its EXISTING
 * GMAIL_RECONNECT_REQUIRED / needsReconnect transition (see
 * tests/gmail-ingestion-runner.unit.mjs for the runner-level proof that
 * it's called at the right moment, with the right isolation). These
 * tests cover this module's own logic: the attention shape it builds,
 * where connectedAt comes from, what happens when it's missing, and that
 * a downstream failure never throws out of this function.
 *
 * One test ("repeated same episode relies on existing dedupe path")
 * deliberately uses the REAL api/_notificationOrchestrator.js's
 * processAttentionNotification together with the REAL
 * api/_notificationDeliveryStore.js's claimNotificationDelivery/
 * markNotificationSent/markNotificationFailed (against an in-memory fake
 * Firestore, same fake used in
 * tests/notification-delivery-store.unit.mjs) — not a re-implementation
 * of the dedupe decision — to prove this trigger genuinely relies on the
 * existing atomic-claim dedupe path rather than any dedupe logic of its
 * own.
 *
 * Usage: node tests/gmail-reconnect-notification-trigger.unit.mjs
 */
import { notifyGmailReconnectRequired } from "../api/_gmailReconnectNotificationTrigger.js";
import { processAttentionNotification } from "../api/_notificationOrchestrator.js";
import { claimNotificationDelivery, markNotificationSent, markNotificationFailed } from "../api/_notificationDeliveryStore.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const UID = "gmail-reconnect-uid-1";
const CONNECTED_AT = "2026-01-01T00:00:00.000Z";

/** Minimal in-memory Firestore-Admin-SDK-shaped fake — same pattern as tests/notification-delivery-store.unit.mjs. */
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

// ============ Reconnect-required invokes processAttentionNotification, with the right attention shape ============
{
  const calls = { notify: [] };
  await notifyGmailReconnectRequired(UID, {
    getConnection: async () => ({ connectedAt: CONNECTED_AT, connected: true, needsReconnect: true, emailAddress: "parent@example.com" }),
    notify: async (uid, attention) => { calls.notify.push({ uid, attention }); return { sent: true }; },
  });

  ok("processAttentionNotification (the injected notify) is invoked exactly once", calls.notify.length === 1);
  ok("Called with this household's uid", calls.notify[0].uid === UID);
  ok("The attention has type 'gmail'", calls.notify[0].attention.type === "gmail");
  ok("The attention's connectedAt is the trusted one read from the connection record", calls.notify[0].attention.connectedAt === CONNECTED_AT);
  ok("The attention carries no other, unrelated fields (no client-suppliable shape)", Object.keys(calls.notify[0].attention).sort().join(",") === "connectedAt,type");
}

// ============ connectedAt comes from the trusted server-side connection record, not any other source ============
{
  const calls = { getConnection: [] };
  await notifyGmailReconnectRequired(UID, {
    getConnection: async (uid) => { calls.getConnection.push(uid); return { connectedAt: CONNECTED_AT }; },
    notify: async () => ({ sent: true }),
  });
  ok("getConnection (the trusted Gmail connection record source) was called with the uid", calls.getConnection.length === 1 && calls.getConnection[0] === UID);
}

// ============ Missing connectedAt does not fabricate an identity ============
{
  const calls = { notify: 0 };
  await notifyGmailReconnectRequired(UID, {
    getConnection: async () => ({ connected: false, needsReconnect: true, connectedAt: null }),
    notify: async () => { calls.notify += 1; return { sent: true }; },
  });
  ok("No connectedAt on file: the notification pipeline is never called (no fabricated timestamp identity)", calls.notify === 0);
}
{
  const calls = { notify: 0 };
  await notifyGmailReconnectRequired(UID, {
    getConnection: async () => null, // no connection record at all
    notify: async () => { calls.notify += 1; return { sent: true }; },
  });
  ok("No connection record at all: also never calls the notification pipeline, never throws", calls.notify === 0);
}
{
  // A failure reading the connection record itself is also isolated.
  let threw = false;
  try {
    await notifyGmailReconnectRequired(UID, {
      getConnection: async () => { throw new Error("Firestore read failed"); },
      notify: async () => ({ sent: true }),
    });
  } catch { threw = true; }
  ok("A failure reading the connection record itself never throws out of this function", threw === false);
}

// ============ Notification failure does not throw out of the trigger (isolation) ============
{
  let threw = false;
  let result;
  try {
    result = await notifyGmailReconnectRequired(UID, {
      getConnection: async () => ({ connectedAt: CONNECTED_AT }),
      notify: async () => { throw new Error("Resend request failed (500)"); },
    });
  } catch { threw = true; }
  ok("A downstream notification failure never propagates out of notifyGmailReconnectRequired", threw === false);
  ok("The function resolves (no result the caller needs to unwrap) rather than rejecting", result === undefined);
}

// ============ Repeated same episode relies on the EXISTING dedupe path (real claim store, not reimplemented) ============
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

  const getConnection = async () => ({ connectedAt: CONNECTED_AT });

  // Three repeated checks during the SAME broken episode (identical
  // connectedAt) — simulating three scheduled ingestion runs while Gmail
  // is still broken.
  await notifyGmailReconnectRequired(UID, { getConnection, notify: realDedupeNotify });
  await notifyGmailReconnectRequired(UID, { getConnection, notify: realDedupeNotify });
  await notifyGmailReconnectRequired(UID, { getConnection, notify: realDedupeNotify });

  ok("Repeated checks during the same broken episode send exactly ONE email (the real atomic claim suppresses the rest)", sendCalls.length === 1);

  // A later reconnect changes connectedAt (existing Gmail connection
  // state — see api/_gmailConnectionsStore.js's upsertGmailConnection) —
  // a NEW episode is eligible to notify again, without this trigger
  // implementing any of that dedupe/episode logic itself.
  const NEW_CONNECTED_AT = "2026-03-01T00:00:00.000Z";
  await notifyGmailReconnectRequired(UID, { getConnection: async () => ({ connectedAt: NEW_CONNECTED_AT }), notify: realDedupeNotify });
  ok("A later disconnect episode (new connectedAt) sends again — the same real dedupe path allows it", sendCalls.length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
