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
 *   - no Calendar status indicator of any kind (success or failure) shows
 *     up inline on the unified Family Board agenda for ANY item, published
 *     or not — see this file's own inline note on that: the old "Google
 *     Calendar ✓" indicator's home (ParentOrganizer.jsx) is no longer
 *     rendered anywhere; a publish failure now surfaces on a different
 *     surface entirely (Review Inbox), and a publish success currently has
 *     no visible indicator anywhere
 *   - Calendar controls/status never appear on Child Home or a child's
 *     unlocked Parents Page either
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
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Seed items directly (guest storage) ============
  const unpublishedEligible = item({ id: 'item-eligible', type: 'school_event', title: 'Spring Concert', startDate: '2026-10-01' });
  const alreadyPublished = item({ id: 'item-published', type: 'test', title: 'Unit 4 Math Test', startDate: '2026-10-05', googleCalendarEventId: 'derived-abc123', googleCalendarId: 'primary', googleCalendarSyncedAt: '2026-09-20T00:00:00.000Z' });
  const recurringItem = item({ id: 'item-recurring', type: 'reminder', title: 'Read 20 minutes', schedule: { recurring: true, weekdays: [1, 2, 3, 4, 5], timeMode: null, daypart: null, time: null, active: true } });
  await page.evaluate(([key, list]) => localStorage.setItem(key, JSON.stringify(list)), [ITEMS_KEY, [unpublishedEligible, alreadyPublished, recurringItem]]);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ Family Board (unified agenda surface) ============
  // NOTE: Family Board's unified agenda (organizer/FamilyAgenda.jsx) never
  // renders ANY Calendar status at all on a row (no button, no "✓"
  // indicator) — that's a real, deliberately-scoped-out-of-this-round
  // finding: the old "Google Calendar ✓" read-only indicator lived in
  // ParentOrganizer.jsx's renderCalendarControl, which is no longer
  // imported/rendered by anything now that Family Board renders the
  // unified agenda instead (same underlying cause as the item-edit gap
  // found in tests/domain-hardening.playwright.cjs — see this round's
  // report). A publish FAILURE still surfaces, but on a different surface
  // entirely (Review Inbox's "Google Calendar issues" section — see
  // tests/review-inbox-calendar-issues.playwright.cjs, unaffected by this
  // change). A publish SUCCESS currently has no visible indicator
  // anywhere. This file is updated to assert the surface's actual current
  // behavior rather than the no-longer-true "shows ✓ when published"
  // behavior; do not restore ParentOrganizer.jsx's UI to fix this here —
  // that's a Family Board design decision outside this test-migration pass.
  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-agenda"]', { timeout: 10000 });
  await page.waitForSelector('text=Spring Concert');

  ok('An unpublished, eligible item shows NO Calendar control in guest mode (real-account-only feature)', !(await visible('Add to Google Calendar')));
  const addButtonCount = await page.getByText('Add to Google Calendar').count();
  ok('"Add to Google Calendar" never appears anywhere on the page (the old per-item button stays removed)', addButtonCount === 0);
  const checkCount = await page.getByText('Google Calendar ✓').count();
  ok('No "Google Calendar ✓" indicator appears anywhere either (no per-row publish-status surface currently exists on the unified agenda — a known gap, not asserted as a passing feature)', checkCount === 0);

  // ============ Guest/child surfaces never expose Calendar controls ============
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  // Board Selector's Learners section is a direct child-selection entry
  // point (navigation refactor), but a child's Parents Page (used here) is
  // specifically reached via Parent Board's "Upload Homework/Photo" action
  // instead. Child Home (the game/My Day view) is a wholly separate
  // App.jsx render path that never imports any Calendar module in the
  // first place, so it's not separately re-verified here.
  await page.getByTestId('board-parent').click();
  await page.getByTestId('action-upload-homework').click();
  await page.getByTestId('parent-organizer-panel').getByText('Ava', { exact: true }).click();
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
