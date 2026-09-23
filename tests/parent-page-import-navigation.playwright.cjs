/**
 * Focused regression test for the "Board Selector -> Parent Board ->
 * photo/CSV import" navigation fix.
 *
 * Product rule (corrected after an initial revision placed the entry point
 * on Family Board and was rejected): Family Board / Shared Display and
 * Child pages are execution-only surfaces (view + mark eligible items
 * complete) and must never expose admin functionality — import/upload,
 * edit, delete, source management, AI review, recurrence, or household
 * config. The entry point into Import must live on the authenticated
 * Parent Board itself, behind its own clearly-labeled "Upload Homework/Photo"
 * action — never inside Family Board, never on a child page.
 *
 * A later UI/IA refactor replaced the single "Parent Tools" toggle with a
 * touch-friendly action-card grid, then split the signed-in landing page
 * into a pure launcher (Board Selector, see src/BoardSelector.jsx) and a
 * separate Parent Board holding just the admin actions (see
 * src/ParentBoard.jsx), each action opening a focused view that replaces
 * the grid rather than expanding beneath it. Configuration (add-learner,
 * Device Mode, etc.) lives in a permanent Settings page (see
 * src/settings/SettingsPage.jsx) — this file exercises the updated
 * navigation, same product rule.
 *
 * Exercises the guest/local-demo path (no live Firebase project needed).
 *
 * Usage:
 *   npm run dev                                                  # in one terminal
 *   node tests/parent-page-import-navigation.playwright.cjs       # in another
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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await guestEnter();
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  ok('Settings still shows the Device Mode selector', await visible('Device Mode'));
  ok('Settings still shows the "👤 Parent device" option', await visible('Parent device'));
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Board Selector controls unchanged ============
  ok('Board Selector shows a Learners section with the new learner', await visible('Learners') && await visible('Ava'));
  ok('Board Selector still shows the existing "Family Board" entry point', await page.getByTestId('board-family').isVisible());

  // ============ Parent Board is free of launcher-level navigation (Section 2) ============
  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');
  ok('Parent Board shows no Learners section at all', !(await page.getByText('Learners').isVisible().catch(() => false)));
  ok('Parent Board shows no Settings entry point', !(await page.getByTestId('board-settings').isVisible().catch(() => false)));
  ok('Parent Board shows no Family Board entry point', !(await page.getByTestId('board-family').isVisible().catch(() => false)));

  // ============ Criterion 1: obvious new entry point on Parent Board itself ============
  ok('Parent Board shows the "Upload Homework/Photo" action card', await page.getByTestId('action-upload-homework').isVisible());
  ok('Import is NOT visible on Parent Board before opening the panel', !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));

  await page.getByTestId('action-upload-homework').click();
  ok('Clicking it reveals the Import panel as a focused view, still on Parent Board', await page.getByTestId('parent-organizer-panel').isVisible());
  ok('The action grid is hidden while the focused tool view is open', !(await page.getByTestId('parent-board').isVisible().catch(() => false)));
  const panel = page.locator('[data-testid="parent-organizer-panel"]');
  ok('Panel lists the learner to import for', await panel.locator('button', { hasText: 'Ava' }).isVisible());

  // ============ Criterion 2: Family Board is free of admin/import controls ============
  await page.getByText('← Back to Parent Board').click();
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-family').click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board shows the Organizer ("🔆 Today")', await visible('🔆 Today'));
  ok('Family Board shows the Calendar ("📅 Coming Up")', await visible('📅 Coming Up'));
  ok('Family Board shows a create control (+ Assignment) — "Add" is present', await page.getByRole('button', { name: '+ Assignment' }).isVisible());
  ok('Family Board does NOT show any Import control', !(await page.getByTestId('parent-organizer-panel').isVisible().catch(() => false)));
  ok('Family Board does NOT show any Import control (alt text match)', !(await page.getByText('Import Teacher Plan').isVisible().catch(() => false)));

  // ============ Criterion 5: import reachable only via the Parent Board action ============
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});
  ok('Family Board\'s own Back control returns to Board Selector', await visible('Haydens - Homework'));

  await page.getByTestId('board-parent').click();
  await page.getByTestId('action-upload-homework').click();
  await page.waitForSelector('[data-testid="parent-organizer-panel"]');
  await page.locator('[data-testid="parent-organizer-panel"] button', { hasText: 'Ava' }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Clicking a learner in the panel lands directly on that child\'s Parents Page', await visible('Parents Page'));
  ok('The photo-import card is reachable from this entry point', await visible('Import from a Photo'));
  ok('The existing CSV-import card is also present (nothing removed)', await visible('Import Teacher Plan (CSV)'));

  // ============ Criterion 4 / back navigation: returns to Board Selector, not the child's game Home ============
  ok('Back button is labeled for returning to the Parent Page (not "Back to Home")', await visible('Back to Parent Page'));
  await page.getByText('Back to Parent Page').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});
  ok('Back button returns to Board Selector', await visible('Haydens - Homework'));
  ok('Back navigation did NOT land in the child\'s game Home (no game-home marker)', !(await page.getByText("Hayden's Homework").isVisible().catch(() => false)));

  // ============ Criterion 3: normal child-selection flow (Child page) still has no import/admin controls ============
  // Reached directly from Board Selector's own Learners section (navigation
  // refactor) — the same canonical onSelectChild path the removed "View
  // Child" Settings button used to call, now surfaced as the primary entry
  // point for every current learner.
  ok('Board Selector shows a learner button for Ava', await page.getByTestId('board-learner').isVisible());
  await page.getByTestId('board-learner').click();
  await page.waitForSelector('text=My Day', { timeout: 5000 });
  ok('Normal child selection still opens on that child\'s Home (Board Selector learner button)', await page.getByRole('button', { name: /Parents/ }).isVisible().catch(() => false));
  ok('Child\'s Home screen itself shows no Import control directly (only via the gated ⚙️ Parents click)', !(await page.getByText('Import from a Photo').isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Normal Home -> Parents flow still shows "Back to Home" (unchanged existing behavior)', await visible('Back to Home'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
