/**
 * Focused regression test for the canonical item "domain hardening" change
 * (academicTopic / academicUnit / preparationRequired / location / priority
 * added to the item schema — see src/data/itemsRepository.js).
 *
 * Exercises the guest/local-demo storage path (localStorage-backed), which
 * runs the exact same itemsRepository.js code as the real Firestore path,
 * just routed differently — no live Firebase project needed to run this.
 *
 * Prerequisites (not currently project dependencies, install ad hoc):
 *   npm install --no-save playwright
 *   npx playwright install chromium   # or point PLAYWRIGHT_CHROMIUM_PATH at an existing binary
 *
 * Usage:
 *   npm run dev                                     # in one terminal
 *   node tests/domain-hardening.playwright.cjs       # in another
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

(async () => {
  const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  const visible = async (text) => page.getByText(text).first().isVisible().catch(() => false);
  const guestEnter = () => page.getByText('Continue without an account').click();
  const readItems = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_items') || '[]'));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await guestEnter();
  await page.waitForSelector('text=Parent Home');
  await page.getByTestId('action-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  await page.getByText('← Parent Home').click();
  await page.waitForSelector('text=Parent Home');

  // ============ Backward compatibility: pre-seed an "old" item with no new fields ============
  await page.evaluate(() => {
    const legacy = [{
      id: 'legacy-test-1',
      type: 'test',
      title: 'Old Science Test',
      childIds: [],
      subject: 'Science',
      courseId: null,
      startDate: new Date().toISOString().slice(0, 10),
      startTime: null, dueDate: null, dueTime: null, endDate: null, endTime: null,
      allDay: true, status: 'open', notes: '', parentItemId: null, studyMaterialIds: [],
      source: { type: 'manual', sourceId: null },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      // deliberately NO academicTopic/academicUnit/preparationRequired/location/priority keys
    }];
    localStorage.setItem('crestly_admin_items', JSON.stringify(legacy));
  });

  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Backward-compat: pre-existing item (no new fields) loads and displays', await visible('Old Science Test'));

  const legacyRow = page.locator('.rounded-2xl.bg-white.border-gray-200').filter({ hasText: 'Old Science Test' });
  ok('Backward-compat: no crash rendering detail line without topic/unit', await legacyRow.isVisible());

  // Edit the legacy item — form must open without crashing on missing fields.
  await legacyRow.getByText('Edit').click();
  let form = page.locator('form');
  ok('Backward-compat: edit form opens for a pre-existing item', await form.isVisible());
  ok('Backward-compat: topic input pre-fills empty (not "undefined")', (await form.getByPlaceholder('Topic (optional)').inputValue()) === '');
  await form.getByRole('button', { name: 'Cancel' }).click();

  // ============ New fields: create a test with topic/unit/preparationRequired ============
  await page.getByRole('button', { name: '+ Test' }).click();
  form = page.locator('form');
  await form.getByPlaceholder('Title').fill('Math Test');
  const today = new Date().toISOString().slice(0, 10);
  await form.locator('input[type="date"]').first().fill(today);
  await form.getByPlaceholder('Topic (optional)').fill('2-digit multiplication');
  await form.getByPlaceholder('Unit (optional)').fill('Multiplication Unit');
  await form.getByRole('checkbox').check(); // "Studying/preparation required"
  await form.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(400);

  ok('New field: item created', await visible('Math Test'));
  ok('New field: topic appears in Organizer detail line', await visible('2-digit multiplication'));

  let items = await readItems();
  let mathTest = items.find((it) => it.title === 'Math Test');
  ok('New field: academicTopic persisted', mathTest?.academicTopic === '2-digit multiplication');
  ok('New field: academicUnit persisted', mathTest?.academicUnit === 'Multiplication Unit');
  ok('New field: preparationRequired persisted as true', mathTest?.preparationRequired === true);
  ok('New field: location defaults to null (no UI control this pass)', mathTest?.location === null);
  ok('New field: priority defaults to null (no UI control this pass)', mathTest?.priority === null);
  ok('New field: id is a stable non-empty string', typeof mathTest?.id === 'string' && mathTest.id.length > 0);

  // ============ Edit round-trip: values pre-fill correctly, can be changed ============
  const mathRow = page.locator('.rounded-2xl.bg-white.border-gray-200').filter({ hasText: 'Math Test' });
  await mathRow.getByText('Edit').click();
  form = page.locator('form');
  ok('Edit round-trip: topic pre-fills from existing item', (await form.getByPlaceholder('Topic (optional)').inputValue()) === '2-digit multiplication');
  ok('Edit round-trip: unit pre-fills from existing item', (await form.getByPlaceholder('Unit (optional)').inputValue()) === 'Multiplication Unit');
  ok('Edit round-trip: preparation checkbox pre-fills checked', await form.getByRole('checkbox').isChecked());

  await form.getByPlaceholder('Topic (optional)').fill('Long division');
  await form.getByRole('checkbox').uncheck();
  await form.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(400);

  items = await readItems();
  mathTest = items.find((it) => it.title === 'Math Test');
  ok('Edit round-trip: updated topic persisted', mathTest?.academicTopic === 'Long division');
  ok('Edit round-trip: unchanged unit still persisted', mathTest?.academicUnit === 'Multiplication Unit');
  ok('Edit round-trip: unchecked preparationRequired persisted as false', mathTest?.preparationRequired === false);
  ok('Edit round-trip: same item id (no duplicate created)', items.filter((it) => it.title === 'Math Test').length === 1);

  // ============ Type gating: assignment (non-assessment) has no preparation checkbox ============
  await page.getByRole('button', { name: '+ Assignment' }).click();
  form = page.locator('form');
  ok('Type gating: Assignment shows topic/unit (academic type)', await form.getByPlaceholder('Topic (optional)').isVisible());
  ok('Type gating: Assignment has NO preparation checkbox (test/quiz only)', !(await form.getByRole('checkbox').isVisible().catch(() => false)));
  await form.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: '+ Family Event' }).click();
  form = page.locator('form');
  ok('Type gating: Family Event has NO topic/unit (non-academic type)', !(await form.getByPlaceholder('Topic (optional)').isVisible().catch(() => false)));
  await form.getByRole('button', { name: 'Cancel' }).click();

  // ============ Child Mode surfaces topic/unit too ============
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Home');
  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=My Day');
  ok('Child Mode: due-today academic item shows topic in My Day', await visible('Long division'));

  // ============ No new/duplicate source of truth: same item read from both Organizer and Child views ============
  const idsMatch = await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('crestly_admin_items') || '[]');
    return items.filter((it) => it.title === 'Math Test').length === 1;
  });
  ok('No duplicate source of truth: exactly one canonical record for the item', idsMatch);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
