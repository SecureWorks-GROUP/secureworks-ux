// Financials > Work Orders > Billed over the agreed amount (follow-up 49 item
// 9(d)). Read only: job number, agreed, billed and gap from ops-api
// list_overbilled_job_work_orders, largest gap first. No trade, rate or line.
// A failed or refused read says so in words and never draws an empty list.
// Made-up figures and ZZTEST job numbers only.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

// ops.html loads its modules after the page; allow for a slow runner.
test.describe.configure({ timeout: 60_000 });

const ANSWER = {
  ok: true,
  rule: 'billed_over_agreed_labour',
  checked_work_orders: 12,
  count: 3,
  total_gap_ex: 1290,
  jobs: [
    // Deliberately out of order: the page sorts by gap too.
    { job_id: 'job-b', job_number: 'ZZTEST-2', work_order_id: 'wo-b', agreed_labour_ex: 500, billed_ex: 590, gap_ex: 90, allowed_ex: 600, over_allowed_ex: 0, within_allowed: true, limit: null },
    { job_id: 'job-a', job_number: 'ZZTEST-1', work_order_id: 'wo-a', agreed_labour_ex: 2000, billed_ex: 3000, gap_ex: 1000, allowed_ex: 2000, over_allowed_ex: 1000, within_allowed: false, limit: null },
    { job_id: 'job-c', job_number: 'ZZTEST-3', work_order_id: 'wo-c', agreed_labour_ex: 800, billed_ex: 1000, gap_ex: 200, allowed_ex: 800, over_allowed_ex: 200, within_allowed: false, limit: 'hourly_maximum' },
  ],
};

async function boot(page, answer) {
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  // The modules load after the page; wait for them so loadWOs reaches this list.
  await page.waitForFunction(() => window.Overbilled && window.WorkOrdersList && window.JobWorkOrderOps, null, { timeout: 45_000 });
  await page.evaluate((ans) => {
    window.__reads = [];
    window.__posts = [];
    window.__opened = [];
    window.SECUREWORKS_CLOUD = { auth: { getRole: () => 'ops_manager' } };
    window.opsFetch = async function (action, params) {
      window.__reads.push({ action, params });
      if (action === 'list_overbilled_job_work_orders') {
        if (ans === 'fail') { const e = new Error('Billed totals could not be read.'); e.status = 503; e.code = 'overbilled_unreadable'; throw e; }
        if (ans === 'refused') { const e = new Error('An authorised operator session is required.'); e.status = 403; e.code = 'operator_access_required'; throw e; }
        return ans;
      }
      if (action === 'list_work_orders') return { schema: 'job-work-orders.v1', work_orders: [], cap_read: 'ok' };
      if (action === 'list_office_job_work_orders') return { enabled: false, work_orders: [] };
      if (action === 'work_order_changes') return { changes: [] };
      return { work_orders: [] };
    };
    window.opsPost = async function (action) { window.__posts.push(action); throw new Error('no writes here'); };
    window.openJobDetail = function (id) { window.__opened.push(id); };
    document.querySelectorAll('.view.active,.sub-view.active,[data-view].active,[data-sub].active').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('[data-view="financials"]').forEach((el) => el.classList.add('active'));
    document.querySelector('[data-sub="workorders"]').classList.add('active');
    var view = document.getElementById('viewFinancials');
    var sub = document.getElementById('subWorkorders');
    if (view) view.classList.add('active');
    if (sub) sub.classList.add('active');
  }, answer);
}

test('lists jobs billed over the agreed amount, largest gap first, and opens the job page', async ({ page }) => {
  await boot(page, ANSWER);
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  const rows = host.locator('[data-overbilled-row]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('ZZTEST-1');
  await expect(rows.nth(1)).toContainText('ZZTEST-3');
  await expect(rows.nth(2)).toContainText('ZZTEST-2');
  await expect(rows.nth(0).locator('td')).toHaveText(['ZZTEST-1', '$2,000.00', '$3,000.00', '$1,000.00']);
  await expect(rows.nth(2).locator('[data-overbilled-covered]')).toBeVisible();
  await expect(host.locator('[data-overbilled-note]')).toContainText('3 jobs billed over their agreed amount');
  await expect(host.locator('[data-overbilled-note]')).toContainText('$1,290.00 over in all');
  await expect(host.locator('[data-overbilled-note]')).toContainText('12 approved work orders checked');
  await expect(host.locator('thead th')).toHaveText(['Job #', 'Agreed', 'Billed', 'Gap']);
  // Job-level only: no trade, rate, hours or invoice words on the list.
  await expect(host).not.toContainText(/rate|hours|invoice|trade/i);

  await host.locator('[data-overbilled-job="job-c"]').click();
  expect(await page.evaluate(() => window.__opened)).toEqual(['job-c']);
  const reads = await page.evaluate(() => window.__reads.filter((r) => r.action === 'list_overbilled_job_work_orders'));
  expect(reads.length).toBe(1);
  expect(await page.evaluate(() => window.__posts)).toEqual([]);
});

test('an empty answer says nobody is over, with how many were checked', async ({ page }) => {
  await boot(page, { ok: true, rule: 'billed_over_agreed_labour', checked_work_orders: 7, count: 0, total_gap_ex: 0, jobs: [] });
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  await expect(host.locator('[data-overbilled-empty]')).toHaveText('No job is billed over its agreed amount.');
  await expect(host.locator('[data-overbilled-note]')).toContainText('7 approved work orders checked');
});

for (const [name, answer] of [
  ['a 503 read', 'fail'],
  ['an answer with no jobs list', { ok: true, count: 0 }],
  ['a row missing its billed figure', { ok: true, checked_work_orders: 1, jobs: [{ job_id: 'job-x', job_number: 'ZZTEST-9', agreed_labour_ex: 100, billed_ex: null, gap_ex: 50 }] }],
]) {
  test(`${name} shows the failed state, never an empty list or $0.00`, async ({ page }) => {
    await boot(page, answer);
    await page.evaluate(() => loadWOs());
    const host = page.locator('#woOverbilled');
    await expect(host.locator('[data-overbilled-failed]')).toHaveText('Billed over the agreed amount could not be read. Reopen this tab to try again.');
    await expect(host.locator('[data-overbilled-row]')).toHaveCount(0);
    await expect(host.locator('[data-overbilled-empty]')).toHaveCount(0);
    await expect(host).not.toContainText('$0.00');
  });
}

test('a 403 says only staff can see the list', async ({ page }) => {
  await boot(page, 'refused');
  await page.evaluate(() => loadWOs());
  await expect(page.locator('#woOverbilled [data-overbilled-failed]')).toHaveText('Only staff can see this list.');
});

test('screenshot of the list from fixture data', async ({ page }) => {
  test.skip(!process.env.OVERBILLED_SHOT_DIR, 'set OVERBILLED_SHOT_DIR to save the proof picture');
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page, ANSWER);
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  await expect(host.locator('[data-overbilled-row]')).toHaveCount(3);
  await host.scrollIntoViewIfNeeded();
  await host.screenshot({ path: require('path').join(process.env.OVERBILLED_SHOT_DIR, 'overbilled-list.png') });
  await boot(page, 'fail');
  await page.evaluate(() => loadWOs());
  await expect(host.locator('[data-overbilled-failed]')).toBeVisible();
  await host.screenshot({ path: require('path').join(process.env.OVERBILLED_SHOT_DIR, 'overbilled-failed.png') });
});
