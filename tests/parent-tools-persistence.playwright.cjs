/**
 * Focused regression test for Commit 4.2 — Parent Tools open/closed state
 * survives a page refresh for a real authenticated parent, via a small
 * localStorage-backed preference (see src/data/parentToolsPreference.js),
 * scoped to that parent's uid.
 *
 * Exercises the guest/local-demo path only (no live Firebase project
 * available in this environment). Guest mode is deliberately EXCLUDED from
 * the new persistence mechanism — its Parent Tools state must remain
 * exactly as it always was: in-memory only, closed again on every reload.
 * This file proves that guest behavior is unchanged (work package item 7)
 * and that Family Board / a child page never expose Parent Tools (items 5
 * and 6). Verifying the actual persistence for a real authenticated parent
 * (items 1-4: open survives reload, close survives reload) needs a live
 * Firebase project and a real signed-in account, which this sandbox does
 * not have — see tests/parent-tools-preference.unit.mjs for the underlying
 * storage mechanism's coverage, and the completion report's disclosed
 * limitation for what still needs live/manual verification.
 *
 * Usage:
 *   npm run dev                                              # in one terminal
 *   node tests/parent-tools-persistence.playwright.cjs        # in another
 *
 * Env vars:
 *   TEST_BASE_URL            — dev server URL (default http://127.0.0.1:5173)
 *   PLAYWRIGHT_CHROMIUM_PATH — explicit chromium binary path (optional)
 */
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

(async () => {
  const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  const visible = async (text) => page.getByText(text).first().isVisible().catch(() => false);
  const anyParentToolsKeys = () =>
    page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('parentToolsOpen:')));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');

  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');

  // ============ Item 1: Parent Tools opens normally ============
  ok('Import panel is not visible before opening Parent Tools', !(await visible('Import from Photo / CSV')));
  await page.getByText('Parent Tools').click();
  ok('Clicking Parent Tools reveals its panel', await visible('Import from Photo / CSV'));

  // ============ Item 7 (part 1): guest mode never writes a persistence key ============
  ok('Guest mode does not write any parentToolsOpen:<uid> key when opened', (await anyParentToolsKeys()).length === 0);

  // ============ Item 7 (part 2): guest mode's open state does NOT survive reload (unchanged from before this work package) ============
  // Guest is a local-only, in-memory session (never persisted anywhere —
  // see GUEST_USER in AuthShell.jsx), so a reload always returns to the
  // landing screen regardless of this work package; re-entering guest mode
  // and confirming Parent Tools starts closed again is the correct,
  // unchanged pre-existing behavior to verify here.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');
  ok('After reload (guest re-entered), Parent Tools panel is collapsed again (pre-existing behavior, unchanged)', !(await visible('Import from Photo / CSV')));
  ok('The "Parent Tools" button itself is still present after reload', await visible('Parent Tools'));

  // Reopen for the next checks, then verify closing still leaves no persistence key and no state survives a further reload either.
  await page.getByText('Parent Tools').click();
  await page.waitForSelector('text=Import from Photo / CSV');
  await page.getByText('Parent Tools').click();
  ok('Clicking Parent Tools again collapses its panel', !(await visible('Import from Photo / CSV')));
  ok('Guest mode still writes no parentToolsOpen:<uid> key after closing', (await anyParentToolsKeys()).length === 0);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');
  ok('After reload following a close, guest mode remains closed (unchanged)', !(await visible('Import from Photo / CSV')));

  // ============ Item 5: Family Board does not expose Parent Tools ============
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board does not show a "Parent Tools" control', !(await page.getByText('Parent Tools').isVisible().catch(() => false)));
  ok('Family Board does not show the Import panel content either', !(await page.getByText('Import from Photo / CSV').isVisible().catch(() => false)));

  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Page', { timeout: 5000 }).catch(() => {});

  // ============ Item 6: a child page does not expose Parent Tools ============
  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Child\'s Home screen does not show a "Parent Tools" control', !(await page.getByText('Parent Tools').isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Child\'s (unlocked, execution-only) Parents Page view does not show a "Parent Tools" control', !(await page.getByText('Parent Tools').isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
