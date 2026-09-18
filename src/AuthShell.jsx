import React, { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, getDoc, setDoc, arrayUnion } from "firebase/firestore";
import { auth, googleProvider, db } from "./Firebase.js";
import App from "./App.jsx";
import FamilyBoard from "./FamilyBoard.jsx";
import ParentUnlock from "./ParentUnlock.jsx";
import {
  getDeviceMode,
  setDeviceMode as persistDeviceMode,
  getLockedChildId,
  setLockedChildId as persistLockedChildId,
  resetDeviceLock,
  getRecoveryPending,
  setRecoveryPending as persistRecoveryPending,
} from "./deviceMode.js";
import { hasPin, setPin as savePin } from "./data/parentPin.js";
import { fetchGmailStatus, startGmailConnect, disconnectGmail } from "./data/gmailConnection.js";

const CHILD_EMOJIS = ["🦁", "🐯", "🐺", "🦊", "🐻", "🐼", "🦄", "🐲", "🚀", "⭐", "🌈", "🔥"];

// Local-only guest/demo profile — NOT a privilege level and NOT tied to any
// real household's Firestore data. `isAdmin` here just means "use the
// crestly_admin_* localStorage keys instead of Firestore" (see ChildSelector
// and FamilyBoard below); the name is kept only so existing local demo data
// under those keys keeps working. Entry no longer requires (or checks) any
// credential — see the "Continue without an account" button in LandingPage.
const GUEST_USER = { uid: "guest-local", email: "Guest", displayName: "Guest", isAdmin: true };

/* ─────────────────────── Device Mode settings (Phase 1.5) ───────────────────────
 * Lives on the Parent Page (ChildSelector). Local to this browser/device only —
 * never creates a backend record (see deviceMode.js). Locking to a child requires
 * a parent PIN to already exist; if none does, this walks the parent through
 * setting one before the lock takes effect (Phase 1.5 requirement: Child Mode
 * must never be enabled without a PIN).
 */
