const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer' });

test('a work-order line can add travel without asking for times; hourly still does', async ({ appPage: page, feedRequests }, testInfo) => {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  await expect(card).toBeVisible();

  // Hours mode is unchanged: date, start and finish, and no travel allowance.
  await expect(card.locator('input[type="date"]')).toBeVisible();
  await expect(card.locator('input[type="time"]')).toHaveCount(2);
  await expect(card.locator('[data-cardtravel]')).toHaveCount(0);
  await expect(card.getByText('Description of work')).toBeVisible();

  await card.getByRole('button', { name: 'Work Order', exact: true }).click();
  await expect(card.locator('input[type="date"]')).toHaveCount(0);
  await expect(card.locator('input[type="time"]')).toHaveCount(0);
  await expect(card.getByText('Travel allowance', { exact: true })).toBeVisible();
  await expect(card.getByText('No date or times.')).toBeVisible();

  await card.locator('[data-cardwoalloc]').fill('400');
  await card.locator('[data-cardwoalloc]').press('Tab');
  await expect(card.locator('[data-cardamt]')).toHaveText('$400.00');

  // A negative amount stays in the field, stays off the total, and blocks submit.
  await card.getByLabel('Travel allowance amount').fill('-30');
  await card.getByLabel('Travel allowance amount').press('Tab');
  await expect(card.getByLabel('Travel allowance amount')).toHaveValue('-30');
  await expect(card.locator('[data-cardtravelwarn]')).toHaveText('Travel amount must be more than $0');
  await expect(page.locator('#jcRunningTotal')).toHaveText('Subtotal: $400.00');
  await page.locator('#invSubmitBtn').click();
  await expect(page.locator('#toast')).toContainText('Travel amount must be more than $0');
  await expect(page.locator('#confirmOverlay')).toBeHidden();
  await card.getByLabel('Travel allowance amount').fill('');
  await card.getByLabel('Travel allowance amount').press('Tab');
  await expect(card.locator('[data-cardtravelwarn]')).toBeHidden();

  // Kilometres and a note without an amount stay off the total and say so.
  await card.getByLabel('Travel kilometres').fill('42');
  await card.getByLabel('Travel kilometres').press('Tab');
  await expect(card.locator('[data-cardtravelwarn]')).toContainText('Enter the travel amount.');
  await expect(page.locator('#jcRunningTotal')).toHaveText('Subtotal: $400.00');

  await card.getByLabel('Travel allowance amount').fill('45');
  await card.getByLabel('Travel note').fill('tolls');
  await card.getByLabel('Travel note').press('Tab');
  await expect(card.locator('[data-cardtravelwarn]')).toBeHidden();
  await expect(card.locator('[data-cardtravelline]')).toContainText('Travel allowance · SWF-26767');
  await expect(card.locator('[data-cardtravelpay]')).toHaveText('$45.00');
  await expect(card.locator('[data-cardamt]')).toHaveText('$400.00');
  await expect(page.locator('#jcRunningTotal')).toHaveText('Subtotal: $445.00');

  const desktopShot = testInfo.outputPath('wo-travel-desktop.png');
  await page.locator('#hoursContent').screenshot({ path: desktopShot });
  await testInfo.attach('Work order with travel allowance', { path: desktopShot, contentType: 'image/png' });

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneShot = testInfo.outputPath('wo-travel-phone.png');
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: phoneShot });
  await testInfo.attach('Work order travel allowance on a phone', { path: phoneShot, contentType: 'image/png' });
  await page.setViewportSize({ width: 1280, height: 800 });

  // Switching to hours puts the time questions back and hides travel.
  await card.getByRole('button', { name: 'Hours', exact: true }).click();
  await expect(card.locator('input[type="date"]')).toBeVisible();
  await expect(card.locator('input[type="time"]')).toHaveCount(2);
  await expect(card.locator('[data-cardtravel]')).toHaveCount(0);
  await expect(card.getByText('Description of work')).toBeVisible();

  const hoursShot = testInfo.outputPath('wo-travel-hours-unchanged.png');
  await card.screenshot({ path: hoursShot });
  await testInfo.attach('Hourly card still asks for the date and times', { path: hoursShot, contentType: 'image/png' });

  // Back on the work order, the allowance is still there and times are not.
  await card.getByRole('button', { name: 'Work Order', exact: true }).click();
  await expect(card.locator('input[type="date"]')).toHaveCount(0);
  await expect(card.locator('input[type="time"]')).toHaveCount(0);
  await expect(card.getByLabel('Travel allowance amount')).toHaveValue('45');
  await expect(card.getByLabel('Travel kilometres')).toHaveValue('42');
  await expect(card.getByLabel('Travel note')).toHaveValue('tolls');

  await page.locator('#invSubmitBtn').click();
  await expect(page.locator('#confirmOverlay')).toBeVisible();
  await expect(page.locator('#confirmMsg')).toContainText('$445.00 before super');
  await expect(page.locator('#confirmMsg')).not.toContainText('Add the date you worked');
  const confirmShot = testInfo.outputPath('wo-travel-confirm.png');
  await page.locator('#confirmOverlay .confirm-box').screenshot({ path: confirmShot });
  await testInfo.attach('Submit confirm includes the travel allowance', { path: confirmShot, contentType: 'image/png' });
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();
  await expect(page.getByText('Invoice Submitted')).toBeVisible();

  const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
  expect(submit).toBeTruthy();
  const items = submit.body.extra_items;
  expect(items.map((item) => item.row_type)).toEqual(['work_order', 'travel']);
  expect(items[0]).toEqual(expect.objectContaining({
    job_number: 'SWF-26767',
    rate: 400,
    wo_allocated: 400
  }));
  expect(items[0].work_date).toBeUndefined();
  expect(items[0].start_time).toBeUndefined();
  expect(items[0].finish_time).toBeUndefined();
  expect(items[1]).toEqual(expect.objectContaining({
    type: 'Travel',
    row_type: 'travel',
    quantity: 1,
    unit: 'ea',
    rate: 45,
    job_number: 'SWF-26767',
    description: 'Travel · SWF-26767 · 42 km · tolls'
  }));
  expect(items[1].work_order_id).toBeUndefined();
  expect(items[1].work_date).toBeUndefined();
  expect(items[1].start_time).toBeUndefined();
  expect(items[1].finish_time).toBeUndefined();
  expect(submit.body.manual_assignments).toEqual([]);
  expect(submit.body.super_rate).toBeUndefined();
  expect(submit.body.super_amount).toBeUndefined();
  const finals = JSON.stringify(submit.body.final_deductions || []);
  expect(finals).not.toContain('45');
  expect(finals).not.toContain('Travel');
});
