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
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();

  const pdfText = await page.evaluate(() => window.__invoicePdfText);
  expect(pdfText).toContain('Persisted reconciled work order');

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
