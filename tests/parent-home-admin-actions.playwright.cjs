/**
 * SHIP BLOCKER correction regression test: Parent Home's "Add Item" and
 * "Manage Chores" actions must open their own parent-owned panels directly
 * on Parent Home (src/organizer/AddItemPanel.jsx, src/ChoreManagementPanel.jsx)
 * and must NEVER navigate into Family Board / Shared Display.
 *
 * Product boundary being enforced:
 *   Parent Home        — parent administrative actions
 *   Family Board/Shared — glance + execute household responsibilities only;
 *                         no parent-admin dependency, no item creation UI of
 *                         its own reachable FROM Parent Home, no new
 *                         chore-definition controls beyond what it already had
 *
 * Add Item's create logic (SourceRecord + createItem) is extracted into
 * AddItemPanel.jsx, reused by both Parent Home and ParentOrganizer.jsx
 * (Family Board's own Add Item affordance) — not duplicated. Manage
 * Chores' template add/remove logic is extracted into
 * data/choreTemplatesRepository.js, reused by both the new
 * ChoreManagementPanel.jsx (Parent Home) and FamilyBoard.jsx's own
 * (unchanged) Manage Chores block — not duplicated.
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
  await page.waitForSelector('text=Parent Home');

  await page.getByTestId('action-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  await page.getByText('← Parent Home').click();
  await page.waitForSelector('text=Parent Home');

  // ============ Add Item: opens in place, never navigates to Family Board ============
  ok('Add Item panel is not visible before tapping the action card', !(await page.getByTestId('add-item-panel').isVisible().catch(() => false)));
  await page.getByTestId('action-add-item').click();
  ok('Tapping "Add Item" keeps the "Parent Home" heading visible (no navigation away)', await visible('Parent Home'));
  ok('Tapping "Add Item" does NOT show the Family Board heading', !(await page.getByText(/🏠.*Family Board/).isVisible().catch(() => false)));
  ok('Tapping "Add Item" does NOT show Family Board\'s "🔆 Today" section', !(await visible('🔆 Today')));
  ok('Tapping "Add Item" reveals the parent-owned Add Item panel', await page.getByTestId('add-item-panel').isVisible());
  ok('The Add Item panel shows the existing item-type quick-create buttons', await page.getByRole('button', { name: '+ Assignment' }).isVisible());

  await page.getByRole('button', { name: '+ Assignment' }).click();
  const form = page.locator('form');
  ok('Clicking a type opens the existing ItemForm inline on Parent Home', await form.isVisible());
  await form.getByPlaceholder('Title').fill('Book Report Draft');
  const today = new Date().toISOString().slice(0, 10);
  await form.locator('input[type="date"]').first().fill(today);
  await form.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(400);

  ok('Submitting creates a real canonical Item (existing persistence unchanged)', (await readItems()).some((it) => it.title === 'Book Report Draft'));
  const createdItem = (await readItems()).find((it) => it.title === 'Book Report Draft');
  ok('The created item has a sourceRecordId (existing provenance behavior preserved)', !!createdItem?.sourceRecordId);
  ok('A confirmation is shown after adding, still on Parent Home', await visible('Added!'));
  ok('Still on Parent Home after the whole Add Item flow (never navigated to Family Board)', await visible('Parent Home') && !(await visible('🔆 Today')));

  // Collapse it back down.
  await page.getByTestId('action-add-item').click();
  ok('Tapping "Add Item" again collapses its panel', !(await page.getByTestId('add-item-panel').isVisible().catch(() => false)));

  // ============ Manage Chores: opens in place, never navigates to Family Board ============
  ok('Chore management panel is not visible before tapping the action card', !(await page.getByTestId('chore-management-panel').isVisible().catch(() => false)));
  await page.getByTestId('action-manage-chores').click();
  ok('Tapping "Manage Chores" keeps the "Parent Home" heading visible (no navigation away)', await visible('Parent Home'));
  ok('Tapping "Manage Chores" does NOT show the Family Board heading', !(await page.getByText(/🏠.*Family Board/).isVisible().catch(() => false)));
  ok('Tapping "Manage Chores" does NOT show Family Board\'s "📅 Coming Up" section', !(await visible('📅 Coming Up')));
  ok('Tapping "Manage Chores" reveals the parent-owned chore-management panel', await page.getByTestId('chore-management-panel').isVisible());
  ok('The panel lists the existing learner (Ava)', await visible('Ava'));

  const chorePanel = page.getByTestId('chore-management-panel');
  await chorePanel.getByText('+ Add a chore').click();
  await chorePanel.getByPlaceholder('e.g. Empty upstairs trash').fill('Feed the cat');
  await chorePanel.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(300);

  ok('Adding a chore persists a real chore template (existing persistence unchanged)', Object.values(await readChoreTemplates()).flat().some((c) => c.text === 'Feed the cat'));
  ok('The new chore is visible in the panel', await visible('Feed the cat'));
  ok('Still on Parent Home after the whole Manage Chores flow (never navigated to Family Board)', await visible('Parent Home') && !(await visible('📅 Coming Up')));

  // ============ Family Board still renders/works independently, with the same underlying data ============
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board renders independently ("🔆 Today")', await visible('🔆 Today'));
  ok('Family Board still shows its own Add Item quick-create row ("+ Assignment") — unchanged existing behavior', await page.getByRole('button', { name: '+ Assignment' }).isVisible());
  ok('The item added from Parent Home is visible on Family Board too (same canonical Item store)', await visible('Book Report Draft'));
  ok('Family Board still shows its own Manage Chores section — unchanged existing behavior', await visible('🧹 Manage Chores'));
  ok('The chore added from Parent Home is visible on Family Board too (same persisted chore templates)', await visible('Feed the cat'));

  // ============ No NEW parent-admin controls leaked onto Family Board ============
  ok('Family Board does not show a "Parent Home" Add Item action card', !(await page.getByTestId('action-add-item').isVisible().catch(() => false)));
  ok('Family Board does not show a "Parent Home" Manage Chores action card', !(await page.getByTestId('action-manage-chores').isVisible().catch(() => false)));
  ok('Family Board does not show a Settings control', !(await page.getByTestId('action-settings').isVisible().catch(() => false)));

  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 }).catch(() => {});

  // ============ Shared Display / kiosk (Organizer display) gains nothing new either ============
  await page.getByTestId('action-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('🖥️ Organizer display').click();
  await page.waitForSelector('text=🔆 Today', { timeout: 5000 }).catch(() => {});
  ok('Organizer/Shared Display renders (kiosk view)', await visible('🔆 Today'));
  ok('Shared Display shows no "Add Item" action card', !(await page.getByTestId('action-add-item').isVisible().catch(() => false)));
  ok('Shared Display shows no "Manage Chores" action card', !(await page.getByTestId('action-manage-chores').isVisible().catch(() => false)));
  ok('Shared Display shows no parent-owned Add Item panel', !(await page.getByTestId('add-item-panel').isVisible().catch(() => false)));
  ok('Shared Display shows no parent-owned chore-management panel', !(await page.getByTestId('chore-management-panel').isVisible().catch(() => false)));
  ok('Shared Display shows no item-type quick-create buttons at all (kiosk stays create-free)', !(await page.getByRole('button', { name: '+ Assignment' }).isVisible().catch(() => false)));
  ok('Shared Display shows no "+ Add a chore" control (kiosk stays chore-definition-free)', !(await page.getByText('+ Add a chore').isVisible().catch(() => false)));

  // Exit kiosk back to Parent mode for the next check.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 }).catch(() => {});

  // ============ Child Home remains unaffected ============
  // Parent Home no longer has a direct child-selection card (removed in a
  // later UI cleanup) — a child's Parents Page is now reached via the
  // "Upload Homework/Photo" action instead. Child Home (the game/My Day
  // view) is a wholly separate App.jsx render path that never imports any
  // of these Parent Home panels in the first place, so it's not
  // separately re-verified here.
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
