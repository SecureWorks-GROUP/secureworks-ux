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
  await expect(page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' })).toHaveCount(1);
  await expect(card.getByRole('button', { name: 'Work Order', exact: true })).toBeVisible();
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(card.locator('[data-cardamt]')).toHaveText('$60.00');
  await expect(card).toContainText('WO trades [Israel $40]');
  await page.getByRole('button', { name: '+ Add labour line' }).click();
  await card.locator('[data-cardwollname]').nth(1).fill('Kim');
  await card.locator('[data-cardwollhours]').fill('1');
  await card.locator('[data-cardwollrate]').fill('20');
  await card.locator('[data-cardwollrate]').press('Tab');
  await page.evaluate(() => window.retryPerMetreWorkOrderHydrate());
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(card.locator('[data-cardwollname]').nth(1)).toHaveValue('Kim');
  await card.locator('[data-woll]').nth(1).getByRole('button').click();
  await expect(card.locator('[data-cardamt]')).toHaveText('$60.00');
  await expect(page.getByRole('button', { name: '+ Deduct work order paid to a trade' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add job' }).first()).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeEnabled();
  await page.getByRole('button', { name: '+ Add job' }).first().click();
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');

  await page.getByRole('button', { name: '+ Add amount' }).click();
  await card.locator('[data-cardlumpdesc]').fill('Materials');
  await card.locator('[data-cardlumpamt]').fill('10');
  await card.locator('[data-cardlumpamt]').press('Tab');
  await expect(card.locator('[data-cardamt]')).toHaveText('$50.00');
  await expect(card).toContainText('other [Materials $10]');

  const money = page.locator('[data-invoice-money-summary]');
  await expect(money).toContainText('Earned$50.00');
  await expect(money).toContainText('Less super (12%)−$6.00');
  await expect(money).toContainText('Net pay$44.00');

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

test('a failed work-order hydrate shows retry and keeps submit locked', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();

  let failHydrate = true;
  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_work_orders' && failHydrate) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'work orders unavailable' })
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toBeVisible();
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toContainText('Could not load work-order amounts');
  await expect(page.locator('#invSubmitBtn')).toBeDisabled();
  await expect(page.locator('[data-pm-wo-hydrate-submit-block]')).toContainText('Retry before submitting');

  failHydrate = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toHaveCount(0);
  await expect(page.locator('#invSubmitBtn')).toBeEnabled();
});

test('My Work Orders and Work Order Invoice recover from a failed read', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();

  let failReads = true;
  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_work_orders' && failReads) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'work orders unavailable' })
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: 'My Work Orders' }).click();
  await expect(page.locator('[data-work-order-hub-error]')).toBeVisible();
  failReads = false;
  await page.locator('[data-work-order-hub-retry]').click();
  await expect(page.locator('[data-work-order-card]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();
  failReads = true;
  await page.locator('[data-work-order-weekly-invoice]').click();
  await expect(page.locator('[data-weekly-wo-load-error]')).toBeVisible();
  failReads = false;
  await page.locator('[data-weekly-wo-retry]').click();
  await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();
  await expect(page.locator('[data-weekly-work-order]')).toHaveCount(1);
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
