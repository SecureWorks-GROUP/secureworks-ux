const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'fencing_manager', feedScenario: 'trade-weekly-work-order-invoice' });

const EXPECTED_SUBTOTALS = [
  '$164.60', '$244.20', '$48.60', '$2,510.00', '$274.00',
  '$35.00', '$842.00', '$640.00', '$405.00'
];

async function openWeeklyInvoice(page) {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();
  await expect(page.locator('[data-weekly-work-order]')).toHaveCount(9);
}

async function enterInvoice31Deductions(page) {
  const fourthJob = page.locator('[data-weekly-work-order="henry-wo-4"]');
  await fourthJob.getByRole('button', { name: 'Add labour deduction' }).click();
  await fourthJob.getByRole('spinbutton', { name: 'Labour hours for Isaac' }).fill('26');
  await fourthJob.getByRole('spinbutton', { name: 'Labour hours for Isaac' }).press('Tab');

  await page.getByRole('button', { name: 'Add final deduction' }).click();
  await page.getByRole('textbox', { name: 'Final deduction description' }).fill('Car Loan');
  await page.getByRole('spinbutton', { name: 'Final deduction amount' }).fill('350');
  await page.getByRole('spinbutton', { name: 'Final deduction amount' }).press('Tab');
}

test('builds invoice #31 from source selections and renders only server-calculated totals', async ({ appPage: page, feedRequests }, testInfo) => {
  await openWeeklyInvoice(page);

  await expect(page.getByText('9 of 9 work orders selected')).toBeVisible();
  await expect(page.getByText('Save and calculate to see server-confirmed job subtotals and TO BE PAID.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeDisabled();
  await expect(page.locator('#hoursContent')).toContainText('Work Order - Israel');
  await expect(page.locator('#hoursContent')).toContainText('-$486.40');

  await enterInvoice31Deductions(page);
  await page.getByRole('button', { name: 'Save & calculate' }).click();
  await expect(page.locator('#toast')).toContainText('totals calculated by SecureWorks');

  const preview = page.locator('[data-weekly-invoice-preview]');
  await expect(preview.locator('[data-weekly-job-block]')).toHaveCount(9);
  for (const subtotal of EXPECTED_SUBTOTALS) {
    await expect(preview.getByText(subtotal, { exact: true })).toBeVisible();
  }
  const totals = page.locator('[data-weekly-invoice-totals]');
  await expect(totals).toContainText('Grand total$5,163.40');
  await expect(totals).toContainText('Final deductions-$350.00');
  await expect(totals).toContainText('TO BE PAID$4,813.40');
  await expect(page.getByText('Car Loan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeEnabled();

  const screenshot = testInfo.outputPath('henry-weekly-invoice-31-calculated.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Henry weekly invoice #31 calculated', { path: screenshot, contentType: 'image/png' });

  const save = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'save_trade_invoice_draft');
  expect(save).toBeTruthy();
  expect(save.body).toMatchObject({
    gst_on: false,
    work_order_blocks: expect.arrayContaining([
      expect.objectContaining({
        work_order_id: 'henry-wo-4',
        labour_deductions: [{ user_id: 'henry-isaac', hours: 26 }]
      })
    ]),
    final_deductions: [{ description: 'Car Loan', quantity: 1, unit: 'ea', unit_rate: 350 }]
  });
  expect(save.body.work_order_blocks).toHaveLength(9);
  expect(save.body).not.toHaveProperty('grand_total');
  expect(save.body).not.toHaveProperty('to_be_paid');
  expect(save.body).not.toHaveProperty('gross_earned');
  expect(save.body.work_order_blocks[3].labour_deductions[0]).not.toHaveProperty('rate');

  await page.getByRole('button', { name: 'Submit Invoice' }).click();
  await expect(page.locator('#confirmMsg')).toContainText('$4,813.40');
  await page.locator('#confirmOk').click();
  await expect(page.locator('#toast')).toContainText('Invoice submitted to Xero as a draft bill');
  await expect(page.getByRole('heading', { name: 'Invoice Detail' })).toBeVisible();
  await expect(page.locator('[data-weekly-invoice-totals]')).toContainText('TO BE PAID$4,813.40');

  const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
  expect(submit).toBeTruthy();
  expect(submit.body.draft_id).toBe('henry-weekly-draft-31');
  expect(submit.body).not.toHaveProperty('grand_total');
  expect(submit.body).not.toHaveProperty('to_be_paid');
  expect(feedRequests.some((entry) => entry.action === 'submit_trade_invoice')).toBe(false);
  expect(feedRequests.some((entry) => entry.action === 'submit_work_order_invoice')).toBe(false);
});

test('reopens the server-owned weekly draft without flattening its work-order blocks', async ({ appPage: page, feedRequests }) => {
  await openWeeklyInvoice(page);
  await enterInvoice31Deductions(page);
  await page.getByRole('button', { name: 'Save & calculate' }).click();
  await expect(page.locator('[data-weekly-invoice-totals]')).toContainText('TO BE PAID$4,813.40');

  await page.evaluate(() => window.openInvoiceDraft('henry-weekly-draft-31'));
  await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();
  await expect(page.locator('[data-weekly-job-block]')).toHaveCount(9);
  await expect(page.locator('[data-weekly-invoice-totals]')).toContainText('Grand total$5,163.40');
  await expect(page.getByRole('spinbutton', { name: 'Labour hours for Isaac' })).toHaveCount(0);

  const detailRead = feedRequests.find((entry) => entry.method === 'GET' && entry.action === 'get_trade_invoice');
  expect(detailRead).toBeTruthy();
  const workOrderReads = feedRequests.filter((entry) => entry.method === 'GET' && entry.action === 'my_work_orders');
  expect(workOrderReads.length).toBeGreaterThanOrEqual(2);
});

test.describe('mobile weekly invoice', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('keeps all source controls and server totals usable at installer phone width', async ({ appPage: page }) => {
    await openWeeklyInvoice(page);
    await enterInvoice31Deductions(page);
    await page.getByRole('button', { name: 'Save & calculate' }).click();
    await expect(page.locator('[data-weekly-invoice-totals]')).toContainText('TO BE PAID$4,813.40');
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeVisible();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(horizontalOverflow).toBe(false);
  });
});
