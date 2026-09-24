/* ============================== Email ingestion schedule — client read/write ==============================
 * Settings UI's read/write of users/{uid}.emailIngestionSchedule — the
 * same field the server-side scheduler (api/_householdProfileStore.js /
 * api/_scheduledIngestionRunner.js) reads and updates. This module owns:
 * reading the full (normalized) schedule for display; saving the one
 * parent-controllable field (enabled); the pure next-run display
 * calculation (computeNextAutomaticCheckText) and double-submit guard
 * (canStartRunNow) the Settings component uses; and runEmailIngestionNow,
 * the client call for the "Run automatic check now" manual-validation
 * action (see api/email-ingestion-run-now.js — a completely separate,
 * parent-authenticated trigger from the Vercel-Cron-authenticated
 * api/cron-email-ingestion.js).
 *
 * Vercel Hobby once-daily-cron correction: the server scheduler no longer
 * uses localTime for anything (see src/data/emailIngestionSchedule.js's
 * isHouseholdRunDue) — automatic email checking now simply runs once a
 * day for every enabled household. This module correspondingly no longer
 * reads OR writes localTime at all: saveEmailIngestionScheduleSetting only
 * ever touches emailIngestionSchedule.enabled. Any localTime value already
 * stored on an existing household document is left completely untouched
 * (task: "Do not migrate or delete existing localTime values. Simply stop
 * using localTime for scheduling. Existing stored schedule objects must
 * remain valid.") — getEmailIngestionScheduleSetting still reads it back
 * as part of the full normalized schedule (via
 * normalizeEmailIngestionSchedule, unchanged), it's just no longer
 * surfaced or edited by the Settings UI (see AutomaticEmailCheckingSection.jsx).
 *
 * Validation/defaulting reuses src/data/emailIngestionSchedule.js's own
 * normalizeEmailIngestionSchedule UNCHANGED — never a second, parallel
 * definition of what a valid schedule looks like. That module is pure/
 * Firestore-free by design specifically so both the server scheduler and
 * this client repository can share it (see its own doc comment).
 *
 * lastRunLocalDate/lastRunAt/lastRunStatus/runLock are SERVER-OWNED
 * operational fields — this module never writes any of them. Saving uses
 * updateDoc() with a dot-notation field path ("emailIngestionSchedule.enabled")
 * so only that one leaf field is touched, never replacing the whole nested
 * map.
 *
 * VERIFIED AGAINST THE INSTALLED WEB SDK (firebase 12.9.0,
 * @firebase/firestore's parseSetData/parseUpdateData in
 * node_modules/@firebase/firestore/dist/common-8a1c1d56.node.cjs.js) — this
 * is NOT interchangeable with setDoc(..., {merge:true}):
 *   - updateDoc() calls parseUpdateData, which runs every object key through
 *     fieldPathFromDotSeparatedString() — a literal dot-separated key IS
 *     parsed as a multi-segment nested field path. This is the documented,
 *     intentional mechanism ("Dot notation allows you to update a single
 *     nested field without overwriting other nested fields" —
 *     https://firebase.google.com/docs/firestore/manage-data/add-data#update_fields_in_nested_objects
 *     — that page's own example uses updateDoc(), not setDoc()).
 *   - setDoc(), even with {merge:true}, calls parseSetData -> parseObject,
 *     which builds each key's child context via childContextForField(key)
 *     — a SINGLE path segment, never split on dots (contrast
 *     parseUpdateData's childContextForFieldPath(path), fed an already-
 *     parsed multi-segment FieldPath). A key like
 *     "emailIngestionSchedule.enabled" passed to setDoc would therefore
 *     write a literal TOP-LEVEL field named "emailIngestionSchedule.enabled"
 *     (a period is a legal character in a single field-name segment —
 *     validatePathSegment only rejects an empty segment or a reserved
 *     "__...__" prefix) — a sibling of the real emailIngestionSchedule map,
 *     never touching its nested enabled/localTime at all. The original
 *     implementation here used setDoc(...,{merge:true}) with these exact
 *     dotted keys, which was silently broken in this specific way — fixed
 *     by switching to updateDoc(), the SDK's actual documented mechanism
 *     for a nested-field-path partial write. This does NOT touch
 *     api/_householdProfileStore.js's own dot-notation writes — those go
 *     through the separate Admin SDK (firebase-admin / @google-cloud/firestore),
 *     a different codebase not audited by this correction (out of this
 *     task's scope).
 *
 * updateDoc() requires the target document to already exist (unlike
 * setDoc(...,{merge:true}), which would create it) — a non-issue here in
 * practice: users/{uid} is already loaded (for timezone/familyLastName)
 * before Settings can even render this section, so the document always
 * exists by the time a parent can reach this toggle. If it somehow didn't,
 * updateDoc() throws, surfaced through this function's existing error path
 * exactly like any other save failure (see AutomaticEmailCheckingSection.jsx's
 * catch block) — never silently swallowed.
 *
 * Timezone is deliberately NOT read or written here — it lives on
 * users/{uid}.timezone (see src/data/householdTimezone.js), read by the
 * Settings UI from the SAME household-profile state Settings already
 * loads (see src/BoardSelector.jsx's own `timezone` state), never
 * duplicated onto this object.
 *
 * Guest/local ("isAdmin") mode has no server-side Firestore document, and
 * more fundamentally no possible scheduled-ingestion runner (no Vercel
 * Cron, no Gmail connection — see api/_auth.js) — this module resolves to
 * a safe, inert no-op/default in that mode rather than persisting
 * anything, mirroring src/data/googleCalendarAutoPublish.js's own
 * ctx?.isAdmin handling for the same reason.
 */
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../Firebase.js";
import { normalizeEmailIngestionSchedule } from "./emailIngestionSchedule.js";
import { isValidIanaTimezone, householdTodayStr } from "./householdTimezone.js";
import { authedFetch } from "./gmailConnection.js";

