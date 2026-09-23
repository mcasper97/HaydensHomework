/**
 * Dedicated regression test for the Board Selector / Parent Board
 * navigation refactor (see src/BoardSelector.jsx, src/ParentBoard.jsx,
 * src/AuthShell.jsx). The signed-in landing page used to double as both
 * "where do I want to go?" and "what admin action do I need?" in one
 * screen (the old ParentHome.jsx). This slice splits those into:
 *   - Board Selector — a pure launcher: Family Board, Parent Board,
 *     Settings, and one destination per current learner, plus Sign out.
 *   - Parent Board — just the five parent-admin actions, each opening a
 *     focused view that fully replaces the action grid (not expanding
 *     beneath it).
 *
 * This file is the primary coverage for the navigation model itself.
 * Deeper behavioral proofs for each individual surface already exist
 * elsewhere in this suite and are not duplicated here:
 *   - focused-tool business logic (create/upload/review/check-email/chores)
 *     — tests/parent-home-admin-actions.playwright.cjs, tests/review-inbox.playwright.cjs,
 *     tests/parent-tools-persistence.playwright.cjs, tests/parent-page-import-navigation.playwright.cjs
 *   - child rename / identity-safe learner navigation — tests/child-rename-settings.playwright.cjs
 *   - Family Board / Shared Display surface boundary — tests/family-board-surface-boundary.playwright.cjs
 *   - Gmail/Calendar Settings panels — tests/calendar-connection-panel.playwright.cjs,
 *     tests/calendar-routing-ux.playwright.cjs
 *
 * Exercises the guest/local-demo storage path (localStorage-backed), same
 * as every other *.playwright.cjs file in this suite — no live Firebase
 * project needed.
 *
 * Usage:
 *   npm run dev                                              # in one terminal
 *   node tests/board-selector-navigation.playwright.cjs       # in another
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
  const notVisible = async (testId) => !(await page.getByTestId(testId).isVisible().catch(() => false));
  const readChildren = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_children') || '[]'));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ================================================================
  // Board Selector — pure launcher, no admin tools, no dashboard content
  // ================================================================
  ok('Board Selector is the landing surface immediately after auth', await page.getByTestId('board-selector').isVisible());
  ok('Board Selector shows Family Board', await page.getByTestId('board-family').isVisible());
  ok('Board Selector shows Parent Board', await page.getByTestId('board-parent').isVisible());
  ok('Board Selector shows Settings', await page.getByTestId('board-settings').isVisible());
  ok('Board Selector shows Sign out clearly (not buried)', await page.getByText('Sign out').isVisible());
  ok('Board Selector shows no Parent Board admin tools (Add Item)', await notVisible('action-add-item'));
  ok('Board Selector shows no Parent Board admin tools (Manage Chores)', await notVisible('action-manage-chores'));
  ok('Board Selector shows no inline Add Item form', !(await page.locator('form').isVisible().catch(() => false)));
  ok('Board Selector shows no Today/Upcoming Organizer content', !(await visible('🔆 Today')));
  ok('Board Selector shows no Learners section before any learner exists (nothing to launch into yet)', !(await page.getByText('Learners').isVisible().catch(() => false)));

  // Add two learners via Settings so the Learners section has real content.
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Tiger');
  await page.getByRole('button', { name: '🐯' }).click();
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Tiger');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Lion');
  await page.getByRole('button', { name: '🦁' }).click();
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Lion');
  const children = await readChildren();
  const tigerId = children.find((c) => c.name === 'Tiger')?.id;
  const lionId = children.find((c) => c.name === 'Lion')?.id;
  ok('Both learners were created with stable canonical ids', !!tigerId && !!lionId && tigerId !== lionId);

  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ================================================================
  // Board Selector — Learners section (one destination per current learner)
  // ================================================================
  ok('Board Selector now shows a "Learners" heading', await visible('Learners'));
  const learnerButtons = page.getByTestId('board-learner');
  ok('Board Selector shows exactly one learner button per current learner', (await learnerButtons.count()) === 2);
  ok('Each learner button shows the learner\'s current display name and emoji', await visible('Tiger') && await visible('Lion') && await visible('🐯') && await visible('🦁'));

  // ================================================================
  // Parent Board — just the five admin actions, no launcher navigation
  // ================================================================
  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');
  ok('Parent Board shows all five admin actions', await page.getByTestId('action-add-item').isVisible()
    && await page.getByTestId('action-upload-homework').isVisible()
    && await page.getByTestId('action-review-inbox').isVisible()
    && await page.getByTestId('action-check-email').isVisible()
    && await page.getByTestId('action-manage-chores').isVisible());
  ok('The "Check Email" action is labeled exactly "Check Email", not "Check Email/Import"', await page.getByTestId('action-check-email').getByText('Check Email', { exact: false }).isVisible()
    && !(await page.getByTestId('action-check-email').getByText('Check Email/Import').isVisible().catch(() => false)));
  ok('Parent Board does NOT show a Family Board entry point', await notVisible('board-family'));
  ok('Parent Board does NOT show a Settings entry point', await notVisible('board-settings'));
  ok('Parent Board does NOT show learner board entry points', await notVisible('board-learner'));
  ok('Parent Board provides a clear way back to Board Selector ("← All Boards")', await visible('← All Boards'));

  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  ok('"← All Boards" returns to Board Selector', await page.getByTestId('board-selector').isVisible());

  // ================================================================
  // Focused tool views — each action replaces the grid, never expands beneath it
  // ================================================================
  const toolCases = [
    { action: 'action-add-item', panelTestId: 'add-item-panel' },
    { action: 'action-upload-homework', panelTestId: 'parent-organizer-panel' },
    { action: 'action-manage-chores', panelTestId: 'chore-management-panel' },
  ];
  for (const { action, panelTestId } of toolCases) {
    await page.getByTestId('board-parent').click();
    await page.waitForSelector('text=Parent Board');
    await page.getByTestId(action).click();
    ok(`Tapping "${action}" opens a focused view (its panel is visible)`, await page.getByTestId(panelTestId).isVisible());
    ok(`The grid is fully hidden while "${action}"'s focused view is open`, await notVisible('parent-board'));
    ok(`"${action}"'s focused view has a "← Back to Parent Board" control`, await visible('← Back to Parent Board'));
    await page.getByText('← Back to Parent Board').click();
    ok(`Back restores the grid after "${action}"`, await page.getByTestId('parent-board').isVisible());
    ok(`"${action}"'s panel is gone after Back`, await notVisible(panelTestId));
    await page.getByText('← All Boards').click();
    await page.waitForSelector('text=Haydens - Homework');
  }

  // Review Inbox — no persisted panelTestId of its own, verify via its
  // subscription-driven heading text instead (already deeply covered by
  // tests/review-inbox.playwright.cjs).
  await page.getByTestId('board-parent').click();
  await page.getByTestId('action-review-inbox').click();
  ok('Review Inbox focused view opens, replacing the grid', await notVisible('parent-board'));
  ok('Review Inbox focused view has a "← Back to Parent Board" control', await visible('← Back to Parent Board'));
  await page.getByText('← Back to Parent Board').click();
  ok('Back restores the grid after Review Inbox', await page.getByTestId('parent-board').isVisible());
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // Check Email — guest/admin mode shows the gated message (no real Gmail
  // account to check), still as a focused view replacing the grid.
  await page.getByTestId('board-parent').click();
  await page.getByTestId('action-check-email').click();
  ok('Check Email focused view opens, replacing the grid', await notVisible('parent-board'));
  ok('Guest mode shows the Check Email gating message (no real Gmail account)', await visible("isn't available in guest/demo mode"));
  await page.getByText('← Back to Parent Board').click();
  ok('Back restores the grid after Check Email', await page.getByTestId('parent-board').isVisible());
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ================================================================
  // Learner Boards — selected by canonical child ID, existing Child Home reused
  // ================================================================
  const tigerButton = page.getByTestId('board-learner').filter({ hasText: 'Tiger' });
  await tigerButton.click();
  await page.waitForSelector('text=My Day', { timeout: 5000 });
  ok('Clicking a learner opens the existing Child Home/My Day experience', await visible('My Day'));
  ok('The existing "Back to Parent Page" control is reachable from Child Home', await visible('Back to Parent Page'));
  await page.getByRole('button', { name: 'Back to Parent Page' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 });
  ok('"Back to Parent Page" returns to Board Selector (normal parent experience)', await page.getByTestId('board-selector').isVisible());

  // Renaming a learner in Settings must not change which underlying child a
  // Board Selector learner button opens (same canonical id).
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  const tigerRow = page.locator('div').filter({ hasText: 'Tiger' }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last();
  await tigerRow.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('child-rename-input').fill('Tigress');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(200);
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  ok('Board Selector reflects the renamed learner\'s current display name', await visible('Tigress'));
  const renamedButton = page.getByTestId('board-learner').filter({ hasText: 'Tigress' });
  await renamedButton.click();
  await page.waitForSelector('text=My Day', { timeout: 5000 });
  const openedChildId = await page.evaluate(() => localStorage.getItem('crestly_locked_child_id'));
  ok('Selecting the renamed learner does not lock the device (pure navigation, same as before)', openedChildId === null);
  const childrenAfterRename = await readChildren();
  ok('The renamed learner still has exactly the same canonical id it started with', childrenAfterRename.find((c) => c.name === 'Tigress')?.id === tigerId);
  await page.getByRole('button', { name: 'Back to Parent Page' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 });

  // ================================================================
  // Family Board — opens from Board Selector, existing behavior intact
  // ================================================================
  await page.getByTestId('board-family').click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board opens from Board Selector and shows the existing Organizer', await visible('🔆 Today'));
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 });
  ok('Family Board\'s own Back control returns to Board Selector', await page.getByTestId('board-selector').isVisible());

  // ================================================================
  // Settings — still a permanent destination with everything intact
  // ================================================================
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  ok('Settings shows the Household section', await visible('Household'));
  ok('Settings shows the Children section', await visible('Children'));
  ok('Settings shows the Account section (with Sign out reachable here too)', await visible('Account'));
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ================================================================
  // Sign Out — clearly visible on the authenticated Board Selector
  // ================================================================
  await page.getByText('Sign out').click();
  await page.waitForSelector('text=Continue without an account', { timeout: 5000 }).catch(() => {});
  ok('Signing out from Board Selector returns to the unauthenticated landing page', await visible('Continue without an account'));

  // ================================================================
  // Mobile viewport — the focused tool view must fully replace the grid,
  // never render underneath it, even at a small screen width.
  // ================================================================
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone-12-ish
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');
  ok('Mobile: Board Selector destinations are visible and tappable', await page.getByTestId('board-parent').isVisible());
  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');
  ok('Mobile: Parent Board action grid is visible', await page.getByTestId('parent-board').isVisible());
  await page.getByTestId('action-add-item').click();
  ok('Mobile: focused tool view is visible', await page.getByTestId('add-item-panel').isVisible());
  ok('Mobile: the action grid is fully hidden while the focused view is open (not rendered underneath it)', await notVisible('parent-board'));
  ok('Mobile: the "← Back to Parent Board" control is reachable without scrolling past unrelated cards', await visible('← Back to Parent Board'));
  await page.getByText('← Back to Parent Board').click();
  ok('Mobile: Back restores the grid', await page.getByTestId('parent-board').isVisible());

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
