import React from "react";

/* ─────────────────────── Household Settings Section ───────────────────────
 * Family name + household timezone. Moved out of ChildSelector's inline
 * JSX in AuthShell.jsx (UI/IA refactor) into Settings' Household section.
 * No behavior change — this is a controlled/presentational component; all
 * state and the actual save handlers still live in BoardSelector.jsx
 * (the authenticated root screen — household profile load/save is
 * unchanged), and
 * are simply passed down as props. Extracted as its own component so a
 * future first-run Setup wizard can reuse it without duplicating this
 * markup or its save logic.
 */
const HouseholdSettingsSection = ({
  familyLastName,
  editingName,
  setEditingName,
  lastNameInput,
  setLastNameInput,
  savingName,
  saveFamilyName,
  timezone,
  editingTimezone,
  setEditingTimezone,
  timezoneInput,
  setTimezoneInput,
  timezoneError,
  setTimezoneError,
  savingTimezone,
  saveTimezone,
}) => (
  <div className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
    <h3 className="text-white font-display text-lg mb-4">Household</h3>

    <div className="mb-5">
      <p className="text-gray-300 text-sm font-semibold mb-2">Family name</p>
      {editingName ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={lastNameInput}
            onChange={e => setLastNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && saveFamilyName()}
            placeholder="e.g. Casper"
            autoFocus
            className="flex-1 rounded-2xl px-4 py-2 font-semibold focus:outline-none"
            style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
          />
          <button
            onClick={saveFamilyName}
            disabled={savingName}
            className="px-4 py-2 rounded-2xl font-extrabold disabled:opacity-50"
            style={{ background: "#A8FF3E", color: "#1C1C1E" }}
          >
            {savingName ? "..." : "Save"}
          </button>
          <button
            onClick={() => { setLastNameInput(familyLastName); setEditingName(false); }}
            className="px-4 py-2 rounded-2xl font-extrabold text-gray-400 hover:text-white border border-gray-700"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditingName(true)}
          className="text-gray-300 hover:text-white text-sm font-semibold transition"
        >
          {familyLastName ? `${familyLastName} (edit)` : "+ Set your family name"}
        </button>
      )}
    </div>

    <div>
      <p className="text-gray-300 text-sm font-semibold mb-2">Timezone</p>
      {editingTimezone || !timezone ? (
        <div>
          {!timezone && (
            <p className="text-gray-400 text-xs mb-2">
              Suggested: {timezoneInput || "—"} — you can change this before saving.
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={timezoneInput}
              onChange={(e) => { setTimezoneInput(e.target.value); setTimezoneError(""); }}
              onKeyDown={(e) => e.key === "Enter" && saveTimezone()}
              placeholder="e.g. America/New_York"
              className="flex-1 rounded-2xl px-4 py-2 font-semibold focus:outline-none"
              style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
            />
            <button
              onClick={saveTimezone}
              disabled={savingTimezone}
              className="px-4 py-2 rounded-2xl font-extrabold disabled:opacity-50"
              style={{ background: "#A8FF3E", color: "#1C1C1E" }}
            >
              {savingTimezone ? "..." : timezone ? "Save" : "Use this timezone"}
            </button>
            {timezone && (
              <button
                onClick={() => { setTimezoneInput(timezone); setTimezoneError(""); setEditingTimezone(false); }}
                className="px-4 py-2 rounded-2xl font-extrabold text-gray-400 hover:text-white border border-gray-700"
              >
                Cancel
              </button>
            )}
          </div>
          {timezoneError && <p className="text-red-400 text-xs mt-2">{timezoneError}</p>}
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-gray-300 font-semibold">{timezone}</span>
          <button
            onClick={() => { setTimezoneInput(timezone); setTimezoneError(""); setEditingTimezone(true); }}
            className="text-xs font-semibold text-indigo-300 underline hover:text-indigo-100"
          >
            Change
          </button>
        </div>
      )}
    </div>
  </div>
);

export default HouseholdSettingsSection;
