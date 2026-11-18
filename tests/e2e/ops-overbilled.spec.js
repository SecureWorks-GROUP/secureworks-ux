// Financials > Work Orders > Billed over the agreed amount (follow-up 49 item
// 9(d)). Read only: job number, agreed, billed and gap from ops-api
// list_overbilled_job_work_orders?days=<window>, largest gap first, plus the
// jobs billed in the window with no agreed amount, listed apart. No trade
// rate, hours or line. A window too wide is said plainly; a failed or refused
// read says so in words and never draws an empty list.
// Made-up figures and ZZTEST job numbers only.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

// ops.html loads its modules after the page; allow for a slow runner.
test.describe.configure({ timeout: 60_000 });

function answer(days) {
  return {
    ok: true,
    rule: 'billed_over_agreed_labour',
    window_days: days,
    window_from: '2026-08-20',
    max_jobs: 500,
    billed_jobs: 15,
    checked_work_orders: 12,
    count: 3,
    total_gap_ex: 1290,
    jobs: [
      // Deliberately out of order: the page sorts by gap too.
      { job_id: 'job-b', job_number: 'ZZTEST-2', work_order_id: 'wo-b', agreed_labour_ex: 500, billed_ex: 590, gap_ex: 90, allowed_ex: 600, over_allowed_ex: 0, within_allowed: true, limit: null },
      { job_id: 'job-a', job_number: 'ZZTEST-1', work_order_id: 'wo-a', agreed_labour_ex: 2000, billed_ex: 3000, gap_ex: 1000, allowed_ex: 2000, over_allowed_ex: 1000, within_allowed: false, limit: null },
      { job_id: 'job-c', job_number: 'ZZTEST-3', work_order_id: 'wo-c', agreed_labour_ex: 800, billed_ex: 1000, gap_ex: 200, allowed_ex: 800, over_allowed_ex: 200, within_allowed: false, limit: 'hourly_maximum' },
    ],
    no_agreed_amount_count: 3,
    no_agreed_amount: [
      { job_id: 'job-n2', job_number: 'ZZTEST-12', work_order: 'not_approved' },
      { job_id: 'job-n1', job_number: 'ZZTEST-11', work_order: 'none' },
      { job_id: 'job-n3', job_number: 'ZZTEST-13', work_order: 'no_amount' },
    ],
  };
}

