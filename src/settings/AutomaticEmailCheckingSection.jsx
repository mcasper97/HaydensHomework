import React, { useEffect, useState } from "react";
import { fetchGmailStatus } from "../data/gmailConnection.js";
import {
  getEmailIngestionScheduleSetting,
  saveEmailIngestionScheduleSetting,
  canEnableAutomaticEmailChecking,
  formatLastRunInfo,
  computeNextAutomaticCheckText,
  canStartRunNow,
  runEmailIngestionNow,
} from "../data/emailIngestionScheduleRepository.js";

/* ─────────────────────── Automatic Email Checking (Settings) ───────────────────────
 * Settings UI for the already-built server-side scheduled Gmail ingestion
 * pipeline (api/cron-email-ingestion.js / api/_scheduledIngestionRunner.js /
 * api/_gmailIngestionRunner.js) — this component only lets a parent
 * configure/observe/manually-validate it; it never touches scheduler
 * timing, the lease, Gmail fetch/extraction, reconciliation, or Calendar
 * behavior, all unchanged.
 *
 * Vercel Hobby once-daily-cron correction: the server scheduler no longer
 * runs at a parent-configured time of day (see vercel.json's single daily
 * "0 0 * * *" tick and src/data/emailIngestionSchedule.js's
 * isHouseholdRunDue) — every enabled household simply runs once a day.
 * This UI correspondingly no longer shows or edits a time picker; it's a
 * plain on/off toggle that saves immediately (like
 * GoogleCalendarRoutingPanel.jsx's own auto-publish toggle — an on/off
 * switch needs no separate draft-then-Save step). Persists ONLY
 * emailIngestionSchedule.enabled (see
 * src/data/emailIngestionScheduleRepository.js's saveEmailIngestionScheduleSetting
 * — a dot-notation write that structurally cannot touch the server-owned
 * lastRunLocalDate/lastRunAt/lastRunStatus/runLock fields, or any
 * previously-stored localTime, which is simply left untouched and unused).
 *
 * Observability/manual-validation follow-up — this section now also
 * shows:
 *   - "Next automatic check" — computeNextAutomaticCheckText converts the
 *     fixed 00:00 UTC cron time into the household's own local time-of-
 *     day ("Today around H:MM AM/PM" / "Tomorrow around H:MM AM/PM"),
 *     never editable.
 *   - "Run automatic check now" — calls runEmailIngestionNow(), which
 *     hits api/email-ingestion-run-now.js, a parent-authenticated
 *     endpoint that invokes the EXACT SAME server-side path
 *     (executeHouseholdIngestionRun -> runHouseholdEmailIngestion) the
 *     daily Cron uses — never the client "Check Email" implementation,
 *     and Vercel's own Cron-only bearer secret is never read or sent from
 *     this file or that endpoint.
 *     A successful manual run updates the SAME lastRunLocalDate/lastRunAt/
 *     lastRunStatus fields the daily cron's own success path writes —
 *     there is no separate "manual" vs "automatic" run record in the
 *     current schema, so "Last automatic check"/"Last status" below
 *     reflect the household's most recent run regardless of how it was
 *     triggered. This is disclosed, reused run-status semantics, not a
 *     new distinction introduced here (see api/email-ingestion-run-now.js's
 *     own doc comment for the full explanation, including why this means
 *     a successful manual run also consumes today's cron slot).
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
 * timezone being configured (canEnableAutomaticEmailChecking) — timezone
 * still matters server-side (isHouseholdRunDue's same-day duplicate guard
 * is household-local, so a household with no timezone would never
 * actually run) even though it's no longer shown for a specific time of
 * day. Disabling an already-on schedule is never gated, so a household
 * that later loses either precondition can still turn it off. Run Now is
 * gated on Gmail being connected only — a parent may validate the Gmail
 * path before ever turning the daily schedule on, and Run Now doesn't
 * require emailIngestionSchedule.enabled to be true at all (see
 * api/email-ingestion-run-now.js).
 */
const AutomaticEmailCheckingSection = ({ ctx, timezone }) => {
  const [gmailConnected, setGmailConnected] = useState(null); // null = loading
  const [schedule, setSchedule] = useState(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [runningNow, setRunningNow] = useState(false);
  const [runNowResult, setRunNowResult] = useState(null);

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
      if (!cancelled) setSchedule(s);
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
  const nextCheckText = computeNextAutomaticCheckText({ timezone });

  const handleToggle = async () => {
    const next = !schedule.enabled;
    if (next && !gate.ok) return; // guarded off in the UI too — see the disabled checkbox below
    setError("");
    setSaving(true);
    try {
      await saveEmailIngestionScheduleSetting(ctx, { enabled: next });
      setSchedule((prev) => ({ ...prev, enabled: next }));
    } catch (e) {
      setError(e.message || "Could not save this setting. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    if (!canStartRunNow({ runningNow })) return; // guarded off in the UI too — see the disabled button below
    if (!gmailConnected) return;
    setError("");
    setRunNowResult(null);
    setRunningNow(true);
    try {
      const result = await runEmailIngestionNow();
      setRunNowResult(result);
      // Refresh the displayed Last automatic check / Last status without
      // requiring a page reload — re-reads the same fields the server
      // just wrote (lastRunAt/lastRunStatus/lastRunLocalDate), same
      // source of truth Settings already trusts on initial load.
      const refreshed = await getEmailIngestionScheduleSetting(ctx);
      setSchedule(refreshed);
    } catch (e) {
      setRunNowResult({ ok: false, error: e.message || "Could not run automatic email checking." });
    } finally {
      setRunningNow(false);
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
          checked={!!schedule.enabled}
          onChange={handleToggle}
          disabled={saving || (!schedule.enabled && !gate.ok)}
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

      <p className="text-gray-500 text-xs mb-1">Runs automatically once per day.</p>
      {nextCheckText && <p className="text-gray-500 text-xs mb-3">Next automatic check: {nextCheckText}</p>}

      {lastRunInfo && (
        <div className="text-xs text-gray-500 mb-3 space-y-0.5">
          {lastRunInfo.lastRunAtText && <p>Last automatic check: {lastRunInfo.lastRunAtText}</p>}
          {lastRunInfo.lastRunStatusText && <p>Last status: {lastRunInfo.lastRunStatusText}</p>}
        </div>
      )}

      <button
        data-testid="run-email-ingestion-now"
        onClick={handleRunNow}
        disabled={runningNow || !gmailConnected}
        className="px-4 py-2 rounded-xl font-semibold text-white text-sm transition hover:opacity-90 disabled:opacity-50"
        style={{ background: "#1C1C1E", border: "2px solid rgba(255,255,255,0.15)" }}
      >
        {runningNow ? "Running…" : "Run automatic check now"}
      </button>

      {runNowResult && (
        <p className={`text-xs mt-2 ${runNowResult.ok ? "text-green-400" : "text-red-400"}`}>
          {runNowResult.ok
            ? runNowResult.status === "success"
              ? "Check complete."
              : runNowResult.reason === "already_running"
              ? "Already running — try again in a few minutes."
              : "Check finished with an issue — see Last status above."
            : runNowResult.error || "Could not run automatic email checking."}
        </p>
      )}

      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  );
};

export default AutomaticEmailCheckingSection;
