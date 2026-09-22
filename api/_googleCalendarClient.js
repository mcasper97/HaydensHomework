/* ============================== Google Calendar API client (server-only) ==============================
 * Slice C. Raw-fetch wrapper around the Calendar REST calls this app
 * needs (refresh the connection's access token, insert one event, list
 * calendars) — same dependency-free philosophy as
 * api/_gmailMessages.js/api/_googleOAuth.js: no googleapis/
 * google-auth-library, just fetch + standard primitives. `fetchFn` is
 * injectable throughout for offline unit testing.
 *
 * This is the ONE place Node's `crypto` is used to derive the
 * deterministic Google event id (see deriveGoogleEventId below) — kept
 * out of src/organizer/calendarEventMapping.js specifically so that
 * client-safe module never needs a Node-only module in its dependency
 * graph (see that file's own header comment).
 *
 * listCalendars (Slice C.1A) is read-only support for routing
 * configuration (Slice C.1B) — it is a separate call from
 * insertCalendarEvent. No update/delete event methods yet — Slice C is
 * create-only (see api/calendar.js's publish action); those are Slice
 * D/E's concern.
 */
import crypto from "node:crypto";
import { refreshAccessToken } from "./_googleOAuth.js";
import { markGoogleCalendarConnectionNeedsReconnect } from "./_googleCalendarConnectionsStore.js";

const CALENDAR_LIST_ENDPOINT = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

/**
 * eventsEndpoint(calendarId) -> the events.insert URL for that calendar.
 * calendarId is treated as an OPAQUE string (Slice C.1C) — it may be the
 * literal alias "primary", the connected account's own email address, or
 * a group-calendar id (typically "<hash>@group.calendar.google.com") —
 * never assumed to be any particular shape, and always
 * encodeURIComponent'd, since Google calendar ids can contain "@" and
 * other characters that are not URL-path-safe as-is.
 */
