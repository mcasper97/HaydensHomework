/**
 * End-to-end regression test for the recurring-obligations increment
 * (ItemForm's opt-in "Repeats" section, ParentOrganizer's recurring-aware
 * rendering + per-occurrence completion, OrganizerCalendar's recurring
 * projection — see src/organizer/itemBuckets.js, src/data/
 * itemCompletionsRepository.js).
 *
 * Exercises the guest/local-demo storage path (localStorage-backed), which
 * runs the exact same itemsRepository.js / itemCompletionsRepository.js
 * code as the real Firestore path, just routed differently — no live
 * Firebase project needed to run this. Same pattern as
 * domain-hardening.playwright.cjs.
 *
 * Usage:
 *   npm run dev                                        # in one terminal
 *   node tests/recurring-reminders.playwright.cjs       # in another
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
  const readCompletions = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_item_completions') || '[]'));
  const todayWeekdayIndex = () => new Date().getDay(); // 0=Sun..6=Sat, matches WEEKDAY_LABELS in ItemForm.jsx
  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await guestEnter();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-family').click();
  await page.waitForSelector('text=🔆 Today');

  // ============ Create a recurring Reminder via ItemForm's Repeats section ============
  await page.getByRole('button', { name: '+ Reminder' }).click();
  let form = page.locator('form');
  ok('ItemForm: Repeats section is shown for a Reminder (showRecurrence opt-in)', await form.getByText('Repeats').isVisible());
  await form.getByPlaceholder('Title').fill('Send a healthy snack daily');
  const today = new Date().toISOString().slice(0, 10);
  await form.locator('input[type="date"]').first().fill(today);

  await form.getByRole('button', { name: '🔁 Recurring' }).click();
  ok('Selecting Recurring reveals the weekday picker', await form.getByRole('button', { name: WEEKDAY_LABELS[todayWeekdayIndex()], exact: true }).isVisible());

  // Select today's weekday so the item is immediately due today.
  await form.getByRole('button', { name: WEEKDAY_LABELS[todayWeekdayIndex()], exact: true }).click();
  ok('Recurring item: Start Time input is hidden once Recurring is selected (time lives in schedule, not startTime)', !(await form.locator('input[type="time"]').first().isVisible().catch(() => false)));
  ok('Recurring item: All-day checkbox is hidden for a recurring item (not applicable)', !(await form.getByText('All day').isVisible().catch(() => false)));

  await form.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(400);

  ok('Recurring reminder appears in Today (immediately, no separate approval step for manual create)', await visible('Send a healthy snack daily'));
  ok('Recurring reminder shows the 🔁 marker in the Organizer list', await visible('🔁'));

  let items = await readItems();
  let snackItem = items.find((it) => it.title === 'Send a healthy snack daily');
  ok('schedule.recurring is true', snackItem?.schedule?.recurring === true);
  ok('schedule.weekdays contains today\'s weekday', Array.isArray(snackItem?.schedule?.weekdays) && snackItem.schedule.weekdays.includes(todayWeekdayIndex()));
  ok('schedule.active defaults to true', snackItem?.schedule?.active === true);
  ok('schedule.timeMode is null (no time selected)', snackItem?.schedule?.timeMode === null);
  ok('startDate persists as the recurrence\'s effective start boundary', snackItem?.startDate === today);
  ok('status stays "open" (a recurring Item is never itself marked completed)', snackItem?.status === 'open');

  // ============ Completing today's occurrence does NOT complete the underlying Item ============
  const snackRow = page.locator('.rounded-2xl.bg-white.border-gray-200').filter({ hasText: 'Send a healthy snack daily' });
  await snackRow.locator('button[aria-label="Mark complete"]').click();
  await page.waitForTimeout(300);

  items = await readItems();
  snackItem = items.find((it) => it.title === 'Send a healthy snack daily');
  ok('Completing today\'s occurrence never flips the Item\'s own status to completed', snackItem?.status === 'open');

  let completions = await readCompletions();
  let todaysCompletion = completions.find((c) => c.itemId === snackItem.id);
  ok('A per-occurrence completion record was created instead', !!todaysCompletion);
  ok('The completion record is marked completed:true', todaysCompletion?.completed === true);
  ok('occurrenceDate matches today', todaysCompletion?.occurrenceDate === new Date().toISOString().slice(0, 10));

  ok('The row visually shows as checked/done after completing today\'s occurrence', await snackRow.locator('button[aria-label="Mark not complete"]').isVisible());

  // Uncheck — must flip back to completed:false, never delete the record or touch the Item.
  await snackRow.locator('button[aria-label="Mark not complete"]').click();
  await page.waitForTimeout(300);
  completions = await readCompletions();
  todaysCompletion = completions.find((c) => c.itemId === snackItem.id);
  ok('Unchecking sets completed back to false (same record, not deleted)', todaysCompletion?.completed === false);
  ok('Exactly one completion document exists for this (item, date) — no duplicate created by the toggle', completions.filter((c) => c.itemId === snackItem.id).length === 1);

  // ============ Edit round-trip: the Repeats section pre-fills from the existing schedule ============
  await snackRow.getByText('Edit').click();
  form = page.locator('form');
  ok('Edit: Recurring is pre-selected (not One-time)', await form.getByRole('button', { name: '🔁 Recurring' }).evaluate((el) => el.className.includes('bg-purple-700')));
  ok('Edit: today\'s weekday pill is pre-selected', await form.getByRole('button', { name: WEEKDAY_LABELS[todayWeekdayIndex()], exact: true }).evaluate((el) => el.className.includes('bg-indigo-600')));
  ok('Edit: label reads "Starts on" for a recurring item, not "Start"', await form.getByText('Starts on').isVisible());

  // Switch to a daypart time and save.
  await form.getByRole('button', { name: 'Morning/Evening' }).click();
  await form.locator('select').last().selectOption('evening');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(400);

  items = await readItems();
  snackItem = items.find((it) => it.title === 'Send a healthy snack daily');
  ok('Edit round-trip: timeMode persisted as daypart', snackItem?.schedule?.timeMode === 'daypart');
  ok('Edit round-trip: daypart persisted as evening', snackItem?.schedule?.daypart === 'evening');
  ok('Edit round-trip: still exactly one item (no duplicate created by editing)', items.filter((it) => it.title === 'Send a healthy snack daily').length === 1);

  // ============ Calendar projection: a recurring item due today appears on the Calendar's Today column ============
  await page.waitForSelector('text=📅 Coming Up');
  ok('Recurring reminder appears somewhere on the Calendar strip (its Today column) while still recurring', (await page.getByText('Send a healthy snack daily').count()) >= 2);

  // ============ Switching back to One-time clears the schedule entirely ============
  await snackRow.getByText('Edit').click();
  form = page.locator('form');
  await form.getByRole('button', { name: 'One-time' }).click();
  ok('Switching back to One-time relabels the date field back to "Start" (reminder type\'s normal label)', await form.getByText('Start', { exact: true }).isVisible());
  await form.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(400);
  items = await readItems();
  snackItem = items.find((it) => it.title === 'Send a healthy snack daily');
  ok('Switching to One-time and saving clears the schedule entirely (schedule: null)', snackItem?.schedule === null);

  // ============ Repeats is offered for every type that already shows a start date ============
  await page.getByRole('button', { name: '+ Family Event' }).click();
  form = page.locator('form');
  ok('Family Event also offers Repeats (a recurring family obligation is a valid use case)', await form.getByText('Repeats').isVisible());
  await form.getByRole('button', { name: 'Cancel' }).click();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
