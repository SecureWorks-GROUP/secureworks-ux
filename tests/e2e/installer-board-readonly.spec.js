const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Guard for the second half of the captain ruling (2026-07-22): making the manager
// board-wide must NOT change what a non-manager trade sees or can do. A make-safe
// manager's board-wide visibility and the Allocate action both come from the server
// feed's `sees_all_makesafes` / `can_allocate` permissions — the installer persona
// carries them false, so the board renders read-only with no Allocate action.
//
// One persona per file (matches board.spec.js = allocator, my-jobs.spec.js =
// installer): the app caches the make-safe feed, so mixing an allocator sign-in and
// an installer sign-in in one spec file crosses that cache. Keep this installer-only.

test.use({ persona: 'installer' });

test('non-manager make-safe board is read-only — no Allocate action', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.installer);
  await page.locator('#navBoard').click();
  await expect(page.locator('#viewBoard')).toHaveClass(/active/);

  // Board still renders (the nav button is available to every trade), but with
  // can_allocate:false it is view-only: no Allocate action anywhere on the board.
  // The primary Allocate action is `button.act.primary` (the "Add note" action is
  // `button.act`). Target the class directly — a role/name match would also catch
  // the role="button" cards whose accessible names contain "Allocated".
  await expect(page.locator('#boardContent .tjb-wrap')).toBeVisible();
  await expect(page.locator('#boardContent .tjb-note').last())
    .toContainText('View only');
  await expect(page.locator('#boardContent button.act.primary')).toHaveCount(0);
});
