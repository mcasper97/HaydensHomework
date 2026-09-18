/**
 * Unit tests for src/data/parentToolsPreference.js (#Commit 4.2 — Parent
 * Tools open/closed state survives a page refresh for a real authenticated
 * parent).
 *
 * Plain Node has no real `localStorage` global (that's a browser API), so
 * — consistent with deviceMode.js/parentPin.js, which have no unit tests
 * for the same reason — this file does NOT and CANNOT prove actual
 * cross-reload persistence; only a real browser can do that. What it does
 * prove: the module never throws without a real localStorage (fails
 * closed to "not open" rather than crashing the Parent Page), is scoped
 * per uid, and returns false for a missing/falsy uid rather than reading
 * some unscoped global key. The real persistence behavior (items 1-4 of
 * the work package) needs live/manual verification in a real browser with
 * a real authenticated Firebase user — the same standing limitation
 * already disclosed throughout this project for anything requiring a live
 * Firebase project.
 *
 * Usage: node tests/parent-tools-preference.unit.mjs
 */
import { getParentToolsOpen, setParentToolsOpen } from "../src/data/parentToolsPreference.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

ok("localStorage is not a real browser API in this Node test run (sanity check the test's own premise)", typeof localStorage === "undefined");

// ============ Fails closed without a real localStorage ============
ok("getParentToolsOpen does not throw without a real localStorage", (() => {
  try { getParentToolsOpen("uid-1"); return true; } catch { return false; }
})());
ok("getParentToolsOpen returns false (not open) without a real localStorage", getParentToolsOpen("uid-1") === false);
ok("setParentToolsOpen(true) does not throw without a real localStorage", (() => {
  try { setParentToolsOpen("uid-1", true); return true; } catch { return false; }
})());
ok("setParentToolsOpen(false) does not throw without a real localStorage", (() => {
  try { setParentToolsOpen("uid-1", false); return true; } catch { return false; }
})());

// ============ Fails closed on a missing/falsy uid ============
ok("getParentToolsOpen returns false for an undefined uid, without throwing", getParentToolsOpen(undefined) === false);
ok("getParentToolsOpen returns false for a null uid, without throwing", getParentToolsOpen(null) === false);
ok("getParentToolsOpen returns false for an empty-string uid, without throwing", getParentToolsOpen("") === false);
ok("setParentToolsOpen no-ops (doesn't throw) for an undefined uid", (() => {
  try { setParentToolsOpen(undefined, true); return true; } catch { return false; }
})());

// ============ In an environment WITH a fake localStorage (simulating a real browser) ============
{
  // Minimal in-memory fake mirroring the Web Storage API surface this
  // module actually calls (getItem/setItem/removeItem) — installed as a
  // real global for this block only, then torn down, so it doesn't leak
  // into the "no localStorage" tests above/below.
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  ok("With a real localStorage: a uid with nothing stored yet reads as closed", getParentToolsOpen("uid-a") === false);

  setParentToolsOpen("uid-a", true);
  ok("Setting open persists true for that uid", getParentToolsOpen("uid-a") === true);

  setParentToolsOpen("uid-a", false);
  ok("Setting closed persists false for that uid", getParentToolsOpen("uid-a") === false);
  ok("Setting closed removes the key entirely rather than storing a literal \"false\" (no orphaned entries)", store.get("parentToolsOpen:uid-a") === undefined);

  // uid scoping — two different parents on the same device/browser must
  // never see each other's preference.
  setParentToolsOpen("uid-b", true);
  ok("A different uid's open state doesn't affect uid-a", getParentToolsOpen("uid-a") === false);
  ok("uid-b's own open state is stored correctly", getParentToolsOpen("uid-b") === true);
  ok("The storage key is scoped by uid, exactly as specified (parentToolsOpen:<uid>)", store.has("parentToolsOpen:uid-b") && !store.has("parentToolsOpen:uid-a"));

  delete global.localStorage;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
