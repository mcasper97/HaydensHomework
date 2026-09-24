import React, { useEffect, useState } from "react";
import { fetchGmailStatus } from "../data/gmailConnection.js";
import {
  getEmailIngestionScheduleSetting,
  saveEmailIngestionScheduleSetting,
  canEnableAutomaticEmailChecking,
  resolveInitialLocalTime,
  formatLastRunInfo,
} from "../data/emailIngestionScheduleRepository.js";

/* ─────────────────────── Automatic Email Checking (Settings) ───────────────────────
 * Settings UI for the already-built server-side scheduled Gmail ingestion
 * pipeline (api/cron-email-ingestion.js / api/_scheduledIngestionRunner.js /
 * api/_gmailIngestionRunner.js) — this component only lets a parent
 * configure it; it never touches scheduler timing, the lease, Gmail
 * fetch/extraction, reconciliation, or Calendar behavior, all unchanged.
 *
 * Persists ONLY emailIngestionSchedule.enabled/localTime (see
 * src/data/emailIngestionScheduleRepository.js's saveEmailIngestionScheduleSetting
 * — dot-notation writes that structurally cannot touch the server-owned
 * lastRunLocalDate/lastRunAt/lastRunStatus/runLock fields).
 *
 * Independently checks Gmail connection status (same lightweight-read
 * precedent already used throughout this app — see
 * src/GmailCheckEmailAction.jsx's own fetchGmailStatus() call) rather than
 * threading it through as a prop. Household timezone, by contrast, IS
 * received as a prop (see src/BoardSelector.jsx's own `timezone` state,
 * already loaded for the rest of Settings) — timezone is never duplicated
 * onto emailIngestionSchedule itself and this component never reads or
 * writes users/{uid}.timezone.
 *
 * Enabling is gated on BOTH Gmail being connected and a household
 * timezone being configured (canEnableAutomaticEmailChecking) — disabling
 * an already-on schedule is never gated, so a household that later loses
 * either precondition can still turn it off.
 */
const AutomaticEmailCheckingSection = ({ ctx, timezone }) => {
  const [gmailConnected, setGmailConnected] = useState(null); // null = loading
  const [schedule, setSchedule] = useState(null); // null = loading
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [localTimeDraft, setLocalTimeDraft] = useState("20:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGmailStatus()
      .then((s) => { if (!cancelled) setGmailConnected(!!s.connected); })
      .catch(() => { if (!cancelled) setGmailConnected(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getEmailIngestionScheduleSetting(ctx).then((s) => {
      if (cancelled) return;
      setSchedule(s);
      setEnabledDraft(s.enabled);
      setLocalTimeDraft(resolveInitialLocalTime(s));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  if (gmailConnected === null || schedule === null) {
    return (
      <div className="pt-4 border-t border-gray-700">
        <p className="text-gray-300 text-sm font-semibold mb-1">Automatic Email Checking</p>
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    );
  }

  const gate = canEnableAutomaticEmailChecking({ gmailConnected, timezone });
  const lastRunInfo = formatLastRunInfo(schedule);
  const dirty = enabledDraft !== schedule.enabled || (enabledDraft && localTimeDraft !== resolveInitialLocalTime(schedule));

  const handleToggle = () => {
    const next = !enabledDraft;
    if (next && !gate.ok) return; // guarded off in the UI too — see the disabled checkbox below
    setEnabledDraft(next);
    setSaved(false);
  };

  const handleSave = async () => {
    setError("");
    setSaved(false);
    if (enabledDraft && !gate.ok) {
      setError(
        gate.reason === "gmail_not_connected"
          ? "Connect Gmail above before turning on automatic email checking."
          : "Set a household timezone before turning on automatic email checking."
      );
      return;
    }
    setSaving(true);
    try {
      await saveEmailIngestionScheduleSetting(ctx, { enabled: enabledDraft, localTime: localTimeDraft });
      setSchedule((prev) => ({ ...prev, enabled: enabledDraft, localTime: localTimeDraft }));
      setSaved(true);
    } catch (e) {
      setError(e.message || "Could not save this setting. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pt-4 border-t border-gray-700" data-testid="automatic-email-checking-section">
      <label
        data-testid="automatic-email-checking-toggle"
        className="flex items-center justify-between gap-3 p-3 rounded-2xl mb-3 cursor-pointer"
        style={{ background: "#1C1C1E" }}
      >
        <span className="text-sm font-semibold text-gray-200">Automatic Email Checking</span>
        <input
          type="checkbox"
          checked={enabledDraft}
          onChange={handleToggle}
          disabled={saving || (!enabledDraft && !gate.ok)}
          className="w-5 h-5 flex-shrink-0"
        />
      </label>

      {!gate.ok && gate.reason === "gmail_not_connected" && (
        <p className="text-yellow-400 text-xs mb-3">
          Connect Gmail above to enable automatic email checking.
        </p>
      )}
      {!gate.ok && gate.reason === "no_timezone" && (
        <p className="text-yellow-400 text-xs mb-3">
          Automatic email checking requires a household timezone — set one above first.
        </p>
      )}

      {enabledDraft && (
        <div className="mb-3">
          <label className="block text-sm text-gray-300 mb-1">Check every day at</label>
          <input
            type="time"
            value={localTimeDraft}
            onChange={(e) => { setLocalTimeDraft(e.target.value); setSaved(false); }}
            className="w-32 px-4 py-2 rounded-2xl font-semibold focus:outline-none"
            style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
          />
          <p className="text-gray-500 text-xs mt-1">
            Uses household timezone: {timezone || "not set"}
          </p>
        </div>
      )}

      {lastRunInfo && (
        <div className="text-xs text-gray-500 mb-3 space-y-0.5">
          {lastRunInfo.lastRunAtText && <p>Last checked: {lastRunInfo.lastRunAtText}</p>}
          {lastRunInfo.lastRunStatusText && <p>Status: {lastRunInfo.lastRunStatusText}</p>}
        </div>
      )}

      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-xl font-semibold text-white text-sm transition hover:opacity-90 disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      )}
      {saved && !dirty && <p className="text-green-400 text-xs mt-2">Saved.</p>}
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  );
};

export default AutomaticEmailCheckingSection;
