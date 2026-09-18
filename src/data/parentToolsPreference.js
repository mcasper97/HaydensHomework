/* ============================== Parent Tools open/closed preference ==============================
 * Device-local UI preference only — NOT household data, NOT an
 * authorization model, and never a Firestore setting. Remembers whether
 * the authenticated parent had the Parent Tools panel open on the Parent
 * Page, purely so a page refresh doesn't collapse it. Scoped per Firebase
 * uid so switching which parent is signed in on this browser never leaks
 * one parent's preference into another's view.
 *
 * Backed by localStorage only, same try/catch-wrapped best-effort pattern
 * as deviceMode.js. Deliberately never consulted for guest/local mode (see
 * AuthShell.jsx's ChildSelector) — guest's Parent Tools state stays
 * exactly as it always was: in-memory only, closed on every reload.
 */

function storageKey(uid) {
  return `parentToolsOpen:${uid}`;
}

export function getParentToolsOpen(uid) {
  if (!uid) return false;
  try {
    return localStorage.getItem(storageKey(uid)) === "true";
  } catch {
    return false;
  }
}

export function setParentToolsOpen(uid, isOpen) {
  if (!uid) return;
  try {
    if (isOpen) localStorage.setItem(storageKey(uid), "true");
    else localStorage.removeItem(storageKey(uid));
  } catch {
    // ignore — same best-effort behavior as the rest of the local-state paths
  }
}
