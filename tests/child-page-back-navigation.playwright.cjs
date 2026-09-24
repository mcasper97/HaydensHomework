/**
 * Focused regression test for #29 — "Back to Parent Page" navigation on a
 * child's Home screen (src/App.jsx renderHome).
 *
 * Root cause this covers: AuthShell.jsx already passed an `onSwitchChild`
 * callback into <App> on the normal (non-locked) parent-device flow — pure
 * navigation, resets AuthShell's selectedChild back to null so Board
 * Selector renders again, with no device-mode change, no sign-out, no data
 * write.
 *
 * History: an earlier UI cleanup removed Parent Home's direct
 * child-selection cards with no replacement, which made this normal,
 * unlocked Home entry temporarily unreachable through any UI action (a
 * disclosed finding at the time). A follow-up added "View Child" to
 * Settings' Children section to restore this. A later navigation refactor
 * (see src/BoardSelector.jsx, src/settings/ChildManagementSection.jsx)
 * removed "View Child" again — now redundant — because every current
 * learner has its own direct entry point on the Board Selector launcher,
 * reusing AuthShell.jsx's existing selectedChild/onSwitchChild/
 * handleSelectChild machinery verbatim (same function View Child, and the
 * cards before it, used to call). This file exercises that entry point.
 *
 * This test covers both required scenarios:
 *   1. normal parent-device flow: the control exists, works, and is safe
 *   2. locked Child Mode: no such control is exposed — PIN is still required
 *
 * Exercises the guest/local-demo path (no live Firebase project needed).
 *
 * Usage:
 *   npm run dev                                              # in one terminal
 *   node tests/child-page-back-navigation.playwright.cjs      # in another
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
  // A retrying visibility check (this suite has no @playwright/test's
  // `expect(locator).toBeVisible()` available — only plain `playwright` is
  // a project dependency — so this uses the equivalent auto-waiting
  // primitive plain Playwright already offers: Locator#waitFor). Used only
  // where a one-shot `visible()` check races a React re-render right after
  // a navigation (see the "Learners section" check below) — this is a
  // known, reproducible timing flake (confirmed to reproduce the same way
  // on a clean baseline with none of this session's changes applied), not
  // a product defect, so the fix is test-only.
  const visibleEventually = async (text, timeout = 3000) =>
    page.getByText(text).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
  const guestEnter = () => page.getByText('Continue without an account').click();
  const readChildren = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_children') || '[]'));
  const readDeviceMode = () => page.evaluate(() => localStorage.getItem('crestly_device_mode'));
  const selectAvaFromBoardSelector = async () => {
    await page.waitForSelector('text=Haydens - Homework');
    await page.getByTestId('board-learner').click();
    await page.waitForSelector('text=My Day', { timeout: 5000 });
  };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await guestEnter();
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ 1. Normal authenticated parent-device flow (via Board Selector's Learners section) ============
  const childrenBefore = await readChildren();
  const deviceModeBefore = await readDeviceMode();

  await selectAvaFromBoardSelector();
  ok('Normal flow: child Home shows a "Back to Parent Page" control', await visible('Back to Parent Page'));
  ok('Normal flow: child Home still shows the existing "Parents" control too (unchanged)', await page.getByRole('button', { name: /Parents/ }).isVisible());
  ok('Normal flow: the label is exactly "Back to Parent Page", not vague ("Back"/"Home"/"Exit")', await page.getByRole('button', { name: 'Back to Parent Page' }).isVisible());

  await page.getByRole('button', { name: 'Back to Parent Page' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 });
  ok('Clicking it returns to Board Selector', await visible('Haydens - Homework'));
  ok('Board Selector still shows the Learners section after returning', await visibleEventually('Learners'));

  const childrenAfter = await readChildren();
  const deviceModeAfter = await readDeviceMode();
  ok('Device mode is unchanged by this navigation', deviceModeBefore === deviceModeAfter);
  ok('Not logged out — still in the same guest session, not back at sign-in', !(await visible('Sign In')));
  ok('Child data is unaltered by this navigation', JSON.stringify(childrenBefore) === JSON.stringify(childrenAfter));

  // Re-enter and confirm the round trip is repeatable (not a one-shot control).
  await selectAvaFromBoardSelector();
  ok('Control is present again on a fresh entry (repeatable)', await visible('Back to Parent Page'));
  await page.getByRole('button', { name: 'Back to Parent Page' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 });
  ok('Second round trip also returns to Board Selector', await visible('Haydens - Homework'));

  // ============ 2. Locked child-device flow: no bypass, PIN still required ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByRole('button', { name: /Lock to.*Ava/ }).click();
  await page.waitForSelector('text=Set a parent PIN');
  await page.getByPlaceholder('New PIN (4+ digits)').fill('1234');
  await page.getByPlaceholder('Confirm PIN').fill('1234');
  await page.getByRole('button', { name: 'Set PIN & Lock' }).click();
  await page.waitForSelector('text=My Day');

  ok('Locked Child Mode: NO "Back to Parent Page" control is exposed', !(await visible('Back to Parent Page')));
  ok('Locked Child Mode: NO "Parents" control is exposed either (unchanged existing behavior)', !(await visible('Parents')));
  ok('Locked Child Mode: only "Parent Unlock" is shown', await visible('Parent Unlock'));

  // Wrong PIN must not grant access to anything parent-side, including any
  // back-to-Parent-Page path.
  await page.getByText('Parent Unlock').click();
  await page.waitForSelector('text=Enter the parent PIN');
  await page.getByPlaceholder(/PIN/).fill('0000');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForSelector('text=Incorrect PIN');
  ok('Wrong PIN: still locked, no parent surface reached', !(await visible('Parent Controls')));
  ok('Wrong PIN: still no "Back to Parent Page" bypass appears', !(await visible('Back to Parent Page')));

  // Correct PIN reaches the existing post-unlock menu — still not a bare
  // "Back to Parent Page" bypass; it's the existing, unchanged Parent Unlock
  // menu (Switch child / Parent Controls / Exit Child Mode).
  await page.getByPlaceholder(/PIN/).fill('1234');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForSelector('text=Parent Controls');
  ok('Correct PIN reaches the existing Parent Unlock menu (lock semantics unchanged)', await visible('Parent Controls'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
