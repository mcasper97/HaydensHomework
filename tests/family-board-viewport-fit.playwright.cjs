/**
 * Focused coverage for the Family Board page-level no-scroll requirement
 * (root-cause fix, not a CSS overflow:hidden mask): the page must actually
 * FIT the viewport — `document.documentElement.scrollHeight <=
 * document.documentElement.clientHeight` — not merely avoid declaring
 * `overflow-y: scroll`. See tests/family-board-density-readability.playwright.cjs,
 * tests/family-board-visual-hierarchy.playwright.cjs, and
 * tests/family-board-overflow-modal.playwright.cjs for the style-declaration
 * convention those files already use elsewhere (kept as-is there); this
 * file exists specifically to prove the STRICTER, real-measurement bar this
 * fix was written to satisfy.
 *
 * Usage:
 *   npm run dev                                        # in one terminal
 *   node tests/family-board-viewport-fit.playwright.cjs # in another
 *
 * Env vars:
 *   TEST_BASE_URL            — dev server URL (default http://127.0.0.1:5173)
 *   PLAYWRIGHT_CHROMIUM_PATH — explicit chromium binary path (optional)
 */
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
// A realistic desktop/kitchen-display viewport — the same 1280x720 baseline
// every other Family Board test in this suite already renders at (default
// Chromium viewport), made explicit here since this file's whole point is
// measuring against it.
const VIEWPORT = { width: 1280, height: 720 };
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
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Setup: two learners, a recurring chore, a dense Today window ============
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
  await chorePanel.getByPlaceholder('e.g. Empty upstairs trash').first().fill('Feed the dog');
  await chorePanel.getByRole('button', { name: 'Add' }).first().click();
  await page.waitForTimeout(200);
  await page.getByText('← Back to Parent Board').click();
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // 9 Today-window items (well past the 6-row cap — the same dense state
  // that originally produced ~60-85px of page-level overflow) + a
  // study_task on a future day (a second execution window on screen, more
  // chrome to fit) + a tomorrow item.
  await page.evaluate(({ today, tomorrow }) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    const children = JSON.parse(localStorage.getItem('crestly_admin_children') || '[]');
    const hayden = children.find((c) => c.name === 'Hayden');
    const payton = children.find((c) => c.name === 'Payton');
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
    items.push({
      id: 'seed-study',
      type: 'study_task',
      title: 'Review multiplication tables',
      childIds: [payton.id],
      dueDate: tomorrow,
      status: 'open',
      notes: '',
      source: { type: 'manual', sourceId: null },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, { today: isoDate(0), tomorrow: isoDate(1) });

  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });
  await page.waitForTimeout(300);

  // ============ THE core requirement: the page actually fits, not just avoids `overflow-y: scroll` ============
  const fit = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  ok(
    `The rendered page height fits the viewport with dense Today content (scrollHeight=${fit.scrollHeight} <= clientHeight=${fit.clientHeight})`,
    fit.scrollHeight <= fit.clientHeight
  );
  ok(
    `The rendered page width fits the viewport (scrollWidth=${fit.scrollWidth} <= clientWidth=${fit.clientWidth})`,
    fit.scrollWidth <= fit.clientWidth
  );

  // The overflow button itself must still be reachable — a page that
  // "fits" by silently clipping the one control that gives access to
  // hidden items would be worse than the scroll it replaced.
  const todayColumn = page.locator('[data-testid="week-day-column"][data-today="true"]');
  const overflowBtn = todayColumn.getByTestId('week-window-overflow');
  ok('The "+N more" overflow button for Today is actually visible (not clipped by the fit)', await overflowBtn.isVisible());
  // 9 seeded items + the "Feed the dog" chore (also assigned to Hayden,
  // also due today) = 10 total in the Today window; 6 visible (the cap)
  // leaves 4 overflowing.
  ok('It reports the correct remaining count (9 seeded items + 1 chore - 6 visible = 4)', (await overflowBtn.textContent()).includes('4'));

  // ============ Preserved design: 5-day structure, 3fr/1fr ratio, compact strip, readable Today ============
  ok('The board is still exactly 5 day columns', await page.locator('[data-testid="week-day-column"]').count() === 5);
  const todayBox = await todayColumn.boundingBox();
  const futureBoxes = await page.locator('[data-testid="week-day-column"][data-today="false"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  const avgFutureWidth = futureBoxes.reduce((a, b) => a + b, 0) / futureBoxes.length;
  ok(
    `Today is still roughly 3x a future column's width (today=${Math.round(todayBox.width)}px, avg future=${Math.round(avgFutureWidth)}px)`,
    todayBox.width > avgFutureWidth * 2.3 && todayBox.width < avgFutureWidth * 3.8
  );

  const stripBox = await page.getByTestId('learner-points-strip').boundingBox();
  ok(`The learner strip is still compact (measured ${stripBox ? Math.round(stripBox.height) : 'n/a'}px)`, !!stripBox && stripBox.height >= 40 && stripBox.height <= 70);

  const firstTodayRow = todayColumn.getByTestId('week-window-today').locator('[data-testid="agenda-row"]').first();
  ok('A prominent Today card\'s title is still rendered at the original (not-shrunk) size class', await firstTodayRow.locator('.text-base').count() >= 1);
  ok('A prominent Today card still has its large completion control', await firstTodayRow.getByRole('button', { name: /Mark/ }).isVisible());

  // ============ "+N more" still opens the modal, and the modal (not the page) scrolls internally ============
  await overflowBtn.click();
  await page.waitForTimeout(200);
  ok('The overlay opens', await page.getByTestId('overflow-modal').isVisible());
  for (let i = 1; i <= 9; i++) {
    ok(`Overlay shows "Today Task ${i}" (all 9 items, not just the capped 6)`, await page.getByTestId('overflow-modal').getByText(`Today Task ${i}`).isVisible());
  }

  const modalScrollInfo = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="overflow-modal-scroll"]');
    const modal = document.querySelector('[data-testid="overflow-modal"]');
    return {
      scrollerOverflowY: scroller ? getComputedStyle(scroller).overflowY : null,
      scrollerCanScroll: scroller ? scroller.scrollHeight > scroller.clientHeight : false,
      modalHasMaxHeight: modal ? getComputedStyle(modal).maxHeight !== 'none' : false,
    };
  });
  ok('The modal\'s own item list declares overflow-y: auto (internal scroll allowed)', modalScrollInfo.scrollerOverflowY === 'auto');
  ok('With 9+1 items in one window, the modal\'s own list genuinely needs to scroll internally', modalScrollInfo.scrollerCanScroll);
  ok('The modal panel itself is height-bounded (never grows to swallow the whole page)', modalScrollInfo.modalHasMaxHeight);

  const fitWithModalOpen = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  ok(
    `The underlying page still fits the viewport with the (internally-scrolling) modal open (scrollHeight=${fitWithModalOpen.scrollHeight} <= clientHeight=${fitWithModalOpen.clientHeight})`,
    fitWithModalOpen.scrollHeight <= fitWithModalOpen.clientHeight
  );

  await page.getByTestId('overflow-modal-close').click();
  await page.waitForTimeout(150);
  ok('The overlay closes cleanly', (await page.getByTestId('overflow-modal').count()) === 0);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
