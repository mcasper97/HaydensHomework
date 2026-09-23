import React from "react";
import GmailCheckEmailAction from "../GmailCheckEmailAction.jsx";

/* ─────────────────────── Email Import Settings Section ───────────────────────
 * New section (Settings) separate from the Gmail connection/sender section.
 * The primary "Check Email / Import" trigger lives on Parent Home (see
 * GmailCheckEmailAction.jsx); it's also reused here unchanged, since a
 * manual "Check Now" being available from Settings is explicitly allowed.
 *
 * Automatic scheduled import is intentionally NOT implemented here — no
 * server-side scheduling exists yet, and a browser-dependent fake schedule
 * was explicitly ruled out. This is a placeholder only.
 */
const EmailImportSettingsSection = ({ ctx, childProfiles }) => (
  <div className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
    <h3 className="text-white font-display text-lg mb-4">Email Import</h3>

    <GmailCheckEmailAction ctx={ctx} childProfiles={childProfiles} />

    <div className="pt-4 border-t border-gray-700">
      <p className="text-gray-300 text-sm font-semibold mb-1">Automatic Email Import</p>
      <p className="text-gray-500 text-sm">Automatic scheduling coming soon.</p>
    </div>
  </div>
);

export default EmailImportSettingsSection;
