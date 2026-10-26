// Guards for INT-37 (Integrated Job Framework, doc 3 section 5): a job money
// panel never shows $0 for a figure that is not on the record.
//  - a quote with no total in pricing_json reads Unknown; a true $0 quote reads $0.00;
//  - a PO with no total makes the PO sum "At least $X (1 PO with no total)", and
//    margin, gap and over/under are not worked out from it;
//  - the delete and void confirms name the amount, or say "amount unknown".
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

async function bootOps(page) {
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const body = match && match[1] === 'pipeline' ? { columns: {} } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(OPS_FILE);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
}

function jobData(pricing, pos) {
  return {
    job: { id: 'job-1', job_number: 'SWP-7001', client_name: 'Avery Lin', type: 'patio', status: 'accepted', pricing_json: pricing },
    purchase_orders: pos || [],
    invoices: [],
    documents: [],
  };
}

function moneyText(page, data) {
  return page.evaluate((d) => { renderMoneyView(d); return document.getElementById('jdMoney').textContent; }, data);
}

test('a quote with no total reads Unknown on the Money view; a true $0 quote reads $0.00', async ({ page }) => {
  await bootOps(page);

  const missing = await moneyText(page, jobData({ job_description: 'Patio' }));
  expect(missing).toContain('Quote ValueUnknown: no quote total');
  expect(missing).toContain('Still to InvoiceUnknown: no quote total');

  const zero = await moneyText(page, jobData({ totalIncGST: 0 }));
  expect(zero).toContain('Quote Value$0.00');
  expect(zero).toContain('Still to Invoice$0.00');

  const fencing = await moneyText(page, jobData({ totals: { total_inc_gst: 5500 } }));
  expect(fencing).toContain('Quote Value$5,500.00');
});

test('a PO with no total makes the PO sum "at least", and margin is not worked out', async ({ page }) => {
  await bootOps(page);
  const data = jobData({ totalIncGST: 10000, costEstimate: 6000 }, [
    { id: 'po-1', po_number: 'PO-1', supplier_name: 'Steel Co', total: 4000, status: 'authorised' },
    { id: 'po-2', po_number: 'PO-2', supplier_name: 'Roof Co', total: null, status: 'draft' },
  ]);

  const text = await moneyText(page, data);
  expect(text).toContain('PO Spend (Actual)At least $4,000.00 (1 PO with no total)');
  expect(text).toContain('Over or under not known yet');
  expect(text).toContain('Margin: Unknown (1 PO with no total)');
  expect(text).not.toContain('Under by');

  const gap = await page.evaluate((d) => renderScopeComparison(d.job, d.purchase_orders), data);
  expect(gap).toContain('At least $4,000.00 (1 PO with no total)');
  expect(gap).toContain('<strong>Gap:</strong> Unknown');

  // Every PO total known: margin and gap are worked out as before.
  data.purchase_orders[1].total = 0;
  const known = await moneyText(page, data);
  expect(known).toContain('PO Spend (Actual)$4,000.00');
  expect(known).toContain('Margin: 60%');
  expect(known).toContain('Under by $2,000.00');
});

test('the over-budget alert says "at least" while a PO has no total', async ({ page }) => {
  await bootOps(page);
  const data = jobData({ totalIncGST: 1000 }, [{ total: 1500 }, { total: null }]);
  const messages = await page.evaluate((d) => evaluateJobAlerts(d).map((a) => a.message), data);
  expect(messages).toContain('Over budget by at least $500.00');

  const none = await page.evaluate((d) => evaluateJobAlerts(d).map((a) => a.message), jobData({}, [{ total: 1500 }]));
  expect(none.join(' ')).not.toContain('Over budget');
});

test('the delete and void confirms name the amount, or say amount unknown', async ({ page }) => {
  await bootOps(page);
  const body = page.locator('#invActionBody');

  await page.evaluate(() => deleteInvoice('x-1', 'INV-7001', null));
  await expect(body).toContainText('INV-7001 (amount unknown) from Xero');

  await page.evaluate(() => voidInvoice('x-1', 'INV-7001', 0));
  await expect(body).toContainText('INV-7001 ($0.00) in Xero');

  await page.evaluate(() => voidInvoice('x-1', 'INV-7001', 1100));
  await expect(body).toContainText('INV-7001 ($1,100.00) in Xero');
});
