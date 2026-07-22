const path = require('node:path');
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Captain ruling (2026-07-22): "hugo should be able to see every single makesafe
// card by the way cause he is the manager. thats the thing. he only gets allocated
// them if he is actually going to do it as well."
//
// This spec guards the manager half of that ruling: a make-safe MANAGER sees EVERY
// make-safe card — allocated AND unallocated — because visibility is board-wide,
// decided by makesafe-board.v1's `sees_all_makesafes` / `can_allocate` permissions,
// never by whether a card is allocated to the viewer. Allocation stays orthogonal:
// it means "this person is doing the job", not "this person may see the job".
// The non-manager half ("do not change what installers see") is guarded by the
// sibling spec `installer-board-readonly.spec.js`.
//
// The frontend applies ZERO client-side allocation filter to the board — it renders
// exactly the cards the server sends (trade.html `MakesafeTradeV5.board`, and the
// note at "server scoping already applied upstream"). So "manager sees all" holds as
// long as the server flags the user as a make-safe manager; these tests lock the
// client half of that contract.

const SHOT_DIR = path.resolve(__dirname, '..', '..', 'test-results', 'manager-view');

test.describe('Make-safe MANAGER — board-wide visibility (captain ruling 2026-07-22)', () => {
  test.use({ persona: 'allocator' });

  test.beforeEach(async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await page.locator('#navBoard').click();
    await expect(page.locator('#viewBoard')).toHaveClass(/active/);
  });

  test('sees every make-safe card — unallocated AND allocated — not just their own work', async ({ appPage: page }, testInfo) => {
    // Every canonical column is present (nothing collapsed away from the manager).
    await expect(page.locator('#boardContent .tjb-colhead b')).toHaveText([
      'New', 'Allocated', 'Complete', 'Archive'
    ]);

    // The UNALLOCATED card (New column, no crew) is visible to the manager. This is
    // the crux of the ruling: a card allocated to nobody still shows on their board.
    const unallocated = page.locator('#boardContent .jc').filter({ hasText: 'E2E-MS-001' });
    await expect(unallocated).toBeVisible();
    await expect(unallocated).toContainText('Nobody allocated');

    // An ALLOCATED card (assigned to someone else) is ALSO visible — proof the board
    // is not filtered to "my allocated work".
    const allocated = page.locator('#boardContent .jc').filter({ hasText: 'E2E-MS-002' });
    await expect(allocated).toBeVisible();
    await expect(allocated).toContainText('E2E Installer');

    // Allocation keeps its meaning: the manager can allocate an unallocated card.
    // Target the action class (`button.act.primary`) — a role/name match would also
    // catch the role="button" card whose accessible name contains "Nobody allocated".
    await expect(unallocated.locator('button.act.primary')).toBeVisible();

    // Screenshots for the PR — desktop (1440) and phone (390) width manager board.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('#boardContent .jc')).toHaveCount(2);
    const desktop = await page.screenshot({ path: path.join(SHOT_DIR, 'manager-board-1440.png'), fullPage: true });
    await testInfo.attach('manager-board-1440', { body: desktop, contentType: 'image/png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#boardContent .jc')).toHaveCount(2);
    const phone = await page.screenshot({ path: path.join(SHOT_DIR, 'manager-board-390.png'), fullPage: true });
    await testInfo.attach('manager-board-390', { body: phone, contentType: 'image/png' });
  });
});