const DeviceModeSettings = ({ children, deviceMode, onSetDeviceMode, onLockChild }) => {
  const [pinSetupFor, setPinSetupFor] = useState(null); // child object mid-PIN-setup, or null
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinError, setPinError] = useState("");
  const [saving, setSaving] = useState(false);

  const startLock = (child) => {
    if (!hasPin()) {
      setPinSetupFor(child);
      setPin1("");
      setPin2("");
      setPinError("");
      return;
    }
    onLockChild(child);
  };

  const confirmPinSetup = async () => {
    if (pin1.length < 4) {
      setPinError("PIN must be at least 4 digits.");
      return;
    }
    if (pin1 !== pin2) {
      setPinError("PINs don't match.");
      return;
    }
    setSaving(true);
    await savePin(pin1);
    setSaving(false);
    const child = pinSetupFor;
    setPinSetupFor(null);
    onLockChild(child);
  };

  return (
    <div className="mt-8 pt-6 border-t border-gray-800">
      <h3 className="text-white font-display text-lg mb-1">Device Mode</h3>
      <p className="text-gray-500 text-xs mb-3">
        A setting for this device/browser only — it doesn't change anything for other family members or devices.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => onSetDeviceMode("parent")}
          className={`px-4 py-2 rounded-full text-sm font-bold border transition ${
            deviceMode === "parent" || !deviceMode ? "bg-white text-gray-900 border-white" : "text-gray-300 border-gray-700 hover:border-gray-500"
          }`}
        >
          👤 Parent device
        </button>
        <button
          onClick={() => onSetDeviceMode("organizer")}
          className={`px-4 py-2 rounded-full text-sm font-bold border transition ${
            deviceMode === "organizer" ? "bg-white text-gray-900 border-white" : "text-gray-300 border-gray-700 hover:border-gray-500"
          }`}
        >
          🖥️ Organizer display
        </button>
      </div>

      {children.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {children.map((c) => (
            <button
              key={c.id}
              onClick={() => startLock(c)}
              className="px-4 py-2 rounded-full text-sm font-bold border text-gray-300 border-gray-700 hover:border-gray-500 transition"
            >
              🔒 Lock to {c.emoji} {c.name}
            </button>
          ))}
        </div>
      )}

      {pinSetupFor && (
        <div className="mt-4 rounded-2xl p-5 border border-gray-700" style={{ background: "#2a2a2c" }}>
          <p className="text-white font-semibold mb-3">Set a parent PIN before locking this device to {pinSetupFor.name}.</p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin1}
            onChange={(e) => setPin1(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="New PIN (4+ digits)"
            className="w-full rounded-2xl px-4 py-2 mb-2 font-bold tracking-widest text-center focus:outline-none"
            style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
          />
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="Confirm PIN"
            className="w-full rounded-2xl px-4 py-2 mb-3 font-bold tracking-widest text-center focus:outline-none"
            style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
          />
          {pinError && <p className="text-red-300 text-sm font-semibold mb-2">{pinError}</p>}
          <div className="flex gap-2">
            <button
              onClick={confirmPinSetup}
              disabled={saving}
              className="flex-1 font-extrabold py-2 rounded-2xl disabled:opacity-50"
              style={{ background: "#A8FF3E", color: "#1C1C1E" }}
            >
              {saving ? "Saving..." : "Set PIN & Lock"}
            </button>
            <button
              onClick={() => setPinSetupFor(null)}
              className="px-4 py-2 rounded-2xl font-extrabold text-gray-400 hover:text-white border border-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {deviceMode === "child" && <p className="text-gray-500 text-xs mt-3">This device is currently locked to Child Mode.</p>}
    </div>
  );
};

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

/* ─────────────────────── Landing Page ─────────────────────── */
const LandingPage = ({ onSignIn, onEmailSignIn, onGuestEnter, loading, emailLoading, googleError }) => {
  const [mode, setMode] = useState("main"); // main | email
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState("");

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const result = await onEmailSignIn(email, password, isNew);
    if (result?.error) setError(result.error);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "#1C1C1E" }}>
      <div className="w-full max-w-md text-center">
        {/* Brand */}
        <div className="mb-8">
          <div className="text-7xl mb-4">🏔️</div>
          <h1 className="text-6xl font-display text-white mb-2">Crestly</h1>
          <p className="text-xl font-semibold" style={{ color: "#A8FF3E" }}>Rise. Learn. Conquer.</p>
          <p className="text-gray-400 mt-3 text-sm">The learning app that keeps up with your child's classroom.</p>
        </div>

        {mode === "main" && (
          <div className="rounded-3xl p-8 shadow-2xl space-y-3" style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}>
            <h2 className="text-2xl font-display text-white mb-4">Parent Sign In</h2>

            {/* Google */}
            <button
              onClick={onSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 font-extrabold py-4 px-6 rounded-2xl transition disabled:opacity-50"
            >
              {loading ? (
                <span className="animate-pulse">Redirecting to Google...</span>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 48 48">
                    <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.7 0 19.5-8.8 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"/>
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4.5 24 4.5c-7.7 0-14.3 4.4-17.7 10.2z"/>
                    <path fill="#4CAF50" d="M24 43.5c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35 26.8 36 24 36c-5.2 0-9.6-3-11.4-7.3l-6.5 5C9.7 39.1 16.4 43.5 24 43.5z"/>
                    <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.2 5.2c3.8-3.5 6.2-8.7 6.2-14.8 0-1.2-.1-2.3-.4-3.5z"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>
            {googleError && (
              <div className="bg-red-900 bg-opacity-50 text-red-200 rounded-2xl px-4 py-3 text-sm font-semibold text-left">
                ⚠️ {googleError}
              </div>
            )}

            {/* Email */}
            <button
              onClick={() => { setMode("email"); setError(""); }}
              className="w-full flex items-center justify-center gap-2 font-extrabold py-4 px-6 rounded-2xl transition text-white"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              ✉️ Sign in with Email
            </button>

            {/* Guest / local-demo entry — no credential, clearly scoped */}
            <button
              onClick={onGuestEnter}
              className="w-full text-purple-300 hover:text-white text-sm font-semibold py-2 transition"
            >
              Continue without an account (this device only)
            </button>
          </div>
        )}

        {mode === "email" && (
          <div className="rounded-3xl p-8 shadow-2xl" style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}>
            <h2 className="text-2xl font-display text-white mb-6">{isNew ? "Create Account" : "Sign In"}</h2>
            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full rounded-2xl px-4 py-3 text-lg font-semibold focus:outline-none"
                style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-2xl px-4 py-3 text-lg font-semibold focus:outline-none"
                style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
              />
              {error && <p className="text-red-300 text-sm font-semibold">{error}</p>}
              <button
                type="submit"
                disabled={emailLoading}
                className="w-full font-extrabold py-4 rounded-2xl transition disabled:opacity-50"
                style={{ background: "#A8FF3E", color: "#1C1C1E" }}
              >
                {emailLoading ? "Loading..." : isNew ? "Create Account" : "Sign In"}
              </button>
            </form>
            <button
              onClick={() => { setIsNew(v => !v); setError(""); }}
              className="w-full text-purple-200 hover:text-white text-sm font-semibold mt-3"
            >
              {isNew ? "Already have an account? Sign in" : "No account? Create one"}
            </button>
            <button onClick={() => { setMode("main"); setError(""); }} className="w-full text-purple-300 hover:text-white text-sm mt-2">
              ← Back
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

/* ─────────────────────── Gmail Connection panel (Parent Tools only) ───────────────────────
 * Connection-only for now (#26, Commit 3): shows Connected / Disconnected /
 * Reconnect-required status and lets a parent start or end a Gmail
 * connection. No mail is read here — that's a later, separately-approved
 * commit. Deliberately rendered only from within ChildSelector's Parent
 * Tools panel (see below), never on Family Board or any child-facing page.
 */
const GmailConnectionPanel = () => {
  const [status, setStatus] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGmailStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ connected: false, emailAddress: null, needsReconnect: false, connectedAt: null }); });
    return () => { cancelled = true; };
  }, []);

  const handleConnect = async () => {
    setError("");
    setBusy(true);
    try {
      await startGmailConnect(); // navigates away on success — no further state update needed
    } catch (e) {
      setError(e.message || "Could not start Gmail connection.");
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setError("");
    setBusy(true);
    try {
      await disconnectGmail();
      setStatus({ connected: false, emailAddress: null, needsReconnect: false, connectedAt: null });
    } catch (e) {
      setError(e.message || "Could not disconnect Gmail.");
    } finally {
      setBusy(false);
    }
  };

  const buttonStyle = {
    background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)",
  };

  return (
    <div data-testid="gmail-connection-panel" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
      <h3 className="text-white font-display text-lg mb-1">Gmail</h3>
      {status === null ? (
        <p className="text-gray-400 text-sm">Checking connection…</p>
      ) : status.needsReconnect ? (
        <>
          <p className="text-yellow-400 text-sm mb-3">Reconnect needed — Gmail access has expired.</p>
          <button
            onClick={handleConnect}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={buttonStyle}
          >
            Reconnect Gmail
          </button>
        </>
      ) : status.connected ? (
        <>
          <p className="text-gray-400 text-sm mb-3">
            Connected as <span className="text-white font-semibold">{status.emailAddress || "unknown address"}</span>
          </p>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50 border border-gray-600"
            style={{ background: "#1C1C1E" }}
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="text-gray-400 text-sm mb-3">Connect Gmail to import school emails (coming soon).</p>
          <button
            onClick={handleConnect}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={buttonStyle}
          >
            Connect Gmail
          </button>
        </>
      )}
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
    </div>
  );
};

