/**
 * End-to-end regression test for the durable Review Inbox (Slice 1) —
 * src/organizer/ReviewInboxPanel.jsx, src/data/ingestionCandidatesRepository.js's
 * subscribePendingIngestionCandidates, and src/ParentHome.jsx's wiring
 * (single subscription driving both Parent Home's "Review Inbox" action-card
 * badge and the inbox list, plus the reopened CandidateReviewModal +
 * auto-close). A later UI/IA refactor replaced the old "Parent Tools"
 * toggle button + badge with this action-card grid (see ParentHome.jsx) and
 * moved add-learner into the permanent Settings page — no change to the
 * underlying subscription/badge-count logic itself.
 *
 * Includes three post-launch product corrections to CandidateReviewModal.jsx's
 * exit actions. First correction: the explicit, distinctly-labeled "Review
 * later" action is what leaves a candidate pending and visible in the
 * inbox — "×" no longer implicitly means that. Second correction
 * (superseding the first correction's own "×" behavior): "×" opened a
 * small local "Discard this suggestion?" confirmation defaulting toward a
 * reject-like decision. Third correction (superseding the second): Review
 * Inbox is durable, so closing the modal is never destructive — "×" is
 * back to a plain, immediate close with NO confirmation, behaving exactly
 * like "Review later" (leaves the candidate pending, still visible in the
 * inbox, count unchanged). Only the explicit "Reject" button ever writes
 * reviewStatus:"rejected".
 *
 * Also covers Slice 2 (Candidate-to-Item Idempotency + Recovery): a
 * candidate stranded at reviewStatus:"approved" (impossible for a FRESH
 * approval to produce anymore — see candidateCommitRepository.js — but
 * reachable by a legacy candidate from before Slice 2) now appears in the
 * inbox tagged "Needs attention" instead of being invisible, and reopening
 * it renders CandidateReviewModal's restricted recovery UI (no Reject, no
 * Review later, "×" closes immediately, submit reads "Finish Adding")
 * rather than the normal four-action review UI.
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
  const reviewInboxCard = () => page.getByTestId('action-review-inbox');
  const addLearner = async (name) => {
    await page.getByTestId('action-settings').click();
    await page.waitForSelector('text=Settings');
    await page.getByText('+ Add a learner').click();
    await page.getByPlaceholder("Child's name").fill(name);
    await page.getByText('Add Learner').click();
    await page.waitForSelector(`text=${name}`);
    await page.getByText('← Parent Home').click();
    await page.waitForSelector('text=Parent Home');
  };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');
  await addLearner('Ava');
  const avaId = (await page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_children') || '[]')))[0]?.id;
  ok('Learner Ava was created with a stable id', !!avaId);

  // ============ Seed: a mix of every lifecycle status + target shapes ============
  const childTargeted = candidate({ id: 'cand-child', title: 'Spelling Test', proposedType: 'test', targetType: 'child', targetChildId: avaId, createdAt: '2020-01-01T00:00:00.000Z' });
  const legacyNoTarget = candidate({ id: 'cand-legacy', title: 'Field Trip Form', proposedType: 'reminder', targetType: null, targetChildId: null, createdAt: '2020-01-02T00:00:00.000Z' });
  const familyTargeted = candidate({ id: 'cand-family', title: 'Back to School Night', proposedType: 'family_event', targetType: 'family', targetChildId: null, createdAt: '2020-01-03T00:00:00.000Z' });
  const missingSource = candidate({ id: 'cand-missing-src', title: 'Book Report', proposedType: 'assignment', sourceRecordId: 'does-not-exist', targetType: 'child', targetChildId: avaId, createdAt: '2020-01-04T00:00:00.000Z' });
  const xRejectTarget = candidate({ id: 'cand-x-reject', title: 'Permission Slip', proposedType: 'reminder', createdAt: '2020-01-05T00:00:00.000Z' });
  const alreadyApproved = candidate({ id: 'cand-approved', title: 'Already approved', reviewStatus: 'approved' });
  const alreadyRejected = candidate({ id: 'cand-rejected', title: 'Already rejected', reviewStatus: 'rejected' });
  const alreadyCommitted = candidate({ id: 'cand-committed', title: 'Already committed', reviewStatus: 'committed' });
  const alreadyCorroborated = candidate({ id: 'cand-corroborated', title: 'Already corroborated', reviewStatus: 'corroborated' });

  await writeCandidates([childTargeted, legacyNoTarget, familyTargeted, missingSource, xRejectTarget, alreadyApproved, alreadyRejected, alreadyCommitted, alreadyCorroborated]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');

  // ============ Badge visible before opening the Review Inbox action ============
  // 6, not 5: the 5 pending candidates PLUS the legacy "approved" recovery
  // candidate (Slice 2 — see below), which now also counts.
  ok('A pending-count badge is visible on the "Review Inbox" action card before it is opened', (await reviewInboxCard().textContent() || '').includes('6'));
  ok('Review Inbox panel is not visible before tapping the action card', !(await page.getByText('awaiting review').isVisible().catch(() => false)));

  await reviewInboxCard().click();
  await page.waitForSelector('text=awaiting review');

  // ============ 1. Persisted pending candidates appear; 11. multiple shown once each ============
  ok('Persisted pending candidate (child-targeted) appears', await visible('Spelling Test'));
  ok('Persisted pending candidate (legacy, no target) appears', await visible('Field Trip Form'));
  ok('Persisted pending candidate (family-targeted) appears', await visible('Back to School Night'));
  ok('Persisted pending candidate (missing SourceRecord) appears', await visible('Book Report'));
  ok('Persisted pending candidate (for the "×" close-behavior check below) appears', await visible('Permission Slip'));
  ok('Each pending candidate appears exactly once', (await page.getByText('Spelling Test').count()) === 1);
  ok('Inbox subtext shows the correct pending+needs-attention count', await visible('6 items awaiting review'));

  // ============ 8/9/10. rejected/committed/corroborated never appear; legacy-approved appears as "Needs attention" (Slice 2) ============
  ok('A legacy-approved candidate IS shown (Slice 2 recovery, not invisible)', await visible('Already approved'));
  const approvedRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Already approved' });
  ok('Its row carries the "Needs attention" tag', await approvedRow.getByTestId('review-inbox-needs-attention').isVisible());
  ok('An already-rejected candidate is not shown', !(await visible('Already rejected')));
  ok('An already-committed candidate is not shown', !(await visible('Already committed')));
  ok('An already-corroborated candidate is not shown', !(await visible('Already corroborated')));
  ok('A normal pending row does NOT carry the "Needs attention" tag', !(await page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Spelling Test' }).getByTestId('review-inbox-needs-attention').isVisible().catch(() => false)));

  // ============ Badge and inbox agree (same subscription) ============
  ok('The action-card badge and the inbox list agree on the pending+needs-attention count (6)', (await reviewInboxCard().textContent() || '').includes('6'));

  // ============ 5. Review reopens the existing CandidateReviewModal; 15/16. child-context restoration ============
  const childRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Spelling Test' });
  await childRow.getByText('Review', { exact: true }).click();
  let form = page.locator('form');
  ok('Clicking Review reopens the existing CandidateReviewModal (its ItemForm is visible)', await form.isVisible());
  ok('Review reuses the shared submit label ("Approve & Add"), proving it is the same modal, not a duplicate workflow', await visible('Approve & Add'));
  const avaPill = form.getByRole('button', { name: /Ava/ }).first();
  ok('A photo-sourced, child-targeted candidate restores the correct child preselected on deferred review', (await avaPill.getAttribute('class') || '').includes('bg-indigo-600'));

  // ============ "×", "Review later", and "Reject" are distinct, independently present actions ============
  const xButton = page.locator('button[aria-label="Close"]');
  const reviewLaterButton = page.getByRole('button', { name: /Review later/ });
  ok('The "×" control (aria-label "Close") is present', await xButton.isVisible());
  ok('The "Review later" control is present at the same time, as a visibly distinct element', await reviewLaterButton.isVisible());
  ok('The "Reject" control (ItemForm\'s relabeled Cancel button) is present at the same time too', await form.getByRole('button', { name: 'Reject' }).isVisible());

  // ============ "Review later" leaves it pending and closes the modal (product correction) ============
  await reviewLaterButton.click();
  await page.waitForTimeout(200);
  let stored = await readCandidates();
  ok('"Review later" leaves the candidate reviewStatus unchanged ("pending")', stored.find((c) => c.id === 'cand-child')?.reviewStatus === 'pending');
  ok('The candidate is still shown in the inbox after "Review later"', await visible('Spelling Test'));
  ok('"Review later" closes the modal (no lingering form)', !(await page.locator('form').isVisible().catch(() => false)));

  // ============ 3/4. A "Review later"-deferred candidate survives refresh; survives navigation away/back ============
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');
  await reviewInboxCard().click();
  await page.waitForSelector('text=awaiting review');
  ok('A "Review later"-deferred candidate survives a full page refresh', await visible('Spelling Test'));

  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Home');
  await reviewInboxCard().click();
  await page.waitForSelector('text=awaiting review');
  ok('A "Review later"-deferred candidate survives navigating away (Family Board) and back', await visible('Spelling Test'));

  // ============ "×" closes immediately — same as "Review later", no confirmation (Review Inbox is durable) ============
  const xRejectRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Permission Slip' });
  await xRejectRow.getByText('Review', { exact: true }).click();
  ok('CandidateReviewModal reopens for "Permission Slip"', await page.locator('form').getByPlaceholder('Title').inputValue().then((v) => v === 'Permission Slip'));
  await page.locator('button[aria-label="Close"]').click();
  await page.waitForTimeout(150);

  ok('Clicking "×" no longer opens a "Discard this suggestion?" confirmation', !(await visible('Discard this suggestion?')));
  ok('Clicking "×" closes the modal immediately (no lingering form)', !(await page.locator('form').isVisible().catch(() => false)));
  stored = await readCandidates();
  ok('Clicking "×" does NOT change reviewStatus (still "pending")', stored.find((c) => c.id === 'cand-x-reject')?.reviewStatus === 'pending');
  ok('The candidate remains visible in the Review Inbox after "×"', await visible('Permission Slip'));
  ok('The action-card badge/count is unchanged after "×" (still 6 — same persisted behavior as "Review later")', (await reviewInboxCard().textContent() || '').includes('6'));

  // ============ 13. Missing SourceRecord remains reviewable ============
  const missingRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Book Report' });
  await missingRow.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  ok('A candidate whose sourceRecordId points at a deleted/missing SourceRecord is still reviewable (no crash, form renders)', await form.getByPlaceholder('Title').inputValue().then((v) => v === 'Book Report'));
  await page.getByRole('button', { name: /Review later/ }).click();
  await page.waitForTimeout(150);

  // ============ 15/16 continued: legacy (no target) requires manual selection; family-target never mis-assigns a child ============
  const legacyRow = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Field Trip Form' });
  await legacyRow.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  let legacyAvaClass = (await form.getByRole('button', { name: /Ava/ }).first().getAttribute('class')) || '';
  ok('A legacy candidate with no targetChildId does NOT preselect Ava (manual selection required)', !legacyAvaClass.includes('bg-indigo-600'));

  // ---- Legacy-family compatibility fix: a null-targetType candidate reviewed from the Review Inbox now also offers "Whole family" ----
  const legacyWholeFamilyCheckbox = form.locator('label', { hasText: 'Whole family' }).locator('input[type="checkbox"]');
  ok('A legacy (null-targetType) candidate reopened from the Review Inbox now offers "Whole family" as a choice', await legacyWholeFamilyCheckbox.isVisible());
  ok('"Whole family" is NOT preselected for it — the parent must choose', !(await legacyWholeFamilyCheckbox.isChecked()));
  ok('Every current learner is still selectable alongside "Whole family" (Ava is still offered)', await form.getByRole('button', { name: /Ava/ }).first().isVisible());
  ok('No learner is auto-selected — Approve & Add stays disabled until the parent picks a learner or Whole family', await form.getByRole('button', { name: 'Approve & Add' }).isDisabled());

  await page.getByRole('button', { name: /Review later/ }).click();
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
  await page.getByRole('button', { name: /Review later/ }).click();
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

  // ============ 7. Reject (via ItemForm's own "Reject" button, relabeled from "Cancel") removes it from the inbox ============
  const reopenLegacy = page.locator('[data-testid="review-inbox-row"]').filter({ hasText: 'Field Trip Form' });
  await reopenLegacy.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  ok('ItemForm\'s Cancel button is relabeled "Reject" inside the Review Inbox flow (it performs a real, persisted reject here, unlike a plain cancel)', await form.getByRole('button', { name: 'Reject' }).isVisible());
  await form.getByRole('button', { name: 'Reject' }).click();
  await page.waitForTimeout(300);

  ok('Rejecting (via ItemForm\'s "Reject" button) removes the candidate from the pending inbox', !(await visible('Field Trip Form')));
  stored = await readCandidates();
  ok('The underlying candidate is now rejected', stored.find((c) => c.id === 'cand-legacy')?.reviewStatus === 'rejected');

  // ============ Slice 2: legacy "approved" candidate reopens into a restricted recovery UI ============
  await approvedRow.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  ok('Recovery mode\'s header reads "Needs attention" instead of the normal review title', await visible('Needs attention'));
  ok('Recovery mode never offers "Reject" (would silently orphan a possibly-already-created Item)', !(await form.getByRole('button', { name: 'Reject' }).isVisible().catch(() => false)));
  ok('Recovery mode never offers "Review later" (leaving it at "approved" is not a safe no-op)', !(await page.getByRole('button', { name: /Review later/ }).isVisible().catch(() => false)));
  ok('Recovery mode\'s submit button reads "Finish Adding", not "Approve & Add"', await form.getByRole('button', { name: 'Finish Adding' }).isVisible());

  // "×" in recovery mode closes immediately — no "Discard this suggestion?" confirmation, nothing written.
  await page.locator('button[aria-label="Close"]').click();
  await page.waitForTimeout(150);
  ok('"×" in recovery mode does NOT open the "Discard this suggestion?" confirmation', !(await visible('Discard this suggestion?')));
  ok('"×" in recovery mode simply closes the modal', !(await page.locator('form').isVisible().catch(() => false)));
  stored = await readCandidates();
  ok('Closing recovery mode with "×" leaves the candidate untouched (still "approved")', stored.find((c) => c.id === 'cand-approved')?.reviewStatus === 'approved');
  ok('The candidate is still shown (still needs attention) after closing recovery mode', await visible('Already approved'));

  // Reopen, pick a child (this legacy candidate has no targetType, so
  // nothing is preselected — same as any other untargeted candidate), and
  // "Finish Adding" — commits atomically via commitCandidateToItem.
  await approvedRow.getByText('Review', { exact: true }).click();
  form = page.locator('form');
  await form.getByRole('button', { name: /Ava/ }).first().click();
  await form.getByRole('button', { name: 'Finish Adding' }).click();
  await page.waitForTimeout(400);

  ok('Finishing a recovery candidate removes it from the inbox', !(await visible('Already approved')));
  stored = await readCandidates();
  ok('The recovered candidate is now committed', stored.find((c) => c.id === 'cand-approved')?.reviewStatus === 'committed');
  const recoveredItems = await page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_items') || '[]'));
  ok('Exactly one Item was created for the recovered candidate, at a deterministic id matching the candidate', recoveredItems.filter((it) => it.id === 'cand-approved').length === 1);
  ok('The created Item carries sourceCandidateId back to the candidate (Slice 2 provenance)', recoveredItems.find((it) => it.id === 'cand-approved')?.sourceCandidateId === 'cand-approved');

  // ============ Remaining candidates still correct after all resolutions ============
  ok('Untouched pending candidates remain visible after others resolve', await visible('Back to School Night') && await visible('Book Report'));

  // ============ 14. Load error differs from empty (simulated via a corrupted localStorage value) ============
  await page.evaluate((k) => localStorage.setItem(k, 'not valid json{{{'), CANDIDATES_KEY);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');
  await reviewInboxCard().click();
  await page.waitForSelector('text=No items waiting for review.');
  // Guest mode's own JSON.parse failure is caught internally and reads as
  // an empty list (documented, existing "fails closed silently" guest
  // behavior — see ingestionCandidatesRepository.js's readGuestCandidates).
  // This is NOT the same code path as the real Firestore onError path
  // (proven separately and precisely in
  // tests/review-inbox-error-path.unit.mjs, which is the only branch that
  // can genuinely produce a distinguishable network/permission failure).
  ok('A malformed guest localStorage value fails closed to an empty (not crashed) inbox', await visible('No items waiting for review.'));

  // ============ 12/16. Review Inbox action only on Parent Home — Family Board / Shared Display never expose it ============
  await page.evaluate((k) => localStorage.removeItem(k), CANDIDATES_KEY);
  await writeCandidates([candidate({ id: 'cand-visibility', title: 'Visibility Probe', createdAt: '2020-01-01T00:00:00.000Z' })]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');

  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board never shows the "Review Inbox" action card', !(await reviewInboxCard().isVisible().catch(() => false)));
  ok('Family Board never shows a pending candidate title', !(await page.getByText('Visibility Probe').isVisible().catch(() => false)));
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 }).catch(() => {});

  // ============ 16. Child Experience never exposes it ============
  await addLearner('Payton');
  await page.getByText('Payton', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Child Home never shows the "Review Inbox" action card', !(await reviewInboxCard().isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Child\'s unlocked Parents Page view never shows the "Review Inbox" action card either', !(await reviewInboxCard().isVisible().catch(() => false)));

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
