const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.use({ browserName: 'webkit', headless: true });
const root = path.resolve(__dirname, '../..');
const fields = ['tax_set_aside_percent', 'reimbursement_account_code', 'repayment_account_code', 'not_job_work_account_code'];
const empty = { inclusive_super_from: null, approvers_set: false, can_edit: true,
  missing: fields, recent_changes: [], ...Object.fromEntries(fields.map(field => [field, null])) };

async function open(page, answer = empty) {
  const css = fs.readFileSync(path.join(root, 'ops.html'), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ZZTEST-pay-settings') return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1000px;margin:auto;padding:20px"><button id="payTab">Pay run</button><div id="payHost"></div></main><script src="/modules/ops-pay-run.js"></script></body></html>` });
    if (url.pathname === '/modules/ops-pay-run.js') return route.fulfill({ path: path.join(root, 'modules/ops-pay-run.js'), contentType: 'text/javascript' });
    return route.abort();
  });
  await page.goto('/ZZTEST-pay-settings');
  await page.evaluate(answer => {
    window.ZZTEST = { answer, writes: [], failRead: false, refuse: false };
    window.opsFetch = async action => {
      if (action !== 'trade_pay_settings' || ZZTEST.failRead) throw new Error('Read unavailable');
      return structuredClone(ZZTEST.answer);
    };
    window.opsPost = async (action, body) => {
      ZZTEST.writes.push({ action, body });
      if (ZZTEST.refuse) throw new Error('Only the bookkeeper and the owner can change pay settings.');
      ZZTEST.answer[body.field] = body.value;
      ZZTEST.answer.missing = ZZTEST.answer.missing.filter(field => field !== body.field);
      ZZTEST.answer.recent_changes = [{ field: body.field, from_value: null, to_value: body.value, changed_at: '2026-11-18T00:00:00Z', changed_by_role: 'owner' }];
      return { field: body.field, value: body.value };
    };
    return PayRunSettings.mount(document.getElementById('payHost'), document.getElementById('payTab'));
  }, answer);
}

test('four missing settings, read-only director lines and tab count at desktop, iPad and phone', async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator('[data-pay-setting] [data-value]')).toHaveText(['Not set', 'Not set', 'Not set', 'Not set']);
  await expect(page.locator('#payTab')).toHaveText('Pay run (4 settings missing)');
  await expect(page.getByText('Start date: Not set', { exact: true })).toBeVisible();
  await expect(page.getByText('Approvers: Not set', { exact: true })).toBeVisible();
  for (const width of [1280, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach(`ZZTEST-pay-settings-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  }
});

test('an approver saves the percent, a refusal stays unsaved, retry reads office changes', async ({ page }) => {
  await open(page);
  const row = page.locator('[data-pay-setting="tax_set_aside_percent"]');
  await row.getByRole('button', { name: 'Set', exact: true }).click();
  await row.getByRole('spinbutton').fill('20');
  await page.evaluate(() => { ZZTEST.refuse = true; });
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Only the bookkeeper');
  await expect(row.locator('[data-value]')).toHaveText('Not set');
  await page.evaluate(() => { ZZTEST.refuse = false; ZZTEST.answer.repayment_account_code = 'ZZTEST'; ZZTEST.answer.missing = ZZTEST.answer.missing.filter(f => f !== 'repayment_account_code'); });
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.locator('[data-value]')).toHaveText('20%');
  await expect(page.locator('[data-pay-setting="repayment_account_code"] [data-value]')).toHaveText('ZZTEST');
  await expect(page.locator('#payTab')).toHaveText('Pay run (2 settings missing)');
  await expect(page.locator('[data-pay-changes]')).toContainText('owner');
  await expect(page.locator('[data-pay-changes]')).toContainText('20%');
  expect(await page.evaluate(() => ZZTEST.writes)).toEqual([
    { action: 'set_trade_pay_setting', body: { field: 'tax_set_aside_percent', value: '20' } },
    { action: 'set_trade_pay_setting', body: { field: 'tax_set_aside_percent', value: '20' } }
  ]);
});

test('non-approvers have no edit buttons and no approver identity is shown', async ({ page }) => {
  await open(page, { ...empty, can_edit: false, approvers_set: true, inclusive_super_from: '2026-11-23',
    recent_changes: [{ field: 'tax_set_aside_percent', from_value: null, to_value: '0', changed_by: 'ZZTEST-private', changed_at: '2026-11-18T00:00:00Z' }] });
  await expect(page.locator('[data-pay-settings] button')).toHaveCount(0);
  await expect(page.getByText('Only the bookkeeper and the owner can change these.')).toBeVisible();
  await expect(page.getByText('Approvers: set', { exact: true })).toBeVisible();
  await expect(page.locator('[data-pay-settings]')).not.toContainText('ZZTEST-private');
  await expect(page.locator('[data-pay-changes]')).toContainText('0%');
});

test('a failed read offers a retry without claiming values or allowing writes', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => { ZZTEST.failRead = true; await PayRunSettings.refresh(); });
  await expect(page.getByRole('alert')).toContainText('Pay settings could not be read');
  await expect(page.locator('[data-pay-setting]')).toHaveCount(0);
  await expect(page.locator('#payTab')).toHaveText('Pay run');
  await page.evaluate(() => { ZZTEST.failRead = false; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-pay-setting]')).toHaveCount(4);
});
