import React, { useEffect, useState } from "react";
import { fetchGmailStatus, startGmailConnect, disconnectGmail } from "./data/gmailConnection.js";
import GmailApprovedSendersPanel from "./GmailApprovedSendersPanel.jsx";

/* ─────────────────────── Gmail Connection panel (Settings) ───────────────────────
 * Moved verbatim out of AuthShell.jsx (UI/IA refactor) — now lives in
 * Settings' Email/Gmail section instead of inline on the Parent page. No
 * behavior change. Connection status plus approved-sender management once
 * connected; no mail is read here (see GmailCheckEmailAction.jsx, a
 * Parent Home action, for the actual Check Email trigger).
 */
const GmailConnectionPanel = ({ ctx, childProfiles }) => {
  const [status, setStatus] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGmailStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ connected: false, emailAddress: null, needsReconnect: false, connectedAt: null }); });
    return () => { cancelled = true; };
  }, []);

  const handleConnect = async () => {
    setError("");
    setBusy(true);
    try {
      await startGmailConnect(); // navigates away on success — no further state update needed
    } catch (e) {
      setError(e.message || "Could not start Gmail connection.");
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setError("");
    setBusy(true);
    try {
      await disconnectGmail();
      setStatus({ connected: false, emailAddress: null, needsReconnect: false, connectedAt: null });
    } catch (e) {
      setError(e.message || "Could not disconnect Gmail.");
    } finally {
      setBusy(false);
    }
  };

  const buttonStyle = {
    background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)",
  };

  return (
    <div data-testid="gmail-connection-panel" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
      <h3 className="text-white font-display text-lg mb-1">Gmail</h3>
      {status === null ? (
        <p className="text-gray-400 text-sm">Checking connection…</p>
      ) : status.needsReconnect ? (
        <>
          <p className="text-yellow-400 text-sm mb-3">Reconnect needed — Gmail access has expired.</p>
          <button
            onClick={handleConnect}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={buttonStyle}
          >
            Reconnect Gmail
          </button>
        </>
      ) : status.connected ? (
        <>
          <p className="text-gray-400 text-sm mb-3">
            Connected as <span className="text-white font-semibold">{status.emailAddress || "unknown address"}</span>
          </p>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50 border border-gray-600"
            style={{ background: "#1C1C1E" }}
          >
            Disconnect
          </button>
          <GmailApprovedSendersPanel ctx={ctx} childProfiles={childProfiles} />
        </>
      ) : (
        <>
          <p className="text-gray-400 text-sm mb-3">Connect Gmail to import school emails (coming soon).</p>
          <button
            onClick={handleConnect}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={buttonStyle}
          >
            Connect Gmail
          </button>
        </>
      )}
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
    </div>
  );
};

export default GmailConnectionPanel;
