const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({
  persona: 'installer',
  feedScenario: 'trade-invoice-super-gst',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
});

async function installPdfRecorder(page) {
  await page.evaluate(() => {
    window.__invoicePdfText = [];
    window.__invoicePdfSaved = null;
    class FakeJsPdf {
      setFillColor() {}
      rect() {}
      setTextColor() {}
      setFontSize() {}
      setFont() {}
      text(value) { window.__invoicePdfText.push(String(value)); }
      setDrawColor() {}
      setLineWidth() {}
      line() {}
      addPage() {}
      output() { return 'data:application/pdf;base64,JVBERi1QRVJTSVNURUQ='; }
      save(name) { window.__invoicePdfSaved = name; }
    }
    window.jspdf = { jsPDF: FakeJsPdf };
  });
}

test('shows earned less super and net pay, and submits the saved GST choice', async ({ appPage: page, feedRequests }, testInfo) => {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const money = page.locator('[data-invoice-money-summary]');
  await expect(money).toContainText('Earned$400.00');
  await expect(money).toContainText('Less super (12%)−$48.00');
  await expect(money).toContainText('Net pay$352.00');
  await expect(money).toContainText('Estimate — SecureWorks confirms these figures when you submit.');

  const gstSwitch = page.getByRole('switch', { name: 'Add GST to this invoice' });
  await expect(gstSwitch).toHaveAttribute('aria-checked', 'false');
  await gstSwitch.click();
  await expect(gstSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-invoice-gst-state]')).toHaveText('On');

  const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  await card.getByRole('button', { name: 'Work Order' }).click();
  await card.locator('[data-cardwoalloc]').fill('559.50');
  await card.locator('[data-cardwoalloc]').press('Tab');
  await card.getByRole('button', { name: '+ Add labour line' }).click();
  await card.locator('[data-cardwollname]').fill('Tendo');
  await card.locator('[data-cardwollname]').press('Tab');
  await card.locator('[data-cardwollhours]').fill('11.5');
  await card.locator('[data-cardwollhours]').press('Tab');
  await card.locator('[data-cardwollrate]').fill('25');
  await card.locator('[data-cardwollrate]').press('Tab');

  await expect(money).toContainText('Earned$272.00');
  await expect(money).toContainText('Less super (12%)−$32.64');
  await expect(money).toContainText('Net pay$239.36');

  const builderScreenshot = testInfo.outputPath('trade-invoice-money-builder.png');
  await page.locator('#hoursContent').screenshot({ path: builderScreenshot });
  await testInfo.attach('Trade invoice money builder', { path: builderScreenshot, contentType: 'image/png' });

  await installPdfRecorder(page);
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmOk').click();

  const submitted = page.locator('[data-invoice-money-summary]');
  await expect(page.getByText('Invoice Submitted')).toBeVisible();
  await expect(submitted).toContainText('Earned$272.00');
  await expect(submitted).toContainText('Less super (12%)−$32.64');
  await expect(submitted).toContainText('Net pay$239.36');
  await expect(submitted).toContainText('GST$23.94');
  await expect(submitted).toContainText('Invoice total$263.30');
  await expect(submitted).not.toContainText('Estimate');
  await expect(page.getByText('2 line items', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();

  const pdfText = await page.evaluate(() => window.__invoicePdfText);
  expect(pdfText).toContain('Persisted reconciled work order');
  expect(pdfText).toContain('0.00');
  expect(pdfText).toContain('$0.00');

  const submittedScreenshot = testInfo.outputPath('trade-invoice-money-submitted.png');
  await page.locator('#hoursContent').screenshot({ path: submittedScreenshot });
  await testInfo.attach('Trade invoice persisted money summary', { path: submittedScreenshot, contentType: 'image/png' });

  const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
  expect(submit).toBeTruthy();
  expect(submit.body.gst_on).toBe(true);
  expect(submit.body).not.toHaveProperty('super_rate');
  expect(submit.body).not.toHaveProperty('super_amount');
  expect(submit.body).not.toHaveProperty('gross_earned');
  expect(submit.body).not.toHaveProperty('net_pay');
  const attach = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'attach_invoice_pdf');
  expect(attach).toBeTruthy();
  expect(attach.body.xero_bill_id).toBe('xero-e2e-super-gst');
});

test('installer Hours cards can add lump-sum amounts as a peer to hours', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  await expect(card.locator('[data-cardhours]')).toBeVisible();
  await expect(card.getByRole('button', { name: '+ Add amount' })).toBeVisible();
  await expect(page.getByText('Lump-sum amounts')).toHaveCount(0);
  await expect(page.locator('#btnAddInvLump')).toBeVisible();
  await expect(page.locator('#btnAddInvLump')).toHaveText('+ Add amount');

  await card.getByRole('button', { name: '+ Add amount' }).click();
  await card.locator('[data-cardlumpdesc]').fill('Materials');
  await card.locator('[data-cardlumpamt]').fill('25');
  await card.locator('[data-cardlumpamt]').press('Tab');
  await expect(card.locator('[data-cardamt]')).toHaveText('$375.00');

  const money = page.locator('[data-invoice-money-summary]');
  await expect(money).toContainText('Earned$375.00');

  const gstSwitch = page.getByRole('switch', { name: 'Add GST to this invoice' });
  await gstSwitch.click();
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmOk').click();
  await expect(page.getByText('Invoice Submitted')).toBeVisible();

  const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
  expect(submit).toBeTruthy();
  const lump = (submit.body.extra_items || []).find((item) => item.source === 'invoice_final_deduction');
  expect(lump).toBeFalsy();
  expect(submit.body.final_deductions).toEqual([
    { description: 'Materials', quantity: 1, unit: 'ea', unit_rate: 25 }
  ]);
  expect(submit.body.manual_assignments).toEqual([
    expect.objectContaining({
      assignment_id: 'e2e-wo-holder-assignment',
      hours: 8,
      rate: 50
    })
  ]);
});

