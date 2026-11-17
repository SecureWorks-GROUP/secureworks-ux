// Trade Bills rates panel: a trade with no row in trade_rates is listed as
// "No rate set" and the office gives them a first rate through the same
// set_trade_rate_ops save a rate change uses (11 Nov 2026). Before this the
// panel listed only people list_trade_invoices returned a rate for, so a new
// trade had no screen to be given one and their hours invoice was refused.
// Search `// <trade-first-rate>` in ops.html. Fixture data only: no live
// request, and the rates here are made-up numbers, nobody's pay.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const USERS = [
  { id: 'u-has', name: 'Has Rate', email: 'has.rate@example.test', role: 'crew' },
  { id: 'u-new', name: "New O'Trade", email: 'new.trade@example.test', role: 'crew' },
  { id: 'u-lead', name: 'New Lead', email: 'new.lead@example.test', role: 'lead_installer' },
  { id: 'u-office', name: 'Office Person', email: 'office@example.test', role: 'ops_manager' },
];
const HAS_RATE = { user_id: 'u-has', hourly_rate: 40, effective_from: '2026-07-01', users: { name: 'Has Rate' } };

async function bootOps(page, { rates, users = () => USERS, setRate }) {
  const posts = [];
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const action = match && match[1];
    const send = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'list_trade_invoices') return send(200, { invoices: [], rates: rates() });
    if (action === 'list_users') {
      const [status, body] = users();
      return send(status, body);
    }
    if (action === 'set_trade_rate_ops') {
      posts.push(req.postDataJSON());
      const [status, body] = setRate(req.postDataJSON());
      return send(status, body);
    }
    return send(200, {});
  });
  await page.goto(OPS_FILE);
  await page.waitForFunction(() => typeof window.loadTradeBills === 'function' && typeof window.openRateModal === 'function');
  await page.evaluate(() => { showView('financials'); showSubTab('tradebills'); });
  await expect(page.locator('#tradeBillTable')).toBeVisible();
  return posts;
}

const okUsers = () => [200, { users: USERS }];
const noRateChip = (page, name) => page.locator('#tradeRatesPanel [data-trade-no-rate]').filter({ hasText: name });

test('a trade with no rate is listed and given a first rate through set_trade_rate_ops', async ({ page }) => {
  let saved = false;
  const posts = await bootOps(page, {
    users: okUsers,
    rates: () => (saved ? [HAS_RATE, { user_id: 'u-new', hourly_rate: 37.5, effective_from: '2026-11-11', users: { name: "New O'Trade" } }] : [HAS_RATE]),
    setRate: () => { saved = true; return [200, { success: true }]; },
  });

  const panel = page.locator('#tradeRatesPanel');
  await expect(panel.locator('[data-trade-rate]')).toHaveCount(1);
  await expect(panel.locator('[data-trade-rate]')).toContainText('Has Rate');
  await expect(panel.locator('[data-trade-rate]')).toContainText('$40.00/hr');
  // Crew and lead installers with no rate, in the crew list's order. Office
  // roles are not trades and are not offered a rate here.
  await expect(panel.locator('[data-trade-no-rate]')).toHaveCount(2);
  await expect(noRateChip(page, 'New Lead')).toContainText('No rate set');
  await expect(noRateChip(page, "New O'Trade")).toContainText('No rate set');
  await expect(panel).not.toContainText('Office Person');
  await page.screenshot({ path: test.info().outputPath('trade-first-rate-panel.png') });

  await noRateChip(page, "New O'Trade").click();
  await expect(page.locator('#rateModal')).toHaveClass(/active/);
  await expect(page.locator('#rateModalTitle')).toHaveText("Set Rate — New O'Trade");
  await expect(page.locator('#rateModalCurrent')).toHaveText('No rate set');
  await expect(page.locator('#rateModalInput')).toHaveValue('');

  // An empty rate sends nothing.
  await page.getByRole('button', { name: 'Save Rate', exact: true }).click();
  expect(posts).toHaveLength(0);

  await page.locator('#rateModalInput').fill('37.5');
  await page.getByRole('button', { name: 'Save Rate', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ user_id: 'u-new', hourly_rate: 37.5 });
  expect(Object.keys(posts[0]).sort()).toEqual(['hourly_rate', 'operator_email', 'user_id']);

  // The reload shows the new rate and the trade leaves the no-rate list.
  await expect(panel.locator('[data-trade-rate]')).toHaveCount(2);
  await expect(panel.locator('[data-trade-rate]').filter({ hasText: "New O'Trade" })).toContainText('$37.50/hr');
  await expect(noRateChip(page, "New O'Trade")).toHaveCount(0);
  await expect(noRateChip(page, 'New Lead')).toHaveCount(1);
});

test('an existing rate still opens with its figure, and a failed crew read keeps the rates already shown', async ({ page }) => {
  await bootOps(page, {
    users: () => [500, { error: 'crew list down' }],
    rates: () => [HAS_RATE],
    setRate: () => [200, { success: true }],
  });
  const panel = page.locator('#tradeRatesPanel');
  await expect(panel.locator('[data-trade-rate]')).toHaveCount(1);
  await expect(panel.locator('[data-trade-no-rate]')).toHaveCount(0);
  await panel.locator('[data-trade-rate]').click();
  await expect(page.locator('#rateModalCurrent')).toHaveText('$40.00/hr');
  await expect(page.locator('#rateModalInput')).toHaveValue('40');
});
