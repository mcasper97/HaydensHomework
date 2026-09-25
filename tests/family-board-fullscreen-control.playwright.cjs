/**
 * Focused coverage for the Family Board's Full Screen control (Section 15
 * of the K-5 redesign) — a small kitchen-display affordance that toggles
 * the browser's native Fullscreen API. Never touches board data/state.
 *
 * Branches on `document.fullscreenEnabled` because headless/sandboxed
 * Chromium environments do not consistently support real fullscreen
 * (Section 15's own "handles unsupported browsers gracefully" requirement)
 * — this file proves BOTH branches are handled correctly, whichever one
 * this environment's Chromium actually reports.
 *
 * Usage:
 *   npm run dev                                            # in one terminal
 *   node tests/family-board-fullscreen-control.playwright.cjs # in another
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Riley');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Riley');
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  await page.getByTestId('board-family').click();
  await page.waitForSelector('[data-testid="family-week-board"]', { timeout: 10000 });

  const apiEnabled = await page.evaluate(() => !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false);
  console.log(`(this environment's Chromium reports document.fullscreenEnabled = ${apiEnabled})`);

  if (!apiEnabled) {
    // ============ Section 15: unsupported handled gracefully — no control at all, not a broken/disabled one ============
    ok('When the Fullscreen API is unsupported, the control renders nothing (graceful, not a dead/disabled button)', (await page.getByTestId('fullscreen-toggle').count()) === 0);
    // Board data/state must still be completely unaffected regardless.
    ok('The board still renders normally when Fullscreen is unsupported', await page.getByTestId('family-week-board').isVisible());
  } else {
    // ============ Section 15: control renders, invokes the API, exit works ============
    // ONE-LINE-HEADER PASS: the button is icon-only now (no visible text
    // label, to save width on the single-line header) — its accessible
    // name (aria-label) still carries the "Full Screen"/"Exit Full Screen"
    // text, so that's what these assertions check instead of textContent.
    const btn = page.getByTestId('fullscreen-toggle');
    ok('The Full Screen control renders when the API is supported', await btn.isVisible());
    ok('It has the "Full Screen" accessible label before activation', (await btn.getAttribute('aria-label')) === 'Full Screen');

    await btn.click();
    await page.waitForTimeout(300);
    const isFs1 = await page.evaluate(() => !!document.fullscreenElement);
    ok('Clicking invokes the Fullscreen API (document.fullscreenElement becomes set)', isFs1);
    if (isFs1) {
      ok('The accessible label switches to "Exit Full Screen" while active', (await page.getByTestId('fullscreen-toggle').getAttribute('aria-label')) === 'Exit Full Screen');
    }

    await page.getByTestId('fullscreen-toggle').click();
    await page.waitForTimeout(300);
    const isFs2 = await page.evaluate(() => !!document.fullscreenElement);
    ok('Clicking again exits fullscreen (document.fullscreenElement clears)', !isFs2);
    ok('The accessible label switches back to "Full Screen" after exiting', (await page.getByTestId('fullscreen-toggle').getAttribute('aria-label')) === 'Full Screen');

    // Board data/state must be completely unaffected by toggling fullscreen.
    ok('The board still renders normally after a fullscreen round-trip', await page.getByTestId('family-week-board').isVisible());
    ok('The board is still exactly 5 day columns after a fullscreen round-trip', await page.locator('[data-testid="week-day-column"]').count() === 5);
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
