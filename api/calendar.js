/* ============================== Google Calendar — consolidated action router ==============================
 * Infrastructure change (post-Slice-C.1A) — NOT a product/behavior change.
 * Folds five previously-separate Vercel Serverless Functions into one, to
 * stay under the Hobby plan's 12-function limit (adding api/calendar-list.js
 * in Slice C.1A pushed the repo to 13). Vercel does not deploy a function
 * for any api/ file whose name starts with an underscore, but every
 * non-underscore top-level file under api/ — including this one — is its
 * own function, so consolidating INTO fewer top-level files is the only
 * lever available without a broader rewrite.
 *
 * Routes handled here (dispatch on `action`, works for both GET's query
 * string and POST's query string alike — no body parsing needed to route):
 *   GET  /api/calendar?action=status
 *   GET  /api/calendar?action=list
 *   POST /api/calendar?action=oauth-start
 *   POST /api/calendar?action=disconnect
 *   POST /api/calendar?action=publish      (body: { itemId, optionalEndTime? })
 *
 * api/calendar-oauth-callback.js is DELIBERATELY NOT folded in here — its
 * URL is the literal `redirect_uri` registered with Google in Cloud
 * Console (must match exactly at both authorization-request time and
 * token-exchange time per OAuth spec), so consolidating it would require
 * an external, out-of-repo reconfiguration on every deploy. It stays its
 * own separate file/function, completely unchanged by this slice.
 *
 * Each action below is the exact same handler BODY the five deleted files
 * (api/calendar-status.js, api/calendar-list.js, api/calendar-oauth-start.js,
 * api/calendar-disconnect.js, api/calendar-publish.js) used to run as their
 * own top-level `export default async function handler(req, res)` —
 * moved into named internal functions and dispatched to, not redesigned.
 * Every response shape, controlled error code (NOT_CONNECTED,
 * needsReconnect, CALENDAR_LIST_SCOPE_MISSING, calendarEventMapping's
 * CALENDAR_ERROR_CODES), and security property (requireFirebaseUser,
 * server-only tokens, deterministic event id / idempotent publish,
 * disconnect's conditional-revoke logic) is unchanged.
 *
 * RATE LIMITING (the one thing that could NOT be a pure copy-paste):
 * checkRateLimit(key) (api/_auth.js) keys its in-memory bucket by
 * whatever string it's given — it has no notion of "uid" beyond using it
 * as an opaque Map key, so it safely accepts a NAMESPACED key without any
 * change to that shared module. Before this slice, each of the five
 * actions ran as its own separate Lambda process, so each effectively had
 * its OWN independent rate-limit bucket per parent. Folding them into one
 * file would silently collapse that into a single shared bucket if the
 * same bare `uid` were reused for every action — a real behavior change,
 * not just a file-layout change. To preserve today's isolation exactly,
 * each rate-limited action here calls checkRateLimit with its own
 * action-namespaced key (`calendar:<action>:${uid}`), so the four
 * currently-rate-limited actions (oauth-start, disconnect, publish, list)
 * keep FOUR independent budgets, exactly as four separate serverless
 * functions would have given them. `status` calls no rate limit at all,
 * exactly as api/calendar-status.js never did — status stays the one
 * genuinely unthrottled action, unchanged.
 *
 * Every protected action requires a valid Firebase ID token
 * (requireFirebaseUser) before doing anything else — checked once here,
 * before dispatch, so no action can be reached without it. An unknown or
 * missing `action`, or a request whose HTTP method doesn't match the
 * action it named, is rejected explicitly (400/405) rather than silently
 * falling through to any handler — see the dispatch table at the bottom.
 */
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import {
  getGoogleCalendarConnection,
  deleteGoogleCalendarConnection,
  sanitizeGoogleCalendarConnectionForClient,
} from "./_googleCalendarConnectionsStore.js";
import { getGmailConnection } from "./_gmailConnectionsStore.js";
import { getHouseholdTimezone } from "./_householdProfileStore.js";
import { getItem, setItemGoogleCalendarFields } from "./_itemsStore.js";
import {
  deriveGoogleEventId,
  refreshCalendarAccessToken,
  insertCalendarEvent,
  listCalendars,
} from "./_googleCalendarClient.js";
import { revokeToken, generateState, generatePkcePair, buildAuthorizationUrl, getOAuthConfig, CALENDAR_SCOPES } from "./_googleOAuth.js";
import { createOAuthState } from "./_googleCalendarConnectionsStore.js";
import { buildCalendarEventFromItem } from "../src/organizer/calendarEventMapping.js";

