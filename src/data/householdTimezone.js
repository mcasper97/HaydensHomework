/* ============================== Household timezone (Slice A) ==============================
 * Pure helpers for the canonical household timezone (users/{uid}.timezone
 * — see AuthShell.jsx's ChildSelector, which owns the actual read/write,
 * mirroring familyLastName's exact existing persistence pattern; this
 * module intentionally holds no Firestore/localStorage I/O of its own,
 * same rationale as itemFormValidation.js being kept JSX/IO-free so it's
 * directly unit-testable in plain Node).
 *
 * This slice establishes the canonical field ONLY — it does not touch
 * todayStr(), recurring reminder date logic, Organizer date logic, or
 * anything Google-Calendar-related. A future Calendar-publishing slice is
 * the first actual consumer of this stored value.
 */

/**
 * isValidIanaTimezone(value) -> boolean
 * Deterministic, browser/Node(ICU)-supported validation — attempts to
 * construct an Intl.DateTimeFormat with the given timeZone and treats the
 * RangeError it throws for an unrecognized zone name as "invalid". No
 * hardcoded IANA zone list to keep in sync — this stays accurate as long
 * as the runtime's own ICU timezone database does.
 */
export function isValidIanaTimezone(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * suggestBrowserTimezone() -> IANA string | null
 * The CURRENT device's own timezone, offered only as a one-time SUGGESTION
 * for the parent to confirm or change — never persisted automatically, and
 * never re-read at any later point (see AuthShell.jsx: the stored
 * users/{uid}.timezone value, once saved, is the sole authoritative
 * source from then on).
 */
export function suggestBrowserTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz ? tz : null;
  } catch {
    return null;
  }
}

/**
 * householdTodayStr(timezone) -> "YYYY-MM-DD" | null
 * Family Board unified-agenda addition — "today" resolved in the
 * household's own configured timezone rather than the UTC date
 * itemBuckets.js's todayStr() has always used (a pre-existing,
 * already-disclosed project limitation everywhere else — see that
 * module's own doc comment). Deliberately narrow and additive: this does
 * NOT change todayStr() or any of its existing callers (ChildTodayView.jsx,
 * OrganizerCalendar.jsx, etc.) — it's a second, opt-in helper, used only
 * by organizer/familyAgenda.js to decide which of Today/Tomorrow/Later
 * this week/Overdue a row belongs in.
 *
 * Returns null when the timezone is missing or invalid (a household that
 * hasn't configured one yet, or a corrupted value) so the caller can fall
 * back to todayStr() exactly as before — never silently defaults to any
 * particular zone.
 */
export function householdTodayStr(timezone) {
  if (!isValidIanaTimezone(timezone)) return null;
  try {
    // en-CA formats as YYYY-MM-DD — the exact date-string convention this
    // app already uses everywhere else (startDate/dueDate/etc.).
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return null;
  }
}
