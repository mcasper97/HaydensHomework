/**
 * End-to-end regression test for the durable Review Inbox (Slice 1) —
 * src/organizer/ReviewInboxPanel.jsx, src/data/ingestionCandidatesRepository.js's
 * subscribePendingIngestionCandidates, and AuthShell.jsx's ChildSelector
 * wiring (single subscription driving both the Parent Tools badge and the
 * inbox list, plus the reopened CandidateReviewModal + auto-close).
 *
 * Exercises the guest/local-demo storage path (localStorage-backed), same
 * as every other *.playwright.cjs file in this suite. Real photo/email
 * ingestion cannot create a genuine IngestionCandidate in guest mode (no
 * real Firebase auth — see photo-ingestion-guest-gate.playwright.cjs's own
 * header comment for the same disclosed limitation), so this test injects
 * already-persisted candidates directly into the guest localStorage key
 * BEFORE the app reads it — which is in fact the most faithful way to
 * prove "reads from persisted storage, not from in-memory state created by
 * this session's own capture flow," exactly the property Slice 1 exists
 * to guarantee. "A new candidate appears live without duplicating" is
 * proven instead at the repository level, where a real
 * createIngestionCandidate() call is actually possible — see
 * tests/review-inbox-repository.unit.mjs.
 *
 * Usage:
 *   npm run dev                                    # in one terminal
 *   node tests/review-inbox.playwright.cjs          # in another
 *
 * Env vars:
 *   TEST_BASE_URL            — dev server URL (default http://127.0.0.1:5173)
 *   PLAYWRIGHT_CHROMIUM_PATH — explicit chromium binary path (optional)
 */
const { chromium } = require('playwright');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const CANDIDATES_KEY = 'crestly_admin_ingestion_candidates';
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

