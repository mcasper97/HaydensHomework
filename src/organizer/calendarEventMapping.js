/* ============================== Item -> Google Calendar event mapping (Slice C) ==============================
 * Pure logic, zero Firestore/network, zero Node-only dependencies —
 * deliberately importable from BOTH the client (ParentOrganizer.jsx,
 * deciding what UI to show) and the server (api/calendar-publish.js,
 * deciding what to actually publish), exactly mirroring how
 * api/extract-obligations.js already imports pure logic from
 * src/data/itemTypes.js. This module never calls the Google Calendar API
 * itself, and never derives the deterministic Google event id — see
 * api/_googleCalendarClient.js for both (that file is server-only, and
 * uses Node's `crypto`, which must never end up in the browser bundle;
 * buildCalendarEventFromItem below takes the already-derived id as a
 * plain parameter for exactly this reason).
 *
 * Eligible types are exactly FORM_TYPES (itemTypes.js) — every type
 * ItemForm can create except "chore" (which isn't creatable through
 * ItemForm at all). A recurring Item (schedule?.recurring === true) is
 * never eligible in Slice C — see the module's own header comment in
 * itemBuckets.js: recurring items have no single calendar-anchor date, and
 * mapping them onto a Google RRULE is explicitly out of scope for this
 * slice.
 *
 * Date routing reuses itemBuckets.js's calendarAnchorDate(item) exactly —
 * the same function OrganizerCalendar.jsx already uses to decide "what
 * date does this Item anchor to" — so this module never re-derives that
 * rule independently. Time routing reuses candidateToDraftItem.js's
 * DUE_DATE_TYPES (assignment/project/study_task use dueTime, with no
 * analogous end time; everything else uses startTime/endTime) — the same
 * due-vs-start convention oneTimeObligationMatch.js already established
 * for Slice 3.
 */
import { calendarAnchorDate } from "./itemBuckets.js";
import { DUE_DATE_TYPES } from "./candidateToDraftItem.js";
import { FORM_TYPES } from "../data/itemTypes.js";

export const CALENDAR_ERROR_CODES = {
  RECURRING_NOT_SUPPORTED: "RECURRING_NOT_SUPPORTED",
  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",
  MISSING_EFFECTIVE_DATE: "MISSING_EFFECTIVE_DATE",
  MISSING_HOUSEHOLD_TIMEZONE: "MISSING_HOUSEHOLD_TIMEZONE",
  MISSING_END_TIME: "MISSING_END_TIME",
  UNEXPECTED_OPTIONAL_END_TIME: "UNEXPECTED_OPTIONAL_END_TIME",
  INVALID_OPTIONAL_END_TIME: "INVALID_OPTIONAL_END_TIME",
  END_NOT_AFTER_START: "END_NOT_AFTER_START",
};

const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * isItemEligibleForCalendarPublish(item) -> boolean
 * The one place "can this Item even be offered for Calendar publishing"
 * is decided — used identically by the client (to decide whether to show
 * any Calendar control on a row at all) and available for the server to
 * reuse if it ever needs a cheap pre-check (buildCalendarEventFromItem
 * below already enforces the same two rules on its own, with specific
 * error codes, so the server doesn't strictly need to call this
 * separately — but the client does, before ever calling the endpoint).
 */
export function isItemEligibleForCalendarPublish(item) {
  if (!item) return false;
  if (item.schedule?.recurring) return false;
  return FORM_TYPES.includes(item.type);
}

/**
 * getEffectiveDateTime(item) -> { date, startTime, endTime }
 * The one place the due-vs-start field routing is applied to read an
 * Item's own effective date/start/end for Calendar purposes. Shared by
 * buildCalendarEventFromItem below and by the client (ParentOrganizer.jsx
 * uses this to decide whether an end-time confirmation prompt is needed,
 * without re-deriving the routing rule itself).
 */
export function getEffectiveDateTime(item) {
  const isDue = DUE_DATE_TYPES.includes(item?.type);
  return {
    date: calendarAnchorDate(item) || null,
    startTime: (isDue ? item?.dueTime : item?.startTime) || null,
    // Due-date types (assignment/project/study_task) have no analogous
    // end time — see candidateToDraftItem.js's own comment on this.
    endTime: (isDue ? null : item?.endTime) || null,
  };
}

/**
 * nextCalendarDate(dateStr) -> "YYYY-MM-DD" the day after dateStr
 * UTC-anchored on purpose — this is plain calendar-date arithmetic (the
 * day after a date, independent of any wall-clock/timezone concept),
 * never affected by the household timezone or the server's own local
 * time. Google Calendar's all-day events use an EXCLUSIVE end.date (the
 * day AFTER the event's last day) — a single-day all-day event's
 * start.date and end.date must therefore differ by exactly one day, or
 * Google either rejects the event or renders it as zero-length.
 */
function nextCalendarDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * formatDueTime12h("15:00") -> "3:00 PM"
 * Manual 12-hour conversion, deliberately not Intl/locale-based — a due
 * time is a plain HH:MM the parent typed in ItemForm, not a value that
 * needs timezone or locale handling (it's never combined with a date to
 * form a dateTime; see the all-day branch below).
 */
