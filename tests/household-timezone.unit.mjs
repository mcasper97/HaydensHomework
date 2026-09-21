/**
 * Focused unit tests for Slice A (Google Calendar Phase 1 groundwork) —
 * src/data/householdTimezone.js's isValidIanaTimezone/suggestBrowserTimezone.
 * Pure logic, zero Firestore/localStorage — safe to test directly in
 * plain Node (Node's own Intl implementation ships full ICU by default,
 * so this validates identically here as it would in a browser).
 *
 * Usage: node tests/household-timezone.unit.mjs
 */
import { isValidIanaTimezone, suggestBrowserTimezone } from "../src/data/householdTimezone.js";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
