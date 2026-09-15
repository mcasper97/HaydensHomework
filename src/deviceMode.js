/* ============================== Device Mode ==============================
 * A lightweight, device-local UI/navigation preference — NOT an
 * authorization model. All three modes (parent/organizer/child) read and
 * write the exact same Firebase account, canonical items, child IDs,
 * chores, and progress data; device mode only decides what a given browser
 * shows by default and which controls it exposes. It never bypasses
 * Firebase Authentication — AuthShell still requires a real signed-in
 * `user` before any mode renders (see AuthShell.jsx).
 *
 * Backed by localStorage only. No backend record of "this device's mode"
 * is ever created (Phase 1.5 requirement).
 */

const DEVICE_MODE_KEY = "crestly_device_mode"; // "parent" | "organizer" | "child"
const LOCKED_CHILD_KEY = "crestly_locked_child_id";
const RECOVERY_PENDING_KEY = "crestly_recovery_pending";

const VALID_MODES = new Set(["parent", "organizer", "child"]);

export function getDeviceMode() {
  try {
    const v = localStorage.getItem(DEVICE_MODE_KEY);
    return VALID_MODES.has(v) ? v : null;
  } catch {
    return null;
  }
}

export function setDeviceMode(mode) {
  try {
    if (mode === null || mode === undefined) localStorage.removeItem(DEVICE_MODE_KEY);
    else if (VALID_MODES.has(mode)) localStorage.setItem(DEVICE_MODE_KEY, mode);
  } catch {
    // ignore — same best-effort behavior as the rest of the local-state paths
  }
}

export function getLockedChildId() {
  try {
    return localStorage.getItem(LOCKED_CHILD_KEY) || null;
  } catch {
    return null;
  }
}

export function setLockedChildId(childId) {
  try {
    if (!childId) localStorage.removeItem(LOCKED_CHILD_KEY);
    else localStorage.setItem(LOCKED_CHILD_KEY, childId);
  } catch {
    // ignore
  }
}

/**
 * Forgot-PIN / recovery reset: clears this device's local lock (mode +
 * locked child) so it falls back to normal sign-in / mode selection. Does
 * NOT touch the parent PIN itself (see data/parentPin.js's clearPin) and
 * NEVER touches Firestore/family data — this is purely local-device state.
 * Callers that want a full reset should call this AND parentPin.clearPin().
 */
export function resetDeviceLock() {
  setDeviceMode(null);
  setLockedChildId(null);
}

/**
 * Whether this device is mid Forgot-PIN recovery: "Forgot PIN?" was tapped
 * but no recovery action (reset PIN / switch to Parent Mode / choose another
 * child / return to Child Mode) has been taken yet. Persisted (not just
 * in-memory React state) specifically so that signing out — which a real
 * re-authentication naturally involves, and which may include a page reload
 * in between — never loses track of "recovery is still pending" and falls
 * back to silently re-entering the locked Child Mode instead of presenting
 * the recovery screen once the parent signs back in.
 */
export function getRecoveryPending() {
  try {
    return localStorage.getItem(RECOVERY_PENDING_KEY) === "true";
  } catch {
    return false;
  }
}

export function setRecoveryPending(pending) {
  try {
    if (pending) localStorage.setItem(RECOVERY_PENDING_KEY, "true");
    else localStorage.removeItem(RECOVERY_PENDING_KEY);
  } catch {
    // ignore
  }
}
