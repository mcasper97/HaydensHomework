/**
 * Focused regression test for Parent Board's "Manage Items" action
 * (src/organizer/ManageItemsPanel.jsx) — the restored committed-Item
 * edit/delete surface.
 *
 * Context: the Family Board redesign made Family Board execution-only,
 * which quietly made ParentOrganizer.jsx (the old owner of per-item
 * Edit/Delete) unreachable from anywhere — a real regression discovered
 * during a later full-regression pass (see tests/domain-hardening.playwright.cjs,
 * tests/recurring-reminders.playwright.cjs, and
 * tests/source-record-provenance.playwright.cjs, each of which had to drop
 * their own edit-round-trip coverage for exactly this reason). This file
 * restores that coverage on its correct new surface: Parent Board ->
 * Manage Items, not Family Board.
 *
 * Exercises the guest/local-demo storage path (localStorage-backed), same
 * as every other *.playwright.cjs file in this suite.
 *
 * Usage:
 *   npm run dev                                  # in one terminal
 *   node tests/manage-items.playwright.cjs        # in another
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
  page.on('dialog', (d) => d.accept()); // window.confirm() on Delete
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  const visible = async (text) => page.getByText(text).first().isVisible().catch(() => false);
  const notVisible = async (testId) => !(await page.getByTestId(testId).isVisible().catch(() => false));
  const readItems = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_items') || '[]'));

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
  const avaId = await page.evaluate(() => {
    const children = JSON.parse(localStorage.getItem('crestly_admin_children') || '[]');
    return children.find((c) => c.name === 'Ava')?.id;
  });

  // ============ Parent Board shows the new action ============
  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');
  ok('Parent Board shows the "Manage Items" action card', await page.getByTestId('action-manage-items').isVisible());
  ok('Manage Items panel is not visible before tapping the action card', await notVisible('manage-items-panel'));

  // ============ Seed a committed item with full provenance (simulating an auto-committed ingestion result) ============
  // Directly seeded (rather than created via the UI) so this test can
  // prove provenance survives an edit without needing to also drive the
  // full ingestion pipeline here — that's already covered elsewhere
  // (tests/auto-commit-integration.unit.mjs, tests/source-record-provenance.playwright.cjs).
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate(([date, childId]) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    items.push({
      id: 'seed-manage-item-1',
      type: 'test',
      title: 'Spelling Test',
      childIds: [childId],
      subject: null,
      courseId: null,
      startDate: date,
      startTime: null, dueDate: null, dueTime: null, endDate: null, endTime: null,
      allDay: true,
      status: 'open',
      notes: '',
      parentItemId: null,
      schedule: null,
      sourceRecordId: 'seed-source-record-1',
      sourceCandidateId: 'seed-candidate-1',
      commitMode: 'automatic',
      extractionConfidence: 0.95,
      googleCalendarEventId: null,
      googleCalendarId: null,
      googleCalendarSyncedAt: null,
      googleCalendarSyncError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, [today, avaId]);

  // ============ Opening Manage Items ============
  await page.getByTestId('action-manage-items').click();
  ok('Tapping "Manage Items" opens a focused view with its own "Back to Parent Board" control', await visible('← Back to Parent Board'));
  ok('Tapping "Manage Items" hides the Parent Board action grid (focused view replaces it)', await notVisible('parent-board'));
  ok('Tapping "Manage Items" reveals the Manage Items panel', await page.getByTestId('manage-items-panel').isVisible());
  await page.waitForSelector('[data-testid="manage-items-row"]', { timeout: 5000 }).catch(() => {});
  ok('The seeded, already-committed item appears in the list', await visible('Spelling Test'));
  ok('Manage Items shows no Calendar controls (no "Add to Google Calendar", no "Google Calendar ✓")', !(await page.getByText('Add to Google Calendar').isVisible().catch(() => false)) && !(await page.getByText('Google Calendar ✓').isVisible().catch(() => false)));

  // ============ Edit: opens the existing ItemForm pre-filled, saves onto the SAME Item ============
  const row = page.locator('[data-testid="manage-items-row"]').filter({ hasText: 'Spelling Test' });
  await row.getByText('Edit').click();
  const form = page.locator('form');
  ok('Edit opens the existing ItemForm', await form.isVisible());
  ok('Edit: title pre-fills from the existing item', (await form.getByPlaceholder('Title').inputValue()) === 'Spelling Test');

  await form.getByPlaceholder('Title').fill('Spelling Test (updated)');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(400);

  let items = await readItems();
  ok('Still exactly one item with this id after editing (no duplicate created)', items.filter((it) => it.id === 'seed-manage-item-1').length === 1);
  const edited = items.find((it) => it.id === 'seed-manage-item-1');
  ok('Save updates the SAME item id', edited?.id === 'seed-manage-item-1');
  ok('The edited title persisted', edited?.title === 'Spelling Test (updated)');
  ok('Editing preserves sourceRecordId (provenance)', edited?.sourceRecordId === 'seed-source-record-1');
  ok('Editing preserves sourceCandidateId (provenance)', edited?.sourceCandidateId === 'seed-candidate-1');
  ok('Editing preserves commitMode', edited?.commitMode === 'automatic');
  ok('Editing preserves extractionConfidence', edited?.extractionConfidence === 0.95);
  ok('Editing preserves the existing child assignment (not explicitly changed)', edited?.childIds?.length === 1 && edited.childIds[0] === avaId);
  ok('The updated title is visible in the list', await visible('Spelling Test (updated)'));

  // ============ Delete: removes the canonical Item using existing behavior, no cascade ============
  const updatedRow = page.locator('[data-testid="manage-items-row"]').filter({ hasText: 'Spelling Test (updated)' });
  await updatedRow.getByLabel('Delete').click();
  await page.waitForTimeout(300);

  items = await readItems();
  ok('Delete removes the canonical Item', !items.some((it) => it.id === 'seed-manage-item-1'));
  ok('The deleted item is no longer visible in the list', !(await page.getByText('Spelling Test (updated)').isVisible().catch(() => false)));
  ok('Manage Items list falls back to "No items yet."', await visible('No items yet.'));

  // ============ Back returns to Parent Board ============
  await page.getByText('← Back to Parent Board').click();
  ok('"← Back to Parent Board" collapses the focused view', await notVisible('manage-items-panel'));
  ok('The action grid is restored after Back', await page.getByTestId('parent-board').isVisible());

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
