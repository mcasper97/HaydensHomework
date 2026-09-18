/**
 * Focused regression test for the "Parent Page -> parent management
 * workspace -> photo/CSV import" navigation fix.
 *
 * Product rule (corrected after an initial revision placed the entry point
 * on Family Board and was rejected): Family Board / Shared Display and
 * Child pages are execution-only surfaces (view + mark eligible items
 * complete) and must never expose admin functionality — import/upload,
 * edit, delete, source management, AI review, recurrence, or household
 * config. The entry point into Import must live on the authenticated
 * Parent Page itself, behind its own clearly-labeled "Parent Tools"
 * control — never inside Family Board, never on a child page.
 *
 * Exercises the guest/local-demo path (no live Firebase project needed).
 *
 * Usage:
 *   npm run dev                                                  # in one terminal
 *   node tests/parent-page-import-navigation.playwright.cjs       # in another
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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await guestEnter();
  await page.waitForSelector('text=Parent Page');

  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');

  // ============ Parent Page controls unchanged ============
  ok('Parent Page still shows the Device Mode selector', await visible('Device Mode'));
  ok('Parent Page still shows the "👤 Parent device" option', await visible('Parent device'));
  ok('Parent Page still shows the learner card (Ava)', await visible('Ava'));
  ok('Parent Page still shows the existing "Family Board" entry point', await page.getByText(/Family Board/).first().isVisible());

  // ============ Criterion 1: obvious new entry point on the Parent Page itself ============
  ok('Parent Page shows the new "Parent Tools" button', await visible('Parent Tools'));
  ok('Import is NOT visible on the Parent Page before opening the panel', !(await visible('Import from Photo / CSV')));

  await page.getByText('Parent Tools').click();
  ok('Clicking it reveals the Import panel, still on the Parent Page', await visible('Import from Photo / CSV'));
  const panel = page.locator('[data-testid="parent-organizer-panel"]');
  ok('Panel lists the learner to import for', await panel.locator('button', { hasText: 'Ava' }).isVisible());

  // ============ Criterion 2: Family Board is free of admin/import controls ============
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board shows the Organizer ("🔆 Today")', await visible('🔆 Today'));
  ok('Family Board shows the Calendar ("📅 Coming Up")', await visible('📅 Coming Up'));
  ok('Family Board shows a create control (+ Assignment) — "Add" is present', await page.getByRole('button', { name: '+ Assignment' }).isVisible());
  ok('Family Board does NOT show any Import control', !(await page.getByText('Import from Photo / CSV').isVisible().catch(() => false)));
  ok('Family Board does NOT show any Import control (alt text match)', !(await page.getByText('Import Teacher Plan').isVisible().catch(() => false)));

  // ============ Criterion 5: import reachable only via the Parent Tools panel ============
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Page', { timeout: 5000 }).catch(() => {});
  ok('Family Board\'s own Back control returns to the Parent Page', await visible('Parent Page'));

  await page.getByText('Parent Tools').click();
  await page.waitForSelector('text=Import from Photo / CSV');
  await page.locator('[data-testid="parent-organizer-panel"] button', { hasText: 'Ava' }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Clicking a learner in the panel lands directly on that child\'s Parents Page', await visible('Parents Page'));
  ok('The photo-import card is reachable from this entry point', await visible('Import from a Photo'));
  ok('The existing CSV-import card is also present (nothing removed)', await visible('Import Teacher Plan (CSV)'));

  // ============ Criterion 4 / back navigation: returns to the Parent Page, not the child's game Home ============
  ok('Back button is labeled for returning to the Parent Page (not "Back to Home")', await visible('Back to Parent Page'));
  await page.getByText('Back to Parent Page').click();
  await page.waitForSelector('text=Parent Page', { timeout: 5000 }).catch(() => {});
  ok('Back button returns to the Parent Page', await visible('Parent Page'));
  ok('Back navigation did NOT land in the child\'s game Home (no game-home marker)', !(await page.getByText("Hayden's Homework").isVisible().catch(() => false)));

  // ============ Criterion 3: normal child-card flow (Child page) still has no import/admin controls ============
  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Normal child selection still opens on that child\'s Home (unaffected by the new entry point)', await page.getByRole('button', { name: /Parents/ }).isVisible().catch(() => false));
  ok('Child\'s Home screen itself shows no Import control directly (only via the gated ⚙️ Parents click)', !(await page.getByText('Import from a Photo').isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Normal Home -> Parents flow still shows "Back to Home" (unchanged existing behavior)', await visible('Back to Home'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