const CALENDAR_OAUTH_REDIRECT_URI_ENV_VAR = "GOOGLE_CALENDAR_OAUTH_REDIRECT_URI";

/* ============================== action: status (GET, unthrottled) ============================== */
async function handleStatus(req, res, uid) {
  try {
    const data = await getGoogleCalendarConnection(uid);
    return res.status(200).json({ ok: true, ...sanitizeGoogleCalendarConnectionForClient(data) });
  } catch (err) {
    console.error("calendar (status) error:", err);
    return res.status(500).json({ ok: false, error: "Could not load Google Calendar connection status." });
  }
}

/* ============================== action: list ============================== */
async function handleList(req, res, uid) {
  let connection;
  try {
    connection = await getGoogleCalendarConnection(uid);
  } catch (err) {
    console.error("calendar (list) error:", err);
    return res.status(500).json({ ok: false, error: "Could not load your Google Calendar connection." });
  }
  if (!connection?.refreshToken) {
    return res.status(400).json({ ok: false, code: "NOT_CONNECTED", error: "Connect Google Calendar in Parent Tools first." });
  }
  if (connection.needsReconnect) {
    return res.status(409).json({ ok: false, needsReconnect: true, error: "Reconnect Google Calendar in Parent Tools." });
  }

  const refreshed = await refreshCalendarAccessToken(uid, connection);
  if (!refreshed.ok) {
    if (refreshed.needsReconnect) {
      return res.status(409).json({ ok: false, needsReconnect: true, error: "Reconnect Google Calendar in Parent Tools." });
    }
    return res.status(502).json({ ok: false, error: refreshed.error || "Could not connect to Google Calendar. Please try again." });
  }

  const result = await listCalendars({ accessToken: refreshed.accessToken });
  if (!result.ok) {
    if (result.scopeMissing) {
      return res.status(403).json({
        ok: false,
        code: "CALENDAR_LIST_SCOPE_MISSING",
        error: "Reconnect Google Calendar to grant permission to list your calendars.",
      });
    }
    return res.status(502).json({ ok: false, error: result.error || "Could not load your Google calendars. Please try again." });
  }

  return res.status(200).json({ ok: true, calendars: result.calendars });
}

/* ============================== action: oauth-start ============================== */
async function handleOauthStart(req, res, uid) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig(CALENDAR_OAUTH_REDIRECT_URI_ENV_VAR);
  if (!clientId || !clientSecret || !redirectUri) {
    console.error("calendar (oauth-start): missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_CALENDAR_OAUTH_REDIRECT_URI");
    return res.status(500).json({ ok: false, error: "Google Calendar connection is not configured on this server." });
  }

  try {
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkcePair();
    await createOAuthState(state, { uid, codeVerifier });
    const authUrl = buildAuthorizationUrl({ state, codeChallenge, scopes: CALENDAR_SCOPES, redirectUriEnvVar: CALENDAR_OAUTH_REDIRECT_URI_ENV_VAR });
    return res.status(200).json({ ok: true, authUrl });
  } catch (err) {
    console.error("calendar (oauth-start) error:", err);
    return res.status(500).json({ ok: false, error: "Could not start Google Calendar connection. Please try again." });
  }
}

/* ============================== action: disconnect ============================== */
async function handleDisconnect(req, res, uid) {
  try {
    const existing = await getGoogleCalendarConnection(uid);
    if (existing?.refreshToken) {
      const gmailStillConnected = !!(await getGmailConnection(uid));
      if (!gmailStillConnected) {
        await revokeToken(existing.refreshToken);
      }
    }
    await deleteGoogleCalendarConnection(uid);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("calendar (disconnect) error:", err);
    return res.status(500).json({ ok: false, error: "Could not disconnect Google Calendar. Please try again." });
  }
}

