import React, { useEffect, useState } from "react";
import { getCalendarStatus, startCalendarOAuth, disconnectCalendar } from "./data/googleCalendarConnection.js";

/* ─────────────────────── Google Calendar Connection Panel (Slice B) ───────────────────────
 * Moved verbatim out of AuthShell.jsx (UI/IA refactor) — now lives in
 * Settings' Google Calendar section instead of inline on the Parent page.
 * No behavior change. Connect/disconnect/status only — deliberately
 * WITHOUT an emailAddress display (Phase 1 never requests an identity
 * scope or stores/shows the connected account's email for Calendar;
 * "Google Calendar connected" is enough, per the Slice B design). No
 * publish/event UI of any kind belongs here — see the module doc comment
 * in src/data/googleCalendarConnection.js.
 */
const GoogleCalendarConnectionPanel = () => {
  const [status, setStatus] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCalendarStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ connected: false, needsReconnect: false, connectedAt: null }); });
    return () => { cancelled = true; };
  }, []);

  const handleConnect = async () => {
    setError("");
    setBusy(true);
    try {
      await startCalendarOAuth(); // navigates away on success — no further state update needed
    } catch (e) {
      setError(e.message || "Could not start Google Calendar connection.");
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setError("");
    setBusy(true);
    try {
      await disconnectCalendar();
      setStatus({ connected: false, needsReconnect: false, connectedAt: null });
    } catch (e) {
      setError(e.message || "Could not disconnect Google Calendar.");
    } finally {
      setBusy(false);
    }
  };

  const buttonStyle = {
    background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)",
  };

  return (
    <div data-testid="google-calendar-connection-panel" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
      <h3 className="text-white font-display text-lg mb-1">Google Calendar</h3>
      {status === null ? (
        <p className="text-gray-400 text-sm">Checking connection…</p>
      ) : status.needsReconnect ? (
        <>
          <p className="text-yellow-400 text-sm mb-3">Reconnect required — Google Calendar access has expired.</p>
          <div className="flex gap-2">
            <button
              onClick={handleConnect}
              disabled={busy}
              className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              style={buttonStyle}
            >
              Reconnect
            </button>
            <button
              onClick={handleDisconnect}
              disabled={busy}
              className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50 border border-gray-600"
              style={{ background: "#1C1C1E" }}
            >
              Disconnect
            </button>
          </div>
        </>
      ) : status.connected ? (
        <>
          <p className="text-gray-400 text-sm mb-3">
            <span className="text-white font-semibold">Connected</span>
          </p>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50 border border-gray-600"
            style={{ background: "#1C1C1E" }}
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="text-gray-400 text-sm mb-3">Not connected.</p>
          <button
            onClick={handleConnect}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={buttonStyle}
          >
            Connect
          </button>
        </>
      )}
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
    </div>
  );
};

export default GoogleCalendarConnectionPanel;
