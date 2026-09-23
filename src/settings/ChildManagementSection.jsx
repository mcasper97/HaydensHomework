import React, { useState } from "react";

export const CHILD_EMOJIS = ["🦁", "🐯", "🐺", "🦊", "🐻", "🐼", "🦄", "🐲", "🚀", "⭐", "🌈", "🔥"];

/* ─────────────────────── Child Management Section ───────────────────────
 * Existing child/learner list + "Add a learner" form, plus inline
 * rename/edit for an existing child's display name, plus a "View Child"
 * action per row. Moved out of ChildSelector's inline JSX in AuthShell.jsx
 * (UI/IA refactor) into Settings' Children section. No behavior change to
 * add — canonical child IDs are generated exactly as before (see addChild
 * in ParentHome.jsx); this is a controlled/presentational component only.
 *
 * "View Child" is the one remaining entry point into a child's own Home
 * experience now that Parent Home's direct child-selection cards are
 * gone (a later UI cleanup removed them, no replacement there) — it calls
 * the parent-supplied viewChild(childId), which reuses AuthShell.jsx's
 * existing selectedChild/onSwitchChild navigation verbatim (see
 * ParentHome.jsx's viewChild). No new routing, no new selection state.
 *
 * Rename only ever updates the existing child record's `name` field (see
 * renameChild in ParentHome.jsx) — it never changes child.id, never
 * adds/removes an array entry, and so never disturbs anything keyed by
 * that id elsewhere (Google Calendar childCalendarIds, Gmail sender
 * targetChildId, Items' childIds, chore templates, and View Child's own
 * id-based lookup). Editing state is kept local to this component (which
 * child row, if any, is mid-edit) since it's pure UI state that nothing
 * else needs; only the persisted rename itself goes through the
 * parent-supplied renameChild.
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
  renameChild,
  viewChild,
}) => {
  const [editingChildId, setEditingChildId] = useState(null);
  const [editNameInput, setEditNameInput] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const startEdit = (child) => {
    setEditingChildId(child.id);
    setEditNameInput(child.name);
    setEditError("");
  };

  // Leaves data completely unchanged — renameChild is never called.
  const cancelEdit = () => {
    setEditingChildId(null);
    setEditNameInput("");
    setEditError("");
  };

  const saveEdit = async (childId) => {
    setEditError("");
    setSavingEdit(true);
    try {
      await renameChild(childId, editNameInput);
      setEditingChildId(null);
      setEditNameInput("");
    } catch (e) {
      setEditError(e.message || "Could not rename.");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
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
            {editingChildId === child.id ? (
              <>
                <span className="text-2xl">{child.emoji}</span>
                <input
                  type="text"
                  data-testid="child-rename-input"
                  value={editNameInput}
                  onChange={(e) => setEditNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit(child.id)}
                  autoFocus
                  className="flex-1 rounded-xl px-3 py-1.5 font-semibold focus:outline-none"
                  style={{ background: "#2a2a2c", color: "white", border: "2px solid #5B2D8E" }}
                />
                <button
                  onClick={() => saveEdit(child.id)}
                  disabled={!editNameInput.trim() || savingEdit}
                  className="px-3 py-1.5 rounded-xl font-extrabold text-sm disabled:opacity-50 shrink-0"
                  style={{ background: "#A8FF3E", color: "#1C1C1E" }}
                >
                  {savingEdit ? "..." : "Save"}
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-3 py-1.5 rounded-xl font-extrabold text-sm text-gray-400 hover:text-white border border-gray-700 shrink-0"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-2xl">{child.emoji}</span>
                <span className="text-white font-semibold flex-1">{child.name}</span>
                <button
                  onClick={() => viewChild(child.id)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white shrink-0"
                  style={{ background: "#5B2D8E" }}
                >
                  View Child
                </button>
                <button
                  onClick={() => startEdit(child)}
                  className="text-xs font-semibold text-indigo-300 underline hover:text-indigo-100 shrink-0"
                >
                  Edit
                </button>
              </>
            )}
          </div>
        ))}
        {editError && <p className="text-red-300 text-sm font-semibold">{editError}</p>}
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
};

export default ChildManagementSection;
