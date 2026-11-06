// Trade Bills: an invoice stuck in pending acknowledgment with no Xero bill
// gets a "Clear stuck invoice" button (fix 4, 6 Nov 2026). It calls ops-api
// resolve_stuck_trade_invoice with a decision and a reason, after one confirm,
// once per press, and shows the server's answer in plain words. Search
// `// <trade-bill-stuck>` in ops.html. Fixture data only: no live request.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const LABOUR = { job_number: 'SWF-FIXTURE', line_type: 'labour', total_hours: 6, hourly_rate: 50, line_total_ex: 300 };
const stuck = (extra = {}) => ({ id: 'inv-stuck', users: { name: 'Stuck Trade' }, week_start: '2026-07-13', total_hours: 6, total_inc: 330, status: 'pending_acknowledgment', invoice_number: 'SW-INV-FIXTURE-1', lines: [LABOUR], ...extra });
const OTHERS = [
  { id: 'inv-share', users: { name: 'Share Trade' }, total_hours: 0, total_inc: 500, status: 'pending_acknowledgment', lines: [{ line_type: 'group share', line_total_ex: 500 }] },
  { id: 'inv-billed', users: { name: 'Billed Trade' }, week_start: '2026-07-13', total_hours: 4, total_inc: 220, status: 'pending_acknowledgment', xero_bill_id: 'bill-fixture', lines: [LABOUR] },
  { id: 'inv-review', users: { name: 'Review Trade' }, week_start: '2026-10-26', total_hours: 8, total_inc: 440, status: 'pending_ops_review', lines: [LABOUR] },
];

async function bootOps(page, { list, resolve }) {
  const posts = [];
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const action = match && match[1];
    if (action === 'list_trade_invoices') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoices: list(), rates: [] }) });
    if (action === 'resolve_stuck_trade_invoice') {
      posts.push(req.postDataJSON());
      const [status, body] = await resolve(req.postDataJSON());
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(OPS_FILE);
  await page.waitForFunction(() => typeof window.loadTradeBills === 'function' && typeof window.clearStuckTradeInvoice === 'function');
  await page.evaluate(() => { showView('financials'); showSubTab('tradebills'); });
  await expect(page.locator('#tradeBillTable')).toBeVisible();
  return posts;
}

const row = (page, name) => page.locator('#tradeBillTable tbody tr').filter({ hasText: name });

test('only a stuck invoice is offered the button; release takes a choice, a reason and one confirm, and says what happened', async ({ page }) => {
  let released = false;
  let answer;
  const posts = await bootOps(page, {
    list: () => [released ? stuck({ status: 'ops-reject' }) : stuck(), ...OTHERS],
    resolve: () => new Promise((r) => { answer = r; }),
  });
  const clear = row(page, 'Stuck Trade').getByRole('button', { name: 'Clear stuck invoice', exact: true });
  await expect(clear).toBeVisible();
  for (const name of ['Share Trade', 'Billed Trade', 'Review Trade']) {
    await expect(row(page, name).locator('[data-trade-bill-clear]')).toHaveCount(0);
  }

  await clear.click();
  const form = row(page, 'Stuck Trade').locator('[data-trade-bill-clear-form]');
  const go = form.locator('[data-trade-bill-clear-go]');
  await go.click();
  await expect(form.locator('[data-trade-bill-clear-error]')).toHaveText('Choose release or send it on.');
  await form.getByRole('radio', { name: /Release it\./ }).check();
  await form.getByLabel('Reason').fill('ok');
  await go.click();
  await expect(form.locator('[data-trade-bill-clear-error]')).toHaveText('Give a reason of at least 3 letters.');
  await form.getByLabel('Reason').fill('Old invoice, never reached Xero');
  await page.screenshot({ path: test.info().outputPath('trade-bill-clear-form.png') });

  // Saying no to the confirm sends nothing.
  page.once('dialog', (d) => { expect(d.message()).toBe('Release the stuck invoice from Stuck Trade? It is sent back, and they can invoice that week again.'); d.dismiss(); });
  await go.click();
  expect(posts).toHaveLength(0);

  page.once('dialog', (d) => d.accept());
  await go.click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(go).toBeDisabled();
  await expect(go).toHaveText('Clearing…');
  // A second press while the first is out sends nothing.
  await page.evaluate(() => window.clearStuckTradeInvoice('inv-stuck', document.querySelector('[data-trade-bill-clear-go]')));
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ invoice_id: 'inv-stuck', decision: 'release', reason: 'Old invoice, never reached Xero' });
  expect(Object.keys(posts[0]).sort()).toEqual(['decision', 'invoice_id', 'operator_email', 'reason']);

  released = true;
  answer([200, { ok: true, invoice_id: 'inv-stuck', decision: 'release', status: 'ops-reject', event_recorded: true }]);
  const done = row(page, 'Stuck Trade');
  await expect(done.locator('[data-trade-bill-clear-result]')).toHaveText('Released. The trade can invoice that week again.');
  await expect(done.locator('[data-trade-bill-status]')).toContainText('Sent back to trade');
  await expect(done.locator('[data-trade-bill-clear]')).toHaveCount(0);
  expect(posts).toHaveLength(1);
  await page.screenshot({ path: test.info().outputPath('trade-bill-cleared.png') });
});

test('send on: an unconfirmed Xero push and a refusal are both said plainly', async ({ page }) => {
  const answers = [
    [200, { ok: true, invoice_id: 'inv-stuck', decision: 'send_to_xero', status: 'approved', xero_push: 'unconfirmed', xero_push_error: 'Xero did not answer' }],
    [409, { ok: false, code: 'xero_bill_exists_for_invoice', error: 'Xero already has a live bill for this invoice number, so it was not released.' }],
  ];
  let sent = false;
  const posts = await bootOps(page, {
    list: () => [sent ? stuck({ status: 'approved' }) : stuck()],
    resolve: async () => answers.shift(),
  });
  page.on('dialog', (d) => d.accept());

  const r = row(page, 'Stuck Trade');
  await r.getByRole('button', { name: 'Clear stuck invoice', exact: true }).click();
  await r.getByRole('radio', { name: /Send it on\./ }).check();
  await r.getByLabel('Reason').fill('Checked with the trade, it is right');
  sent = true;
  await r.getByRole('button', { name: 'Clear it', exact: true }).click();
  await expect(r.locator('[data-trade-bill-clear-result]')).toHaveText('Approved, but the Xero bill was not confirmed (Xero did not answer). Use Retry: add to Xero as a draft.');
  await expect(r.getByRole('button', { name: 'Retry: add to Xero as a draft' })).toBeVisible();
  expect(posts[0]).toMatchObject({ invoice_id: 'inv-stuck', decision: 'send_to_xero', reason: 'Checked with the trade, it is right' });

  // A refusal keeps the invoice stuck and the button there, with the reason.
  sent = false;
  await page.evaluate(() => window.loadTradeBills());
  await r.getByRole('button', { name: 'Clear stuck invoice', exact: true }).click();
  await r.getByRole('radio', { name: /Release it\./ }).check();
  await r.getByLabel('Reason').fill('Trade asked to redo the week');
  await r.getByRole('button', { name: 'Clear it', exact: true }).click();
  await expect(r.locator('[data-trade-bill-clear-result]')).toHaveText('Not cleared: Xero already has a live bill for this invoice number, so it was not released.');
  await expect(r.getByRole('button', { name: 'Clear stuck invoice', exact: true })).toBeVisible();
  expect(posts).toHaveLength(2);
});
