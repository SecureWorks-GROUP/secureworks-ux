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
//  - When the answer carries the second read (spend_revenue), each month also shows card and bank spend by
//    Xero account and customer invoices against Job Profit, beside the bills and never added to them. A month
//    whose lines are not read says "Not read yet"; a month before the copy says "Not in our copy". Without the
//    second read, or when it failed, the page is the bills page and a failed read says so in words.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { answer, answerWithSpendRevenue } = require('../fixtures/xero-tieout.js');

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

test('with the second read, a month shows card and bank spend by account and customer invoices', async ({ page }) => {
  await open(page, { data: answerWithSpendRevenue() });
  const head2 = page.locator('[data-xt-headline2]');
  await expect(head2).toContainText('Customer invoices on a job');
  await expect(head2).toContainText('93.15%');
  await expect(head2).toContainText('$12,400.00 invoiced in the last 6 months, ex GST. $850.00 not on a job.');
  await expect(head2).toContainText('$575.26');
  await expect(head2).toContainText('$130.00 on direct cost accounts, on no job yet. 1 of the last 6 months read, in full or in part.');
  // The bills headline and rows are untouched by it.
  await expect(page.locator('[data-xt-headline]')).toContainText('$9,996.74');
  const cells = await page.locator('[data-xt-month="2034-03"] td').allInnerTexts();
  expect(cells.slice(0, 9).map((c) => c.trim())).toEqual([
    'Mar 2034', '17', '$5,496.74', '$2,970.35', '$500.00', '$710.39', '$1,316.00', '23.95%', 'Yes',
  ]);
  await page.locator('[data-xt-month="2034-03"]').click();
  const detail = page.locator('[data-xt-detail="2034-03"]');
  const spend = detail.locator('[data-xt-spend]');
  const rows = async (list) => (await list.locator('li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  expect((await rows(spend)).map((t) => t.split(' $')[0].split(' Yes')[0])).toEqual([
    'Spent, ex GST', 'Direct cost accounts', 'Overhead accounts', 'Not a cost', 'Coded to an income account',
    'Account not in our copy of the chart', 'Lines not read yet', 'Adds up to the payments',
  ]);
  await expect(spend).toContainText('$575.26');
  await expect(spend).toContainText('7 payments reconciled in Xero');
  // March is only partly sorted, so the page does not say every line is sorted.
  await expect(spend).toContainText('sorted by account where the lines could be read. Some of this month is not sorted.');
  await expect(spend).not.toContainText('each line sorted');
  await expect(spend).toContainText('$130.00');
  await expect(spend).toContainText('On no job yet: Job Profit does not read card spend.');
  await expect(spend).toContainText('$70.00');
  await expect(spend).toContainText('$200.00');
  await expect(spend).toContainText('$30.00');
  await expect(spend).toContainText('1 line we cannot sort');
  await expect(spend).toContainText('$95.25');
  await expect(spend).toContainText('2 of 7 payments');
  await expect(detail.locator('[data-xt-accounts]')).toContainText('Largest accounts: 800 Vehicle loan $200.00, 305 Direct Material Cost $100.00');
  await expect(detail.locator('[data-xt-accounts]')).toContainText('999 not in the chart $50.00');
  await expect(detail.locator('[data-xt-accounts]')).toContainText('and 1 more');
  const revenue = detail.locator('[data-xt-revenue]');
  expect((await rows(revenue)).map((t) => t.split(' $')[0].split(' Yes')[0])).toEqual([
    'Invoiced, ex GST', 'On a job', 'On the holding job', 'Not on a job', 'Counted above the invoice',
    'Draft or submitted invoices', 'Adds up to the invoices',
  ]);
  await expect(revenue).toContainText('$2,400.00');
  await expect(revenue).toContainText('5 invoices approved or paid in Xero');
  await expect(revenue).toContainText('$1,600.00');
  await expect(revenue).toContainText('$300.00');
  await expect(revenue).toContainText('$550.00');
  await expect(revenue).toContainText('2 invoices with dollars Job Profit does not count on any job');
  await expect(revenue).toContainText('$50.00');
  await expect(revenue).toContainText('$1,110.00');
  // Beside the bills, the card spend line now carries the figure and points at the panel.
  const beside = detail.locator('[data-xt-beside]');
  await expect(beside).toContainText('Card and bank spend');
  await expect(beside).toContainText('$575.26');
  await expect(beside).toContainText('not part of the bills total');
  await expect(beside).not.toContainText('12 reconciled payments');
  // The server's "not read yet" line for card spend goes; the basis lines come.
  const foot = page.locator('[data-xt-foot]');
  await expect(foot).not.toContainText('Not read yet: Spend money');
  await expect(foot).toContainText('None of it is on a job yet');
  await expect(foot).toContainText('Customer invoices are sales invoices approved or paid in Xero');
  expect((await tieoutReads(page)).length).toBe(1);
  expect(await page.evaluate(() => window.__xtPosts.length)).toBe(0);
});

