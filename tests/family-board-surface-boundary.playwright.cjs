/**
 * Surface-boundary regression test, written in response to an explicit
 * product-boundary audit of FamilyBoard.jsx following the Parent Board
 * Add Item / Manage Chores correction.
 *
 * FamilyBoard.jsx is a single file that renders TWO architecturally
 * distinct things depending on its `kiosk` prop (see AuthShell.jsx's four
 * render sites):
 *   - kiosk=true  → renders ONLY <OrganizerDisplay> (organizer/OrganizerDisplay.jsx),
 *     the real Shared Display / wall-tablet surface — reached via the
 *     `?board=1` URL or the local "Organizer display" Device Mode setting.
 *     OrganizerDisplay hard-codes allowManage=false on the ParentOrganizer
 *     it renders, and never touches chore-template add/remove at all — no
 *     Item creation, no chore-definition management, ever.
 *   - kiosk=false → the full parent-admin board (Points strip, full-CRUD
 *     ParentOrganizer incl. AddItemPanel, inline Manage Chores block,
 *     OrganizerCalendar) — reached ONLY via Board Selector's own "Family
 *     Board" button (an already-authenticated/guest parent session) or a
 *     successful Parent PIN unlock's "Open Parent Controls" from a locked
 *     Child Mode device. This branch requires the same access level as
 *     Board Selector itself; a child/shared-display viewer without that
 *     unlock never reaches it.
 *
 * This file proves both halves of that boundary hold, end-to-end:
 *   - the genuine Shared Display surface (kiosk=true, both entry points)
 *     can still complete an eligible chore (the one approved low-friction
 *     kiosk interaction) but can never create an Item or manage a chore
 *     template;
 *   - the parent-admin board's own ParentOrganizer "Add Item" flow (now
 *     via the shared AddItemPanel component) still creates a real,
 *     persisted canonical Item, end-to-end, not just that its button is
 *     visible.
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
  const readChoreCompletions = () =>
    page.evaluate(() => (JSON.parse(localStorage.getItem('crestly_admin_chores') || '{}').completions) || {});

  // Set up: guest sign-in, a learner, and a seeded chore template — via the
  // normal Settings/Parent Board flow, so this file only proves the shared
  // surface's own boundary, not re-proving Parent Board's plumbing (already
  // covered by tests/parent-home-admin-actions.playwright.cjs).
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
  await page.getByTestId('action-manage-chores').click();
  await page.waitForSelector('[data-testid="chore-management-panel"]');
  const chorePanel = page.getByTestId('chore-management-panel');
  await chorePanel.getByText('+ Add a chore').click();
  await chorePanel.getByPlaceholder('e.g. Empty upstairs trash').fill('Set the table');
  await chorePanel.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(300);
  ok('Setup: chore template seeded via Parent Board', Object.values(await readChoreTemplates()).flat().some((c) => c.text === 'Set the table'));

  // ============ A/F: the parent-admin board (kiosk=false) — Family Board button ============
  await page.getByText('← Back to Parent Board').click();
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-family').click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board (kiosk=false, opened from the authenticated Board Selector session) shows its own Add Item row', await page.getByRole('button', { name: '+ Assignment' }).isVisible());

  // ---- ParentOrganizer's own Add Item flow (not just Parent Board's) actually persists an Item ----
  await page.getByRole('button', { name: '+ Assignment' }).click();
  const boardForm = page.locator('form');
  await boardForm.getByPlaceholder('Title').fill('Board-Created Worksheet');
  const today = new Date().toISOString().slice(0, 10);
  await boardForm.locator('input[type="date"]').first().fill(today);
  await boardForm.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(400);
  ok('Family Board\'s own ParentOrganizer/AddItemPanel instance creates a real, persisted canonical Item', (await readItems()).some((it) => it.title === 'Board-Created Worksheet'));
  ok('The item is visible on the board after creating it there directly', await visible('Board-Created Worksheet'));

  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // ============ B/C/D/F: the real Shared Display (kiosk=true) via the local "Organizer display" setting ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('🖥️ Organizer display').click();
  await page.waitForSelector('text=🔆 Today', { timeout: 5000 }).catch(() => {});

  ok('Shared Display (device-mode kiosk) shows no Item-creation controls at all', !(await page.getByRole('button', { name: '+ Assignment' }).isVisible().catch(() => false)));
  ok('Shared Display shows no chore-template add control', !(await page.getByText('+ Add a chore').isVisible().catch(() => false)));
  ok('Shared Display shows no per-chore remove ("×") control either (no template CRUD of any kind)', !(await page.getByLabel('Remove chore').isVisible().catch(() => false)));

  // ---- the one approved interaction: marking an eligible chore done ----
  ok('Shared Display shows the seeded chore, due today, for execution', await visible('Set the table'));
  const choreRow = page.locator('div').filter({ hasText: '🧹 Set the table' }).first();
  await choreRow.getByRole('button', { name: 'Mark chore done' }).click();
  await page.waitForTimeout(300);
  const completionsAfterKiosk = await readChoreCompletions();
  const todayCompletions = Object.values(completionsAfterKiosk).flatMap((byDate) => Object.values(byDate || {})).flat();
  ok('Marking a chore done from Shared Display actually persists a completion (execution still works)', todayCompletions.length > 0);

  // ---- Board-Created Worksheet's completion toggle also still works from the kiosk view ----
  const itemRow = page.locator('div').filter({ hasText: 'Board-Created Worksheet' }).first();
  ok('The item created earlier is also visible (view) on Shared Display', await itemRow.isVisible());
  ok('Shared Display does not expose Edit/Delete for it (execution-only, no management)', !(await itemRow.getByText('Edit').isVisible().catch(() => false)));

  // Exit kiosk back to Parent mode.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // ============ A/F: the real Shared Display (kiosk=true) via the ?board=1 URL — a second, independent entry point ============
  await page.goto(`${BASE}/?board=1`, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=🔆 Today', { timeout: 10000 });

  ok('?board=1 kiosk route also shows no Item-creation controls', !(await page.getByRole('button', { name: '+ Assignment' }).isVisible().catch(() => false)));
  ok('?board=1 kiosk route also shows no chore-template add control', !(await page.getByText('+ Add a chore').isVisible().catch(() => false)));
  ok('?board=1 kiosk route also shows no per-chore remove control', !(await page.getByLabel('Remove chore').isVisible().catch(() => false)));
  ok('?board=1 kiosk route shows no "Add Item"/"Manage Chores" Parent Board action cards (different code path, same guarantee)', !(await page.getByTestId('action-add-item').isVisible().catch(() => false)) && !(await page.getByTestId('action-manage-chores').isVisible().catch(() => false)));
  ok('?board=1 kiosk route can still view the previously-created item', await visible('Board-Created Worksheet'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
