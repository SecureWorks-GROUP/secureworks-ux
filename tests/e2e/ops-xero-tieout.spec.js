// Financials > Job profit > Tie to Xero (modules/ops-xero-tieout.js, // <xero-tieout> in ops.html;
// backend secureworks-backend ops-api xero_tieout, SQL xero_tieout_monthly). Offline: opsFetch is
// replaced in the page. Every figure is made up.
//
// Contract under guard:
//  - A "Tie to Xero" chip sits beside Jobs and Company, and the job filters hide while it shows.
//  - It reads xero_tieout once per open, with the months chosen, and writes nothing.
//  - The headline is the server's six-month line; each month row shows the server's four parts.
//  - Opening a month lists why dollars are not placed, in words, with a way to Bills to place.
//  - Card spend and credit notes the server has not read say "Not read yet", never $0.00.
//  - A month that does not add up says No, and the headline warns.
//  - A failed read says so in words and never draws an empty table; Retry reads again.
//  - On a phone the month table stacks and nothing scrolls sideways.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { answer } = require('../fixtures/xero-tieout.js');

async function open(page, { data = answer(), mode = 'ok', error = '' } = {}) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ data, mode, error }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    document.querySelectorAll('.view').forEach((v) => { v.classList.remove('active'); v.style.display = 'none'; });
    const view = document.getElementById('viewFinancials');
    view.classList.add('active');
    view.style.cssText = 'display:block;position:static;padding:16px 24px;background:var(--sw-bg,#F4F1EE);';
    document.querySelectorAll('#viewFinancials .sub-view').forEach((v) => v.classList.remove('active'));
    document.getElementById('subJobprofit').classList.add('active');
    _opsUserEmail = 'office@example.test';
    _crewList = [{ id: 'u1', name: 'Pat Example', email: 'office@example.test', role: 'admin' }];
    window.__xtFetches = [];
    window.__xtPosts = [];
    window.__xtMode = mode;
    window.opsFetch = (action, params) => {
      window.__xtFetches.push({ action, params });
      if (action !== 'xero_tieout') return Promise.resolve({ jobs: [], has_more: false });
      if (window.__xtMode === 'reject') return Promise.reject(Object.assign(new Error(error), { status: 503 }));
      if (window.__xtMode === 'no_months') return Promise.resolve({ ok: true, tieout: {} });
      return Promise.resolve(JSON.parse(JSON.stringify(data)));
    };
    window.opsPost = (action, body) => { window.__xtPosts.push({ action, body }); return Promise.resolve({ success: true }); };
    window.jpOpenBillsToPlace = () => { window.__xtBillsToPlace = (window.__xtBillsToPlace || 0) + 1; };
    jpSetMode('tieout');
  }, { data, mode, error });
}

const tieoutReads = (page) => page.evaluate(() => window.__xtFetches.filter((f) => f.action === 'xero_tieout'));

test('the chip opens the view, hides the job filters and reads once', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-jp-mode="tieout"]')).toHaveClass(/active/);
  await expect(page.locator('#jpTieout')).toBeVisible();
  await expect(page.locator('#jpJobs')).toBeHidden();
  await expect(page.locator('#jpType')).toBeHidden();
  await expect(page.locator('#jpJobNumber')).toBeHidden();
  await expect(page.locator('#subJobprofit .jp-basis')).toBeHidden();
  await expect(page.locator('[data-xt-months] tr.xt-row')).toHaveCount(3);
  expect(await tieoutReads(page)).toEqual([{ action: 'xero_tieout', params: { months: 12 } }]);
  expect(await page.evaluate(() => window.__xtPosts.length)).toBe(0);
  // Back to Jobs: the filters return.
  await page.evaluate(() => jpSetMode('jobs'));
  await expect(page.locator('#jpTieout')).toBeHidden();
  await expect(page.locator('#jpType')).toBeVisible();
  await expect(page.locator('#subJobprofit .jp-basis')).toBeVisible();
});

test('the headline and the month rows are the server figures', async ({ page }) => {
  await open(page);
  const head = page.locator('[data-xt-headline]');
  await expect(head).toContainText('$9,996.74');
  await expect(head).toContainText('86.83%');
  await expect(head).toContainText('$1,316.00');
  await expect(head).toContainText('13.17%');
  await expect(head).toContainText('3 of 3');
  const cells = await page.locator('[data-xt-month="2034-03"] td').allInnerTexts();
  expect(cells.slice(0, 9).map((c) => c.trim())).toEqual([
    'Mar 2034', '17', '$5,496.74', '$2,970.35', '$500.00', '$710.39', '$1,316.00', '23.95%', 'Yes',
  ]);
  // A month with no bills has no share, and says so.
  await expect(page.locator('[data-xt-month="2034-01"]')).toContainText('No bills');
});