test('a month whose card lines are not read, or is before the copy, is unknown and never $0.00', async ({ page }) => {
  await open(page, { data: answerWithSpendRevenue() });
  await page.locator('[data-xt-month="2034-02"]').click();
  const feb = page.locator('[data-xt-detail="2034-02"]');
  await expect(feb.locator('[data-xt-spend]')).toContainText('Not read yet');
  await expect(feb.locator('[data-xt-spend]')).toContainText('3 payments, $410.50 in the bank copy. The lines are not read yet, so nothing is sorted and this is unknown, not $0.');
  await expect(feb.locator('[data-xt-spend] li')).toHaveCount(1);
  await expect(feb.locator('[data-xt-accounts]')).toHaveCount(0);
  // The bills answer's own line stays for that month.
  await expect(feb.locator('[data-xt-beside]')).toContainText('Card and spend money');
  await expect(feb.locator('[data-xt-beside]')).toContainText('Not read yet');
  // Every invoice dollar on a job says so.
  await expect(feb.locator('[data-xt-revenue]')).toContainText('Every invoice dollar is on a job.');
  await expect(feb.locator('[data-xt-revenue]')).toContainText('$10,000.00');
  await page.locator('[data-xt-month="2034-01"]').click();
  const jan = page.locator('[data-xt-detail="2034-01"]');
  await expect(jan.locator('[data-xt-spend]')).toContainText('Not in our copy');
  await expect(jan.locator('[data-xt-spend]')).toContainText('unknown, not $0.');
  await expect(jan.locator('[data-xt-spend]')).not.toContainText('$0.00');
  // A month whose invoices do not add up says No.
  await expect(jan.locator('[data-xt-revenue]')).toContainText('No');
  await expect(jan.locator('[data-xt-revenue]')).toContainText('Do not rely on this month.');
});

test('money paid ahead, payments whose lines do not match and unread lines each get their own line', async ({ page }) => {
  const data = answerWithSpendRevenue();
  const mar = data.spend_revenue.answer.months.find((m) => m.month === '2034-03').spend;
  // A plain month first: none of the three lines is drawn.
  await open(page, { data });
  await page.locator('[data-xt-month="2034-03"]').click();
  const spend = page.locator('[data-xt-detail="2034-03"] [data-xt-spend]');
  await expect(spend).not.toContainText('Paid ahead to suppliers');
  await expect(spend).not.toContainText('do not match their total');
  await expect(spend).not.toContainText('no amount we can read');
  Object.assign(mar, { paid_ahead_ex: 345, paid_ahead_lines: 2, lines_differ_ex: 25, lines_differ_transactions: 3, unread_lines: 1, parts_add_up: false });
  await open(page, { data });
  await page.locator('[data-xt-month="2034-03"]').click();
  await expect(spend).toContainText('Paid ahead to suppliers');
  await expect(spend).toContainText('$345.00');
  await expect(spend).toContainText('The cost usually arrives again on a supplier bill, so it is not counted as a cost here.');
  await expect(spend).toContainText('Lines with no amount we can read');
  await expect(spend).toContainText('Their dollars are in no part above. Unknown, not $0.');
  await expect(spend).toContainText('Payments whose lines do not match their total');
  await expect(spend).toContainText('Each is out by more than 5 cents, $25.00 in all once they are netted.');
  await expect(spend).toContainText('Do not rely on this month.');
  expect(await page.evaluate(() => window.__xtPosts.length)).toBe(0);
});

test('"every invoice dollar is on a job" is said only when it is true, and a month with no invoice figures is unknown', async ({ page }) => {
  const data = answerWithSpendRevenue();
  const months = data.spend_revenue.answer.months;
  const mar = months.find((m) => m.month === '2034-03');
  const feb = months.find((m) => m.month === '2034-02');
  const jan = months.find((m) => m.month === '2034-01');
  // March: dollars on the holding job, none counted off a job. A fully read month says every line is sorted.
  Object.assign(mar.revenue, { on_job_ex: 2100, holding_job_ex: 300, not_on_job_ex: 0, not_on_job_invoices: 0 });
  Object.assign(mar.spend, { status: 'read' });
  // February: an invoice whose amount the copy does not hold.
  Object.assign(feb.revenue, { amount_unknown_count: 1 });
  // January: the server sent no invoice figures at all.
  delete jan.revenue;
  await open(page, { data });
  await page.locator('[data-xt-month="2034-03"]').click();
  const marRev = page.locator('[data-xt-detail="2034-03"] [data-xt-revenue]');
  await expect(marRev).toContainText('On the holding job');
  await expect(marRev).toContainText('Not on a job');
  await expect(marRev).not.toContainText('Every invoice dollar is on a job.');
  await expect(page.locator('[data-xt-detail="2034-03"] [data-xt-spend]')).toContainText('each line sorted by the account it was coded to.');
  await page.locator('[data-xt-month="2034-02"]').click();
  const febRev = page.locator('[data-xt-detail="2034-02"] [data-xt-revenue]');
  await expect(febRev).toContainText('Invoices with no amount in the copy');
  await expect(febRev).not.toContainText('Every invoice dollar is on a job.');
  await page.locator('[data-xt-month="2034-01"]').click();
  const janRev = page.locator('[data-xt-detail="2034-01"] [data-xt-revenue]');
  await expect(janRev.locator('li')).toHaveCount(1);
  await expect(janRev).toContainText('Not read');
  await expect(janRev).toContainText('The server sent no invoice figures for this month, so this is unknown, not $0.');
  await expect(janRev).not.toContainText('0 invoices');
  await expect(janRev).not.toContainText('$0.00');
  await expect(janRev).not.toContainText('Every invoice dollar is on a job.');
});

