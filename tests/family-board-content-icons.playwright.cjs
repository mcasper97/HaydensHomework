/**
 * Focused coverage for the content-aware Today icon resolver
 * (src/organizer/contentIcon.js) — a presentation-layer-only keyword match
 * against a row's existing title that picks a more specific, kid-friendly
 * icon than the coarse per-TYPE icon every row of that type already shares
 * (ITEM_TYPE_META), falling back to that same generic icon when no
 * keyword matches. Never reads/writes canonical Item data.
 *
 * MOCKUP-LITERAL PASS: resolveContentIcon now returns a tagged object —
 * { kind: "image", src, alt } for the six task titles the approved mockup
 * itself shows (each backed by a PNG cropped directly out of that mockup
 * image, not an emoji redraw), or { kind: "emoji", value } for everything
 * else (unchanged emoji fallback). This file's unit assertions were
 * rewritten for that shape; the end-to-end assertions now look for the
 * rendered <img> rather than emoji text content for the six covered
 * titles.
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
  const isImage = (icon, srcFragment) => icon && icon.kind === 'image' && icon.src.includes(srcFragment);
  const isEmoji = (icon, value) => icon && icon.kind === 'emoji' && icon.value === value;

  ok('"Pajama/Stuffy Day" resolves to the mockup\'s own teddy-bear image, not the generic school-event icon', isImage(resolveContentIcon({ title: 'Pajama/Stuffy Day', type: 'school_event' }), 'pajama-teddy.png'));
  ok('"Gold Folder: Review, Sign, and Return" resolves to the mockup\'s own folder image', isImage(resolveContentIcon({ title: 'Gold Folder: Review, Sign, and Return', type: 'reminder' }), 'folder.png'));
  ok('"Review & Sign Gold Folder on Fridays" resolves to the mockup\'s own certificate image (distinct from the plain folder above)', isImage(resolveContentIcon({ title: 'Review & Sign Gold Folder on Fridays', type: 'reminder' }), 'certificate.png'));
  ok('"Nightly Geography Study Guide Review" resolves to the mockup\'s own globe image (geography beats generic study)', isImage(resolveContentIcon({ title: 'Nightly Geography Study Guide Review', type: 'study_task' }), 'globe-stand.png'));
  ok('"Send Daily Healthy Snack" resolves to the mockup\'s own apple image', isImage(resolveContentIcon({ title: 'Send Daily Healthy Snack', type: 'reminder' }), 'apple.png'));
  ok('"Reading/Phonics Lesson 3 Assessment" resolves to the mockup\'s own book-stack image, not the generic quiz icon', isImage(resolveContentIcon({ title: 'Reading/Phonics Lesson 3 Assessment', type: 'quiz' }), 'book-stack.png'));
  ok('A title with no keyword match falls back to the generic ITEM_TYPE_META emoji for its type', isEmoji(resolveContentIcon({ title: 'Unit 4 Packet', type: 'assignment' }), '📘'));
  ok('A recognized-type row with an empty title still falls back cleanly (no crash, generic emoji)', isEmoji(resolveContentIcon({ title: '', type: 'quiz' }), '❓'));
  ok('An unknown type with no keyword match resolves to null, not undefined/crash', resolveContentIcon({ title: 'Unit 4 Packet', type: 'not_a_real_type' }) === null);

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
      // teddy-bear image that appears for the identical Today item must
      // NOT appear here.
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
  ok('Today\'s "Pajama/Stuffy Day" card renders the mockup\'s teddy-bear image', await pajamaRow.locator('img[src*="pajama-teddy"]').isVisible());

  const folderRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Gold Folder' }).first();
  ok('Today\'s "Gold Folder..." card renders the mockup\'s folder image', await folderRow.locator('img[src*="folder.png"]').isVisible());

  const geoRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Nightly Geography' }).first();
  ok('Today\'s "Nightly Geography Study Guide Review" card renders the mockup\'s globe image', await geoRow.locator('img[src*="globe-stand"]').isVisible());

  const snackRow = todayColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Send Daily Healthy Snack' }).first();
  ok('Today\'s "Send Daily Healthy Snack" card renders the mockup\'s apple image', await snackRow.locator('img[src*="apple.png"]').isVisible());

  const futurePajamaRow = tomorrowColumn.locator('[data-testid="agenda-row"]').filter({ hasText: 'Pajama/Stuffy Day' }).first();
  ok('The SAME title on a future day shows no icon at all (future-day cards stay icon-free)', (await futurePajamaRow.locator('img[src*="pajama-teddy"]').count()) === 0);
  ok('Future-day card still shows the learner initial marker', await futurePajamaRow.getByText('H', { exact: true }).isVisible());
  ok('Future-day card still shows the title text', await futurePajamaRow.getByText('Pajama/Stuffy Day').isVisible());

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
