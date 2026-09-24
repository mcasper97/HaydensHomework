/**
 * Surface-boundary regression test for the unified Family Board (Section
 * 14-24 of the Family Board redesign task) — proves the admin boundary
 * holds end-to-end on BOTH Family Board render paths (kiosk=false, the
 * authenticated parent's own "Family Board" button, and kiosk=true, the
 * Shared Display / wall-tablet surface), not just that individual buttons
 * are absent from a screenshot.
 *
 * CORRECTED: an earlier version of this file predated the unified-agenda
 * redesign and asserted the OPPOSITE of current, correct behavior — that
 * Family Board (kiosk=false) has its own "+ Assignment" Add Item row and a
 * full ParentOrganizer instance. That was true before the redesign; it is
 * no longer true. Item creation and chore-template management now live
 * ONLY on Parent Board (src/ParentBoard.jsx's "Add Item"/"Manage Chores"
 * actions) — Family Board, in BOTH its kiosk=false and kiosk=true forms,
 * is execution-only: view Items + projected chore occurrences, mark a
 * chore or item done/undone, nothing else. This file now proves exactly
 * that, using Parent Board to seed the Item/chore it then goes and checks
 * for on both Family Board surfaces.
 *
 * Exercises the guest/local-demo storage path (localStorage-backed), same
 * as every other *.playwright.cjs file in this suite.
 *
 * Usage:
 *   npm run dev                                                # in one terminal
 *   node tests/family-board-surface-boundary.playwright.cjs     # in another
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
  const notVisibleByRole = async (name) => !(await page.getByRole('button', { name }).isVisible().catch(() => false));
  const notVisibleTestId = async (testId) => !(await page.getByTestId(testId).isVisible().catch(() => false));
  const readChoreTemplates = () =>
    page.evaluate(() => (JSON.parse(localStorage.getItem('crestly_admin_chores') || '{}').templates) || {});
  const readChoreCompletions = () =>
    page.evaluate(() => (JSON.parse(localStorage.getItem('crestly_admin_chores') || '{}').completions) || {});
  const readItems = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_items') || '[]'));

  // ============ Setup: one learner, one chore template, one dated Item — all seeded via Parent Board ============
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

  await page.getByTestId('action-manage-chores').click();
  await page.waitForSelector('[data-testid="chore-management-panel"]');
  const chorePanel = page.getByTestId('chore-management-panel');
  await chorePanel.getByText('+ Add a chore').click();
  await chorePanel.getByPlaceholder('e.g. Empty upstairs trash').fill('Set the table');
  await chorePanel.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(300);
  ok('Setup: chore template seeded via Parent Board', Object.values(await readChoreTemplates()).flat().some((c) => c.text === 'Set the table'));
  await page.getByText('← Back to Parent Board').click();

  await page.getByTestId('action-add-item').click();
  await page.getByRole('button', { name: '+ Assignment' }).click();
  const boardForm = page.locator('form');
  await boardForm.getByPlaceholder('Title').fill('Board-Created Worksheet');
  await boardForm.locator('input[type="date"]').first().fill(todayIso());
  await boardForm.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(300);
  ok('Setup: Item seeded via Parent Board\'s Add Item action', (await readItems()).some((it) => it.title === 'Board-Created Worksheet'));
  await page.getByText('← Back to Parent Board').click();
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Family Board (kiosk=false) — authenticated parent's own "Family Board" button ============
  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 });

  ok('Family Board (kiosk=false) shows the unified agenda', await page.getByTestId('family-agenda').isVisible());
  ok('Family Board (kiosk=false) shows the seeded Item', await visible('Board-Created Worksheet'));
  ok('Family Board (kiosk=false) shows the seeded chore', await visible('Set the table'));
  ok('Family Board (kiosk=false) has NO Add Item control', await notVisibleByRole('+ Assignment'));
  ok('Family Board (kiosk=false) has NO action-add-item control', await notVisibleTestId('action-add-item'));
  ok('Family Board (kiosk=false) has NO Manage Items control', await notVisibleTestId('action-manage-items'));
  ok('Family Board (kiosk=false) has NO Manage Chores control', await notVisibleTestId('action-manage-chores'));
  ok('Family Board (kiosk=false) has NO chore-template add control', !(await page.getByText('+ Add a chore').isVisible().catch(() => false)));
  ok('Family Board (kiosk=false) has NO Settings entry point', await notVisibleTestId('board-settings'));
  ok('Family Board (kiosk=false) has NO Item Edit control', !(await page.getByText('Edit', { exact: true }).isVisible().catch(() => false)));
  ok('Family Board (kiosk=false) has NO Item Delete control', !(await page.getByLabel('Delete').isVisible().catch(() => false)));
  // Completion (the one approved interaction on both Family Board surfaces)
  // is proven below on Shared Display, once, so the seeded chore/Item stay
  // in their pre-completion state for this section's own "still visible on
  // the kiosk view" assertions later (see bucketItems.js's existing
  // ACTIONABLE_STATUSES rule: a completed one-time Item is correctly
  // excluded from every date bucket, and would otherwise defeat those
  // later visibility checks) — this file's own job is the admin-control
  // boundary, not re-proving completion persistence (already covered in
  // depth by tests/family-agenda.playwright.cjs).

  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // ============ Shared Display (kiosk=true) — local "Organizer display" device-mode setting ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('🖥️ Organizer display').click();
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 });

  ok('Shared Display (device-mode kiosk) shows the unified agenda', await page.getByTestId('family-agenda').isVisible());
  ok('Shared Display shows no Item-creation controls at all', await notVisibleByRole('+ Assignment'));
  ok('Shared Display shows no action-add-item control', await notVisibleTestId('action-add-item'));
  ok('Shared Display shows no Manage Items control', await notVisibleTestId('action-manage-items'));
  ok('Shared Display shows no Manage Chores control', await notVisibleTestId('action-manage-chores'));
  ok('Shared Display shows no chore-template add control', !(await page.getByText('+ Add a chore').isVisible().catch(() => false)));
  ok('Shared Display shows no per-chore remove ("×") control either (no template CRUD of any kind)', !(await page.getByLabel('Remove chore').isVisible().catch(() => false)));
  ok('Shared Display shows no Settings entry point', await notVisibleTestId('board-settings'));

  // ---- the one approved interaction: marking an eligible chore done ----
  ok('Shared Display shows the seeded chore, due today, for execution', await visible('Set the table'));
  const choreRow = page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Set the table' });
  await choreRow.getByRole('button', { name: 'Mark complete' }).click();
  await page.waitForTimeout(300);
  const completionsAfterKiosk = await readChoreCompletions();
  const todayCompletions = Object.values(completionsAfterKiosk).flatMap((byDate) => Object.values(byDate || {})).flat();
  ok('Marking a chore done from Shared Display actually persists a completion (execution still works)', todayCompletions.length > 0);

  // ---- the earlier-seeded Item is visible (view) but not editable from the kiosk view ----
  const kioskItemRow = page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Board-Created Worksheet' });
  ok('The item created earlier is also visible (view) on Shared Display', await kioskItemRow.isVisible());
  ok('Shared Display does not expose Edit/Delete for it (execution-only, no management)', !(await kioskItemRow.getByText('Edit').isVisible().catch(() => false)) && !(await kioskItemRow.getByLabel('Delete').isVisible().catch(() => false)));

  // Exit kiosk back to Parent mode.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // ============ Shared Display (kiosk=true) — the ?board=1 URL, a second independent entry point ============
  await page.goto(`${BASE}/?board=1`, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 });

  ok('?board=1 kiosk route also shows the unified agenda', await page.getByTestId('family-agenda').isVisible());
  ok('?board=1 kiosk route also shows no Item-creation controls', await notVisibleByRole('+ Assignment'));
  ok('?board=1 kiosk route also shows no chore-template add control', !(await page.getByText('+ Add a chore').isVisible().catch(() => false)));
  ok('?board=1 kiosk route also shows no per-chore remove control', !(await page.getByLabel('Remove chore').isVisible().catch(() => false)));
  ok('?board=1 kiosk route shows no "Add Item"/"Manage Items"/"Manage Chores" Parent Board action cards (different code path, same guarantee)', await notVisibleTestId('action-add-item') && await notVisibleTestId('action-manage-items') && await notVisibleTestId('action-manage-chores'));
  ok('?board=1 kiosk route can still view the previously-created item', await visible('Board-Created Worksheet'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
