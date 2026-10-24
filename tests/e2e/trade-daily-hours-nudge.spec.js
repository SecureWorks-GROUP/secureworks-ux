// Daily hours nudge (Hugo's running draft, 2026-10-24).
// The banner shows when today's start and finish are not on the weekly draft.
// Add hours opens that draft. Save does not send the invoice.
const fs = require('fs');
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { fillCardTime, expectCardHours } = require('../helpers/invoice-time');
const { perthDate } = require('../helpers/feed-stub');

const shotDir = '/opt/cursor/artifacts';

function shot(page, name) {
  try { fs.mkdirSync(shotDir, { recursive: true }); } catch (e) { return Promise.resolve(); }
  return page.screenshot({ path: shotDir + '/' + name });
}

test.describe('running draft on', () => {
  test.use({
    persona: 'installer',
    feedScenario: 'trade-daily-hours-nudge',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    timezoneId: 'Australia/Perth'
  });

  test('banner opens today\'s hours on the draft and does not send', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    const nudge = page.locator('#hoursNudgeSchedule [data-hours-nudge]');
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText("Add today's hours");
    await expect(nudge).toContainText('does not send the invoice');
    await expect(nudge.getByRole('button', { name: 'Add hours' })).toBeVisible();
    await expect(nudge.getByRole('button', { name: 'Not today' })).toBeVisible();
    await shot(page, 'hours-nudge-banner.png');

    await nudge.getByRole('button', { name: 'Add hours' }).click();
    const card = page.locator('[data-hours-nudge-target]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('E2E-JOB-001');
    await expect(page.locator('[data-hours-nudge-land]')).toContainText('does not send the invoice');
    await expect(page.locator('#invSaveBtn')).toBeVisible();
    await expect(page.locator('#invSubmitBtn')).toBeVisible();

    await fillCardTime(card, 8, { date: perthDate() });
    await expectCardHours(card, 8);
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'hours-nudge-today-hours.png');

    await page.locator('[data-hours-nudge-check]').click();
    await expect(page.locator('#invSaveBtn')).toBeInViewport();
    await shot(page, 'hours-nudge-check-draft.png');
    await page.locator('#invSaveBtn').click();
    await expect(page.locator('#toast')).toContainText('not been sent');
    expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
    expect(feedRequests.some((entry) => entry.action === 'submit_trade_invoice')).toBe(false);
    const saves = feedRequests.filter((entry) => entry.action === 'save_running_invoice_draft');
    expect(saves.length).toBeGreaterThan(0);
    const last = saves[saves.length - 1].body;
    expect(last.submit).toBeUndefined();
    expect(last.status).toBeUndefined();
    const saved = last.draft_builder.jobCards.find((row) => row.job_number === 'E2E-JOB-001');
    expect(saved.work_date).toBe(perthDate());
    expect(saved.start_time).toBe('07:00');
    expect(saved.finish_time).toBe('15:00');

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.locator('[data-view="schedule"]').click();
    await expect(page.locator('[data-hours-nudge]')).toHaveCount(0);
    expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
  });

  test('Not today hides the banner for the day', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    const nudge = page.locator('#hoursNudgeSchedule [data-hours-nudge]');
    await expect(nudge).toBeVisible();
    await nudge.getByRole('button', { name: 'Not today' }).click();
    await expect(page.locator('[data-hours-nudge]')).toHaveCount(0);
    await page.locator('[data-view="myJobs"]').click();
    await expect(page.locator('#hoursNudgeJobs [data-hours-nudge]')).toHaveCount(0);
    await page.locator('[data-view="schedule"]').click();
    await expect(page.locator('[data-hours-nudge]')).toHaveCount(0);
    expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
    expect(feedRequests.some((entry) => entry.action === 'save_running_invoice_draft')).toBe(false);
  });
});

test.describe('running draft off', () => {
  test.use({
    persona: 'installer',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    timezoneId: 'Australia/Perth'
  });

  test('no banner and no draft read when the flag is off', async ({ appPage: page, feedRequests }) => {
    const hours = page.waitForResponse((response) => response.url().includes('action=my_hours'));
    await signIn(page, PERSONAS.installer);
    await hours;
    await expect(page.locator('[data-hours-nudge]')).toHaveCount(0);
    expect(feedRequests.some((entry) => entry.action === 'get_running_invoice_draft')).toBe(false);
    expect(feedRequests.some((entry) => entry.action === 'save_running_invoice_draft')).toBe(false);
    expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
  });
});
