// Finance > Bills to place (ops.html, search // <bills-to-place>). Offline: ops-api is replaced
// in the page by the fixture below (made-up suppliers, jobs and amounts). No live write is made.
//
// Contract under guard:
//  - The sub-tab is hidden unless the signed-in email is on JOB_PROFIT_VIEWERS; a hidden session
//    cannot open it (showSubTab falls back to Invoices) and never reads the queue.
//  - The list is materials_recon_queue (limit 1000), largest ex-GST bill first, with the open count
//    and dollars, and says how many open bills the capped read left out.
//  - Opening a bill reads its lines through get_xero_invoice (never get_xero_bill, which writes the
//    local Xero cache) and shows each line's Business Unit.
//  - Place posts materials_recon_assign { queue_id, job_id } for a searched job, or
//    { queue_id, use_suggestion: true } for the queue's own suggestion; Not job related posts
//    materials_recon_not_job_related { queue_id }. A job already costed in Xero Projects (or one whose
//    project read failed) keeps Place shut until the operator ticks that the bill is not in it.
//  - A refused write keeps the bill on the list and says why.
// Screenshots: BILLS_TO_PLACE_EVIDENCE_DIR=<folder> npx playwright test tests/e2e/ops-bills-to-place.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const EVIDENCE_DIR = process.env.BILLS_TO_PLACE_EVIDENCE_DIR ? path.resolve(process.env.BILLS_TO_PLACE_EVIDENCE_DIR) : null;
// Evidence only: hide the page's fixed chrome so it does not float over the panel.
async function shotPanel(page, name) {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.evaluate(() => {
    const panel = document.getElementById('subBillstoplace');
    document.querySelectorAll('body *').forEach((el) => {
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'sticky') && !el.contains(panel) && !panel.contains(el)) el.style.visibility = 'hidden';
    });
  });
  await page.mouse.move(0, 0);
  await page.locator('#subBillstoplace').screenshot({ path: path.join(EVIDENCE_DIR, name) });
}

const OWNER = 'marnin@secureworkswa.com.au';
const OTHER = 'ops-e2e@example.test';

function queueRow(id, over) {
  return Object.assign({
    id, org_id: '00000000-0000-0000-0000-000000000001', xero_invoice_id: 'xinv-' + id,
    xero_contact_id: 'xc-' + id, contact_name: 'Supplier ' + id, invoice_number: 'INV-' + id,
    sub_total: 100, total: 110, invoice_date: '2026-09-01', suggested_job_id: null,
    suggested_job_number: null, suggestion_confidence: null, suggestion_reason: null, status: 'open',
    assigned_job_id: null, assigned_by: null, assigned_at: null,
  }, over || {});
}

function buildFixture() {
  return {
    queue: {
      ok: true, status: 'open',
      // Server order is newest first; the panel re-sorts by amount.
      rows: [
        queueRow('q-small', { contact_name: 'Bolt & Nut Supply', invoice_number: 'BN-77', sub_total: 212.5, total: 233.75, invoice_date: '2026-10-02' }),
        queueRow('q-big', { contact_name: 'Westside Steel', invoice_number: 'WS-1001', sub_total: 8450, total: 9295, invoice_date: '2026-09-20' }),
        queueRow('q-mid', {
          contact_name: 'Colour Panel Co', invoice_number: 'CP-310', sub_total: 1960, total: 2156, invoice_date: '2026-09-28',
          suggested_job_id: 'job-sugg', suggested_job_number: 'SWF-25500', suggestion_confidence: 'medium', suggestion_reason: 'ref_no_job',
        }),
      ],
      stats: { open: 5, assigned: 4, not_job_related: 2, total_rows: 11, open_total_inc: 13000, open_total_ex: 11822.5 },
    },
    invoices: {
      'xinv-q-big': {
        ok: true,
        invoice: {
          xero_invoice_id: 'xinv-q-big', invoice_number: 'WS-1001', status: 'AUTHORISED', reference: 'Order 4471',
          sub_total: 8450, total: 9295, amount_due: 9295, line_amount_types: 'Exclusive',
          line_items: [
            { description: 'Colorbond sheets 2100', quantity: 40, unit_amount: 150, line_amount: 6000, account_code: '305',
              tracking: [{ Name: 'Business Unit', Option: 'Fencing' }] },
            { description: 'Steel posts 65x65', quantity: 35, unit_amount: 70, line_amount: 2450, account_code: '305',
              tracking: [{ Name: 'Business Unit', Option: 'Fencing' }] },
          ],
        },
      },
    },
    search: {
      results: [
        { id: 'job-plain', job_number: 'SWF-25010', client_name: 'Harper Lane', site_suburb: 'Bayview', type: 'fencing', status: 'complete' },
        { id: 'job-proj', job_number: 'SWP-26044', client_name: 'Quinn Ashby', site_suburb: 'Hillcrest', type: 'patio', status: 'complete' },
      ],
    },
    jobs: {
      'job-plain': { job: { id: 'job-plain', job_number: 'SWF-25010', client_name: 'Harper Lane', site_address: '4 Example Rd, Bayview', type: 'fencing', status: 'complete' }, xero_project: null },
      'job-proj': {
        job: { id: 'job-proj', job_number: 'SWP-26044', client_name: 'Quinn Ashby', site_address: '9 Sample St, Hillcrest', type: 'patio', status: 'complete' },
        xero_project: { project_name: 'SWP-26044 Quinn Ashby patio', total_invoiced: 21000, total_expenses: 12400 },
      },
      'job-sugg': { job: { id: 'job-sugg', job_number: 'SWF-25500', client_name: 'Rowan Pike', site_address: '1 Demo Ave, Lakeside', type: 'fencing', status: 'invoiced' }, xero_project: null },
    },
  };
}

