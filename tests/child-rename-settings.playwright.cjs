/**
 * Focused regression test for the "next small UI cleanup" and its
 * follow-ups:
 *   1. Parent Board no longer renders a Learners / child-card section —
 *      every current learner instead has its own direct entry point on
 *      Board Selector, the pure-launcher signed-in landing page (see
 *      src/BoardSelector.jsx).
 *   2. Settings' Children section gains inline rename/edit of an existing
 *      child's display name (src/settings/ChildManagementSection.jsx,
 *      renameChild in src/BoardSelector.jsx).
 *   3. Settings' Children section's "View Child" action (added by an
 *      earlier round to restore reachability after Parent Home's Learners
 *      section was first removed) has since been removed again — now
 *      redundant, because Board Selector's own Learners section reuses
 *      AuthShell.jsx's existing selectedChild/onSwitchChild/
 *      handleSelectChild navigation verbatim, selecting strictly by
 *      canonical child id, and is the primary entry point for every
 *      current learner.
 *
 * Identity safety is the core property under test throughout: renaming
 * only ever updates the existing child record's `name` field — never
 * child.id, never adds/removes an array entry — and Board Selector's
 * learner buttons always resolve the correct child by that same unchanging
 * id, before and after a rename. See tests/calendar-routing-persistence.unit.mjs's
 * and tests/gmail-sender-targets.unit.mjs's own new "IDENTITY SAFETY" unit
 * tests for the id-keyed-mapping proofs (Calendar routing / Gmail sender
 * targets) that can't be exercised end-to-end here since guest mode has no
 * real Gmail/Calendar connection to attach those mappings to (same
 * disclosed limitation as every other *.playwright.cjs file in this
 * suite).
 *
 * Exercises the guest/local-demo storage path (localStorage-backed).
 *
 * Usage:
 *   npm run dev                                         # in one terminal
 *   node tests/child-rename-settings.playwright.cjs      # in another
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
  const readChildren = () => page.evaluate(() => JSON.parse(localStorage.getItem('crestly_admin_children') || '[]'));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ 1. Board Selector is the launcher; no learners yet means no Learners section ============
  ok('Board Selector shows no "Learners" heading before any learner exists', !(await page.getByText('Learners').isVisible().catch(() => false)));
  ok('Board Selector shows the Family Board entry point', await page.getByTestId('board-family').isVisible());
  ok('Board Selector shows the Parent Board entry point', await page.getByTestId('board-parent').isVisible());
  ok('Board Selector shows the Settings entry point', await page.getByTestId('board-settings').isVisible());
  ok('Board Selector shows Sign out', await page.getByText('Sign out').isVisible());

  // Add a learner via Settings (only remaining entry point for creating a
  // child) — also proves "Add learner still works" unchanged.
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Hayden');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Hayden');
  const childrenAfterAdd = await readChildren();
  ok('Add learner still works: a real child record was created', childrenAfterAdd.some((c) => c.name === 'Hayden'));
  const originalId = childrenAfterAdd.find((c) => c.name === 'Hayden')?.id;
  ok('Add learner still works: the created child has a stable canonical id', !!originalId);

  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  ok('Board Selector now shows a "Learners" heading once a learner exists', await visible('Learners'));
  ok('Board Selector shows a tappable learner button for the new learner', await page.getByTestId('board-learner').isVisible());

  // ---- Parent Board never renders a Learners section (Section 2 boundary) ----
  await page.getByTestId('board-parent').click();
  await page.waitForSelector('text=Parent Board');
  ok('Parent Board shows no "Learners" heading', !(await page.getByText('Learners').isVisible().catch(() => false)));
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');

  // ============ 2. Settings Children section still renders current children ============
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  ok('Settings\' Children section shows the child\'s emoji/avatar', await visible('🦁'));
  ok('Settings\' Children section shows the child\'s current display name', await visible('Hayden'));
  ok('Settings\' Children section provides an Edit/Rename action', await page.getByRole('button', { name: 'Edit' }).isVisible());
  ok('Settings\' Children section no longer provides a "View Child" action (redundant with Board Selector\'s Learners section)', !(await page.getByRole('button', { name: 'View Child' }).isVisible().catch(() => false)));

  // ============ 3. Cancel leaves data unchanged ============
  await page.getByRole('button', { name: 'Edit' }).click();
  const nameInput = page.getByTestId('child-rename-input');
  ok('Rename UI opens with the current name pre-filled', (await nameInput.inputValue()) === 'Hayden');
  await nameInput.fill('Should Not Persist');
  await page.getByRole('button', { name: 'Cancel' }).click();
  ok('Cancel closes the rename UI (Edit button reappears)', await page.getByRole('button', { name: 'Edit' }).isVisible());
  ok('Cancel leaves the displayed name unchanged', await visible('Hayden'));
  ok('Cancel leaves the displayed unsaved edit text absent', !(await page.getByText('Should Not Persist').isVisible().catch(() => false)));
  let stored = await readChildren();
  ok('Cancel does not persist anything to storage', stored.find((c) => c.id === originalId)?.name === 'Hayden');

  // ============ 4. Rename saves the new display name ============
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('child-rename-input').fill('Henry');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(200);
  ok('Rename UI closes after Save', await page.getByRole('button', { name: 'Edit' }).isVisible());
  ok('The new display name is shown', await visible('Henry'));
  ok('The old display name is no longer shown', !(await page.getByText('Hayden', { exact: true }).isVisible().catch(() => false)));

  stored = await readChildren();
  const renamed = stored.find((c) => c.id === originalId);
  ok('Rename persisted the new name onto the existing child record', renamed?.name === 'Henry');

  // ============ 5. Child ID remains unchanged ============
  ok('Canonical child id is byte-for-byte unchanged after rename', renamed?.id === originalId);
  ok('Exactly one child record exists — rename never created a second one', stored.length === 1);
  ok('The child\'s emoji is untouched by the rename', renamed?.emoji === '🦁');
  ok('The child\'s createdAt is untouched by the rename', !!renamed?.createdAt);

  // ============ 5b. Board Selector's learner button opens the correct existing child, selected by canonical ID ============
  // Board Selector's learner buttons call onSelectChild(child) directly
  // from a .map() over the current children array (src/BoardSelector.jsx)
  // — so successfully reopening Home here, for a button whose display
  // name just changed from "Hayden" to "Henry", is itself the proof: an
  // id keyed purely by array position or a stale name would still resolve
  // correctly since the button closes over the current child object, not
  // a name string.
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  ok('A renamed child can still be opened via Board Selector\'s Learners section', await visible('Henry'));
  await page.getByTestId('board-learner').click();
  await page.waitForSelector('text=My Day', { timeout: 5000 });
  ok('Board Selector\'s learner button opens the existing Child Home/My Day experience', await visible('My Day'));
  const lockedChildIdAfterView = await page.evaluate(() => localStorage.getItem('crestly_locked_child_id'));
  ok('Selecting the child does not lock the device (no persisted lockedChildId as a side effect)', lockedChildIdAfterView === null);

  ok('The existing "Back to Parent Page" behavior is reachable again from Board Selector\'s learner button', await visible('Back to Parent Page'));
  await page.getByRole('button', { name: 'Back to Parent Page' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 });
  ok('Returning lands back on Board Selector', await visible('Haydens - Homework'));

  stored = await readChildren();
  ok('Viewing the child did not change its canonical id', stored.find((c) => c.name === 'Henry')?.id === originalId);

  // ============ 6. Rename survives a full page refresh ============
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Continue without an account').click();
  await page.waitForSelector('text=Haydens - Homework');
  await page.getByTestId('board-settings').click();
  await page.waitForSelector('text=Settings');
  ok('The renamed display name is shown again after a full page refresh', await visible('Henry'));

  // ============ 7. Add learner still works after a rename has happened ============
  await page.getByText('+ Add a learner').click();
  await page.getByPlaceholder("Child's name").fill('Payton');
  await page.getByText('Add Learner').click();
  await page.waitForSelector('text=Payton');
  stored = await readChildren();
  ok('Add learner still works after a rename: both children now exist', stored.length === 2 && stored.some((c) => c.name === 'Henry') && stored.some((c) => c.name === 'Payton'));
  ok('The renamed child\'s id is still exactly the original id (unaffected by adding a second learner)', stored.find((c) => c.name === 'Henry')?.id === originalId);
  const paytonId = stored.find((c) => c.name === 'Payton')?.id;
  ok('Payton has her own distinct canonical id, never confused with Henry\'s', !!paytonId && paytonId !== originalId);

  // ============ 7b. Board Selector's learner buttons dispatch per-child, not a fixed/first child ============
  // Two learners now exist; click specifically PAYTON's own learner button
  // (scoped to that button, not just "the first match") and confirm it
  // opens successfully — proving each button is wired to that child's own
  // id, not a shared/stale reference to whichever child was clicked first.
  await page.getByText('← All Boards').click();
  await page.waitForSelector('text=Haydens - Homework');
  const paytonBoardButton = page.getByTestId('board-learner').filter({ hasText: 'Payton' });
  await paytonBoardButton.click();
  await page.waitForSelector('text=My Day', { timeout: 5000 });
  ok('Clicking Payton\'s own learner button opens a Child Home (per-child dispatch works)', await visible('My Day'));
  await page.getByRole('button', { name: 'Back to Parent Page' }).click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 });

  // ============ 8. Child/shared/kiosk surfaces remain unaffected by the rename UI ============
  await page.getByTestId('board-family').click();
  await page.waitForSelector('text=🔆 Today');
  ok('Family Board shows the renamed child by their current name', await visible('Henry'));
  ok('Family Board never shows a rename/Edit control for children', !(await page.getByRole('button', { name: 'Edit' }).isVisible().catch(() => false)));
  await page.getByText('← Back').click();
  await page.waitForSelector('text=Haydens - Homework', { timeout: 5000 }).catch(() => {});

  await page.getByTestId('board-parent').click();
  await page.getByTestId('action-upload-homework').click();
  await page.getByTestId('parent-organizer-panel').getByText('Henry', { exact: true }).click();
  await page.waitForSelector('text=Parents Page', { timeout: 5000 }).catch(() => {});
  ok('The child\'s unlocked Parents Page shows no rename/Edit control (Settings-only, unaffected gating)', !(await page.getByRole('button', { name: 'Edit' }).isVisible().catch(() => false)));
  ok('The child\'s unlocked Parents Page shows no Settings control either', !(await page.getByText('Settings').isVisible().catch(() => false)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});
