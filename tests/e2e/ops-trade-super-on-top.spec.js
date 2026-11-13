// Trade Bills rates panel: the office marks one trade as "super on top" next
// to their rate (owner, 11 Nov 2026). The server decides and prices it; this
// screen shows the setting list_trade_invoices returns on each rate row and
// switches it through set_trade_super_on_top_ops, in two taps. Search
// `// <trade-super-on-top>` in ops.html. Fixture data only: no live request,
// and the rates here are made-up numbers, nobody's pay.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const rate = (id, name, extra) => ({
  user_id: id, hourly_rate: 40, effective_from: '2026-07-01', users: { name }, ...extra,
});

async function bootOps(page, { rates, setSuper }) {
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
    if (action === 'set_trade_super_on_top_ops') {
      posts.push(req.postDataJSON());
      const [status, body] = setSuper(req.postDataJSON());
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

const chip = (page, name) => page.locator('#tradeRatesPanel > div > div').filter({ hasText: name });

test('the office turns super on top on for one trade, in two taps, and the chip shows it', async ({ page }) => {
  let on = false;
  const posts = await bootOps(page, {
    rates: () => [
      rate('u-one', 'Trade One', on ? { super_on_top: true, super_on_top_from: '2026-11-11' } : { super_on_top: false }),
      rate('u-two', 'Trade Two', { super_on_top: false }),
    ],
    setSuper: () => { on = true; return [200, { success: true, super_on_top: true }]; },
  });

  await expect(chip(page, 'Trade One')).toContainText('$40.00/hr');
  await expect(page.locator('#tradeRatesPanel [data-trade-super-on-top]')).toHaveCount(0);

  await chip(page, 'Trade One').click();
  await expect(page.locator('#rateModal')).toHaveClass(/active/);
  const box = page.locator('#rateModalSuper');
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('data-super-on-top', 'off');
  await expect(page.locator('#rateModalSuperState')).toContainText('Standard');
  const btn = page.locator('#rateModalSuperBtn');
  await expect(btn).toHaveText('Turn on super on top');

  // First tap asks and saves nothing.
  await btn.click();
  await expect(btn).toHaveText('Confirm: turn on for Trade One');
  expect(posts).toHaveLength(0);
  await page.screenshot({ path: test.info().outputPath('trade-super-on-top-confirm.png') });

  await btn.click();
  await expect(page.locator('#rateModal')).not.toHaveClass(/active/);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ user_id: 'u-one', on: true });

  // The list is read again: only that trade carries the mark.
  await expect(page.locator('#tradeRatesPanel [data-trade-super-on-top]')).toHaveCount(1);
  await expect(chip(page, 'Trade One')).toContainText('+ super on top');
  await expect(chip(page, 'Trade Two')).not.toContainText('super on top');
  await page.screenshot({ path: test.info().outputPath('trade-super-on-top-panel.png') });

  // Re-opened, the modal says since when and offers to turn it off.
  await chip(page, 'Trade One').click();
  await expect(box).toHaveAttribute('data-super-on-top', 'on');
  await expect(page.locator('#rateModalSuperState')).toContainText('Super on top from 11 Nov 2026');
  await expect(btn).toHaveText('Turn off super on top');
});

test('turning it off posts on:false; opening another trade drops a half-made confirm', async ({ page }) => {
  let on = true;
  const posts = await bootOps(page, {
    rates: () => [
      rate('u-one', 'Trade One', on ? { super_on_top: true, super_on_top_from: '2026-11-02' } : { super_on_top: false }),
      rate('u-two', 'Trade Two', { super_on_top: false }),
    ],
    setSuper: () => { on = false; return [200, { success: true, super_on_top: false }]; },
  });
  const btn = page.locator('#rateModalSuperBtn');

  // A confirm armed for one trade never carries to the next one opened.
  await chip(page, 'Trade Two').click();
  await btn.click();
  await expect(btn).toHaveText('Confirm: turn on for Trade Two');
  await page.evaluate(() => closeModal('rateModal'));
  await chip(page, 'Trade One').click();
  await expect(btn).toHaveText('Turn off super on top');
  expect(posts).toHaveLength(0);

  await btn.click();
  await expect(btn).toHaveText('Confirm: turn off for Trade One');
  await btn.click();
  await expect(page.locator('#rateModal')).not.toHaveClass(/active/);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ user_id: 'u-one', on: false });
  await expect(page.locator('#tradeRatesPanel [data-trade-super-on-top]')).toHaveCount(0);
});

test('a refused save changes nothing on screen and says so', async ({ page }) => {
  const posts = await bootOps(page, {
    rates: () => [rate('u-one', 'Trade One', { super_on_top: false })],
    setSuper: () => [503, { error: 'Super on top could not be turned on. Nothing was changed.' }],
  });
  await chip(page, 'Trade One').click();
  const btn = page.locator('#rateModalSuperBtn');
  await btn.click();
  await btn.click();
  await expect(page.locator('.toast, #toast, [class*="toast"]').filter({ hasText: 'Nothing was changed' }).first()).toBeVisible();
  expect(posts).toHaveLength(1);
  await expect(page.locator('#rateModal')).toHaveClass(/active/);
  await expect(btn).toHaveText('Turn on super on top');
  await expect(page.locator('#tradeRatesPanel [data-trade-super-on-top]')).toHaveCount(0);
});

test('no control when the setting is unknown: an older server, or a setting that could not be read', async ({ page }) => {
  await bootOps(page, {
    rates: () => [rate('u-old', 'Old Server'), rate('u-null', 'Unreadable', { super_on_top: null })],
    setSuper: () => [200, { success: true }],
  });
  for (const name of ['Old Server', 'Unreadable']) {
    await chip(page, name).click();
    await expect(page.locator('#rateModal')).toHaveClass(/active/);
    await expect(page.locator('#rateModalSuper')).toBeHidden();
    // The rate itself is still editable.
    await expect(page.locator('#rateModalInput')).toHaveValue('40');
    await page.evaluate(() => closeModal('rateModal'));
  }
  await expect(page.locator('#tradeRatesPanel [data-trade-super-on-top]')).toHaveCount(0);
});
