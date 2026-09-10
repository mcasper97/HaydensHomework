import React, { useEffect, useState } from "react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { db } from "./Firebase.js";

const uid4 = () => Math.random().toString(36).slice(2, 8);
const todayStr = () => new Date().toISOString().slice(0, 10);

// One color per child, cycled by their position in the children list — used
// as a small accent dot/border so items on the calendar strip read at a
// glance whose they are, the way Apple Calendar color-codes by calendar.
const CHILD_COLORS = ["#7C3AED", "#0EA5A0", "#D97706", "#DB2777", "#2563EB", "#059669", "#DC2626"];
const colorForChild = (children, childId) => {
  const idx = Math.max(0, children.findIndex((c) => c.id === childId));
  return CHILD_COLORS[idx % CHILD_COLORS.length];
};

/**
 * FamilyBoard — an unattended, sign-in-free "wall tablet" view.
 *
 * Data lives on the family's real account (users/{uid}), the same account
 * used by the signed-in parent app — NOT a sync-code path.
 *
 * Board-owned data (events, chore templates/completions, chore points) is
 * stored as fields on the users/{uid} document itself, always written with
 * { merge: true }.
 *
 * IMPORTANT: this deliberately avoids writing to users/{uid}/children/{childId}.
 * That subdocument is owned by App.jsx, which periodically overwrites it
 * WITHOUT merge (see App.jsx's debounced Firestore-sync effect) — if the
 * board wrote there too, App.jsx's next autosave would silently wipe it out.
 * The board only READS that subdocument, for two things App.jsx already
 * tracks: homework points (`points`) and each child's Tests & Quizzes list
 * (`upcomingTests`, shape { name, subject, date }) — surfaced here in the
 * agenda alongside family events.
 */
