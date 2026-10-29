// Job page Overview v2: where each supplier bill on the job counts its cost (INT-10, H7).
// ---------------------------------------------------------------------------------------
// job_overview.bills is Context's context_job_bill_outcomes answer (secureworks-backend
// 20261029170100), which reads Finance's rule and carries no amount. The card's words are the
// CIO card display contract, revision 6 (21 Oct 2026, sha256 c317ed451b0dffd9...), row by
// row; a state r6 has no row for gets a proposed line, marked data-ov2-fresh.
//
// Two halves: the pure rule, extracted from modules/ops-job-overview-v2.js between its core
// sentinels (no browser), and the card itself in ops.html against a stubbed job_overview, so
// nothing reaches production.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { JOB_ID, buildJobDetail, buildJobOverview } = require('../fixtures/job-overview-v2');

const MODULE = resolve(__dirname, '../../modules/ops-job-overview-v2.js');
const SOURCE = readFileSync(MODULE, 'utf8');
const C = (() => {
  const OPEN = '// <job-overview-v2-core>';
  const CLOSE = '// </job-overview-v2-core>';
  const a = SOURCE.indexOf(OPEN);
  const b = SOURCE.indexOf(CLOSE);
  // eslint-disable-next-line no-new-func
  return new Function(SOURCE.slice(a + OPEN.length, b) + '\n;return JobOverviewV2Core;')();
})();

const here = (reason, extra = {}) => Object.assign({ xero_linked: true, placed_by: 'xero_link', counts: 'counted', reason, holding_job: false }, extra);
const bill = (o) => Object.assign({
  xero_invoice_id: 'X-1', invoice_number: 'B-1', supplier: 'Fence Supply Co', bill_status: 'AUTHORISED', bill_state: 'counted_in_full',
  held_reason: null, change_hash: 'h', overhead_part: false, not_job_related_mark: false, mirror_bill: false,
  where_counted: 'here', here: here('engine_reads_xero_lines'), other_jobs: [],
}, o);
const other = (job_number, counts = 'counted') => ({ job_id: 'j-' + job_number, job_number, xero_linked: false, placed_by: 'person', counts, reason: 'engine_reads_allocation_rows', holding_job: false });

// One bill per row the card draws, with the words it must say.
const ROWS = [
  ['8', bill({}), "Money counts this bill's cost here. See Money."],
  ['8o', bill({ overhead_part: true }), "Money counts part of this bill's cost here and part to overhead (no job). See Money."],
  ['5', bill({ bill_state: 'counted_in_part' }), "Money counts part of this bill's cost here. The rest is not placed yet. See Money."],
  ['9A', bill({ where_counted: 'elsewhere', here: here('xero_link_read_through_rows', { counts: 'not_counted' }), other_jobs: [other('SWF-990202')] }),
    "Money counts this bill's cost on SWF-990202. See Money."],
  ['10', bill({ where_counted: 'here_and_elsewhere', other_jobs: [other('SWF-990202')], overhead_part: true }),
    "Money counts part of this bill's cost here and part on SWF-990202, and part to overhead (no job). See Money."],
  ['1', bill({ where_counted: 'held', bill_state: 'held', held_reason: 'not_job_related_mark_on_counted_bill', here: here(null, { counts: 'held' }) }),
    "Where this bill's cost counts is not settled. It waits on an open money decision (JP-21). See Money."],
  ['3', bill({ where_counted: 'no_job', bill_state: 'not_counted', here: here('installer_unconfirmed', { counts: 'not_counted' }) }),
    'Installer bill: confirmation is missing. Money does not count it on any job until then. See Money.'],
  ['4', bill({ where_counted: 'no_job', bill_state: 'voided', bill_status: 'VOIDED', here: here('bill_voided', { counts: 'not_counted' }) }),
    'Xero voided this bill. Money counts it on no job. See Money.'],
  ['14h', bill({ where_counted: 'no_job', bill_state: 'overhead', here: here('xero_link_read_through_overhead', { counts: 'not_counted' }) }),
    'An overhead part is recorded on this bill while Xero still links it here. Money does not count it on this job. See Money.'],
  ['7', bill({ where_counted: 'no_job', bill_state: 'not_job_related', here: here('installer_not_job_related', { counts: 'not_counted' }) }),
    "Where this bill's cost counts is not known here. See Money."],
  ['14', bill({ where_counted: 'unknown', bill_state: 'unknown', bill_status: null, supplier: null, invoice_number: null, here: here('engine_reads_allocation_rows') }),
    "Where this bill's cost counts is not known here. See Money."],
  ['new', bill({ where_counted: 'trade_app', bill_state: 'trade_mirror', mirror_bill: true, here: here('mirror_bill_person_placed', { counts: 'not_counted', placed_by: 'person' }) }),
    "Trade app bill: Money counts its cost through the trade app's own lines, not as this bill. See Money."],
  ['new', bill({ bill_state: 'over_counted' }), "Money counts more of this bill's cost on jobs than the bill itself. See Money."],
  ['new', bill({ where_counted: 'no_job', bill_state: 'not_counted', bill_status: 'DRAFT', here: here('bill_not_approved', { counts: 'not_counted' }) }),
    'Xero has not approved this bill yet. Money counts it on no job until then. See Money.'],
];

