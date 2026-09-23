import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc, arrayUnion } from "firebase/firestore";
import { db } from "./Firebase.js";
import { normalizeGoogleCalendarRouting } from "./data/googleCalendarRouting.js";
import { isValidIanaTimezone, suggestBrowserTimezone } from "./data/householdTimezone.js";
import { subscribePendingIngestionCandidates } from "./data/ingestionCandidatesRepository.js";
import ReviewInboxPanel from "./organizer/ReviewInboxPanel.jsx";
import CandidateReviewModal from "./organizer/CandidateReviewModal.jsx";
import GmailCheckEmailAction from "./GmailCheckEmailAction.jsx";
import AddItemPanel from "./organizer/AddItemPanel.jsx";
import ChoreManagementPanel from "./ChoreManagementPanel.jsx";
import SettingsPage from "./settings/SettingsPage.jsx";

/* ─────────────────────── Parent Home ───────────────────────
 * Renamed/redesigned from ChildSelector as part of the UI/IA refactor.
 * All household-profile state and handlers (children, family name,
 * timezone, Google Calendar routing, add-child) are UNCHANGED from the
 * original ChildSelector — same effects, same Firestore/localStorage
 * read/write paths, same canonical child-id generation. What changed is
 * purely presentational/navigational: the old "Parent Tools" toggle +
 * inline config panels are replaced by a touch-friendly action-card grid
 * (Add Item, Upload Homework/Photo, Review Inbox, Check Email/Import,
 * Manage Chores, Settings) plus a permanent Settings page that now hosts
 * all household/integration configuration (see settings/SettingsPage.jsx).
 *
 * Deliberately does NOT duplicate Organizer content (Today/Upcoming/
 * Calendar/obligation lists) — Family Board/Organizer already own those.
 */
