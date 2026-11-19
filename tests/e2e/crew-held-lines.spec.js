// SecureWorks Crew: a trade's own lines that wait on the office (P1-05.13 / F1,
// trade_line_hold_v1). On the demo server, with its send and invoice reads wrapped
// to answer the held fields the switch adds. Made-up ZZTEST ids and amounts only.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use({ ...PHONE, browserName: process.env.CI ? 'chromium' : 'webkit' });
const FORBIDDEN = /taken off|deducted|deduction|over_amount|no_job|hold_reason|awaiting|null|undefined|\$999/i;
const HELD_ID = 'ZZTEST-held-inv-1';

async function sendWeek(page) {
  await page.goto(crewUrl('#/pay/week/2026-11-09'));
  await page.locator('.pay-row', { hasText: 'Wembley' }).click();
  let sheet = page.getByRole('dialog', { name: 'Wembley' });
  await sheet.locator('input[type="time"]').first().fill('07:00');
  await sheet.locator('input[type="time"]').nth(1).fill('14:00');
  await sheet.getByRole('button', { name: '30 min', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await page.locator('.pay-row', { hasText: 'Joondalup' }).click();
  sheet = page.getByRole('dialog', { name: 'Joondalup' });
  await sheet.getByRole('switch', { name: /Leave this off the invoice/ }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Review invoice' }).click();
  await page.getByRole('button', { name: 'Send invoice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Send/ }).click();
}

const HELD_LINES = [
  { id: 'ZZTEST-hl-1', line_type: 'labour', job_number: 'SWF-ZZ01', description: 'Labour', work_date: '2026-11-10', total_hours: 4, hourly_rate: 40, line_total_ex: 160, sent_amount_ex: 160, hold_reason: 'over_amount', hold_detail: { left_ex: 999 }, office_review_status: 'awaiting' },
  { id: 'ZZTEST-hl-2', line_type: 'travel', job_number: null, description: 'ZZTEST drive', line_total_ex: 40, sent_amount_ex: 40, hold_reason: 'no_job', office_review_status: 'awaiting' }
];

/**
 * Wrap the demo's send and invoice reads with the held fields, on every page load
 * (the demo server is patched as it is made). The holding invoice's lines live in
 * sessionStorage, so a test can play the office's decision and reload.
 * allHeld: no pay invoice is made.
 */
async function holdLines(page, { allHeld = false } = {}) {
  await page.addInitScript(({ HELD_ID, allHeld, lines }) => {
    if (!sessionStorage.getItem('ZZHELD')) sessionStorage.setItem('ZZHELD', JSON.stringify(lines));
    let demo;
    Object.defineProperty(window, '__crewDemo', { configurable: true, get: () => demo, set(v) {
      demo = v;
      const { ops } = v;
      const send = ops.generate_trade_invoice; const read = ops.get_trade_invoice;
      ops.generate_trade_invoice = (p, b) => {
        const res = send(p, b);
        const held = { send: { send_id: 'ZZTEST-send', sent_ex: 700, in_pay_ex: allHeld ? 0 : 500, held_ex: 200, declined_ex: 0 },
          held_lines: [
            { line_id: 'ZZTEST-hl-1', job_number: 'SWF-ZZ01', reason: 'over_amount', words: 'With the office: $999.00 was left, so $160.00 is waiting.', amount_ex: 160 },
            { line_id: 'ZZTEST-hl-2', job_number: null, reason: 'no_job', words: 'With the office: this line is not on a job.', amount_ex: 40 }],
          held_invoice_id: HELD_ID, send_words: 'Sent. $999.00' };
        return allHeld ? { ok: true, success: true, invoice_id: null, invoice_number: null, total_hours: 0, line_count: 0, xero_bill_id: null, ...held } : { ...res, ...held };
      };
      ops.get_trade_invoice = (p) => (p.invoice_id === HELD_ID
        ? { invoice: { id: HELD_ID, invoice_kind: 'held', status: 'pending_ops_review', invoice_number: 'ZZTEST-INV-H', week_start: '2026-11-09', week_end: '2026-11-15', gross_earned: 0, lines: JSON.parse(sessionStorage.getItem('ZZHELD')) } }
        : read(p));
    } });
  }, { HELD_ID, allHeld, lines: HELD_LINES });
}

test('switch off: Pay, the sent screen and an invoice look exactly as before', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay'));
  await expect(page.locator('.pay-weekcard')).toBeVisible();
  await expect(page.locator('[data-held-pay]')).toHaveCount(0);
  await expect(page.getByText('With the office', { exact: true })).toHaveCount(0);
  await sendWeek(page);
  await expect(page.getByRole('heading', { name: 'Invoice sent' })).toBeVisible();
  await expect(page.locator('[data-held-split], [data-held-lines]')).toHaveCount(0);
  await expect(page.getByText('It is with the bookkeeper. You are paid on the usual pay run.')).toBeVisible();
  await page.getByRole('button', { name: 'View invoice' }).click();
  await expect(page.locator('[data-held-invoice], [data-held-follow-on]')).toHaveCount(0);
  await expect(page.getByText('Waiting on office')).toHaveCount(0);
  await page.goto(crewUrl('#/pay'));
  await expect(page.locator('.pay-weekcard')).toBeVisible();
  await expect(page.locator('[data-held-pay]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a split send: in pay, waiting on office and each held line in plain words, then the lines and Pay', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await holdLines(page);
  await page.goto(crewUrl('#/pay'));
  await sendWeek(page);
  await expect(page.getByRole('heading', { name: 'Invoice sent' })).toBeVisible();
  await expect(page.getByText('Some lines are waiting on the office. The rest is in your pay.')).toBeVisible();
  const split = page.locator('[data-held-split]');
  await expect(split.locator('.pay-sumrow').nth(0)).toHaveText(/In pay\s*\$500\.00/);
  await expect(split.locator('.pay-sumrow').nth(1)).toHaveText(/Waiting on office\s*\$200\.00/);
  await expect(split.locator('.pay-sumrow')).toHaveCount(2);
  const held = page.locator('[data-held-lines]');
  await expect(held.locator('.pay-line')).toHaveCount(2);
  await expect(held).toContainText('This line is more than the job\'s work order has left, so the office checks it first.');
  await expect(held).toContainText('No job');
  await expect(held).toContainText('This line is not on a job, so the office checks it first.');
  for (const text of [await split.innerText(), await held.innerText()]) expect(text).not.toMatch(FORBIDDEN);
  await page.screenshot({ path: testInfo.outputPath('ZZTEST-crew-held-sent.png'), fullPage: true });

  await page.getByRole('button', { name: 'See the lines with the office' }).click();
  await expect(page.locator('[data-held-invoice]')).toHaveText('These lines are waiting on the office. They are not in your pay until the office approves them.');
  await expect(page.locator('.pay-cap', { hasText: 'Waiting on office' })).toBeVisible();
  await expect(page.locator('.pay-line')).toHaveCount(2);
  await expect(page.locator('.pay-sumrow')).toHaveCount(0);
  expect(await page.locator('.page, main, body').first().innerText()).not.toMatch(FORBIDDEN);
  await page.screenshot({ path: testInfo.outputPath('ZZTEST-crew-held-invoice.png'), fullPage: true });

  // The office approves one (it moves to a follow-on) and declines the other: Pay says what is left, from a fresh read.
  await page.evaluate(() => {
    sessionStorage.setItem('ZZHELD', JSON.stringify([{ id: 'ZZTEST-hl-2', line_type: 'travel', description: 'ZZTEST drive', line_total_ex: 40, sent_amount_ex: 40, hold_reason: 'no_job', office_review_status: 'rejected', office_review_note: 'ZZTEST not company work' }]));
    for (const k of Object.keys(localStorage)) if (k.includes('held:pay:') || k.includes('invoice:ZZTEST-held')) localStorage.removeItem(k);
  });
  await page.reload();
  await expect(page.locator('[data-held-invoice]')).toBeVisible();
  await page.goto(crewUrl('#/pay'));
  const row = page.locator('[data-held-pay] [data-held-row]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('9 to 15 Nov');
  await row.click();
  await expect(page.locator('[data-held-invoice]')).toHaveText('The office did not approve these lines, so they are not paid.');
  await expect(page.locator('.pay-cap', { hasText: 'Not approved' })).toBeVisible();
  await expect(page.locator('.pay-line')).toContainText('Office: ZZTEST not company work');
  expect(errors).toEqual([]);
});

test('every line held: no pay invoice, no pay figures, only what waits on the office', async ({ page }) => {
  const errors = watchErrors(page);
  await holdLines(page, { allHeld: true });
  await page.goto(crewUrl('#/pay'));
  await sendWeek(page);
  await expect(page.getByRole('heading', { name: 'Sent to the office' })).toBeVisible();
  await expect(page.getByText('Every line is waiting on the office, so nothing is in this week\'s pay yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View invoice' })).toHaveCount(0);
  await expect(page.getByText('The office system did not send the figures back.', { exact: false })).toHaveCount(0);
  await expect(page.locator('[data-held-split] .pay-sumrow').first()).toHaveText(/In pay\s*\$0\.00/);
  expect(errors).toEqual([]);
});

test('a follow-on invoice says the office approved its lines later, and names a change', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(() => {
    window.__crewDemo.db.invoices.push({ id: 'ZZTEST-fo-1', user_id: window.__crewDemo.db.invoices[0]?.user_id, invoice_kind: 'follow_on', status: 'pending_ops_review',
      invoice_number: 'ZZTEST-INV-F1', week_start: '2026-11-02', week_end: '2026-11-08', gross_earned: 120, created_at: '2026-11-12T00:00:00Z', submitted_at: '2026-11-12T00:00:00Z',
      lines: [{ id: 'ZZTEST-fl-1', line_type: 'labour', job_number: 'SWF-ZZ02', description: 'Labour', work_date: '2026-11-03', total_hours: 3, hourly_rate: 40, line_total_ex: 120, sent_amount_ex: 160,
        hold_reason: 'over_amount', office_review_status: 'approved', office_review_note: 'ZZTEST one hour less', office_change_reason: 'ZZTEST one hour less' }] });
  });
  await page.goto(crewUrl('#/pay/invoice/ZZTEST-fo-1'));
  await expect(page.locator('[data-held-follow-on]')).toHaveText('The office approved these lines after you sent your week. They are paid on this invoice.');
  const line = page.locator('.pay-line', { hasText: 'SWF-ZZ02' });
  await expect(line).toContainText('The office changed this line: ZZTEST one hour less');
  await expect(line).toContainText('You sent $160.00');
  expect(await line.innerText()).not.toMatch(/taken off|deducted/i);
  expect(errors).toEqual([]);
});
