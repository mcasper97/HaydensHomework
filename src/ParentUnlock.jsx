import React, { useState } from "react";
import { verifyPin, getLockoutRemainingMs, hasPin } from "./data/parentPin.js";

/**
 * Parent Unlock — the local PIN gate for leaving a locked Child Mode
 * (Phase 1.5). This is a UX/navigation gate only, not real account
 * authentication — Firebase Authentication remains the actual security
 * boundary (see AuthShell.jsx). onUnlock() fires only after a correct PIN.
 * "Forgot PIN?" hands off to AuthShell's local-lock reset, which falls back
 * to normal Firebase sign-in rather than assuming any recovery mechanism.
 */
const ParentUnlock = ({ onUnlock, onCancel, onForgot }) => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  // Belt-and-suspenders: Child Mode should never be enabled without a PIN
  // already set (see AuthShell's DeviceModeSettings), so this should be
  // unreachable in practice — but if local storage ever ends up without one,
  // don't pretend a PIN prompt means anything; point straight at recovery.
  if (!hasPin()) {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl p-6 text-center" style={{ background: "#2a2a2c" }}>
          <h2 className="text-xl font-display text-white mb-2">No PIN set</h2>
          <p className="text-gray-400 text-sm mb-4">
            This device has no parent PIN on record. Use recovery to sign in normally.
          </p>
          <button
            onClick={onForgot}
            className="w-full font-extrabold py-3 rounded-2xl"
            style={{ background: "#A8FF3E", color: "#1C1C1E" }}
          >
            Continue to sign-in
          </button>
          <button onClick={onCancel} className="w-full text-gray-400 hover:text-white text-sm font-semibold mt-3">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (checking) return;

    const remaining = getLockoutRemainingMs();
    if (remaining > 0) {
      setError(`Too many attempts — try again in ${Math.ceil(remaining / 1000)}s.`);
      return;
    }

    setChecking(true);
    setError("");
    const ok = await verifyPin(pin);
    setChecking(false);

    if (ok) {
      onUnlock();
      return;
    }

    setPin("");
    const nowRemaining = getLockoutRemainingMs();
    setError(
      nowRemaining > 0
        ? `Incorrect PIN. Too many attempts — try again in ${Math.ceil(nowRemaining / 1000)}s.`
        : "Incorrect PIN."
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: "#2a2a2c" }}>
        <h2 className="text-xl font-display text-white mb-1">Parent Unlock</h2>
        <p className="text-gray-400 text-sm mb-4">Enter the parent PIN to continue.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="PIN"
            className="w-full rounded-2xl px-4 py-3 text-lg font-bold tracking-widest text-center focus:outline-none"
            style={{ background: "#1C1C1E", color: "white", border: "2px solid rgba(255,255,255,0.15)" }}
          />
          {error && <p className="text-red-300 text-sm font-semibold">{error}</p>}
          <button
            type="submit"
            disabled={checking || !pin}
            className="w-full font-extrabold py-3 rounded-2xl disabled:opacity-50"
            style={{ background: "#A8FF3E", color: "#1C1C1E" }}
          >
            {checking ? "Checking..." : "Unlock"}
          </button>
        </form>
        <div className="flex items-center justify-between mt-4">
          <button onClick={onCancel} className="text-gray-400 hover:text-white text-sm font-semibold">
            Cancel
          </button>
          <button onClick={onForgot} className="text-purple-300 hover:text-white text-sm font-semibold">
            Forgot PIN?
          </button>
        </div>
      </div>
    </div>
  );
};

export default ParentUnlock;