// The Vercel Cron schedule (see vercel.json) — a fixed UTC time-of-day,
// once daily. Mirrored here ONLY to convert it into household-local
// display text (computeNextAutomaticCheckText below); this never changes
// what actually runs on the server and must be kept in sync with
// vercel.json's own "0 0 * * *" if that ever changes.
const CRON_UTC_HOUR = 0;
const CRON_UTC_MINUTE = 0;

/**
 * computeNextAutomaticCheckText({ timezone, now }) -> string | null
 * Converts the fixed UTC cron time above into the household's own local
 * time-of-day and expresses it as "Today around H:MM AM/PM" or "Tomorrow
 * around H:MM AM/PM", depending on whether the next UTC-midnight
 * occurrence falls on the household's current local calendar date or the
 * next one — a real timezone-offset conversion (Intl.DateTimeFormat),
 * never a hardcoded assumption about which timezone the household is in.
 * "around" rather than an exact promise — Vercel's Hobby-plan cron
 * schedule is not guaranteed to fire at the exact minute (see Vercel's
 * own documented Hobby cron-timing behavior). Returns null when no valid
 * household timezone is configured — never guesses one.
 */
export function computeNextAutomaticCheckText({ timezone, now = new Date() }) {
  if (!isValidIanaTimezone(timezone)) return null;

  const nowUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_UTC_HOUR, CRON_UTC_MINUTE, 0, 0));
  const nextRunInstant = nowUtcMidnight.getTime() >= now.getTime() ? nowUtcMidnight : new Date(nowUtcMidnight.getTime() + 24 * 60 * 60 * 1000);

  const todayLocalDate = householdTodayStr(timezone, now);
  const nextRunLocalDate = householdTodayStr(timezone, nextRunInstant);
  if (!todayLocalDate || !nextRunLocalDate) return null;

  let timeText;
  try {
    timeText = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(nextRunInstant);
  } catch {
    return null;
  }

  const label = nextRunLocalDate === todayLocalDate ? "Today" : "Tomorrow";
  return `${label} around ${timeText}`;
}

/**
 * canEnableAutomaticEmailChecking({ gmailConnected, timezone }) -> { ok, reason }
 * The one gate deciding whether a parent may turn automatic email
 * checking ON — pure, so it's directly testable without rendering the
 * Settings UI (this repo has no React-rendering test harness; Playwright
 * covers real rendering separately). Turning an ALREADY-enabled schedule
 * OFF is never subject to this gate — a household that loses Gmail
 * connection or clears its timezone after enabling must still be able to
 * disable, never gets stuck unable to turn its own schedule off.
 */
export function canEnableAutomaticEmailChecking({ gmailConnected, timezone }) {
  if (!gmailConnected) return { ok: false, reason: "gmail_not_connected" };
  if (!timezone) return { ok: false, reason: "no_timezone" };
  return { ok: true, reason: null };
}