function formatDueTime12h(hhmm) {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mStr} ${period}`;
}

/**
 * buildAllDayDescription(item, dueTimeText)
 * Due-based items (assignment/project/study_task) never get a timed
 * Google event (see buildCalendarEventFromItem) — a due TIME means
 * "due by this time," not "starts at this time," so it can only ever
 * surface as visible text on the all-day event, never as start/end. When
 * present, it's prepended as its own line, ahead of item.notes.
 */
function buildAllDayDescription(item, dueTimeText) {
  const dueLine = dueTimeText ? `Due by ${formatDueTime12h(dueTimeText)}` : "";
  const notes = item.notes || "";
  if (dueLine && notes) return `${dueLine}\n\n${notes}`;
  return dueLine || notes || undefined;
}

/**
 * buildCalendarEventFromItem({ item, householdTimezone, optionalEndTime, eventId })
 *   -> { ok: true, event: { id, summary, description?, start, end } }
 *    | { ok: false, code, message }
 *
 * Pure, deterministic, never throws. `eventId` is the already-derived
 * deterministic Google event id (see api/_googleCalendarClient.js's
 * deriveGoogleEventId — deliberately NOT computed in this module, so this
 * client-safe file never needs Node's `crypto`) — passed straight through
 * onto the returned event's own `id` field. `optionalEndTime` is the
 * parent-supplied end time from the end-time confirmation prompt (see
 * ParentOrganizer.jsx) — used ONLY to build this one Google event; it is
 * never written back onto the canonical Item (see the module doc comment
 * in api/calendar-publish.js for the full idempotency/linkage design).
 *
 * description uses Item.notes — the one existing canonical free-text
 * field ItemForm already exposes to parents for item detail (see
 * itemsRepository.js's EMPTY_DEFAULTS) — never sourceRecordId, candidate
 * ids, extractionConfidence, or any other provenance/internal field, and
 * never a fabricated child name.
 */
export function buildCalendarEventFromItem({ item, householdTimezone, optionalEndTime, eventId }) {
  if (item?.schedule?.recurring) {
    return { ok: false, code: CALENDAR_ERROR_CODES.RECURRING_NOT_SUPPORTED, message: "Recurring items can't be published to Google Calendar yet." };
  }
  if (!FORM_TYPES.includes(item?.type)) {
    return { ok: false, code: CALENDAR_ERROR_CODES.UNSUPPORTED_TYPE, message: "This item type can't be published to Google Calendar." };
  }

  const { date, startTime, endTime } = getEffectiveDateTime(item);
  if (!date) {
    return { ok: false, code: CALENDAR_ERROR_CODES.MISSING_EFFECTIVE_DATE, message: "This item has no date to publish." };
  }

  const id = eventId;
  const summary = item.title || "(untitled)";
  const isDue = DUE_DATE_TYPES.includes(item.type);

  // Due-based items (assignment/project/study_task) are ALWAYS published as
  // an all-day deadline event, regardless of the Item's own raw `allDay`
  // value — a due time is "due by," never "starts at," so these types must
  // never reach the timed-event branch below (which would otherwise demand
  // an end time and effectively invent an event duration around a
  // deadline). See getEffectiveDateTime: for due types, `startTime` here is
  // actually `dueTime` — surfaced as visible text below, never as a
  // Google start/end dateTime.
  if (item.allDay || isDue) {
    const description = buildAllDayDescription(item, isDue ? startTime : null);
    return {
      ok: true,
      event: {
        id,
        summary,
        ...(description ? { description } : {}),
        start: { date },
        end: { date: nextCalendarDate(date) },
      },
    };
  }

  if (!startTime) {
    return { ok: false, code: CALENDAR_ERROR_CODES.MISSING_EFFECTIVE_DATE, message: "This item has no start time to publish." };
  }
  if (!householdTimezone) {
    return { ok: false, code: CALENDAR_ERROR_CODES.MISSING_HOUSEHOLD_TIMEZONE, message: "Set your household timezone in Parent Tools before publishing a timed item." };
  }

  let finalEndTime;
  if (endTime) {
    if (optionalEndTime) {
      return { ok: false, code: CALENDAR_ERROR_CODES.UNEXPECTED_OPTIONAL_END_TIME, message: "This item already has an end time." };
    }
    finalEndTime = endTime;
  } else {
    if (!optionalEndTime) {
      return { ok: false, code: CALENDAR_ERROR_CODES.MISSING_END_TIME, message: "This item has a start time but no end time — an end time is required to publish it." };
    }
    if (!HH_MM_RE.test(optionalEndTime)) {
      return { ok: false, code: CALENDAR_ERROR_CODES.INVALID_OPTIONAL_END_TIME, message: "Enter a valid end time (HH:MM)." };
    }
    finalEndTime = optionalEndTime;
  }

  if (finalEndTime <= startTime) {
    return { ok: false, code: CALENDAR_ERROR_CODES.END_NOT_AFTER_START, message: "The end time must be later than the start time." };
  }

  // Only non-due types (school_event/family_event/test/quiz/reminder) ever
  // reach here — due types always returned above. Description is plain
  // Item.notes, same as before this fix.
  const description = item.notes || undefined;

  return {
    ok: true,
    event: {
      id,
      summary,
      ...(description ? { description } : {}),
      start: { dateTime: `${date}T${startTime}:00`, timeZone: householdTimezone },
      end: { dateTime: `${date}T${finalEndTime}:00`, timeZone: householdTimezone },
    },
  };
}
