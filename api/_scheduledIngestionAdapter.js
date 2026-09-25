/* ============================== Scheduled ingestion adapter (server-only, Admin SDK) ==============================
 * The narrow bridge that lets a future scheduled/server-side email
 * ingestion job call the SAME auto-commit decision and finalization
 * orchestration the manual "Check Email" flow already uses
 * (src/data/ingestionFinalization.js's finalizeExtractedCandidate), without
 * a browser and without duplicating any of its rules.
 *
 * WHY THIS FILE EXISTS: finalizeExtractedCandidate already accepts
 * injectable `{ commit, publish }` dependencies specifically so a non-
 * browser caller can supply alternates (see that module's own doc
 * comment). Its DEFAULT dependencies (commitCandidateToItem,
 * autoPublishItemIfEligible) are backed by the client Firebase SDK
 * (firebase/firestore + src/Firebase.js's browser app instance), which
 * relies on Firestore Security Rules gated by a signed-in client
 * `request.auth.uid` — there is no such session in a server/serverless
 * context, so those defaults would fail closed with permission-denied if
 * ever actually invoked here. This file supplies Admin-SDK-backed
 * replacements for exactly those two dependencies (bypassing security
 * rules the same way every other api/_*Store.js module already does,
 * scoped strictly to the caller's own already-verified uid — see the
 * note on trust below) and calls the SAME, UNCHANGED
 * finalizeExtractedCandidate with them. The decision rule
 * (decideAutoCommitEligibility), the orchestration sequence (decide ->
 * commit -> post-commit Calendar workflow), and the draft-item mapping
 * (candidateToDraftItem) are all imported from their existing single
 * implementation, never re-derived here.
 *
 * TRUST MODEL: every function in this file takes `uid` as an explicit
 * parameter, never reads it from request/client-supplied state. The
 * caller (a future scheduled job, or a request handler using this
 * module) is responsible for having already determined `uid` from a
 * trustworthy source (e.g. requireFirebaseUser's verified ID token, or —
 * for a true cron/background job with no request at all — iterating
 * known household uids from Firestore itself). This module does not
 * perform that verification itself, the same division of responsibility
 * every existing api/_*Store.js module already has (they take a
 * pre-verified uid; api/*.js endpoint files are what call
 * requireFirebaseUser before ever reaching them).
 *
 * NOT built here (intentionally, per "keep this surgical"):
 *   - a scheduler/cron trigger itself
 *   - candidate CREATION from raw email content (that's the Gmail-fetch +
 *     extraction + SourceRecord/candidate-creation + reconciliation
 *     pipeline — api/gmail-check-email.js already does the fetch/extract
 *     half server-side; candidate creation and reconciliation are
 *     currently client-side, in src/AuthShell.jsx, and are unaffected by
 *     this file). finalizeCandidateServerSide below takes an
 *     ALREADY-CREATED, already-reconciled candidate, exactly like
 *     finalizeExtractedCandidate itself does.
 *   - Settings UI, Gmail polling changes, or any change to confidence,
 *     Review Inbox, Calendar auto-publish, or Family Board behavior.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { finalizeExtractedCandidate } from "../src/data/ingestionFinalization.js";
import { decideCandidateCommit, buildItemFields, COMMIT_ERROR_CODES as SHARED_COMMIT_ERROR_CODES, commitError } from "../src/data/candidateCommitDecision.js";
import { isItemEligibleForCalendarPublish, buildCalendarEventFromItem } from "../src/organizer/calendarEventMapping.js";
import { resolveGoogleCalendarId } from "../src/organizer/calendarRouting.js";
import { getHouseholdTimezone, getGoogleCalendarRouting, getGoogleCalendarAutoPublishEnabled } from "./_householdProfileStore.js";
import { getGoogleCalendarConnection } from "./_googleCalendarConnectionsStore.js";
import { setItemGoogleCalendarFields } from "./_itemsStore.js";
import { deriveGoogleEventId, refreshCalendarAccessToken, insertCalendarEvent } from "./_googleCalendarClient.js";
import { notifyCalendarPublishFailure } from "./_calendarPublishFailureNotificationTrigger.js";

function defaultDb() {
  return getFirestore();
}

// Re-exported for the same backward-compatibility reason
// candidateCommitRepository.js re-exports it — the values themselves now
// live in src/data/candidateCommitDecision.js, shared by both this file
// and the client repository, never duplicated.
export const COMMIT_ERROR_CODES = SHARED_COMMIT_ERROR_CODES;

// Mirrors src/data/itemsRepository.js's own EMPTY_DEFAULTS exactly (field
// names/values only — a plain data shape, not a rule) — copied rather than
// imported so this module never statically pulls in the client Firebase
// SDK (firebase/firestore + src/Firebase.js) that itemsRepository.js
// imports at its own top level. Keep in sync with itemsRepository.js's
// EMPTY_DEFAULTS if that ever changes.
const ITEM_EMPTY_DEFAULTS = {
  childIds: [],
  subject: null,
  courseId: null,
  startDate: null,
  startTime: null,
  dueDate: null,
  dueTime: null,
  endDate: null,
  endTime: null,
  allDay: true,
  status: "open",
  notes: "",
  parentItemId: null,
  studyMaterialIds: [],
  source: { type: "manual", sourceId: null },
  academicTopic: null,
  academicUnit: null,
  preparationRequired: null,
  location: null,
  priority: null,
  sourceRecordId: null,
  schedule: null,
  googleCalendarEventId: null,
  googleCalendarId: null,
  googleCalendarSyncedAt: null,
  googleCalendarSyncError: null,
};

/**
 * getIngestionCandidateServerSide(uid, candidateId) -> candidate | null
 * The Admin-SDK read half of "reading/updating the relevant candidate" —
 * mirrors src/data/ingestionCandidatesRepository.js's getIngestionCandidate
 * exactly (same document shape, same users/{uid}/ingestionCandidates/{id}
 * path), so a future caller can fetch a candidate to hand to
 * finalizeCandidateServerSide without going through the client SDK.
 */