/* ============================== action: publish ============================== */
async function handlePublish(req, res, uid) {
  const { itemId, optionalEndTime } = req.body || {};
  if (!itemId || typeof itemId !== "string") {
    return res.status(400).json({ ok: false, error: "Missing itemId." });
  }

  let connection;
  try {
    connection = await getGoogleCalendarConnection(uid);
  } catch (err) {
    console.error("calendar (publish) error:", err?.message);
    return res.status(500).json({ ok: false, error: "Could not load your Google Calendar connection." });
  }
  if (!connection?.refreshToken) {
    return res.status(400).json({ ok: false, code: "NOT_CONNECTED", error: "Connect Google Calendar in Parent Tools before publishing." });
  }
  if (connection.needsReconnect) {
    return res.status(409).json({ ok: false, needsReconnect: true, error: "Reconnect Google Calendar in Parent Tools before publishing." });
  }

  let item;
  try {
    item = await getItem(uid, itemId);
  } catch (err) {
    console.error("calendar (publish) error:", err?.message);
    return res.status(500).json({ ok: false, error: "Could not load this item." });
  }
  if (!item) {
    return res.status(404).json({ ok: false, error: "This item no longer exists." });
  }

  if (item.googleCalendarEventId) {
    return res.status(200).json({
      ok: true,
      alreadyPublished: true,
      googleCalendarEventId: item.googleCalendarEventId,
      googleCalendarSyncedAt: item.googleCalendarSyncedAt || null,
    });
  }

  const eventId = deriveGoogleEventId(itemId);

  let householdTimezone;
  try {
    householdTimezone = await getHouseholdTimezone(uid);
  } catch (err) {
    console.error("calendar (publish) error:", err?.message);
    return res.status(500).json({ ok: false, error: "Could not load your household timezone." });
  }

  const mapped = buildCalendarEventFromItem({ item, householdTimezone, optionalEndTime, eventId });
  if (!mapped.ok) {
    return res.status(400).json({ ok: false, code: mapped.code, error: mapped.message });
  }

  const refreshed = await refreshCalendarAccessToken(uid, connection);
  if (!refreshed.ok) {
    if (refreshed.needsReconnect) {
      return res.status(409).json({ ok: false, needsReconnect: true, error: "Reconnect Google Calendar in Parent Tools before publishing." });
    }
    return res.status(502).json({ ok: false, error: refreshed.error || "Could not connect to Google Calendar. Please try again." });
  }

  const inserted = await insertCalendarEvent({ accessToken: refreshed.accessToken, event: mapped.event });
  if (!inserted.ok) {
    return res.status(502).json({ ok: false, error: inserted.error || "Could not publish to Google Calendar. Please try again." });
  }

  try {
    await setItemGoogleCalendarFields(uid, itemId, {
      googleCalendarEventId: inserted.eventId,
      googleCalendarId: "primary",
      googleCalendarSyncedAt: new Date().toISOString(),
      googleCalendarSyncError: null,
    });
  } catch (err) {
    console.error("calendar (publish) error:", err?.message);
    return res.status(502).json({ ok: false, error: "Published to Google Calendar, but couldn't save the link — please try again." });
  }

  return res.status(200).json({
    ok: true,
    alreadyPublished: false,
    googleCalendarEventId: inserted.eventId,
    googleCalendarSyncedAt: new Date().toISOString(),
  });
}

/* ============================== dispatch ============================== */
// { method, rateLimitKey } — rateLimitKey null means "no rate limit for
// this action" (status only, matching api/calendar-status.js's own prior
// behavior exactly). Every other entry's key is namespaced per-action so
// each keeps an independent budget, exactly as five separate serverless
// functions would have given them (see the module doc comment above).
const ACTIONS = {
  status: { method: "GET", handler: handleStatus, rateLimitKey: null },
  list: { method: "GET", handler: handleList, rateLimitKey: (uid) => `calendar:list:${uid}` },
  "oauth-start": { method: "POST", handler: handleOauthStart, rateLimitKey: (uid) => `calendar:oauth-start:${uid}` },
  disconnect: { method: "POST", handler: handleDisconnect, rateLimitKey: (uid) => `calendar:disconnect:${uid}` },
  publish: { method: "POST", handler: handlePublish, rateLimitKey: (uid) => `calendar:publish:${uid}` },
};

export default async function handler(req, res) {
  const action = req.query?.action;
  if (!action || typeof action !== "string" || !ACTIONS[action]) {
    return res.status(400).json({ ok: false, error: "Unknown or missing action." });
  }

  const route = ACTIONS[action];
  if (req.method !== route.method) {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let uid;
  try {
    ({ uid } = await requireFirebaseUser(req));
  } catch {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  if (route.rateLimitKey && !checkRateLimit(route.rateLimitKey(uid))) {
    return res.status(429).json({ ok: false, error: "Too many requests — please wait a few minutes and try again." });
  }

  return route.handler(req, res, uid);
}