/* ─────────────────────── Child Selector ─────────────────────── */
const ChildSelector = ({
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
  const [showParentTools, setShowParentTools] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🦁");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Family last name — shown as "{name} Family Board" on this page's button and
  // on the board itself. Stored on the same users/{uid} doc the board reads.
  const [familyLastName, setFamilyLastName] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    // Shared tail: resolve the loaded child list, then either auto-forward into
    // a locked Child Mode device's child (Phase 1.5 — "returns to the locked
    // child after reload") or fall through to showing the normal picker.
    // Staying in `loading` (not calling setLoading(false)) while forwarding
    // avoids a one-frame flash of the picker before AuthShell stops rendering
    // this component at all.
    const finish = (list, famName) => {
      setChildren(list);
      setFamilyLastName(famName);
      setLastNameInput(famName);
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
      finish(saved ? JSON.parse(saved) : [], savedName);
      return;
    }
    if (!db) { setLoading(false); return; }
    const profileRef = doc(db, "users", user.uid);
    getDoc(profileRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        finish(data.children || [], data.familyLastName || "");
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "#1C1C1E" }}>
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display text-white">Parent Page</h1>
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
          className="w-full flex items-center gap-3 p-4 rounded-2xl mb-3 transition hover:opacity-90 font-extrabold text-white"
          style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
        >
          <span className="text-2xl">📅</span> {boardLabel}
        </button>

        {/* Parent-only entry point into admin/import functionality. Deliberately
            kept off Family Board / Shared Display and off every child-facing
            page — those are execution-only surfaces (view + mark-complete),
            never import/edit/delete/source-management/AI-review/household
            config. This is the one place a parent reaches Import from.
            Labeled "Parent Tools" rather than "Organizer" — it doesn't open
            the Organizer (that's still the Family Board button above); it
            opens a learner picker leading to that child's management/import
            page. */}
        <button
          onClick={() => setShowParentTools((v) => !v)}
          className="w-full flex items-center gap-3 p-4 rounded-2xl mb-6 transition hover:opacity-90 font-extrabold text-white"
          style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}
        >
          <span className="text-2xl">🗂️</span> Parent Tools
        </button>

        {showParentTools && onOpenChildImport && (
          <div data-testid="parent-organizer-panel" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
            <h3 className="text-white font-display text-lg mb-1">Import from Photo / CSV</h3>
            <p className="text-gray-400 text-sm mb-4">
              Pull homework details from a photo or spreadsheet into a learner's organizer.
            </p>
            {children.length === 0 ? (
              <p className="text-gray-400 text-sm">Add a learner first to import for them.</p>
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

        {/* Gmail connection status only — no mail reading in this commit. Gated
            on a real Firebase-authenticated parent: guest/local mode has no
            account to attach a Gmail connection to (see api/_auth.js and
            GUEST_USER above), so no working controls are shown there and the
            server independently fails closed on every Gmail endpoint anyway. */}
        {showParentTools && !user.isAdmin && <GmailConnectionPanel />}

        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3 animate-pulse">⭐</div>
            <p className="text-gray-400">Loading...</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-4">
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

            {showAdd ? (
              <div className="rounded-3xl p-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
                <h3 className="text-white font-display text-xl mb-4">Add a learner</h3>
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

            {/* Family name — feeds the "{name} Family Board" label on the button above and on the board itself */}
            <div className="mt-8 pt-6 border-t border-gray-800">
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
                  className="text-gray-500 hover:text-gray-300 text-sm font-semibold transition"
                >
                  {familyLastName ? `Family name: ${familyLastName} (edit)` : "+ Set your family name"}
                </button>
              )}
            </div>

            <DeviceModeSettings
              children={children}
              deviceMode={deviceMode}
              onSetDeviceMode={onSetDeviceMode}
              onLockChild={onLockChild}
            />
          </>
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
  // the Parent Page's "Parent Tools" -> Import panel (handleOpenChildImport
  // below) so that link lands directly on the Parents Page instead of the
  // child's game Home. Deliberately NOT
  // reachable from Family Board / Shared Display or any child-facing
  // page — import/admin functionality only ever originates from this
  // authenticated Parent Page screen (see ChildSelector below).
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
  // and the isAdmin-gated localStorage branches in ChildSelector/FamilyBoard).
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

  // Called only from the Parent Page's "Parent Tools" panel (see
  // ChildSelector below) — never from Family Board / Shared Display or any
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

  // Called from Parent Page's Device Mode settings. A PIN must already exist
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
          <p className="text-gray-400 font-display text-xl">Crestly</p>
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
    // ChildSelector auto-forwards into the locked child (deviceMode==="child")
    // once it finishes loading, unless parentUnlockedView === "switch" is
    // temporarily showing the picker after a successful Parent Unlock.
    return (
      <ChildSelector
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
