import React from "react";
import GmailCheckEmailAction from "../GmailCheckEmailAction.jsx";
import AutomaticEmailCheckingSection from "./AutomaticEmailCheckingSection.jsx";

/* ─────────────────────── Email Import Settings Section ───────────────────────
 * New section (Settings) separate from the Gmail connection/sender section.
 * The primary "Check Email / Import" trigger lives on Parent Home (see
 * GmailCheckEmailAction.jsx); it's also reused here unchanged, since a
 * manual "Check Now" being available from Settings is explicitly allowed.
 *
 * Automatic scheduled import (Settings UI slice) — the server-side
 * scheduler now exists (api/cron-email-ingestion.js and friends); this
 * section lets a parent configure it. See AutomaticEmailCheckingSection.jsx
 * for the toggle/time-picker itself; `timezone` is passed straight through
 * from Settings' own already-loaded household timezone (see
 * src/settings/SettingsPage.jsx), never re-read here.
 */
const EmailImportSettingsSection = ({ ctx, childProfiles, timezone }) => (
  <div className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
    <h3 className="text-white font-display text-lg mb-4">Email Import</h3>

    <GmailCheckEmailAction ctx={ctx} childProfiles={childProfiles} />

    <AutomaticEmailCheckingSection ctx={ctx} timezone={timezone} />
  </div>
);

export default EmailImportSettingsSection;
