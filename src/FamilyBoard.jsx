import React, { useEffect, useMemo, useState } from "react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { db } from "./Firebase.js";
import { migrateLegacyFamilyEvents } from "./data/itemsRepository.js";
import { householdTodayStr } from "./data/householdTimezone.js";
import FamilyAgendaBoard from "./organizer/FamilyAgendaBoard.jsx";
import OrganizerDisplay from "./organizer/OrganizerDisplay.jsx";
import LearnerPointsStrip from "./organizer/LearnerPointsStrip.jsx";
import FullScreenButton from "./organizer/FullScreenButton.jsx";
import { SURFACE } from "./organizer/boardTheme.js";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Current time only (Section 3 — no separate date, no weather). Updates
// every 30s, which is plenty for a clock nobody needs to the second.
const FamilyBoardClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <span data-testid="board-clock" className="text-sm font-bold" style={{ color: SURFACE.textPrimary }}>
      {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
    </span>
  );
};

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
 * — read/projected through organizer/FamilyAgendaBoard.jsx below (Section
 * 14-16 unified agenda), never as a Firestore path/doc directly in this
 * file.
 *
 * IMPORTANT: this deliberately avoids writing to users/{uid}/children/{childId}.
 * That subdocument is owned by App.jsx, which periodically overwrites it
 * WITHOUT merge (see App.jsx's debounced Firestore-sync effect) — if the
 * board wrote there too, App.jsx's next autosave would silently wipe it out.
 */
const FamilyBoard = ({ uid, email, isAdmin, kiosk = false, onBack, onExitKiosk }) => {
  const [profile, setProfile] = useState(null); // { children, familyEvents, choreTemplates, choreCompletions, chorePoints, migrated_familyEvents_v1 }
  const [childStats, setChildStats] = useState({}); // { [childId]: { homeworkPoints } } — homeworkPoints only; upcomingTests now live as canonical test/quiz items (see ParentOrganizer/OrganizerCalendar)
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // surfaced on-screen — this runs unattended, no devtools to check

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
      timezone: localStorage.getItem("crestly_admin_timezone") || null,
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
          timezone: data.timezone || null,
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

  /* ----------------------------- Chores (legacy model — unchanged) -----------------------------
   * Chore-template CRUD (add/remove a chore definition) no longer lives on
   * Family Board at all (Section 15 — admin boundary) — it stays exactly
   * where Parent Board's "Manage Chores" action already reuses it, via
   * data/choreTemplatesRepository.js and src/ChoreManagementPanel.jsx.
   * toggleChoreDone below is execution only (marking today's occurrence
   * done/undone) and is unaffected by that boundary. Uses the SAME
   * household-local "today" organizer/familyAgenda.js groups rows by (see
   * that module's own doc comment) — using a different "today" here than
   * what's on screen would let a completion write land on a different
   * calendar date than the row the parent actually tapped, near a
   * midnight boundary.
   */
  const toggleChoreDone = async (childId, chore) => {
    const today = householdTodayStr(profile?.timezone) || todayStr();
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
      <div className="familyboard-viewport" style={{ background: SURFACE.appBackground, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🏡</div>
          <p className="font-display text-xl" style={{ color: SURFACE.textSecondary }}>Loading family board…</p>
        </div>
      </div>
    );
  }

  const children = profile?.children || [];
  const choreTemplates = profile?.choreTemplates || {};
  const choreCompletions = profile?.choreCompletions || {};
  const chorePoints = profile?.chorePoints || {};

  // K-5 REDESIGN — FULL-VIEWPORT SHELL (Section 2/4): the outer shell uses
  // the `.familyboard-viewport` class (index.html — a plain CSS rule, not a
  // Tailwind utility, so it survives even if the Tailwind CDN never loads)
  // for `width:100vw` + `height:100vh`/`100dvh` + `overflow:hidden`. The old
  // `max-w-6xl mx-auto` centered desktop wrapper is gone — Section 2
  // explicitly forbids a narrow centered shell; the board now genuinely
  // uses the full viewport width, with only a small edge gutter (16-24px)
  // for breathing room, not a fixed max column. The
  // display:flex/flexDirection/flex/minHeight chain below (down through
  // FamilyAgendaBoard.jsx's and FamilyWeekBoard.jsx's own containers) stays
  // inline rather than Tailwind classes for the same CDN-independence
  // reason as before (Section 19) — this is the load-bearing fix for the
  // page never scrolling.
  return (
    <div className="familyboard-viewport" style={{ background: SURFACE.appBackground, display: "flex", flexDirection: "column" }}>
      <div className="w-full" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "10px 20px 14px" }}>
        {/* K-5 REDESIGN header band (Section "TOP HEADER"): brand +
            compact learner chips + current time + Full Screen control, all
            in one light card-like row. The learner chips render here (not
            duplicated inside OrganizerDisplay.jsx any more) so both the
            normal and kiosk surfaces share exactly one points display.
            Large per-learner FOCUS controls live just below, in
            organizer/FamilyAgendaBoard.jsx, which still owns that state. */}
        <div
          className="rounded-2xl"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            flexShrink: 0,
            background: SURFACE.headerBackground,
            border: `1px solid ${SURFACE.border}`,
            padding: "10px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ fontSize: 26 }}>🏡</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <h1 className="text-xl font-display font-extrabold" style={{ color: SURFACE.textPrimary, margin: 0 }}>
                Haydens - Homework
              </h1>
              <span className="text-sm font-semibold" style={{ color: SURFACE.textSecondary }}>/ Family Board</span>
            </div>
          </div>

          {children.length > 0 && <LearnerPointsStrip children={children} chorePoints={chorePoints} childStats={childStats} />}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FullScreenButton />
            <FamilyBoardClock />
            {!kiosk && onBack ? (
              <button
                onClick={onBack}
                className="text-sm font-semibold transition"
                style={{ color: SURFACE.textSecondary, padding: "8px 16px", borderRadius: 999, border: `1px solid ${SURFACE.border}`, background: "#FFFFFF" }}
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
                  className="text-xs font-semibold transition"
                  style={{ color: SURFACE.textMuted, padding: "6px 12px", borderRadius: 999 }}
                >
                  Home
                </button>
              ) : (
                <a
                  href={window.location.pathname}
                  className="text-xs font-semibold transition"
                  style={{ color: SURFACE.textMuted, padding: "6px 12px", borderRadius: 999 }}
                >
                  Home
                </a>
              )
            ) : null}
          </div>
        </div>

        {loadError && (
          <div className="rounded-2xl p-4 mt-3 mb-1 border text-sm" style={{ borderColor: "#F2A6A6", background: "#FDEDED", color: "#9A2E2E", flexShrink: 0 }}>
            ⚠️ {loadError}
          </div>
        )}

        {!loadError && children.length === 0 && (
          <p className="text-center py-8" style={{ color: SURFACE.textSecondary }}>No learners set up on this account yet.</p>
        )}

        {/* Family Board is now a single unified, execution-only agenda
            (Section 14-16) — both the normal (kiosk=false) and shared/
            kiosk (kiosk=true, below) surfaces render the exact same
            FamilyAgendaBoard. No Add Item, no Manage Chores, no Item
            edit/delete, no separate calendar pane — those all belong to
            Parent Board / Settings now (Section 15). */}
        {!kiosk && children.length > 0 && (
          <FamilyAgendaBoard
            ctx={ctx}
            children={children}
            choreTemplates={choreTemplates}
            choreCompletions={choreCompletions}
            onToggleChore={toggleChoreDone}
            householdTimezone={profile?.timezone}
          />
        )}

        {kiosk && (
          <OrganizerDisplay
            children={children}
            choreTemplates={choreTemplates}
            choreCompletions={choreCompletions}
            ctx={ctx}
            onToggleChore={toggleChoreDone}
            householdTimezone={profile?.timezone}
          />
        )}
      </div>
    </div>
  );
};

export default FamilyBoard;
