const fs = require('node:fs');
const path = require('node:path');
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const EVIDENCE_DIR = process.env.ACCESS_LABELS_EVIDENCE_DIR || '';

async function evidenceShot(page, name) {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    animations: 'disabled'
  });
}

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
    await evidenceShot(page, 'crew-first-run-access-card');
    await intro.getByRole('button', { name: 'Got it' }).click();
    await expect(intro).toBeHidden();

    const block = await openProfile(page);
    await expect(block.locator('[data-access-title]')).toHaveText('Crew');
    await expect(page.locator('#profileContent')).not.toContainText(/Tier \d|Division Manager|Senior Installer/);
    await evidenceShot(page, 'crew-profile-access');

    // Dismissed once, stays dismissed for this account.
    await page.reload();
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#accessIntro')).toBeHidden();
  });

  test('Activity is one tap from the name in the header', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('#headerUser').click();
    await expect(page.locator('#userMenuAccess [data-access-title]')).toHaveText('Crew');
    await evidenceShot(page, 'crew-header-menu-activity');
    await page.locator('#userMenuActivity').click();
    await expect(page.locator('#viewActivity')).toHaveClass(/active/);
    await expect(page.locator('#userMenu')).toBeHidden();
    await evidenceShot(page, 'crew-activity-from-header');
  });

  test('no Everyone lens anywhere, and the Pay page is titled Pay', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    const everyone = await openCalendarFilter(page);
    await expect(everyone).toHaveCount(0);
    await evidenceShot(page, 'crew-calendar-no-everyone');
    await page.locator('#ncDoneBtn').click();

    await page.locator('#bottomNav [data-view="myJobs"]').click();
    await expect(page.locator('#adminJobToggle')).toBeHidden();
    await evidenceShot(page, 'crew-jobs-no-everyone');

    await page.locator('#bottomNav [data-view="hours"]').click();
    await expect(page.locator('[data-financial-hub]')).toContainText('Pay');
    await expect(page.locator('[data-financial-hub]')).not.toContainText('Financial');
    await evidenceShot(page, 'crew-pay-hub');
  });

  test('keeps the Board when they have make-safe cards', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#navBoard')).toBeVisible();
    await evidenceShot(page, 'crew-board-nav-with-cards');
  });

  test('Board stays visible when a second onLogin hits the cached make-safe feed', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await expect.poll(() => feedRequests.filter((r) => r.action === 'makesafe_board').length).toBeGreaterThan(0);
    await expect(page.locator('#navBoard')).toBeVisible();
    const boardCalls = feedRequests.filter((r) => r.action === 'makesafe_board').length;

    // signIn emits auth:login, and SIGNED_IN also emits it — the same
    // double-fire as a restored session (initApp onLogin plus INITIAL_SESSION).
    // onLogin hides Board first; the cache-hit return must put it back.
    await page.evaluate(async ({ email, password }) => {
      await window.SECUREWORKS_CLOUD.auth.signIn(email, password);
    }, { email: PERSONAS.installer.email, password: PERSONAS.installer.password });

    await expect(page.locator('#navBoard')).toBeVisible();
    expect(feedRequests.filter((r) => r.action === 'makesafe_board').length).toBe(boardCalls);
    await evidenceShot(page, 'crew-board-after-cached-relogin');
  });
});

test.describe('Hourly crew with no make-safe work', () => {
  test.use({ persona: 'installer', feedScenario: 'board-empty-own' });

  test('Board is hidden from the nav, and explains itself if reached', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await expect.poll(() => feedRequests.filter((r) => r.action === 'makesafe_board').length).toBeGreaterThan(0);
    await expect(page.locator('#navBoard')).toBeHidden();
    await evidenceShot(page, 'crew-board-nav-hidden-empty');

    await page.evaluate(() => window.showView('board'));
    const empty = page.locator('#boardContent [data-board-empty-own]');
    await expect(empty).toContainText('No make-safe jobs on your board');
    await evidenceShot(page, 'crew-board-empty-explains');
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
    await evidenceShot(page, 'office-first-run-access-card');

    const everyone = await openCalendarFilter(page);
    await expect(everyone).toHaveText('Everyone · all trades');
    await evidenceShot(page, 'office-calendar-everyone-all-trades');
    await page.locator('#ncDoneBtn').click();

    await page.locator('#bottomNav [data-view="myJobs"]').click();
    await expect(page.locator('#adminToggleAll')).toHaveText('Everyone · all trades');
    await evidenceShot(page, 'office-jobs-everyone-all-trades');

    const block = await openProfile(page);
    await expect(block.locator('[data-access-title]')).toHaveText('Office');
    await expect(page.locator('#profileContent')).not.toContainText(/Tier \d|Division Manager/);
    await evidenceShot(page, 'office-profile-access');
  });
});

test.describe('Vertical manager on work orders', () => {
  test.use({ persona: 'fencing_manager' });

  test('reads as Fencing manager paid by work order, and Everyone names fencing', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await expect(page.locator('#accessIntro [data-access-title]')).toHaveText('Fencing manager');
    await expect(page.locator('#navBoard')).toBeVisible();
    await evidenceShot(page, 'fencing-manager-first-run-access-card');

    const everyone = await openCalendarFilter(page);
    await expect(everyone).toHaveText('Everyone · fencing');
    await evidenceShot(page, 'fencing-manager-calendar-everyone-fencing');
    await page.locator('#ncDoneBtn').click();

    await page.locator('#bottomNav [data-view="myJobs"]').click();
    await expect(page.locator('#adminToggleAll')).toHaveText('Everyone · fencing');
    await evidenceShot(page, 'fencing-manager-jobs-everyone-fencing');

    const block = await openProfile(page);
    await expect(block.locator('[data-access-title]')).toHaveText('Fencing manager');
    await expect(block.locator('[data-access-pay]')).toHaveText('Paid by work order');
    await expect(block.locator('[data-access-scope]')).toContainText('every fencing job');
    await expect(page.locator('#profileContent')).not.toContainText(/Tier \d|lead installer/i);
    await evidenceShot(page, 'fencing-manager-profile-access');
  });
});
