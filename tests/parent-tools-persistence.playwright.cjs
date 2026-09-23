/**
 * Regression test for Parent Home's "Upload Homework/Photo" action panel
 * (formerly Commit 4.2's "Parent Tools" toggle open/closed persistence,
 * src/data/parentToolsPreference.js). A later UI/IA refactor replaced the
 * single "Parent Tools" toggle + inline config panels with a touch-friendly
 * action-card grid on Parent Home (see src/ParentHome.jsx) and a permanent
 * Settings page (see src/settings/SettingsPage.jsx) — the persisted
 * open/closed preference concept no longer applies (each action panel is
 * plain toggled local component state, collapsing again on every reload,
 * same for guest and real accounts alike). This file now proves:
 *   - the Upload Homework/Photo panel opens/closes on demand,
 *   - Family Board / a child page never expose parent-only Home actions,
 * and that parentToolsOpen:<uid> is no longer written by anything (the
 * data module itself is untouched/available for reuse, just unused here).
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
  await page.waitForSelector('text=Parent Home');

  await page.getByTestId('action-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  await page.getByText('← Parent Home').click();
  await page.waitForSelector('text=Parent Home');

  // ============ Upload Homework/Photo panel opens/closes on demand ============
  ok('Upload panel is not visible before tapping the action card', !(await visible('Add a learner in Settings first to import for them')) && !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));
  await page.getByTestId('action-upload-homework').click();
  ok('Tapping "Upload Homework/Photo" reveals its panel', await page.getByTestId('parent-organizer-panel').isVisible());
  ok('The panel lists the newly-added learner', await visible('Ava'));

  // ============ Nothing writes a legacy parentToolsOpen:<uid> key anymore ============
  ok('No parentToolsOpen:<uid> key is ever written (guest mode)', (await anyParentToolsKeys()).length === 0);

  // ============ Collapses again on tap, and never survives a reload (plain local state) ============
  await page.getByTestId('action-upload-homework').click();
  ok('Tapping "Upload Homework/Photo" again collapses its panel', !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');
  ok('After reload (guest re-entered), the Upload panel is collapsed again', !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));
  ok('The "Upload Homework/Photo" action card is still present after reload', await page.getByTestId('action-upload-homework').isVisible());

  // ============ Family Board does not expose parent-only Home actions ============
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board does not show the "Upload Homework/Photo" action card', !(await page.getByTestId('action-upload-homework').isVisible().catch(() => false)));
  ok('Family Board does not show the Upload panel content either', !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));

  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 }).catch(() => {});

  // ============ A child page does not expose parent-only Home actions ============
  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Child\'s Home screen does not show a Parent Home action card', !(await page.getByTestId('action-upload-homework').isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Child\'s (unlocked, execution-only) Parents Page view does not show a Parent Home action card', !(await page.getByTestId('action-upload-homework').isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