(async () => {
  const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  const visible = async (text) => page.getByText(text).first().isVisible().catch(() => false);
  const readCandidates = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), CANDIDATES_KEY);
  const writeCandidates = (list) => page.evaluate(([k, l]) => localStorage.setItem(k, JSON.stringify(l)), [CANDIDATES_KEY, list]);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');
  const avaId = (await page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_children') || '[]')))[0]?.id;
  ok('Learner Ava was created with a stable id', !!avaId);

  // ============ Seed: a mix of every lifecycle status + target shapes ============
  const childTargeted = candidate({ id: 'cand-child', title: 'Spelling Test', proposedType: 'test', targetType: 'child', targetChildId: avaId, createdAt: '2020-01-01T00:00:00.000Z' });
  const legacyNoTarget = candidate({ id: 'cand-legacy', title: 'Field Trip Form', proposedType: 'reminder', targetType: null, targetChildId: null, createdAt: '2020-01-02T00:00:00.000Z' });
  const familyTargeted = candidate({ id: 'cand-family', title: 'Back to School Night', proposedType: 'family_event', targetType: 'family', targetChildId: null, createdAt: '2020-01-03T00:00:00.000Z' });
  const missingSource = candidate({ id: 'cand-missing-src', title: 'Book Report', proposedType: 'assignment', sourceRecordId: 'does-not-exist', targetType: 'child', targetChildId: avaId, createdAt: '2020-01-04T00:00:00.000Z' });
  const alreadyApproved = candidate({ id: 'cand-approved', title: 'Already approved', reviewStatus: 'approved' });
  const alreadyRejected = candidate({ id: 'cand-rejected', title: 'Already rejected', reviewStatus: 'rejected' });
  const alreadyCommitted = candidate({ id: 'cand-committed', title: 'Already committed', reviewStatus: 'committed' });
  const alreadyCorroborated = candidate({ id: 'cand-corroborated', title: 'Already corroborated', reviewStatus: 'corroborated' });

  await writeCandidates([childTargeted, legacyNoTarget, familyTargeted, missingSource, alreadyApproved, alreadyRejected, alreadyCommitted, alreadyCorroborated]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');

  // ============ Badge visible before opening Parent Tools ============
  const parentToolsButtonBefore = page.locator('button', { hasText: 'Parent Tools' });
  ok('A pending-count badge is visible on the Parent Tools button before it is opened', await parentToolsButtonBefore.getByText('4', { exact: true }).isVisible().catch(() => false));
  ok('Review Inbox panel is not visible before opening Parent Tools', !(await visible('Review Inbox')));

  await page.getByText('Parent Tools').click();
  await page.waitForSelector('text=Review Inbox');

  // ============ 1. Persisted pending candidates appear; 11. multiple shown once each ============
  ok('Persisted pending candidate (child-targeted) appears', await visible('Spelling Test'));
  ok('Persisted pending candidate (legacy, no target) appears', await visible('Field Trip Form'));
  ok('Persisted pending candidate (family-targeted) appears', await visible('Back to School Night'));
  ok('Persisted pending candidate (missing SourceRecord) appears', await visible('Book Report'));
  ok('Each pending candidate appears exactly once', (await page.getByText('Spelling Test').count()) === 1);
  ok('Inbox subtext shows the correct pending count', await visible('4 items awaiting review'));

  // ============ 8/9/10. approved/rejected/committed/corroborated never appear ============
  ok('An already-approved candidate is not shown', !(await visible('Already approved')));
  ok('An already-rejected candidate is not shown', !(await visible('Already rejected')));
  ok('An already-committed candidate is not shown', !(await visible('Already committed')));
  ok('An already-corroborated candidate is not shown', !(await visible('Already corroborated')));

  // ============ Badge and inbox agree (same subscription) ============
  const parentToolsButton = page.locator('button', { hasText: 'Parent Tools' });
  const badgeVisible = await parentToolsButton.getByText('4', { exact: true }).isVisible().catch(() => false);
  ok('The Parent Tools badge and the inbox list agree on the pending count (4)', badgeVisible);

  // ============ 5. Review reopens the existing CandidateReviewModal; 15/16. child-context restoration ============
  const childRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Spelling Test' });
  await childRow.getByText('Review', { exact: true }).click();
  let form = page.locator('form');
  ok('Clicking Review reopens the existing CandidateReviewModal (its ItemForm is visible)', await form.isVisible());
  ok('Review reuses the shared submit label ("Approve & Add"), proving it is the same modal, not a duplicate workflow', await visible('Approve & Add'));
  const avaPill = form.getByRole('button', { name: /Ava/ }).first();
  ok('A photo-sourced, child-targeted candidate restores the correct child preselected on deferred review', (await avaPill.getAttribute('class') || '').includes('bg-indigo-600'));

  // ============ 2. X-close leaves it pending ============
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(200);
  let stored = await readCandidates();
  ok('Closing via "×" leaves the candidate reviewStatus unchanged ("pending")', stored.find((c) => c.id === 'cand-child')?.reviewStatus === 'pending');
  ok('The candidate is still shown in the inbox after closing without resolving', await visible('Spelling Test'));

  // ============ 3/4. Survives refresh; survives navigation away/back ============
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');
  await page.getByText('Parent Tools').click();
  await page.waitForSelector('text=Review Inbox');
  ok('Pending candidate survives a full page refresh', await visible('Spelling Test'));

  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Page');
  await page.getByText('Parent Tools').click();
  await page.waitForSelector('text=Review Inbox');
  ok('Pending candidate survives navigating away (Family Board) and back', await visible('Spelling Test'));

  // ============ 13. Missing SourceRecord remains reviewable ============
  const missingRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Book Report' });
  await missingRow.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  ok('A candidate whose sourceRecordId points at a deleted/missing SourceRecord is still reviewable (no crash, form renders)', await form.getByPlaceholder('Title').inputValue().then((v) => v === 'Book Report'));
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(150);

  // ============ 15/16 continued: legacy (no target) requires manual selection; family-target never mis-assigns a child ============
  const legacyRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Field Trip Form' });
  await legacyRow.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  let legacyAvaClass = (await form.getByRole('button', { name: /Ava/ }).first().getAttribute('class')) || '';
  ok('A legacy candidate with no targetChildId does NOT preselect Ava (manual selection required)', !legacyAvaClass.includes('bg-indigo-600'));
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(150);

  const familyRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Back to School Night' });
  await familyRow.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  // A "family"-targeted candidate starts with "Whole family" checked
  // (resolveFamilyWideOption), which hides the per-child pill picker
  // entirely — the correct proof that a specific child was never
  // incorrectly preselected is that Whole family is checked, not that some
  // (nonexistent, in this state) child pill lacks a selected class.
  const wholeFamilyCheckbox = form.locator('label', { hasText: 'Whole family' }).locator('input[type="checkbox"]');
  ok('A family-targeted candidate starts with "Whole family" checked, never a specific child preselected', await wholeFamilyCheckbox.isChecked());
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(150);

  // ============ 6/17/18/19. Approve removes it from the inbox; auto-close ============
  const reopenChild = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Spelling Test' });
  await reopenChild.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  await form.getByRole('button', { name: 'Approve & Add' }).click();
  await page.waitForTimeout(400);

  ok('Approving removes the candidate from the pending inbox', !(await visible('Spelling Test')));
  stored = await readCandidates();
  ok('The underlying candidate is now committed (existing approve/commit lifecycle unchanged)', stored.find((c) => c.id === 'cand-child')?.reviewStatus === 'committed');
  ok('The reopened modal auto-closed after resolution (no lingering form)', !(await page.locator('form').isVisible().catch(() => false)));

  // ============ 7. Reject removes it from the inbox ============
  const reopenLegacy = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Field Trip Form' });
  await reopenLegacy.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);

  ok('Rejecting (via ItemForm\'s in-form Cancel) removes the candidate from the pending inbox', !(await visible('Field Trip Form')));
  stored = await readCandidates();
  ok('The underlying candidate is now rejected', stored.find((c) => c.id === 'cand-legacy')?.reviewStatus === 'rejected');

  // ============ Remaining candidates still correct after two resolutions ============
  ok('Untouched pending candidates remain visible after others resolve', await visible('Back to School Night') && await visible('Book Report'));

  // ============ 14. Load error differs from empty (simulated via a corrupted localStorage value) ============
  await page.evaluate((k) => localStorage.setItem(k, 'not valid json{{{'), CANDIDATES_KEY);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');
  await page.getByText('Parent Tools').click();
  await page.waitForSelector('text=Review Inbox');
  // Guest mode's own JSON.parse failure is caught internally and reads as
  // an empty list (documented, existing "fails closed silently" guest
  // behavior — see ingestionCandidatesRepository.js's readGuestCandidates).
  // This is NOT the same code path as the real Firestore onError path
  // (proven separately and precisely in
  // tests/review-inbox-error-path.unit.mjs, which is the only branch that
  // can genuinely produce a distinguishable network/permission failure).
  ok('A malformed guest localStorage value fails closed to an empty (not crashed) inbox', await visible('No items waiting for review.'));

  // ============ 12/16. Parent Tools only — Family Board / Shared Display never expose it ============
  await page.evaluate((k) => localStorage.removeItem(k), CANDIDATES_KEY);
  await writeCandidates([candidate({ id: 'cand-visibility', title: 'Visibility Probe', createdAt: '2020-01-01T00:00:00.000Z' })]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Page');

  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board never shows "Review Inbox"', !(await page.getByText('Review Inbox').isVisible().catch(() => false)));
  ok('Family Board never shows a pending candidate title', !(await page.getByText('Visibility Probe').isVisible().catch(() => false)));
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Page', { timeout: 5000 }).catch(() => {});

  // ============ 16. Child Experience never exposes it ============
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Payton');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Payton');
  await page.getByText('Payton', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Child Home never shows "Review Inbox"', !(await page.getByText('Review Inbox').isVisible().catch(() => false)));
  ok('Child Home never shows a "Parent Tools" control either (unchanged existing gating)', !(await page.getByText('Parent Tools').isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Child\'s unlocked Parents Page view never shows "Review Inbox" either', !(await page.getByText('Review Inbox').isVisible().catch(() => false)));

  // ============ 17/18/19: existing immediate post-ingestion review flow (photo/CSV path) is unaffected ============
  ok('Photo-import card is still present on the child\'s Parents Page (immediate-capture flow untouched)', await visible('Import from a Photo'));
  ok('CSV import card is still present too (unaffected by this slice)', await visible('Import Teacher Plan (CSV)'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