async function openOps(page, { email = OWNER, fixture = buildFixture(), refuse = {} } = {}) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ email, fixture, refuse }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__btpFetches = [];
    window.__btpPosts = [];
    const copy = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
    const fail = (msg, status) => { const e = new Error(msg); e.status = status || 500; return Promise.reject(e); };
    window.opsFetch = (action, params) => {
      window.__btpFetches.push({ action, params: params || {} });
      if (action === 'materials_recon_queue') return copy(fixture.queue);
      if (action === 'get_xero_invoice') {
        const inv = fixture.invoices[params.xero_invoice_id];
        return inv ? copy(inv) : fail('Xero invoice not found', 404);
      }
      if (action === 'search_jobs') return copy(fixture.search);
      if (action === 'job_detail') {
        if (refuse.job_detail) return fail(refuse.job_detail);
        const j = fixture.jobs[params.jobId];
        return j ? copy(j) : fail('Job not found', 404);
      }
      return copy({}); // other tabs' background reads are irrelevant here
    };
    window.opsPost = (action, body) => {
      window.__btpPosts.push({ action, body });
      if (refuse[action]) return fail(refuse[action]);
      if (action === 'materials_recon_assign') return copy({ ok: true, action: body.use_suggestion ? 'accept-suggestion' : 'assign-to-job' });
      if (action === 'materials_recon_not_job_related') return copy({ ok: true, action: 'mark-not-job-related' });
      return fail('Unknown action', 400);
    };
    _opsUserEmail = email;
    syncJobProfitAccess();
    showView('financials');
  }, { email, fixture, refuse });
}

async function openBills(page) {
  await page.locator('#billsToPlaceTab').click();
  await expect(page.locator('#subBillstoplace')).toHaveClass(/active/);
  await expect(page.locator('tr[data-btp-row]').first()).toBeVisible();
}

function row(page, id) { return page.locator('tr[data-btp-row="' + id + '"]'); }
function detail(page, id) { return page.locator('tr[data-btp-detail="' + id + '"]'); }
async function actions(page, name) {
  return page.evaluate((n) => window.__btpFetches.filter((f) => f.action === n), name);
}
async function posts(page) { return page.evaluate(() => window.__btpPosts); }

test.use({ viewport: { width: 1360, height: 1000 } });

test('a session not on the allowlist sees no Bills to place tab, cannot open it, and never reads the queue', async ({ page }) => {
  await openOps(page, { email: OTHER });
  await expect(page.locator('#billsToPlaceTab')).toBeHidden();
  await page.evaluate(() => showSubTab('billstoplace'));
  await expect(page.locator('#subBillstoplace')).not.toHaveClass(/active/);
  await expect(page.locator('#subInvoices')).toHaveClass(/active/);
  expect(await actions(page, 'materials_recon_queue')).toEqual([]);
  expect(await posts(page)).toEqual([]);
});

