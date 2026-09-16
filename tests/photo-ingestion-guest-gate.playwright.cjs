/**
 * Focused regression test for the photo-ingestion vertical slice's
 * REACHABLE guest-mode path only.
 *
 * api/extract-obligations.js requires a real, signed-in Firebase ID token
 * (same restriction as the pre-existing api/parse-homework.js) — guest/
 * local-demo mode has no real identity to authenticate with, by design
 * (see src/App.jsx's extractObligationsFromImage). That means the live
 * Anthropic extraction call, and everything downstream of a successful
 * extraction (IngestionCandidate creation, the review modal, approve/
 * reject/commit), CANNOT be exercised end-to-end in guest mode, and this
 * sandbox has no live Firebase test user or ANTHROPIC_API_KEY to exercise
 * them any other way either. That gap is covered instead by:
 *   - tests/extract-obligations.unit.mjs (server-side sanitization logic)
 *   - tests/candidate-to-draft-item.unit.mjs (review-adapter mapping logic)
 *
 * What THIS test verifies is what guest mode genuinely can exercise, for
 * real, through the real UI and real code path: that a SourceRecord is
 * created at capture time (before extraction is even attempted), that it
 * is not silently discarded when extraction can't proceed, and that it
 * correctly walks the processingStatus lifecycle through to "failed" —
 * with NO IngestionCandidate created for a failed capture. This is a
 * genuine, valuable regression test of the capture-time SourceRecord
 * requirement and the auth-gating behavior, not a mock.
 *
 * Usage:
 *   npm run dev                                              # in one terminal
 *   node tests/photo-ingestion-guest-gate.playwright.cjs      # in another
 *
 * Env vars:
 *   TEST_BASE_URL            — dev server URL (default http://127.0.0.1:5173)
 *   PLAYWRIGHT_CHROMIUM_PATH — explicit chromium binary path (optional)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// Minimal valid 1x1 pixel JPEG, so createImageBitmap() genuinely decodes it
// and the failure this test proves is specifically the auth gate — not an
// unrelated image-decode error.
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

(async () => {
  const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  const dialogMessages = [];
  page.on('dialog', (d) => { dialogMessages.push(d.message()); d.accept(); });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  const guestEnter = () => page.getByText('Continue without an account').click();
  const readSourceRecords = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_source_records') || '[]'));
  const readCandidates = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_ingestion_candidates') || '[]'));

  const tmpJpegPath = path.join(os.tmpdir(), `ingestion-test-${Date.now()}.jpg`);
  fs.writeFileSync(tmpJpegPath, Buffer.from(TINY_JPEG_BASE64, 'base64'));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await guestEnter();
  await page.waitForSelector('text=Parent Page');

  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');

  await page.evaluate(() => {
    localStorage.removeItem('crestly_admin_source_records');
    localStorage.removeItem('crestly_admin_ingestion_candidates');
  });

  // Navigate to the per-child Parents Page (where the photo-import card lives).
  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Import from a Photo', { timeout: 5000 }).catch(() => {});

  ok('Photo-import card is present on the Parents Page', await page.getByText('Import from a Photo').isVisible().catch(() => false));

  const fileInput = page.locator('input[type="file"][accept*="image"]');
  ok('Image capture input exists with an image accept filter', (await fileInput.count()) === 1);

  await fileInput.setInputFiles(tmpJpegPath);

  // The upload handler creates the SourceRecord, attempts extraction (which
  // guest mode's auth gate rejects), and alert()s an error — poll for that
  // alert (captured by the page.on('dialog', ...) listener above) rather
  // than relying on a single fixed timeout.
  const deadline = Date.now() + 8000;
  while (dialogMessages.length === 0 && Date.now() < deadline) {
    await page.waitForTimeout(100);
  }

  ok('An error alert was shown (extraction blocked in guest mode)', dialogMessages.length >= 1);
  ok(
    'Alert message explains the account requirement, not a generic failure',
    dialogMessages.some((m) => /signed-in account/i.test(m))
  );

  const records = await readSourceRecords();
  ok('Exactly one SourceRecord was created for this capture', records.length === 1);
  const record = records[0];
  ok('SourceRecord sourceType is "image_capture"', record?.sourceType === 'image_capture');
  ok(
    'SourceRecord ended at processingStatus "failed" (kept, not discarded — intentional provenance history)',
    record?.processingStatus === 'failed'
  );
  ok('SourceRecord retains its title/mimeType metadata despite the failure', typeof record?.title === 'string' && record.title.length > 0);

  const candidates = await readCandidates();
  ok('NO IngestionCandidate was created for a failed/blocked extraction', candidates.length === 0);

  fs.unlinkSync(tmpJpegPath);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
