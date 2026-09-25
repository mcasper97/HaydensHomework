/**
 * Focused coverage for the content-aware Today icon resolver
 * (src/organizer/contentIcon.js) — a presentation-layer-only keyword match
 * against a row's existing title that picks a more specific, kid-friendly
 * icon than the coarse per-TYPE icon every row of that type already shares
 * (ITEM_TYPE_META), falling back to that same generic icon when no
 * keyword matches. Never reads/writes canonical Item data.
 *
 * Usage:
 *   npm run dev                                         # in one terminal
 *   node tests/family-board-content-icons.playwright.cjs # in another
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
  // Pure unit-level coverage of the resolver itself, no browser needed —
  // the fastest, least flaky way to pin down the exact mapping for each
  // example the task calls out by name.
  const { resolveContentIcon } = await import('../src/organizer/contentIcon.js');
  ok('"Pajama/Stuffy Day" resolves to a teddy-bear icon, not the generic school-event icon', resolveContentIcon({ title: 'Pajama/Stuffy Day', type: 'school_event' }) === '🧸');
  ok('"Gold Folder: Review, Sign, and Return" resolves to a folder icon', resolveContentIcon({ title: 'Gold Folder: Review, Sign, and Return', type: 'reminder' }) === '📁');
  ok('"Nightly Geography Study Guide Review" resolves to a globe icon (geography beats generic study)', resolveContentIcon({ title: 'Nightly Geography Study Guide Review', type: 'study_task' }) === '🌍');
  ok('"Send Daily Healthy Snack" resolves to a food/snack icon', resolveContentIcon({ title: 'Send Daily Healthy Snack', type: 'reminder' }) === '🍎');
  ok('"Reading/Phonics Lesson 3 Assessment" resolves to a book icon, not the generic quiz icon', resolveContentIcon({ title: 'Reading/Phonics Lesson 3 Assessment', type: 'quiz' }) === '📖');
  ok('A title with no keyword match falls back to the generic ITEM_TYPE_META icon for its type', resolveContentIcon({ title: 'Unit 4 Packet', type: 'assignment' }) === '📘');
  ok('A recognized-type row with an empty title still falls back cleanly (no crash, generic icon)', resolveContentIcon({ title: '', type: 'quiz' }) === '❓');
  ok('An unknown type with no keyword match resolves to an empty string, not undefined/crash', resolveContentIcon({ title: 'Unit 4 Packet', type: 'not_a_real_type' }) === '');

  // ============ End-to-end: rendered on the real board ============
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

  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Hayden');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Hayden');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  await page.evaluate(({ today, tomorrow }) => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    const children = JSON.parse(localStorage.getItem('crestly_admin_children') || '[]');
    const hayden = children.find((c) => c.name === 'Hayden');
    items.push(
      { id: 'today-pajama', type: 'school_event', title: 'Pajama/Stuffy Day', childIds: [hayden.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'today-folder', type: 'reminder', title: 'Gold Folder: Review, Sign, and Return', childIds: [hayden.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'today-geo', type: 'study_task', title: 'Nightly Geography Study Guide Review', childIds: [hayden.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'today-snack', type: 'reminder', title: 'Send Daily Healthy Snack', childIds: [hayden.id], dueDate: today, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      // Same title text, but seeded on a FUTURE day — proves the resolver
      // is never even consulted for future-day cards (Section 4/15): the
      // teddy-bear icon that appears for the identical Today item must NOT
      // appear here.
      { id: 'future-pajama', type: 'school_event', title: 'Pajama/Stuffy Day', childIds: [hayden.id], dueDate: tomorrow, status: 'open', notes: '', source: { type: 'manual', sourceId: null }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    );
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  }, { today: isoDate(0), tomorrow: isoDate(1) });

  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });
  await page.waitForTimeout(300);

  const todayColumn = page.locator('[data-testid="week-day-column"][data-today="true"]');
  const tomorrowColumn = page.locator('[data-testid="week-day-column"][data-today="false"]').first();

  const pajamaRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Pajama/Stuffy Day' }).first();
  ok('Today\'s "Pajama/Stuffy Day" card renders the 🧸 icon on the real board', (await pajamaRow.textContent()).includes('🧸'));

  const folderRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Gold Folder' }).first();
  ok('Today\'s "Gold Folder..." card renders the 📁 icon on the real board', (await folderRow.textContent()).includes('📁'));

  const geoRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Nightly Geography' }).first();
  ok('Today\'s "Nightly Geography Study Guide Review" card renders the 🌍 icon on the real board', (await geoRow.textContent()).includes('🌍'));

  const snackRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Send Daily Healthy Snack' }).first();
  ok('Today\'s "Send Daily Healthy Snack" card renders the 🍎 icon on the real board', (await snackRow.textContent()).includes('🍎'));

  const futurePajamaRow = tomorrowColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Pajama/Stuffy Day' }).first();
  ok('The SAME title on a future day shows no icon at all (future-day cards stay icon-free)', !(await futurePajamaRow.textContent()).includes('🧸'));
  ok('Future-day card still shows the learner initial marker', await futurePajamaRow.getByText('H', { exact: true }).isVisible());
  ok('Future-day card still shows the title text', await futurePajamaRow.getByText('Pajama/Stuffy Day').isVisible());

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
