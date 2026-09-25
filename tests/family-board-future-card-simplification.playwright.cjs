/**
 * Focused coverage for the future-day card density refinement: TODAY keeps
 * its richer, icon-bearing card treatment; the four FUTURE-day columns drop
 * decorative item-type icons (books/globe/backpack/folder/bell/etc.) from
 * their own item cards while keeping learner identity, title, Prep needed,
 * and completion eligibility exactly as before. Execution-window HEADER
 * icons (the small sun/checklist/books/moon icon next to "Before School" /
 * "Today" / "Study Hall" / "Evening") are unaffected on every day, and the
 * overflow modal keeps the full, icon-bearing card treatment regardless of
 * which day the item came from (Section 7).
 *
 * Usage:
 *   npm run dev                                                        # in one terminal
 *   node tests/family-board-future-card-simplification.playwright.cjs  # in another
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Setup: one learner, a chore template (projects onto every day, only today's is eligible) ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Hayden');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Hayden');
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

  // Today: an assignment (Today should keep its 📘 icon). Tomorrow: a
  // quiz needing prep (❓ must NOT appear), an assignment (📘 must NOT
  // appear), and a reminder (🔔 must NOT appear) — all completion-eligible
  // one-time items, so their checkboxes should still render. The chore
  // template above already projects a non-eligible occurrence onto
  // tomorrow (day.isToday === false) automatically.
  // "today" window on tomorrow's column gets exactly 4 items (quiz +
  // assignment + reminder + the chore's non-eligible occurrence) — right at
  // the future-column cap, so all 4 are visible with no overflow, keeping
  // the icon/eligibility assertions below unambiguous. 5 extra items are
  // routed into the Evening window instead (via schedule.daypart, an
  // existing field — not a new one) so a genuine "+N more" overflow case
  // exists in a DIFFERENT window, without crowding the "today" one.
  await page.evaluate(({ today, tomorrow }) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    const children = JSON.parse(localStorage.getItem('crestly_admin_children') || '[]');
    const hayden = children.find((c) => c.name === 'Hayden');
    items.push(
      { id: 'today-assignment', type: 'assignment', title: 'Reading Log', childIds: [hayden.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'future-quiz', type: 'quiz', title: 'Geography Quiz', childIds: [hayden.id], dueDate: tomorrow, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'future-assignment', type: 'assignment', title: 'Math Worksheet', childIds: [hayden.id], dueDate: tomorrow, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'future-reminder', type: 'reminder', title: 'Bring Permission Slip', childIds: [hayden.id], dueDate: tomorrow, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    );
    for (let i = 1; i <= 5; i++) {
      items.push({
        id: `future-evening-${i}`,
        type: 'assignment',
        title: `Evening Extra ${i}`,
        childIds: [hayden.id],
        dueDate: tomorrow,
        status: 'open',
        notes: '',
        schedule: { daypart: 'evening' },
        source: { type: 'manual', sourceId: null },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, { today: isoDate(0), tomorrow: isoDate(1) });

  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });
  await page.waitForTimeout(300);

  const todayColumn = page.locator('[data-testid="week-day-column"][data-today="true"]');
  const tomorrowColumn = page.locator('[data-testid="week-day-column"][data-today="false"]').first();

  // ============ Section 2: Today keeps its approved icon treatment ============
  const todayAssignmentRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Reading Log' }).first();
  ok('Today\'s assignment card still shows its 📘 type icon', (await todayAssignmentRow.textContent()).includes('📘'));

  // ============ Section 1/4: future cards drop the decorative type icon ============
  const futureQuizRow = tomorrowColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Geography Quiz' }).first();
  const futureAssignmentRow = tomorrowColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Math Worksheet' }).first();
  const futureReminderRow = tomorrowColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Bring Permission Slip' }).first();
  ok('Future quiz card does NOT show the ❓ type icon', !(await futureQuizRow.textContent()).includes('❓'));
  ok('Future assignment card does NOT show the 📘 type icon', !(await futureAssignmentRow.textContent()).includes('📘'));
  ok('Future reminder card does NOT show the 🔔 type icon', !(await futureReminderRow.textContent()).includes('🔔'));

  // Learner identity (initial marker) is still present — not removed.
  ok('Future quiz card still shows the learner initial marker', await futureQuizRow.getByText('H', { exact: true }).isVisible());
  // Title is still fully visible/readable.
  ok('Future quiz card title is still visible', await futureQuizRow.getByText('Geography Quiz').isVisible());
  // Prep needed still renders on a future card.
  ok('Future quiz card still shows the Prep needed badge', await futureQuizRow.getByTestId('agenda-row-prep-needed').isVisible());

  // ============ Completion eligibility is unchanged — only presentation moved ============
  ok('The eligible future assignment still has a completion control', await futureAssignmentRow.getByRole('button', { name: /Mark/ }).isVisible());
  const futureChoreRow = tomorrowColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Feed the dog' }).first();
  ok('The future (non-eligible) chore occurrence still has NO completion control', (await futureChoreRow.getByRole('button', { name: /Mark/ }).count()) === 0);

  // ============ Section 3: execution-window HEADER icons remain on future days ============
  const futureWindowIcon = tomorrowColumn.getByTestId('week-window-today').locator('span[aria-hidden="true"]').first();
  ok('The future day\'s "Today" execution-window header still shows its own icon', (await futureWindowIcon.textContent()).trim().length > 0);

  // ============ Section 7: overflow modal keeps the full, icon-bearing card treatment ============
  // The 5 "Evening Extra" items seeded above (past the 4-row future-column
  // cap) mean "+N more" is available on tomorrow's Evening window — confirm
  // the modal (which always uses the full-card treatment) still shows the
  // 📘 type icon for a future-day-sourced item, even though that same item
  // type shows no icon directly in the future column itself.
  const eveningOverflowBtn = tomorrowColumn.getByTestId('week-window-evening').getByTestId('week-window-overflow');
  await eveningOverflowBtn.click();
  await page.waitForTimeout(200);
  ok('The overflow modal is open', await page.getByTestId('overflow-modal').isVisible());
  const modalEveningRow = page.getByTestId('overflow-modal').locator('[data-testid="agenda-row"]').filter({ hasText: 'Evening Extra 1' }).first();
  ok('A future-day item shown in the overflow modal DOES still show its 📘 type icon (modal keeps the rich treatment)', (await modalEveningRow.textContent()).includes('📘'));
  await page.getByTestId('overflow-modal-close').click();
  await page.waitForTimeout(150);

  // ============ Unaffected: rolling 5-day structure + no page overflow ============
  ok('The board is still exactly 5 day columns', await page.locator('[data-testid="week-day-column"]').count() === 5);
  const todayBox = await todayColumn.boundingBox();
  const futureBoxes = await page.locator('[data-testid="week-day-column"][data-today="false"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  const avgFutureWidth = futureBoxes.reduce((a, b) => a + b, 0) / futureBoxes.length;
  ok(
    'Today is still roughly 3x a future column\'s width (3fr/1fr ratio unchanged)',
    todayBox.width > avgFutureWidth * 2.3 && todayBox.width < avgFutureWidth * 3.8
  );
  const fit = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  ok('No vertical page overflow was introduced', fit.scrollHeight <= fit.clientHeight);
  ok('No horizontal page overflow was introduced', fit.scrollWidth <= fit.clientWidth);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