// plan: { [days]: 'ok' | 'fail' | 'refused' | 'wide' | object }
async function boot(page, plan) {
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.waitForFunction(() => window.Overbilled && window.WorkOrdersList && window.JobWorkOrderOps, null, { timeout: 45_000 });
  await page.evaluate(({ plan, ok90, ok30 }) => {
    window.__reads = [];
    window.__posts = [];
    window.__opened = [];
    window.SECUREWORKS_CLOUD = { auth: { getRole: () => 'ops_manager' } };
    window.opsFetch = async function (action, params) {
      window.__reads.push({ action, params });
      if (action === 'list_overbilled_job_work_orders') {
        const want = plan[String(params && params.days)];
        const err = (status, code) => { const e = new Error('refused'); e.status = status; e.code = code; return e; };
        if (want === 'fail') throw err(503, 'overbilled_unreadable');
        if (want === 'refused') throw err(403, 'operator_access_required');
        if (want === 'wide') throw err(422, 'overbilled_window_too_wide');
        if (want === 'ok') return params.days === 30 ? ok30 : ok90;
        return want;
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
  }, { plan, ok90: answer(90), ok30: { ...answer(30), jobs: [answer(30).jobs[1]], count: 1, total_gap_ex: 1000 } });
}

const overReads = (page) => page.evaluate(() => window.__reads.filter((r) => r.action === 'list_overbilled_job_work_orders').map((r) => r.params));

test('lists jobs billed over the agreed amount, largest gap first, and opens the job page', async ({ page }) => {
  await boot(page, { 90: 'ok' });
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  const rows = host.locator('[data-overbilled-row]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('td')).toHaveText(['ZZTEST-1', '$2,000.00', '$3,000.00', '$1,000.00']);
  await expect(rows.nth(1)).toContainText('ZZTEST-3');
  await expect(rows.nth(2)).toContainText('ZZTEST-2');
  await expect(rows.nth(2).locator('[data-overbilled-covered]')).toBeVisible();
  const note = host.locator('[data-overbilled-note]');
  await expect(note).toContainText('last 90 days (since 2026-08-20)');
  await expect(note).toContainText('3 jobs billed over their agreed amount');
  await expect(note).toContainText('$1,290.00 over in all');
  await expect(note).toContainText('15 jobs billed in the window');
  await expect(host.locator('#oblTable thead th')).toHaveText(['Job #', 'Agreed', 'Billed', 'Gap']);
  await expect(host.locator('[data-overbilled-window]')).toHaveValue('90');
  // Job-level only: no rate, hours or invoice words on the list.
  await expect(host).not.toContainText(/\brate\b|hours|invoice/i);

  await host.locator('[data-overbilled-job="job-c"]').click();
  expect(await page.evaluate(() => window.__opened)).toEqual(['job-c']);
  expect(await overReads(page)).toEqual([{ days: 90 }]);
  expect(await page.evaluate(() => window.__posts)).toEqual([]);
});

test('jobs billed with no agreed amount are listed apart, each with its reason, and open the job', async ({ page }) => {
  await boot(page, { 90: 'ok' });
  await page.evaluate(() => loadWOs());
  const apart = page.locator('#woOverbilled [data-overbilled-apart]');
  await expect(apart.locator('h4')).toHaveText('Billed with no agreed amount');
  const rows = apart.locator('[data-overbilled-apart-row]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('td')).toHaveText(['ZZTEST-11', 'No work order']);
  await expect(rows.nth(1).locator('td')).toHaveText(['ZZTEST-12', 'Work order not approved']);
  await expect(rows.nth(2).locator('td')).toHaveText(['ZZTEST-13', 'No agreed amount on the work order']);
  // Never in the overbilled table.
  await expect(page.locator('#woOverbilled [data-overbilled-row="job-n1"]')).toHaveCount(0);
  await rows.nth(1).locator('[data-overbilled-job]').click();
  expect(await page.evaluate(() => window.__opened)).toEqual(['job-n2']);
});

test('changing the window reads again with that many days', async ({ page }) => {
  await boot(page, { 90: 'ok', 30: 'ok' });
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  await expect(host.locator('[data-overbilled-row]')).toHaveCount(3);
  await host.locator('[data-overbilled-window]').selectOption('30');
  await expect(host.locator('[data-overbilled-row]')).toHaveCount(1);
  await expect(host.locator('[data-overbilled-note]')).toContainText('last 30 days');
  await expect(host.locator('[data-overbilled-window]')).toHaveValue('30');
  expect(await overReads(page)).toEqual([{ days: 90 }, { days: 30 }]);
});

test('a window too wide says to pick a shorter one, plainly, and a shorter one then lists', async ({ page }) => {
  await boot(page, { 365: 'wide', 90: 'ok' });
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  await host.locator('[data-overbilled-window]').selectOption('365');
  await expect(host.locator('[data-overbilled-too-wide]')).toHaveText('Too many jobs were billed in the last 365 days to check them all. Pick a shorter window above.');
  await expect(host.locator('[data-overbilled-row]')).toHaveCount(0);
  await expect(host).not.toContainText('$0.00');
  await expect(host).not.toContainText('overbilled_window_too_wide');
  await host.locator('[data-overbilled-window]').selectOption('90');
  await expect(host.locator('[data-overbilled-row]')).toHaveCount(3);
});

test('an empty answer says nobody is over, and nobody is without an agreed amount', async ({ page }) => {
  await boot(page, { 90: { ...answer(90), billed_jobs: 7, checked_work_orders: 7, count: 0, total_gap_ex: 0, jobs: [], no_agreed_amount_count: 0, no_agreed_amount: [] } });
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  await expect(host.locator('[data-overbilled-empty]')).toHaveText('No job billed in the window is over its agreed amount.');
  await expect(host.locator('[data-overbilled-apart-empty]')).toHaveText('Every job billed in the window has an agreed amount.');
  await expect(host.locator('[data-overbilled-note]')).toContainText('7 jobs billed in the window');
});

test('an answer without the no-agreed-amount list says that list could not be read, never empty', async ({ page }) => {
  const a = answer(90);
  delete a.no_agreed_amount;
  await boot(page, { 90: a });
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  await expect(host.locator('[data-overbilled-row]')).toHaveCount(3);
  await expect(host.locator('[data-overbilled-apart-failed]')).toHaveText('This list could not be read. Reopen this tab to try again.');
  await expect(host.locator('[data-overbilled-apart-empty]')).toHaveCount(0);
});

for (const [name, want] of [
  ['a 503 read', 'fail'],
  ['an answer with no jobs list', { ok: true, count: 0 }],
  ['a row missing its billed figure', { ok: true, checked_work_orders: 1, jobs: [{ job_id: 'job-x', job_number: 'ZZTEST-9', agreed_labour_ex: 100, billed_ex: null, gap_ex: 50 }], no_agreed_amount: [] }],
]) {
  test(`${name} shows the failed state, never an empty list or $0.00`, async ({ page }) => {
    await boot(page, { 90: want });
    await page.evaluate(() => loadWOs());
    const host = page.locator('#woOverbilled');
    await expect(host.locator('[data-overbilled-failed]')).toHaveText('Billed over the agreed amount could not be read. Reopen this tab to try again.');
    await expect(host.locator('[data-overbilled-row]')).toHaveCount(0);
    await expect(host.locator('[data-overbilled-empty]')).toHaveCount(0);
    await expect(host.locator('[data-overbilled-apart]')).toHaveCount(0);
    await expect(host).not.toContainText('$0.00');
  });
}

test('a 403 says only staff can see the list', async ({ page }) => {
  await boot(page, { 90: 'refused' });
  await page.evaluate(() => loadWOs());
  await expect(page.locator('#woOverbilled [data-overbilled-failed]')).toHaveText('Only staff can see this list.');
});

test('screenshots of the list from fixture data', async ({ page }) => {
  test.skip(!process.env.OVERBILLED_SHOT_DIR, 'set OVERBILLED_SHOT_DIR to save the proof pictures');
  const path = require('path');
  const shot = (name) => page.locator('#woOverbilled').screenshot({ path: path.join(process.env.OVERBILLED_SHOT_DIR, name) });
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page, { 90: 'ok', 365: 'wide', 180: 'fail' });
  await page.evaluate(() => loadWOs());
  const host = page.locator('#woOverbilled');
  await expect(host.locator('[data-overbilled-apart-row]')).toHaveCount(3);
  await host.scrollIntoViewIfNeeded();
  await shot('overbilled-list.png');
  await host.locator('[data-overbilled-window]').selectOption('365');
  await expect(host.locator('[data-overbilled-too-wide]')).toBeVisible();
  await shot('overbilled-too-wide.png');
  await host.locator('[data-overbilled-window]').selectOption('180');
  await expect(host.locator('[data-overbilled-failed]')).toBeVisible();
  await shot('overbilled-failed.png');
});
