// Daily hours nudge (Hugo, 2026-10-24).
//
// On a phone, a flagged trade sees "Add today's hours" when a job today has
// no start and finish on the weekly draft. One tap opens that day's lines.
// Check your draft scrolls to Save. Nothing is submitted.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { fillCardTime, expectCardHours } = require('../helpers/invoice-time');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

const PHONE = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  timezoneId: 'Australia/Perth'
};

test.describe('daily hours nudge', () => {
  test.use({
    persona: 'installer',
    feedScenario: 'trade-invoice-running-draft',
    appWeekDay: 2,
    ...PHONE
  });

  test('one tap opens today, then the draft, and the card goes once the times are in', async ({ appPage: page, feedRequests }) => {
    test.setTimeout(40_000);
    await signIn(page, PERSONAS.installer);
    const nudge = page.locator('[data-hours-nudge]');
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText("Add today's hours");
    await expect(nudge).toContainText('SWMS-261400');
    await expect(nudge).toContainText('Nothing is sent');
    await page.screenshot({ path: '/opt/cursor/artifacts/hours-nudge.png' });

    await page.locator('[data-hours-nudge-go]').click();
    await expect(page.locator('[data-hours-today-strip]')).toContainText('Nothing is sent until you press Submit');
    const card = page.locator('.jc-card').filter({ hasText: 'SWMS-261400' });
    await expect(card.locator('[data-cardstart]')).toBeVisible();
    await expect(card.locator('[data-carddate]')).toHaveValue('');
    await expect(card.locator('[data-cardstart]')).toHaveValue('');
    await expect(card.locator('[data-cardfinish]')).toHaveValue('');
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/opt/cursor/artifacts/hours-nudge-today.png' });

    await fillCardTime(card, 8, { date: addIsoDays(perthWeekMonday(), 2) });
    await expectCardHours(card, 8);
    await page.locator('[data-hours-check-draft]').click();
    await expect(page.locator('#invSaveBtn')).toBeInViewport();
    await expect(page.locator('#invSaveBtn')).toHaveText('Save');
    await expect(page.locator('[data-invoice-save-note]')).toContainText('does not send');
    await expect(page.locator('#invSubmitBtn')).toBeVisible();
    await page.locator('#invSaveBtn').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/opt/cursor/artifacts/hours-nudge-draft.png' });

    await page.locator('[data-view="schedule"]').click();
    await expect(page.locator('#dailyHoursNudge')).toHaveAttribute('data-hours-nudge-state', 'logged');
    await expect(page.locator('[data-hours-nudge]')).toHaveCount(0);
    expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
    expect(feedRequests.some((entry) => entry.action === 'submit_trade_invoice')).toBe(false);
  });

  test('Not today hides it for the day', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('[data-hours-nudge]')).toBeVisible();
    await page.locator('[data-hours-nudge-dismiss]').click();
    await expect(page.locator('[data-hours-nudge]')).toHaveCount(0);
    await expect(page.locator('#dailyHoursNudge')).toHaveAttribute('data-hours-nudge-state', 'dismissed');
    expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
  });
});

test.describe('daily hours nudge stays off without the flag', () => {
  test.use({
    persona: 'installer',
    feedScenario: 'normal',
    appWeekDay: 2,
    ...PHONE
  });

  test('no card when the running draft is off', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#dailyHoursNudge')).toHaveAttribute('data-hours-nudge-state', 'off');
    await expect(page.locator('[data-hours-nudge]')).toHaveCount(0);
    expect(feedRequests.some((entry) => entry.action === 'get_running_invoice_draft')).toBe(false);
    expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
  });
});
