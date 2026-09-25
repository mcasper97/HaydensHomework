/**
 * Focused coverage for the Family Board rolling-day redesign (grid layout,
 * minimal header, focus/de-emphasis, execution-window sections, no-scroll
 * board layout) — UPDATED for the UX density correction: the board is now
 * a rolling 5-day window (Today + next 4 calendar days) with Today
 * rendered roughly 3x the width of each future-day column, rather than the
 * original 7-equal-width-columns layout. See
 * tests/rolling-week-board.unit.mjs for deterministic proof of the exact
 * date math (including the spec's own "if today is Friday ->
 * Fri/Sat/Sun/Mon/Tue" example, and a Monday-start window that contains no
 * weekend day at all, both using an injected `today` so they're
 * reproducible on any real calendar day) — this file proves the DOM/visual
 * side against whatever today actually is. See
 * tests/family-agenda.playwright.cjs for the data-layer proofs (ownership,
 * chore projection, completion persistence, admin-free boundary) this file
 * deliberately does not re-prove in depth.
 *
 * Seeds two learners named "Hayden" and "Payton" — the task's own example
 * family — but every assertion below locates their focus controls by the
 * live child's name/emoji text, never a hardcoded id.
 *
 * Usage:
 *   npm run dev                                          # in one terminal
 *   node tests/family-board-rolling-5day.playwright.cjs   # in another
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

// Mirrors src/organizer/rollingWeekBoard.js's own date math exactly.
function expectedRollingDates() {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(isoDate(i));
  return out;
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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Setup: two learners (the task's own example family) ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Hayden');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Hayden');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Payton');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Payton');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // One item each for Hayden and Payton, plus one family-wide item — all
  // dated today so they're guaranteed to show up regardless of which
  // window they map into.
  await page.evaluate((today) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    const children = JSON.parse(localStorage.getItem('crestly_admin_children') || '[]');
    const hayden = children.find((c) => c.name === 'Hayden');
    const payton = children.find((c) => c.name === 'Payton');
    items.push(
      { id: 'seed-hayden-item', type: 'assignment', title: 'Hayden Worksheet', childIds: [hayden.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'seed-payton-item', type: 'assignment', title: 'Payton Worksheet', childIds: [payton.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'seed-family-item', type: 'family_event', title: 'Family Dinner', childIds: [], startDate: today, allDay: true, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    );
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, isoDate(0));

  // ============ Load Family Board ============
  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });

  // ============ Section 1: rolling 5-day layout ============
  const columns = page.locator('[data-testid="week-day-column"]');
  ok('Exactly FIVE day columns render (not seven)', await columns.count() === 5);

  const expectedDates = expectedRollingDates();
  const actualDates = await columns.evaluateAll((els) => els.map((el) => el.getAttribute('data-date')));
  ok('Columns are exactly five consecutive calendar days in order', JSON.stringify(actualDates) === JSON.stringify(expectedDates));
  ok('The leftmost (first) column is today', actualDates[0] === expectedDates[0] && (await columns.first().getAttribute('data-today')) === 'true');
  ok('No other column is marked as today', (await page.locator('[data-testid="week-day-column"][data-today="true"]').count()) === 1);
  ok('Exactly four future (non-today) columns exist', (await page.locator('[data-testid="week-day-column"][data-today="false"]').count()) === 4);

  // Weekends are never SKIPPED (whichever, if any, fall inside these 5
  // consecutive days must actually be present as their own column) — a
  // stronger, day-of-week-independent version of "Saturday/Sunday remain
  // visible" that tests/rolling-week-board.unit.mjs also proves exactly
  // for the spec's own Friday example via an injected `today`.
  const weekdays = expectedDates.map((d) => new Date(`${d}T00:00:00`).getDay());
  for (const [i, wd] of weekdays.entries()) {
    if (wd === 6 || wd === 0) {
      ok(`The ${wd === 6 ? 'Saturday' : 'Sunday'} column (${expectedDates[i]}) is visible on screen, not skipped`, await columns.nth(i).isVisible());
    }
  }

  // ============ Section 2: Today's column is dominant / wide-column treatment ============
  const todayBox = await page.locator('[data-testid="week-day-column"][data-today="true"]').boundingBox();
  const futureBoxes = await page.locator('[data-testid="week-day-column"][data-today="false"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  ok('Today\'s column has the data-column-density="today" marker', await page.locator('[data-testid="week-day-column"][data-today="true"]').getAttribute('data-column-density') === 'today');
  ok('Every future column has the data-column-density="future" marker', (await page.locator('[data-testid="week-day-column"][data-today="false"]').evaluateAll((els) => els.every((el) => el.getAttribute('data-column-density') === 'future'))));
  const avgFutureWidth = futureBoxes.reduce((a, b) => a + b, 0) / futureBoxes.length;
  ok(
    `Today's column is roughly 3x a future column's width (today=${Math.round(todayBox.width)}px, avg future=${Math.round(avgFutureWidth)}px)`,
    todayBox.width > avgFutureWidth * 2.3 && todayBox.width < avgFutureWidth * 3.8
  );
  ok('All four future columns are approximately equal width to each other', Math.max(...futureBoxes) - Math.min(...futureBoxes) < Math.max(...futureBoxes) * 0.15);

  // ============ Section 3: minimal header ============
  ok('Header shows the "Haydens - Homework / Family Board" title', await visible('Haydens - Homework'));
  ok('Header shows a live clock (current time)', /\d{1,2}:\d{2}/.test((await page.getByTestId('board-clock').textContent()) || ''));
  ok('Header never shows a separate calendar-date element', (await page.getByTestId('board-date').count()) === 0);
  ok('Header never shows a weather indicator', !(await page.getByTestId('board-weather').isVisible().catch(() => false)) && (await page.locator('text=/°F|°C/').count()) === 0);

  const allBtn = page.getByTestId('agenda-filter-all');
  const haydenBtn = page.locator('[data-testid^="board-focus-child-"]').filter({ hasText: 'Hayden' });
  const paytonBtn = page.locator('[data-testid^="board-focus-child-"]').filter({ hasText: 'Payton' });
  const familyBtn = page.getByTestId('board-focus-family');
  ok('Large focus controls exist: All / Hayden / Payton / Family', await allBtn.isVisible() && await haydenBtn.isVisible() && await paytonBtn.isVisible() && await familyBtn.isVisible());
  const allBox = await allBtn.boundingBox();
  ok('Focus controls are large, obviously-touchable targets (>= 48px tall)', !!allBox && allBox.height >= 48);

  // ============ Section 4/5: focus = de-emphasis, never hiding (Today's column) ============
  const haydenRow = () => page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Hayden Worksheet' }).first();
  const paytonRow = () => page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Payton Worksheet' }).first();
  const familyRow = () => page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Family Dinner' }).first();

  ok('All selected: Hayden\'s item is at full emphasis', (await haydenRow().getAttribute('data-emphasis')) === 'prominent');
  ok('All selected: Payton\'s item is at full emphasis', (await paytonRow().getAttribute('data-emphasis')) === 'prominent');
  ok('All selected: the family item is at full emphasis', (await familyRow().getAttribute('data-emphasis')) === 'prominent');
  ok('All three seeded rows render in Today\'s (wide) column, not a future column', (await haydenRow().getAttribute('data-column')) === 'today');

  await haydenBtn.click();
  await page.waitForTimeout(150);
  ok('Hayden focused: Hayden\'s own item stays prominent', (await haydenRow().getAttribute('data-emphasis')) === 'prominent');
  ok('Hayden focused: Payton\'s item is still VISIBLE...', await paytonRow().isVisible());
  ok('...but de-emphasized (muted/compact), never hidden', (await paytonRow().getAttribute('data-emphasis')) === 'muted');
  ok('Hayden focused: the family item is still visible but de-emphasized', await familyRow().isVisible() && (await familyRow().getAttribute('data-emphasis')) === 'muted');

  await paytonBtn.click();
  await page.waitForTimeout(150);
  ok('Payton focused: Payton\'s own item stays prominent', (await paytonRow().getAttribute('data-emphasis')) === 'prominent');
  ok('Payton focused: Hayden\'s item is still visible but de-emphasized', await haydenRow().isVisible() && (await haydenRow().getAttribute('data-emphasis')) === 'muted');
  ok('Payton focused: the family item is still visible but de-emphasized', await familyRow().isVisible() && (await familyRow().getAttribute('data-emphasis')) === 'muted');

  await familyBtn.click();
  await page.waitForTimeout(150);
  ok('Family focused: the family item stays prominent', (await familyRow().getAttribute('data-emphasis')) === 'prominent');
  ok('Family focused: Hayden\'s item is still visible but de-emphasized', await haydenRow().isVisible() && (await haydenRow().getAttribute('data-emphasis')) === 'muted');
  ok('Family focused: Payton\'s item is still visible but de-emphasized', await paytonRow().isVisible() && (await paytonRow().getAttribute('data-emphasis')) === 'muted');

  await allBtn.click();
  await page.waitForTimeout(150);
  ok('Back to All: everyone is prominent again', (await haydenRow().getAttribute('data-emphasis')) === 'prominent' && (await paytonRow().getAttribute('data-emphasis')) === 'prominent');

  // ============ Section 6: execution-window sections render ============
  const todayColumn = page.locator('[data-testid="week-day-column"][data-today="true"]');
  ok('The Today execution-window section renders (populated)', await todayColumn.getByTestId('week-window-today').isVisible());
  ok('The Today window uses the exact requested label wording', await todayColumn.getByTestId('week-window-today').getByText('Today', { exact: true }).isVisible());

  // ============ Section 3/7: completion behavior still works ============
  await haydenRow().getByRole('button', { name: 'Mark complete' }).click();
  await page.waitForTimeout(300);
  ok('Marking an item complete from the rolling-day board still persists', await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    return items.find((it) => it.title === 'Hayden Worksheet')?.status === 'completed';
  }));

  // ============ Section 9: Family Board remains execution-only ============
  ok('No Add Item control', (await page.getByTestId('action-add-item').count()) === 0);
  ok('No Manage Chores control', (await page.getByTestId('action-manage-chores').count()) === 0);
  ok('No Settings control', (await page.getByTestId('board-settings').count()) === 0);

  // ============ Section 8: no page-level scroll container on the board ============
  const gridOverflow = await page.getByTestId('family-week-board').evaluate((el) => getComputedStyle(el).overflow);
  ok('The rolling-day grid itself declares no scroll overflow (overflow: hidden, not auto/scroll)', gridOverflow === 'hidden');
  const bodyOverflowY = await page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
  const bodyOverflowX = await page.evaluate(() => getComputedStyle(document.documentElement).overflowX);
  ok('No vertical scroll is forced via an explicit scroll style on the root', bodyOverflowY !== 'scroll');
  ok('No horizontal scroll is forced via an explicit scroll style on the root', bodyOverflowX !== 'scroll');
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok('The page does not actually overflow horizontally at this viewport size', !hasHorizontalOverflow);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
