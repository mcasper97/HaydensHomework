import React, { useState } from "react";

/* ─────────────────────── Landing Page ───────────────────────
 * Unauthenticated entry point. Extracted from AuthShell.jsx (UI/IA
 * refactor) with no behavior change — same props, same sign-in handlers,
 * same guest entry, same email/password flow. Only the branding/copy and
 * file location changed: "Crestly" → "Haydens - Homework", plus a short
 * value-proposition line. Deliberately does not render Parent Tools,
 * Organizer data, child data, or any household/integration settings.
 */
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
          <h1 className="text-5xl font-display text-white mb-3">Haydens - Homework</h1>
          <p className="text-gray-300 text-lg">
            Keep school, activities, chores, and family responsibilities organized in one place.
          </p>
        </div>

        {mode === "main" && (
          <div className="rounded-3xl p-8 shadow-2xl space-y-3" style={{ background: "linear-gradient(135deg, #5B2D8E, #3d1d61)" }}>
            <h2 className="text-2xl font-display text-white mb-4">Sign In</h2>

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

export default LandingPage;
