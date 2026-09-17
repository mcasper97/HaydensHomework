import React, { useEffect, useMemo, useState } from "react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { db } from "./Firebase.js";
import { migrateLegacyFamilyEvents } from "./data/itemsRepository.js";
import ParentOrganizer from "./organizer/ParentOrganizer.jsx";
import OrganizerCalendar from "./organizer/OrganizerCalendar.jsx";
import OrganizerDisplay from "./organizer/OrganizerDisplay.jsx";

const uid4 = () => Math.random().toString(36).slice(2, 8);
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * FamilyBoard — an unattended, sign-in-free "wall tablet" view.
 *
 * Data lives on the family's real account (users/{uid}), the same account
 * used by the signed-in parent app — NOT a sync-code path.
 *
 * Board-owned data (chore templates/completions, chore points) is stored as
 * fields on the users/{uid} document itself, always written with
 * { merge: true }. Family events, school events, assignments, tests, etc.
 * are canonical items under users/{uid}/items — see data/itemsRepository.js
 * — read/written through ParentOrganizer and OrganizerCalendar below, never
 * as a Firestore path/doc directly in this file.
 *
 * IMPORTANT: this deliberately avoids writing to users/{uid}/children/{childId}.
 * That subdocument is owned by App.jsx, which periodically overwrites it
 * WITHOUT merge (see App.jsx's debounced Firestore-sync effect) — if the
 * board wrote there too, App.jsx's next autosave would silently wipe it out.
 */
const FamilyBoard = ({ uid, email, isAdmin, kiosk = false, onBack, onExitKiosk, onOpenChildImport }) => {
  const [profile, setProfile] = useState(null); // { children, familyEvents, choreTemplates, choreCompletions, chorePoints, migrated_familyEvents_v1 }
  const [childStats, setChildStats] = useState({}); // { [childId]: { homeworkPoints } } — homeworkPoints only; upcomingTests now live as canonical test/quiz items (see ParentOrganizer/OrganizerCalendar)
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // surfaced on-screen — this runs unattended, no devtools to check

  // Add-chore form state
  const [addChoreFor, setAddChoreFor] = useState(null); // childId or null
  const [choreText, setChoreText] = useState("");
  const [chorePointsInput, setChorePointsInput] = useState("5");

  const ctx = useMemo(() => ({ uid, isAdmin }), [uid, isAdmin]);

  /* ----------------------------- Admin (localStorage) bypass ----------------------------- */
  useEffect(() => {
    if (!isAdmin) return;
    const savedEvents = localStorage.getItem("crestly_admin_events");
    const savedChores = localStorage.getItem("crestly_admin_chores");
    const savedChildren = localStorage.getItem("crestly_admin_children");
    const choresParsed = savedChores ? JSON.parse(savedChores) : {};
    setProfile({
      children: savedChildren ? JSON.parse(savedChildren) : [],
      familyEvents: savedEvents ? JSON.parse(savedEvents) : [],
      choreTemplates: choresParsed.templates || {},
      choreCompletions: choresParsed.completions || {},
      chorePoints: choresParsed.points || {},
      familyLastName: localStorage.getItem("crestly_admin_family_name") || "",
      migrated_familyEvents_v1: localStorage.getItem("crestly_admin_migrated_family_events") === "true",
    });
    setLoading(false);
  }, [isAdmin]);

  /* ----------------------------- Live profile (users/{uid}) ----------------------------- */
  useEffect(() => {
    if (isAdmin) return;
    if (!db || !uid) { setLoading(false); return; }
    const ref = doc(db, "users", uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setProfile({
          children: data.children || [],
          familyEvents: data.familyEvents || [],
          choreTemplates: data.choreTemplates || {},
          choreCompletions: data.choreCompletions || {},
          chorePoints: data.chorePoints || {},
          familyLastName: data.familyLastName || "",
          migrated_familyEvents_v1: !!data.migrated_familyEvents_v1,
        });
        setLoadError(null);
        setLoading(false);
      },
      (err) => {
        console.error("FamilyBoard: failed to read users/" + uid, err);
        setLoadError(err?.code === "permission-denied"
          ? "Firestore is refusing this read (permission-denied). The board's security-rules exception for this UID probably isn't deployed yet — run `firebase deploy --only firestore:rules`."
          : `Couldn't load board data: ${err?.message || err}`);
        setLoading(false);
      }
    );
    return unsub;
  }, [uid, isAdmin]);

  /* ----------------------------- Live per-child stats (read-only) ----------------------------- */
  useEffect(() => {
    if (isAdmin || !db || !uid || !profile?.children?.length) return;
    const unsubs = profile.children.map((child) => {
      const ref = doc(db, "users", uid, "children", child.id);
      return onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          setChildStats((prev) => ({
            ...prev,
            [child.id]: { homeworkPoints: d.points ?? 0 },
          }));
        },
        (err) => console.error(`FamilyBoard: failed to read users/${uid}/children/${child.id}`, err)
      );
    });
    return () => unsubs.forEach((u) => u());
  }, [uid, isAdmin, profile?.children]);

  /* ----------------------------- Persist helper (board-owned fields only) ----------------------------- */
  const persistProfile = async (patch) => {
    if (isAdmin) {
      const next = { ...profile, ...patch };
      setProfile(next);
      if (patch.choreTemplates || patch.choreCompletions || patch.chorePoints) {
        localStorage.setItem(
          "crestly_admin_chores",
          JSON.stringify({ templates: next.choreTemplates, completions: next.choreCompletions, points: next.chorePoints })
        );
      }
      if (patch.migrated_familyEvents_v1 !== undefined) {
        localStorage.setItem("crestly_admin_migrated_family_events", String(next.migrated_familyEvents_v1));
      }
      return;
    }
    const ref = doc(db, "users", uid);
    await setDoc(ref, patch, { merge: true });
  };

  /* ----------------------------- One-time, idempotent family-event migration -----------------------------
   * Copies legacy profile.familyEvents entries into canonical family_event
   * items (see itemsRepository.migrateLegacyFamilyEvents — dedup is keyed on
   * each legacy event's own id via source.sourceId, so this is safe to run
   * more than once). The migrated_familyEvents_v1 flag is set *before* the
   * copy runs so a normal re-mount skips the scan entirely once done; the
   * per-item sourceId check is what actually guarantees no duplicates, not
   * this flag (a rare race between two near-simultaneous first-ever runs is
   * still possible — see Phase 1 known limitations).
   * Legacy familyEvents array itself is never modified or deleted.
   */
  useEffect(() => {
    if (!profile || profile.migrated_familyEvents_v1) return;
    let cancelled = false;
    (async () => {
      try {
        await persistProfile({ migrated_familyEvents_v1: true });
        const { migrated } = await migrateLegacyFamilyEvents(ctx, profile.familyEvents || []);
        if (!cancelled && migrated > 0) {
          console.info(`FamilyBoard: migrated ${migrated} legacy family event(s) into canonical items.`);
        }
      } catch (e) {
        console.error("FamilyBoard: family-event migration failed", e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.migrated_familyEvents_v1, ctx.uid, ctx.isAdmin]);

  /* ----------------------------- Chores (legacy model — unchanged in Phase 1) ----------------------------- */
  const addChoreTemplate = async (childId) => {
    const text = choreText.trim();
    const points = Math.max(0, parseInt(chorePointsInput, 10) || 0);
    if (!text) return;
    const templates = { ...(profile.choreTemplates || {}) };
    templates[childId] = [...(templates[childId] || []), { id: uid4(), text, points }];
    try {
      await persistProfile({ choreTemplates: templates });
      setChoreText("");
      setChorePointsInput("5");
      setAddChoreFor(null);
    } catch (e) {
      console.error("Add chore failed:", e);
    }
  };

  const removeChoreTemplate = async (childId, choreId) => {
    const templates = { ...(profile.choreTemplates || {}) };
    templates[childId] = (templates[childId] || []).filter((c) => c.id !== choreId);
    try {
      await persistProfile({ choreTemplates: templates });
    } catch (e) {
      console.error("Remove chore failed:", e);
    }
  };

  const toggleChoreDone = async (childId, chore) => {
    const today = todayStr();
    const completions = { ...(profile.choreCompletions || {}) };
    const forChild = { ...(completions[childId] || {}) };
    const forToday = new Set(forChild[today] || []);
    const wasDone = forToday.has(chore.id);
    if (wasDone) forToday.delete(chore.id); else forToday.add(chore.id);
    forChild[today] = Array.from(forToday);
    completions[childId] = forChild;

    // Chore points are a running total: award on completion, claw back on un-check.
    const chorePoints = { ...(profile.chorePoints || {}) };
    const delta = (chore.points || 0) * (wasDone ? -1 : 1);
    chorePoints[childId] = Math.max(0, (chorePoints[childId] || 0) + delta);

    try {
      await persistProfile({ choreCompletions: completions, chorePoints });
    } catch (e) {
      console.error("Toggle chore failed:", e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#1C1C1E" }}>
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🏔️</div>
          <p className="text-gray-400 font-display text-xl">Loading family board…</p>
        </div>
      </div>
    );
  }

  const children = profile?.children || [];
  const choreTemplates = profile?.choreTemplates || {};
  const choreCompletions = profile?.choreCompletions || {};
  const chorePoints = profile?.chorePoints || {};
  const boardTitle = profile?.familyLastName ? `${profile.familyLastName} Family Board` : "Family Board";

  return (
    <div className="min-h-screen flex flex-col items-center p-6" style={{ background: "#1C1C1E" }}>
      <div className="w-full max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-display text-white">🏠 {boardTitle}</h1>
            {email && <p className="text-gray-400 text-sm mt-1">{email}</p>}
          </div>
          {!kiosk && onBack ? (
            <button
              onClick={onBack}
              className="text-gray-400 hover:text-white text-sm font-semibold px-4 py-2 rounded-full border border-gray-700 hover:border-gray-500 transition"
            >
              ← Back
            </button>
          ) : kiosk ? (
            // Kiosk mode has no signed-in "back" state to return to. When reached via
            // the ?board=1 URL (onExitKiosk not provided), this strips the board param
            // and reloads, landing on the normal sign-in/chooser screen — unchanged
            // from before Phase 1.5. When reached via the local Organizer device-mode
            // setting instead (onExitKiosk provided), it just clears that setting so
            // the device falls back to Parent Mode, no URL/reload involved. Kept small
            // and low-contrast so it doesn't read as an obvious button to a kid, but
            // it's there when you need to get back in.
            onExitKiosk ? (
              <button
                onClick={onExitKiosk}
                className="text-gray-600 hover:text-gray-300 text-xs font-semibold px-3 py-1.5 rounded-full transition"
              >
                Home
              </button>
            ) : (
              <a
                href={window.location.pathname}
                className="text-gray-600 hover:text-gray-300 text-xs font-semibold px-3 py-1.5 rounded-full transition"
              >
                Home
              </a>
            )
          ) : null}
        </div>

        {loadError && (
          <div className="rounded-2xl p-4 mb-6 border border-red-500 bg-red-950 text-red-200 text-sm">
            ⚠️ {loadError}
          </div>
        )}

        {!loadError && children.length === 0 && (
          <p className="text-gray-400 text-center py-8">No learners set up on this account yet.</p>
        )}

        {/* Parent Mode content: full Points strip + full-CRUD ParentOrganizer + chore-template
            management. Kiosk/Organizer Mode renders the trimmed OrganizerDisplay instead — see
            below — which never exposes create/edit/delete or chore-template controls (Phase 1.5). */}
        {!kiosk && (
          <>
            {/* ----------------------------- Points strip ----------------------------- */}
            {children.length > 0 && (
              <div className="flex gap-3 mb-6 flex-wrap">
                {children.map((child) => {
                  const hw = childStats[child.id]?.homeworkPoints ?? 0;
                  const chore = chorePoints[child.id] || 0;
                  return (
                    <div key={child.id} className="flex-1 rounded-3xl p-4" style={{ minWidth: 160, background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{child.emoji}</span>
                        <div className="text-white font-display text-lg">{child.name}</div>
                      </div>
                      <div className="flex gap-4">
                        <div>
                          <div className="text-purple-300 text-xs uppercase font-bold">Chore pts</div>
                          <div className="text-white font-display text-xl">🧹 {chore}</div>
                        </div>
                        <div>
                          <div className="text-purple-300 text-xs uppercase font-bold">Homework pts</div>
                          <div className="text-white font-display text-xl">📚 {hw}</div>
                        </div>
                      </div>
                      {onOpenChildImport && (
                        <button
                          onClick={() => onOpenChildImport(child)}
                          className="mt-3 w-full text-xs font-bold text-purple-100 hover:text-white bg-white/10 hover:bg-white/20 rounded-full py-1.5 transition"
                        >
                          📷 Import from Photo / CSV
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ----------------------------- Parent Organizer (Today / Needs Attention / Upcoming) ----------------------------- */}
            {children.length > 0 && (
              <div className="rounded-3xl p-5 mb-8" style={{ background: "#2a2a2c" }}>
                <ParentOrganizer
                  ctx={ctx}
                  children={children}
                  choreTemplates={choreTemplates}
                  choreCompletions={choreCompletions}
                  onToggleChore={toggleChoreDone}
                />
              </div>
            )}

            {/* ----------------------------- Manage chores (per child — unchanged legacy template model) ----------------------------- */}
            {children.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-display text-white mb-3">🧹 Manage Chores</h2>
                <div className="flex gap-3 flex-wrap items-start">
                  {children.map((child) => {
                    const list = choreTemplates[child.id] || [];
                    return (
                      <div key={child.id} className="flex-1 rounded-3xl p-5" style={{ minWidth: 260, background: "#2a2a2c" }}>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-2xl">{child.emoji}</span>
                          <div className="text-lg font-display text-white">{child.name}</div>
                        </div>

                        {list.length > 0 && (
                          <div className="space-y-2 mb-3">
                            {list.map((chore) => (
                              <div key={chore.id} className="w-full flex items-center gap-3 p-2.5 rounded-2xl" style={{ background: "rgba(255,255,255,0.05)" }}>
                                <div className="flex-1 text-white text-sm">{chore.text}</div>
                                <span className="text-purple-300 text-xs font-bold">+{chore.points ?? 0}</span>
                                <button
                                  onClick={() => removeChoreTemplate(child.id, chore.id)}
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
                              onKeyDown={(e) => e.key === "Enter" && addChoreTemplate(child.id)}
                              placeholder="e.g. Empty upstairs trash"
                              autoFocus
                              className="flex-1 rounded-2xl px-4 py-2 font-semibold focus:outline-none"
                              style={{ minWidth: 160, background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
                            />
                            <input
                              type="number"
                              min="0"
                              value={chorePointsInput}
                              onChange={(e) => setChorePointsInput(e.target.value)}
                              className="w-20 rounded-2xl px-3 py-2 font-semibold focus:outline-none"
                              style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
                            />
                            <button
                              onClick={() => addChoreTemplate(child.id)}
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
              </div>
            )}
          </>
        )}
      </div>

      {!kiosk && children.length > 0 && (
        /* Deliberately full-width, outside the max-w-6xl column above, so the whole week is visible without cramming. */
        <div className="w-full mt-4">
          <h2 className="text-xl font-display text-white mb-3">📅 Coming Up</h2>
          <OrganizerCalendar ctx={ctx} children={children} choreTemplates={choreTemplates} choreCompletions={choreCompletions} />
        </div>
      )}

      {kiosk && (
        <OrganizerDisplay
          children={children}
          choreTemplates={choreTemplates}
          choreCompletions={choreCompletions}
          chorePoints={chorePoints}
          childStats={childStats}
          ctx={ctx}
          onToggleChore={toggleChoreDone}
        />
      )}
    </div>
  );
};

export default FamilyBoard;