const ParentHome = ({
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

  // Which Parent Home action panel (if any) is currently expanded below the
  // action grid — at most one at a time, so this stays an action-focused
  // page rather than turning into a dashboard of simultaneously-open panels.
  const [activePanel, setActivePanel] = useState(null); // null | "addItem" | "upload" | "reviewInbox" | "checkEmail" | "manageChores"
  const [showSettings, setShowSettings] = useState(false);

  // Review Inbox — the single pending-candidate subscription for this page,
  // driving BOTH the action-grid badge and the inbox panel below (never two
  // subscriptions for the same data). Runs unconditionally so the badge is
  // accurate even while the panel itself is collapsed. pendingError is
  // distinct from an empty list — a load failure must never render as
  // "nothing to review."
  const [pendingCandidates, setPendingCandidates] = useState([]);
  const [pendingError, setPendingError] = useState(false);
  // The one candidate currently reopened from the inbox into the existing
  // CandidateReviewModal — a single-item array, mirroring exactly how the
  // immediate-capture flow already uses that same modal, just sourced from
  // a persisted list instead of a just-created batch.
  const [reviewInboxCandidate, setReviewInboxCandidate] = useState(null);

  useEffect(() => {
    const ctx = { uid: user?.uid, isAdmin: !!user?.isAdmin };
    const unsub = subscribePendingIngestionCandidates(
      ctx,
      (list) => {
        setPendingCandidates(list);
        setPendingError(false);
      },
      () => {
        setPendingCandidates([]);
        setPendingError(true);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.isAdmin]);

  // Auto-close: once the reopened candidate leaves "pending" (approved,
  // rejected, or otherwise resolved), the SAME subscription above will stop
  // including it — clear the local reopened-candidate state so the modal
  // (which itself already renders nothing once its internal queue is
  // empty) doesn't stay referenced. Never fires from the "×" close button,
  // which only clears reviewInboxCandidate directly and leaves the
  // candidate's own reviewStatus untouched.
  useEffect(() => {
    if (!reviewInboxCandidate) return;
    const stillPending = pendingCandidates.some((c) => c.id === reviewInboxCandidate.id);
    if (!stillPending) setReviewInboxCandidate(null);
  }, [pendingCandidates, reviewInboxCandidate]);

  // Family last name — shown as "{name} Family Board" on this page's button and
  // on the board itself. Stored on the same users/{uid} doc the board reads.
  const [familyLastName, setFamilyLastName] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);

  // Household timezone — the canonical users/{uid}.timezone field, on the
  // exact same profile document/persistence pattern as familyLastName
  // above (setDoc(..., {merge:true}) for a real account, localStorage for
  // guest/admin). Null/"" means "not yet configured" — never silently
  // defaulted to the browser's own timezone; the editingTimezone render
  // branch only ever SUGGESTS the browser value and requires an explicit
  // Save.
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

  useEffect(() => {
    // Shared tail: resolve the loaded child list, then either auto-forward into
    // a locked Child Mode device's child (Phase 1.5 — "returns to the locked
    // child after reload") or fall through to showing the normal picker.
    // Staying in `loading` (not calling setLoading(false)) while forwarding
    // avoids a one-frame flash of the picker before AuthShell stops rendering
    // this component at all.
    const finish = (list, famName, tz, routing) => {
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
        finish(data.children || [], data.familyLastName || "", data.timezone || null, data.googleCalendarRouting || null);
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

  if (showSettings) {
    return (
      <SettingsPage
        user={user}
        onBack={() => setShowSettings(false)}
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
        googleCalendarRouting={googleCalendarRouting}
        onRoutingSaved={setGoogleCalendarRouting}
        deviceMode={deviceMode}
        onSetDeviceMode={onSetDeviceMode}
        onLockChild={onLockChild}
      />
    );
  }

  const togglePanel = (name) => setActivePanel((prev) => (prev === name ? null : name));

  const ActionCard = ({ testId, icon, label, badge, onClick }) => (
    <button
      data-testid={testId}
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-2 p-5 rounded-3xl text-center transition hover:opacity-90 relative"
      style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}
    >
      {badge > 0 && (
        <span
          className="absolute top-2 right-2 text-xs font-extrabold rounded-full px-2 py-0.5"
          style={{ background: "#DC2626", color: "white" }}
        >
          {badge}
        </span>
      )}
      <span className="text-3xl">{icon}</span>
      <span className="text-white font-bold text-sm">
        {label}{badge > 0 ? ` · ${badge}` : ""}
      </span>
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col items-center p-6" style={{ background: "#1C1C1E" }}>
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-display text-white">Parent Home</h1>
            <p className="text-gray-400 text-sm mt-1">{user.email}</p>
          </div>
          <button
            onClick={onSignOut}
            className="text-gray-400 hover:text-white text-sm font-semibold px-4 py-2 rounded-full border border-gray-700 hover:border-gray-500 transition"
          >
            Sign out
          </button>
        </div>

        <button
          onClick={onOpenCalendar}
          className="w-full flex items-center gap-3 p-4 rounded-2xl mb-6 transition hover:opacity-90 font-extrabold text-white"
          style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
        >
          <span className="text-2xl">📅</span> {boardLabel}
        </button>

        {/* What can I do as the parent? — the primary Parent Tools actions.
            Add Item and Manage Chores each open their own parent-owned panel
            directly here on Parent Home (AddItemPanel.jsx / ChoreManagementPanel.jsx)
            — neither navigates into Family Board / Shared Display, which stay
            execution-only surfaces with no parent-admin dependency. */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <ActionCard testId="action-add-item" icon="➕" label="Add Item" onClick={() => togglePanel("addItem")} />
          <ActionCard testId="action-upload-homework" icon="📸" label="Upload Homework/Photo" onClick={() => togglePanel("upload")} />
          <ActionCard testId="action-review-inbox" icon="📥" label="Review Inbox" badge={pendingCandidates.length} onClick={() => togglePanel("reviewInbox")} />
          <ActionCard testId="action-check-email" icon="✉️" label="Check Email/Import" onClick={() => togglePanel("checkEmail")} />
          <ActionCard testId="action-manage-chores" icon="🧹" label="Manage Chores" onClick={() => togglePanel("manageChores")} />
          <ActionCard testId="action-settings" icon="⚙️" label="Settings" onClick={() => setShowSettings(true)} />
        </div>

        {activePanel === "addItem" && (
          <div data-testid="add-item-panel" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
            <h3 className="text-white font-display text-lg mb-4">Add Item</h3>
            <AddItemPanel ctx={{ uid: user?.uid, isAdmin: !!user?.isAdmin }} children={children} />
          </div>
        )}

        {activePanel === "manageChores" && (
          <ChoreManagementPanel ctx={{ uid: user?.uid, isAdmin: !!user?.isAdmin }} children={children} />
        )}

        {activePanel === "upload" && (
          <div data-testid="parent-organizer-panel" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
            <h3 className="text-white font-display text-lg mb-1">Upload Homework/Photo</h3>
            <p className="text-gray-400 text-sm mb-4">
              Pull homework details from a photo or spreadsheet into a learner's organizer.
            </p>
            {children.length === 0 ? (
              <p className="text-gray-400 text-sm">Add a learner in Settings first to import for them.</p>
            ) : (
              <div className="space-y-2">
                {children.map((child) => (
                  <button
                    key={child.id}
                    onClick={() => onOpenChildImport(child)}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl text-left transition hover:opacity-90"
                    style={{ background: "#1C1C1E" }}
                  >
                    <span className="text-xl">{child.emoji}</span>
                    <span className="text-white font-semibold">{child.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activePanel === "reviewInbox" && (
          <ReviewInboxPanel
            candidates={pendingCandidates}
            error={pendingError}
            familyChildren={children}
            onReview={setReviewInboxCandidate}
          />
        )}

        {reviewInboxCandidate && (
          <CandidateReviewModal
            ctx={{ uid: user?.uid, isAdmin: !!user?.isAdmin }}
            candidates={[reviewInboxCandidate]}
            familyChildren={children}
            onClose={() => setReviewInboxCandidate(null)}
          />
        )}

        {activePanel === "checkEmail" && (
          user.isAdmin ? (
            <div className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
              <h3 className="text-white font-display text-lg mb-1">Check Email</h3>
              <p className="text-gray-400 text-sm">Email import isn't available in guest/demo mode.</p>
            </div>
          ) : (
            <GmailCheckEmailAction ctx={{ uid: user.uid, isAdmin: false }} childProfiles={children} />
          )
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3 animate-pulse">⭐</div>
            <p className="text-gray-400">Loading...</p>
          </div>
        ) : (
          <div className="mt-2">
            <h2 className="text-gray-400 text-sm font-semibold mb-3">Learners</h2>
            {children.length === 0 ? (
              <p className="text-gray-500 text-sm mb-4">No children yet — add one in Settings.</p>
            ) : (
              <div className="space-y-3">
                {children.map(child => (
                  <button
                    key={child.id}
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
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ParentHome;
