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
