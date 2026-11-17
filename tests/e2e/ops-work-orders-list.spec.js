// Financials > Work Orders: every job work order in one list, like Quotes and
// Invoices. Figures are the server's `cap`; a failed read never
// draws an empty list or $0.00.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const ROWS = [
  { id: 'wo-need', job_id: 'job-need', wo_number: 'WO-1', status: 'draft', agreed_labour_ex: null, job_number: 'ZZTEST-1', client_name: null, site_suburb: null, job_type: 'repair', created_at: '2026-11-10T01:00:00Z', cap: null },
  { id: 'wo-draft', job_id: 'job-draft', wo_number: 'WO-2', status: 'draft', agreed_labour_ex: 900, job_number: 'ZZTEST-2', client_name: null, site_suburb: null, job_type: 'fencing', created_at: '2026-11-11T01:00:00Z', cap: null },
  { id: 'wo-ok', job_id: 'job-ok', wo_number: 'WO-3', status: 'approved', agreed_labour_ex: 2000, job_number: 'ZZTEST-3', client_name: null, site_suburb: null, job_type: 'fencing', approved_at: '2026-11-12T01:00:00Z', cap: { allowed_ex: 2150, billed_ex: 1000, remaining_ex: 1150, billed_in_full: false, over: false } },
  { id: 'wo-full', job_id: 'job-full', wo_number: 'WO-4', status: 'approved', agreed_labour_ex: 1500, job_number: 'ZZTEST-4', client_name: null, site_suburb: null, job_type: 'patio', approved_at: '2026-11-13T01:00:00Z', cap: { allowed_ex: 1500, billed_ex: 1500, remaining_ex: 0, billed_in_full: true, over: false } },
  { id: 'wo-over', job_id: 'job-over', wo_number: 'WO-5', status: 'approved', agreed_labour_ex: 208, job_number: 'ZZTEST-5', client_name: null, site_suburb: null, job_type: 'fencing', approved_at: '2026-11-14T01:00:00Z', cap: { allowed_ex: 208, billed_ex: 416, remaining_ex: -208, billed_in_full: true, over: true } },
];

async function boot(page, answer) {
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate((ans) => {
    window.__reads = [];
    window.__jobAnswer = ans;
    window.SECUREWORKS_CLOUD = { auth: { getRole: () => 'ops_manager' } };
    window.__opened = [];
    window.opsFetch = async function (action, params) {
      window.__reads.push({ action, params });
      if (action === 'list_work_orders' && params && params.kind === 'job') {
        if (ans === 'fail') throw new Error('Server error');
        return ans;
      }
      if (action === 'list_office_job_work_orders') return { enabled: false, work_orders: [] };
      if (action === 'work_order_changes') return { changes: [] };
      return { work_orders: [] };
    };
    window.opsPost = async function () { throw new Error('no writes here'); };
    window.JobWorkOrderOps.openForJob = function (id) { window.__opened.push(id); };
    document.querySelectorAll('.view.active,.sub-view.active,[data-view].active,[data-sub].active').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('[data-view="financials"]').forEach((el) => el.classList.add('active'));
    document.querySelector('[data-sub="workorders"]').classList.add('active');
    var view = document.getElementById('viewFinancials');
    var sub = document.getElementById('subWorkorders');
    if (view) view.classList.add('active');
    if (sub) sub.classList.add('active');
  }, answer);
}

