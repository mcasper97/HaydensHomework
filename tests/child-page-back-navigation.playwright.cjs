/**
 * Focused regression test for #29 — "Back to Parent Page" navigation on a
 * child's Home screen (src/App.jsx renderHome).
 *
 * Root cause this covers: AuthShell.jsx already passed an `onSwitchChild`
 * callback into <App> on the normal (non-locked) parent-device flow — pure
 * navigation, resets AuthShell's selectedChild back to null so ParentHome
 * renders again, with no device-mode change, no sign-out, no data write.
 *
 * History: an earlier UI cleanup removed Parent Home's direct
 * child-selection cards with no replacement, which made this normal,
 * unlocked Home entry temporarily unreachable through any UI action (a
 * disclosed finding at the time). A follow-up added "View Child" to
 * Settings' Children section (src/settings/ChildManagementSection.jsx,
 * viewChild in src/ParentHome.jsx) specifically to restore this — it
 * reuses AuthShell.jsx's existing selectedChild/onSwitchChild/
 * handleSelectChild machinery verbatim (same function the old cards
 * called), just from a new location. This file exercises that restored
 * entry point.
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
  const guestEnter = () => page.getByText('Continue without an account').click();
  const readChildren = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_children') || '[]'));
  const readDeviceMode = () => page.evaluate(() => localStorage.getItem('crestly_device_mode'));
  const viewAvaFromSettings = async () => {
    await page.getByTestId('action-settings').click();
    await page.waitForSelector('text=Settings');
    await page.getByRole('button', { name: 'View Child' }).click();
    await page.waitForSelector('text=My Day', { timeout: 5000 });
  };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await guestEnter();
  await page.waitForSelector('text=Parent Home');

  await page.getByTestId('action-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  await page.getByText('← Parent Home').click();
  await page.waitForSelector('text=Parent Home');

  // ============ 1. Normal authenticated parent-device flow (via Settings > Children > View Child) ============
  const childrenBefore = await readChildren();
  const deviceModeBefore = await readDeviceMode();

  await viewAvaFromSettings();
  ok('Normal flow: child Home shows a "Back to Parent Page" control', await visible('Back to Parent Page'));
  ok('Normal flow: child Home still shows the existing "Parents" control too (unchanged)', await page.getByRole('button', { name: /Parents/ }).isVisible());
  ok('Normal flow: the label is exactly "Back to Parent Page", not vague ("Back"/"Home"/"Exit")', await page.getByRole('button', { name: 'Back to Parent Page' }).isVisible());

  await page.getByRole('button', { name: 'Back to Parent Page' }).click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 });
  ok('Clicking it returns to Parent Home', await visible('Parent Home'));
  ok('Parent Home stays learner-card-free after returning (unaffected by View Child)', !(await page.getByText('Learners').isVisible().catch(() => false)));

  const childrenAfter = await readChildren();
  const deviceModeAfter = await readDeviceMode();
  ok('Device mode is unchanged by this navigation', deviceModeBefore === deviceModeAfter);
  ok('Not logged out — still in the same guest session, not back at sign-in', !(await visible('Sign In')));
  ok('Child data is unaltered by this navigation', JSON.stringify(childrenBefore) === JSON.stringify(childrenAfter));

  // Re-enter and confirm the round trip is repeatable (not a one-shot control).
  await viewAvaFromSettings();
  ok('Control is present again on a fresh entry (repeatable)', await visible('Back to Parent Page'));
  await page.getByRole('button', { name: 'Back to Parent Page' }).click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 });
  ok('Second round trip also returns to Parent Home', await visible('Parent Home'));

  // ============ 2. Locked child-device flow: no bypass, PIN still required ============
  await page.getByTestId('action-settings').click();
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
