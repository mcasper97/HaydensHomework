import React, { useState } from "react";
import { resetGmailProcessingHistory } from "../data/gmailConnection.js";

/* ─────────────────────── Testing Tools (Email Import) ───────────────────────
 * Settings -> Email Import -> Testing Tools -> "Reset Email Processing
 * History". A parent-testing-only control: lets previously processed Gmail
 * messages be scanned again by Check Email / automatic ingestion, WITHOUT
 * deleting any SourceRecord, Item, or IngestionCandidate — see
 * api/gmail-reset-processing.js / api/_gmailProcessingResetStore.js for the
 * server-side logical reset. Requires an explicit confirm before executing
 * (window.confirm — same established convention as
 * ManageItemsPanel.jsx's own delete confirmation), and never itself runs
 * Check Email afterward — the parent decides when to check again.
 */
const GmailTestingToolsSection = () => {
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleReset = async () => {
    const confirmed = window.confirm(
      "This will allow previously processed Gmail messages to be processed again. Existing assignments and source history will not be deleted."
    );
    if (!confirmed) return;

    setError("");
    setMessage("");
    setResetting(true);
    try {
      await resetGmailProcessingHistory();
      setMessage("Email processing history reset. Previously processed messages can now be checked again.");
    } catch (e) {
      setError(e.message || "Could not reset email processing history.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div data-testid="gmail-testing-tools-section" className="mt-4 pt-4 border-t border-gray-700">
      <h4 className="text-gray-300 font-display text-sm mb-2">Testing Tools</h4>
      <p className="text-gray-500 text-xs mb-3">
        For testing only — lets previously processed emails be checked again without deleting anything.
      </p>
      <button
        data-testid="reset-gmail-processing-button"
        onClick={handleReset}
        disabled={resetting}
        className="w-full px-4 py-3 rounded-xl font-semibold text-gray-200 text-sm transition hover:opacity-90 disabled:opacity-50 border border-gray-600"
      >
        {resetting ? "Resetting…" : "Reset Email Processing History"}
      </button>
      {message && (
        <p data-testid="reset-gmail-processing-success" className="text-green-400 text-xs mt-2">
          {message}
        </p>
      )}
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  );
};

export default GmailTestingToolsSection;
