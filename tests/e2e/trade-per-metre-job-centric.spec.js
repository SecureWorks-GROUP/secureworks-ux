const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'fencing_manager' });

test('Henry Financial uses the job-centric invoice path and mode=all work orders', async ({ appPage: page, feedRequests }) => {
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
  await expect(page.locator('#hoursContent')).toContainText('Your jobs this week');
  await expect(page.getByRole('button', { name: '+ Add job' }).first()).toBeVisible();
  await expect(page.locator('[data-weekly-work-order]')).toHaveCount(0);
  await expect(page.locator('#hoursContent')).not.toContainText('No completed work orders available for this week');

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
