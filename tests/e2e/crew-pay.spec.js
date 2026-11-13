// SecureWorks Crew: the weekly invoice on the demo server.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

test('the week lists the jobs, takes times, and sends one invoice', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay'));
  await expect(page.locator('.payhero')).toContainText('This week');
  await page.locator('.payhero').click();
  await expect(page.getByRole('heading', { name: '9 to 15 Nov' })).toBeVisible();

  // Morley was clocked off with times saved, so it is ready with nothing typed.
  await expect(page.locator('.line', { hasText: 'Morley' })).toContainText('saved at clock off');
  // Send stays shut while a line still needs times.
  await expect(page.getByRole('button', { name: /Send invoice/ })).toBeDisabled();

  const wembley = page.locator('.line', { hasText: 'Wembley' });
  await expect(wembley).toContainText('Add your start and finish times');
  await wembley.click();
  let sheet = page.getByRole('dialog', { name: 'Wembley' });
  await sheet.locator('input[type="time"]').first().fill('07:00');
  await sheet.locator('input[type="time"]').nth(1).fill('14:00');
  await sheet.getByRole('button', { name: '30 min' }).click();
  await expect(sheet.locator('.hoursout')).toContainText('6.5 h');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(wembley).toContainText('$357.50');

  // Days that were booked but not worked are left off.
  for (const name of ['South Perth', 'Joondalup']) {
    const line = page.locator('.line', { hasText: name }).first();
    if (await line.locator('text=saved at clock off').count()) continue;
    await line.click();
    sheet = page.getByRole('dialog', { name });
    await sheet.getByRole('switch', { name: /Leave this off the invoice/ }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
  }

  const send = page.getByRole('button', { name: /Send invoice/ });
  await expect(send).toBeEnabled();
  await send.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send invoice' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice sent' })).toBeVisible();
  await expect(page.getByText('You get paid')).toBeVisible();

  // One invoice a week: the week now reads as sent.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.payhero')).toContainText('Sent');
  expect(errors).toEqual([]);
});

test('a job the trade worked but was not booked on can be added to the week', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay/week/2026-11-09'));
  await page.getByRole('button', { name: 'Add a job' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByPlaceholder('Suburb, name or job number').fill('scarborough');
  await sheet.getByRole('button', { name: /Scarborough/ }).click();
  await sheet.getByRole('button', { name: /Wed/ }).click();
  await sheet.getByRole('button', { name: 'Add to this invoice' }).click();
  await expect(page.locator('.line', { hasText: 'Scarborough' })).toContainText('Add your start and finish times');
  expect(errors).toEqual([]);
});
