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

const CHILD_EMOJIS = ["🦁", "🐯", "🐺", "🦊", "🐻", "🐼", "🦄", "🐲", "🚀", "⭐", "🌈", "🔥"];

// Hardcoded admin bypass — no Firebase needed
const ADMIN_USER = { uid: "admin-bypass", email: "Admin", displayName: "Admin", isAdmin: true };

// UID for the unattended wall-tablet board route (?board=1). Set in .env.local
// for local dev and in your Vercel project's Environment Variables for prod —
// see .env.local.example. This is NOT a secret on its own, but it identifies
// the exact Firestore path the board route reads/writes without signing in,
// so treat it with the same care as the security-rules note in firestore.rules.
const FAMILY_UID = import.meta.env.VITE_FAMILY_UID;

/* ─────────────────────── Landing Page ─────────────────────── */
const LandingPage = ({ onSignIn, onEmailSignIn, loading, emailLoading, googleError }) => {
  const [mode, setMode] = useState("main"); // main | email | admin
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [error, setError] = useState("");

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const result = await onEmailSignIn(email, password, isNew);
    if (result?.error) setError(result.error);
  };

  const handleAdminSubmit = (e) => {
    e.preventDefault();
    if (adminUser.toLowerCase() === "admin" && adminPass.toLowerCase() === "admin") {
      onEmailSignIn("__admin__", "__admin__", false);
    } else {
      setError("Incorrect username or password.");
    }
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

            {/* Admin bypass */}
            <button
              onClick={() => { setMode("admin"); setError(""); }}
              className="w-full text-purple-300 hover:text-white text-sm font-semibold py-2 transition"
            >
              Admin login
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

        {mode === "admin" && (
          <div className="rounded-3xl p-8 shadow-2xl" style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}>
            <h2 className="text-2xl font-display text-white mb-6">Admin Access</h2>
            <form onSubmit={handleAdminSubmit} className="space-y-3">
              <input
                type="text"
                placeholder="Username"
                value={adminUser}
                onChange={e => setAdminUser(e.target.value)}
                autoFocus
                className="w-full rounded-2xl px-4 py-3 text-lg font-semibold focus:outline-none"
                style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
              />
              <input
                type="password"
                placeholder="Password"
                value={adminPass}
                onChange={e => setAdminPass(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-lg font-semibold focus:outline-none"
                style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
              />
              {error && <p className="text-red-300 text-sm font-semibold">{error}</p>}
              <button
                type="submit"
                className="w-full font-extrabold py-4 rounded-2xl transition"
                style={{ background: "#A8FF3E", color: "#1C1C1E" }}
              >
                Enter
              </button>
            </form>
            <button onClick={() => { setMode("main"); setError(""); }} className="w-full text-purple-300 hover:text-white text-sm mt-3">
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────── Child Selector ─────────────────────── */
const ChildSelector = ({ user, onSelectChild, onSignOut, onOpenCalendar }) => {
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
    const profileRef = doc(db, "users", user.uid);
    getDoc(profileRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setChildren(data.children || []);
        setFamilyLastName(data.familyLastName || "");
        setLastNameInput(data.familyLastName || "");
      }
      setLoading(false);
    }).catch(() => setLoading(false));
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

  // Read once at mount — this doesn't change during the session.
  const [isBoardRoute] = useState(
    () => new URLSearchParams(window.location.search).get("board") === "1"
  );

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
    // Admin bypass
    if (email === "__admin__" && password === "__admin__") {
      setUser(ADMIN_USER);
      return {};
    }

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

  // ── Unattended wall-tablet board route: ?board=1 bypasses sign-in entirely. ──
  // Checked before the auth listener's result matters, so a tablet that's never
  // signed in still shows the board instead of the login screen.
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
        onSelectChild={setSelectedChild}
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
      onSwitchChild={() => setSelectedChild(null)}
    />
  );
};

export default AuthShell;
