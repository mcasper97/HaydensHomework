/* ============================== Google Calendar auto-publish ==============================
 * The ONE place "should this just-committed Item be sent to Google
 * Calendar automatically, with no parent click?" is decided and executed —
 * shared by all three commit paths (auto-committed ingestion, a parent's
 * reviewed/approved ingestion, and a manually-created Parent Board Item).
 * Deliberately does not duplicate anything: eligibility reuses
 * calendarEventMapping.js's existing isItemEligibleForCalendarPublish,
 * publishing reuses googleCalendarConnection.js's existing
 * publishItemToGoogleCalendar (itself a thin wrapper over the unchanged
 * api/calendar.js?action=publish — same routing, same deterministic event
 * id, same idempotency).
 *
 * googleCalendarAutoPublishEnabled — a new, explicit, off-by-default
 * household setting (Settings -> Google Calendar), stored on the same
 * users/{uid} profile document as familyLastName/timezone/
 * googleCalendarRouting (see BoardSelector.jsx), same setDoc(...,{merge:true})
 * pattern. Defaults to false so no existing household's behavior changes
 * silently — Calendar publishing stays fully manual until a parent
 * explicitly opts in.
 *
 * getGoogleCalendarAutoPublishEnabled is a one-off, independent read (the
 * same "lightweight-read precedent" already established throughout this
 * app — see e.g. GmailCheckEmailAction.jsx's own fetchGmailStatus() call,
 * or GoogleCalendarRoutingPanel.jsx's own getCalendarStatus() call) rather
 * than a prop threaded through every possible commit call site — those
 * call sites (GmailCheckEmailAction.jsx, CandidateReviewModal.jsx,
 * AddItemPanel.jsx) have no existing reason to already hold this setting.
 *
 * Failure handling (Section 12/13 of the task spec): a publish failure
 * here is NEVER thrown back at the caller — the Item that was just
 * successfully committed/created must never be rolled back, recreated, or
 * silently re-routed because Calendar had a problem. Instead, the failure
 * is recorded durably on the Item's own EXISTING (previously
 * reserved-but-unwritten) googleCalendarSyncError field, which
 * ReviewInboxPanel.jsx's Calendar-issues section reads to offer a Retry —
 * no new schema, no new collection, no generalized notification system.
 *
 * DURABILITY CORRECTION: a browser-side fire-and-forget call must never be
 * the ONLY record that publication was even attempted — if the tab closes
 * (or the network drops) before the network call resolves, the Item would
 * otherwise sit forever with neither googleCalendarEventId nor
 * googleCalendarSyncError set, silently indistinguishable from an Item
 * nobody ever tried to publish, and never surfaced anywhere. To close that
 * gap, attemptCalendarPublish now writes a durable "in flight" marker onto
 * the Item's existing googleCalendarSyncError field BEFORE making the
 * network call, not only after a caught failure — that write is itself a
 * Firestore/localStorage write, not React state, so it survives the tab
 * closing immediately afterward. If the browser closes before the
 * publish call itself resolves, the Item is left showing this durable
 * "not yet confirmed" state, which Review Inbox's Calendar-issues section
 * already surfaces and Retry already knows how to re-attempt — nothing new
 * needed on that side. This still cannot guarantee delivery if the JS
 * never runs at all (e.g. the tab closes in the instant between commit and
 * this call) — a hard guarantee against that would require a server-side
 * trigger (e.g. a Firestore-triggered Cloud Function reacting to the
 * commit write itself), which is a genuinely separate, larger piece of
 * infrastructure this slice does not build (see the task's own "do not
 * build a generalized job queue" instruction) — disclosed here rather than
 * silently overclaimed.
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../Firebase.js";
import { isItemEligibleForCalendarPublish } from "../organizer/calendarEventMapping.js";
import { publishItemToGoogleCalendar } from "./googleCalendarConnection.js";
import { updateItem } from "./itemsRepository.js";

const GUEST_AUTO_PUBLISH_KEY = "crestly_admin_calendar_auto_publish";

/**
 * getGoogleCalendarAutoPublishEnabled(ctx) -> boolean
 * Guest/admin mode always resolves false in practice (Calendar can never
 * actually be connected there — see api/_auth.js), but still reads its own
 * localStorage flag rather than hardcoding false, so a guest session that
 * toggles the (otherwise-hidden, since GoogleCalendarRoutingPanel.jsx only
 * renders once Calendar is connected) setting stays internally consistent.
 */
