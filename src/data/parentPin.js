/* ============================== Parent PIN ==============================
 * A local UX/navigation gate for leaving a locked Child Mode — NOT real
 * account authentication. Firebase Authentication remains the actual
 * security boundary; this only decides whether *this browser* shows parent
 * controls again. Never stores the plaintext PIN: only a per-device random
 * salt and a SHA-256 hash of (salt + PIN), via the browser's built-in Web
 * Crypto API (no dependency). A device-local, modest exponential backoff
 * after repeated wrong guesses discourages continuous guessing — it is a
 * UX speed bump, not real rate limiting.
 */

const PIN_HASH_KEY = "crestly_parent_pin_hash";
const PIN_SALT_KEY = "crestly_parent_pin_salt";
const LOCKOUT_KEY = "crestly_parent_pin_lockout"; // { failCount, lockedUntil }

const ATTEMPTS_BEFORE_DELAY = 3;
const BASE_LOCKOUT_MS = 5000; // 5s, doubles per additional failure past the threshold
const MAX_LOCKOUT_MS = 60000; // capped at 60s — a speed bump, not a wall

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSaltHex(byteLength = 16) {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return bufToHex(arr.buffer);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(digest);
}

export function hasPin() {
  try {
    return !!localStorage.getItem(PIN_HASH_KEY);
  } catch {
    return false;
  }
}

export async function setPin(pin) {
  const salt = randomSaltHex();
  const hash = await sha256Hex(`${salt}:${pin}`);
  try {
    localStorage.setItem(PIN_SALT_KEY, salt);
    localStorage.setItem(PIN_HASH_KEY, hash);
    localStorage.removeItem(LOCKOUT_KEY);
  } catch {
    // ignore
  }
}

/** Clears the local PIN (never touches Firestore). Used by Forgot-PIN recovery. */
export function clearPin() {
  try {
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.removeItem(PIN_SALT_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  } catch {
    // ignore
  }
}

function readLockout() {
  try {
    const raw = localStorage.getItem(LOCKOUT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : { failCount: 0, lockedUntil: 0 };
  } catch {
    return { failCount: 0, lockedUntil: 0 };
  }
}

function writeLockout(state) {
  try {
    localStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

/** Milliseconds the caller must wait before the next verifyPin attempt is allowed (0 = try now). */
export function getLockoutRemainingMs() {
  return Math.max(0, readLockout().lockedUntil - Date.now());
}

/**
 * Verifies a PIN attempt. Returns false (without checking the hash) while
 * locked out. Never throws — a missing/corrupt PIN just fails to verify.
 */
export async function verifyPin(pin) {
  if (!hasPin()) return false;
  if (getLockoutRemainingMs() > 0) return false;

  const salt = localStorage.getItem(PIN_SALT_KEY) || "";
  const hash = localStorage.getItem(PIN_HASH_KEY) || "";
  const candidate = await sha256Hex(`${salt}:${pin}`);
  const ok = candidate === hash;

  const state = readLockout();
  if (ok) {
    writeLockout({ failCount: 0, lockedUntil: 0 });
  } else {
    const failCount = (state.failCount || 0) + 1;
    const lockedUntil =
      failCount >= ATTEMPTS_BEFORE_DELAY
        ? Date.now() + Math.min(BASE_LOCKOUT_MS * 2 ** (failCount - ATTEMPTS_BEFORE_DELAY), MAX_LOCKOUT_MS)
        : 0;
    writeLockout({ failCount, lockedUntil });
  }
  return ok;
}
