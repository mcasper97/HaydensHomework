import React, { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, getDoc, setDoc, arrayUnion, onSnapshot } from "firebase/firestore";
import { auth, googleProvider, db } from "./Firebase.js";
import App from "./App.jsx";
import FamilyBoard from "./FamilyBoard.jsx";

const CHILD_EMOJIS = ["🦁", "🐯", "🐺", "🦊", "🐻", "🐼", "🦄", "🐲", "🚀", "⭐", "🌈", "🔥"];

// Local-only guest/demo profile — NOT a privilege level and NOT tied to any
// real household's Firestore data. `isAdmin` here just means "use the
// crestly_admin_* localStorage keys instead of Firestore" (see ChildSelector
// and FamilyBoard below); it predates this remediation and the name is kept
// only so existing local demo data under those keys keeps working. Entry no
// longer requires (or checks) any credential — see the "Continue without an
// account" button in LandingPage.
const GUEST_USER = { uid: "guest-local", email: "Guest", displayName: "Guest", isAdmin: true };

// UID for the unattended wall-tablet board route (?board=1). Set in .env.local
// for local dev and in your Vercel project's Environment Variables for prod —
// see .env.local.example.
//
// SECURITY NOTE (Phase 0 remediation): this env var is no longer used to log
// anyone into the app (see AuthShell below — real Firebase Auth is now the
// only way in). It is still read here for the board route, but firestore.rules
// no longer grants unauthenticated access to this UID's data, so the board
// route will currently show a permission-denied error until a properly
// authenticated (or shared-secret-via-server) kiosk mechanism is designed.
// That redesign is out of scope for this security pass — see the remediation
// report.
const FAMILY_UID = import.meta.env.VITE_FAMILY_UID;

/* ─────────────────────── Landing Page ───────────────────────
   Real sign-in (Google + email/password), plus an explicit, no-credential
   "Continue without an account" guest path — see Phase 0 security
   remediation notes. This is now the only way into the app; there is no
   splash-page bypass and no hardcoded credential check. */
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

/* ─────────────────────── Child Selector ─────────────────────── */
const ChildSelector = ({ user, onSelectChild, onOpenChildParents, onSignOut, onOpenCalendar }) => {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
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
    // Admin bypass — use localStorage for child list
    if (user.isAdmin) {
      const saved = localStorage.getItem("crestly_admin_children");
      setChildren(saved ? JSON.parse(saved) : []);
      const savedName = localStorage.getItem("crestly_admin_family_name") || "";
      setFamilyLastName(savedName);
      setLastNameInput(savedName);
      setLoading(false);
      return;
    }
    if (!db) { setLoading(false); return; }
    // Live listener (not a one-time fetch) so renames made from a learner's
    // own Parent's Page — see App.jsx's renderParentsPage — show up here
    // immediately when you navigate back, without needing a refresh.
    const profileRef = doc(db, "users", user.uid);
    const unsub = onSnapshot(profileRef, snap => {
      if (snap.exists()) {
        const data = snap.data();
        setChildren(data.children || []);
        setFamilyLastName(data.familyLastName || "");
        setLastNameInput(data.familyLastName || "");
      }
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user]);

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
          className="w-full flex items-center gap-3 p-4 rounded-2xl mb-6 transition hover:opacity-90 font-extrabold text-white"
          style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
        >
          <span className="text-2xl">📅</span> {boardLabel}
        </button>

        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3 animate-pulse">⭐</div>
            <p className="text-gray-400">Loading...</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              {children.map(child => (
                <div key={child.id} className="flex gap-3">
                  <button
                    onClick={() => onOpenChildParents(child)}
                    className="flex items-center justify-center text-center p-5 rounded-3xl transition hover:opacity-90 font-display text-white text-sm leading-snug"
                    style={{ background: "#2a2a2c", border: "1px solid #3d3d40", flex: "1 1 0%" }}
                  >
                    {child.name}'s Parent's Page
                  </button>
                  <button
                    onClick={() => onSelectChild(child)}
                    className="flex items-center gap-4 p-5 rounded-3xl text-left transition hover:opacity-90 min-w-0"
                    style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)", flex: "3 1 0%" }}
                  >
                    <span className="text-3xl flex-shrink-0">{child.emoji}</span>
                    <div className="min-w-0">
                      <div className="text-base font-display text-white leading-snug">To {child.name}'s Page</div>
                      <div className="text-purple-300 text-xs">Tap to start learning</div>
                    </div>
                    <div className="ml-auto text-white text-xl flex-shrink-0">→</div>
                  </button>
                </div>
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
  // When a child was reached via "{name}'s Parent's Page" (as opposed to
  // "To {name}'s Page"), App.jsx opens straight into that learner's Parent's
  // Page instead of their adventure home screen — see the `parentsOnly` prop
  // passed to <App> below.
  const [childParentsOnly, setChildParentsOnly] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  // Read once at mount — this doesn't change during the session.
  const [isBoardRoute] = useState(
    () => new URLSearchParams(window.location.search).get("board") === "1"
  );

  useEffect(() => {
    if (!auth) { setUser(null); return; }
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u ?? null);
      if (!u) { setSelectedChild(null); setChildParentsOnly(false); }
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
    setChildParentsOnly(false);
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

  // ── Unattended wall-tablet board route: ?board=1. ──
  // Checked before the auth listener's result matters, so a tablet that's never
  // signed in still shows the board instead of the login screen.
  //
  // SECURITY NOTE (Phase 0 remediation): this route intentionally does not
  // sign the visitor in, so it cannot rely on Firestore's per-user auth
  // rules. firestore.rules no longer contains an unauthenticated exception
  // for this path, so the board will show its existing permission-denied
  // state until a secure kiosk-auth mechanism (e.g. a server-side proxy
  // checking a shared secret, or real device auth) is designed. Left in
  // place rather than removed so an already-deployed tablet fails closed
  // with a clear on-screen message instead of a blank/broken page.
  if (isBoardRoute) {
    if (!FAMILY_UID) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#1C1C1E" }}>
          <div className="text-center max-w-md">
            <div className="text-5xl mb-4">⚠️</div>
            <p className="text-white font-display text-xl mb-2">Board not configured</p>
            <p className="text-gray-400 text-sm">
              Set VITE_FAMILY_UID (see .env.local.example) to the parent account's Firebase UID,
              then rebuild/redeploy.
            </p>
          </div>
        </div>
      );
    }
    return <FamilyBoard uid={FAMILY_UID} kiosk />;
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
    return (
      <ChildSelector
        user={user}
        onSelectChild={child => { setChildParentsOnly(false); setSelectedChild(child); }}
        onOpenChildParents={child => { setChildParentsOnly(true); setSelectedChild(child); }}
        onSignOut={handleSignOut}
        onOpenCalendar={() => setShowCalendar(true)}
      />
    );
  }

  return (
    <App
      uid={user.uid}
      childId={selectedChild.id}
      childName={selectedChild.name}
      childEmoji={selectedChild.emoji}
      parentsOnly={childParentsOnly}
      onSwitchChild={() => { setSelectedChild(null); setChildParentsOnly(false); }}
    />
  );
};

export default AuthShell;