test('opening a month says why dollars are not placed, and leads to Bills to place', async ({ page }) => {
  await open(page);
  const detail = page.locator('[data-xt-detail="2034-03"]');
  await expect(detail).toBeHidden();
  await page.locator('[data-xt-month="2034-03"]').click();
  await expect(detail).toBeVisible();
  const reasons = detail.locator('[data-xt-reasons]');
  await expect(reasons).toContainText('Waiting in Bills to place');
  await expect(reasons).toContainText('$500.55');
  await expect(reasons).toContainText('Installer bill waiting for a person to confirm it');
  await expect(reasons).toContainText('$600.00');
  await expect(reasons).toContainText('Parked on the holding job');
  await expect(reasons).toContainText('Never reached the bill intake');
  await expect(reasons).toContainText('Placed for less than the bill');
  await expect(detail).toContainText('Filed by a person in Bills to place');
  await expect(detail).toContainText('$259.99');
  await expect(detail).toContainText('$450.40');
  await expect(detail).toContainText('Placed for more than the bill');
  await expect(detail).toContainText('-$60.00');
  await expect(detail).toContainText('$77.77');
  await detail.locator('[data-xt-bills-to-place]').click();
  expect(await page.evaluate(() => window.__xtBillsToPlace)).toBe(1);
  // A second press closes it. Keyboard works too.
  await page.locator('[data-xt-month="2034-03"]').click();
  await expect(detail).toBeHidden();
  await page.locator('[data-xt-month="2034-02"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-xt-detail="2034-02"]')).toBeVisible();
  await expect(page.locator('[data-xt-detail="2034-02"] [data-xt-reasons]')).toContainText('Nothing waiting');
});

test('what the server has not read is "Not read yet", never $0.00', async ({ page }) => {
  await open(page);
  await page.locator('[data-xt-month="2034-03"]').click();
  const beside = page.locator('[data-xt-detail="2034-03"] [data-xt-beside]');
  await expect(beside).toContainText('Card and spend money');
  await expect(beside).toContainText('Not read yet');
  await expect(beside).toContainText('12 reconciled payments, $840.50, not sorted and not counted');
  await expect(beside).not.toContainText('$0.00');
  // A month whose credit notes were read shows them beside the bills.
  await page.locator('[data-xt-month="2034-02"]').click();
  const feb = page.locator('[data-xt-detail="2034-02"] [data-xt-beside]');
  await expect(feb).toContainText('2 notes, ex GST. Job Profit takes $250.00 off job cost');
  await expect(feb).toContainText('$300.00');
  await expect(page.locator('[data-xt-foot]')).toContainText('Not read yet: Spend money and card spend are not in the bill intake yet.');
});

test('a month that does not add up says No and the headline warns', async ({ page }) => {
  const data = answer();
  data.tieout.months[1].bills.parts_add_up = false;
  await open(page, { data });
  await expect(page.locator('[data-xt-month="2034-02"]')).toContainText('No');
  const head = page.locator('[data-xt-headline]');
  await expect(head).toContainText('2 of 3');
  await expect(head).toContainText('1 month does not add up to the bills in Xero');
});

test('a failed read says so, draws no table, and Retry reads again', async ({ page }) => {
  await open(page, { mode: 'reject', error: 'Xero tie-out could not be read: timeout' });
  const err = page.locator('[data-xt-error]');
  await expect(err).toContainText('could not be read, so no month is shown: Xero tie-out could not be read: timeout');
  await expect(page.locator('[data-xt-months]')).toHaveCount(0);
  await expect(page.locator('[data-xt-headline]')).toHaveCount(0);
  await page.evaluate(() => { window.__xtMode = 'ok'; });
  await err.locator('[data-xt-retry]').click();
  await expect(page.locator('[data-xt-months] tr.xt-row')).toHaveCount(3);
  expect((await tieoutReads(page)).length).toBe(2);
});

test('an answer without its months is a failed read, not an empty table', async ({ page }) => {
  await open(page, { mode: 'no_months' });
  await expect(page.locator('[data-xt-error]')).toContainText('the server answered without its months');
  await expect(page.locator('[data-xt-months]')).toHaveCount(0);
});

test('choosing a range reads again with it', async ({ page }) => {
  await open(page);
  await page.locator('#xtMonths').selectOption('24');
  await expect.poll(async () => (await tieoutReads(page)).length).toBe(2);
  expect((await tieoutReads(page))[1]).toEqual({ action: 'xero_tieout', params: { months: 24 } });
  await expect(page.locator('#xtMonths')).toHaveValue('24');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the months stack and nothing scrolls sideways', async ({ page }) => {
    await open(page);
    await page.locator('[data-xt-month="2034-03"]').click();
    await expect(page.locator('[data-xt-detail="2034-03"]')).toBeVisible();
    const wide = await page.evaluate(() => {
      const host = document.getElementById('jpTieout');
      return { scroll: host.scrollWidth, client: host.clientWidth, head: getComputedStyle(host.querySelector('[data-xt-months] thead')).display };
    });
    expect(wide.head).toBe('none');
    expect(wide.scroll).toBeLessThanOrEqual(wide.client + 1);
  });
});