test('lists every job work order with the server figures, filters, search and type', async ({ page }) => {
  await boot(page, { schema: 'job-work-orders.v1', work_orders: ROWS, cap_read: 'ok' });
  await page.evaluate(() => loadWOs());
  const body = page.locator('#woJobTableBody');
  await expect(body.locator('[data-wo-row]')).toHaveCount(5);
  await expect(page.locator('#woJobStats')).toContainText('$3,858.00');
  await expect(page.locator('#woJobStats')).toContainText('$2,916.00');
  await expect(body.locator('[data-wo-row="wo-need"]')).toContainText('Needs an amount');
  await expect(body.locator('[data-wo-row="wo-need"]')).toContainText('Not set');
  await expect(body.locator('[data-wo-row="wo-ok"]')).toContainText('$150.00');
  await expect(body.locator('[data-wo-row="wo-ok"] [data-wo-left]')).toHaveText('$1,150.00');
  await expect(body.locator('[data-wo-row="wo-full"]')).toContainText('Billed in full');
  await expect(body.locator('[data-wo-row="wo-over"]')).toContainText('Over the work order');
  await expect(body.locator('[data-wo-row="wo-over"] [data-wo-left]')).toHaveText('-$208.00');
  await expect(page.locator('[data-wo-filter="over"]')).toHaveText('Over 1');
  await expect(page.locator('[data-wo-filter="draft"]')).toHaveText('Draft 2');

  await page.locator('[data-wo-filter="over"]').click();
  await expect(body.locator('[data-wo-row]')).toHaveCount(1);
  await page.locator('[data-wo-filter="approved"]').click();
  await expect(body.locator('[data-wo-row]')).toHaveCount(3);
  await page.locator('[data-wo-filter="all"]').click();
  await page.locator('#woTypeFilter').selectOption('patio');
  await expect(body.locator('[data-wo-row]')).toHaveCount(1);
  await page.locator('#woTypeFilter').selectOption('all');
  await page.locator('#woSearch').fill('ZZTEST-5');
  await expect(body.locator('[data-wo-row]')).toHaveCount(1);
  await page.locator('#woSearch').fill('');

  await body.locator('[data-wo-row="wo-ok"]').click();
  expect(await page.evaluate(() => window.__opened)).toEqual(['job-ok']);
  const reads = await page.evaluate(() => window.__reads.filter((r) => r.action === 'list_work_orders'));
  expect(reads[0].params).toEqual({ kind: 'job' });
});

test('a cap the server could not read says Not read, never $0.00', async ({ page }) => {
  const rows = ROWS.map((r) => ({ ...r, cap: null }));
  await boot(page, { work_orders: rows, cap_read: 'failed' });
  await page.evaluate(() => loadWOs());
  const ok = page.locator('[data-wo-row="wo-ok"]');
  await expect(ok).toContainText('Not read');
  await expect(ok).not.toContainText('$0.00');
  await expect(page.locator('#woJobStats')).toContainText('Not known');
  await expect(page.locator('#woJobNote')).toContainText('could not be read');
});

test('a failed read says so and never draws an empty list', async ({ page }) => {
  await boot(page, 'fail');
  await page.evaluate(() => loadWOs());
  await expect(page.locator('[data-wo-job-failed]')).toHaveText('Work orders could not be read. Reopen this tab to try again.');
  await expect(page.locator('[data-wo-job-empty]')).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`fits at ${width} wide with no page side-scroll`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await boot(page, { work_orders: ROWS, cap_read: 'ok' });
    await page.evaluate(() => loadWOs());
    await expect(page.locator('[data-wo-row]')).toHaveCount(5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator('#subWorkorders').screenshot({ path: testInfo.outputPath(`work-orders-list-${width}.png`) });
  });
}

const CHANGES = [
  { id: 'ZZTEST-change-1', changed_at: '2026-11-17T03:00:00Z', changed_by_name: 'Office', job_number: 'ZZTEST-3', kind: 'amount', from_ex: 2150, to_ex: 2300, reason: 'Extra work approved', profit_before_ex: 800, profit_after_ex: 650 },
  { id: 'ZZTEST-change-2', changed_at: '2026-11-16T03:00:00Z', changed_by_name: 'Owner', job_number: 'ZZTEST-3', kind: 'people', detail: { action: 'add', count: 2 }, reason: 'Crew confirmed', profit_before_ex: null, profit_after_ex: null },
];