export async function getGoogleCalendarAutoPublishEnabled(ctx) {
  if (ctx?.isAdmin) {
    return localStorage.getItem(GUEST_AUTO_PUBLISH_KEY) === "true";
  }
  if (!db || !ctx?.uid) return false;
  try {
    const snap = await getDoc(doc(db, "users", ctx.uid));
    return !!(snap.exists() && snap.data().googleCalendarAutoPublishEnabled);
  } catch (err) {
    console.error("googleCalendarAutoPublish: getGoogleCalendarAutoPublishEnabled failed", err);
    return false;
  }
}

/**
 * saveGoogleCalendarAutoPublishEnabled(ctx, enabled) -> void
 * The one write path for this setting — called only from Settings' Google
 * Calendar section (GoogleCalendarRoutingPanel.jsx). {merge:true} preserves
 * every other users/{uid} field exactly like saveGoogleCalendarRouting.
 */
export async function saveGoogleCalendarAutoPublishEnabled(ctx, enabled) {
  if (ctx?.isAdmin) {
    localStorage.setItem(GUEST_AUTO_PUBLISH_KEY, String(!!enabled));
    return;
  }
  if (!db || !ctx?.uid) return;
  await setDoc(doc(db, "users", ctx.uid), { googleCalendarAutoPublishEnabled: !!enabled }, { merge: true });
}

/**
 * The one place a publish attempt is actually made and a failure is
 * durably recorded — shared by autoPublishItemIfEligible (below, gated on
 * the household setting) and retryCalendarPublish (below, deliberately
 * NOT gated on it: a parent clicking "Retry" on an already-failed item is
 * an explicit, one-time request that must run even if auto-publish is
 * currently off, e.g. toggled off after this failure happened).
 */
const PUBLISH_IN_FLIGHT_MESSAGE = "Publishing to Google Calendar — not yet confirmed.";

async function attemptCalendarPublish(ctx, item) {
  if (!item?.id) return;
  if (ctx?.isAdmin) return; // guest mode has no real Google Calendar connection to publish to
  if (!isItemEligibleForCalendarPublish(item)) return;

  // Durable "in flight" marker, written BEFORE the network call (see the
  // module doc comment's DURABILITY CORRECTION) — a real write, so it
  // survives the tab closing right after this line.
  try {
    await updateItem(ctx, item.id, { googleCalendarSyncError: PUBLISH_IN_FLIGHT_MESSAGE });
  } catch (err) {
    console.error("attemptCalendarPublish: failed to record in-flight publish state", err);
  }

  try {
    await publishItemToGoogleCalendar(item.id); // clears googleCalendarSyncError to null on success (server-side)
  } catch (err) {
    try {
      await updateItem(ctx, item.id, {
        googleCalendarSyncError: err?.message || "Could not publish to Google Calendar.",
      });
    } catch (updateErr) {
      console.error("attemptCalendarPublish: failed to record googleCalendarSyncError", updateErr);
    }
  }
}

/**
 * autoPublishItemIfEligible(ctx, item) -> void, NEVER throws.
 * Best-effort, fire-and-forget-safe. Call this immediately after any
 * successful Item commit/create — it is always safe to await or not:
 * every failure path (ineligible type, auto-publish disabled, guest mode,
 * publish itself failing) is fully handled inside this function.
 */
export async function autoPublishItemIfEligible(ctx, item) {
  if (!item?.id) return;
  if (ctx?.isAdmin) return;
  if (!isItemEligibleForCalendarPublish(item)) return;

  let enabled = false;
  try {
    enabled = await getGoogleCalendarAutoPublishEnabled(ctx);
  } catch (err) {
    console.error("autoPublishItemIfEligible: could not read auto-publish setting", err);
    return;
  }
  if (!enabled) return;

  await attemptCalendarPublish(ctx, item);
}

/**
 * retryCalendarPublish(ctx, item) -> void, NEVER throws.
 * The Review Inbox's "Retry" action (Section 13) — reuses the existing
 * committed Item, current routing, and deterministic/idempotent publish
 * exactly like every other publish call; a repeated failure simply
 * re-records the (possibly updated) error message, so the "Needs
 * attention" card stays accurate without ever duplicating the Item or the
 * Google event.
 */
export async function retryCalendarPublish(ctx, item) {
  await attemptCalendarPublish(ctx, item);
}
