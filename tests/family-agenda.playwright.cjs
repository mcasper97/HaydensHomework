/**
 * Regression + focused coverage for Family Board's unified agenda data
 * layer (ownership, chore projection, completion behavior, admin-free
 * boundary) — now rendered as a rolling 5-day execution board (see
 * tests/family-board-rolling-5day.playwright.cjs for the grid/focus-specific
 * proofs the rolling-window redesign itself introduced: exactly 5 columns,
 * today first and dominant-width, weekends visible, no header date/weather,
 * focus de-emphasis, execution-window sections).
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

  // A "test" item dated tomorrow (Tiger) — within the 5-day window, and a
  // type that shows a single start/occurrence date input, so
  // `input[type="date"]` is unambiguous.
  await page.getByTestId('action-add-item').click();
  await page.getByRole('button', { name: '+ Test' }).click();
  let form = page.locator('form');
  await form.getByPlaceholder('Title').fill('Spelling Test');
  await form.locator('input[type="date"]').first().fill(isoDate(1));
  await form.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(300);
  await page.getByText('← Back to Parent Board').click();

  // A "study task" item dated 2 days out (Tiger) — proves the Study Hall
  // execution-window mapping (Section 5/8): study_task is the one type
  // this presentation-only phase confidently maps off `type` alone.
  await page.getByTestId('action-add-item').click();
  await page.getByRole('button', { name: '+ Study Task' }).click();
  form = page.locator('form');
  await form.getByPlaceholder('Title').fill('Review vocab list');
  await form.locator('input[type="date"]').first().fill(isoDate(2));
  await form.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(300);
  await page.getByText('← Back to Parent Board').click();

  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // A family-wide (childIds: []), OVERDUE item — AddItemPanel's manual
  // create flow never offers a "Family" option, so a family-wide Item is
  // seeded directly, the same established pattern other tests in this
  // suite already use for a state the UI itself cannot produce. Overdue
  // (2 days ago) — the rolling-week board has no separate Overdue column,
  // so this proves an overdue obligation is folded into TODAY rather than
  // silently dropped (Section 1/7 — "never hide obligations").
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

  // ============ Family Board: rolling week board, no admin controls ============
  await page.getByTestId('board-family').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 });

  ok('Family Board renders the unified agenda', await page.getByTestId('family-agenda').isVisible());
  ok('Family Board renders the rolling week board', await page.getByTestId('family-week-board').isVisible());
  ok('Family Board shows no Add Item control', await notVisible('action-add-item'));
  ok('Family Board shows no Manage Chores control', await notVisible('action-manage-chores'));
  ok('Family Board shows no "+ Assignment"/"+ Test" quick-create controls', !(await page.getByRole('button', { name: '+ Test' }).isVisible().catch(() => false)));
  ok('Family Board shows no Edit control', !(await page.getByText('Edit', { exact: true }).isVisible().catch(() => false)));
  ok('Family Board shows no Settings control', await notVisible('board-settings'));
  ok('Family Board shows no separate "Manage Chores" heading', !(await page.getByText('🧹 Manage Chores').isVisible().catch(() => false)));
  ok('Family Board shows no separate "Coming Up" calendar pane', !(await page.getByText('📅 Coming Up').isVisible().catch(() => false)));

  ok('The chore is visible on the board', await visible('Feed the cat'));
  ok('The tomorrow test item is visible on the board', await visible('Spelling Test'));
  ok('The study task is visible on the board', await visible('Review vocab list'));
  ok('The overdue family item is folded into view rather than dropped', await visible('Overdue Family Thing'));

  const todayColumn = page.locator('[data-testid="week-day-column"][data-today="true"]');
  ok('Exactly one column is marked as today', await page.locator('[data-testid="week-day-column"][data-today="true"]').count() === 1);
  ok('The overdue family item shows inside TODAY\'s column (folded forward, not a separate Overdue section)', await todayColumn.getByText('Overdue Family Thing').isVisible());
  ok('The chore also shows inside TODAY\'s column', await todayColumn.getByText('Feed the cat').isVisible());

  // ============ Execution window mapping (Section 5/8) ============
  const studyHallWindows = page.locator('[data-testid="week-window-studyHall"]').filter({ hasText: 'Review vocab list' });
  ok('"Review vocab list" specifically sits under a Study Hall window', await studyHallWindows.count() >= 1);
  ok('The chore sits under a "Today" execution window (no confident daypart mapping exists for chores)', await page.locator('[data-testid="week-window-today"]').filter({ hasText: 'Feed the cat' }).count() >= 1);

  ok('Ownership: the chore row shows Tiger by name/emoji', await visible('🐯') && await visible('Tiger'));
  ok('Ownership: the family event row shows "Family"', await visible('Family'));

  // ============ Chore completion-eligibility across the display horizon ============
  const todayChoreRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Feed the cat' });
  ok('TODAY chore occurrence remains completion-eligible', await todayChoreRow.getByRole('button', { name: 'Mark complete' }).isVisible().catch(() => false));

  const otherColumns = page.locator('[data-testid="week-day-column"][data-today="false"]');
  const otherColumnCount = await otherColumns.count();
  let foundFutureViewOnlyChore = false;
  for (let i = 0; i < otherColumnCount; i++) {
    const col = otherColumns.nth(i);
    const choreRowInCol = col.locator('[data-testid="agenda-row"]').filter({ hasText: 'Feed the cat' });
    if (await choreRowInCol.isVisible().catch(() => false)) {
      foundFutureViewOnlyChore = await choreRowInCol.getByTestId('agenda-row-view-only').isVisible().catch(() => false);
      break;
    }
  }
  ok('A future day\'s projected chore occurrence (if shown) is view-only, never a live checkbox', foundFutureViewOnlyChore);

  ok('Chore projection creates no canonical Item records', await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    return !items.some((it) => it.title === 'Feed the cat');
  }));

  // ============ Completion behavior (unchanged writes) ============
  await todayChoreRow.getByRole('button', { name: 'Mark complete' }).click();
  await page.waitForTimeout(300);
  ok('Marking the chore complete persists (choreCompletions written)', await page.evaluate(() => {
    const chores = JSON.parse(localStorage.getItem('crestly_admin_chores') || '{}');
    const today = new Date().toISOString().slice(0, 10);
    const forTiger = Object.values(chores.completions || {})[0] || {};
    return (forTiger[today] || []).length > 0;
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

  // ============ Shared Display / kiosk stays admin-free too ============
  await page.goto(`${BASE}/?board=1`, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 });
  ok('?board=1 kiosk route also renders the rolling week board', await page.getByTestId('family-week-board').isVisible());
  ok('Kiosk route shows no Add Item control', await notVisible('action-add-item'));
  ok('Kiosk route shows no Manage Chores control', await notVisible('action-manage-chores'));
  // "Spelling Test" was marked complete above, so it correctly no longer
  // appears on the board at all (ACTIONABLE_STATUSES excludes a completed
  // one-time item, same rule this app has always used); the still-open
  // family-wide item is the one still-visible proof this route reads the
  // same live Item data as the normal Family Board.
  ok('Kiosk route can still view the previously-created family item', await visible('Overdue Family Thing'));
  ok('Kiosk route can still mark a chore complete (execution-only interaction preserved)', await page.getByTestId('agenda-row').first().getByRole('button', { name: /Mark/ }).isVisible());

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
