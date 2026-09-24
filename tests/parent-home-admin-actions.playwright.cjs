/**
 * SHIP BLOCKER correction regression test: Parent Board's "Add Item" and
 * "Manage Chores" actions must open their own parent-owned panels as a
 * focused view directly on Parent Board (src/organizer/AddItemPanel.jsx,
 * src/ChoreManagementPanel.jsx) and must NEVER navigate into Family Board /
 * Shared Display.
 *
 * Product boundary being enforced:
 *   Parent Board        — parent administrative actions
 *   Family Board/Shared — glance + execute household responsibilities only;
 *                         no parent-admin dependency, no item creation UI of
 *                         its own reachable FROM Parent Board, no new
 *                         chore-definition controls beyond what it already had
 *
 * Add Item's create logic (SourceRecord + createItem) lives in
 * AddItemPanel.jsx, reached only from Parent Board now — the Family Board
 * redesign made Family Board execution-only (unified agenda: Items + chore
 * occurrences, no admin controls of any kind), so there is no longer a
 * separate Family-Board-owned Add Item affordance or Manage Chores block to
 * keep in sync; chore-template add/remove logic lives in
 * data/choreTemplatesRepository.js, reached only from Parent Board's
 * ChoreManagementPanel.jsx. A later navigation refactor (see src/BoardSelector.jsx,
 * src/ParentBoard.jsx) split the signed-in landing page (a pure launcher)
 * from Parent Board (the admin actions), and made each action open a
 * focused view that fully replaces the action grid rather than expanding
 * beneath it — this file exercises that updated navigation, same product
 * boundary.
 *
 * Exercises the guest/local-demo storage path (localStorage-backed), same
 * as every other *.playwright.cjs file in this suite — no live Firebase
 * project needed.
 *
 * Usage:
 *   npm run dev                                            # in one terminal
 *   node tests/parent-home-admin-actions.playwright.cjs     # in another
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
  const readItems = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_items') || '[]'));
  const readChoreTemplates = () =>
    page.evaluate(() => (JSON.parse(localStorage.getItem('crestly_admin_chores') || '{}').templates) || {});

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

  // ============ Add Item: opens as a focused view, never navigates to Family Board ============
  ok('Add Item panel is not visible before tapping the action card', !(await page.getByTestId('add-item-panel').isVisible().catch(() => false)));
  await page.getByTestId('action-add-item').click();
  ok('Tapping "Add Item" opens a focused view with its own "Back to Parent Board" control (no navigation away)', await visible('← Back to Parent Board'));
  ok('Tapping "Add Item" hides the Parent Board action grid (focused view replaces it, not expands beneath it)', !(await page.getByTestId('parent-board').isVisible().catch(() => false)));
  ok('Tapping "Add Item" does NOT show the Family Board heading', !(await page.getByText(/🏠.*Family Board/).isVisible().catch(() => false)));
  ok('Tapping "Add Item" does NOT show Family Board\'s unified agenda', !(await page.getByTestId('family-agenda').isVisible().catch(() => false)));
  ok('Tapping "Add Item" reveals the parent-owned Add Item panel', await page.getByTestId('add-item-panel').isVisible());
  ok('The Add Item panel shows the existing item-type quick-create buttons', await page.getByRole('button', { name: '+ Assignment' }).isVisible());

  await page.getByRole('button', { name: '+ Assignment' }).click();
  const form = page.locator('form');
  ok('Clicking a type opens the existing ItemForm inline on Parent Board', await form.isVisible());
  await form.getByPlaceholder('Title').fill('Book Report Draft');
  const today = new Date().toISOString().slice(0, 10);
  await form.locator('input[type="date"]').first().fill(today);
  await form.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(400);

  ok('Submitting creates a real canonical Item (existing persistence unchanged)', (await readItems()).some((it) => it.title === 'Book Report Draft'));
  const createdItem = (await readItems()).find((it) => it.title === 'Book Report Draft');
  ok('The created item has a sourceRecordId (existing provenance behavior preserved)', !!createdItem?.sourceRecordId);
  ok('A confirmation is shown after adding, still on the Add Item focused view', await visible('Added!'));
  ok('Still in the Add Item focused view after submitting (never navigated to Family Board)', await page.getByTestId('add-item-panel').isVisible() && !(await page.getByTestId('family-agenda').isVisible().catch(() => false)));

  // Back to the grid.
  await page.getByText('← Back to Parent Board').click();
  ok('"← Back to Parent Board" collapses the focused view', !(await page.getByTestId('add-item-panel').isVisible().catch(() => false)));
  ok('The action grid is restored after Back', await page.getByTestId('parent-board').isVisible());

  // ============ Manage Chores: opens as a focused view, never navigates to Family Board ============
  ok('Chore management panel is not visible before tapping the action card', !(await page.getByTestId('chore-management-panel').isVisible().catch(() => false)));
  await page.getByTestId('action-manage-chores').click();
  ok('Tapping "Manage Chores" opens a focused view with its own "Back to Parent Board" control (no navigation away)', await visible('← Back to Parent Board'));
  ok('Tapping "Manage Chores" hides the Parent Board action grid', !(await page.getByTestId('parent-board').isVisible().catch(() => false)));
  ok('Tapping "Manage Chores" does NOT show the Family Board heading', !(await page.getByText(/🏠.*Family Board/).isVisible().catch(() => false)));
  ok('Tapping "Manage Chores" does NOT show Family Board\'s unified agenda', !(await page.getByTestId('family-agenda').isVisible().catch(() => false)));
  ok('Tapping "Manage Chores" reveals the parent-owned chore-management panel', await page.getByTestId('chore-management-panel').isVisible());
  ok('The panel lists the existing learner (Ava)', await visible('Ava'));

  const chorePanel = page.getByTestId('chore-management-panel');
  await chorePanel.getByText('+ Add a chore').click();
  await chorePanel.getByPlaceholder('e.g. Empty upstairs trash').fill('Feed the cat');
  await chorePanel.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(300);

  ok('Adding a chore persists a real chore template (existing persistence unchanged)', Object.values(await readChoreTemplates()).flat().some((c) => c.text === 'Feed the cat'));
  ok('The new chore is visible in the panel', await visible('Feed the cat'));
  ok('Still in the Manage Chores focused view after adding (never navigated to Family Board)', await page.getByTestId('chore-management-panel').isVisible() && !(await page.getByTestId('family-agenda').isVisible().catch(() => false)));

  // ============ Family Board still renders/works independently, with the same underlying data ============
  // Family Board is execution-only in the current architecture (unified
  // agenda, no parent-admin controls of any kind) — it no longer has its
  // own inline Add Item quick-create row or a separate "Manage Chores"
  // section (both moved to Parent Board only). The invariant this section
  // now protects: the same canonical Item/chore data Parent Board wrote is
  // visible on Family Board's agenda, with no admin controls alongside it.
  await page.getByText('← Back to Parent Board').click();
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 });
  ok('Family Board renders independently (unified agenda)', await page.getByTestId('family-agenda').isVisible());
  ok('Family Board shows NO inline item-type quick-create row ("+ Assignment") — creation lives only on Parent Board now', !(await page.getByRole('button', { name: '+ Assignment' }).isVisible().catch(() => false)));
  ok('The item added from Parent Board is visible on Family Board too (same canonical Item store)', await visible('Book Report Draft'));
  ok('Family Board shows NO separate "Manage Chores" heading — chore-template management lives only on Parent Board now', !(await visible('🧹 Manage Chores')));
  ok('The chore added from Parent Board is visible as an executable occurrence on Family Board too (same persisted chore templates)', await visible('Feed the cat'));

  // ============ No NEW parent-admin controls leaked onto Family Board ============
  ok('Family Board does not show a "Parent Board" Add Item action card', !(await page.getByTestId('action-add-item').isVisible().catch(() => false)));
  ok('Family Board does not show a "Parent Board" Manage Chores action card', !(await page.getByTestId('action-manage-chores').isVisible().catch(() => false)));
  ok('Family Board does not show a Settings control', !(await page.getByTestId('board-settings').isVisible().catch(() => false)));

  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // ============ Shared Display / kiosk (Organizer display) gains nothing new either ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('🖥️ Organizer display').click();
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 }).catch(() => {});
  ok('Organizer/Shared Display renders (kiosk view, unified agenda)', await page.getByTestId('family-agenda').isVisible());
  ok('Shared Display shows no "Add Item" action card', !(await page.getByTestId('action-add-item').isVisible().catch(() => false)));
  ok('Shared Display shows no "Manage Chores" action card', !(await page.getByTestId('action-manage-chores').isVisible().catch(() => false)));
  ok('Shared Display shows no parent-owned Add Item panel', !(await page.getByTestId('add-item-panel').isVisible().catch(() => false)));
  ok('Shared Display shows no parent-owned chore-management panel', !(await page.getByTestId('chore-management-panel').isVisible().catch(() => false)));
  ok('Shared Display shows no item-type quick-create buttons at all (kiosk stays create-free)', !(await page.getByRole('button', { name: '+ Assignment' }).isVisible().catch(() => false)));
  ok('Shared Display shows no "+ Add a chore" control (kiosk stays chore-definition-free)', !(await page.getByText('+ Add a chore').isVisible().catch(() => false)));

  // Exit kiosk back to Parent mode for the next check.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // ============ Child Home remains unaffected ============
  // Board Selector's Learners section is a direct child-selection entry
  // point (navigation refactor), but a child's Parents Page (used here) is
  // specifically reached via Parent Board's "Upload Homework/Photo" action
  // instead. Child Home (the game/My Day view) is a wholly separate
  // App.jsx render path that never imports any of these Parent Board
  // panels in the first place, so it's not separately re-verified here.
  await page.getByTestId('board-parent').click();
  await page.getByTestId('action-upload-homework').click();
  await page.getByTestId('parent-organizer-panel').getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Child\'s unlocked Parents Page view shows no "Add Item" action card either', !(await page.getByTestId('action-add-item').isVisible().catch(() => false)));
  ok('Child\'s unlocked Parents Page view shows no "Manage Chores" action card either', !(await page.getByTestId('action-manage-chores').isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