for (const width of [1280, 820]) {
  test(`amount change requires a reason and posts exactly what staff entered at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await boot(page, { work_orders: ROWS, cap_read: 'ok' });
    await page.evaluate(() => {
      const original = window.opsFetch;
      window.opsFetch = async (action, params) => action === 'work_order_changes' ? { changes: [] } : original(action, params);
      window.__posts = [];
      window.opsPost = async (action, body) => {
        window.__posts.push({ action, body });
        if (window.__posts.length === 1) throw new Error('The crew split is locked.');
        const updated = window.__jobAnswer;
        updated.work_orders.find((r) => r.id === body.work_order_id).cap.allowed_ex = body.to_ex;
        return { change: { id: 'ZZTEST-change' } };
      };
    });
    await page.evaluate(() => loadWOs());
    await expect(page.locator('[data-wo-row="wo-draft"] button')).toHaveText('Approve');
    await expect(page.locator('[data-wo-row="wo-need"] button')).toHaveText('Set amount');
    await page.locator('[data-wo-row="wo-ok"]').getByRole('button', { name: 'Change amount' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change amount' });
    await expect(dialog).toContainText('Amount now $2,150.00');
    const amount = dialog.getByLabel('New amount (includes super, before GST)');
    const why = dialog.getByLabel('Why', { exact: true });
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    await amount.fill('2300');
    await expect(save).toBeDisabled();
    await why.fill('ab');
    await expect(save).toBeDisabled();
    await why.fill('Extra work approved');
    await amount.fill('-1');
    await expect(save).toBeDisabled();
    await amount.fill('');
    await expect(save).toBeDisabled();
    await amount.fill('2300');
    await expect(save).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`change-dialog-${width}.png`) });
    await save.click();
    await expect(dialog).toContainText('The crew split is locked.');
    await save.click();
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => window.__posts)).toEqual(Array(2).fill({ action: 'change_work_order_amount', body: { work_order_id: 'wo-ok', to_ex: 2300, reason: 'Extra work approved' } }));
    expect(await page.evaluate(() => window.__reads.filter((r) => r.action === 'list_work_orders' && r.params?.kind === 'job').length)).toBe(2);
    await page.locator('[data-wo-row="wo-ok"]').getByRole('button', { name: 'Change amount' }).click();
    await expect(page.getByRole('dialog', { name: 'Change amount' })).toContainText('Amount now $2,300.00');
  });

  test(`changes show server money, unknown profit and older pages at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await boot(page, { work_orders: ROWS, cap_read: 'ok' });
    await page.evaluate((changes) => {
      const original = window.opsFetch;
      window.opsFetch = async (action, params) => {
        if (action !== 'work_order_changes') return original(action, params);
        window.__reads.push({ action, params });
        if (window.__changesFail) throw new Error('Read refused');
        return { changes: params.before ? [] : changes };
      };
    }, CHANGES);
    await page.evaluate(() => loadWOs());
    const section = page.getByRole('region', { name: 'Changes', exact: true });
    await expect(section).toContainText('$800.00');
    await expect(section).toContainText('$650.00');
    await expect(section).toContainText('Named 2 people');
    await expect(section.locator('tbody tr').nth(1)).toContainText('not known');
    await expect(section.locator('tbody tr').nth(1)).not.toContainText('$0.00');
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`changes-list-${width}.png`) });
    await section.getByRole('button', { name: 'Load older' }).click();
    expect(await page.evaluate(() => window.__reads.filter((r) => r.action === 'work_order_changes').map((r) => r.params))).toEqual([{ limit: 50 }, { limit: 50, before: CHANGES[1].changed_at }]);
    await page.evaluate(() => { window.__changesFail = true; });
    await page.evaluate(() => loadWOs());
    await expect(section).toContainText('The changes could not be read. Try again.');
    await expect(section).not.toContainText('No work order changes yet.');
    await page.evaluate(() => { window.__changesFail = false; });
    await section.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(section).toContainText('$650.00');
  });
}

test('trade roles have no amount change button or changes list', async ({ page }) => {
  await boot(page, { work_orders: ROWS, cap_read: 'ok' });
  await page.evaluate(() => {
    window.SECUREWORKS_CLOUD = { auth: { getRole: () => 'trade' } };
  });
  await page.evaluate(() => loadWOs());
  await expect(page.getByRole('button', { name: 'Change amount' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Changes', exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => window.__reads.some((r) => r.action === 'work_order_changes'))).toBe(false);
});
