import React, { useEffect, useState } from "react";
import { getChoreTemplates, addChoreTemplate, removeChoreTemplate } from "./data/choreTemplatesRepository.js";

/**
 * Manage Chores — a Parent Home action (SHIP BLOCKER correction). Reuses
 * data/choreTemplatesRepository.js, extracted out of FamilyBoard.jsx's own
 * inline Manage Chores block, for all persistence — no duplicated
 * add/remove/save logic. FamilyBoard.jsx's own Manage Chores UI is
 * untouched and keeps working exactly as before, on the same underlying
 * users/{uid}.choreTemplates field (or the guest "crestly_admin_chores"
 * localStorage key) via the same repository functions.
 *
 * This panel deliberately only manages chore TEMPLATES (definitions) —
 * choreCompletions/chorePoints (execution-time, "did they do it today")
 * stay exactly where they already live: FamilyBoard.jsx's own
 * toggleChoreDone, reachable only from Family Board / Shared Display,
 * unaffected by this panel and not duplicated here.
 */
const ChoreManagementPanel = ({ ctx, children = [] }) => {
  const [choreTemplates, setChoreTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [addChoreFor, setAddChoreFor] = useState(null); // childId or null
  const [choreText, setChoreText] = useState("");
  const [chorePointsInput, setChorePointsInput] = useState("5");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getChoreTemplates(ctx)
      .then((templates) => { if (!cancelled) setChoreTemplates(templates); })
      .catch((e) => { if (!cancelled) setLoadError(e.message || "Could not load chores."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  const handleAdd = async (childId) => {
    const text = choreText.trim();
    const points = Math.max(0, parseInt(chorePointsInput, 10) || 0);
    if (!text) return;
    setError("");
    try {
      const templates = await addChoreTemplate(ctx, choreTemplates, childId, text, points);
      setChoreTemplates(templates);
      setChoreText("");
      setChorePointsInput("5");
      setAddChoreFor(null);
    } catch (e) {
      setError(e.message || "Could not add that chore.");
    }
  };

  const handleRemove = async (childId, choreId) => {
    setError("");
    try {
      const templates = await removeChoreTemplate(ctx, choreTemplates, childId, choreId);
      setChoreTemplates(templates);
    } catch (e) {
      setError(e.message || "Could not remove that chore.");
    }
  };

  return (
    <div data-testid="chore-management-panel" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
      <h3 className="text-white font-display text-lg mb-4">🧹 Manage Chores</h3>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : loadError ? (
        <p className="text-red-400 text-sm">{loadError}</p>
      ) : children.length === 0 ? (
        <p className="text-gray-400 text-sm">Add a learner in Settings first to set up chores for them.</p>
      ) : (
        <div className="space-y-4">
          {children.map((child) => {
            const list = choreTemplates[child.id] || [];
            return (
              <div key={child.id} className="rounded-2xl p-4" style={{ background: "#1C1C1E" }}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{child.emoji}</span>
                  <div className="text-white font-semibold">{child.name}</div>
                </div>

                {list.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {list.map((chore) => (
                      <div key={chore.id} className="w-full flex items-center gap-3 p-2.5 rounded-2xl" style={{ background: "rgba(255,255,255,0.05)" }}>
                        <div className="flex-1 text-white text-sm">{chore.text}</div>
                        <span className="text-purple-300 text-xs font-bold">+{chore.points ?? 0}</span>
                        <button
                          onClick={() => handleRemove(child.id, chore.id)}
                          className="text-gray-400 hover:text-red-300 text-lg px-2"
                          aria-label="Remove chore"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {addChoreFor === child.id ? (
                  <div className="flex gap-2 flex-wrap">
                    <input
                      type="text"
                      value={choreText}
                      onChange={(e) => setChoreText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAdd(child.id)}
                      placeholder="e.g. Empty upstairs trash"
                      autoFocus
                      className="flex-1 rounded-2xl px-4 py-2 font-semibold focus:outline-none"
                      style={{ minWidth: 160, background: "#2a2a2c", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
                    />
                    <input
                      type="number"
                      min="0"
                      value={chorePointsInput}
                      onChange={(e) => setChorePointsInput(e.target.value)}
                      className="w-20 rounded-2xl px-3 py-2 font-semibold focus:outline-none"
                      style={{ background: "#2a2a2c", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
                    />
                    <button
                      onClick={() => handleAdd(child.id)}
                      className="px-4 py-2 rounded-2xl font-extrabold"
                      style={{ background: "#A8FF3E", color: "#1C1C1E" }}
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setAddChoreFor(null); setChoreText(""); }}
                      className="px-4 py-2 rounded-2xl font-extrabold text-gray-300 border border-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddChoreFor(child.id)}
                    className="w-full py-2 rounded-2xl font-bold text-gray-400 hover:text-white border-2 border-dashed border-gray-600 transition text-sm"
                  >
                    + Add a chore
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
    </div>
  );
};

export default ChoreManagementPanel;