test('the allowlisted owner sees the tab, the list largest first, the open count and what the capped read left out', async ({ page }) => {
  await openOps(page);
  await expect(page.locator('#billsToPlaceTab')).toBeVisible();
  await openBills(page);
  const reads = await actions(page, 'materials_recon_queue');
  expect(reads).toHaveLength(1);
  expect(reads[0].params).toEqual({ status: 'open', limit: 1000 });
  expect(await page.locator('tr[data-btp-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-btp-row')))).toEqual(['q-big', 'q-mid', 'q-small']);
  await expect(row(page, 'q-big')).toContainText('$8,450.00');
  await expect(row(page, 'q-big')).toContainText('Westside Steel');
  await expect(row(page, 'q-big')).toContainText('WS-1001');
  await expect(row(page, 'q-big')).toContainText(/20 Sept? 2026/);
  await expect(row(page, 'q-mid')).toContainText('SWF-25500');
  await expect(page.locator('#btpSummary')).toHaveText('5 open bills · $11,822.50 ex GST on no job · 4 placed · 2 not job related');
  await expect(page.locator('#btpCapNote')).toHaveText('Showing the 3 newest of 5 open bills, largest first. The oldest 2 ($1,200.00 ex GST) are not in this list yet; they come in on Refresh once fewer than 1,000 bills are open.');
  await expect(page.locator('#subBillstoplace .btp-basis')).toContainText('Xero Projects stays where the bookkeeper puts supplier bills against a job');
});

test('opening a bill reads its lines with get_xero_invoice and shows each line and its Business Unit', async ({ page }) => {
  await openOps(page);
  await openBills(page);
  await row(page, 'q-big').click();
  const d = detail(page, 'q-big');
  await expect(d.locator('tr[data-btp-line]')).toHaveCount(2);
  await expect(d.locator('tr[data-btp-line]').first()).toContainText('Colorbond sheets 2100');
  await expect(d.locator('tr[data-btp-line]').first()).toContainText('Fencing');
  await expect(d.locator('tr[data-btp-line]').first()).toContainText('$6,000.00');
  await expect(d).toContainText('Reference: Order 4471');
  await expect(d).toContainText('$9,295.00 still owed');
  await expect(row(page, 'q-big').locator('[data-btp-bu]')).toHaveText('Fencing');
  await shotPanel(page, '01-bill-open-with-lines.png');
  expect((await actions(page, 'get_xero_invoice')).map((f) => f.params)).toEqual([{ xero_invoice_id: 'xinv-q-big' }]);
  expect(await actions(page, 'get_xero_bill')).toEqual([]);
  // A bill Xero cannot read says so, and still offers both presses.
  await row(page, 'q-small').click();
  await expect(detail(page, 'q-small')).toContainText("Could not read the bill's lines: Xero invoice not found");
  await expect(detail(page, 'q-small').locator('[data-btp-act="notjob"]')).toBeEnabled();
});

test('Place on a searched job posts materials_recon_assign with the queue id and the job id, then the bill leaves the list', async ({ page }) => {
  await openOps(page);
  await openBills(page);
  await row(page, 'q-big').click();
  const d = detail(page, 'q-big');
  await expect(d.locator('[data-btp-act="place"]')).toBeDisabled();
  await d.locator('[data-btp-q="q-big"]').fill('Harper');
  await d.locator('[data-btp-act="find"]').click();
  expect((await actions(page, 'search_jobs')).map((f) => f.params)).toEqual([{ q: 'Harper' }]);
  await d.locator('[data-btp-act="pick"][data-btp-job="job-plain"]').click();
  await expect(d.locator('[data-btp-project="none"]')).toHaveText('No Xero Project found for this job.');
  expect((await actions(page, 'job_detail')).map((f) => f.params)).toEqual([{ jobId: 'job-plain', slim: '1' }]);
  await expect(d.locator('[data-btp-ack]')).toHaveCount(0);
  const place = d.locator('[data-btp-act="place"]');
  await expect(place).toHaveText('Place on SWF-25010');
  await place.click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-big', job_id: 'job-plain' } }]);
  await expect(row(page, 'q-big')).toHaveCount(0);
  await expect(page.locator('#btpSummary')).toHaveText('4 open bills · $3,372.50 ex GST on no job · 5 placed · 2 not job related');
  await expect(page.locator('#btpJustDone [data-btp-done]')).toHaveText(['$8,450.00 Westside Steel WS-1001 placed on SWF-25010']);
});

