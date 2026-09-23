import React, { useEffect, useState } from "react";
import { getCalendarStatus, startCalendarOAuth, getCalendarList } from "./data/googleCalendarConnection.js";
import { buildGoogleCalendarRoutingSave, saveGoogleCalendarRouting } from "./data/googleCalendarRouting.js";

/* ─────────────────────── Google Calendar Routing Panel (Slice C.1B) ───────────────────────
 * Moved verbatim out of AuthShell.jsx (UI/IA refactor) — now lives in
 * Settings' Google Calendar section instead of inline on the Parent page.
 * No behavior change. Lets a parent choose which Google calendar each
 * learner (and the family/default) publishes to — see
 * src/data/googleCalendarRouting.js for the persisted shape and
 * src/organizer/calendarRouting.js for how a publish action resolves it
 * (this panel only saves configuration, it never touches
 * calendar-publish.js or routes any Item).
 *
 * Only rendered when Calendar is connected at all (a connection record
 * exists) — see its render site. Within that, three distinct states the
 * fetched Calendar List can be in:
 *   - success -> the real selectors (default + one per current learner).
 *   - CALENDAR_LIST_SCOPE_MISSING -> "Reconnect Google Calendar to choose
 *     learner calendars." + a Reconnect action. Deliberately does NOT
 *     say publishing is broken — it isn't (see api/calendar.js's own doc
 *     comment: calendar.events still works on an old-scope connection).
 *   - needsReconnect (invalid_grant) -> existing reconnect-required
 *     semantics, same "Reconnect" action.
 *   - any other failure -> generic retryable error, no reconnect claim.
 *
 * Selections are draft-only (local state) until the parent explicitly
 * clicks Save — never auto-saved, never guessed/pre-mapped by name. A
 * "Use primary calendar" option represents the null/fallback case; every
 * writable calendar Google returned (including whichever one is actually
 * primary, labeled accordingly) is also independently selectable, so a
 * parent may explicitly choose the primary calendar by its real id
 * instead of relying on the fallback if they prefer. The literal string
 * "primary" is never itself a selectable value or a stored one — see
 * googleCalendarRouting.js's own doc comment.
 */
const GoogleCalendarRoutingPanel = ({ uid, familyChildren, googleCalendarRouting, onRoutingSaved }) => {
  const [calendarStatus, setCalendarStatus] = useState(null); // null = loading
  const [listState, setListState] = useState("idle"); // idle | loading | done | error
  const [calendars, setCalendars] = useState([]);
  const [listError, setListError] = useState("");
  const [listErrorKind, setListErrorKind] = useState(null); // "scopeMissing" | "needsReconnect" | "generic"
  const [reconnecting, setReconnecting] = useState(false);

  const [defaultCalendarId, setDefaultCalendarId] = useState(googleCalendarRouting.defaultCalendarId);
  const [childCalendarIds, setChildCalendarIds] = useState(googleCalendarRouting.childCalendarIds);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  // Re-sync draft selections whenever the loaded/saved routing config
  // itself changes (initial profile load, or right after this panel's
  // own successful save) — never otherwise, so an in-progress unsaved
  // edit is never silently overwritten mid-session.
  useEffect(() => {
    setDefaultCalendarId(googleCalendarRouting.defaultCalendarId);
    setChildCalendarIds(googleCalendarRouting.childCalendarIds);
  }, [googleCalendarRouting]);

  useEffect(() => {
    let cancelled = false;
    getCalendarStatus()
      .then((s) => { if (!cancelled) setCalendarStatus(s); })
      .catch(() => { if (!cancelled) setCalendarStatus({ connected: false, needsReconnect: false, connectedAt: null }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!calendarStatus?.connected) return undefined;
    let cancelled = false;
    setListState("loading");
    setListError("");
    setListErrorKind(null);
    getCalendarList()
      .then((result) => {
        if (cancelled) return;
        setCalendars(result);
        setListState("done");
      })
      .catch((e) => {
        if (cancelled) return;
        if (e.code === "CALENDAR_LIST_SCOPE_MISSING") setListErrorKind("scopeMissing");
        else if (e.needsReconnect) setListErrorKind("needsReconnect");
        else setListErrorKind("generic");
        setListError(e.message || "Could not load your Google calendars.");
        setListState("error");
      });
    return () => { cancelled = true; };
  }, [calendarStatus]);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await startCalendarOAuth(); // navigates away on success
    } catch {
      setReconnecting(false);
    }
  };

  const handleSave = async () => {
    setSaveError("");
    setSaved(false);
    const result = buildGoogleCalendarRoutingSave({
      defaultCalendarId,
      childCalendarIds,
      currentChildIds: familyChildren.map((c) => c.id),
      availableCalendarIds: calendars.map((c) => c.id),
    });
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSaving(true);
    try {
      await saveGoogleCalendarRouting(uid, result.routing);
      onRoutingSaved(result.routing);
      setSaved(true);
    } catch (e) {
      setSaveError(e.message || "Could not save calendar routing. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (calendarStatus === null || !calendarStatus.connected) return null;

  const renderCalendarSelect = (value, onChange) => (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full rounded-2xl px-4 py-2 font-semibold focus:outline-none"
      style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
    >
      <option value="">Use primary calendar</option>
      {calendars.map((cal) => (
        <option key={cal.id} value={cal.id}>
          {cal.summary}{cal.primary ? " (primary)" : ""}
        </option>
      ))}
    </select>
  );

  return (
    <div data-testid="google-calendar-routing-panel" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
      <h3 className="text-white font-display text-lg mb-1">Google Calendar Routing</h3>
      <p className="text-gray-400 text-xs mb-3">Choose which Google calendar each learner (and family items) publish to.</p>

      {listState === "loading" && <p className="text-gray-400 text-sm">Loading your Google calendars…</p>}

      {listState === "error" && listErrorKind === "scopeMissing" && (
        <div className="mb-3">
          <p className="text-yellow-400 text-sm mb-2">Reconnect Google Calendar to choose learner calendars.</p>
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
          >
            Reconnect
          </button>
        </div>
      )}

      {listState === "error" && listErrorKind === "needsReconnect" && (
        <div className="mb-3">
          <p className="text-yellow-400 text-sm mb-2">Reconnect required — Google Calendar access has expired.</p>
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
          >
            Reconnect
          </button>
        </div>
      )}

      {listState === "error" && listErrorKind === "generic" && (
        <p className="text-red-400 text-sm mb-3">{listError} Please try again.</p>
      )}

      {listState === "done" && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1">Default / Family calendar</label>
            {renderCalendarSelect(defaultCalendarId, setDefaultCalendarId)}
          </div>

          {familyChildren.map((child) => (
            <div key={child.id}>
              <label className="block text-sm font-semibold text-gray-300 mb-1">{child.name}</label>
              {renderCalendarSelect(childCalendarIds[child.id] || null, (val) =>
                setChildCalendarIds((prev) => {
                  const next = { ...prev };
                  if (val) next[child.id] = val;
                  else delete next[child.id];
                  return next;
                })
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-2xl font-extrabold disabled:opacity-50"
              style={{ background: "#A8FF3E", color: "#1C1C1E" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-green-400 text-sm font-semibold">Saved</span>}
          </div>
          {saveError && <p className="text-red-400 text-sm mt-2">{saveError}</p>}
        </div>
      )}
    </div>
  );
};

export default GoogleCalendarRoutingPanel;