function eventsEndpoint(calendarId) {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

/**
 * deriveGoogleEventId(itemId) -> a deterministic, Google-compliant event id
 *
 * Google's events.insert accepts an optional client-supplied `id`, which
 * MUST use base32hex encoding (lowercase 0-9 and a-v only) and be between
 * 5 and 1024 characters, unique per calendar — verified against Google's
 * own documented event-id requirements before implementing this. A
 * Firestore document id uses a different charset (mixed-case
 * alphanumeric) and is not itself compliant, so this hashes the Item's
 * own id (SHA-1, 20 bytes = exactly 32 base32hex characters, no padding)
 * rather than using it directly.
 *
 * Deterministic: the SAME itemId always produces the SAME event id, every
 * time, on every server instance — this is the actual idempotency
 * defense (see api/calendar.js's own doc comment), not merely
 * "check googleCalendarEventId is null first". A retried publish attempt
 * (whether from a genuine double-click or a recovery from a prior
 * partial failure) always targets the exact same Google event.
 */
export function deriveGoogleEventId(itemId) {
  const digest = crypto.createHash("sha1").update(String(itemId)).digest();
  const ALPHABET = "0123456789abcdefghijklmnopqrstuv";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/**
 * refreshCalendarAccessToken(uid, connection) -> { ok: true, accessToken }
 *                                               | { ok: false, needsReconnect: true }
 *                                               | { ok: false, needsReconnect: false, error }
 * Mirrors api/gmail-check-email.js's own invalid_grant handling for
 * Gmail, applied to the Calendar connection: an invalid_grant refresh
 * failure marks googleCalendarConnections/{uid}.needsReconnect (see
 * api/_googleCalendarConnectionsStore.js) so the Parent Tools panel shows
 * "Reconnect required" on its next status check, and this call returns a
 * distinct needsReconnect result the caller can act on without treating
 * it as a generic/transient failure.
 */
export async function refreshCalendarAccessToken(uid, connection, { fetchFn = fetch } = {}) {
  try {
    const tokens = await refreshAccessToken(connection.refreshToken, { fetchFn });
    return { ok: true, accessToken: tokens.access_token };
  } catch (err) {
    if (err?.isInvalidGrant) {
      await markGoogleCalendarConnectionNeedsReconnect(uid);
      return { ok: false, needsReconnect: true };
    }
    return { ok: false, needsReconnect: false, error: err?.message || "Could not refresh Google Calendar access." };
  }
}

// Reason codes Google uses on a 403 for quota/rate/usage-limit conditions
// — NEVER a "this calendar doesn't exist or isn't writable" signal, even
// though both surface as the same 403 status code. Conflating these was
// a real bug in an earlier pass: treating every insert 403 as a stale
// route would have told a parent to go "fix" a routing config that was
// never actually the problem, on what's usually a transient condition.
const QUOTA_OR_RATE_REASONS = new Set([
  "userRateLimitExceeded",
  "rateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
  "dailyLimitExceededUnreg",
]);

// Reason codes that DO narrowly indicate "the authenticated user doesn't
// have sufficient write access to this specific calendar" — Google's
// documented reason for events.insert against a calendar you can't write
// to (or that no longer exists in a way the API can resolve write access
// for) is "forbidden"; "insufficientPermissions"/"notACalendarUser" are
// included as the same category should Google's API surface them here.
const WRITE_ACCESS_DENIED_REASONS = new Set([
  "forbidden",
  "insufficientPermissions",
  "notACalendarUser",
]);

/**
 * isCalendarWriteAccessDeniedError(json) -> boolean
 *
 * Narrow, server-side-only inspection of a 403 events.insert response
 * (same documented Google error shape as calendarList.list's own
 * classifier in this file's listCalendars — see
 * isCalendarListScopeMissingError in api/calendar-list.js's usage) to
 * distinguish "this specific calendar isn't writable" from every OTHER
 * reason Google returns a 403 on events.insert (quota, per-user rate
 * limiting, daily limits). A 403 status code ALONE is not evidence of
 * either — only a matching, positively-identified reason code is. If the
 * body is unparseable or carries no recognized reason at all, this
 * returns false (NOT route-invalid) — there must be positive evidence of
 * a write-access problem before telling a parent their routing
 * configuration is broken; the default is a generic, retryable failure.
 */
function isCalendarWriteAccessDeniedError(json) {
  const errors = Array.isArray(json?.error?.errors) ? json.error.errors : [];
  if (errors.some((e) => QUOTA_OR_RATE_REASONS.has(e?.reason))) return false;
  return errors.some((e) => WRITE_ACCESS_DENIED_REASONS.has(e?.reason));
}

/**
 * insertCalendarEvent({ accessToken, calendarId, event, fetchFn? }) -> normalized result
 *
 * `calendarId` (Slice C.1C) is the actual destination — resolved by
 * src/organizer/calendarRouting.js's resolveGoogleCalendarId, never
 * hardcoded to "primary" here. Treated as opaque (see eventsEndpoint
 * above). `event` already carries its own deterministic `id` (see
 * deriveGoogleEventId above / calendarEventMapping.js). A 409 response
 * means Google already has an event at this id ON THIS CALENDAR — per
 * Google's own documented behavior, this means a PRIOR insert with this
 * same deterministic id already succeeded (most likely a retry after
 * this server's earlier Firestore linkage write failed) — this is
 * treated as success, not an error, so the caller can proceed to
 * (re)persist the Item's linkage fields without ever creating a
 * duplicate event. (Google event ids are unique per calendar, not
 * globally — a 409 here is specifically "this id already exists on THIS
 * calendarId", which is exactly the recovery case this is meant to
 * catch, since a retry always targets the same calendarId as the
 * original attempt within one publish call.)
 *
 * `notFound: true` (route/destination invalid) is reported ONLY when:
 *   - the response is a 404 (the calendarId itself doesn't exist), or
 *   - the response is a 403 whose body narrowly indicates insufficient
 *     write access to THIS calendar (isCalendarWriteAccessDeniedError
 *     above) — NEVER for a 403 that's actually quota/rate limiting
 *     (post-approval correction: a bare 403 status is not, by itself,
 *     evidence of either condition — see that function's own doc
 *     comment). A quota/rate 403, or any other non-matching failure, is
 *     a plain generic error instead — the caller (api/calendar.js) must
 *     never treat it as a reason to blame the household's routing
 *     configuration.
 *
 * Deliberately never logs the raw response body — it may contain the
 * event's own title/description (a child's homework detail) or other
 * account-scoped content; only a short, safe summary is ever surfaced in
 * the returned `error` string, and the narrow reason-code inspection
 * above never leaks further than the boolean it produces.
 */
export async function insertCalendarEvent({ accessToken, calendarId, event, fetchFn = fetch }) {
  let res;
  try {
    res = await fetchFn(eventsEndpoint(calendarId), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch (err) {
    return { ok: false, error: "Could not reach Google Calendar." };
  }

  if (res.status === 409) {
    return { ok: true, alreadyExisted: true, eventId: event.id };
  }

  if (res.status === 404) {
    return { ok: false, notFound: true, error: "Google Calendar could not find the configured calendar." };
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body — can't be narrowly classified as write-access-denied,
    // so this falls through to the generic status-based error below, same
    // as any other unparseable failure response.
  }

  if (res.status === 403 && isCalendarWriteAccessDeniedError(json)) {
    return { ok: false, notFound: true, error: "Google Calendar could not write to the configured calendar." };
  }

  if (!res.ok) {
    return { ok: false, error: `Google Calendar could not create this event (status ${res.status}).` };
  }

  return { ok: true, alreadyExisted: false, eventId: (json && json.id) || event.id };
}

/**
 * isCalendarListScopeMissingError(json) -> boolean
 *
 * Narrow, server-side-only inspection of Google's documented Calendar API
 * error shape ({ error: { message, errors: [{ reason, message }, ...] } })
 * to distinguish "this 403 means the token lacks
 * calendar.calendarlist.readonly" from every other reason Google might
 * return a 403 (quota, rate limiting, a suspended project, etc.) — a 403
 * status code alone is NOT a reliable signal on its own (correction after
 * the first C.1A pass over-classified every 403 as scope-missing).
 *
 * Checks, in order:
 *   1. error.errors[].reason === "insufficientPermissions" — Google's own
 *      documented reason code for an insufficient-scope failure.
 *   2. error.message (or a nested errors[].message) matching wording
 *      Google actually uses for this condition ("insufficient
 *      authentication scopes", "insufficient permission") — a fallback
 *      for the cases where Calendar returns the message without a
 *      structured reason code.
 * Never trusted for anything security-sensitive beyond this
 * classification, and never returned to the browser or logged — see
 * listCalendars's own doc comment below.
 */
function isCalendarListScopeMissingError(json) {
  const errors = Array.isArray(json?.error?.errors) ? json.error.errors : [];
  if (errors.some((e) => e?.reason === "insufficientPermissions")) return true;

  const SCOPE_MESSAGE_RE = /insufficient\s+(authentication\s+)?(scope|permission)/i;
  const messages = [json?.error?.message, ...errors.map((e) => e?.message)].filter(Boolean);
  return messages.some((m) => SCOPE_MESSAGE_RE.test(m));
}

/**
 * listCalendars({ accessToken, fetchFn? }) -> { ok: true, calendars }
 *                                            | { ok: false, scopeMissing: true }
 *                                            | { ok: false, error }
 *
 * Calendar List support (Slice C.1A) — used by api/calendar.js's "list"
 * action for routing configuration (Slice C.1B); not called by the
 * "publish" action, which uses insertCalendarEvent instead.
 *
 * Filters to calendars the parent can actually publish to
 * (accessRole "writer" or "owner" — Google's other roles, "reader" and
 * "freeBusyReader", can't receive events.insert) and strips every field
 * down to exactly { id, summary, primary, accessRole } — no color,
 * notification, ACL, conferencing, description, or timeZone metadata, and
 * no raw Google fields pass through un-inspected.
 *
 * scopeMissing: true is a DELIBERATELY DISTINCT result from every other
 * failure here — see the module doc comment in api/calendar-list.js for
 * why this must never be conflated with needsReconnect. It is set ONLY
 * when the 403 response body itself narrowly indicates an insufficient-
 * scope condition (isCalendarListScopeMissingError above) — a bare 403
 * status (quota, rate limiting, or any other cause) falls through to the
 * generic error path instead, exactly like any other non-ok status. No
 * scope string is cached/persisted anywhere to infer this; Google's own
 * live response is the sole source of truth (see api/_googleOAuth.js's
 * CALENDAR_SCOPES comment on why an existing connection may lack this
 * specific access even though nothing about the connection itself is
 * broken). The raw response body is inspected here, server-side only, for
 * exactly the two documented fields above — never logged, never returned
 * to the browser (see api/calendar-list.js, which only ever returns its
 * own fixed message strings).
 */
export async function listCalendars({ accessToken, fetchFn = fetch }) {
  let res;
  try {
    res = await fetchFn(CALENDAR_LIST_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: "Could not reach Google Calendar." };
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body — can't be narrowly classified as scope-missing, so
    // this falls through to the generic status-based error below, same as
    // any other unparseable failure response.
  }

  if (res.status === 403 && isCalendarListScopeMissingError(json)) {
    return { ok: false, scopeMissing: true };
  }

  if (!res.ok) {
    return { ok: false, error: `Google Calendar could not list your calendars (status ${res.status}).` };
  }

  const items = Array.isArray(json?.items) ? json.items : [];
  const calendars = items
    .filter((entry) => entry?.accessRole === "writer" || entry?.accessRole === "owner")
    .map((entry) => ({
      id: entry.id,
      summary: entry.summary || entry.id,
      primary: !!entry.primary,
      accessRole: entry.accessRole,
    }));

  return { ok: true, calendars };
}