test('a job already costed in Xero Projects says so and keeps Place shut until the operator ticks the bill is not in it', async ({ page }) => {
  await openOps(page);
  await openBills(page);
  await row(page, 'q-small').click();
  const d = detail(page, 'q-small');
  await d.locator('[data-btp-q="q-small"]').fill('SWP-26044');
  await d.locator('[data-btp-q="q-small"]').press('Enter');
  await d.locator('[data-btp-act="pick"][data-btp-job="job-proj"]').click();
  await expect(d.locator('[data-btp-project="costed"]')).toContainText('Already costed in Xero Projects');
  await expect(d.locator('[data-btp-project="costed"]')).toContainText('SWP-26044 Quinn Ashby patio, $12,400.00 of expenses');
  const place = d.locator('[data-btp-act="place"]');
  await expect(place).toBeDisabled();
  await shotPanel(page, '02-costed-in-xero-projects.png');
  await d.locator('[data-btp-ack="q-small"]').check();
  await expect(place).toBeEnabled();
  await place.click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-small', job_id: 'job-proj' } }]);
  await expect(row(page, 'q-small')).toHaveCount(0);
});

test('a failed Xero Projects read is not treated as "no project": Place waits for the tick', async ({ page }) => {
  await openOps(page, { refuse: { job_detail: 'job detail timed out' } });
  await openBills(page);
  await row(page, 'q-big').click();
  const d = detail(page, 'q-big');
  await d.locator('[data-btp-q="q-big"]').fill('Harper');
  await d.locator('[data-btp-act="find"]').click();
  await d.locator('[data-btp-act="pick"][data-btp-job="job-plain"]').click();
  await expect(d.locator('[data-btp-project="unknown"]')).toContainText('Could not check Xero Projects for this job (job detail timed out)');
  await expect(d.locator('[data-btp-act="place"]')).toBeDisabled();
  await d.locator('[data-btp-ack="q-big"]').check();
  await expect(d.locator('[data-btp-act="place"]')).toBeEnabled();
});

test("taking the queue's suggestion posts use_suggestion so the audit reads accept-suggestion", async ({ page }) => {
  await openOps(page);
  await openBills(page);
  await row(page, 'q-mid').click();
  const d = detail(page, 'q-mid');
  await expect(d).toContainText('Suggested: SWF-25500');
  await expect(d).toContainText('Reference found, no matching job');
  await d.locator('[data-btp-act="usesuggest"]').click();
  await expect(d.locator('[data-btp-picked]')).toContainText('SWF-25500 Rowan Pike');
  await d.locator('[data-btp-act="place"]').click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-mid', use_suggestion: true } }]);
});

test('Not job related posts materials_recon_not_job_related with the queue id only', async ({ page }) => {
  await openOps(page);
  await openBills(page);
  await row(page, 'q-small').click();
  await detail(page, 'q-small').locator('[data-btp-act="notjob"]').click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_not_job_related', body: { queue_id: 'q-small' } }]);
  await expect(row(page, 'q-small')).toHaveCount(0);
  await expect(page.locator('#btpSummary')).toHaveText('4 open bills · $11,610.00 ex GST on no job · 4 placed · 3 not job related');
  await expect(page.locator('#btpJustDone [data-btp-done]')).toHaveText(['$212.50 Bolt & Nut Supply BN-77 marked not job related']);
});

test('a refused write keeps the bill on the list and says why', async ({ page }) => {
  const refusal = 'bill xinv-q-big already has a materials fact on job SWF-24001 (source xero_ref_link); revert that fact before manual assignment';
  await openOps(page, { refuse: { materials_recon_assign: refusal } });
  await openBills(page);
  await row(page, 'q-big').click();
  const d = detail(page, 'q-big');
  await d.locator('[data-btp-q="q-big"]').fill('Harper');
  await d.locator('[data-btp-act="find"]').click();
  await d.locator('[data-btp-act="pick"][data-btp-job="job-plain"]').click();
  await d.locator('[data-btp-act="place"]').click();
  await expect(d.locator('[data-btp-err]')).toHaveText('Not placed: ' + refusal);
  await expect(row(page, 'q-big')).toHaveCount(1);
  await expect(page.locator('#btpSummary')).toContainText('5 open bills');
});

test('leaving the allowlist mid-session hides the tab and drops back to Invoices', async ({ page }) => {
  await openOps(page);
  await openBills(page);
  await page.evaluate((other) => { _opsUserEmail = other; syncJobProfitAccess(); }, OTHER);
  await expect(page.locator('#billsToPlaceTab')).toBeHidden();
  await expect(page.locator('#subInvoices')).toHaveClass(/active/);
  await expect(page.locator('tr[data-btp-row]')).toHaveCount(0);
});
