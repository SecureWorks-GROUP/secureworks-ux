const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.use({ browserName: process.env.CI ? 'chromium' : 'webkit', headless: true });
const root = path.resolve(__dirname, '../..');
const rows = [
  { id: 'ZZTEST-1', user_id: 'ZZTEST-crew-1', trade_name: 'ZZTEST Crew', label: 'ZZTEST equipment', amount: 25, balance_total: 200, balance_left: 75.25, first_week_start: '2026-11-23', active: true },
  { id: 'ZZTEST-2', user_id: 'ZZTEST-crew-2', trade_name: 'ZZTEST Lead installer', label: 'ZZTEST advance', amount: 30, balance_total: 150, balance_left: 0, first_week_start: '2026-11-16', active: false, stopped_at: '2026-11-18T00:00:00Z' }
];

async function open(page, options = {}) {
  const ops = fs.readFileSync(path.join(root, 'ops.html'), 'utf8');
  const css = ops.match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  const load = ops.match(/async function loadTradeBills\(\) \{[\s\S]*?\n\}/)[0];
  const host = ops.match(/<div id="subTradebills"[\s\S]*?<!-- Finance Health/)[0].replace('<!-- Finance Health', '');
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ZZTEST-repayments') return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}#subTradebills{display:block}body{padding:24px}main{max-width:1200px;margin:auto}</style></head><body><main>${host}</main><script src="/modules/ops-trade-repayments.js"></script><script>var _tradeBillsLoadSeq=0;function renderTradeBillTable(){}function renderTradeRatesPanel(){}function renderTradeBillLoadError(){}${load}</script></body></html>` });
    if (url.pathname === '/modules/ops-trade-repayments.js') return route.fulfill({ path: path.join(root, 'modules/ops-trade-repayments.js'), contentType: 'text/javascript' });
    return route.abort();
  });
  await page.goto('/ZZTEST-repayments');
  await page.evaluate(({ options, rows }) => {
    window.ZZTEST = { rows, writes: [], reads: [], fail: false, ...options };
    window.SECUREWORKS_CLOUD = { auth: { getRole: () => ZZTEST.role || 'admin' } };
    window.opsFetch = async action => {
      ZZTEST.reads.push(action);
      if (action === 'list_trade_invoices') return { invoices: [] };
      if (action === 'list_trade_repayments') {
        if (ZZTEST.fail) throw new Error('Read failed');
        if (ZZTEST.denyRead) throw Object.assign(new Error('Repayments are for the office.'), { status: 403 });
        return { repayments: structuredClone(ZZTEST.rows) };
      }
      if (action === 'trade_pay_settings') return { can_edit: ZZTEST.canEdit !== false };
      if (action === 'list_users') return { users: [{ id: 'ZZTEST-crew-1', name: 'ZZTEST Crew', role: 'installer' }] };
      throw new Error('Unexpected read ' + action);
    };
    window.opsPost = async (action, body) => {
      ZZTEST.writes.push({ action, body });
      if (ZZTEST.refuse) throw Object.assign(new Error('Only the bookkeeper and the owner can set a repayment.'), { status: 403 });
      if (action === 'stop_trade_repayment') ZZTEST.rows[0].active = false;
      return { repayment: { id: 'ZZTEST-saved' } };
    };
    return loadTradeBills();
  }, { options, rows });
}

async function fill(page) {
  await page.getByRole('button', { name: 'Set a repayment', exact: true }).click();
  await page.getByLabel('Trade', { exact: true }).selectOption('ZZTEST-crew-1');
  await page.getByLabel('What for', { exact: true }).fill('ZZTEST tools');
  await page.getByLabel('Amount each week', { exact: true }).fill('25.50');
  await page.getByLabel('Total to repay', { exact: true }).fill('255');
  await page.getByLabel('First pay week', { exact: true }).fill('2099-01-05');
  await page.getByLabel('Xero account code', { exact: true }).fill('ZZTEST');
  await page.getByLabel('Note', { exact: true }).fill('ZZTEST approved');
}

