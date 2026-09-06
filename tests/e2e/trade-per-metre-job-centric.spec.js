const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'fencing_manager' });

test('Henry Financial invoices jobs with WO-trade deducts and a 12% super preview', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();

  await expect(page.locator('[data-financial-hub]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weekly Invoice' })).toBeVisible();
  await expect(page.locator('[data-work-order-weekly-invoice]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'My Work Orders' })).toBeVisible();
  await expect(page.locator('[data-weekly-work-order]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  await expect(page.locator('#hoursContent')).toContainText('what SecureWorks owes you');

  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Work Order', exact: true })).toBeVisible();
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(card.locator('[data-cardamt]')).toHaveText('$60.00');
  await expect(card).toContainText('WO trades [Israel $40]');
  await expect(page.getByRole('button', { name: '+ Deduct work order paid to a trade' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add job' }).first()).toBeVisible();

  const money = page.locator('[data-invoice-money-summary]');
  await expect(money).toContainText('Earned$60.00');
  await expect(money).toContainText('Less super (12%)−$7.20');
  await expect(money).toContainText('Net pay$52.80');

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();

  await page.getByRole('button', { name: 'My Work Orders' }).click();
  await expect(page.getByRole('heading', { name: 'My Work Orders' })).toBeVisible();
  await expect(page.locator('[data-work-order-card]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add to Weekly Invoice' })).toBeVisible();

  const hubReads = feedRequests.filter((entry) => entry.method === 'GET' && entry.action === 'my_work_orders');
  expect(hubReads.length).toBeGreaterThan(0);
  expect(hubReads.every((entry) => new URL(entry.url).searchParams.get('mode') === 'all')).toBe(true);
});

test('an empty work-order week offers the job-centric invoice builder', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.locator('[data-work-order-weekly-invoice]').click();
  await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();

  await page.getByRole('button', { name: 'Next invoice week' }).click();
  await expect(page.getByText('No completed work orders available for this week')).toBeVisible();
  await page.locator('[data-invoice-jobs-instead]').click();

  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  await expect(page.locator('#hoursContent')).toContainText('Your jobs this week');
  await expect(page.getByRole('button', { name: '+ Add job' }).first()).toBeVisible();
});
