/**
 * Regression test for Parent Board's "Upload Homework/Photo" action panel
 * (formerly Commit 4.2's "Parent Tools" toggle open/closed persistence,
 * src/data/parentToolsPreference.js). A later UI/IA refactor replaced the
 * single "Parent Tools" toggle + inline config panels with a touch-friendly
 * action-card grid, later split into a pure launcher (Board Selector, see
 * src/BoardSelector.jsx) and Parent Board (see src/ParentBoard.jsx) holding
 * the actions themselves, each opening a focused view that fully replaces
 * the grid — plus a permanent Settings page (see
 * src/settings/SettingsPage.jsx). The persisted open/closed preference
 * concept no longer applies (each focused tool view is plain local
 * component state, collapsing again on every reload, same for guest and
 * real accounts alike). This file now proves:
 *   - the Upload Homework/Photo focused view opens/closes on demand and
 *     fully replaces the action grid while open,
 *   - Family Board / a child page never expose parent-only Board actions,
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
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');

  // ============ Upload Homework/Photo focused view opens/closes on demand ============
  ok('Upload panel is not visible before tapping the action card', !(await visible('Add a learner in Settings first to import for them')) && !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));
  await page.getByTestId('action-upload-homework').click();
  ok('Tapping "Upload Homework/Photo" reveals its focused view', await page.getByTestId('parent-organizer-panel').isVisible());
  ok('The action grid is hidden while the focused view is open', !(await page.getByTestId('parent-board').isVisible().catch(() => false)));
  ok('The panel lists the newly-added learner', await visible('Ava'));

  // ============ Nothing writes a legacy parentToolsOpen:<uid> key anymore ============
  ok('No parentToolsOpen:<uid> key is ever written (guest mode)', (await anyParentToolsKeys()).length === 0);

  // ============ Back returns to the grid, and never survives a reload (plain local state) ============
  await page.getByText('← Back to Parent Board').click();
  ok('"← Back to Parent Board" collapses the focused view', !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));
  ok('The action grid is restored after Back', await page.getByTestId('parent-board').isVisible());

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-parent').click();
  ok('After reload (guest re-entered), the Upload focused view is collapsed again', !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));
  ok('The "Upload Homework/Photo" action card is still present after reload', await page.getByTestId('action-upload-homework').isVisible());

  // ============ Family Board does not expose parent-only Board actions ============
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-family').click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board does not show the "Upload Homework/Photo" action card', !(await page.getByTestId('action-upload-homework').isVisible().catch(() => false)));
  ok('Family Board does not show the Upload panel content either', !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));

  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // ============ A child page does not expose parent-only Board actions ============
  // Board Selector's Learners section is a direct child-selection entry
  // point (navigation refactor), but a child's Parents Page (used here) is
  // specifically reached via Parent Board's "Upload Homework/Photo" action
  // instead. Child Home (the game/My Day view) is a wholly separate
  // App.jsx render path that never imports any Parent Board action card in
  // the first place, so it's not separately re-verified here.
  await page.getByTestId('board-parent').click();
  await page.getByTestId('action-upload-homework').click();
  await page.getByTestId('parent-organizer-panel').getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Child\'s (unlocked, execution-only) Parents Page view does not show a Parent Board action card', !(await page.getByTestId('action-upload-homework').isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
