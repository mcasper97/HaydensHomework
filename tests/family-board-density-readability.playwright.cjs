/**
 * Focused coverage for the Family Board density/readability correction
 * (screenshot review): compact learner points strip, Today's raised
 * visible-item capacity, future-day card readability (no click needed),
 * future cards omitting the completion control when not
 * completion-eligible, and empty execution windows never rendering. See
 * tests/family-board-rolling-5day.playwright.cjs for the grid/column-ratio
 * proofs (unchanged by this slice) and tests/family-agenda.playwright.cjs
 * for the data-layer proofs this file doesn't re-prove in depth.
 *
 * Usage:
 *   npm run dev                                                 # in one terminal
 *   node tests/family-board-density-readability.playwright.cjs   # in another
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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Setup: one learner, a long future title, a recurring chore, 8 Today items ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Riley');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Riley');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Section 6 (isolated): a genuinely empty board shows "Nothing scheduled" everywhere ============
  // Checked BEFORE any chore template exists — a chore projects onto
  // every one of the 5 days (existing, unchanged behavior), so this must
  // run first to get a day that's actually empty, not just visually rare.
  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });
  const emptyDayColumns = page.locator('[data-testid="week-day-column"]');
  ok('With no items/chores at all yet, every one of the 5 columns shows "Nothing scheduled"', await emptyDayColumns.locator('text=Nothing scheduled').count() === 5);
  ok('No execution-window headers render anywhere on a genuinely empty board', (await page.locator('[data-testid^="week-window-"]').count()) === 0);
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');
  await page.getByTestId('action-manage-chores').click();
  const chorePanel = page.getByTestId('chore-management-panel');
  await chorePanel.getByText('+ Add a chore').click();
  await chorePanel.getByPlaceholder('e.g. Empty upstairs trash').fill('Feed the fish');
  await chorePanel.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(200);
  await page.getByText('← Back to Parent Board').click();
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  const longTitle = 'Social Studies Quiz on the Westward Expansion Unit';
  await page.evaluate(({ today, future, longTitle }) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    const children = JSON.parse(localStorage.getItem('crestly_admin_children') || '[]');
    const riley = children.find((c) => c.name === 'Riley');
    // 8 Today-window items — proves the raised visible-item capacity and
    // that "+N more" only appears once content genuinely can't fit.
    for (let i = 1; i <= 8; i++) {
      items.push({
        id: `seed-today-${i}`,
        type: 'assignment',
        title: `Today Item ${i}`,
        childIds: [riley.id],
        dueDate: today,
        status: 'open',
        notes: '',
        source: { type: 'manual', sourceId: null },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    // One future-dated, long-titled test item — proves future-card
    // readability (no click needed to know what it is) and that a
    // one-time item stays completion-eligible (and so keeps its control)
    // even on a future day.
    items.push({
      id: 'seed-future-quiz',
      type: 'test',
      title: longTitle,
      childIds: [riley.id],
      dueDate: future,
      status: 'open',
      notes: '',
      source: { type: 'manual', sourceId: null },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, { today: isoDate(0), future: isoDate(1), longTitle });

  // ============ Load Family Board ============
  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });

  // ============ Section 1: compact learner points strip ============
  const strip = page.getByTestId('learner-points-strip');
  ok('The learner points strip renders', await strip.isVisible());
  ok('It still shows the learner\'s name/emoji identity', await strip.getByText('Riley').isVisible());
  ok('It still shows chore points information', await strip.getByText(/🧹/).isVisible());
  ok('It still shows homework points information', await strip.getByText(/📚/).isVisible());
  ok('No old large purple learner card remains', (await page.locator('text=Chore pts').count()) === 0 && (await page.locator('text=Homework pts').count()) === 0);
  const stripBox = await strip.boundingBox();
  ok(
    `The strip is compact — approximately 45-60px tall (measured ${stripBox ? Math.round(stripBox.height) : 'n/a'}px)`,
    !!stripBox && stripBox.height >= 40 && stripBox.height <= 70
  );

  // ============ Section 3: Today's raised visible-item capacity ============
  const todayColumn = page.locator('[data-testid="week-day-column"][data-today="true"]');
  const todayWindow = todayColumn.getByTestId('week-window-today');
  const visibleTodayItemRows = todayWindow.locator('[data-testid="agenda-row"]').filter({ hasText: /Today Item/ });
  const visibleCount = await visibleTodayItemRows.count();
  ok(
    `Today shows approximately 5-7 actionable rows before overflow (rendered ${visibleCount} of the 8 seeded)`,
    visibleCount >= 5 && visibleCount <= 7
  );
  ok('The remaining seeded items are summarized behind a "+N more" overflow indicator, not silently dropped', await todayWindow.getByTestId('week-window-overflow').isVisible());
  const overflowText = await todayWindow.getByTestId('week-window-overflow').textContent();
  ok(`Overflow count matches exactly what didn't fit (8 - ${visibleCount})`, overflowText.includes(String(8 - visibleCount)));

  // Today's title text size is preserved (still text-base, not shrunk).
  const firstTodayTitle = visibleTodayItemRows.first().locator('.text-base');
  ok('Today\'s title text is still rendered at the original (not-shrunk) size class', await firstTodayTitle.count() >= 1);

  // ============ Section 4/7: future-day card readability ============
  const futureQuizRow = page.locator('[data-testid="agenda-row"][data-column="future"]').filter({ hasText: 'Social Studies' });
  ok('The future item is visible without needing a click', await futureQuizRow.isVisible());
  const futureQuizText = await futureQuizRow.textContent();
  ok('The FULL future title is present in the DOM (not hard-truncated/ellipsized away)', futureQuizText.includes(longTitle));
  ok('The future row still shows the owner marker', await futureQuizRow.getByText('R', { exact: true }).isVisible());
  ok('The future row shows a "Prep needed" indicator for an unprepped test', await futureQuizRow.getByTestId('agenda-row-prep-needed').isVisible());

  // ============ Section 5: future cards omit the completion control when not eligible ============
  const futureColumns = page.locator('[data-testid="week-day-column"][data-today="false"]');
  const futureColumnCount = await futureColumns.count();
  let foundNonEligibleFutureChore = false;
  for (let i = 0; i < futureColumnCount; i++) {
    const row = futureColumns.nth(i).locator('[data-testid="agenda-row"]').filter({ hasText: 'Feed the fish' });
    if (await row.isVisible().catch(() => false)) {
      const buttonCount = await row.getByRole('button', { name: /Mark/ }).count();
      const dotCount = await row.getByTestId('agenda-row-view-only').count();
      foundNonEligibleFutureChore = buttonCount === 0 && dotCount === 0;
      break;
    }
  }
  ok('A future (non-eligible) chore occurrence has NO completion control at all — width goes to the title instead', foundNonEligibleFutureChore);

  // A future one-time item (the quiz) IS still completion-eligible, and
  // still gets a (small) control — this is presentation only; completion
  // business rules are unchanged.
  ok('A future one-time item (still eligible under existing rules) keeps a completion control', await futureQuizRow.getByRole('button', { name: /Mark/ }).isVisible());

  // ============ Section 8/3: Today completion behavior remains intact ============
  const todayRow = todayWindow.locator('[data-testid="agenda-row"]').filter({ hasText: 'Today Item 1' });
  await todayRow.getByRole('button', { name: 'Mark complete' }).click();
  await page.waitForTimeout(300);
  ok('Marking a Today item complete still persists', await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    return items.find((it) => it.title === 'Today Item 1')?.status === 'completed';
  }));

  // ============ Section 6: empty execution windows never render ============
  ok('No day column renders an empty "Before School" window header for this data set', (await page.getByTestId('week-window-beforeSchool').count()) === 0);
  ok('No day column renders an empty "Study Hall" window header for this data set', (await page.getByTestId('week-window-studyHall').count()) === 0);
  ok('No day column renders an empty "Evening" window header for this data set', (await page.getByTestId('week-window-evening').count()) === 0);
  // (The genuinely-empty-day "Nothing scheduled" proof ran earlier, before
  // any chore template existed — see the isolated check right after Riley
  // was created. A chore template projects onto every one of the 5 days,
  // so by this point in the test every column legitimately has content.)

  // ============ Section 9: focus/de-emphasis behavior remains intact ============
  const rileyBtn = page.locator('[data-testid^="board-focus-child-"]').filter({ hasText: 'Riley' });
  await rileyBtn.click();
  await page.waitForTimeout(150);
  ok('Focusing Riley keeps her own future item prominent', (await futureQuizRow.getAttribute('data-emphasis')) === 'prominent');
  await page.getByTestId('board-focus-family').click();
  await page.waitForTimeout(150);
  ok('Focusing Family de-emphasizes (not hides) Riley\'s future item', await futureQuizRow.isVisible() && (await futureQuizRow.getAttribute('data-emphasis')) === 'muted');
  await page.getByTestId('agenda-filter-all').click();

  // ============ Family Board remains admin-free ============
  ok('No Add Item control', (await page.getByTestId('action-add-item').count()) === 0);
  ok('No Manage Chores control', (await page.getByTestId('action-manage-chores').count()) === 0);
  ok('No Settings control', (await page.getByTestId('board-settings').count()) === 0);

  // ============ No page-level scroll ============
  const gridOverflow = await page.getByTestId('family-week-board').evaluate((el) => getComputedStyle(el).overflow);
  ok('The rolling-day grid declares no scroll overflow', gridOverflow === 'hidden');
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok('The page does not overflow horizontally', !hasHorizontalOverflow);
  const bodyOverflowY = await page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
  ok('No vertical scroll is forced via an explicit scroll style on the root', bodyOverflowY !== 'scroll');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
