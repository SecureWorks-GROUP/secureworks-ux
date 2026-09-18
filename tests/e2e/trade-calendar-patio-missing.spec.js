const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthDate, perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

// Patio-missing production regression (fm/trade-calendar-patio-missing):
// TradeCalendarSource's ONE registered loader/adaptV1 (trade.html's
// <trade-calendar-source-all>) hardcoded the fencing vertical, so the new
// calendar's Patio and All filters never fetched a model for ANY viewer —
// confirmed against 1b5546e (pre-#321): same failure, so this predates the
// Repair PR and was not caused by it. #321 merely surfaced it by giving the
// dispatcher a working Repair chip while Patio/All stayed silently broken
// since the M2 cutover.
//
// This guards the fix: an unscoped dispatcher (ops_manager) sees a spanning
// patio job (on BOTH its days) and an untimed patio job under Patio, sees
// every vertical merged together under All (patio, fencing, and a
// repair-family make-safe filed as Repair), and never sees any of them leak
// onto the default Make-safe filter.
test.describe('Trade calendar Patio and All filters (dispatcher lens)', () => {
  test.use({ persona: 'allocator', feedScenario: 'trade-calendar-patio-missing' });

  const monday = perthWeekMonday();
  const tuesday = addIsoDays(monday, 1);
  const today = perthDate();

  test('a dispatcher sees patio (a spanning job on both days, an untimed job) under Patio, and every vertical merged under All, never under Make-safe', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);

    // Default filter is Make-safe: none of the dispatch fixture jobs belong to
    // the make-safe board fixture, so none leak onto it.
    await expect(page.locator('#ncCalhost')).not.toContainText('SWP-261046');
    await expect(page.locator('#ncCalhost')).not.toContainText('SWP-261183');
    await expect(page.locator('#ncCalhost')).not.toContainText('SWF-261098');
    await expect(page.locator('#ncCalhost')).not.toContainText('SWMS-261319');
    await expect(page.locator('#ncCalhost')).not.toContainText('SWP-261207');

    // Switch to Patio — the filter that was silently broken for every viewer.
    await page.locator('#ncFbtn').click();
    await page.locator('#ncSheetBody [data-ftype="patio"]').click();
    await expect(page.locator('#ncSheetBody [data-ftype="patio"]')).toHaveClass(/on/);
    await page.locator('#ncDoneBtn').click();

    // Today: the untimed patio job (CP1's crewed-but-untimed case) is visible,
    // fencing and the repair-family make-safe are not.
    await expect(page.locator('#ncCalhost')).toContainText('SWP-261183');
    await expect(page.locator('#ncCalhost')).toContainText('Emma Clarke');
    await expect(page.locator('#ncCalhost')).not.toContainText('SWF-261098');
    await expect(page.locator('#ncCalhost')).not.toContainText('SWMS-261319');
    // A patio-typed row carrying repair family metadata comes back under the
    // backend's `type=patio` filter: it files as Repair, so it is absent here,
    // and it must never make the whole Patio calendar fail to load.
    await expect(page.locator('#ncCalhost')).not.toContainText('SWP-261207');
    await expect(page.locator('#ncCalhost [data-feed-failure]')).toHaveCount(0);

    // The spanning patio job (Mon->Tue of the current week) renders on BOTH
    // its days — never just the day the assignment row was created on.
    await page.locator('#ncDayrail [data-date="' + monday + '"]').click();
    const spanDay1 = page.locator('#ncCalhost .ncard.pt').filter({ hasText: 'SWP-261046' });
    await expect(spanDay1).toBeVisible();
    await expect(spanDay1).toContainText('Day 1 of 2');
    await expect(spanDay1).toContainText('Theunnis');

    await page.locator('#ncDayrail [data-date="' + tuesday + '"]').click();
    const spanDay2 = page.locator('#ncCalhost .ncard.pt').filter({ hasText: 'SWP-261046' });
    await expect(spanDay2).toBeVisible();
    await expect(spanDay2).toContainText('Day 2 of 2');

    // Switch to All — every vertical merged into one payload (the dispatcher
    // 'all' request omits `type`).
    await page.locator('#ncFbtn').click();
    await page.locator('#ncSheetBody [data-ftype="all"]').click();
    await expect(page.locator('#ncSheetBody [data-ftype="all"]')).toHaveClass(/on/);
    await page.locator('#ncDoneBtn').click();

    // Still on the spanning patio job's second day: still there under All.
    const allSpanDay2 = page.locator('#ncCalhost .ncard.pt').filter({ hasText: 'SWP-261046' });
    await expect(allSpanDay2).toBeVisible();

    // Jump to today: the untimed patio, fencing, and repair-family jobs all
    // render together — the repair-family make-safe files as Repair, never
    // Make-safe, even mixed into the same merged payload.
    await page.locator('#ncDayrail [data-date="' + today + '"]').click();
    await expect(page.locator('#ncCalhost')).toContainText('SWP-261183');
    const allFencingCard = page.locator('#ncCalhost .ncard.fc').filter({ hasText: 'SWF-261098' });
    const allRepairCard = page.locator('#ncCalhost .ncard.rp').filter({ hasText: 'SWMS-261319' });
    await expect(allFencingCard).toBeVisible();
    await expect(allRepairCard).toBeVisible();
    await expect(allRepairCard).toContainText('Repair');
    await expect(page.locator('#ncCalhost .ncard.ms').filter({ hasText: 'SWMS-261319' })).toHaveCount(0);
    const allPatioRepairCard = page.locator('#ncCalhost .ncard.rp').filter({ hasText: 'SWP-261207' });
    await expect(allPatioRepairCard).toBeVisible();
    await expect(page.locator('#ncCalhost .ncard.pt').filter({ hasText: 'SWP-261207' })).toHaveCount(0);
  });
});
