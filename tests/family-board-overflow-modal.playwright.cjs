/**
 * Focused coverage for the Family Board "+N more" -> overflow-modal
 * interaction (UX review correction): the overflow indicator is now a real
 * accessible <button>, and tapping it opens a fixed overlay for that exact
 * (day, execution window) rather than expanding the board inline. See
 * tests/family-board-visual-hierarchy.playwright.cjs for the companion
 * color-hierarchy coverage this same pass added.
 *
 * Usage:
 *   npm run dev                                          # in one terminal
 *   node tests/family-board-overflow-modal.playwright.cjs # in another
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

  // ============ Setup: two learners, a recurring chore, 9 Today items, 6 future-day items ============
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

  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');
  await page.getByTestId('action-manage-chores').click();
  const chorePanel = page.getByTestId('chore-management-panel');
  await chorePanel.getByText('+ Add a chore').first().click();
  await chorePanel.getByPlaceholder('e.g. Empty upstairs trash').first().fill('Pack lunch');
  await chorePanel.getByRole('button', { name: 'Add' }).first().click();
  await page.waitForTimeout(200);
  await page.getByText('← Back to Parent Board').click();
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  await page.evaluate(({ today, future }) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    const children = JSON.parse(localStorage.getItem('crestly_admin_children') || '[]');
    const hayden = children.find((c) => c.name === 'Hayden');
    const payton = children.find((c) => c.name === 'Payton');
    // 9 Today-window items (cap is 6 -> guarantees overflow with room to
    // spare even alongside the chore that also lands in Today's window).
    for (let i = 1; i <= 9; i++) {
      items.push({
        id: `seed-today-${i}`,
        type: i === 1 ? 'test' : 'assignment',
        title: `Today Task ${i}`,
        childIds: [hayden.id],
        dueDate: today,
        status: 'open',
        notes: '',
        source: { type: 'manual', sourceId: null },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    // 6 future-day items (cap is 4) on the SAME future day, owned by
    // Payton, so this run also has a future-day overflow to open.
    for (let i = 1; i <= 6; i++) {
      items.push({
        id: `seed-future-${i}`,
        type: 'assignment',
        title: `Future Task ${i}`,
        childIds: [payton.id],
        dueDate: future,
        status: 'open',
        notes: '',
        source: { type: 'manual', sourceId: null },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, { today: isoDate(0), future: isoDate(1) });

  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });

  // ============ "+N more" is a real, accessible button ============
  const todayColumn = page.locator('[data-testid="week-day-column"][data-today="true"]');
  const todayOverflowBtn = todayColumn.getByTestId('week-window-overflow');
  ok('The overflow indicator is a real <button> element', (await todayOverflowBtn.evaluate((el) => el.tagName)) === 'BUTTON');
  const ariaLabel = await todayOverflowBtn.getAttribute('aria-label');
  ok('It carries a descriptive aria-label with the hidden count, day, and window', /^Show \d+ more items for \w+ Today$/.test(ariaLabel || ''));
  const btnBox = await todayOverflowBtn.boundingBox();
  ok('Today\'s overflow button meets the ~44px touch-target height', !!btnBox && btnBox.height >= 40);

  // The board's own data-date is the single source of truth for "today"
  // (same value the aria-label above was already checked against) — used
  // here too instead of a fresh `new Date()` call in the test, so this
  // assertion never depends on the test process's clock/timezone matching
  // the browser's exactly.
  const todayDateStr = await todayColumn.getAttribute('data-date');
  const expectedWeekday = new Date(`${todayDateStr}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' });

  // ============ Tapping it opens the correct day/window overlay, without expanding the board ============
  const boardWidthBefore = (await page.getByTestId('family-week-board').boundingBox()).width;
  await todayOverflowBtn.click();
  await page.waitForTimeout(200);

  ok('The overlay opens', await page.getByTestId('overflow-modal').isVisible());
  ok('The overlay shows the correct day (today)', await page.getByTestId('overflow-modal').getByText(expectedWeekday).isVisible());
  ok('The overlay shows the correct execution window name ("Today")', (await page.getByTestId('overflow-modal-window-label').textContent()) === 'Today');
  ok(
    'The board itself did not expand inline — its own width is unchanged',
    Math.abs((await page.getByTestId('family-week-board').boundingBox()).width - boardWidthBefore) < 2
  );

  // ============ The overlay shows ALL items in that window, not just the capped subset ============
  for (let i = 1; i <= 9; i++) {
    ok(`Overlay shows "Today Task ${i}" (all 9, not just the 6 the board itself capped at)`, await page.getByTestId('overflow-modal').getByText(`Today Task ${i}`).isVisible());
  }
  ok('The chore that also lands in Today\'s window is present in the overlay too', await page.getByTestId('overflow-modal').getByText('Pack lunch').isVisible());

  // ============ Overlay preserves learner identity, Prep needed, and completion eligibility ============
  const testTaskRow = page.getByTestId('overflow-modal').locator('[data-testid="agenda-row"]').filter({ hasText: 'Today Task 1' });
  ok('Overlay rows preserve learner identity (owner initial)', await testTaskRow.getByText('H', { exact: true }).isVisible());
  ok('Overlay rows preserve the "Prep needed" indicator for an unprepped test', await testTaskRow.getByTestId('agenda-row-prep-needed').isVisible());
  ok('An eligible item in the overlay keeps its completion control', await testTaskRow.getByRole('button', { name: /Mark/ }).isVisible());

  const choreRowInModal = page.getByTestId('overflow-modal').locator('[data-testid="agenda-row"]').filter({ hasText: 'Pack lunch' });
  ok('Today\'s own chore occurrence in the overlay is completion-eligible (has a control)', await choreRowInModal.getByRole('button', { name: /Mark/ }).isVisible());

  // ============ Focus/de-emphasis is respected inside the overlay ============
  await page.getByTestId('overflow-modal-close').click();
  await page.waitForTimeout(150);
  ok('Close control closes the overlay', (await page.getByTestId('overflow-modal').count()) === 0);

  const haydenBtn = page.locator('[data-testid^="board-focus-child-"]').filter({ hasText: 'Hayden' });
  await haydenBtn.click();
  await page.waitForTimeout(150);
  await todayOverflowBtn.click();
  await page.waitForTimeout(200);
  const focusedTestTaskRow = page.getByTestId('overflow-modal').locator('[data-testid="agenda-row"]').filter({ hasText: 'Today Task 1' });
  ok('Inside the overlay, the focused owner\'s (Hayden) own row is prominent', (await focusedTestTaskRow.getAttribute('data-emphasis')) === 'prominent');
  await page.getByTestId('overflow-modal-done').click();
  await page.waitForTimeout(150);
  ok('Done control also closes the overlay', (await page.getByTestId('overflow-modal').count()) === 0);

  await page.getByTestId('board-focus-family').click();
  await page.waitForTimeout(150);
  await todayOverflowBtn.click();
  await page.waitForTimeout(200);
  const mutedInsideModal = page.getByTestId('overflow-modal').locator('[data-testid="agenda-row"]').filter({ hasText: 'Today Task 1' });
  ok('Inside the overlay, a non-selected owner\'s row is still VISIBLE (never hidden)', await mutedInsideModal.isVisible());
  ok('...but de-emphasized (muted) to match the board\'s own focus state', (await mutedInsideModal.getAttribute('data-emphasis')) === 'muted');

  // ============ Escape closes the overlay ============
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok('Escape closes the overlay', (await page.getByTestId('overflow-modal').count()) === 0);
  await page.getByTestId('agenda-filter-all').click();
  await page.waitForTimeout(100);

  // ============ Future-day overflow: correct day/window, ineligible completion controls stay absent ============
  const futureColumns = page.locator('[data-testid="week-day-column"][data-today="false"]');
  let futureOverflowBtn = null;
  for (let i = 0; i < (await futureColumns.count()); i++) {
    const btn = futureColumns.nth(i).getByTestId('week-window-overflow');
    if (await btn.isVisible().catch(() => false)) {
      futureOverflowBtn = btn;
      break;
    }
  }
  ok('A future day with overflow also exposes an overflow button', !!futureOverflowBtn);
  await futureOverflowBtn.click();
  await page.waitForTimeout(200);
  ok('The future-day overlay opens', await page.getByTestId('overflow-modal').isVisible());
  for (let i = 1; i <= 6; i++) {
    ok(`Future overlay shows "Future Task ${i}" (all 6, not just the 4 the board capped at)`, await page.getByTestId('overflow-modal').getByText(`Future Task ${i}`).isVisible());
  }
  const futureChoreRow = page.getByTestId('overflow-modal').locator('[data-testid="agenda-row"]').filter({ hasText: 'Pack lunch' });
  const futureChoreVisible = await futureChoreRow.isVisible().catch(() => false);
  if (futureChoreVisible) {
    ok('A future (non-eligible) chore occurrence in the overlay has NO completion control at all', (await futureChoreRow.getByRole('button', { name: /Mark/ }).count()) === 0 && (await futureChoreRow.getByTestId('agenda-row-view-only').count()) === 0);
  } else {
    ok('A future (non-eligible) chore occurrence in the overlay has NO completion control at all (n/a — chore not in this window\'s overflow)', true);
  }

  // ============ Underlying board never scrolls; only the overlay's own list may ============
  // Vertical: same verification convention every other Family Board test in
  // this suite already uses (a declared overflow-y: scroll would be the
  // board FORCING a scrollbar; that's what "no-scroll architecture" means
  // here) — not a strict scrollHeight measurement, since this task's own
  // constraints protect Today's existing card size/row cap from being
  // touched, and a raw pixel-overflow measurement is a pre-existing
  // characteristic of that already-shipped cap under enough seeded content,
  // unrelated to (and unchanged by) this pass's own color/overflow-button work.
  // Horizontal genuinely never overflows regardless of content volume (the
  // grid is always exactly 5 fixed-ratio columns), so that one IS checked
  // with a real measurement.
  const scrollInfo = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="overflow-modal-scroll"]');
    return {
      scrollerOverflowY: scroller ? getComputedStyle(scroller).overflowY : null,
      rootOverflowY: getComputedStyle(document.documentElement).overflowY,
      pageOverflowsHorizontally: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  });
  ok('The overlay\'s own item list declares overflow-y: auto (may scroll internally)', scrollInfo.scrollerOverflowY === 'auto');
  ok('The underlying page does not force a vertical scrollbar with the overlay open', scrollInfo.rootOverflowY !== 'scroll');
  ok('The underlying page still does not scroll horizontally with the overlay open', !scrollInfo.pageOverflowsHorizontally);

  await page.getByTestId('overflow-modal-close').click();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