test('with no month of card spend read, the six-month card says Not read yet', async ({ page }) => {
  const data = answerWithSpendRevenue({ last_6_months: { from: '2033-10', to: '2034-03', revenue_total_ex: 12400, revenue_not_on_job_ex: 0, revenue_on_job_share: 1, spend_months_read: 0, spend_total_ex: null, spend_direct_cost_ex: null } });
  data.spend_revenue.answer.months.forEach((m) => { if (m.spend.status === 'partial') m.spend = Object.assign({}, data.spend_revenue.answer.months[1].spend); });
  await open(page, { data });
  const head2 = page.locator('[data-xt-headline2]');
  await expect(head2).toContainText('100.00%');
  await expect(head2).toContainText('Not read yet');
  await expect(head2).toContainText('unknown, not $0.');
  await expect(head2).not.toContainText('$0.00 on direct cost');
  // Nothing is sorted, so the server's own "not read yet" line stays.
  await expect(page.locator('[data-xt-foot]')).toContainText('Not read yet: Spend money and card spend are not in the bill intake yet.');
});

test('a second read that failed leaves the bills page whole and says so', async ({ page }) => {
  const data = Object.assign(answer(), { spend_revenue: { ok: false, reason: 'function xero_spend_revenue_monthly does not exist' } });
  await open(page, { data });
  await expect(page.locator('[data-xt-months] tr.xt-row')).toHaveCount(3);
  await expect(page.locator('[data-xt-headline]')).toContainText('$9,996.74');
  await expect(page.locator('[data-xt-headline2]')).toHaveCount(0);
  await page.locator('[data-xt-month="2034-03"]').click();
  await expect(page.locator('[data-xt-detail="2034-03"] [data-xt-spend]')).toHaveCount(0);
  await expect(page.locator('[data-xt-detail="2034-03"] [data-xt-revenue]')).toHaveCount(0);
  await expect(page.locator('[data-xt-detail="2034-03"] [data-xt-beside]')).toContainText('12 reconciled payments, $840.50, not sorted and not counted');
  await expect(page.locator('[data-xt-extra-failed]')).toContainText('Card spend and customer invoices could not be read just now (function xero_spend_revenue_monthly does not exist), so they are not shown. The bills above are not affected.');
  await expect(page.locator('[data-xt-error]')).toHaveCount(0);
});

test('an answer without the second read draws the bills page as before', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-xt-headline2]')).toHaveCount(0);
  await expect(page.locator('[data-xt-extra-failed]')).toHaveCount(0);
  await page.locator('[data-xt-month="2034-03"]').click();
  await expect(page.locator('[data-xt-detail="2034-03"] [data-xt-spend]')).toHaveCount(0);
  await expect(page.locator('#jpTieout .xt-lede')).toHaveText('Every supplier bill dollar in Xero, by month: on a job, trade-app labour, overhead, or not placed yet. Tap a month for the reasons.');
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
  test('with card spend and customer invoices open, nothing scrolls sideways', async ({ page }) => {
    await open(page, { data: answerWithSpendRevenue() });
    await page.locator('[data-xt-month="2034-03"]').click();
    await expect(page.locator('[data-xt-detail="2034-03"] [data-xt-revenue]')).toBeVisible();
    await expect(page.locator('[data-xt-headline2]')).toBeVisible();
    const wide = await page.evaluate(() => {
      const host = document.getElementById('jpTieout');
      const doc = document.documentElement;
      return { scroll: host.scrollWidth, client: host.clientWidth, page: doc.scrollWidth, view: doc.clientWidth };
    });
    expect(wide.scroll).toBeLessThanOrEqual(wide.client + 1);
    expect(wide.page).toBeLessThanOrEqual(wide.view + 1);
  });
});
