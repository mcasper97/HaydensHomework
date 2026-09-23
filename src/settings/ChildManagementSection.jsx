import React from "react";

export const CHILD_EMOJIS = ["🦁", "🐯", "🐺", "🦊", "🐻", "🐼", "🦄", "🐲", "🚀", "⭐", "🌈", "🔥"];

/* ─────────────────────── Child Management Section ───────────────────────
 * Existing child/learner list + "Add a learner" form. Moved out of
 * ChildSelector's inline JSX in AuthShell.jsx (UI/IA refactor) into
 * Settings' Children section. No behavior change — canonical child IDs
 * are generated exactly as before (see addChild in ParentHome.jsx); this
 * is a controlled/presentational component only. Selecting a child to
 * open their page stays on Parent Home (that's navigation, not
 * management) — this section is deliberately add-only, matching the
 * existing add-child capability rather than inventing new edit/remove
 * functionality that didn't exist before this refactor.
 */
const ChildManagementSection = ({
  children,
  showAdd,
  setShowAdd,
  newName,
  setNewName,
  newEmoji,
  setNewEmoji,
  saving,
  saveError,
  setSaveError,
  addChild,
}) => (
  <div className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
    <h3 className="text-white font-display text-lg mb-4">Children</h3>

    {children.length > 0 && (
      <div className="space-y-2 mb-4">
        {children.map((child) => (
          <div
            key={child.id}
            className="flex items-center gap-3 p-3 rounded-2xl"
            style={{ background: "#1C1C1E" }}
          >
            <span className="text-2xl">{child.emoji}</span>
            <span className="text-white font-semibold">{child.name}</span>
          </div>
        ))}
      </div>
    )}

    {showAdd ? (
      <div className="rounded-2xl p-4 border border-gray-700">
        <h4 className="text-white font-display text-base mb-3">Add a learner</h4>
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addChild()}
          placeholder="Child's name"
          autoFocus
          className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-4 focus:outline-none"
          style={{ background: "#1C1C1E", color: "white", border: "2px solid #5B2D8E" }}
        />
        <div className="mb-4">
          <p className="text-gray-400 text-sm mb-2">Pick an avatar</p>
          <div className="flex flex-wrap gap-2">
            {CHILD_EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => setNewEmoji(e)}
                className="text-2xl p-2 rounded-xl transition"
                style={{ background: newEmoji === e ? "#5B2D8E" : "#1C1C1E" }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        {saveError && <p className="text-red-300 text-sm font-semibold">{saveError}</p>}
        <div className="flex gap-3">
          <button
            onClick={addChild}
            disabled={!newName.trim() || saving}
            className="flex-1 font-extrabold py-3 rounded-2xl transition disabled:opacity-50"
            style={{ background: "#A8FF3E", color: "#1C1C1E" }}
          >
            {saving ? "Saving..." : "Add Learner"}
          </button>
          <button
            onClick={() => { setShowAdd(false); setNewName(""); }}
            className="px-5 py-3 rounded-2xl font-extrabold text-gray-400 hover:text-white border border-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <button
        onClick={() => { setShowAdd(true); setSaveError(""); }}
        className="w-full py-4 rounded-3xl font-extrabold text-gray-400 hover:text-white border-2 border-dashed border-gray-700 hover:border-gray-500 transition text-lg"
      >
        + Add a learner
      </button>
    )}
  </div>
);

export default ChildManagementSection;
