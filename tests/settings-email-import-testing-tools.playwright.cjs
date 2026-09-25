/**
 * Focused Settings / Email Import coverage for the new "Reset Email
 * Processing History" testing control (Settings -> Email Import -> Testing
 * Tools).
 *
 * IMPORTANT SCOPE NOTE: GmailConnectionPanel, EmailImportSettingsSection,
 * and GoogleCalendarConnectionPanel are ALL gated behind `!user?.isAdmin`
 * in src/settings/SettingsPage.jsx — "Gmail/Calendar integrations require
 * a real Firebase-authenticated parent — guest/local mode has no account
 * to attach a connection to," per that file's own existing doc comment.
 * This is pre-existing, unchanged gating, not something this feature
 * introduces — every other Gmail/Calendar Settings panel already has ZERO
 * Playwright coverage for the same reason (no test in this suite ever
 * performs a real Firebase sign-in; every *.playwright.cjs file exercises
 * the guest/local-demo storage path only). So this file proves the one
 * thing that actually IS reachable and meaningful from guest mode: the new
 * Testing Tools control (like the rest of Email Import) never appears for
 * a guest/admin account — a real regression guard (nothing must ever move
 * it outside that gate). The control's own confirm-dialog/success-message
 * behavior was built using the exact same window.confirm pattern already
 * covered by tests/manage-items.playwright.cjs's delete-confirmation flow
 * (see src/organizer/ManageItemsPanel.jsx), and its server contract is
 * covered in full by tests/gmail-processing-reset.unit.mjs and
 * tests/gmail-reset-processing-endpoint.unit.mjs.
 *
 * Usage:
 *   npm run dev                                                     # in one terminal
 *   node tests/settings-email-import-testing-tools.playwright.cjs    # in another
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
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');

  ok('Guest/admin Settings never shows the Email Import section at all', !(await page.getByText('Email Import').isVisible().catch(() => false)));
  ok('Guest/admin Settings never shows the new Testing Tools subsection', (await page.getByTestId('gmail-testing-tools-section').count()) === 0);
  ok('Guest/admin Settings never shows the Reset Email Processing History button', (await page.getByTestId('reset-gmail-processing-button').count()) === 0);
  ok('Guest/admin Settings never shows a Gmail connection panel either (same pre-existing gate)', !(await page.getByText('Connect Gmail').isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
