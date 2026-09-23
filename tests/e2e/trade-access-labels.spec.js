const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Trade page review, group 1 (2026-09-23): each person can tell what their
// access is and what "Everyone" covers. Labels come from TradeAccessCore
// (office role, managed_verticals, invoice_type), never the trade tier, so
// "Tier 3 - Division Manager" no longer stands in for "office".
// Pure label rules per role: scripts/test-trade-access-labels.js.

async function openProfile(page) {
  await page.locator('#bottomNav [data-view="profile"]').click();
  await expect(page.locator('#viewProfile')).toHaveClass(/active/);
  return page.locator('#profileContent .access-block.profile');
}

async function openCalendarFilter(page) {
  await page.locator('#bottomNav [data-view="schedule"]').click();
  await page.locator('#ncFbtn').click();
  return page.locator('#ncSheetBody [data-fscope="everyone"]');
}

test.describe('Hourly crew', () => {
  test.use({ persona: 'installer' });

  test('Profile and first run name the access as Crew, never a tier', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);

    const intro = page.locator('#accessIntro');
    await expect(intro).toBeVisible();
    await expect(intro.locator('[data-access-title]')).toHaveText('Crew');
    await expect(intro).toContainText('search All in Jobs');
    await intro.getByRole('button', { name: 'Got it' }).click();
    await expect(intro).toBeHidden();

    const block = await openProfile(page);
    await expect(block.locator('[data-access-title]')).toHaveText('Crew');
    await expect(page.locator('#profileContent')).not.toContainText(/Tier \d|Division Manager|Senior Installer/);

    // Dismissed once, stays dismissed for this account.
    await page.reload();
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#accessIntro')).toBeHidden();
  });

  test('Activity is one tap from the name in the header', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('#headerUser').click();
    await expect(page.locator('#userMenuAccess [data-access-title]')).toHaveText('Crew');
    await page.locator('#userMenuActivity').click();
    await expect(page.locator('#viewActivity')).toHaveClass(/active/);
    await expect(page.locator('#userMenu')).toBeHidden();
  });

  test('no Everyone lens anywhere, and the Pay page is titled Pay', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    const everyone = await openCalendarFilter(page);
    await expect(everyone).toHaveCount(0);
    await page.locator('#ncDoneBtn').click();

    await page.locator('#bottomNav [data-view="myJobs"]').click();
    await expect(page.locator('#adminJobToggle')).toBeHidden();

    await page.locator('#bottomNav [data-view="hours"]').click();
    await expect(page.locator('[data-financial-hub]')).toContainText('Pay');
    await expect(page.locator('[data-financial-hub]')).not.toContainText('Financial');
  });

  test('keeps the Board when they have make-safe cards', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#navBoard')).toBeVisible();
  });
});

test.describe('Hourly crew with no make-safe work', () => {
  test.use({ persona: 'installer', feedScenario: 'board-empty-own' });

  test('Board is hidden from the nav, and explains itself if reached', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await expect.poll(() => feedRequests.filter((r) => r.action === 'makesafe_board').length).toBeGreaterThan(0);
    await expect(page.locator('#navBoard')).toBeHidden();

    await page.evaluate(() => window.showView('board'));
    const empty = page.locator('#boardContent [data-board-empty-own]');
    await expect(empty).toContainText('No make-safe jobs on your board');
    await empty.getByRole('button', { name: 'Open Jobs' }).click();
    await expect(page.locator('#viewMyJobs')).toHaveClass(/active/);
  });
});

test.describe('Office', () => {
  test.use({ persona: 'allocator' });

  test('reads as Office, and Everyone says it covers all trades', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await expect(page.locator('#accessIntro [data-access-title]')).toHaveText('Office');
    await expect(page.locator('#navBoard')).toBeVisible();

    const everyone = await openCalendarFilter(page);
    await expect(everyone).toHaveText('Everyone · all trades');
    await page.locator('#ncDoneBtn').click();

    await page.locator('#bottomNav [data-view="myJobs"]').click();
    await expect(page.locator('#adminToggleAll')).toHaveText('Everyone · all trades');

    const block = await openProfile(page);
    await expect(block.locator('[data-access-title]')).toHaveText('Office');
    await expect(page.locator('#profileContent')).not.toContainText(/Tier \d|Division Manager/);
  });
});

test.describe('Vertical manager on work orders', () => {
  test.use({ persona: 'fencing_manager' });

  test('reads as Fencing manager paid by work order, and Everyone names fencing', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await expect(page.locator('#accessIntro [data-access-title]')).toHaveText('Fencing manager');
    await expect(page.locator('#navBoard')).toBeVisible();

    const everyone = await openCalendarFilter(page);
    await expect(everyone).toHaveText('Everyone · fencing');
    await page.locator('#ncDoneBtn').click();

    await page.locator('#bottomNav [data-view="myJobs"]').click();
    await expect(page.locator('#adminToggleAll')).toHaveText('Everyone · fencing');

    const block = await openProfile(page);
    await expect(block.locator('[data-access-title]')).toHaveText('Fencing manager');
    await expect(block.locator('[data-access-pay]')).toHaveText('Paid by work order');
    await expect(block.locator('[data-access-scope]')).toContainText('every fencing job');
    await expect(page.locator('#profileContent')).not.toContainText(/Tier \d|lead installer/i);
  });
});