test.describe('bill outcomes: the rule (extracted from the module)', () => {
  test('the module file still holds no long dash and no emoji', () => {
    expect(SOURCE).not.toMatch(/[–—]/);
    expect(SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('each state reads its r6 row, word for word, and every line ends "See Money"', () => {
    for (const [row, b, words] of ROWS) {
      const l = C.billLine(b);
      expect(l.row, JSON.stringify(b)).toBe(row);
      expect(l.words).toBe(words);
      expect(l.words.endsWith('See Money.')).toBe(true);
      expect(l.fresh).toBe(row === 'new');
    }
  });

  test('unknown is never counted here and names its reason', () => {
    expect(C.billLine(ROWS[10][1]).why).toBe('Money cannot say what state this bill is in.');
    const placementUnknown = C.billLine(bill({ where_counted: 'here', here: here('bill_copy_missing', { counts: 'unknown' }) }));
    expect([placementUnknown.row, placementUnknown.why, placementUnknown.unknown]).toEqual(['14', 'Our copy of this bill from Xero is missing.', true]);
    // "here" without a counted placement here, an answer the card does not know, no placement here
    expect(C.billLine(bill({ here: here('bill_voided', { counts: 'not_counted' }) })).row).toBe('14');
    expect(C.billLine(bill({ where_counted: 'somewhere' })).why).toBe("Money's answer is not one this card knows.");
    expect(C.billLine(bill({ where_counted: 'elsewhere', here: null, other_jobs: [other('SWF-990202')] })).why).toBe('This job holds no placement of the bill.');
    expect(C.billLine(bill({ where_counted: 'here', here: here('x', { counts: 'unknown', reason: 'odd_new_code' }) })).why).toBe('Reason code: odd_new_code.');
    // a voided state our copy does not confirm is not called voided (M10)
    const unconfirmedVoid = C.billLine(bill({ where_counted: 'no_job', bill_state: 'voided', bill_status: 'AUTHORISED', here: here('bill_voided', { counts: 'not_counted' }) }));
    expect([unconfirmedVoid.row, unconfirmedVoid.words]).toEqual(['14', "Where this bill's cost counts is not known here. See Money."]);
  });

  test('a split is one line naming the other job, never "also on"; a job not counted is not named', () => {
    const l = C.billLine(bill({ where_counted: 'here_and_elsewhere', other_jobs: [other('SWF-990303'), other('SWF-990404', 'not_counted')] }));
    expect(l.words).toBe("Money counts part of this bill's cost here and part on SWF-990303. See Money.");
    expect(l.words).not.toMatch(/also on/i);
  });

  test('no line carries an amount', () => {
    for (const [, b] of ROWS) expect(C.billLine(b).words).not.toMatch(/\$|\d+\.\d\d/);
  });

  test('the block: failed, not deployed, nothing placed, and the bill line facts', () => {
    const ov = (bills, src) => Object.assign(buildJobOverview(), { bills, sources: { bills: src } });
    expect(C.billOutcomes(null)).toBeNull();
    const failed = C.billOutcomes(ov(null, { ok: false, state: 'failed', count: 0, code: 'amount_present' }));
    expect([failed.state, failed.bills.length]).toEqual(['failed', 0]);
    expect(failed.words).toBe("Where this job's bills count is not known here. The answer carried an amount, which this card never shows. See Money.");
    expect(C.billOutcomes(ov(null, { ok: false, state: 'not_deployed', count: 0, code: 'not_deployed' })).state).toBe('not_deployed');
    // a server that predates the read sends neither the part nor its status
    expect(C.billOutcomes(buildJobOverview()).state).toBe('not_deployed');
    // an ok status with no answer is never "no bills"
    expect(C.billOutcomes(ov(null, { ok: true, state: 'ok', count: 0 })).state).toBe('failed');
    expect(C.billOutcomes(ov({ contract_version: 'cfo-bill-cost-outcome-v1', shape: 'context-job-bill-outcomes-v1', bills: [] }, { ok: true, state: 'ok', count: 0 })).words)
      .toBe('No supplier bill is placed on this job.');
    const ok = C.billOutcomes(ov({ contract_version: 'cfo-bill-cost-outcome-v1', shape: 'context-job-bill-outcomes-v1',
      bills: [bill({ bill_status: 'PAID' }), ROWS[11][1]] }, { ok: true, state: 'ok', count: 2 }));
    expect(ok.bills.map((x) => [x.title, x.status, x.mirror])).toEqual([
      ['B-1 · Fence Supply Co', 'Paid in Xero', false],
      ['B-1 · Fence Supply Co', 'Approved in Xero', true],
    ]);
  });
});

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
