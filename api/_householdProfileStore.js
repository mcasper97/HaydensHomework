/* ============================== Household profile (server-only, Admin SDK) ==============================
 * Slice C. Server-side read of the canonical household timezone
 * (users/{uid}.timezone — see src/data/householdTimezone.js and
 * src/AuthShell.jsx's Slice A UI, which owns writing it). Needed because
 * api/calendar.js's publish action must resolve the household timezone
 * server-side to build a timed Google Calendar event — the browser's own
 * current timezone is never consulted at publish time (see the module
 * doc comment in api/calendar.js).
 *
 * Slice C.1C adds getGoogleCalendarRouting — same read-only pattern, same
 * users/{uid} document, one more field (googleCalendarRouting). Owned for
 * writes by src/data/googleCalendarRouting.js's client-side
 * setDoc(..., {merge:true}) (Slice C.1B) — this module never writes
 * users/{uid} at all, for either field.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";
import { normalizeEmailIngestionSchedule, EMAIL_INGESTION_LOCK_LEASE_MS } from "../src/data/emailIngestionSchedule.js";

function defaultDb() {
  return getFirestore();
}

export async function getHouseholdTimezone(uid, { db = defaultDb() } = {}) {
  if (!uid) return null;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const timezone = snap.data()?.timezone;
  return typeof timezone === "string" && timezone ? timezone : null;
}

/**
 * getGoogleCalendarRouting(uid) -> { defaultCalendarId, childCalendarIds }
 * Reads users/{uid}.googleCalendarRouting (see
 * src/data/googleCalendarRouting.js's own doc comment for the shape and
 * why "primary" is never itself a stored value). Absent, missing, or
 * malformed data all normalize to the same safe default — this never
 * trusts the raw Firestore value's shape, since it's parent-writable
 * client-side and this read feeds directly into which Google calendar an
 * event gets inserted into (api/calendar.js's publish action).
 */
export async function getGoogleCalendarRouting(uid, { db = defaultDb() } = {}) {
  const empty = { defaultCalendarId: null, childCalendarIds: {} };
  if (!uid) return empty;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return empty;
  const raw = snap.data()?.googleCalendarRouting;

  const defaultCalendarId = typeof raw?.defaultCalendarId === "string" && raw.defaultCalendarId ? raw.defaultCalendarId : null;
  const childCalendarIds = {};
  if (raw?.childCalendarIds && typeof raw.childCalendarIds === "object") {
    for (const [childId, calendarId] of Object.entries(raw.childCalendarIds)) {
      if (typeof calendarId === "string" && calendarId) {
        childCalendarIds[childId] = calendarId;
      }
    }
  }
  return { defaultCalendarId, childCalendarIds };
}

/**
 * getGoogleCalendarAutoPublishEnabled(uid) -> boolean
 * Reads users/{uid}.googleCalendarAutoPublishEnabled (see
 * src/data/googleCalendarAutoPublish.js's own client-side read/write of
 * this same field) — same read-only pattern as getHouseholdTimezone/
 * getGoogleCalendarRouting above, one more field on the same document.
 * Added for the server-side scheduled-ingestion adapter (see
 * api/_scheduledIngestionAdapter.js), which needs this setting server-side
 * for the exact same reason the client path does: default false, so no
 * household's behavior changes until a parent explicitly opts in.
 */
export async function getGoogleCalendarAutoPublishEnabled(uid, { db = defaultDb() } = {}) {
  if (!uid) return false;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return false;
  return !!snap.data()?.googleCalendarAutoPublishEnabled;
}

/**
 * getEmailIngestionSchedule(uid) -> normalized emailIngestionSchedule
 * Reads users/{uid}.emailIngestionSchedule (see
 * src/data/emailIngestionSchedule.js's own doc comment for the shape and
 * why household timezone is never duplicated onto it) — same read-only
 * pattern as every other field on this document. Absent/malformed data
 * normalizes to DEFAULT_EMAIL_INGESTION_SCHEDULE (enabled: false), per
 * the task's own "default behavior when config is missing: disabled".
 */
export async function getEmailIngestionSchedule(uid, { db = defaultDb() } = {}) {
  if (!uid) return normalizeEmailIngestionSchedule(null);
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return normalizeEmailIngestionSchedule(null);
  return normalizeEmailIngestionSchedule(snap.data()?.emailIngestionSchedule);
}

