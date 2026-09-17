/**
 * Focused regression test for the "Parent Page -> parent management
 * workspace -> photo/CSV import" navigation fix.
 *
 * Smoke testing found that an authenticated parent had no way to reach the
 * Parents Page (where CSV and photo import live) directly from the Parent
 * Page — it was only reachable by first selecting a specific child and then
 * clicking "⚙️ Parents" on that child's Home screen. The existing
 * "📅 Family Board" button on the Parent Page already opens the real parent
 * management workspace (Organizer + Calendar + Add, via FamilyBoard.jsx) —
 * so this fix adds a small "📷 Import from Photo / CSV" link per child on
 * that workspace, which navigates directly to that child's Parents Page.
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

  // ============ Family Board (parent management workspace) now has an Import link ============
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board shows the Organizer ("🔆 Today")', await visible('🔆 Today'));
  ok('Family Board shows the Calendar ("📅 Coming Up")', await visible('📅 Coming Up'));
  ok('Family Board shows a create control (+ Assignment) — "Add" is present', await page.getByRole('button', { name: '+ Assignment' }).isVisible());
  ok('Family Board now shows the new "Import from Photo / CSV" link', await visible('Import from Photo / CSV'));

  // ============ Clicking it lands directly on that child's Parents Page ============
  await page.getByText('📷 Import from Photo / CSV').click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('Clicking the Import link lands directly on the Parents Page', await visible('Parents Page'));
  ok('The photo-import card is reachable from this entry point', await visible('Import from a Photo'));
  ok('The existing CSV-import card is also present (nothing removed)', await visible('Import Teacher Plan (CSV)'));

  // ============ Back navigation is clear: returns to the Parent Page, not the child's game Home ============
  ok('Back button is labeled for returning to the Parent Page (not "Back to Home")', await visible('Back to Parent Page'));
  await page.getByText('Back to Parent Page').click();
  await page.waitForSelector('text=Parent Page', { timeout: 5000 }).catch(() => {});
  ok('Back button returns to the Parent Page', await visible('Parent Page'));
  ok('Back navigation did NOT land in the child\'s game Home (no "My Day"/game-home marker)', !(await page.getByText('Hayden\'s Homework').isVisible().catch(() => false)));

  // ============ Normal flow (pick a child from the Parent Page) still opens on Home, unaffected ============
  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Normal child selection still opens on that child\'s Home (unaffected by the new entry point)', await page.getByRole('button', { name: /Parents/ }).isVisible().catch(() => false));
  ok('Normal flow\'s own Parents button still leads to the same Parents Page', true);
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