test('server balances render under Trade Bills at desktop and iPad widths', async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator('[data-repayment-row]')).toHaveCount(2);
  await expect(page.locator('[data-balance]')).toHaveText(['$75.25', '$0.00']);
  for (const width of [1280, 820]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const picture = testInfo.outputPath(`ZZTEST-repayments-${width}.png`);
    await page.screenshot({ path: picture, fullPage: true });
    await testInfo.attach(`ZZTEST-repayments-${width}`, { path: picture, contentType: 'image/png' });
  }
  await fill(page);
  for (const width of [1280, 820]) {
    await page.setViewportSize({ width, height: 1000 });
    const picture = testInfo.outputPath(`ZZTEST-repayment-form-${width}.png`);
    await page.screenshot({ path: picture, fullPage: true });
    await testInfo.attach(`ZZTEST-repayment-form-${width}`, { path: picture, contentType: 'image/png' });
  }
});

test('set posts exactly the approved fields and refuses a non-Monday without a write', async ({ page }) => {
  await open(page);
  await fill(page);
  await page.getByLabel('First pay week', { exact: true }).fill('2099-01-06');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => ZZTEST.writes)).toEqual([]);
  await page.getByLabel('First pay week', { exact: true }).fill('2099-01-05');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set a repayment', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ZZTEST.writes)).toEqual([{ action: 'set_trade_repayment', body: {
    user_id: 'ZZTEST-crew-1', label: 'ZZTEST tools', amount: 25.5, balance_total: 255,
    first_week_start: '2099-01-05', xero_account_code: 'ZZTEST', note: 'ZZTEST approved'
  } }]);
});

test('stop requires a reason and re-reads office changes instead of deriving a balance', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Stop repayment', exact: true }).click();
  expect(await page.evaluate(() => ZZTEST.writes)).toEqual([]);
  await page.getByLabel('Reason for stopping').fill('ZZTEST settled');
  await page.evaluate(() => { ZZTEST.rows[0].balance_left = 60.15; });
  await page.getByRole('button', { name: 'Stop repayment', exact: true }).click();
  await expect(page.locator('[data-balance]').first()).toHaveText('$60.15');
  expect(await page.evaluate(() => ZZTEST.writes)).toEqual([{ action: 'stop_trade_repayment', body: { id: 'ZZTEST-1', reason: 'ZZTEST settled' } }]);
});

for (const action of ['read', 'set', 'stop']) test(`403 on ${action} preserves server words and hides mutation buttons for the session`, async ({ page }) => {
  await open(page, action === 'read' ? { denyRead: true } : {});
  if (action !== 'read') {
    await page.evaluate(() => { ZZTEST.refuse = true; });
    if (action === 'set') { await fill(page); await page.getByRole('button', { name: 'Save', exact: true }).click(); }
    else {
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await page.getByLabel('Reason for stopping').fill('ZZTEST settled');
      await page.getByRole('button', { name: 'Stop repayment', exact: true }).click();
    }
  }
  await expect(page.getByRole('alert')).toHaveText(action === 'read' ? 'Repayments are for the office.' : 'Only the bookkeeper and the owner can set a repayment.');
  await expect(page.locator('[data-repayments] form')).toHaveCount(0);
  await page.evaluate(() => { ZZTEST.denyRead = false; ZZTEST.refuse = false; return loadTradeBills(); });
  await expect(page.getByRole('button', { name: 'Set a repayment', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => ZZTEST.writes.length)).toBe(action === 'read' ? 0 : 1);
});

test('empty, failed read, missing balance and fresh read remain honest', async ({ page }) => {
  await open(page, { rows: [] });
  await expect(page.getByText('No repayments.', { exact: true })).toBeVisible();
  await page.evaluate(() => { ZZTEST.fail = true; return loadTradeBills(); });
  await expect(page.getByRole('alert')).toHaveText('Repayments could not be read. Try again.');
  await expect(page.getByText('No repayments.', { exact: true })).toHaveCount(0);
  await page.evaluate(rows => { ZZTEST.fail = false; ZZTEST.rows = rows; ZZTEST.rows[0].balance_left = null; }, rows);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-balance]').first()).toHaveText('Not read');
});

test('trade gets no panel or repayment read; non-approver gets a read-only table', async ({ page }) => {
  await open(page, { role: 'installer' });
  await expect(page.locator('[data-repayments]')).toHaveCount(0);
  expect(await page.evaluate(() => ZZTEST.reads)).not.toContain('list_trade_repayments');
  await page.evaluate(() => { ZZTEST.role = 'admin'; ZZTEST.canEdit = false; return loadTradeBills(); });
  await expect(page.locator('[data-repayment-row]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Set a repayment', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
});
