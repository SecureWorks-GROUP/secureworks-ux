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
  await expect(page.getByText('Paid to you', { exact: true })).toBeVisible();
  await expect(page.getByText('An estimate.', { exact: false })).toBeVisible();
  // Expenses and the group work order are shown, but outside what this invoice pays.
  await expect(page.locator('.pay-cap', { hasText: 'Expenses, repaid separately' })).toBeVisible();
  await expect(page.locator('.pay-cap', { hasText: 'Group work order' })).toContainText('Sent on its own');

  await page.getByRole('button', { name: 'Send invoice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Send/ }).click();
  await expect(page.getByRole('heading', { name: 'Invoice sent' })).toBeVisible();
  await expect(page.locator('.pay-sumrow.total')).toContainText('Paid to you');

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

test('ZZTEST sent invoice uses only server pay rows and optional tax guide', async ({ page }) => {
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(() => {
    const { db } = window.__crewDemo;
    db.me.name = 'Crew';
    db.invoices.push({ id: 'ZZTEST-pay', invoice_number: 'ZZTEST-001', status: 'paid', lines: [],
      pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 1120, paid_to_super: 120, paid_to_you: 1000,
        reimbursements: 0, gst: 0, repayment: null, into_bank: 1000, tax_set_aside: { percent: 20, amount: 200 } } });
    location.hash = '#/pay/invoice/ZZTEST-pay';
  });
  const rows = page.locator('.pay-sumrow');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveText('Total (includes super)$1,120.00');
  await expect(rows.nth(1)).toHaveText('Paid to your super fund$120.00');
  await expect(rows.nth(2)).toHaveText('Paid to you$1,000.00');
  await expect(rows.nth(3)).toContainText('Suggested to set aside for tax');
  await expect(rows.nth(3)).toContainText('$200.00');
  await expect(page.getByText('A guide only, not tax advice.')).toBeVisible();
  await expect(page.getByText('Into your bank account', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/taken off|withheld/i);
});

test('ZZTEST unavailable money keeps the week editable and Send disabled', async ({ page }) => {
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(() => {
    const ops = window.__crewDemo.ops; const original = ops.my_hours;
    ops.my_hours = (params) => ({ ...original(params), money_unavailable: true });
    location.hash = '#/pay/week/2026-11-09/invoice';
  });
  await expect(page.getByText('The pay figures could not be worked out right now. Your hours are saved. Try again in a minute.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send invoice' })).toBeDisabled();
  await expect(page.locator('.pay-sum')).toHaveCount(0);
});

const { setupReceiptWeek } = require('../helpers/crew-receipts');

test('ZZTEST receipt is selected without an amount box and sent as an id outside super', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await setupReceiptWeek(page);
  await expect(page.getByText('Paid to you', { exact: true }).locator('..')).toContainText('$500.00');
  await page.getByRole('button', { name: 'Add another item' }).click();
  await page.getByRole('button', { name: 'Reimbursement (receipt)', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Reimbursement (receipt)' });
  await expect(picker.locator('input')).toHaveCount(0);
  await expect(picker.getByRole('button', { name: /No photo/ })).toBeDisabled();
  await picker.getByRole('button', { name: /Supplier/ }).click();
  await expect(page.locator('.pay-cap').filter({ hasText: 'Reimbursements' })).toContainText('$80.00');
  await expect(page.getByText('Paid to you', { exact: true }).locator('..')).toContainText('$500.00');
  await expect(page.locator('.pay-sumrow').filter({ hasText: 'Into your bank account' })).toContainText('$580.00');
  // Real save and reopen of the demo server's saved weekly draft.
  await expect(page.locator('.pay-note[role=status]')).toContainText('saved to your account', { timeout: 8000 });
  await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('crew:week:')).forEach((k) => localStorage.removeItem(k)); location.hash = '#/jobs'; });
  await page.evaluate(() => { location.hash = '#/pay/week/2026-11-09/invoice'; });
  await expect(page.locator('.pay-cap').filter({ hasText: 'Reimbursements' })).toContainText('$80.00');
  await page.getByRole('button', { name: 'Send invoice', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoice sent' })).toBeVisible();
  await expect(page.getByText(/With the office: this receipt is waiting for approval/)).toBeVisible();
  const body = await page.evaluate(() => window.__crewDemo.db.receiptSubmitBody);
  expect(body.extra_items).toEqual([{ type: 'reimbursement', expense_receipt_id: 'receipt-zztest' }]);
  expect(errors).toEqual([]);
});

test('ZZTEST switch off hides the receipt choice', async ({ page }) => {
  await page.goto(crewUrl('#/jobs'));
  await setupReceiptWeek(page, { enabled: false });
  await page.getByRole('button', { name: 'Add another item' }).click();
  await expect(page.getByRole('button', { name: 'Reimbursement (receipt)', exact: true })).toHaveCount(0);
});

test('ZZTEST an office receipt change returns to review before any submit', async ({ page }) => {
  await page.goto(crewUrl('#/jobs'));
  await setupReceiptWeek(page);
  await page.getByRole('button', { name: 'Add another item' }).click();
  await page.getByRole('button', { name: 'Reimbursement (receipt)', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Supplier/ }).click();
  await page.evaluate(() => { window.__crewDemo.db.expenses[0].total_amount = 35; });
  await page.getByRole('button', { name: 'Send invoice', exact: true }).click();
  await expect(page.locator('.pay-cap').filter({ hasText: 'Reimbursements' })).toContainText('$35.00');
  expect(await page.evaluate(() => window.__crewDemo.db.receiptSubmitBody)).toBeUndefined();
});
