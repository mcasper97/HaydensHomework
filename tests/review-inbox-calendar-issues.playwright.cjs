/**
 * Focused regression test for the Review Inbox's "Google Calendar issues"
 * section (Section 13 of the task spec) — a durable recovery path for an
 * Item that committed successfully but whose Google Calendar publish
 * attempt failed. Must look visually and textually distinct from "please
 * review this candidate before it can be committed" — these Items are
 * already real, committed Items; only the Calendar side effect needs a
 * retry.
 *
 * Exercises the guest/local-demo storage path — Calendar can never
 * actually connect in guest mode (see api/_auth.js), so a real end-to-end
 * publish/retry can't run here (same disclosed limitation as every other
 * Gmail/Calendar-adjacent *.playwright.cjs file in this suite). The
 * failing Item is seeded directly into localStorage (the same established
 * "inject already-persisted state" technique tests/review-inbox.playwright.cjs
 * and tests/domain-hardening.playwright.cjs already use for a state the UI
 * itself cannot otherwise produce), and Retry is exercised purely for
 * "does the UI wiring work / never crashes", not for a real recovery —
 * src/data/googleCalendarAutoPublish.js's own guest-mode gating is
 * separately unit-tested in tests/google-calendar-auto-publish.unit.mjs.
 *
 * Usage:
 *   npm run dev                                                    # in one terminal
 *   node tests/review-inbox-calendar-issues.playwright.cjs          # in another
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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // Seed a committed Item whose Calendar publish already failed once —
  // exactly the durable state src/data/googleCalendarAutoPublish.js's
  // attemptCalendarPublish writes onto an existing (previously reserved,
  // now first-used) Item field.
  await page.evaluate(() => {
    const items = [{
      id: 'seed-calendar-issue',
      type: 'school_event',
      title: 'Picture Day',
      childIds: [],
      startDate: '2026-10-15',
      allDay: true,
      status: 'open',
      notes: '',
      source: { type: 'manual', sourceId: null },
      commitMode: 'automatic',
      googleCalendarEventId: null,
      googleCalendarId: null,
      googleCalendarSyncedAt: null,
      googleCalendarSyncError: 'Could not publish to Google Calendar.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    localStorage.setItem('crestly_admin_items', JSON.stringify(items));
  });

  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');

  // A retrying check, not a one-shot .textContent() — ParentBoard.jsx's
  // calendarIssues state updates via a useEffect after mount, so a bare
  // read right after the grid container appears can race that re-render
  // (same class of timing flake already fixed elsewhere in this suite,
  // e.g. tests/child-page-back-navigation.playwright.cjs's own
  // `visibleEventually` helper).
  await page.waitForFunction(
    () => document.querySelector('[data-testid="action-review-inbox"]')?.textContent?.includes('1'),
    { timeout: 3000 }
  ).catch(() => {});
  ok('The Review Inbox badge reflects the Calendar issue too', (await page.getByTestId('action-review-inbox').textContent() || '').includes('1'));

  await page.getByTestId('action-review-inbox').click();
  await page.waitForSelector('[data-testid="calendar-issues-panel"]', { timeout: 5000 }).catch(() => {});

  ok('The "Google Calendar issues" section is visible', await page.getByTestId('calendar-issues-panel').isVisible());
  ok('It shows the affected item\'s title', await visible('Picture Day'));
  ok('It shows the recorded failure message', await visible('Could not publish to Google Calendar.'));
  ok('It offers a "Retry" action', await page.getByTestId('calendar-issue-row').getByRole('button', { name: 'Retry' }).isVisible());

  ok(
    'It does NOT use "please review this candidate" framing — this is already a committed Item',
    !(await page.getByText('review this candidate').isVisible().catch(() => false))
  );
  ok(
    'It is visually distinct from the normal "awaiting review" candidate framing',
    !(await page.getByTestId('calendar-issues-panel').getByText('awaiting review').isVisible().catch(() => false))
  );
  ok(
    'The normal Review Inbox ("No items waiting for review.") is unaffected — this is a separate section',
    await visible('No items waiting for review.')
  );

  // Retry never crashes the page, even though guest mode can't actually
  // complete a real publish (see this file's own header comment).
  await page.getByTestId('calendar-issue-row').getByRole('button', { name: 'Retry' }).click();
  await page.waitForTimeout(300);
  ok('Clicking Retry does not crash or navigate away', await page.getByTestId('calendar-issues-panel').isVisible());
  ok('The item remains visible after Retry (guest mode cannot actually fix it, and correctly leaves it as-is)', await visible('Picture Day'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
