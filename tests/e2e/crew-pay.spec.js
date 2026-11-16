// SecureWorks Crew: the timesheet, the invoice made from it, and the saved
// weekly draft, on the demo server. (Proposed replacement for
// tests/e2e/crew-pay.spec.js after the Pay rebuild.)
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

async function fillTimes(page, name, start, finish, brk) {
  await page.locator('.pay-row', { hasText: name }).click();
  const sheet = page.getByRole('dialog', { name });
  await sheet.locator('input[type="time"]').first().fill(start);
  await sheet.locator('input[type="time"]').nth(1).fill(finish);
  await sheet.getByRole('button', { name: brk, exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
}

test('timesheet first, then one invoice for the pay week', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay'));
  await expect(page.locator('.pay-weekcard')).toContainText('Pay week 9 to 15 Nov');
  await page.getByRole('button', { name: 'Open timesheet' }).click();

  // One row a job a day worked. Morley was clocked off with times saved, so it is ready.
  await expect(page.locator('.pay-row')).toHaveCount(4);
  await expect(page.locator('.pay-row', { hasText: 'Morley' })).toContainText('1:05 pm to 3:40 pm');
  await expect(page.locator('.pay-row.todo')).toHaveCount(2);

  await fillTimes(page, 'Wembley', '07:00', '14:00', '30 min');
  await expect(page.locator('.pay-row', { hasText: 'Wembley' })).toContainText('6.5 h');

  // A day that was booked but not worked is left off.
  await page.locator('.pay-row', { hasText: 'Joondalup' }).click();
  const sheet = page.getByRole('dialog', { name: 'Joondalup' });
  await sheet.getByRole('switch', { name: /Leave this off the invoice/ }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.pay-row.todo')).toHaveCount(0);

  await page.getByRole('button', { name: 'Review invoice' }).click();
  await expect(page.locator('.pay-cap').first()).toContainText('Hourly');
  await expect(page.getByText('You are paid, about')).toBeVisible();
  await expect(page.getByText('An estimate.')).toBeVisible();
  // Expenses and the group work order are shown, but outside what this invoice pays.
  await expect(page.locator('.pay-cap', { hasText: 'Expenses, repaid separately' })).toBeVisible();
  await expect(page.locator('.pay-cap', { hasText: 'Group work order' })).toContainText('Sent on its own');

  await page.getByRole('button', { name: 'Send invoice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Send/ }).click();
  await expect(page.getByRole('heading', { name: 'Invoice sent' })).toBeVisible();
  await expect(page.locator('.pay-sumrow.total')).toContainText('You are paid');

  // One invoice a week: the week now reads as sent, and it is under Invoices.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'View invoice' })).toBeVisible();
  await page.getByRole('button', { name: 'All invoices' }).click();
  await expect(page.locator('.pay-inv', { hasText: '9 to 15 Nov' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a job the trade worked but was not booked on can be added, and the server says how it is billed', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay/week/2026-11-09'));
  await page.getByRole('button', { name: 'Add a day or a job' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByPlaceholder('Suburb, name or job number').fill('scarborough');
  await sheet.getByRole('button', { name: /Scarborough/ }).click();
  await expect(sheet.getByText('Paid by the hour.')).toBeVisible();
  await sheet.getByRole('button', { name: /Wed/ }).click();
  await sheet.getByRole('button', { name: 'Add to this timesheet' }).click();
  await expect(page.locator('.pay-row', { hasText: 'Scarborough' })).toContainText('Add start and finish times');
  expect(errors).toEqual([]);
});

test('a job with no known pay type asks the office and stays off the invoice', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(() => {
    const ops = window.__crewDemo.ops; const real = ops.my_hours;
    ops.my_hours = (p) => { const r = real(p); r.assignments.forEach((a) => { if (a.jobs.job_number === 'SWD-26088') { a.invoice_mode = null; a.can_claim_commission = null; } }); return r; };
  });
  await page.evaluate(() => { location.hash = '#/pay/week/2026-11-09'; });
  const row = page.locator('.pay-row', { hasText: 'Wembley' });
  await expect(row).toContainText('Ask the office how this job is billed');
  await row.click();
  await expect(page.getByRole('dialog').locator('input')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the week is kept as the saved weekly draft, in the shape the Trade App reads', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay/week/2026-11-09'));
  await fillTimes(page, 'Wembley', '07:00', '14:00', '30 min');
  await expect(page.locator('.pay-note[role=status]')).toContainText('saved to your account', { timeout: 8000 });
  const card = await page.evaluate(() => window.__crewDemo.db.running['2026-11-09'].builder.jobCards.find((c) => c.site_suburb === 'Wembley'));
  expect(card).toMatchObject({ start_time: '07:00', finish_time: '14:00', break_minutes: 30, hours: 6.5, included: true, wo_mode: false });
  // Another phone: nothing kept locally, the account's draft fills the week.
  await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('crew:week:')).forEach((k) => localStorage.removeItem(k)); location.hash = '#/pay'; });
  await page.evaluate(() => { location.hash = '#/pay/week/2026-11-09'; });
  await expect(page.locator('.pay-row', { hasText: 'Wembley' })).toContainText('7:00 am to 2:00 pm');
  expect(errors).toEqual([]);
});

test('a trade sets their own rate for a job; above the office rate it says the office checks it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay'));
  await page.getByRole('button', { name: 'Open timesheet' }).click();

  await page.locator('.pay-row', { hasText: 'Wembley' }).click();
  const sheet = page.getByRole('dialog', { name: 'Wembley' });
  await sheet.locator('input[type="time"]').first().fill('07:00');
  await sheet.locator('input[type="time"]').nth(1).fill('14:00');
  await sheet.getByRole('button', { name: '30 min', exact: true }).click();
  await expect(sheet.getByText('Your office rate is $55.', { exact: false })).toBeVisible();
  await sheet.getByLabel('Your hourly rate').fill('70');
  await expect(sheet.getByText('Above your office rate of $55. The office checks it before it is paid.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save' }).click();

  await page.locator('.pay-row', { hasText: 'Joondalup' }).click();
  const off = page.getByRole('dialog', { name: 'Joondalup' });
  await off.getByRole('switch', { name: /Leave this off the invoice/ }).click();
  await off.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('button', { name: 'Review invoice' }).click();
  const wembley = page.locator('.pay-line', { hasText: 'Wembley' });
  await expect(wembley).toContainText('6.5 h at $70.00');
  await expect(wembley).toContainText('Above your office rate of $55.00. The office checks it before it is paid.');
  await expect(wembley).not.toHaveClass(/todo/);
  // A line at the office rate carries no such note, and the invoice can still be sent.
  await expect(page.locator('.pay-line', { hasText: 'Morley' })).not.toContainText('Above your office rate');
  await expect(page.getByRole('button', { name: 'Send invoice' })).toBeEnabled();
  expect(errors).toEqual([]);
});
