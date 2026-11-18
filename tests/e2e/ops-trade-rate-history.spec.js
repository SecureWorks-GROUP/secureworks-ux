const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const current = {
  user_id: 'crew', users: { name: 'Installer' }, hourly_rate: 12,
  effective_from: '2026-03-01', set_by_kind: 'office', set_by_name: 'Office manager'
};
const earlier = {
  user_id: 'crew', hourly_rate: 10, effective_from: '2026-01-01', effective_to: '2026-02-28',
  set_by_kind: 'not_recorded'
};
const history = [{ ...current, effective_to: null, set_at: '2026-02-26T18:00:00Z' }, earlier];
const legacy = { ...earlier, user_id: 'lead', users: { name: 'Lead installer' } };

async function openBills(page, enabled = true) {
  const state = { rows: history, posts: [], reads: [], status: 200 };
  await installOpsSessionStub(page);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    const action = url.searchParams.get('action');
    let json = {};
    let status = 200;
    if (action === 'list_trade_invoices') json = { invoices: [], rates: [current, legacy] };
    if (action === 'trade_rate_history') {
      state.reads.push(url.searchParams.get('user_id'));
      json = { rates: state.rows };
      status = state.status;
    }
    if (action === 'set_trade_rate_ops') state.posts.push(route.request().postDataJSON());
    await route.fulfill({ json, status });
  });
  await page.goto('/ops.html' + (enabled ? '?rate_history=1' : ''));
  await page.evaluate(() => { showView('financials'); showSubTab('tradebills'); });
  return state;
}

for (const width of [1280, 820]) {
  test('rates and history at width ' + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await openBills(page);
    const panel = page.locator('#tradeRatesPanel');
    await expect(panel).toContainText('Set by Office manager on 27 Feb 2026');
    await expect(panel).toContainText('Set before this was recorded');
    await panel.screenshot({ path: info.outputPath('rates-' + width + '.png') });
    await panel.getByRole('button', { name: /^Installer/ }).click();
    await expect(page.locator('#rateHistorySection')).toContainText('Trades cannot type their own rate');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const rows = page.locator('#rateHistoryRows p');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('From 1 Mar 2026 · To open ended');
    await expect(rows.last()).toContainText('To 28 Feb 2026');
    await expect(rows.last()).toContainText('Set before this was recorded');
    await page.screenshot({ path: info.outputPath('history-' + width + '.png') });
    await page.locator('#rateModalInput').fill('15');
    await page.getByRole('button', { name: 'Save Rate' }).click();
    await expect.poll(() => state.posts.length).toBe(1);
    expect(state.posts[0]).toEqual({ user_id: 'crew', hourly_rate: 15, operator_email: expect.any(String) });
    expect(state.reads.every(id => id === 'crew')).toBe(true);
  });
}

test('changed rate and refused or empty history have distinct states', async ({ page }) => {
  const state = await openBills(page);
  state.rows = [{ ...history[0], hourly_rate: 15 }];
  await page.evaluate(() => loadTradeBills());
  const card = page.locator('#tradeRatesPanel button').first();
  await expect(card).toContainText('date unavailable');
  await card.click();
  const button = page.locator('#showRateHistory');
  state.status = 403;
  await button.click();
  await expect(page.locator('#rateHistoryRows')).toHaveText('The history could not be read. Try again.');
  state.status = 200;
  state.rows = [];
  await button.click();
  await expect(page.locator('#rateHistoryRows')).toHaveText('No earlier rates.');
  expect(state.posts).toEqual([]);
});

test('default screen keeps its original controls and reads', async ({ page }) => {
  const state = await openBills(page, false);
  await page.locator('#tradeRatesPanel').getByText('Installer', { exact: true }).click();
  await expect(page.locator('#rateModalInput')).toBeVisible();
  await expect(page.locator('#rateHistorySection')).toBeHidden();
  expect(state.reads).toEqual([]);
});
