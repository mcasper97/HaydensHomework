/* ============================== Google Calendar API client (server-only) ==============================
 * Slice C. Raw-fetch wrapper around the two Calendar REST calls Slice C
 * needs (refresh the connection's access token, insert one event) — same
 * dependency-free philosophy as api/_gmailMessages.js/api/_googleOAuth.js:
 * no googleapis/google-auth-library, just fetch + standard primitives.
 * `fetchFn` is injectable throughout for offline unit testing.
 *
 * This is the ONE place Node's `crypto` is used to derive the
 * deterministic Google event id (see deriveGoogleEventId below) — kept
 * out of src/organizer/calendarEventMapping.js specifically so that
 * client-safe module never needs a Node-only module in its dependency
 * graph (see that file's own header comment).
 *
 * No update/delete methods yet — Slice C is create-only (see
 * api/calendar-publish.js); those are Slice D/E's concern.
 */
import crypto from "node:crypto";
import { refreshAccessToken } from "./_googleOAuth.js";
import { markGoogleCalendarConnectionNeedsReconnect } from "./_googleCalendarConnectionsStore.js";

const CALENDAR_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

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
 * defense (see api/calendar-publish.js's own doc comment), not merely
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

/**
 * insertCalendarEvent({ accessToken, event, fetchFn? }) -> normalized result
 *
 * `event` already carries its own deterministic `id` (see
 * deriveGoogleEventId above / calendarEventMapping.js). A 409 response
 * means Google already has an event at this id — per Google's own
 * documented behavior, this means a PRIOR insert with this same
 * deterministic id already succeeded (most likely a retry after this
 * server's earlier Firestore linkage write failed) — this is treated as
 * success, not an error, so the caller can proceed to (re)persist the
 * Item's linkage fields without ever creating a duplicate event.
 *
 * Deliberately never logs the raw response body — it may contain the
 * event's own title/description (a child's homework detail) or other
 * account-scoped content; only a short, safe summary is ever surfaced in
 * the returned `error` string.
 */
export async function insertCalendarEvent({ accessToken, event, fetchFn = fetch }) {
  let res;
  try {
    res = await fetchFn(CALENDAR_EVENTS_ENDPOINT, {
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

  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body — fall through to the generic status-based error below.
  }

  if (!res.ok) {
    return { ok: false, error: `Google Calendar could not create this event (status ${res.status}).` };
  }

  return { ok: true, alreadyExisted: false, eventId: (json && json.id) || event.id };
}
