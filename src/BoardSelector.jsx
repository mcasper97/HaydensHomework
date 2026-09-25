import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc, arrayUnion } from "firebase/firestore";
import { db } from "./Firebase.js";
import { normalizeGoogleCalendarRouting } from "./data/googleCalendarRouting.js";
import { isValidIanaTimezone, suggestBrowserTimezone } from "./data/householdTimezone.js";
import ParentBoard from "./ParentBoard.jsx";
import SettingsPage from "./settings/SettingsPage.jsx";

/* ─────────────────────── Board Selector ───────────────────────
 * The authenticated landing surface (navigation refactor) — replaces
 * ParentHome.jsx, which doubled as both "where do I want to go?" and "what
 * administrative action do I need?" in one screen. Those are now split:
 * this is purely a launcher ("Where do I want to go?"); Parent Board
 * (ParentBoard.jsx) owns the administrative actions.
 *
 * All household-profile state and handlers (children, family name,
 * timezone, Google Calendar routing, add/rename child) are UNCHANGED from
 * ParentHome.jsx/the original ChildSelector — same effects, same
 * Firestore/localStorage read/write paths, same canonical child-id
 * generation — just relocated here, since this is now the root
 * authenticated screen and every child screen (Parent Board, Settings)
 * needs this same data.
 *
 * Local `screen` state ("boards" | "parent" | "settings") replaces
 * ParentHome's two independent flags (a `showSettings` bool and an
 * `activePanel` string) with one small enum — narrowly scoped to this
 * component, not a new routing framework. AuthShell.jsx's own navigation
 * state (selectedChild, showCalendar, deviceMode, etc.) is untouched.
 */
