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
  // Super is withheld from TO BE PAID; both figures are server-owned and match the PDF.
  await expect(totals.locator('[data-weekly-invoice-super]')).toContainText('Less super (12%)-$577.61');
  await expect(totals.locator('[data-weekly-invoice-payable]')).toContainText('AMOUNT PAYABLE$4,235.79');
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

test.describe('weekly invoice response guards', () => {
  test('opens the clicked work order Perth week from the work-order hub', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();
    await page.getByRole('button', { name: 'My Work Orders' }).click();
    const priorCard = page.locator('[data-work-order-card]').filter({ hasText: 'WO-HENRY-PRIOR' });
    await priorCard.getByRole('button', { name: 'Add to Weekly Invoice' }).click();

    await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();
    await expect(page.locator('[data-weekly-work-order]')).toHaveCount(1);
    await expect(page.locator('[data-weekly-work-order="henry-wo-prior"]')).toBeVisible();
    await expect(page.locator('[data-weekly-work-order="henry-wo-prior"]').getByRole('checkbox', { name: /Include/ })).toBeChecked();
    await expect(page.getByText('1 of 1 work orders selected')).toBeVisible();
  });
});

test.describe('incomplete weekly draft save response', () => {
  test.use({ feedScenario: 'trade-weekly-work-order-invoice-incomplete-save' });

  test('does not authorize submit from a generic success response', async ({ appPage: page }) => {
    await openWeeklyInvoice(page);
    await enterInvoice31Deductions(page);
    await page.getByRole('button', { name: 'Save & calculate' }).click();

    await expect(page.locator('#toast')).toContainText('incomplete weekly invoice totals');
    await expect(page.locator('[data-weekly-invoice-preview]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeDisabled();
  });
});

[
  ['trade-weekly-work-order-invoice-selection-crew-mismatch', 'crew charge IDs'],
  ['trade-weekly-work-order-invoice-selection-labour-mismatch', 'direct labour hours'],
  ['trade-weekly-work-order-invoice-selection-final-mismatch', 'final deductions']
].forEach(([feedScenario, selection]) => {
  test.describe(`weekly preview with mismatched ${selection}`, () => {
    test.use({ feedScenario });

    test('keeps submit locked', async ({ appPage: page }) => {
      await openWeeklyInvoice(page);
      await enterInvoice31Deductions(page);
      await page.getByRole('button', { name: 'Save & calculate' }).click();

      await expect(page.locator('#toast')).toContainText('incomplete weekly invoice totals');
      await expect(page.locator('[data-weekly-invoice-preview]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeDisabled();
    });
  });
});

test.describe('incomplete persisted weekly invoice detail', () => {
  test.use({ feedScenario: 'trade-weekly-work-order-invoice-incomplete-detail' });

  test('shows totals unavailable without rendering partial money', async ({ appPage: page }) => {
    await openWeeklyInvoice(page);
    await page.evaluate(() => window.viewInvoiceDetail('henry-weekly-invoice-incomplete'));

    await expect(page.getByRole('heading', { name: 'Invoice Detail' })).toBeVisible();
    await expect(page.locator('[data-weekly-invoice-unavailable]')).toContainText('Totals are unavailable');
    await expect(page.locator('[data-weekly-invoice-preview]')).toHaveCount(0);
    await expect(page.locator('[data-weekly-invoice-totals]')).toHaveCount(0);
  });
});

test.describe('stale weekly draft save response', () => {
  test.use({ feedScenario: 'trade-weekly-work-order-invoice-stale-save' });

  test('keeps edited state dirty and reuses the saved draft identity', async ({ appPage: page, feedRequests }) => {
    await openWeeklyInvoice(page);
    await enterInvoice31Deductions(page);
    await page.getByRole('button', { name: 'Save & calculate' }).click();
    await page.getByRole('textbox', { name: 'Notes' }).fill('Changed while saving');
    await page.getByRole('textbox', { name: 'Notes' }).press('Tab');

    await expect(page.locator('#toast')).toContainText('changed while saving');
    await expect(page.locator('[data-weekly-invoice-preview]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeDisabled();

    await page.getByRole('button', { name: 'Save & calculate' }).click();
    await expect(page.locator('[data-weekly-invoice-totals]')).toContainText('TO BE PAID$4,813.40');
    const saves = feedRequests.filter((entry) => entry.method === 'POST' && entry.action === 'save_trade_invoice_draft');
    expect(saves).toHaveLength(2);
    expect(saves[1].body).toMatchObject({
      draft_id: 'henry-weekly-draft-31',
      notes: 'Changed while saving'
    });
  });

  test('ignores a save response after opening another invoice week', async ({ appPage: page }) => {
    await openWeeklyInvoice(page);
    await enterInvoice31Deductions(page);
    const saveResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.searchParams.get('action') === 'save_trade_invoice_draft';
    });
    await page.getByRole('button', { name: 'Save & calculate' }).click();
    await page.getByRole('button', { name: 'Previous invoice week' }).click();
    await expect(page.locator('[data-weekly-work-order="henry-wo-prior"]')).toBeVisible();
    await saveResponse;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await expect(page.getByText('1 of 1 work orders selected')).toBeVisible();
    await expect(page.locator('[data-weekly-invoice-preview]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeDisabled();
  });
});

test.describe('stale weekly submit response', () => {
  test.use({ feedScenario: 'trade-weekly-work-order-invoice-stale-submit' });

  test('does not replace a newer invoice week', async ({ appPage: page }) => {
    await openWeeklyInvoice(page);
    await enterInvoice31Deductions(page);
    await page.getByRole('button', { name: 'Save & calculate' }).click();
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeEnabled();

    const submitResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.searchParams.get('action') === 'generate_trade_invoice';
    });
    await page.getByRole('button', { name: 'Submit Invoice' }).click();
    await page.locator('#confirmOk').click();
    await page.getByRole('button', { name: 'Previous invoice week' }).click();
    await expect(page.locator('[data-weekly-work-order="henry-wo-prior"]')).toBeVisible();
    await submitResponse;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invoice Detail' })).toHaveCount(0);
    await expect(page.locator('[data-weekly-work-order="henry-wo-prior"]')).toBeVisible();
  });
});

test.describe('weekly crew loading after invoice edits', () => {
  test.use({ feedScenario: 'trade-weekly-work-order-invoice-crew-load-race' });

  test('finishes the state-bound crew read after the revision changes', async ({ appPage: page }) => {
    await openWeeklyInvoice(page);
    const fourthJob = page.locator('[data-weekly-work-order="henry-wo-4"]');
    const crewResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.searchParams.get('action') === 'trade_job_detail';
    });
    await fourthJob.getByRole('button', { name: 'Add labour deduction' }).click();
    await page.getByRole('textbox', { name: 'Notes' }).fill('Edited while crew loaded');
    await page.getByRole('textbox', { name: 'Notes' }).press('Tab');
    await crewResponse;

    await expect(fourthJob.getByRole('spinbutton', { name: 'Labour hours for Isaac' })).toBeVisible();
    await expect(fourthJob.getByText('Loading assigned crew...')).toHaveCount(0);
  });
});

test.describe('weekly save response with invoice identity only', () => {
  test.use({ feedScenario: 'trade-weekly-work-order-invoice-invoice-id-only' });

  test('submits using the persisted invoice identity', async ({ appPage: page, feedRequests }) => {
    await openWeeklyInvoice(page);
    await enterInvoice31Deductions(page);
    await page.getByRole('button', { name: 'Save & calculate' }).click();
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeEnabled();

    await page.getByRole('button', { name: 'Submit Invoice' }).click();
    await page.locator('#confirmOk').click();
    await expect(page.getByRole('heading', { name: 'Invoice Detail' })).toBeVisible();

    const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
    expect(submit.body.draft_id).toBe('henry-weekly-draft-31');
  });
});

test.describe('incomplete weekly generate response', () => {
  test.use({ feedScenario: 'trade-weekly-work-order-invoice-incomplete-generate' });

  test('does not inherit saved preview money or permit a duplicate submit', async ({ appPage: page }) => {
    await openWeeklyInvoice(page);
    await enterInvoice31Deductions(page);
    await page.getByRole('button', { name: 'Save & calculate' }).click();
    await expect(page.locator('[data-weekly-invoice-totals]')).toContainText('TO BE PAID$4,813.40');

    await page.getByRole('button', { name: 'Submit Invoice' }).click();
    await page.locator('#confirmOk').click();

    await expect(page.locator('#toast')).toContainText('Do not submit again');
    await expect(page.getByRole('heading', { name: 'My Invoices' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toHaveCount(0);
    await expect(page.locator('[data-weekly-invoice-totals]')).toHaveCount(0);
  });
});

test('clears stale server totals immediately when a final deduction changes', async ({ appPage: page }) => {
  await openWeeklyInvoice(page);
  await enterInvoice31Deductions(page);
  await page.getByRole('button', { name: 'Save & calculate' }).click();
  await expect(page.locator('[data-weekly-invoice-totals]')).toContainText('TO BE PAID$4,813.40');

  await page.getByRole('spinbutton', { name: 'Final deduction amount' }).fill('351');
  await page.getByRole('spinbutton', { name: 'Final deduction amount' }).press('Tab');

  await expect(page.locator('[data-weekly-invoice-totals]')).toHaveCount(0);
  await expect(page.getByText('Save and calculate to see server-confirmed job subtotals and TO BE PAID.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeDisabled();
  await expect(page.getByRole('spinbutton', { name: 'Final deduction amount' })).toHaveValue('351');
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

test.describe('per-metre manager with completed jobs but no work orders', () => {
  test.use({ feedScenario: 'trade-weekly-work-order-invoice-per-metre-jobs' });

  test('enters metres, the server creates the work order, and the week becomes saveable', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();

    // Before: nothing to invoice from, so no Save button, but no dead end either.
    await expect(page.getByText('No completed work orders available for this week')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save & calculate' })).toHaveCount(0);
    const candidates = page.locator('[data-weekly-job-candidates]');
    await expect(candidates).toContainText('Completed jobs without a work order');
    await expect(candidates.locator('[data-weekly-job-candidate]')).toHaveCount(2);
    await expect(candidates).toContainText('$35.00/m');

    // Scoped length prefills; the trade confirms what was actually installed.
    const firstJob = candidates.locator('[data-weekly-job-candidate="henry-pm-job-1"]');
    const metres = firstJob.getByRole('spinbutton', { name: 'Metres installed for SWF-26869' });
    await expect(metres).toHaveValue('12');
    await expect(firstJob).toContainText('Scoped at 12m');

    // Zero metres is refused in the browser before any write.
    const secondJob = candidates.locator('[data-weekly-job-candidate="henry-pm-job-2"]');
    await expect(secondJob.getByRole('spinbutton', { name: 'Metres installed for SWF-261060' })).toHaveValue('');
    await secondJob.getByRole('button', { name: 'Add to weekly invoice' }).click();
    await expect(page.locator('#toast')).toContainText('Enter the metres installed on SWF-261060 first');
    expect(feedRequests.some((entry) => entry.action === 'create_weekly_job_work_order')).toBe(false);

    await metres.fill('12.5');
    await metres.press('Tab');
    await firstJob.getByRole('button', { name: 'Add to weekly invoice' }).click();
    await expect(page.locator('#toast')).toContainText('Work order added — 12.5m = $437.50');

    const create = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'create_weekly_job_work_order');
    expect(create).toBeTruthy();
    expect(create.body).toMatchObject({ job_id: 'henry-pm-job-1', metres: 12.5 });
    expect(create.body).not.toHaveProperty('rate');
    expect(create.body).not.toHaveProperty('amount_ex');

    // After: the created work order is a normal weekly card with the crew charge,
    // and the server-calculated Save path is back.
    await expect(page.locator('[data-weekly-work-order="henry-wo-pm-1"]')).toBeVisible();
    await expect(page.getByText('1 of 1 work orders selected')).toBeVisible();
    await expect(page.locator('#hoursContent')).toContainText('Fencing installation');
    await expect(page.locator('#hoursContent')).toContainText('12.5 m @ $35.00');
    await expect(page.locator('#hoursContent')).toContainText('Work order $1477.00');
    await expect(page.locator('#hoursContent')).toContainText('-$120.00');
    await expect(page.getByRole('button', { name: 'Save & calculate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save & calculate' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeDisabled();

    // The job now offers a re-measure; the other job still offers creation.
    await expect(candidates.getByRole('button', { name: 'Update metres' })).toHaveCount(1);
    await expect(candidates.getByRole('button', { name: 'Add to weekly invoice' })).toHaveCount(1);
    expect(feedRequests.some((entry) => entry.action === 'submit_trade_invoice')).toBe(false);
  });
});
