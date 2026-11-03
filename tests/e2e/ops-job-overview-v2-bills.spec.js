// Job page Overview v2: where each supplier bill on the job counts its cost (INT-10, H7).
// ---------------------------------------------------------------------------------------
// job_overview.bills is Context's context_job_bill_outcomes answer (secureworks-backend
// 20261029170100), which reads Finance's rule and carries no amount. The card's words are the
// CIO card display contract, revision 6 (21 Oct 2026, sha256 c317ed451b0dffd9...), row by
// row; a state r6 has no row for gets a proposed line, marked data-ov2-fresh.
//
// The card itself in ops.html against a stubbed job_overview, so nothing reaches production.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { JOB_ID, buildJobDetail, buildJobOverview } = require('../fixtures/job-overview-v2');

const here = (reason, extra = {}) => Object.assign({ xero_linked: true, placed_by: 'xero_link', counts: 'counted', reason, holding_job: false }, extra);
const bill = (o) => Object.assign({
  xero_invoice_id: 'X-1', invoice_number: 'B-1', supplier: 'Fence Supply Co', bill_status: 'AUTHORISED', bill_state: 'counted_in_full',
  held_reason: null, change_hash: 'h', overhead_part: false, not_job_related_mark: false, mirror_bill: false,
  where_counted: 'here', here: here('engine_reads_xero_lines'), other_jobs: [],
}, o);
const other = (job_number, counts = 'counted') => ({ job_id: 'j-' + job_number, job_number, xero_linked: false, placed_by: 'person', counts, reason: 'engine_reads_allocation_rows', holding_job: false });

// The card, in ops.html, against a stubbed job_overview.
async function boot(page, ov) {
  await page.route('**/functions/v1/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not stubbed in this spec"}' }));
  await page.goto('/ops.html?overview=v2');
  await revealOpsStaticFixture(page);
  const detail = buildJobDetail();
  await page.evaluate(({ detail, ov }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__fetches = [];
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const unknown = () => Promise.reject(Object.assign(new Error('Unknown action'), { status: 400 }));
    window.opsFetch = (action, params) => {
      window.__fetches.push(action);
      if (action === 'job_detail') return Promise.resolve(clone(detail));
      if (action === 'annotations') return Promise.resolve({ annotations: [] });
      if (action === 'list_job_actions') return Promise.resolve([]);
      if (action === 'job_overview') return Promise.resolve(clone(ov));
      return unknown();
    };
    window.opsPost = () => Promise.resolve({ ok: true });
    window.opsAuthHeaders = async (extra) => Object.assign({ Authorization: 'Bearer e2e-ops-token' }, extra || {});
    window.JobOverviewV2.isStaffViewer = () => true;
  }, { detail, ov });
  await page.evaluate((jobId) => openJobDetail(jobId), JOB_ID);
  await expect(page.locator('#jobDetailView')).toHaveClass(/active/);
}

const withBills = (bills, src = { ok: true, state: 'ok', count: bills.length }) => {
  const ov = buildJobOverview();
  ov.bills = bills ? { contract_version: 'cfo-bill-cost-outcome-v1', shape: 'context-job-bill-outcomes-v1', bills } : null;
  ov.sources = Object.assign({}, ov.sources, { bills: src });
  return ov;
};

test('the card shows where each bill counts, the unknown with its reason, and the trade app bill marked', async ({ page }) => {
  const bills = [
    bill({ xero_invoice_id: 'X-HERE', invoice_number: 'B-101', bill_status: 'PAID' }),
    bill({ xero_invoice_id: 'X-SPLIT', invoice_number: 'B-102', where_counted: 'here_and_elsewhere', other_jobs: [other('SWF-990202')] }),
    bill({ xero_invoice_id: 'X-MISS', invoice_number: null, supplier: null, bill_status: null, where_counted: 'unknown', bill_state: 'unknown' }),
    bill({ xero_invoice_id: 'X-MIRROR', invoice_number: 'TI-7', supplier: 'Crew Member', where_counted: 'trade_app', bill_state: 'trade_mirror', mirror_bill: true,
      here: here('mirror_bill_person_placed', { counts: 'not_counted', placed_by: 'person' }) }),
    bill({ xero_invoice_id: 'X-HELD', invoice_number: 'B-104', where_counted: 'held', bill_state: 'held', held_reason: 'not_job_related_mark_on_counted_bill',
      here: here(null, { counts: 'held' }) }),
  ];
  await boot(page, withBills(bills));
  const block = page.locator('#ov2Bills');
  await expect(block).toHaveAttribute('data-ov2-bills', 'ok');
  await expect(block.locator('h3')).toHaveText('Where each bill counts');
  await expect(block.locator('li')).toHaveCount(5);
  const line = (id) => block.locator(`[data-ov2-bill="${id}"]`);
  await expect(line('X-HERE').locator('.ov2-bill-head')).toContainText('B-101 · Fence Supply Co');
  await expect(line('X-HERE').locator('.ov2-bill-head')).toContainText('Paid in Xero');
  await expect(line('X-HERE').locator('.ov2-bill-where')).toHaveText("Money counts this bill's cost here. See Money.");
  await expect(line('X-SPLIT').locator('.ov2-bill-where')).toHaveText("Money counts part of this bill's cost here and part on SWF-990202. See Money.");
  await expect(line('X-MISS')).toHaveAttribute('data-ov2-bill-row', '14');
  await expect(line('X-MISS').locator('.ov2-bill-where')).toHaveText("Where this bill's cost counts is not known here. See Money.");
  await expect(line('X-MISS').locator('.ov2-bill-why')).toHaveText('Money cannot say what state this bill is in.');
  await expect(line('X-MIRROR')).toHaveAttribute('data-ov2-mirror', '1');
  await expect(line('X-MIRROR')).toHaveAttribute('data-ov2-fresh', '1');
  await expect(line('X-MIRROR').locator('.ov2-bill-mirror')).toHaveText('Trade app bill');
  await expect(block.locator('[data-ov2-mirror]')).toHaveCount(1);
  await expect(line('X-HELD').locator('.ov2-bill-where')).toHaveText("Where this bill's cost counts is not settled. It waits on an open money decision (JP-21). See Money.");
  // no amount anywhere in the block
  expect(await block.innerText()).not.toMatch(/\$|\d+\.\d\d/);
  // the not known and not settled lines, echoed once in What we don't know
  const gaps = page.locator('#ov2Unknown [data-ov2-bill-gap]');
  await expect(gaps).toHaveCount(2);
  await expect(gaps.nth(0)).toHaveText("Bill with no number: Where this bill's cost counts is not known here. See Money. Money cannot say what state this bill is in.");
  await expect(gaps.nth(1)).toContainText('B-104 · Fence Supply Co: Where this bill\'s cost counts is not settled.');
  // the bills come only inside job_overview: the card asks nothing else for them
  expect(await page.evaluate(() => window.__fetches.filter((a) => /bill_outcome|cfo_|cost_outcome/i.test(a)))).toEqual([]);
  expect(await page.evaluate(() => window.__fetches.filter((a) => a === 'job_overview').length)).toBeGreaterThan(0);
});

