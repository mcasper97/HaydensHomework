import React, { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth, googleProvider } from "./Firebase.js";
import App from "./App.jsx";
import FamilyBoard from "./FamilyBoard.jsx";
import ParentUnlock from "./ParentUnlock.jsx";
import LandingPage from "./LandingPage.jsx";
import ParentHome from "./ParentHome.jsx";
import {
  getDeviceMode,
  setDeviceMode as persistDeviceMode,
  getLockedChildId,
  setLockedChildId as persistLockedChildId,
  resetDeviceLock,
  getRecoveryPending,
  setRecoveryPending as persistRecoveryPending,
} from "./deviceMode.js";
import { setPin as savePin } from "./data/parentPin.js";

// Local-only guest/demo profile — NOT a privilege level and NOT tied to any
// real household's Firestore data. `isAdmin` here just means "use the
// crestly_admin_* localStorage keys instead of Firestore" (see ParentHome.jsx
// and FamilyBoard below); the name is kept only so existing local demo data
// under those keys keeps working. Entry no longer requires (or checks) any
// credential — see the "Continue without an account" button in LandingPage.
const GUEST_USER = { uid: "guest-local", email: "Guest", displayName: "Guest", isAdmin: true };

/* ─────────────────── Parent Unlock post-PIN menu (Phase 1.5) ─────────────────── */
const ParentUnlockMenu = ({ onSwitchChild, onParentControls, onExitChildMode, onClose }) => (
  <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
    <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: "#2a2a2c" }}>
      <h2 className="text-xl font-display text-white mb-4">Parent Controls</h2>
      <div className="space-y-2">
        <button
          onClick={onSwitchChild}
          className="w-full text-left font-extrabold py-3 px-4 rounded-2xl text-white transition hover:opacity-90"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          🔁 Switch child
        </button>
        <button
          onClick={onParentControls}
          className="w-full text-left font-extrabold py-3 px-4 rounded-2xl text-white transition hover:opacity-90"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          🛠️ Open Parent Controls (Organizer, Calendar, + Add)
        </button>
        <button
          onClick={onExitChildMode}
          className="w-full text-left font-extrabold py-3 px-4 rounded-2xl text-white transition hover:opacity-90"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          🚪 Exit Child Mode
        </button>
      </div>
      <button onClick={onClose} className="w-full text-gray-400 hover:text-white text-sm font-semibold mt-4">
        Cancel
      </button>
    </div>
  </div>
);

/* ─────────────────── Forgot-PIN recovery screen (Phase 1.5) ───────────────────
 * Shown only once a real Firebase sign-in has succeeded after "Forgot PIN?" —
 * never before. The device's Child Mode lock (and the old PIN) are still
 * fully intact at this point; every action here is an explicit, authenticated
 * choice about what to do with them, never an automatic side effect of
 * reaching this screen.
 */
