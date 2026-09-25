/**
 * Focused regression test for Parent Board's "Needs Attention" section
 * (MVP attention layer) — derives from src/data/attentionSummary.js and
 * renders near the top of Parent Board's action grid (src/ParentBoard.jsx).
 *
 * Covers, via the guest/local-demo storage path (same established
 * "inject already-persisted state" technique tests/review-inbox.playwright.cjs
 * and tests/review-inbox-calendar-issues.playwright.cjs already use):
 *   - no issues at all -> "Nothing needs your attention"
 *   - pending Review Inbox candidates -> a Review Inbox attention row, with
 *     the correct count, that navigates into the existing Review Inbox tool
 *     view on click
 *   - a Calendar publish failure -> a Google Calendar attention row, with
 *     the correct count, that ALSO navigates into the existing Review
 *     Inbox tool view (the Calendar-issues/retry section already lives
 *     there — see ReviewInboxPanel.jsx — so no second recovery surface is
 *     created)
 *   - both conditions together, with correct per-row counts
 *   - Family Board is unaffected (not visited here; asserted structurally
 *     by never touching src/FamilyBoard.jsx or its data)
 *
 * DISCLOSED LIMITATION (same convention already established in this suite
 * — see tests/calendar-routing-ux.playwright.cjs's own header comment):
 * the Gmail "needsReconnect" attention condition requires a real
 * Firebase-authenticated parent with a real Gmail connection in a
 * reconnect-needed state — guest mode has no real Firebase Auth session at
 * all (auth.currentUser is null), so fetchGmailStatus() always fails
 * closed to {connected:false, needsReconnect:false} before any network
 * call is even reachable to mock. That condition (and the click-through to
 * Settings' GmailConnectionPanel) is covered at the unit level in
 * tests/attention-summary.unit.mjs instead, and remains a live/manual
 * verification item for a real account, exactly like every other
 * real-Gmail-connection-state UI in this suite.
 *
 * Usage:
 *   npm run dev                                              # in one terminal
 *   node tests/parent-board-needs-attention.playwright.cjs    # in another
 *
 * Env vars:
 *   TEST_BASE_URL            — dev server URL (default http://127.0.0.1:5173)
 *   PLAYWRIGHT_CHROMIUM_PATH — explicit chromium binary path (optional)
 */
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const CANDIDATES_KEY = 'crestly_admin_ingestion_candidates';
const ITEMS_KEY = 'crestly_admin_items';
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

function candidate(overrides) {
  return {
    id: 'cand-unset',
    sourceRecordId: null,
    proposedType: 'test',
    title: 'Untitled',
    proposedChildName: null,
    date: '2026-10-01',
    subject: null,
    academicTopic: null,
    academicUnit: null,
    preparationRequired: null,
    description: null,
    extractionConfidence: null,
    reviewStatus: 'pending',
    targetType: null,
    targetChildId: null,
    startTime: null,
    endTime: null,
    recurrenceSuggestion: null,
    reconciledItemId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function calendarIssueItem(overrides) {
  return {
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

  const visible = async (text) => page.getByText(text).first().isVisible().catch(() => false);
  const enterGuest = async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByText('Continue without an account').click();
    await page.waitForSelector('text=Haydens - Homework');
  };
  const openParentBoard = async () => {
    await page.getByTestId('board-parent').click();
    await page.waitForSelector('text=Parent Board');
    // The attention-relevant subscriptions/reads settle asynchronously
    // after mount (same class of timing consideration already documented
    // in tests/review-inbox.playwright.cjs and
    // tests/review-inbox-calendar-issues.playwright.cjs).
    await page.waitForTimeout(300);
  };

  // ============ No issues at all ============
  await enterGuest();
  await openParentBoard();
  await page.waitForSelector('[data-testid="needs-attention-section"]');
  ok('Needs Attention section is visible on Parent Board', await page.getByTestId('needs-attention-section').isVisible());
  ok('With no issues, it shows "Nothing needs your attention"', await visible('✓ Nothing needs your attention'));
  ok('No attention rows are rendered when there is nothing to report', (await page.getByTestId(/^attention-row-/).count()) === 0);

  // ============ Pending Review Inbox candidates ============
  const pendingOne = candidate({ id: 'cand-1', title: 'Spelling Test', createdAt: '2020-01-01T00:00:00.000Z' });
  const pendingTwo = candidate({ id: 'cand-2', title: 'Field Trip Form', createdAt: '2020-01-02T00:00:00.000Z' });
  await page.evaluate(([k, list]) => localStorage.setItem(k, JSON.stringify(list)), [CANDIDATES_KEY, [pendingOne, pendingTwo]]);
  await page.reload({ waitUntil: 'networkidle' });
  await enterGuest();
  await openParentBoard();

  ok('Nothing-needed message is gone once a pending candidate exists', !(await visible('✓ Nothing needs your attention')));
  ok('A Review Inbox attention row is visible', await page.getByTestId('attention-row-review_inbox').isVisible());
  ok('The Review Inbox row shows the correct count/text', (await page.getByTestId('attention-row-review_inbox').textContent() || '').includes('2 items need review'));
  ok('No Google Calendar attention row yet (no calendar issues seeded)', (await page.getByTestId('attention-row-calendar').count()) === 0);

  await page.getByTestId('attention-row-review_inbox').click();
  ok('Clicking the Review Inbox attention row opens the existing Review Inbox tool view', await page.getByTestId('parent-tool-view').isVisible());
  ok('The pending candidate is visible inside the opened Review Inbox', await visible('Spelling Test'));
  await page.getByText('← Back to Parent Board').click();
  await page.waitForSelector('[data-testid="needs-attention-section"]');

  // ============ Calendar publish failure, alongside the still-pending candidates ============
  const calendarIssue = calendarIssueItem({});
  await page.evaluate(([k, list]) => localStorage.setItem(k, JSON.stringify(list)), [ITEMS_KEY, [calendarIssue]]);
  await page.reload({ waitUntil: 'networkidle' });
  await enterGuest();
  await openParentBoard();

  ok('Both a Review Inbox row and a Google Calendar row are visible together', await page.getByTestId('attention-row-review_inbox').isVisible() && await page.getByTestId('attention-row-calendar').isVisible());
  ok('The Review Inbox row count is still correct (2) alongside the Calendar row', (await page.getByTestId('attention-row-review_inbox').textContent() || '').includes('2 items need review'));
  ok('The Google Calendar row shows the correct singular count/text', (await page.getByTestId('attention-row-calendar').textContent() || '').includes('1 item needs retry'));

  await page.getByTestId('attention-row-calendar').click();
  ok('Clicking the Google Calendar attention row ALSO opens the existing Review Inbox tool view (same canonical recovery surface, no duplicate screen)', await page.getByTestId('parent-tool-view').isVisible());
  ok('The Calendar-issues panel (already existing inside Review Inbox) is visible', await page.getByTestId('calendar-issues-panel').isVisible());
  ok('The failing item\'s title is shown there', await visible('Picture Day'));

  await page.getByText('← Back to Parent Board').click();
  await page.waitForSelector('[data-testid="needs-attention-section"]');

  // ============ Family Board is unaffected ============
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-family').click();
  await page.waitForTimeout(300);
  ok('Family Board renders normally and was never touched by the Needs Attention work', (await page.getByTestId('needs-attention-section').count()) === 0);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
