// Guards for INT-35 and INT-36 (Integrated Job Framework, doc 3 section 5).
//
// INT-35: a money figure that could not be read shows Unknown with its reason,
// never $0.00. A true zero still shows $0.00. ops-api's summary_error codes are
// in secureworks-backend docs/invoice-read-truth.md (#1166).
//  - a failed list_invoices read turns the Owed and Owed · past due cards Unknown;
//  - a summary whose open-invoice read failed (summary_error) says why;
//  - the invoice preview shows Unknown for a missing sub-total or tax, and $0.00
//    for a true zero tax.
// INT-36: the timeline's Sent step reads Xero's own sent flag (sent_to_contact).
// Until it is stored, the step says "Sent: not known" instead of looking unsent.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

function invoice(extra) {
  return Object.assign({
    xero_invoice_id: 'x-1',
    invoice_number: 'INV-7001',
    reference: 'SWF-7001',
    contact_name: 'Avery Lin',
    status: 'AUTHORISED',
    invoice_type: 'ACCREC',
    total: 1100,
    sub_total: 1000,
    total_tax: 100,
    amount_due: 1100,
    amount_paid: 0,
    date: '2026-10-20',
    due_date: '2099-01-01',
    line_items: [],
  }, extra);
}

async function bootOps(page, { responses = {}, failures = {} } = {}) {
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const action = match && match[1];
    if (action && failures[action]) {
      return route.fulfill({ status: failures[action], contentType: 'application/json', body: JSON.stringify({ error: 'e2e failure' }) });
    }
    const body = action && responses[action] ? responses[action] : (action === 'pipeline' ? { columns: {} } : {});
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(OPS_FILE);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
}

async function openInvoices(page) {
  await page.locator('.header-nav button[data-view="financials"]').click();
  await expect(page.locator('#viewFinancials')).toHaveClass(/active/);
}

function statValue(page, label) {
  return page.locator('#invoiceStats .stat-card', { has: page.locator('.stat-label', { hasText: new RegExp('^' + label + '$') }) }).locator('.stat-value');
}

test('a failed invoice read turns the Owed cards Unknown, never $0.00', async ({ page }) => {
  await bootOps(page, { failures: { list_invoices: 500 } });
  await openInvoices(page);
  await expect(statValue(page, 'Owed')).toHaveText('Unknown: invoices could not be read');
  await expect(statValue(page, 'Owed · past due')).toHaveText('Unknown: invoices could not be read');
  await expect(page.locator('#invoiceStats')).not.toContainText('$0.00');
});

test('a summary whose open-invoice read failed says why; a true zero stays $0.00', async ({ page }) => {
  await bootOps(page, { responses: { list_invoices: { invoices: [], total: 0, summary: { outstanding: null, overdue: null, total: 0, summary_error: 'open_invoice_read_incomplete' } } } });
  await openInvoices(page);
  await expect(statValue(page, 'Owed')).toHaveText('Unknown: not every open invoice was read');
  await expect(statValue(page, 'Owed · past due')).toHaveText('Unknown: not every open invoice was read');

  await page.evaluate(() => renderInvoiceStats({ outstanding: 0, overdue: 0, total: 0 }));
  await expect(statValue(page, 'Owed')).toHaveText('$0.00');
  await expect(statValue(page, 'Owed · past due')).toHaveText('$0.00');
});

test('the invoice preview shows Unknown for a missing sub-total or tax, and $0.00 for a true zero', async ({ page }) => {
  await bootOps(page);
  const preview = page.locator('#invoicePreviewModal');

  await page.evaluate((inv) => showGlobalInvoicePreview(inv), invoice({ sub_total: null, total_tax: undefined }));
  await expect(preview).toContainText(/Subtotal:\s*Unknown/);
  await expect(preview).toContainText(/GST:\s*Unknown/);
  await expect(preview).toContainText(/Total:\s*\$1,100\.00/);

  await page.evaluate((inv) => showGlobalInvoicePreview(inv), invoice({ sub_total: 1100, total_tax: 0 }));
  await expect(preview).toContainText(/Subtotal:\s*\$1,100\.00/);
  await expect(preview).toContainText(/GST:\s*\$0\.00/);
});

test('the Sent step reads Xero\'s sent flag, and says not known until it is stored', async ({ page }) => {
  await bootOps(page);
  const preview = page.locator('#invoicePreviewModal');

  await page.evaluate((inv) => showGlobalInvoicePreview(inv), invoice());
  await expect(preview.locator('[data-inv-sent-unknown]')).toHaveText('Sent: not known');

  await page.evaluate((inv) => showGlobalInvoicePreview(inv), invoice({ sent_to_contact: true }));
  await expect(preview.locator('[data-inv-sent-unknown]')).toHaveCount(0);
  await expect(preview).toContainText('✓ Sent');

  await page.evaluate((inv) => showGlobalInvoicePreview(inv), invoice({ sent_to_contact: false }));
  await expect(preview.locator('[data-inv-sent-unknown]')).toHaveCount(0);
  await expect(preview).not.toContainText('✓ Sent');
  await expect(preview).toContainText('Sent');
});