const BoardSelector = ({
  user,
  onSelectChild,
  onSignOut,
  onOpenCalendar,
  onOpenChildImport,
  deviceMode,
  lockedChildId,
  suppressAutoLock,
  onSetDeviceMode,
  onLockChild,
}) => {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🦁");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [screen, setScreen] = useState("boards"); // "boards" | "parent" | "settings"

  // Family last name — shown as "{name} Family Board" on the launcher button
  // and on the board itself. Stored on the same users/{uid} doc the board reads.
  const [familyLastName, setFamilyLastName] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);

  // Household timezone — the canonical users/{uid}.timezone field, on the
  // exact same profile document/persistence pattern as familyLastName
  // above (setDoc(..., {merge:true}) for a real account, localStorage for
  // guest/admin). Null/"" means "not yet configured" — never silently
  // defaulted to the browser's own timezone; Settings' own editingTimezone
  // render branch only ever SUGGESTS the browser value and requires an
  // explicit Save.
  const [timezone, setTimezone] = useState(null);
  const [timezoneInput, setTimezoneInput] = useState("");
  const [editingTimezone, setEditingTimezone] = useState(false);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [timezoneError, setTimezoneError] = useState("");

  // Google Calendar routing config — loaded alongside the rest of the
  // household profile below (see finish()), normalized via
  // normalizeGoogleCalendarRouting so an absent field (no migration
  // needed) and a malformed one both land on the same safe default.
  // Guest/admin mode never connects Google Calendar at all, so this is
  // never read from localStorage — it simply stays at its default there.
  const [googleCalendarRouting, setGoogleCalendarRouting] = useState(normalizeGoogleCalendarRouting(null));

  // Google Calendar auto-publish (auto-commit/Calendar slice) — off by
  // default for every household (existing behavior required a manual
  // "Add to Google Calendar" click; this must never silently turn on an
  // external side effect for an existing user). Loaded alongside the rest
  // of the household profile below, saved by GoogleCalendarRoutingPanel.jsx
  // via src/data/googleCalendarAutoPublish.js (same setDoc(...,{merge:true})
  // pattern as every other field on this document).
  const [googleCalendarAutoPublishEnabled, setGoogleCalendarAutoPublishEnabled] = useState(false);

  useEffect(() => {
    // Shared tail: resolve the loaded child list, then either auto-forward into
    // a locked Child Mode device's child (Phase 1.5 — "returns to the locked
    // child after reload") or fall through to showing the normal launcher.
    // Staying in `loading` (not calling setLoading(false)) while forwarding
    // avoids a one-frame flash of the launcher before AuthShell stops
    // rendering this component at all.
    const finish = (list, famName, tz, routing, autoPublishEnabled) => {
      setChildren(list);
      setFamilyLastName(famName);
      setLastNameInput(famName);
      setTimezone(tz || null);
      // Unset -> pre-fill the (still-unsaved) input with the browser's own
      // current timezone as a SUGGESTION only — visibly editable, never
      // written to Firestore/localStorage until the parent explicitly
      // clicks Save/"Use this timezone" (see saveTimezone).
      setTimezoneInput(tz || suggestBrowserTimezone() || "");
      setGoogleCalendarRouting(normalizeGoogleCalendarRouting(routing));
      setGoogleCalendarAutoPublishEnabled(!!autoPublishEnabled);
      if (!suppressAutoLock && deviceMode === "child" && lockedChildId) {
        const match = list.find((c) => c.id === lockedChildId);
        if (match) {
          onSelectChild(match);
          return;
        }
      }
      setLoading(false);
    };

    // Admin bypass — use localStorage for child list
    if (user.isAdmin) {
      const saved = localStorage.getItem("crestly_admin_children");
      const savedName = localStorage.getItem("crestly_admin_family_name") || "";
      const savedTimezone = localStorage.getItem("crestly_admin_timezone") || null;
      finish(saved ? JSON.parse(saved) : [], savedName, savedTimezone);
      return;
    }
    if (!db) { setLoading(false); return; }
    const profileRef = doc(db, "users", user.uid);
    getDoc(profileRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        finish(data.children || [], data.familyLastName || "", data.timezone || null, data.googleCalendarRouting || null, data.googleCalendarAutoPublishEnabled);
      } else {
        setLoading(false);
      }
    }).catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, deviceMode, lockedChildId, suppressAutoLock]);

  const saveFamilyName = async () => {
    const name = lastNameInput.trim();
    if (name === familyLastName || savingName) { setEditingName(false); return; }
    setSavingName(true);
    if (user.isAdmin) {
      localStorage.setItem("crestly_admin_family_name", name);
      setFamilyLastName(name);
      setSavingName(false);
      setEditingName(false);
      return;
    }
    try {
      const profileRef = doc(db, "users", user.uid);
      await setDoc(profileRef, { familyLastName: name }, { merge: true });
      setFamilyLastName(name);
    } catch (e) {
      console.error("Save family name failed:", e);
      setLastNameInput(familyLastName); // revert on failure
    } finally {
      setSavingName(false);
      setEditingName(false);
    }
  };

  // Household timezone — validated BEFORE any write is attempted (real
  // account or guest alike), using the exact deterministic
  // Intl.DateTimeFormat-based check isValidIanaTimezone performs; an
  // invalid value is rejected with an inline error and never persisted,
  // never even attempted against Firestore/localStorage.
  const saveTimezone = async () => {
    const value = timezoneInput.trim();
    if (!isValidIanaTimezone(value)) {
      setTimezoneError("That doesn't look like a valid timezone (e.g. America/New_York).");
      return;
    }
    setTimezoneError("");
    if (value === timezone || savingTimezone) { setEditingTimezone(false); return; }
    setSavingTimezone(true);
    if (user.isAdmin) {
      localStorage.setItem("crestly_admin_timezone", value);
      setTimezone(value);
      setSavingTimezone(false);
      setEditingTimezone(false);
      return;
    }
    try {
      const profileRef = doc(db, "users", user.uid);
      await setDoc(profileRef, { timezone: value }, { merge: true });
      setTimezone(value);
    } catch (e) {
      console.error("Save household timezone failed:", e);
      setTimezoneInput(timezone || ""); // revert on failure
    } finally {
      setSavingTimezone(false);
      setEditingTimezone(false);
    }
  };

  const boardLabel = familyLastName ? `${familyLastName} Family Board` : "Family Board";

  const addChild = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    const id = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now().toString(36);
    const child = { id, name, emoji: newEmoji, createdAt: new Date().toISOString() };

    if (user.isAdmin) {
      const updated = [...children, child];
      localStorage.setItem("crestly_admin_children", JSON.stringify(updated));
      setChildren(updated);
    } else {
      try {
        const profileRef = doc(db, "users", user.uid);
        await setDoc(profileRef, { children: arrayUnion(child), parentEmail: user.email }, { merge: true });
        setChildren(prev => [...prev, child]);
      } catch (e) {
        console.error("Add child failed:", e);
        setSaveError("Couldn't save — please try again.");
        setSaving(false);
        return;
      }
    }

    setNewName("");
    setNewEmoji("🦁");
    setShowAdd(false);
    setSaving(false);
  };

  // Renames an existing child's display name in place — never touches
  // child.id or any other field, never adds/removes an array entry (the
  // updated array has the exact same ids/length as before, just one
  // entry's `name` replaced), so every existing reference keyed by child
  // id (Google Calendar childCalendarIds, Gmail sender targetChildId,
  // Items' childIds, chore templates, and this screen's own learner
  // buttons below) keeps resolving unchanged. Mirrors addChild's
  // guest/real-account persistence split, but writes the whole `children`
  // array (arrayUnion can only append, never edit an existing element)
  // rather than appending a new one.
  const renameChild = async (childId, newName) => {
    const name = newName.trim();
    if (!name) throw new Error("Name can't be empty.");
    const current = children.find((c) => c.id === childId);
    if (!current || current.name === name) return; // no-op — nothing to persist
    const updated = children.map((c) => (c.id === childId ? { ...c, name } : c));

    if (user.isAdmin) {
      localStorage.setItem("crestly_admin_children", JSON.stringify(updated));
      setChildren(updated);
      return;
    }
    try {
      const profileRef = doc(db, "users", user.uid);
      await setDoc(profileRef, { children: updated }, { merge: true });
      setChildren(updated);
    } catch (e) {
      console.error("Rename child failed:", e);
      throw new Error("Couldn't save — please try again.");
    }
  };

  if (screen === "settings") {
    return (
      <SettingsPage
        user={user}
        onBack={() => setScreen("boards")}
        onSignOut={onSignOut}
        children={children}
        familyLastName={familyLastName}
        editingName={editingName}
        setEditingName={setEditingName}
        lastNameInput={lastNameInput}
        setLastNameInput={setLastNameInput}
        savingName={savingName}
        saveFamilyName={saveFamilyName}
        timezone={timezone}
        editingTimezone={editingTimezone}
        setEditingTimezone={setEditingTimezone}
        timezoneInput={timezoneInput}
        setTimezoneInput={setTimezoneInput}
        timezoneError={timezoneError}
        setTimezoneError={setTimezoneError}
        savingTimezone={savingTimezone}
        saveTimezone={saveTimezone}
        showAdd={showAdd}
        setShowAdd={setShowAdd}
        newName={newName}
        setNewName={setNewName}
        newEmoji={newEmoji}
        setNewEmoji={setNewEmoji}
        saving={saving}
        saveError={saveError}
        setSaveError={setSaveError}
        addChild={addChild}
        renameChild={renameChild}
        googleCalendarRouting={googleCalendarRouting}
        onRoutingSaved={setGoogleCalendarRouting}
        googleCalendarAutoPublishEnabled={googleCalendarAutoPublishEnabled}
        onAutoPublishSaved={setGoogleCalendarAutoPublishEnabled}
        deviceMode={deviceMode}
        onSetDeviceMode={onSetDeviceMode}
        onLockChild={onLockChild}
      />
    );
  }

  if (screen === "parent") {
    return (
      <ParentBoard
        user={user}
        children={children}
        onOpenChildImport={onOpenChildImport}
        onBack={() => setScreen("boards")}
        onNavigateToSettings={() => setScreen("settings")}
      />
    );
  }

  return (
    <div data-testid="board-selector" className="min-h-screen flex flex-col items-center p-6" style={{ background: "#1C1C1E" }}>
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-display text-white">Haydens - Homework</h1>
            <p className="text-gray-400 text-sm mt-1">{user.email}</p>
          </div>
          <button
            onClick={onSignOut}
            className="text-gray-400 hover:text-white text-sm font-semibold px-4 py-2 rounded-full border border-gray-700 hover:border-gray-500 transition"
          >
            Sign out
          </button>
        </div>

        <div className="space-y-3 mb-6">
          <button
            data-testid="board-family"
            onClick={onOpenCalendar}
            className="w-full flex items-center gap-3 p-4 rounded-2xl transition hover:opacity-90 font-extrabold text-white"
            style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
          >
            <span className="text-2xl">📅</span> {boardLabel}
          </button>
          <button
            data-testid="board-parent"
            onClick={() => setScreen("parent")}
            className="w-full flex items-center gap-3 p-4 rounded-2xl transition hover:opacity-90 font-extrabold text-white"
            style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}
          >
            <span className="text-2xl">🛠️</span> Parent Board
          </button>
          <button
            data-testid="board-settings"
            onClick={() => setScreen("settings")}
            className="w-full flex items-center gap-3 p-4 rounded-2xl transition hover:opacity-90 font-extrabold text-white border border-gray-700"
            style={{ background: "#2a2a2c" }}
          >
            <span className="text-2xl">⚙️</span> Settings
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2 animate-pulse">⭐</div>
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : children.length > 0 && (
          <div className="mt-2">
            <h2 className="text-gray-400 text-sm font-semibold mb-3">Learners</h2>
            <div className="space-y-3">
              {children.map((child) => (
                <button
                  key={child.id}
                  data-testid="board-learner"
                  onClick={() => onSelectChild(child)}
                  className="w-full flex items-center gap-4 p-5 rounded-3xl text-left transition hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}
                >
                  <span className="text-4xl">{child.emoji}</span>
                  <div>
                    <div className="text-xl font-display text-white">{child.name}</div>
                    <div className="text-purple-300 text-sm">Tap to start learning</div>
                  </div>
                  <div className="ml-auto text-white text-2xl">→</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BoardSelector;
