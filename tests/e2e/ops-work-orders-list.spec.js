// Financials > Work Orders: every job work order in one list, like Quotes and
// Invoices. Read only. Figures are the server's `cap`; a failed read never
// draws an empty list or $0.00.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const ROWS = [
  { id: 'wo-need', job_id: 'job-need', wo_number: 'WO-1', status: 'draft', agreed_labour_ex: null, job_number: 'SWR-1', client_name: 'Need Client', site_suburb: 'Bayswater', job_type: 'repair', created_at: '2026-11-10T01:00:00Z', cap: null },
  { id: 'wo-draft', job_id: 'job-draft', wo_number: 'WO-2', status: 'draft', agreed_labour_ex: 900, job_number: 'SWF-2', client_name: 'Draft Client', site_suburb: 'Dianella', job_type: 'fencing', created_at: '2026-11-11T01:00:00Z', cap: null },
  { id: 'wo-ok', job_id: 'job-ok', wo_number: 'WO-3', status: 'approved', agreed_labour_ex: 2000, job_number: 'SWF-3', client_name: 'Open Client', site_suburb: 'Morley', job_type: 'fencing', approved_at: '2026-11-12T01:00:00Z', cap: { allowed_ex: 2150, billed_ex: 1000, remaining_ex: 1150, billed_in_full: false, over: false } },
  { id: 'wo-full', job_id: 'job-full', wo_number: 'WO-4', status: 'approved', agreed_labour_ex: 1500, job_number: 'SWP-4', client_name: 'Full Client', site_suburb: 'Joondalup', job_type: 'patio', approved_at: '2026-11-13T01:00:00Z', cap: { allowed_ex: 1500, billed_ex: 1500, remaining_ex: 0, billed_in_full: true, over: false } },
  { id: 'wo-over', job_id: 'job-over', wo_number: 'WO-5', status: 'approved', agreed_labour_ex: 208, job_number: 'SWF-5', client_name: 'Over Client', site_suburb: 'Ellenbrook', job_type: 'fencing', approved_at: '2026-11-14T01:00:00Z', cap: { allowed_ex: 208, billed_ex: 416, remaining_ex: -208, billed_in_full: true, over: true } },
];

async function boot(page, answer) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate((ans) => {
    window.__reads = [];
    window.__opened = [];
    window.opsFetch = async function (action, params) {
      window.__reads.push({ action, params });
      if (action === 'list_work_orders' && params && params.kind === 'job') {
        if (ans === 'fail') throw new Error('Server error');
        return ans;
      }
      if (action === 'list_office_job_work_orders') return { enabled: false, work_orders: [] };
      return { work_orders: [] };
    };
    window.opsPost = async function () { throw new Error('no writes here'); };
    window.JobWorkOrderOps = { openForJob: function (id) { window.__opened.push(id); } };
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
  await page.locator('#woSearch').fill('ellenbrook');
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
  test(`fits at ${width} wide with no page side-scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await boot(page, { work_orders: ROWS, cap_read: 'ok' });
    await page.evaluate(() => loadWOs());
    await expect(page.locator('[data-wo-row]')).toHaveCount(5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator('#subWorkorders').screenshot({ path: `test-results/work-orders-list-${width}.png` });
  });
}