const FamilyBoard = ({ uid, email, isAdmin, kiosk = false, onBack }) => {
  const [profile, setProfile] = useState(null); // { children, familyEvents, choreTemplates, choreCompletions, chorePoints }
  const [childStats, setChildStats] = useState({}); // { [childId]: { homeworkPoints, upcomingTests } }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // surfaced on-screen — this runs unattended, no devtools to check

  // Add-event form state
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [evTitle, setEvTitle] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evNote, setEvNote] = useState("");
  const [evSaving, setEvSaving] = useState(false);
  const [evError, setEvError] = useState("");

  // Add-chore form state
  const [addChoreFor, setAddChoreFor] = useState(null); // childId or null
  const [choreText, setChoreText] = useState("");
  const [chorePointsInput, setChorePointsInput] = useState("5");

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
            [child.id]: {
              homeworkPoints: d.points ?? 0,
              upcomingTests: Array.isArray(d.upcomingTests) ? d.upcomingTests : [],
            },
          }));
        },
        (err) => console.error(`FamilyBoard: failed to read users/${uid}/children/${child.id}`, err)
      );
    });
    return () => unsubs.forEach((u) => u());
  }, [uid, isAdmin, profile?.children]);

  /* ----------------------------- Persist helper ----------------------------- */
  const persistProfile = async (patch) => {
    if (isAdmin) {
      const next = { ...profile, ...patch };
      setProfile(next);
      if (patch.familyEvents) localStorage.setItem("crestly_admin_events", JSON.stringify(next.familyEvents));
      if (patch.choreTemplates || patch.choreCompletions || patch.chorePoints) {
        localStorage.setItem(
          "crestly_admin_chores",
          JSON.stringify({ templates: next.choreTemplates, completions: next.choreCompletions, points: next.chorePoints })
        );
      }
      return;
    }
    const ref = doc(db, "users", uid);
    await setDoc(ref, patch, { merge: true });
  };

  /* ----------------------------- Events ----------------------------- */
  const addEvent = async () => {
    const t = evTitle.trim();
    if (!t || !evDate || evSaving) return;
    setEvSaving(true);
    setEvError("");
    const event = { id: uid4() + Date.now().toString(36), title: t, date: evDate, note: evNote.trim(), createdAt: new Date().toISOString() };
    const updated = [...(profile.familyEvents || []), event].sort((a, b) => a.date.localeCompare(b.date));
    try {
      await persistProfile({ familyEvents: updated });
      setEvTitle(""); setEvDate(""); setEvNote(""); setShowAddEvent(false);
    } catch (e) {
      console.error("Add event failed:", e);
      setEvError("Couldn't save — please try again.");
    } finally {
      setEvSaving(false);
    }
  };

  const removeEvent = async (id) => {
    const updated = (profile.familyEvents || []).filter((e) => e.id !== id);
    try {
      await persistProfile({ familyEvents: updated });
    } catch (e) {
      console.error("Remove event failed:", e);
    }
  };

  /* ----------------------------- Chores ----------------------------- */
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

  /* ----------------------------- Render helpers ----------------------------- */
  const formatDateHeading = (d) => {
    const today = todayStr();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (d === today) return "Today";
    if (d === tomorrow) return "Tomorrow";
    try {
      return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    } catch {
      return d;
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
  const events = profile?.familyEvents || [];
  const choreTemplates = profile?.choreTemplates || {};
  const choreCompletions = profile?.choreCompletions || {};
  const chorePoints = profile?.chorePoints || {};
  const today = todayStr();
  const boardTitle = profile?.familyLastName ? `${profile.familyLastName} Family Board` : "Family Board";

  // ----- Build a 7-day calendar strip (today -> +6 days): family events + every child's tests/quizzes -----
  const agendaByDate = {}; // { [date]: [{ kind: 'event'|'test', ...}] }
  const pushAgenda = (date, item) => {
    if (!date) return;
    if (!agendaByDate[date]) agendaByDate[date] = [];
    agendaByDate[date].push(item);
  };
  events
    .filter((e) => e.date >= today)
    .forEach((e) => pushAgenda(e.date, { kind: "event", id: e.id, title: e.title, note: e.note }));
  children.forEach((child) => {
    const tests = childStats[child.id]?.upcomingTests || [];
    tests
      .filter((t) => t.date >= today)
      .forEach((t) =>
        pushAgenda(t.date, { kind: "test", id: `${child.id}-${t.name}-${t.date}`, child, name: t.name, subject: t.subject })
      );
  });
  // Starts at tomorrow (i = 1) — today's own items live in the merged "Today"
  // section above, so the strip below doesn't repeat them in a second place.
  const weekDates = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10));
  const pastEvents = events.filter((e) => e.date < today);
  const todaysEvents = events.filter((e) => e.date === today);

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
            // Kiosk mode (?board=1) has no signed-in "back" state to return to — this
            // strips the board param and reloads, landing on the normal sign-in/chooser
            // screen. Kept small and low-contrast so it doesn't read as an obvious button
            // to a kid, but it's there when you need to get back in.
            <a
              href={window.location.pathname}
              className="text-gray-600 hover:text-gray-300 text-xs font-semibold px-3 py-1.5 rounded-full transition"
            >
              Home
            </a>
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
                </div>
              );
            })}
          </div>
        )}

        {/* ----------------------------- Today (chores + study items, combined per child) ----------------------------- */}
        {children.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-display text-white mb-3">🔆 Today</h2>

            {todaysEvents.length > 0 && (
              <div className="space-y-2 mb-4">
                {todaysEvents.map((ev) => (
                  <div key={ev.id} className="w-full flex items-center gap-3 p-3 rounded-2xl" style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}>
                    <span className="text-lg">📌</span>
                    <div className="flex-1">
                      <div className="text-white font-semibold text-sm">{ev.title}</div>
                      {ev.note && <div className="text-purple-300 text-xs">{ev.note}</div>}
                    </div>
                    <button onClick={() => removeEvent(ev.id)} className="text-gray-300 hover:text-red-300 text-lg px-2" aria-label="Remove event">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 flex-wrap items-start">
            {children.map((child) => {
              const list = choreTemplates[child.id] || [];
              const doneToday = new Set((choreCompletions[child.id] || {})[today] || []);
              const allTests = childStats[child.id]?.upcomingTests || [];
              const studyToday = allTests.filter((t) => t.date === today);
              // This child's own items over the next week, so their card is the
              // one place to look — no need to also scan the wide date strip
              // below just to find out what's coming up for them specifically.
              const studySoon = allTests
                .filter((t) => t.date > today)
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(0, 5);
              const color = colorForChild(children, child.id);

              return (
                <div key={child.id} className="flex-1 rounded-3xl p-5" style={{ minWidth: 280, background: "#2a2a2c" }}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">{child.emoji}</span>
                    <div className="text-lg font-display text-white">{child.name}</div>
                    <div className="ml-auto text-gray-400 text-sm">
                      {list.length > 0 && `${list.length} chore${list.length === 1 ? "" : "s"}`}
                      {list.length > 0 && studyToday.length > 0 && " · "}
                      {studyToday.length > 0 && `${studyToday.length} study item${studyToday.length === 1 ? "" : "s"}`}
                      {list.length === 0 && studyToday.length === 0 && "Nothing due today"}
                    </div>
                  </div>

                  {/* Chores */}
                  {list.length > 0 && (
                    <div className="mb-4">
                      <div className="text-gray-400 text-xs font-bold uppercase mb-2">🧹 Chores · {doneToday.size}/{list.length} done</div>
                      <div className="space-y-2">
                        {list.map((chore) => {
                          const done = doneToday.has(chore.id);
                          return (
                            <div
                              key={chore.id}
                              className="w-full flex items-center gap-3 p-3 rounded-2xl"
                              style={{ background: "rgba(255,255,255,0.05)" }}
                            >
                              <button
                                onClick={() => toggleChoreDone(child.id, chore)}
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0"
                                style={{ background: done ? "#A8FF3E" : "rgba(255,255,255,0.15)", color: done ? "#1C1C1E" : "white" }}
                              >
                                {done ? "✓" : ""}
                              </button>
                              <div className={`flex-1 text-white ${done ? "line-through opacity-50" : ""}`}>{chore.text}</div>
                              <span className="text-purple-300 text-xs font-bold">+{chore.points ?? 0}</span>
                              <button
                                onClick={() => removeChoreTemplate(child.id, chore.id)}
                                className="text-gray-400 hover:text-red-300 text-lg px-2"
                                aria-label="Remove chore"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Study items due today — same white Student-Planner card look as the calendar strip */}
                  {studyToday.length > 0 && (
                    <div className="mb-4">
                      <div className="text-gray-400 text-xs font-bold uppercase mb-2">📚 Study & Tests</div>
                      <div className="space-y-2">
                        {studyToday.map((t, i) => (
                          <div key={i} className="rounded-xl p-3 border border-red-300 bg-red-50" style={{ borderLeftWidth: 3, borderLeftColor: color }}>
                            <div className="font-extrabold text-gray-900 text-sm leading-snug">{t.name}</div>
                            <div className="text-gray-600 text-xs mt-0.5">{t.subject}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* This child's own upcoming items — always shown, so "Coming Up" is a
                      consistent part of every child's card whether or not they currently
                      have anything on it, not something that only appears sometimes. */}
                  <div className="mb-4">
                    <div className="text-gray-400 text-xs font-bold uppercase mb-2">📆 Coming Up for {child.name}</div>
                    {studySoon.length === 0 ? (
                      <div className="text-gray-600 text-xs px-3 py-2">Nothing coming up</div>
                    ) : (
                      <div className="space-y-1.5">
                        {studySoon.map((t, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.05)" }}>
                            <span className="text-xs font-bold flex-shrink-0" style={{ color, minWidth: 60 }}>
                              {formatDateHeading(t.date)}
                            </span>
                            <span className="text-white text-sm font-semibold flex-1 min-w-0 truncate">{t.name}</span>
                            <span className="text-gray-500 text-xs flex-shrink-0">{t.subject}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

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
      </div>

      {/* ----------------------------- Calendar strip (7 days, Student-Planner card style) ----------------------------- */}
      {/* Deliberately full-width, outside the max-w-6xl column above, so the whole week is visible without cramming. */}
      <div className="w-full mt-4">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-display text-white">📅 Coming Up</h2>
            {!showAddEvent && (
              <button
                onClick={() => setShowAddEvent(true)}
                className="text-sm font-extrabold px-4 py-2 rounded-full transition"
                style={{ background: "#A8FF3E", color: "#1C1C1E" }}
              >
                + Event
              </button>
            )}
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: "x proximity" }}>
            {weekDates.map((date) => {
              const heading = formatDateHeading(date);
              const isToday = date === today;
              const d = new Date(date + "T00:00:00");
              const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
              const dayNum = d.getDate();
              const items = agendaByDate[date] || [];

              return (
                <div key={date} className="flex-shrink-0" style={{ width: 200, scrollSnapAlign: "start" }}>
                  {/* Column header, like a Mac Calendar week view */}
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-gray-400 text-xs font-bold uppercase">{weekday}</span>
                    <span
                      className="text-sm font-extrabold flex items-center justify-center rounded-full"
                      style={{
                        width: 24, height: 24,
                        background: isToday ? "#DC2626" : "transparent",
                        color: isToday ? "white" : "#9CA3AF",
                      }}
                    >
                      {dayNum}
                    </span>
                    {(isToday || heading === "Tomorrow") && (
                      <span className="text-xs font-bold" style={{ color: isToday ? "#DC2626" : "#D97706" }}>{heading}</span>
                    )}
                  </div>

                  {/* Day column: white Student-Planner-style cards stacked */}
                  <div className="rounded-2xl p-2 space-y-2 min-h-[120px]" style={{ background: "rgba(255,255,255,0.04)" }}>
                    {items.length === 0 && (
                      <div className="text-gray-600 text-xs text-center py-6">—</div>
                    )}
                    {items.map((item) => {
                      const urgency =
                        heading === "Today" ? "border-red-300 bg-red-50" :
                        heading === "Tomorrow" ? "border-orange-300 bg-orange-50" :
                        "border-gray-200 bg-white";
                      if (item.kind === "event") {
                        return (
                          <div key={item.id} className={`rounded-xl p-2.5 border ${urgency} relative group`}>
                            <div className="flex items-start gap-1.5">
                              <span className="text-sm mt-0.5">📌</span>
                              <div className="flex-1 min-w-0">
                                <div className="font-extrabold text-gray-900 text-xs leading-snug">{item.title}</div>
                                {item.note && <div className="text-gray-600 text-[11px] mt-0.5">{item.note}</div>}
                              </div>
                            </div>
                            <button
                              onClick={() => removeEvent(item.id)}
                              className="absolute top-1 right-1 text-gray-400 hover:text-red-500 text-sm leading-none px-1"
                              aria-label="Remove event"
                            >
                              ×
                            </button>
                          </div>
                        );
                      }
                      const color = colorForChild(children, item.child.id);
                      return (
                        <div key={item.id} className={`rounded-xl p-2.5 border ${urgency}`} style={{ borderLeftWidth: 3, borderLeftColor: color }}>
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="text-xs">{item.child.emoji}</span>
                            <span className="text-[11px] font-bold" style={{ color }}>{item.child.name}</span>
                          </div>
                          <div className="font-extrabold text-gray-900 text-xs leading-snug">{item.name}</div>
                          <div className="text-gray-600 text-[11px] mt-0.5">{item.subject}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {pastEvents.length > 0 && (
            <details className="mb-4">
              <summary className="text-gray-500 text-sm cursor-pointer mb-2">Past events ({pastEvents.length})</summary>
              <div className="space-y-2">
                {pastEvents.map((ev) => (
                  <div key={ev.id} className="w-full flex items-center gap-4 p-3 rounded-2xl opacity-60" style={{ background: "#2a2a2c" }}>
                    <div className="flex-1 text-white text-sm">{ev.title}</div>
                    <button onClick={() => removeEvent(ev.id)} className="text-gray-500 hover:text-red-300 px-2">×</button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {showAddEvent ? (
            <div className="rounded-3xl p-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
              <h3 className="text-white font-display text-xl mb-4">Add a family event</h3>
              <input
                type="text"
                value={evTitle}
                onChange={(e) => setEvTitle(e.target.value)}
                placeholder="Event title"
                autoFocus
                className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-3 focus:outline-none"
                style={{ background: "#1C1C1E", color: "white", border: "2px solid #5B2D8E" }}
              />
              <input
                type="date"
                value={evDate}
                onChange={(e) => setEvDate(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-lg font-bold mb-3 focus:outline-none"
                style={{ background: "#1C1C1E", color: "white", border: "2px solid #5B2D8E" }}
              />
              <input
                type="text"
                value={evNote}
                onChange={(e) => setEvNote(e.target.value)}
                placeholder="Note (optional)"
                className="w-full rounded-2xl px-4 py-3 text-lg font-semibold mb-4 focus:outline-none"
                style={{ background: "#1C1C1E", color: "white", border: "2px solid #5B2D8E" }}
              />
              {evError && <p className="text-red-300 text-sm font-semibold mb-2">{evError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={addEvent}
                  disabled={!evTitle.trim() || !evDate || evSaving}
                  className="flex-1 font-extrabold py-3 rounded-2xl transition disabled:opacity-50"
                  style={{ background: "#A8FF3E", color: "#1C1C1E" }}
                >
                  {evSaving ? "Saving..." : "Add Event"}
                </button>
                <button
                  onClick={() => { setShowAddEvent(false); setEvTitle(""); setEvDate(""); setEvNote(""); }}
                  className="px-5 py-3 rounded-2xl font-extrabold text-gray-400 hover:text-white border border-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default FamilyBoard;
