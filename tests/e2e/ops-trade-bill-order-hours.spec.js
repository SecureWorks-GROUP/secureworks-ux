// Trade Bills row order and Hours cell (7 Nov 2026). Stuck invoices (the rows
// offered Clear stuck invoice) come first, oldest week first, then invoices
// waiting on Approve, then every other row in the server's order. An invoice
// that saved its own hours as 0 shows the hours its hourly lines carry; a
// per-item line (work order, commission) never counts as hours. Search
// `// <trade-bill-order-hours>` in ops.html. Fixture data only: no live request.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

// Shapes as list_trade_invoices sends them: older labour lines have no unit
// and carry their hours in total_hours; newer ones say unit hr with quantity.
const labour = (h) => ({ line_type: 'labour', unit: null, total_hours: h, hourly_rate: 40, line_total_ex: h * 40, quantity: null });
const workOrder = { line_type: 'work order', unit: 'ea', total_hours: 1, quantity: 1, unit_rate: 300, line_total_ex: 300 };
const commission = { line_type: 'commission', unit: 'ea', total_hours: 2, quantity: 2, line_total_ex: 50 };

// Server order: newest week first, the stuck ones last.
const LIST = [
  { id: 'inv-paid-new', users: { name: 'Paid New' }, week_start: '2026-10-26', total_hours: 7.5, total_inc: 300, status: 'paid', lines: [labour(7.5)] },
  { id: 'inv-review', users: { name: 'Review Trade' }, week_start: '2026-10-19', total_hours: 8, total_inc: 320, status: 'pending_ops_review', lines: [labour(8)] },
  { id: 'inv-paid-zero', users: { name: 'Paid Zero' }, week_start: '2026-10-12', total_hours: 0, total_inc: 200, status: 'paid', lines: [labour(5), commission] },
  { id: 'inv-billed', users: { name: 'Billed Trade' }, week_start: '2026-09-07', total_hours: 4, total_inc: 160, status: 'pending_acknowledgment', xero_bill_id: 'bill-fixture', lines: [labour(4)] },
  { id: 'inv-share', users: { name: 'Share Trade' }, total_hours: 0, total_inc: 500, status: 'pending_acknowledgment', created_at: '2026-09-01T02:00:00Z', lines: [{ line_type: 'group share', unit: 'ea', total_hours: 0, quantity: 1, line_total_ex: 500 }] },
  { id: 'inv-stuck-aug-b', users: { name: 'Stuck Aug B' }, week_start: '2026-07-20', total_hours: 0, total_inc: 120, status: 'pending_acknowledgment', created_at: '2026-08-04T03:00:12Z', lines: [labour(1), labour(2), labour(0)] },
  { id: 'inv-stuck-aug-a', users: { name: 'Stuck Aug A' }, week_start: '2026-07-20', total_hours: 0, total_inc: 120, status: 'pending_acknowledgment', created_at: '2026-08-04T03:00:00Z', lines: [labour(1), labour(2), labour(0)] },
  { id: 'inv-stuck-jul', users: { name: 'Stuck Jul' }, week_start: '2026-06-29', total_hours: 0, total_inc: 300, status: 'pending_acknowledgment', created_at: '2026-07-16T01:00:00Z', lines: [labour(0), labour(0), workOrder] },
  { id: 'inv-review-2', users: { name: 'Review Two' }, week_start: '2026-06-22', total_hours: 6, total_inc: 240, status: 'pending_ops_review', lines: [labour(6)] },
  { id: 'inv-hr-unit', users: { name: 'Hour Unit' }, week_start: '2026-06-15', total_hours: null, total_inc: 100, status: 'paid', lines: [{ line_type: 'labour', unit: 'hr', total_hours: null, quantity: 2.5, line_total_ex: 100 }, commission] },
];

async function bootOps(page) {
  const writes = [];
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const action = match && match[1];
    if (action === 'list_trade_invoices') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoices: LIST, rates: [] }) });
    if (action && /approve|push|resolve|reject|pay|submit/.test(action)) writes.push(action);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(OPS_FILE);
  await page.waitForFunction(() => typeof window.loadTradeBills === 'function' && typeof window.swTradeBillOrder === 'function');
  await page.evaluate(() => { showView('financials'); showSubTab('tradebills'); });
  await expect(page.locator('#tradeBillTable')).toBeVisible();
  await expect(page.locator('#tradeBillTable tbody tr')).toHaveCount(LIST.length);
  return writes;
}

const rows = (page) => page.locator('#tradeBillTable tbody tr');
const row = (page, name) => rows(page).filter({ hasText: name });

test('stuck invoices lead, oldest week first; then the ones waiting on Approve; the rest keep the server order', async ({ page }) => {
  const writes = await bootOps(page);
  const names = await rows(page).locator('td:first-child').evaluateAll((tds) => tds.map((td) => td.firstChild.textContent.trim()));
  expect(names).toEqual([
    'Stuck Jul', 'Stuck Aug A', 'Stuck Aug B',
    'Review Trade', 'Review Two',
    'Paid New', 'Paid Zero', 'Billed Trade', 'Share Trade', 'Hour Unit',
  ]);
  // The stuck block is exactly the rows with the button.
  const withButton = await rows(page).evaluateAll((trs) => trs.map((tr) => !!tr.querySelector('[data-trade-bill-clear]')));
  expect(withButton).toEqual([true, true, true, false, false, false, false, false, false, false]);
  await page.screenshot({ path: test.info().outputPath('trade-bills-order.png'), fullPage: true });
  expect(writes).toEqual([]);
});

test('the Hours cell reads the hourly lines when the invoice saved 0; per-item lines never count as hours', async ({ page }) => {
  await bootOps(page);
  const hours = (name) => row(page, name).locator('[data-trade-bill-hours]');
  // Stored 0, hourly lines carry 3 hours.
  await expect(hours('Stuck Aug A')).toHaveText('3.0');
  await expect(hours('Stuck Aug A')).toHaveAttribute('data-trade-bill-hours', 'lines');
  // Stored 0, labour lines 0 hours, money on a work order: 0 hours, said plainly.
  await expect(hours('Stuck Jul').locator('[data-trade-bill-per-item]')).toHaveText('Billed per item, not hours');
  await expect(hours('Stuck Jul')).toContainText('0.0');
  // Stored 0 with a commission line: only the 5 labour hours count, not the 2 commission items.
  await expect(hours('Paid Zero')).toHaveText('5.0');
  // A stored figure stands as it is.
  await expect(hours('Paid New')).toHaveText('7.5');
  await expect(hours('Paid New')).toHaveAttribute('data-trade-bill-hours', 'invoice');
  // No stored figure; unit hr reads quantity; the commission is not hours.
  await expect(hours('Hour Unit')).toHaveText('2.5');
  // A group share has no hours and is not called per item.
  await expect(hours('Share Trade')).toHaveText('0.0');
  await expect(hours('Share Trade').locator('[data-trade-bill-per-item]')).toHaveCount(0);
  // Totals are untouched.
  await expect(row(page, 'Stuck Aug A').locator('[data-invoice-payable], td:nth-child(4)').first()).toContainText('120.00');
  await page.locator('#tradeBillTable').screenshot({ path: test.info().outputPath('trade-bills-hours.png') });
});
