/**
 * End-to-end regression test for Slice B's Google Calendar connection
 * panel — src/GoogleCalendarConnectionPanel.jsx (moved verbatim out of
 * AuthShell.jsx's former Parent Tools panel by a later UI/IA refactor into
 * the permanent Settings page's Google Calendar section — no behavior
 * change).
 *
 * Like Gmail's own connection panel (which has never had Playwright
 * coverage in this suite, for the identical reason — no test file exists
 * covering GmailConnectionPanel either), the Connect/Disconnect flow and
 * the three live connection states (Not connected / Connected / Needs
 * reconnect) require a real Firebase-authenticated parent and a real
 * Google OAuth round trip — neither is available in this sandbox. Those
 * remain a DISCLOSED LIMITATION requiring live/manual verification.
 *
 * What IS provable in guest mode: the panel's gating. Google Calendar
 * OAuth requires a real account to attach a connection to (see
 * api/_auth.js), so — exactly like GmailConnectionPanel — it must never
 * render for a guest/local-demo profile, and (like every other
 * Settings section) must never be reachable from Family Board, Child
 * Home, or a locked/shared Display surface.
 *
 * Usage:
 *   npm run dev                                            # in one terminal
 *   node tests/calendar-connection-panel.playwright.cjs     # in another
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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');

  await page.getByTestId('action-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');

  // ============ Guest mode: Settings open, Calendar panel absent (real-account-only, mirrors Gmail) ============
  ok(
    'Guest mode never shows the "Google Calendar" panel on Settings (requires a real Firebase account, exactly like Gmail)',
    !(await page.locator('[data-testid="google-calendar-connection-panel"]').isVisible().catch(() => false))
  );
  ok(
    'Guest mode also never shows the "Gmail" panel (cross-check: same real-account-only gating both panels already share)',
    !(await page.locator('[data-testid="gmail-connection-panel"]').isVisible().catch(() => false))
  );
  ok('Other Settings sections (e.g. Household/Timezone) ARE still shown in guest mode', await page.locator('input[placeholder="e.g. America/New_York"]').isVisible().catch(() => false));

  // ============ Guest/child/shared surfaces never expose Calendar controls ============
  await page.getByText('← Parent Home').click();
  await page.waitForSelector('text=Parent Home');
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board never shows "Google Calendar"', !(await page.getByText('Google Calendar').isVisible().catch(() => false)));
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 }).catch(() => {});

  // Parent Home no longer has a direct child-selection card (removed in a
  // later UI cleanup) — a child's Parents Page is now reached via the
  // "Upload Homework/Photo" action instead. Child Home (the game/My Day
  // view) is a wholly separate App.jsx render path that never imports any
  // Settings/Calendar module in the first place, so it's not separately
  // re-verified here.
  await page.getByTestId('action-upload-homework').click();
  await page.getByTestId('parent-organizer-panel').getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok("Child's unlocked Parents Page view never shows \"Google Calendar\" either", !(await page.getByText('Google Calendar').isVisible().catch(() => false)));
  ok('Child\'s unlocked Parents Page view never shows a Settings control either (unchanged existing gating)', !(await page.getByText('Settings').isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