const RecoveryScreen = ({ onSetNewPin, onSwitchToParentMode, onChooseChild, onReturnToChildMode }) => {
  const [showPinForm, setShowPinForm] = useState(false);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submitNewPin = async () => {
    if (pin1.length < 4) {
      setError("PIN must be at least 4 digits.");
      return;
    }
    if (pin1 !== pin2) {
      setError("PINs don't match.");
      return;
    }
    setSaving(true);
    await onSetNewPin(pin1);
    setSaving(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#1C1C1E" }}>
      <div className="w-full max-w-md rounded-3xl p-8" style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}>
        <h1 className="text-2xl font-display text-white mb-2">Parent Recovery</h1>
        <p className="text-purple-200 text-sm mb-6">
          You're signed in. This device is still locked to Child Mode — signing in alone doesn't change that.
          Choose what to do next.
        </p>

        {!showPinForm ? (
          <div className="space-y-3">
            <button
              onClick={() => setShowPinForm(true)}
              className="w-full text-left font-extrabold py-3 px-4 rounded-2xl text-white transition hover:opacity-90"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              🔑 Reset the parent PIN
            </button>
            <button
              onClick={onSwitchToParentMode}
              className="w-full text-left font-extrabold py-3 px-4 rounded-2xl text-white transition hover:opacity-90"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              👤 Switch this device to Parent Mode
            </button>
            <button
              onClick={onChooseChild}
              className="w-full text-left font-extrabold py-3 px-4 rounded-2xl text-white transition hover:opacity-90"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              🔁 Choose a different child
            </button>
            <button
              onClick={onReturnToChildMode}
              className="w-full text-left font-semibold py-3 px-4 rounded-2xl text-purple-200 transition hover:opacity-90"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              ← Return to Child Mode (keep everything as-is)
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin1}
              onChange={(e) => setPin1(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="New PIN (4+ digits)"
              className="w-full rounded-2xl px-4 py-3 font-bold tracking-widest text-center focus:outline-none"
              style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
            />
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="Confirm PIN"
              className="w-full rounded-2xl px-4 py-3 font-bold tracking-widest text-center focus:outline-none"
              style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
            />
            {error && <p className="text-red-300 text-sm font-semibold">{error}</p>}
            <button
              onClick={submitNewPin}
              disabled={saving}
              className="w-full font-extrabold py-3 rounded-2xl disabled:opacity-50"
              style={{ background: "#A8FF3E", color: "#1C1C1E" }}
            >
              {saving ? "Saving..." : "Set PIN & Return to Child Mode"}
            </button>
            <button
              onClick={() => { setShowPinForm(false); setError(""); }}
              className="w-full text-purple-200 hover:text-white text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────── Auth Shell ─────────────────────── */
const AuthShell = () => {
  const [user, setUser] = useState(undefined);
  const [selectedChild, setSelectedChild] = useState(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  // Which view a newly-selected child's App instance should open on.
  // Normally "home" (every existing entry point). Set to "parents" only by
  // Parent Home's "Upload Homework/Photo" action (handleOpenChildImport
  // below) so that link lands directly on the Parents Page instead of the
  // child's game Home. Deliberately NOT
  // reachable from Family Board / Shared Display or any child-facing
  // page — import/admin functionality only ever originates from this
  // authenticated Parent Home screen (see ParentHome.jsx).
  const [childEntryView, setChildEntryView] = useState("home");

  // Read once at mount — this doesn't change during the session.
  const [isBoardRoute] = useState(
    () => new URLSearchParams(window.location.search).get("board") === "1"
  );

  // ── Phase 1.5: local device-mode / child-lock state, mirrored from
  // localStorage (see deviceMode.js). Purely a UI/navigation preference for
  // THIS browser — never a new backend source of truth, never a substitute
  // for Firebase Authentication (still required below via `user`).
  const [deviceMode, setDeviceModeValue] = useState(() => getDeviceMode());
  const [lockedChildId, setLockedChildIdValue] = useState(() => getLockedChildId());
  const applyDeviceMode = (mode) => {
    persistDeviceMode(mode);
    setDeviceModeValue(mode);
  };
  const applyLockedChildId = (id) => {
    persistLockedChildId(id);
    setLockedChildIdValue(id);
  };

  // Parent Unlock flow: null (locked, no prompt shown) | "pin" (entering PIN) |
  // "menu" (correct PIN entered, choosing switch/controls/exit).
  const [unlockStage, setUnlockStage] = useState(null);
  // Set only via a successful Parent Unlock; lets a locked device temporarily
  // show the normal child picker ("switch") or the full parent board
  // ("controls") without permanently clearing the device's lock.
  const [parentUnlockedView, setParentUnlockedView] = useState(null);
  // Forgot-PIN recovery: armed the moment "Forgot PIN?" is tapped, cleared
  // only once the parent has chosen a recovery action post-re-auth. The
  // device's lock (deviceMode/lockedChildId) and PIN are deliberately left
  // untouched while this is true — see handleForgotPin below — so tapping
  // Forgot PIN alone can never itself escape Child Mode; only a real
  // Firebase sign-in followed by an explicit recovery choice can. Persisted
  // (not just in-memory) so a reload while signed out — which forced
  // sign-out naturally invites — doesn't lose track of "recovery is armed"
  // and silently fall back into the locked Child Mode on next sign-in.
  const [recoveryPending, setRecoveryPendingValue] = useState(() => getRecoveryPending());
  const applyRecoveryPending = (pending) => {
    persistRecoveryPending(pending);
    setRecoveryPendingValue(pending);
  };

  useEffect(() => {
    if (!auth) { setUser(null); return; }
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u ?? null);
      if (!u) setSelectedChild(null);
    });
    return unsub;
  }, []);

  const handleGoogleSignIn = async () => {
    setGoogleError("");
    setGoogleLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      // onAuthStateChanged will set the user
    } catch (e) {
      const msg =
        e.code === "auth/unauthorized-domain"
          ? "This domain is not authorized. Add haydens-homework.vercel.app to Firebase → Authentication → Authorized Domains."
          : e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request"
          ? ""
          : `Google sign-in failed: ${e.code || e.message}`;
      setGoogleError(msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleEmailSignIn = async (email, password, isNew) => {
    setEmailLoading(true);
    try {
      if (isNew) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      return {};
    } catch (e) {
      const msg =
        e.code === "auth/user-not-found" ? "No account found. Try creating one." :
        e.code === "auth/wrong-password" ? "Incorrect password." :
        e.code === "auth/email-already-in-use" ? "Email already in use. Try signing in." :
        e.code === "auth/invalid-email" ? "Invalid email address." :
        e.code === "auth/weak-password" ? "Password must be at least 6 characters." :
        "Sign in failed. Please try again.";
      setEmailLoading(false);
      return { error: msg };
    } finally {
      setEmailLoading(false);
    }
  };

  const handleSignOut = async () => {
    setSelectedChild(null);
    setShowCalendar(false);
    if (user?.isAdmin) { setUser(null); return; }
    await signOut(auth);
  };

  // Local-only guest/demo entry — no credential, no Firebase Auth session,
  // no access to any real household's Firestore data (see GUEST_USER above
  // and the isAdmin-gated localStorage branches in ParentHome.jsx/FamilyBoard).
  const handleGuestEntry = () => {
    setUser(GUEST_USER);
  };

  // ── Phase 1.5: device-mode / child-lock handlers ──
  const handleSelectChild = (child) => {
    setChildEntryView("home"); // every normal selection opens on Home, as before
    setSelectedChild(child);
    // Re-lock to whichever child is now selected — covers both the initial
    // auto-forward (already matches) and a genuine "switch child" pick.
    if (deviceMode === "child") applyLockedChildId(child.id);
    setParentUnlockedView(null);
  };

  // Called only from Parent Home's "Upload Homework/Photo" action (see
  // ParentHome.jsx) — never from Family Board / Shared Display or any
  // child-facing page, per product rule (those surfaces are execution-only
  // and must not expose import/admin functionality). Deliberately does NOT
  // call handleSelectChild / applyLockedChildId — this is pure navigation
  // to an existing child's Parents Page, not a device-mode change, and
  // must never re-lock a device to a different child as a side effect.
  const handleOpenChildImport = (child) => {
    setChildEntryView("parents");
    setSelectedChild(child);
    setShowCalendar(false);
    setParentUnlockedView(null);
  };

  // Called from the Settings page's Device Mode settings. A PIN must already exist
  // by the time this runs — DeviceModeSettings walks the parent through
  // setting one first if it doesn't (Phase 1.5: Child Mode must never be
  // enabled without a PIN).
  const handleLockChild = (child) => {
    applyDeviceMode("child");
    applyLockedChildId(child.id);
    setSelectedChild(child);
  };

  const requestParentUnlock = () => setUnlockStage("pin");
  const handleUnlockSuccess = () => setUnlockStage("menu");
  const handleUnlockCancel = () => setUnlockStage(null);

  const handleSwitchChildFromUnlock = () => {
    setUnlockStage(null);
    setParentUnlockedView("switch");
    setSelectedChild(null);
  };

  const handleParentControlsFromUnlock = () => {
    setUnlockStage(null);
    setParentUnlockedView("controls");
  };

  // Normal, PIN-authenticated exit — clears this device's lock (mode + locked
  // child) but leaves the parent PIN itself in place, so re-locking a device
  // later doesn't require setting a new PIN. Never touches Firestore.
  const handleExitChildMode = () => {
    resetDeviceLock();
    applyDeviceMode(null);
    applyLockedChildId(null);
    setUnlockStage(null);
    setParentUnlockedView(null);
    setSelectedChild(null);
  };

  // Forgot-PIN recovery: reached from ParentUnlock without ever entering a
  // correct PIN. Deliberately does NOT touch this device's lock (deviceMode /
  // lockedChildId) or the PIN itself — only signs out and arms
  // `recoveryPending`. That means tapping Forgot PIN by itself changes
  // nothing about Child Mode; it only forces a real Firebase re-auth. The
  // lock/PIN can only be cleared or replaced afterward, from RecoveryScreen,
  // once `user` is genuinely signed in again (see the recoveryPending render
  // branch below). No Firestore/family data is touched by any of this.
  const handleForgotPin = async () => {
    setUnlockStage(null);
    setParentUnlockedView(null);
    applyRecoveryPending(true);
    if (user?.isAdmin) {
      setUser(null);
    } else if (auth) {
      await signOut(auth);
    }
  };

  // ── Post-re-auth recovery actions (RecoveryScreen) — each requires a real,
  // successful Firebase sign-in to have already happened (recoveryPending is
  // only ever shown once `user` is truthy again). ──
  const handleRecoverySetNewPin = async (newPin) => {
    await savePin(newPin); // replaces the old (forgotten) hash/salt
    applyRecoveryPending(false); // resumes the same locked child, now with a working PIN
  };

  const handleRecoverySwitchToParentMode = () => {
    resetDeviceLock();
    applyDeviceMode(null);
    applyLockedChildId(null);
    setSelectedChild(null);
    applyRecoveryPending(false);
  };

  const handleRecoveryChooseChild = () => {
    // Stays in deviceMode "child" — picking a child on the resulting picker
    // (via the existing "switch" flow) re-locks to whichever one is chosen.
    setParentUnlockedView("switch");
    setSelectedChild(null);
    applyRecoveryPending(false);
  };

  const handleReturnToChildMode = () => {
    // No changes at all — lock and PIN are exactly as they were.
    applyRecoveryPending(false);
  };

  // ── Wall-tablet board route: ?board=1 opens straight to the family board
  // in kiosk styling, skipping child-selection — but ONLY after the same
  // real Firebase Auth sign-in every other user goes through. Firebase Auth
  // persists the session locally (IndexedDB), so a mounted tablet signs in
  // once and stays signed in like any other browser session; it no longer
  // has a special unauthenticated path. See LandingPage below for sign-in.
  // Kept as its own, untouched check (rather than folded into the Organizer
  // branch below) so an existing bookmarked ?board=1 URL keeps behaving
  // exactly as before — only what FamilyBoard renders for kiosk has changed
  // (see FamilyBoard.jsx: kiosk now renders the display-only OrganizerDisplay).
  if (isBoardRoute && user) {
    return (
      <FamilyBoard
        uid={user.uid}
        email={user.email}
        isAdmin={user.isAdmin}
        kiosk
      />
    );
  }

  // Loading auth state
  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#1C1C1E" }}>
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🏔️</div>
          <p className="text-gray-400 font-display text-xl">Haydens - Homework</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LandingPage
        onSignIn={handleGoogleSignIn}
        onEmailSignIn={handleEmailSignIn}
        onGuestEnter={handleGuestEntry}
        loading={googleLoading}
        emailLoading={emailLoading}
        googleError={googleError}
      />
    );
  }

  // Forgot-PIN recovery: only reachable once `user` is truthy again (a real,
  // successful sign-in) — this is what makes recovery gated on
  // authentication rather than on merely tapping "Forgot PIN?". The device's
  // lock/PIN are untouched up to this point; only the actions below change
  // them, and only here, after re-auth has already succeeded.
  if (recoveryPending) {
    return (
      <RecoveryScreen
        onSetNewPin={handleRecoverySetNewPin}
        onSwitchToParentMode={handleRecoverySwitchToParentMode}
        onChooseChild={handleRecoveryChooseChild}
        onReturnToChildMode={handleReturnToChildMode}
      />
    );
  }

  // ── Phase 1.5 device-mode branches (user is signed in from here on;
  // device mode only ever decides what renders AFTER that, never bypasses it) ──

  // "Parent Controls" — reached only via a successful Parent Unlock from a
  // locked Child Mode device. Full parent board; "Done" returns to the
  // locked child without touching this device's lock.
  if (parentUnlockedView === "controls") {
    return (
      <FamilyBoard
        uid={user.uid}
        email={user.email}
        isAdmin={user.isAdmin}
        onBack={() => setParentUnlockedView(null)}
      />
    );
  }

  // Organizer Mode — either this device's explicit local setting, or the
  // backward-compatible ?board=1 URL (handled above). No PIN required to
  // view (Phase 1.5: viewing Today/Upcoming/Calendar/chores stays convenient).
  if (deviceMode === "organizer") {
    return (
      <FamilyBoard
        uid={user.uid}
        email={user.email}
        isAdmin={user.isAdmin}
        kiosk
        onExitKiosk={() => applyDeviceMode(null)}
      />
    );
  }

  if (!selectedChild) {
    if (showCalendar) {
      return (
        <FamilyBoard
          uid={user.uid}
          email={user.email}
          isAdmin={user.isAdmin}
          onBack={() => setShowCalendar(false)}
        />
      );
    }
    // ParentHome auto-forwards into the locked child (deviceMode==="child")
    // once it finishes loading, unless parentUnlockedView === "switch" is
    // temporarily showing the picker after a successful Parent Unlock.
    return (
      <ParentHome
        user={user}
        onSelectChild={handleSelectChild}
        onSignOut={handleSignOut}
        onOpenCalendar={() => setShowCalendar(true)}
        onOpenChildImport={handleOpenChildImport}
        deviceMode={deviceMode}
        lockedChildId={lockedChildId}
        suppressAutoLock={parentUnlockedView === "switch"}
        onSetDeviceMode={applyDeviceMode}
        onLockChild={handleLockChild}
      />
    );
  }

  // Locked Child Mode with a child selected: the child's normal game
  // experience, plus the Parent Unlock gate/menu overlaid on top when
  // requested — never a bare "switch child" or "Parents" control.
  if (deviceMode === "child") {
    return (
      <>
        <App
          uid={user.uid}
          childId={selectedChild.id}
          childName={selectedChild.name}
          childEmoji={selectedChild.emoji}
          isAdmin={!!user.isAdmin}
          deviceMode="child"
          onRequestParentUnlock={requestParentUnlock}
        />
        {unlockStage === "pin" && (
          <ParentUnlock onUnlock={handleUnlockSuccess} onCancel={handleUnlockCancel} onForgot={handleForgotPin} />
        )}
        {unlockStage === "menu" && (
          <ParentUnlockMenu
            onSwitchChild={handleSwitchChildFromUnlock}
            onParentControls={handleParentControlsFromUnlock}
            onExitChildMode={handleExitChildMode}
            onClose={() => setUnlockStage(null)}
          />
        )}
      </>
    );
  }

  // Default flow — deviceMode is "parent", unset, or was just cleared —
  // identical to Phase 1's original behavior.
  return (
    <App
      uid={user.uid}
      childId={selectedChild.id}
      childName={selectedChild.name}
      childEmoji={selectedChild.emoji}
      isAdmin={!!user.isAdmin}
      deviceMode={deviceMode}
      initialView={childEntryView}
      onSwitchChild={() => {
        setSelectedChild(null);
        setChildEntryView("home");
      }}
    />
  );
};

export default AuthShell;
