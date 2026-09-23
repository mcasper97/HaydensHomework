/**
 * End-to-end regression test for Slice A (Google Calendar Phase 1
 * groundwork) — the canonical household timezone field (users/{uid}.timezone,
 * src/data/householdTimezone.js). Its UI now lives in the permanent Settings
 * page's Household section (src/settings/HouseholdSettingsSection.jsx),
 * relocated out of AuthShell.jsx's former Parent Tools panel by a later
 * UI/IA refactor — no change to the underlying save/validate logic.
 *
 * This slice establishes the field only — no Google Calendar API call, no
 * Item schema change, no todayStr()/recurring/Organizer date-logic change.
 * Exercises the guest/local-demo storage path (localStorage-backed), same
 * as every other *.playwright.cjs file in this suite — no live Firebase
 * project needed.
 *
 * Usage:
 *   npm run dev                                        # in one terminal
 *   node tests/household-timezone.playwright.cjs        # in another
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
  const lsGet = (k) => page.evaluate((key) => localStorage.getItem(key), k);
  const tzInputLocator = () => page.locator('input[placeholder="e.g. America/New_York"]');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');

  await page.getByTestId('action-settings').click();
  await page.waitForSelector('text=Settings');

  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Ava');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Ava');

  // ============ Set a family name first, as a baseline to prove it's unaffected later ============
  await page.getByText('+ Set your family name').click();
  await page.getByPlaceholder('e.g. Casper').fill('Casper');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(150);
  ok('Baseline: family name saved before touching timezone at all', (await lsGet('crestly_admin_family_name')) === 'Casper');

  // ============ Timezone lives in Settings' Household section ============
  ok('The timezone input is visible on the Settings page', await tzInputLocator().isVisible());

  // ============ Unset state: suggestion shown, NOT persisted automatically ============
  ok('No timezone is stored yet before any explicit save', (await lsGet('crestly_admin_timezone')) === null);
  ok('A "Suggested:" hint is shown for the unset state', await visible('Suggested:'));
  const tzInput = tzInputLocator();
  const suggestedValue = await tzInput.inputValue();
  ok('The input is pre-filled with a suggested (non-empty) value', !!suggestedValue && suggestedValue.length > 0);
  ok('Merely opening the panel with a suggestion visible still does NOT persist it', (await lsGet('crestly_admin_timezone')) === null);
  ok('The Save action for an unset timezone is labeled "Use this timezone"', await page.getByRole('button', { name: 'Use this timezone' }).isVisible());

  // ============ Invalid value is rejected, never persisted ============
  await tzInput.fill('Not/A/Real/Zone');
  await page.getByRole('button', { name: 'Use this timezone' }).click();
  await page.waitForTimeout(150);
  ok('An invalid timezone shows an inline error', await visible("doesn't look like a valid timezone"));
  ok('An invalid timezone is never persisted', (await lsGet('crestly_admin_timezone')) === null);

  // ============ Explicit save persists a valid timezone ============
  await tzInput.fill('America/Los_Angeles');
  await page.getByRole('button', { name: 'Use this timezone' }).click();
  await page.waitForTimeout(200);
  ok('A valid timezone is persisted after explicit save', (await lsGet('crestly_admin_timezone')) === 'America/Los_Angeles');
  ok('The panel now shows the saved value in its collapsed (non-editing) state', await visible('America/Los_Angeles'));
  ok('A "Change" action is now offered instead of the edit form', await page.getByRole('button', { name: 'Change' }).isVisible());

  // ============ Existing profile fields are preserved; changing timezone updates only timezone ============
  ok('Saving the timezone did not touch the existing family name', (await lsGet('crestly_admin_family_name')) === 'Casper');
  const childrenAfterTzSave = await lsGet('crestly_admin_children');
  ok('Saving the timezone did not touch the existing children list', JSON.parse(childrenAfterTzSave || '[]').some((c) => c.name === 'Ava'));

  // ---- Change to a different value ----
  await page.getByRole('button', { name: 'Change' }).click();
  const tzInput2 = tzInputLocator();
  ok('"Change" pre-fills the input with the CURRENT saved value, not a fresh suggestion', (await tzInput2.inputValue()) === 'America/Los_Angeles');
  await tzInput2.fill('Europe/London');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(200);
  ok('Changing the timezone updates the stored value', (await lsGet('crestly_admin_timezone')) === 'Europe/London');
  ok('Changing the timezone still leaves the family name untouched', (await lsGet('crestly_admin_family_name')) === 'Casper');
  ok('Changing the timezone still leaves the children list untouched', JSON.parse((await lsGet('crestly_admin_children')) || '[]').some((c) => c.name === 'Ava'));

  // ============ Existing familyLastName behavior is unchanged after these edits ============
  await page.getByText(/Casper \(edit\)/).click();
  const nameInput = page.getByPlaceholder('e.g. Casper');
  await nameInput.fill('NewName');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(150);
  ok('Family name editing still works after the timezone feature was added', (await lsGet('crestly_admin_family_name')) === 'NewName');
  ok('Editing the family name does not touch the stored timezone', (await lsGet('crestly_admin_timezone')) === 'Europe/London');

  // ============ Timezone survives a full page refresh (reads back correctly) ============
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Parent Home');
  await page.getByTestId('action-settings').click();
  await page.waitForSelector('text=Settings');
  ok('The saved timezone is displayed again after a full page refresh', await visible('Europe/London'));
  await page.getByText('← Parent Home').click();
  await page.waitForSelector('text=Parent Home');

  // ============ Guest/child/shared surfaces never expose the timezone control ============
  await page.getByText(/Family Board/).first().click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board never shows the timezone input', !(await tzInputLocator().isVisible().catch(() => false)));
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Parent Home', { timeout: 5000 }).catch(() => {});

  await page.getByText('Ava', { exact: true }).click();
  await page.waitForSelector('text=Parents', { timeout: 5000 }).catch(() => {});
  ok('Child Home never shows the timezone control', !(await tzInputLocator().isVisible().catch(() => false)));
  await page.getByRole('button', { name: /Parents/ }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok("Child's unlocked Parents Page view never shows the timezone control either", !(await tzInputLocator().isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