test.describe('submitted response has incomplete authoritative money', () => {
  test.use({ feedScenario: 'trade-invoice-super-gst-incomplete' });

  async function openBuilder(page, legacy) {
    await signIn(page, PERSONAS.installer);
    if (legacy) await page.evaluate(() => localStorage.setItem('sw_jobcentric', '0'));
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
  }

  async function expectUnavailableWithoutPdf(page, feedRequests) {
    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    await expect(page.getByText('Submitted invoice totals are unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
    expect(feedRequests.some((entry) => entry.action === 'attach_invoice_pdf')).toBe(false);
  }

  test('job-centric success shows unavailable and does not expose or attach a PDF', async ({ appPage: page, feedRequests }) => {
    await openBuilder(page, false);
    await expectUnavailableWithoutPdf(page, feedRequests);
  });

  test('legacy success shows unavailable instead of its browser preview total', async ({ appPage: page, feedRequests }) => {
    await openBuilder(page, true);
    await expectUnavailableWithoutPdf(page, feedRequests);
  });
});

test.describe('submitted response has complete money but no persisted lines', () => {
  test.use({ feedScenario: 'trade-invoice-super-gst-missing-lines' });

  for (const legacy of [false, true]) {
    test(`${legacy ? 'legacy' : 'job-centric'} success suppresses the PDF`, async ({ appPage: page, feedRequests }) => {
      await signIn(page, PERSONAS.installer);
      if (legacy) await page.evaluate(() => localStorage.setItem('sw_jobcentric', '0'));
      await page.locator('[data-view="hours"]').click();
      await page.getByRole('button', { name: /Weekly Invoice/ }).click();
      await page.getByRole('button', { name: 'Continue' }).click();

      await page.locator('#invSubmitBtn').click();
      await page.locator('#confirmOk').click();

      await expect(page.getByText('Invoice Submitted')).toBeVisible();
      await expect(page.locator('[data-invoice-money-summary]')).toContainText('Net pay$352.00');
      await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
      expect(feedRequests.some((entry) => entry.action === 'attach_invoice_pdf')).toBe(false);
    });
  }
});

test.describe('submitted response has incomplete persisted lines', () => {
  test.use({ feedScenario: 'trade-invoice-super-gst-incomplete-lines' });

  for (const legacy of [false, true]) {
    test(`${legacy ? 'legacy' : 'job-centric'} success suppresses the PDF`, async ({ appPage: page, feedRequests }) => {
      await signIn(page, PERSONAS.installer);
      if (legacy) await page.evaluate(() => localStorage.setItem('sw_jobcentric', '0'));
      await page.locator('[data-view="hours"]').click();
      await page.getByRole('button', { name: /Weekly Invoice/ }).click();
      await page.getByRole('button', { name: 'Continue' }).click();

      await page.locator('#invSubmitBtn').click();
      await page.locator('#confirmOk').click();

      await expect(page.getByText('Invoice Submitted')).toBeVisible();
      await expect(page.locator('[data-invoice-money-summary]')).toContainText('Net pay$352.00');
      await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
      expect(feedRequests.some((entry) => entry.action === 'attach_invoice_pdf')).toBe(false);
    });
  }
});

test.describe('unknown submit response', () => {
  test.use({ feedScenario: 'trade-invoice-super-gst-empty-response' });

  for (const legacy of [false, true]) {
    test(`${legacy ? 'legacy' : 'job-centric'} invoice stays editable`, async ({ appPage: page, feedRequests }) => {
      await signIn(page, PERSONAS.installer);
      if (legacy) await page.evaluate(() => localStorage.setItem('sw_jobcentric', '0'));
      await page.locator('[data-view="hours"]').click();
      await page.getByRole('button', { name: /Weekly Invoice/ }).click();
      await page.getByRole('button', { name: 'Continue' }).click();

      await page.locator('#invSubmitBtn').click();
      await page.locator('#confirmOk').click();

      await expect(page.locator('#toast')).toContainText('Invoice submission failed');
      await expect(page.getByText('Invoice Submitted')).toHaveCount(0);
      await expect(page.locator('#invSubmitBtn')).toBeVisible();
      expect(feedRequests.some((entry) => entry.action === 'attach_invoice_pdf')).toBe(false);
    });
  }
});

test.describe('durably saved invoice with failed Xero push', () => {
  test.use({ feedScenario: 'trade-invoice-super-gst-xero-failed' });

  for (const legacy of [false, true]) {
    test(`${legacy ? 'legacy' : 'job-centric'} path accepts saved identity and names pending sync`, async ({ appPage: page }) => {
      await signIn(page, PERSONAS.installer);
      if (legacy) await page.evaluate(() => localStorage.setItem('sw_jobcentric', '0'));
      await page.locator('[data-view="hours"]').click();
      await page.getByRole('button', { name: /Weekly Invoice/ }).click();
      await page.getByRole('button', { name: 'Continue' }).click();

      await page.locator('#invSubmitBtn').click();
      await page.locator('#confirmOk').click();

      await expect(page.getByText('Invoice Saved', { exact: true })).toBeVisible();
      await expect(page.getByText(/Invoice saved — Xero sync pending/)).toBeVisible();
      await expect(page.getByText(/Xero unavailable/)).toBeVisible();
      await expect(page.getByText('Invoice Submitted')).toHaveCount(0);
      await expect(page.locator('#invSubmitBtn')).toHaveCount(0);
    });
  }
});