/**
 * formatLastRunInfo(schedule) -> { lastRunAtText, lastRunStatusText } | null
 * Pure display formatting for the optional "Last checked" / "Status" rows
 * (task Section 1: "If available, also show..."). Returns null when there
 * is genuinely nothing to show yet (a household that has never run) —
 * the component renders those two rows only when this is non-null.
 */
export function formatLastRunInfo(schedule) {
  if (!schedule?.lastRunAt && !schedule?.lastRunStatus) return null;
  return {
    lastRunAtText: schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : null,
    lastRunStatusText: schedule.lastRunStatus === "success" ? "Success" : schedule.lastRunStatus === "failed" ? "Failed" : null,
  };
}

/**
 * getEmailIngestionScheduleSetting(ctx) -> normalized schedule
 * { enabled, localTime, lastRunLocalDate, lastRunAt, lastRunStatus, runLock }
 * Read-only, one-off (same lightweight-read precedent already established
 * throughout this app — see e.g. GmailCheckEmailAction.jsx's own
 * fetchGmailStatus() call). Never throws — any read failure resolves to
 * the same safe "nothing configured" default a brand-new household has.
 */
export async function getEmailIngestionScheduleSetting(ctx) {
  if (ctx?.isAdmin || !db || !ctx?.uid) return normalizeEmailIngestionSchedule(null);
  try {
    const snap = await getDoc(doc(db, "users", ctx.uid));
    return normalizeEmailIngestionSchedule(snap.exists() ? snap.data()?.emailIngestionSchedule : null);
  } catch (err) {
    console.error("emailIngestionScheduleRepository: getEmailIngestionScheduleSetting failed", err);
    return normalizeEmailIngestionSchedule(null);
  }
}

/**
 * saveEmailIngestionScheduleSetting(ctx, { enabled }) -> void
 * The ONE write path for this setting (Settings' Automatic Email Checking
 * toggle). Writes ONLY emailIngestionSchedule.enabled — localTime is never
 * read, validated, or written here (see the module doc comment above);
 * whatever value already exists on the household document, if any, is
 * left exactly as-is.
 *
 * Uses updateDoc() with a dot-notation field path — see the module doc
 * comment above for why setDoc(...,{merge:true}) with the same kind of
 * dotted key would NOT have worked.
 */
export async function saveEmailIngestionScheduleSetting(ctx, { enabled }) {
  if (ctx?.isAdmin) return; // no server-side scheduler exists for guest/local mode — nothing to persist
  if (!db || !ctx?.uid) return;

  await updateDoc(doc(db, "users", ctx.uid), {
    "emailIngestionSchedule.enabled": !!enabled,
  });
}

/**
 * canStartRunNow({ runningNow }) -> boolean
 * The UI's double-submit guard for "Run automatic check now" — pure, so
 * it's directly testable without rendering the Settings component. The
 * component both disables the button while runningNow is true AND checks
 * this at the top of its click handler (mirroring the same "guarded off
 * in the UI too" belt-and-suspenders pattern already used for the enable
 * toggle's gate). The real, authoritative guarantee against two runs ever
 * processing the same household concurrently is server-side (the
 * expiring lease in api/_householdProfileStore.js's
 * tryAcquireEmailIngestionLock) — this only prevents firing a redundant
 * second HTTP request from an impatient double-click.
 */
export function canStartRunNow({ runningNow }) {
  return !runningNow;
}

/**
 * runEmailIngestionNow() -> { ok, ran, status?, reason?, outcome?, error? }
 * Calls api/email-ingestion-run-now.js, the parent-authenticated endpoint
 * that invokes the SAME server-side household ingestion path
 * (api/_gmailIngestionRunner.js's runHouseholdEmailIngestion, via
 * api/_scheduledIngestionRunner.js's executeHouseholdIngestionRun) the
 * daily Cron uses — never the client/manual "Check Email" implementation.
 * Uses the same ID-token-attaching authedFetch every other authenticated
 * client call in this app uses (see src/data/gmailConnection.js) — no
 * uid is ever sent in the request; the server derives it from the
 * verified token. Throws (propagating authedFetch's own Error) on any
 * non-ok response, exactly like every other authedFetch-based call in
 * this app.
 */
export async function runEmailIngestionNow() {
  return authedFetch("/api/email-ingestion-run-now", { method: "POST" });
}