export async function getIngestionCandidateServerSide(uid, candidateId, { db = defaultDb() } = {}) {
  if (!uid || !candidateId) return null;
  const snap = await db.collection("users").doc(uid).collection("ingestionCandidates").doc(candidateId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * commitCandidateToItemServerSide(uid, candidateId, reviewedItemPayload, opts?) -> item
 * The Admin-SDK counterpart to src/data/candidateCommitRepository.js's
 * commitCandidateToItem (real-Firestore branch) — SAME idempotency rules
 * (candidate id === item id, reviewStatus allowlist, "committed" short-
 * circuits to the existing item or throws COMMITTED_ITEM_MISSING, an
 * already-existing item is never overwritten by a resubmitted payload),
 * translated to firebase-admin/firestore's transaction API (the client
 * SDK's `runTransaction`/`firebase/firestore` cannot run here — see the
 * module doc comment). This is necessary, narrow duplication of Firestore
 * ACCESS MECHANICS (a different SDK's transaction API), not of the
 * COMMIT RULES themselves, which are reproduced exactly, not reinvented.
 */
export async function commitCandidateToItemServerSide(uid, candidateId, reviewedItemPayload, { commitMode, db = defaultDb() } = {}) {
  if (!uid) throw new Error("No uid to commit for.");
  const candRef = db.collection("users").doc(uid).collection("ingestionCandidates").doc(candidateId);
  const itemRef = db.collection("users").doc(uid).collection("items").doc(candidateId);

  return db.runTransaction(async (tx) => {
    const candSnap = await tx.get(candRef);
    const candidate = candSnap.exists ? { id: candSnap.id, ...candSnap.data() } : null;
    const itemSnap = await tx.get(itemRef);

    const decision = decideCandidateCommit({
      candidateExists: candSnap.exists,
      candidate,
      itemExists: itemSnap.exists,
    });

    if (decision.action === "throw") {
      throw commitError(decision.code, decision.message);
    }
    if (decision.action === "return_existing" || decision.action === "mark_committed_only") {
      if (decision.action === "mark_committed_only") {
        tx.update(candRef, { reviewStatus: "committed" });
      }
      return { id: itemSnap.id, ...itemSnap.data() };
    }

    // decision.action === "create_item"
    const fields = buildItemFields(ITEM_EMPTY_DEFAULTS, candidate, reviewedItemPayload, commitMode);
    tx.set(itemRef, {
      ...fields,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(candRef, { reviewStatus: "committed" });
    return { id: itemRef.id, ...fields };
  });
}

const PUBLISH_IN_FLIGHT_MESSAGE = "Publishing to Google Calendar — not yet confirmed.";

// Mirrors src/data/googleCalendarAutoPublish.js's attemptCalendarPublish
// durability invariant exactly: a durable "in flight" marker is written
// BEFORE the network call, not only after a caught failure, so an
// interrupted server invocation still leaves the Item in a durable,
// surfaced (never silently "never attempted") state — same field, same
// Review Inbox recovery path (ReviewInboxPanel.jsx's "Google Calendar
// issues" section), unchanged.
async function markPublishInFlight(uid, item) {
  try {
    await setItemGoogleCalendarFields(uid, item.id, {
      googleCalendarEventId: item.googleCalendarEventId ?? null,
      googleCalendarId: item.googleCalendarId ?? null,
      googleCalendarSyncedAt: item.googleCalendarSyncedAt ?? null,
      googleCalendarSyncError: PUBLISH_IN_FLIGHT_MESSAGE,
    });
  } catch (err) {
    console.error("scheduledIngestionAdapter: failed to record in-flight publish state", err);
  }
}

/**
 * recordPublishFailure(uid, item, message, deps?) -> void, never throws.
 * Exported (task: notification trigger) — this is the ONE choke point
 * every real publish failure inside attemptCalendarPublishServerSide
 * already funnels through, so the parent-notification trigger is added
 * here rather than at each of the 5 call sites, and rather than a second,
 * separate failure detector. `deps` lets tests override either
 * collaborator (mirroring the {deps={}} pattern already established
 * throughout this file's siblings) without touching real Firestore or
 * the notification pipeline.
 *
 * FAILURE ISOLATION (task): the notification call is best-effort and
 * fully independent of the googleCalendarSyncError write above it — a
 * notification failure is caught and logged here, never changing what
 * was already persisted, never affecting the Item's committed state, and
 * never blocking a later retry (see
 * api/_calendarPublishFailureNotificationTrigger.js's own doc comment
 * for the full dedupe/limitation notes).
 */
export async function recordPublishFailure(uid, item, message, deps = {}) {
  const { setFields = setItemGoogleCalendarFields, notifyFailure = notifyCalendarPublishFailure } = deps;

  try {
    await setFields(uid, item.id, {
      googleCalendarEventId: item.googleCalendarEventId ?? null,
      googleCalendarId: item.googleCalendarId ?? null,
      googleCalendarSyncedAt: item.googleCalendarSyncedAt ?? null,
      googleCalendarSyncError: message,
    });
  } catch (updateErr) {
    console.error("scheduledIngestionAdapter: failed to record googleCalendarSyncError", updateErr);
  }

  try {
    await notifyFailure(uid, item.id);
  } catch (err) {
    // Belt-and-suspenders — notifyCalendarPublishFailure already catches
    // everything internally; this guarantees a test double or future
    // change to that function can never turn a notification failure into
    // a Calendar-publish-handling failure.
    console.error("scheduledIngestionAdapter: Calendar publish-failure notification trigger threw", err);
  }
}

/**
 * attemptCalendarPublishServerSide(uid, item) -> void, never throws.
 * The Admin-SDK/non-HTTP counterpart to api/calendar.js's own "publish"
 * action (handlePublish) — reuses the exact same imported building blocks
 * that action uses (isItemEligibleForCalendarPublish, deriveGoogleEventId,
 * buildCalendarEventFromItem, resolveGoogleCalendarId,
 * refreshCalendarAccessToken, insertCalendarEvent, setItemGoogleCalendarFields)
 * in the same sequence, rather than an HTTP self-call (which would need
 * its own bearer-token minting server-side) or a refactor of
 * api/calendar.js itself (out of scope — "do not change Calendar
 * auto-publish behavior"). No Calendar eligibility/routing RULE is
 * reimplemented here; every rule function is imported unchanged.
 */
export async function attemptCalendarPublishServerSide(uid, item) {
  if (!item?.id) return;
  if (!isItemEligibleForCalendarPublish(item)) return;

  await markPublishInFlight(uid, item);

  try {
    if (item.googleCalendarEventId) {
      // Idempotency short-circuit — mirrors handlePublish's own "already
      // published" check exactly; never re-resolves routing or re-inserts.
      return;
    }

    const connection = await getGoogleCalendarConnection(uid);
    if (!connection?.refreshToken || connection.needsReconnect) {
      await recordPublishFailure(uid, item, "Google Calendar is not connected.");
      return;
    }

    const eventId = deriveGoogleEventId(item.id);
    const householdTimezone = await getHouseholdTimezone(uid);
    const mapped = buildCalendarEventFromItem({ item, householdTimezone, optionalEndTime: null, eventId });
    if (!mapped.ok) {
      await recordPublishFailure(uid, item, mapped.message || "Could not publish to Google Calendar.");
      return;
    }

    const routing = await getGoogleCalendarRouting(uid);
    const { calendarId, source } = resolveGoogleCalendarId(item, routing);

    const refreshed = await refreshCalendarAccessToken(uid, connection);
    if (!refreshed.ok) {
      await recordPublishFailure(uid, item, refreshed.error || "Could not connect to Google Calendar.");
      return;
    }

    const inserted = await insertCalendarEvent({ accessToken: refreshed.accessToken, calendarId, event: mapped.event });
    if (!inserted.ok) {
      const message =
        inserted.notFound && source !== "primary"
          ? "This Google Calendar is no longer available. Update Calendar Routing and try again."
          : inserted.error || "Could not publish to Google Calendar.";
      await recordPublishFailure(uid, item, message);
      return;
    }

    await setItemGoogleCalendarFields(uid, item.id, {
      googleCalendarEventId: inserted.eventId,
      googleCalendarId: calendarId,
      googleCalendarSyncedAt: new Date().toISOString(),
      googleCalendarSyncError: null,
    });
  } catch (err) {
    console.error("scheduledIngestionAdapter: publish attempt failed", err);
    await recordPublishFailure(uid, item, err?.message || "Could not publish to Google Calendar.");
  }
}

/**
 * publishItemServerSide(uid, item) -> void, never throws.
 * The Admin-SDK counterpart to src/data/googleCalendarAutoPublish.js's
 * autoPublishItemIfEligible — same eligibility + household-setting gate,
 * same fire-and-forget-safe contract.
 */
export async function publishItemServerSide(uid, item) {
  if (!item?.id) return;
  if (!isItemEligibleForCalendarPublish(item)) return;

  let enabled = false;
  try {
    enabled = await getGoogleCalendarAutoPublishEnabled(uid);
  } catch (err) {
    console.error("scheduledIngestionAdapter: could not read auto-publish setting", err);
    return;
  }
  if (!enabled) return;

  await attemptCalendarPublishServerSide(uid, item);
}

/**
 * finalizeCandidateServerSide(uid, candidate, deps?) -> same outcome shape
 * as finalizeExtractedCandidate ({ outcome, item?, decision, error? }).
 *
 * The one entry point a future scheduled job calls — takes an
 * ALREADY-CREATED, already-reconciled candidate (see the module doc
 * comment) and runs it through the exact same, unmodified
 * finalizeExtractedCandidate, injecting this file's Admin-SDK-backed
 * commit/publish so no Firestore Security Rules / client session is ever
 * relied on. `deps` lets a caller (e.g. this file's own tests) override
 * either further, exactly like finalizeExtractedCandidate's own `deps`
 * parameter.
 */
export async function finalizeCandidateServerSide(uid, candidate, deps = {}) {
  const ctx = { uid, isAdmin: false };
  return finalizeExtractedCandidate(ctx, candidate, {
    commit: deps.commit || ((_ctx, candidateId, payload, opts) => commitCandidateToItemServerSide(uid, candidateId, payload, opts)),
    publish: deps.publish || ((_ctx, item) => publishItemServerSide(uid, item)),
  });
}
