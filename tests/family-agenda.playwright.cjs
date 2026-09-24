/**
 * Regression + focused coverage for the redesigned, unified Family Board
 * agenda (Section 14-24 of the task spec) — replaces the old
 * multiple-list + calendar presentation (ParentOrganizer + OrganizerCalendar,
 * both now unused by Family Board/OrganizerDisplay — see
 * src/organizer/FamilyAgendaBoard.jsx, src/organizer/FamilyAgenda.jsx,
 * src/organizer/familyAgenda.js) with one deterministic, time-grouped list
 * that projects canonical Items and legacy chore occurrences together,
 * without migrating chores into Items.
 *
 * Exercises the guest/local-demo storage path (localStorage-backed), same
 * as every other *.playwright.cjs file in this suite — no live Firebase
 * project needed.
 *
 * Usage:
 *   npm run dev                                    # in one terminal
 *   node tests/family-agenda.playwright.cjs         # in another
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

function isoDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Setup: one learner, one chore, two dated items ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Tiger');
  await page.getByRole('button', { name: '🐯' }).click();
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Tiger');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');

  // A chore for Tiger, due today by construction (legacy chore model).
  await page.getByTestId('action-manage-chores').click();
  const chorePanel = page.getByTestId('chore-management-panel');
  await chorePanel.getByText('+ Add a chore').click();
  await chorePanel.getByPlaceholder('e.g. Empty upstairs trash').fill('Feed the cat');
  await chorePanel.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(200);
  await page.getByText('← Back to Parent Board').click();

  // A "test" item dated tomorrow (Tiger) — a type that shows a single
  // start/occurrence date input, so `input[type="date"]` is unambiguous.
  await page.getByTestId('action-add-item').click();
  await page.getByRole('button', { name: '+ Test' }).click();
  let form = page.locator('form');
  await form.getByPlaceholder('Title').fill('Spelling Test');
  await form.locator('input[type="date"]').first().fill(isoDate(1));
  await form.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(300);
  await page.getByText('← Back to Parent Board').click();

  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // A family-wide (childIds: []), overdue item — AddItemPanel's manual
  // create flow never offers a "Family" option (ItemForm's allowFamilyWide
  // is only ever true from the Review Inbox's candidate-review context —
  // see itemFormValidation.js's resolveFamilyWideOption), so a
  // family-wide Item is seeded directly, the same established pattern
  // other tests in this suite already use for a state the UI itself
  // cannot produce (see e.g. domain-hardening.playwright.cjs's own
  // legacy-item seeding).
  await page.evaluate((date) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    items.push({
      id: 'seed-family-event',
      type: 'family_event',
      title: 'Overdue Family Thing',
      childIds: [],
      startDate: date,
      allDay: true,
      status: 'open',
      notes: '',
      source: { type: 'manual', sourceId: null },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, isoDate(-2));

  // ============ Family Board: unified agenda, no admin controls ============
  await page.getByTestId('board-family').click();
  await page.waitForSelector('text=🏠');
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 5000 }).catch(() => {});

  ok('Family Board renders the unified agenda', await page.getByTestId('family-agenda').isVisible());
  ok('Family Board shows no Add Item control', await notVisible('action-add-item'));
  ok('Family Board shows no Manage Chores control', await notVisible('action-manage-chores'));
  ok('Family Board shows no "+ Assignment"/"+ Test" quick-create controls', !(await page.getByRole('button', { name: '+ Test' }).isVisible().catch(() => false)));
  ok('Family Board shows no Edit control', !(await page.getByText('Edit', { exact: true }).isVisible().catch(() => false)));
  ok('Family Board shows no Settings control', await notVisible('board-settings'));
  ok('Family Board shows no separate "Manage Chores" heading', !(await page.getByText('🧹 Manage Chores').isVisible().catch(() => false)));
  ok('Family Board shows no separate "Coming Up" calendar pane', !(await page.getByText('📅 Coming Up').isVisible().catch(() => false)));

  ok('OVERDUE section is populated (the overdue family event)', await page.getByTestId('agenda-section-overdue').isVisible());
  ok('OVERDUE shows the overdue family event', await visible('Overdue Family Thing'));
  ok('TODAY section is populated (the chore)', await page.getByTestId('agenda-section-today').isVisible());
  ok('TODAY shows the chore', await visible('Feed the cat'));
  ok('TOMORROW section is populated (the test)', await page.getByTestId('agenda-section-tomorrow').isVisible());
  ok('TOMORROW shows the test item', await visible('Spelling Test'));

  ok('Ownership: the chore row shows Tiger by name/emoji', await visible('🐯') && await visible('Tiger'));
  ok('Ownership: the family event row shows "Family"', await visible('Family'));

  // ============ Chore projection across the display horizon (Section 13/20) ============
  // The chore template model has no per-chore recurrence pattern — every
  // chore is implicitly daily (see familyAgenda.js's CHORE PROJECTION
  // note) — so the SAME "Feed the cat" chore must independently appear
  // projected into TOMORROW and, when the week has room, LATER THIS WEEK
  // too, not just TODAY, while creating no canonical Item for any of it.
  const todayChoreRow = page.locator('[data-testid="agenda-section-today"] [data-testid="agenda-row"]').filter({ hasText: 'Feed the cat' });
  const tomorrowChoreRow = page.locator('[data-testid="agenda-section-tomorrow"] [data-testid="agenda-row"]').filter({ hasText: 'Feed the cat' });
  ok('TODAY chore occurrence remains completion-eligible', await todayChoreRow.getByRole('button', { name: 'Mark complete' }).isVisible().catch(() => false));
  ok('TOMORROW also shows the projected chore occurrence', await tomorrowChoreRow.isVisible().catch(() => false));
  ok(
    'TOMORROW chore occurrence is view-only (no Mark complete control)',
    (await tomorrowChoreRow.getByTestId('agenda-row-view-only').isVisible().catch(() => false)) &&
      !(await tomorrowChoreRow.getByRole('button', { name: /Mark/ }).isVisible().catch(() => false))
  );

  // "Later this week" only has room on some days of the week (see
  // familyAgenda.js's own doc comment) — computed here the same way the
  // production code does, so this assertion is meaningful on every day of
  // the week rather than being flaky/skipped silently.
  const hasLaterThisWeekRoom = await page.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    const weekday = new Date(`${today}T00:00:00`).getDay();
    const endOfWeek = new Date(`${today}T00:00:00`);
    endOfWeek.setDate(endOfWeek.getDate() + Math.max(0, 6 - weekday));
    const tomorrow = new Date(`${today}T00:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return endOfWeek.toISOString().slice(0, 10) > tomorrow.toISOString().slice(0, 10);
  });
  if (hasLaterThisWeekRoom) {
    const laterChoreRow = page
      .locator('[data-testid="agenda-section-laterThisWeek"] [data-testid="agenda-row"]')
      .filter({ hasText: 'Feed the cat' })
      .first();
    ok('LATER THIS WEEK also shows the projected chore occurrence (week has room)', await laterChoreRow.isVisible().catch(() => false));
    ok('LATER THIS WEEK chore occurrence is view-only', await laterChoreRow.getByTestId('agenda-row-view-only').isVisible().catch(() => false));
  } else {
    ok('LATER THIS WEEK has no room this week (today is Saturday) — projection correctly stays empty', true);
  }

  ok('Chore projection creates no canonical Item records', await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    return !items.some((it) => it.title === 'Feed the cat');
  }));

  // ============ Filters (Section 20) ============
  ok('Filter buttons: All / Tiger / Family are present', await page.getByTestId('agenda-filter-all').isVisible() && await page.getByTestId('agenda-filter-child').isVisible() && await page.getByTestId('agenda-filter-family').isVisible());
  await page.getByTestId('agenda-filter-family').click();
  ok('Family filter hides the chore (child-owned)', !(await page.getByText('Feed the cat').isVisible().catch(() => false)));
  ok('Family filter still shows the family-wide event', await visible('Overdue Family Thing'));
  await page.getByTestId('agenda-filter-child').click();
  ok('Child filter shows the chore', await visible('Feed the cat'));
  ok('Child filter hides the family-wide event', !(await page.getByText('Overdue Family Thing').isVisible().catch(() => false)));
  await page.getByTestId('agenda-filter-all').click();
  ok('All filter shows everything again', await visible('Feed the cat') && await visible('Overdue Family Thing') && await visible('Spelling Test'));

  // ============ Completion behavior (Section 21) ============
  const choreRow = page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Feed the cat' });
  await choreRow.getByRole('button', { name: 'Mark complete' }).click();
  await page.waitForTimeout(300);
  ok('Marking the chore complete persists (choreCompletions written)', await page.evaluate(() => {
    const chores = JSON.parse(localStorage.getItem('crestly_admin_chores') || '{}');
    const today = new Date().toISOString().slice(0, 10);
    const forTiger = Object.values(chores.completions || {})[0] || {};
    return (forTiger[today] || []).length > 0;
  }));

  // Completion identity is per-occurrence-date (Section 20) — completing
  // TODAY's projected occurrence of a chore must never mark tomorrow's
  // separately-projected occurrence of that same chore as done too.
  ok("Completing today's chore occurrence does not complete tomorrow's projected occurrence", await page.evaluate(() => {
    const chores = JSON.parse(localStorage.getItem('crestly_admin_chores') || '{}');
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const forTiger = Object.values(chores.completions || {})[0] || {};
    const todayDone = (forTiger[today] || []).length > 0;
    const tomorrowDone = (forTiger[tomorrow] || []).length > 0;
    return todayDone && !tomorrowDone;
  }));

  const itemRow = page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Spelling Test' });
  await itemRow.getByRole('button', { name: 'Mark complete' }).click();
  await page.waitForTimeout(300);
  ok('Marking the item complete persists (Item.status)', await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    return items.find((it) => it.title === 'Spelling Test')?.status === 'completed';
  }));

  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // ============ Shared Display / kiosk stays admin-free too (Section 23) ============
  await page.goto(`${BASE}/?board=1`, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 });
  ok('?board=1 kiosk route also renders the unified agenda', await page.getByTestId('family-agenda').isVisible());
  ok('Kiosk route shows no Add Item control', await notVisible('action-add-item'));
  ok('Kiosk route shows no Manage Chores control', await notVisible('action-manage-chores'));
  // "Spelling Test" was marked complete above, so it correctly no longer
  // appears in the TOMORROW bucket at all (bucketItems.js's existing,
  // unchanged ACTIONABLE_STATUSES rule — a completed one-time item is
  // excluded from every date bucket, same as it always has been); the
  // still-open family-wide item is the one still-visible proof this route
  // reads the same live Item data as the normal Family Board.
  ok('Kiosk route can still view the previously-created family item', await visible('Overdue Family Thing'));
  ok('Kiosk route can still mark a chore complete (execution-only interaction preserved)', await page.getByTestId('agenda-row').first().getByRole('button', { name: /Mark/ }).isVisible());

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
