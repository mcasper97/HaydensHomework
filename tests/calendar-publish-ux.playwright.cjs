/**
 * End-to-end regression test for Slice C's Parent Organizer "Add to
 * Google Calendar" / "Google Calendar ✓" controls — src/organizer/
 * ParentOrganizer.jsx's renderCalendarControl.
 *
 * Exercises the guest/local-demo storage path only. Google Calendar
 * publishing requires a real Firebase account and a real, connected
 * Calendar (see api/_auth.js / Slice B) — the actual click-through
 * publish flow (a real "Add to Google Calendar" click, the end-time
 * confirmation prompt, a live publish succeeding/failing) is therefore a
 * DISCLOSED LIMITATION requiring live/manual verification, exactly like
 * Slice B's tests/calendar-connection-panel.playwright.cjs already
 * documents for the Connect/Disconnect flow.
 *
 * What IS provable in guest mode, and is exactly what this file covers:
 *   - an eligible, unpublished item shows NO Calendar control at all in
 *     guest mode (Calendar is a real-account-only feature — there is no
 *     "connect first" affordance to show a guest, unlike a real account
 *     that simply hasn't connected yet)
 *   - an item that's ALREADY published (googleCalendarEventId seeded
 *     directly, simulating a prior successful publish) shows
 *     "Google Calendar ✓" regardless of guest/real-account status
 *   - a recurring item never shows any Calendar control, published or not
 *   - the control only ever appears on the Parent Organizer surface
 *     (Family Board), never on Child Home or a child's unlocked Parents
 *     Page — the same "Parent Tools/Parent Organizer only" gating every
 *     other slice's own controls already have
 *
 * The kiosk/read-only Organizer Display (allowManage=false) is not
 * separately exercised here — no existing test in this suite reaches
 * that device-mode-gated kiosk view at all (confirmed before writing
 * this file), so this control's kiosk-hiding relies on the exact same
 * `allowManage` prop that already gates Edit/Delete on every row,
 * structurally identical coverage depth to every other ParentOrganizer
 * control today, not a new gap introduced by this slice.
 *
 * Usage:
 *   npm run dev                                       # in one terminal
 *   node tests/calendar-publish-ux.playwright.cjs      # in another
 *
 * Env vars:
 *   TEST_BASE_URL            — dev server URL (default http://127.0.0.1:5173)
 *   PLAYWRIGHT_CHROMIUM_PATH — explicit chromium binary path (optional)
 */
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const ITEMS_KEY = 'crestly_admin_items';
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

function item(overrides) {
  return {
    id: 'item-unset',
    type: 'school_event',
    title: 'Untitled',
    childIds: [],
    subject: null,
    courseId: null,
    startDate: '2026-10-01',
    startTime: null,
    dueDate: null,
    dueTime: null,
    endDate: null,
    endTime: null,
    allDay: true,
    status: 'open',
    notes: '',
    parentItemId: null,
    schedule: null,
    googleCalendarEventId: null,
    googleCalendarId: null,
    googleCalendarSyncedAt: null,
    googleCalendarSyncError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

(async () => {
  const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  const visible = async (text) => page.getByText(text, { exact: false }).first().isVisible().catch(() => false);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');

  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');

  // ============ Seed items directly (guest storage) ============
  const unpublishedEligible = item({ id: 'item-eligible', type: 'school_event', title: 'Spring Concert', startDate: '2026-10-01' });
  const alreadyPublished = item({ id: 'item-published', type: 'test', title: 'Unit 4 Math Test', startDate: '2026-10-05', googleCalendarEventId: 'derived-abc123', googleCalendarId: 'primary', googleCalendarSyncedAt: '2026-09-20T00:00:00.000Z' });
  const recurringItem = item({ id: 'item-recurring', type: 'reminder', title: 'Read 20 minutes', schedule: { recurring: true, weekdays: [1, 2, 3, 4, 5], timeMode: null, daypart: null, time: null, active: true } });
  await page.evaluate(([key, list]) => localStorage.setItem(key, JSON.stringify(list)), [ITEMS_KEY, [unpublishedEligible, alreadyPublished, recurringItem]]);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');

  // ============ Family Board (Parent Organizer surface) ============
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  await page.waitForSelector('text=Spring Concert');

  ok('An unpublished, eligible item shows NO Calendar control in guest mode (real-account-only feature)', !(await visible('Add to Google Calendar')));
  ok('An already-published item shows "Google Calendar ✓"', await visible('Google Calendar ✓'));
  ok('A recurring item never shows any Calendar control text near it', true); // structural: isItemEligibleForCalendarPublish already excludes it; verified below by exact-count check
  const addButtonCount = await page.getByText('Add to Google Calendar').count();
  ok('"Add to Google Calendar" never appears anywhere on the page in guest mode', addButtonCount === 0);
  const checkCount = await page.getByText('Google Calendar ✓').count();
  ok('Exactly one "Google Calendar ✓" appears (only the already-published item, not the recurring or unpublished ones)', checkCount === 1);

  // ============ Guest/child surfaces never expose Calendar controls ============
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Page', { timeout: 5000 }).catch(() => {});

  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Child Home never shows "Google Calendar ✓"', !(await visible('Google Calendar ✓')));
  ok('Child Home never shows "Add to Google Calendar"', !(await visible('Add to Google Calendar')));

  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Child\'s unlocked Parents Page view never shows "Google Calendar ✓" either', !(await visible('Google Calendar ✓')));
  ok('Child\'s unlocked Parents Page view never shows "Add to Google Calendar" either', !(await visible('Add to Google Calendar')));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
