/**
 * End-to-end regression test for Slice C.1B's Google Calendar Routing
 * panel — src/GoogleCalendarRoutingPanel.jsx (moved verbatim out of
 * AuthShell.jsx's former Parent Tools panel by a later UI/IA refactor into
 * the permanent Settings page's Google Calendar section — no behavior
 * change).
 *
 * Like GoogleCalendarConnectionPanel (see
 * tests/calendar-connection-panel.playwright.cjs's own header comment)
 * and every other real-account-only Calendar surface tested in this
 * suite, the actual routing configuration flow — fetching the live
 * writable Calendar List, populating selectors, saving, the
 * CALENDAR_LIST_SCOPE_MISSING/needsReconnect/generic-failure states —
 * requires a real Firebase-authenticated parent with a real connected
 * Google Calendar. None of that is available in this guest-mode sandbox.
 * That remains a DISCLOSED LIMITATION requiring live/manual verification
 * (already performed once for the underlying getCalendarList() endpoint
 * itself in Slice C.1A's live validation — see the screenshot in that
 * slice's own history).
 *
 * What IS provable in guest mode: the panel's gating, identical in shape
 * to GoogleCalendarConnectionPanel's own — guest/local-demo mode has no
 * real account to attach a Calendar connection (or its routing config)
 * to, so the panel must never render there, and (like every other
 * Settings section) must never be reachable from Family Board, Child
 * Home, or a locked/shared Display surface. This file also proves the
 * removed Slice C.1A temporary "Test Calendar List" control is gone for
 * good.
 *
 * Usage:
 *   npm run dev                                        # in one terminal
 *   node tests/calendar-routing-ux.playwright.cjs       # in another
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

  // ============ Guest mode: Settings open, Routing panel absent (real-account-only, mirrors the Connection panel) ============
  ok(
    'Guest mode never shows the "Google Calendar Routing" panel (requires a real Firebase account and a connected Calendar)',
    !(await page.locator('[data-testid="google-calendar-routing-panel"]').isVisible().catch(() => false))
  );
  ok('Other Settings sections (e.g. Household/Timezone) ARE still shown in guest mode', await page.locator('input[placeholder="e.g. America/New_York"]').isVisible().catch(() => false));

  // ============ The Slice C.1A temporary validation control is gone for good ============
  ok('The removed temporary "Test Calendar List" control never appears anywhere', !(await page.getByText('Test Calendar List').isVisible().catch(() => false)));
  ok('The removed temporary control\'s data-testid is gone from the DOM entirely', (await page.locator('[data-testid="calendar-list-validation-control"]').count()) === 0);

  // ============ Guest/child/shared surfaces never expose the routing panel ============
  await page.getByText('← Parent Home').click();
  await page.waitForSelector('text=Parent Home');
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board never shows "Google Calendar Routing"', !(await page.getByText('Google Calendar Routing').isVisible().catch(() => false)));
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 }).catch(() => {});

  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Child Home never shows "Google Calendar Routing"', !(await page.getByText('Google Calendar Routing').isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok("Child's unlocked Parents Page view never shows \"Google Calendar Routing\" either", !(await page.getByText('Google Calendar Routing').isVisible().catch(() => false)));
  ok('Child\'s unlocked Parents Page view never shows a Settings control either (unchanged existing gating)', !(await page.getByText('Settings').isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
