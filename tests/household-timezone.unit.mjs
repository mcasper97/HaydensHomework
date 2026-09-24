/**
 * Focused unit tests for Slice A (Google Calendar Phase 1 groundwork) —
 * src/data/householdTimezone.js's isValidIanaTimezone/suggestBrowserTimezone.
 * Pure logic, zero Firestore/localStorage — safe to test directly in
 * plain Node (Node's own Intl implementation ships full ICU by default,
 * so this validates identically here as it would in a browser).
 *
 * Usage: node tests/household-timezone.unit.mjs
 */
import { isValidIanaTimezone, suggestBrowserTimezone, householdCurrentTimeStr } from "../src/data/householdTimezone.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ isValidIanaTimezone — valid values accepted ============
ok("A well-known IANA zone (America/New_York) is accepted", isValidIanaTimezone("America/New_York"));
ok("Another well-known IANA zone (Europe/London) is accepted", isValidIanaTimezone("Europe/London"));
ok("Asia/Tokyo is accepted", isValidIanaTimezone("Asia/Tokyo"));
ok("Australia/Sydney is accepted", isValidIanaTimezone("Australia/Sydney"));
ok("UTC is accepted", isValidIanaTimezone("UTC"));

// ============ isValidIanaTimezone — invalid values rejected ============
ok("A nonsense string is rejected", !isValidIanaTimezone("Not/A/Real/Zone"));
ok("An empty string is rejected", !isValidIanaTimezone(""));
ok("A whitespace-only string is rejected", !isValidIanaTimezone("   "));
ok("A plain UTC offset (not an IANA name) is rejected", !isValidIanaTimezone("GMT-5"));
ok("null is rejected without throwing", !isValidIanaTimezone(null));
ok("undefined is rejected without throwing", !isValidIanaTimezone(undefined));
ok("A number is rejected without throwing", !isValidIanaTimezone(5));
ok("A misspelled zone name is rejected", !isValidIanaTimezone("America/New_Yrok"));

// ============ isValidIanaTimezone — trims surrounding whitespace ============
ok("Leading/trailing whitespace around a valid zone is still accepted", isValidIanaTimezone("  America/New_York  "));

// ============ suggestBrowserTimezone ============
{
  const suggestion = suggestBrowserTimezone();
  ok("suggestBrowserTimezone() returns a string or null, never throws", suggestion === null || typeof suggestion === "string");
  if (typeof suggestion === "string") {
    ok("A non-null suggestion is itself a valid IANA timezone (round-trips through isValidIanaTimezone)", isValidIanaTimezone(suggestion));
  }
}

// ============ householdCurrentTimeStr ============
// Added for the scheduled-ingestion runner's due-time comparison (see
// api/_scheduledIngestionRunner.js) — mirrors householdTodayStr's exact
// validation/fail-safe contract (null in, null out; never throws).
{
  // A fixed UTC instant: 2026-01-15T15:30:00Z
  const fixedNow = new Date("2026-01-15T15:30:00Z");

  ok(
    "A valid timezone + fixed now produces the expected HH:MM (UTC)",
    householdCurrentTimeStr("UTC", fixedNow) === "15:30"
  );
  ok(
    "A valid timezone + fixed now produces the expected HH:MM (America/New_York, UTC-5 in January)",
    householdCurrentTimeStr("America/New_York", fixedNow) === "10:30"
  );
  ok(
    "An invalid timezone returns null without throwing",
    householdCurrentTimeStr("Not/A/Real/Zone", fixedNow) === null
  );
  ok(
    "A missing (undefined) timezone returns null without throwing",
    householdCurrentTimeStr(undefined, fixedNow) === null
  );
  ok(
    "A null timezone returns null without throwing",
    householdCurrentTimeStr(null, fixedNow) === null
  );
  ok(
    "Two different timezones given the SAME fixed now produce different HH:MM results (timezone genuinely affects the computed local time)",
    householdCurrentTimeStr("UTC", fixedNow) !== householdCurrentTimeStr("America/New_York", fixedNow)
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
