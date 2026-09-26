/**
 * Focused coverage for the Family Board visual-hierarchy correction (UX
 * review): distinct learner accents, distinct execution-window header
 * treatment, and the compact LearnerPointsStrip's structure staying
 * untouched (colors only). See tests/family-board-overflow-modal.playwright.cjs
 * for the companion "+N more" -> overlay coverage this same pass added,
 * and tests/family-board-rolling-5day.playwright.cjs /
 * family-board-density-readability.playwright.cjs for the layout/density
 * proofs this file doesn't re-prove (both still pass unmodified against
 * this pass's changes).
 *
 * Palette values are imported directly from the production source modules
 * (learnerAccent.js / boardTheme.js) rather than duplicated as literals
 * here, so this file can never drift from whatever the palette actually is.
 *
 * Usage:
 *   npm run dev                                             # in one terminal
 *   node tests/family-board-visual-hierarchy.playwright.cjs   # in another
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

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

(async () => {
  const { LEARNER_PALETTE, FAMILY_ACCENT } = await import('../src/organizer/learnerAccent.js');
  const { WINDOW_ACCENTS } = await import('../src/organizer/boardTheme.js');

  const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Setup: Hayden (1st), Payton (2nd) — the task's own example family ============
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

  await page.evaluate(({ today, tomorrow }) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    const children = JSON.parse(localStorage.getItem('crestly_admin_children') || '[]');
    const hayden = children.find((c) => c.name === 'Hayden');
    const payton = children.find((c) => c.name === 'Payton');
    items.push(
      { id: 'seed-hayden', type: 'assignment', title: 'Hayden Reading Log', childIds: [hayden.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'seed-payton', type: 'assignment', title: 'Payton Math Sheet', childIds: [payton.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'seed-family', type: 'family_event', title: 'Family Game Night', childIds: [], startDate: today, allDay: true, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      // A study_task -> Study Hall window, so this run has two DIFFERENT
      // execution windows on screen at once to compare header colors across.
      { id: 'seed-study', type: 'study_task', title: 'Review spelling words', childIds: [hayden.id], dueDate: tomorrow, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    );
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, { today: isoDate(0), tomorrow: isoDate(1) });

  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });

  // ============ LearnerPointsStrip: structure preserved, colors refined only ============
  const strip = page.getByTestId('learner-points-strip');
  ok('LearnerPointsStrip still renders', await strip.isVisible());
  ok('LearnerPointsStrip is still the compact single-row layout (no old large purple panel text)', (await page.locator('text=Chore pts').count()) === 0 && (await page.locator('text=Homework pts').count()) === 0);
  const stripBox = await strip.boundingBox();
  // HEADER MEASURED-FIDELITY PASS: grown from ~45-60px to ~80-100px,
  // pinned to the approved mockup's own measured chip height.
  ok(`LearnerPointsStrip matches the mockup's measured chip height (~80-100px, measured ${stripBox ? Math.round(stripBox.height) : 'n/a'}px)`, !!stripBox && stripBox.height >= 80 && stripBox.height <= 100);
  ok('LearnerPointsStrip still shows both learners\' names', await strip.getByText('Hayden').isVisible() && await strip.getByText('Payton').isVisible());

  // ============ Learner ownership accent treatment ============
  const haydenRow = page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Hayden Reading Log' }).first();
  const paytonRow = page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Payton Math Sheet' }).first();
  const familyRow = page.locator('[data-testid="agenda-row"]').filter({ hasText: 'Family Game Night' }).first();

  const haydenBorder = await haydenRow.evaluate((el) => getComputedStyle(el).borderLeftColor);
  const paytonBorder = await paytonRow.evaluate((el) => getComputedStyle(el).borderLeftColor);
  const familyBorder = await familyRow.evaluate((el) => getComputedStyle(el).borderLeftColor);

  ok('Hayden\'s card uses the sage/green learner accent (palette index 0 — the first learner added)', haydenBorder === hexToRgb(LEARNER_PALETTE[0].border));
  ok('Payton\'s card uses the terracotta/coral learner accent (palette index 1 — the second learner added)', paytonBorder === hexToRgb(LEARNER_PALETTE[1].border));
  ok('The family card uses the neutral slate/gray Family accent, distinct from both learners\'', familyBorder === hexToRgb(FAMILY_ACCENT.border));
  ok('Hayden and Payton use genuinely different accent colors from each other', haydenBorder !== paytonBorder);
  ok('The Family accent is distinct from both learners\' own accents', familyBorder !== haydenBorder && familyBorder !== paytonBorder);

  // Ownership is never color-only — the initial/name marker is still present.
  ok('Hayden\'s row still shows a text identity marker (not color alone)', await haydenRow.getByText('H', { exact: true }).isVisible());
  ok('Payton\'s row still shows a text identity marker (not color alone)', await paytonRow.getByText('P', { exact: true }).isVisible());

  // ============ Execution-window header treatment ============
  const todayColumn = page.locator('[data-testid="week-day-column"][data-today="true"]');
  const todayHeaderLabel = todayColumn.getByTestId('week-window-today').getByTestId('window-header-label');
  const todayHeaderColor = await todayHeaderLabel.evaluate((el) => getComputedStyle(el).color);
  ok('The "Today" execution-window header uses its own distinct accent color', todayHeaderColor === hexToRgb(WINDOW_ACCENTS.today.text));

  const studyHallHeaderLabel = page.getByTestId('week-window-studyHall').getByTestId('window-header-label');
  ok('The "Study Hall" window is populated and its header renders', await studyHallHeaderLabel.isVisible());
  const studyHallHeaderColor = await studyHallHeaderLabel.evaluate((el) => getComputedStyle(el).color);
  ok('"Study Hall" uses the muted-indigo window accent, distinct from "Today"\'s', studyHallHeaderColor === hexToRgb(WINDOW_ACCENTS.studyHall.text) && studyHallHeaderColor !== todayHeaderColor);

  // MOCKUP-FIDELITY PASS superseded the earlier "thin border-bottom rule"
  // treatment with a soft colored header BAND (Section 9 of that later
  // task: "current thin-rule treatment is not enough... a soft colored
  // header band, rounded corners") — this assertion was updated from
  // checking borderBottomColor to checking the band's own background
  // fill, which is now the actual mechanism giving each window its
  // distinct, clearly-grouped visual identity.
  const todayHeaderBand = await todayColumn.getByTestId('week-window-today').locator('div').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  ok('The "Today" execution-window header renders as its own soft colored band (not a bare thin rule)', todayHeaderBand === hexToRgb(WINDOW_ACCENTS.today.bg));

  // ============ Rolling 5-day structure + grid ratio unchanged (this task never touches either) ============
  const columns = page.locator('[data-testid="week-day-column"]');
  ok('The board is still exactly 5 day columns', await columns.count() === 5);
  const todayBox = await page.locator('[data-testid="week-day-column"][data-today="true"]').boundingBox();
  const futureBoxes = await page.locator('[data-testid="week-day-column"][data-today="false"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  const avgFutureWidth = futureBoxes.reduce((a, b) => a + b, 0) / futureBoxes.length;
  ok('Today is still roughly 3x a future column\'s width (3fr/1fr ratio unchanged)', todayBox.width > avgFutureWidth * 2.3 && todayBox.width < avgFutureWidth * 3.8);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