test('a bill counted only in part says the rest is not placed yet, on another job and split; the 14h lines are echoed', async ({ page }) => {
  const bills = [
    bill({ xero_invoice_id: 'X-PART-ELSE', invoice_number: 'B-201', where_counted: 'elsewhere', bill_state: 'counted_in_part',
      here: here('xero_link_read_through_rows', { counts: 'not_counted' }), other_jobs: [other('SWF-990202')] }),
    bill({ xero_invoice_id: 'X-PART-SPLIT', invoice_number: 'B-202', where_counted: 'here_and_elsewhere', bill_state: 'counted_in_part',
      other_jobs: [other('SWF-990303')] }),
    bill({ xero_invoice_id: 'X-LABOUR', invoice_number: 'B-203', where_counted: 'no_job', bill_state: 'not_counted',
      here: here('labour_part_unconfirmed', { counts: 'not_counted' }) }),
    bill({ xero_invoice_id: 'X-OH', invoice_number: 'B-204', where_counted: 'no_job', bill_state: 'overhead',
      here: here('xero_link_read_through_overhead', { counts: 'not_counted' }) }),
  ];
  await boot(page, withBills(bills));
  const block = page.locator('#ov2Bills');
  const line = (id) => block.locator(`[data-ov2-bill="${id}"]`);
  await expect(line('X-PART-ELSE')).toHaveAttribute('data-ov2-bill-row', '5');
  await expect(line('X-PART-ELSE').locator('.ov2-bill-where'))
    .toHaveText("Money counts part of this bill's cost on SWF-990202. The rest is not placed yet. See Money.");
  await expect(line('X-PART-SPLIT').locator('.ov2-bill-where'))
    .toHaveText("Money counts part of this bill's cost here and part on SWF-990303. The rest is not placed yet. See Money.");
  // never the whole-bill line for a part
  await expect(block).not.toContainText("Money counts this bill's cost on SWF-990202.");
  const gaps = page.locator('#ov2Unknown [data-ov2-bill-gap]');
  await expect(gaps).toHaveCount(2);
  await expect(gaps.nth(0)).toHaveText('B-203 · Fence Supply Co: A labour part of this bill waits for a person to confirm it. Money does not count that part yet. See Money.');
  await expect(gaps.nth(1)).toHaveText('B-204 · Fence Supply Co: An overhead part is recorded on this bill while Xero still links it here. Money does not count it on this job. See Money.');
});

test('a refused or failed bills read says not known here with its reason, never no bills', async ({ page }) => {
  await boot(page, withBills(null, { ok: false, state: 'failed', count: 0, code: 'contract_mismatch' }));
  const block = page.locator('#ov2Bills');
  await expect(block).toHaveAttribute('data-ov2-bills', 'failed');
  await expect(block.locator('li')).toHaveCount(0);
  await expect(page.locator('#ov2BillsState')).toHaveText("Where this job's bills count is not known here. The answer was on another contract version. See Money.");
  await expect(page.locator('#ov2Unknown [data-ov2-bill-gap]')).toHaveCount(1);
});

test('a server that predates the read: not switched on yet, and the rest of the card still paints', async ({ page }) => {
  await boot(page, buildJobOverview());
  await expect(page.locator('#ov2Bills')).toHaveAttribute('data-ov2-bills', 'not_deployed');
  await expect(page.locator('#ov2BillsState')).toHaveText("Where this job's bills count is not known here. This read is not switched on yet. See Money.");
  await expect(page.locator('#ov2Headline')).toBeVisible();
});