/**
 * listHouseholdsWithEmailIngestionEnabled() -> [{ uid, schedule, timezone }]
 * The ONE place the scheduled runner (api/_scheduledIngestionRunner.js)
 * discovers which households to even consider — a single indexed
 * equality query (Firestore needs no composite index for one nested-field
 * equality filter), not a full users collection scan, so this stays cheap
 * even as the household count grows. timezone is read from the SAME
 * document snapshot (no extra round trip) since the runner needs it
 * immediately afterward to compute household-local due-ness.
 */
export async function listHouseholdsWithEmailIngestionEnabled({ db = defaultDb() } = {}) {
  const snap = await db.collection("users").where("emailIngestionSchedule.enabled", "==", true).get();
  return snap.docs.map((doc) => ({
    uid: doc.id,
    schedule: normalizeEmailIngestionSchedule(doc.data()?.emailIngestionSchedule),
    timezone: typeof doc.data()?.timezone === "string" && doc.data().timezone ? doc.data().timezone : null,
  }));
}

/**
 * tryAcquireEmailIngestionLock(uid, { now }) -> boolean (true = lease acquired)
 * The durable overlap guard (task Section 4 — "avoid an in-memory-only
 * lock"), implemented as a minimal EXPIRING LEASE rather than a plain
 * boolean: a Firestore transaction reads emailIngestionSchedule.runLock
 * and, only if it is missing or its expiresAt has already passed, replaces
 * it with a fresh { acquiredAt, expiresAt } lease covering
 * EMAIL_INGESTION_LOCK_LEASE_MS from `now`. Two concurrent runner
 * invocations (e.g. an overlapping Cron trigger, or a retried request)
 * racing this for the same uid can still never both succeed — Firestore's
 * transaction isolation guarantees exactly one of them observes an
 * inactive lock and wins — but unlike a plain boolean, a server process
 * that dies after acquiring and before releasing no longer blocks the
 * household forever: once the lease's expiresAt passes, the next
 * invocation is free to acquire a new one.
 */
export async function tryAcquireEmailIngestionLock(uid, { db = defaultDb(), now = new Date() } = {}) {
  const ref = db.collection("users").doc(uid);
  const nowIso = now.toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeEmailIngestionSchedule(snap.exists ? snap.data()?.emailIngestionSchedule : null);
    if (current.runLock && current.runLock.expiresAt > nowIso) return false;
    const expiresAt = new Date(now.getTime() + EMAIL_INGESTION_LOCK_LEASE_MS).toISOString();
    tx.set(ref, { emailIngestionSchedule: { ...current, runLock: { acquiredAt: nowIso, expiresAt } } }, { merge: true });
    return true;
  });
}

/**
 * releaseEmailIngestionLock(uid, { status, lastRunLocalDate, lastRunAt })
 * Always called after a run attempt (success OR failure — task Section 6:
 * "a failed household run must release any durable lock") to clear the
 * runLock lease and record the basic run status the due-run guard (task
 * Section 3) reads next time. Merged onto the existing
 * emailIngestionSchedule map so enabled/localTime are never touched here.
 */
export async function releaseEmailIngestionLock(uid, { status, lastRunLocalDate, lastRunAt }, { db = defaultDb() } = {}) {
  // Dot-notation field paths rather than a nested plain object — an
  // UNAMBIGUOUS targeted update of exactly these leaf fields regardless
  // of any nested-map merge nuance, so enabled/localTime (never included
  // here) can never be touched by this call.
  //
  // lastRunLocalDate is deliberately OMITTED from the write when the
  // caller doesn't pass it (see api/_scheduledIngestionRunner.js — it's
  // only passed on a SUCCESSFUL run). Task Section 6 requires a failed
  // run to "remain eligible for later retry" — writing today's local
  // date on a failure would make isHouseholdRunDue treat the household
  // as "already_ran_today" and block a later same-day retry, which is
  // exactly the behavior a failure must not have; only a genuine success
  // should consume the day's single-run slot.
  const patch = {
    "emailIngestionSchedule.runLock": null,
    "emailIngestionSchedule.lastRunStatus": status,
    "emailIngestionSchedule.lastRunAt": lastRunAt,
  };
  if (lastRunLocalDate !== undefined) {
    patch["emailIngestionSchedule.lastRunLocalDate"] = lastRunLocalDate;
  }
  await db.collection("users").doc(uid).set(patch, { merge: true });
}
