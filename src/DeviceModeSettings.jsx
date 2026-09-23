import React, { useState } from "react";
import { hasPin, setPin as savePin } from "./data/parentPin.js";

/* ─────────────────────── Device Mode settings (Phase 1.5) ───────────────────────
 * Moved verbatim out of AuthShell.jsx (UI/IA refactor) — now lives in
 * Settings' Account/Access section instead of inline on the Parent page.
 * No behavior change. Local to this browser/device only — never creates a
 * backend record (see deviceMode.js). Locking to a child requires a parent
 * PIN to already exist; if none does, this walks the parent through
 * setting one before the lock takes effect (Phase 1.5 requirement: Child
 * Mode must never be enabled without a PIN).
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

export default DeviceModeSettings;
