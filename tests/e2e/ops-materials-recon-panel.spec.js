// Financials > Bill Reconciliation (ops.html, search // <materials-recon>). Offline: ops-api is
// replaced in the page by the fixture below (made-up suppliers, jobs and amounts). No live write.
//
// Contract under guard:
//  - The list is materials_recon_queue (limit 1000), largest ex-GST bill first. A list short of its
//    limit holds every open bill, so the open count and dollars are exact and come from its rows. A
//    full list reads "at least" for the open figures and says it is capped. The placed and
//    not-job-related counts come from stats and read "at least" once stats.total_rows >= 1000.
//  - Opening a bill reads its lines through get_xero_invoice (never get_xero_bill, which writes the
//    local Xero cache) and shows each line's Business Unit.
//  - Place posts materials_recon_assign { queue_id, job_id } for a searched job, or
//    { queue_id, use_suggestion: true } for the queue's own suggestion; Not job related posts
//    materials_recon_not_job_related { queue_id } on its second press. No confirm() dialog is ever
//    raised. A second press inside the arming window (a double-click) files nothing.
//  - A failed queue read shows the error, never "Queue clear", 0 bills or $0.00, even after a search.
//  - A get_xero_invoice answer with no `invoice` says the lines could not be read.
//  - A job already costed in Xero Projects keeps Place shut until the operator ticks the bill is not
//    in it. A null xero_project, or a failed job_detail read, says Xero Projects is not confirmed
//    and Place needs a second confirming press; a project with zero expenses places in one press.
//  - A refused write keeps the bill on the list and shows the server's message.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const UNCONFIRMED = 'Xero Projects not confirmed for this job: check Xero before placing';

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
      stats: { open: 3, assigned: 4, not_job_related: 2, total_rows: 9, open_total_inc: 11684.75, open_total_ex: 10622.5 },
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
        { id: 'job-empty', job_number: 'SWP-26050', client_name: 'Ellis Moor', site_suburb: 'Hillcrest', type: 'patio', status: 'scheduled' },
      ],
    },
    jobs: {
      'job-plain': { job: { id: 'job-plain', job_number: 'SWF-25010', client_name: 'Harper Lane', site_address: '4 Example Rd, Bayview', type: 'fencing', status: 'complete' }, xero_project: null },
      'job-proj': {
        job: { id: 'job-proj', job_number: 'SWP-26044', client_name: 'Quinn Ashby', site_address: '9 Sample St, Hillcrest', type: 'patio', status: 'complete' },
        xero_project: { project_name: 'SWP-26044 Quinn Ashby patio', total_invoiced: 21000, total_expenses: 12400 },
      },
      'job-empty': {
        job: { id: 'job-empty', job_number: 'SWP-26050', client_name: 'Ellis Moor', site_address: '2 Sample St, Hillcrest', type: 'patio', status: 'scheduled' },
        xero_project: { project_name: 'SWP-26050 Ellis Moor patio', total_invoiced: 0, total_expenses: 0 },
      },
      'job-sugg': {
        job: { id: 'job-sugg', job_number: 'SWF-25500', client_name: 'Rowan Pike', site_address: '1 Demo Ave, Lakeside', type: 'fencing', status: 'invoiced' },
        xero_project: { project_name: 'SWF-25500 Rowan Pike fence', total_invoiced: 4000, total_expenses: 0 },
      },
    },
  };
}

// The panel ignores a second press inside 700 ms of arming (MAT_RECON_ARM_GAP_MS).
const ARM_GAP_MS = 800;

async function openMaterials(page, { fixture = buildFixture(), refuse = {}, expectRows = true } = {}) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ fixture, refuse }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__mrqFetches = [];
    window.__mrqPosts = [];
    const copy = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
    const fail = (msg, status) => { const e = new Error(msg); e.status = status || 500; return Promise.reject(e); };
    window.opsFetch = (action, params) => {
      window.__mrqFetches.push({ action, params: params || {} });
      if (action === 'materials_recon_queue') return refuse.materials_recon_queue ? fail(refuse.materials_recon_queue) : copy(fixture.queue);
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
      return copy({}); // the Materials pipeline's own reads are irrelevant here
    };
    window.opsPost = (action, body) => {
      window.__mrqPosts.push({ action, body });
      if (refuse[action]) return fail(refuse[action]);
      if (action === 'materials_recon_assign') return copy({ ok: true, action: body.use_suggestion ? 'accept-suggestion' : 'assign-to-job' });
      if (action === 'materials_recon_not_job_related') return copy({ ok: true, action: 'mark-not-job-related' });
      return fail('Unknown action', 400);
    };
    showView('financials');
    showSubTab('billrecon');
  }, { fixture, refuse });
  if (expectRows) await expect(page.locator('#matReconPanel tr[data-mrq-row]').first()).toBeVisible();
}

function row(page, id) { return page.locator('tr[data-mrq-row="' + id + '"]'); }
function detail(page, id) { return page.locator('tr[data-mrq-detail="' + id + '"]'); }
async function actions(page, name) {
  return page.evaluate((n) => window.__mrqFetches.filter((f) => f.action === n), name);
}
async function posts(page) { return page.evaluate(() => window.__mrqPosts); }
async function pickSearched(page, id, query, jobId) {
  const d = detail(page, id);
  await d.locator('[data-mrq-q="' + id + '"]').fill(query);
  await d.locator('[data-mrq-act="find"]').click();
  await d.locator('[data-mrq-act="pick"][data-mrq-job="' + jobId + '"]').click();
  return d;
}

test.use({ viewport: { width: 1360, height: 1000 } });

function fillerRows(n) {
  return Array.from({ length: n }, (_, i) => queueRow('q-fill-' + i, { sub_total: 50, total: 55, invoice_date: '2026-08-01' }));
}

test('the list is largest first, with the exact open count and dollars and no capped note', async ({ page }) => {
  await openMaterials(page);
  const reads = await actions(page, 'materials_recon_queue');
  expect(reads.map((r) => r.params)).toEqual([{ status: 'open', limit: 1000 }]);
  expect(await page.locator('tr[data-mrq-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mrq-row')))).toEqual(['q-big', 'q-mid', 'q-small']);
  expect(await page.locator('#matReconPanel .mrq-table th').allTextContents()).toEqual(['Supplier', 'Date', 'Bill #', 'Amount ex GST', 'Business Unit', 'Suggested job']);
  await expect(row(page, 'q-big')).toContainText('$8,450.00');
  await expect(row(page, 'q-big')).toContainText('Westside Steel');
  await expect(row(page, 'q-big')).toContainText('WS-1001');
  await expect(row(page, 'q-big')).toContainText(/20 Sept? 2026/);
  await expect(row(page, 'q-mid')).toContainText('SWF-25500');
  await expect(page.locator('#matReconOpenCount')).toHaveText('3');
  await expect(page.locator('#matReconSummary')).toHaveText('3 open bills · $10,622.50 ex GST on no job · 4 placed · 2 not job related');
  await expect(page.locator('#matReconCapNote')).toBeHidden();
});

test('a well-worked queue (300 open of 1,200 rows ever) reads its open bills exactly; only the stats counts read "at least"', async ({ page }) => {
  const fixture = buildFixture();
  fixture.queue.rows = fixture.queue.rows.concat(fillerRows(297));
  fixture.queue.stats = { open: 300, assigned: 850, not_job_related: 50, total_rows: 1200, open_total_ex: 25472.5 };
  await openMaterials(page, { fixture });
  await expect(page.locator('#matReconOpenCount')).toHaveText('300');
  await expect(page.locator('#matReconSummary')).toHaveText('300 open bills · $25,472.50 ex GST on no job · at least 850 placed · at least 50 not job related');
  await expect(page.locator('#matReconCapNote')).toBeHidden();
});

test('a full 1,000-row list reads "at least" for the open figures and says the list is capped', async ({ page }) => {
  const fixture = buildFixture();
  fixture.queue.rows = fixture.queue.rows.concat(fillerRows(997));
  // The stats read is cut at the cap too and can undercount below the loaded list.
  fixture.queue.stats = { open: 940, assigned: 400, not_job_related: 60, total_rows: 1400, open_total_ex: 40000 };
  await openMaterials(page, { fixture });
  await expect(page.locator('#matReconOpenCount')).toHaveText('1000+');
  await expect(page.locator('#matReconSummary')).toHaveText('at least 1000 open bills · at least $60,472.50 ex GST on no job · at least 400 placed · at least 60 not job related');
  await expect(page.locator('#matReconCapNote')).toHaveText('This list holds the 1,000 newest open bills, largest first. There may be more open bills than it counts; older ones come in on Refresh as these are placed.');
});

test('missing stats fall back to the loaded rows', async ({ page }) => {
  const fixture = buildFixture();
  delete fixture.queue.stats;
  await openMaterials(page, { fixture });
  await expect(page.locator('#matReconSummary')).toHaveText('3 open bills · $10,622.50 ex GST on no job');
  await expect(page.locator('#matReconCapNote')).toBeHidden();
});

test('opening a bill reads its lines with get_xero_invoice and shows each line and its Business Unit', async ({ page }) => {
  await openMaterials(page);
  await row(page, 'q-big').click();
  const d = detail(page, 'q-big');
  await expect(d.locator('tr[data-mrq-line]')).toHaveCount(2);
  await expect(d.locator('tr[data-mrq-line]').first()).toContainText('Colorbond sheets 2100');
  await expect(d.locator('tr[data-mrq-line]').first()).toContainText('305');
  await expect(d.locator('tr[data-mrq-line]').first()).toContainText('Fencing');
  await expect(d.locator('tr[data-mrq-line]').first()).toContainText('$6,000.00');
  await expect(d).toContainText('Reference: Order 4471');
  await expect(row(page, 'q-big').locator('[data-mrq-bu]')).toHaveText('Fencing');
  expect((await actions(page, 'get_xero_invoice')).map((f) => f.params)).toEqual([{ xero_invoice_id: 'xinv-q-big' }]);
  expect(await actions(page, 'get_xero_bill')).toEqual([]);
  await row(page, 'q-small').click();
  await expect(detail(page, 'q-small')).toContainText("Could not read the bill's lines: Xero invoice not found");
  await expect(detail(page, 'q-small').locator('[data-mrq-act="notjob"]')).toBeEnabled();
});

test('a get_xero_invoice answer with no invoice says the lines could not be read, never an empty bill', async ({ page }) => {
  const fixture = buildFixture();
  fixture.invoices['xinv-q-mid'] = { ok: true, bill: { line_items: [] } };
  await openMaterials(page, { fixture });
  await row(page, 'q-mid').click();
  await expect(detail(page, 'q-mid')).toContainText("Could not read the bill's lines: no bill came back from Xero");
  await expect(detail(page, 'q-mid')).not.toContainText('No lines on this bill');
});

test('a failed queue read shows the error, never "Queue clear" or $0.00, even after a search', async ({ page }) => {
  await openMaterials(page, { refuse: { materials_recon_queue: 'ops-api timed out' }, expectRows: false });
  const body = page.locator('#matReconBody');
  await expect(body.locator('[data-mrq-load-err]')).toContainText('Could not read the bill queue: ops-api timed out');
  await page.locator('#matReconSearch').fill('steel');
  for (const el of [body, page.locator('#matReconSummary'), page.locator('#matReconOpenCount')]) {
    await expect(el).not.toContainText('Queue clear');
    await expect(el).not.toContainText('$0.00');
    await expect(el).not.toContainText('0 open bills');
  }
  await expect(page.locator('#matReconOpenCount')).toHaveText('—');
  await expect(body.locator('[data-mrq-load-err]')).toBeVisible();
});

test('a double-click on Not job related, or on an unconfirmed Place, files nothing', async ({ page }) => {
  await openMaterials(page);
  await row(page, 'q-small').click();
  const notjob = detail(page, 'q-small').locator('[data-mrq-act="notjob"]');
  await notjob.dblclick();
  await expect(notjob).toHaveText('Confirm: not job related');
  await row(page, 'q-big').click();
  const d = await pickSearched(page, 'q-big', 'Harper', 'job-plain');
  const place = d.locator('[data-mrq-act="place"]');
  await place.dblclick();
  await expect(place).toHaveText('Confirm: place on SWF-25010 without Xero Projects');
  expect(await posts(page)).toEqual([]);
});

test('a job with a zero-expense Xero Project places in one press with { queue_id, job_id }', async ({ page }) => {
  await openMaterials(page);
  await row(page, 'q-big').click();
  await expect(detail(page, 'q-big').locator('[data-mrq-act="place"]')).toBeDisabled();
  const d = await pickSearched(page, 'q-big', 'Ellis', 'job-empty');
  expect((await actions(page, 'search_jobs')).map((f) => f.params)).toEqual([{ q: 'Ellis' }]);
  await expect(d.locator('[data-mrq-project="empty"]')).toContainText('has no expenses yet');
  expect((await actions(page, 'job_detail')).map((f) => f.params)).toEqual([{ jobId: 'job-empty', slim: '1' }]);
  await expect(d.locator('[data-mrq-ack]')).toHaveCount(0);
  await d.locator('[data-mrq-act="place"]').click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-big', job_id: 'job-empty' } }]);
  await expect(row(page, 'q-big')).toHaveCount(0);
  await expect(page.locator('#matReconSummary')).toHaveText('2 open bills · $2,172.50 ex GST on no job · 5 placed · 2 not job related');
  await expect(page.locator('#matReconJustDone [data-mrq-done]')).toHaveText(['$8,450.00 Westside Steel WS-1001 placed on SWP-26050']);
});

test('a null Xero Project is "not confirmed", never "no project", and Place needs a second confirming press', async ({ page }) => {
  await openMaterials(page);
  await row(page, 'q-big').click();
  const d = await pickSearched(page, 'q-big', 'Harper', 'job-plain');
  await expect(d.locator('[data-mrq-project="unconfirmed"]')).toHaveText(UNCONFIRMED);
  await expect(d).not.toContainText('No Xero Project found');
  const place = d.locator('[data-mrq-act="place"]');
  await expect(place).toHaveText('Place on SWF-25010');
  await place.click();
  await expect(place).toHaveText('Confirm: place on SWF-25010 without Xero Projects');
  expect(await posts(page)).toEqual([]);
  await page.waitForTimeout(ARM_GAP_MS);
  await place.click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-big', job_id: 'job-plain' } }]);
  await expect(row(page, 'q-big')).toHaveCount(0);
});

test('a failed job_detail read behaves like a null project', async ({ page }) => {
  await openMaterials(page, { refuse: { job_detail: 'job detail timed out' } });
  await row(page, 'q-big').click();
  const d = await pickSearched(page, 'q-big', 'Ellis', 'job-empty');
  await expect(d.locator('[data-mrq-project="unconfirmed"]')).toHaveText(UNCONFIRMED);
  const place = d.locator('[data-mrq-act="place"]');
  await place.click();
  expect(await posts(page)).toEqual([]);
  await expect(place).toHaveText('Confirm: place on SWP-26050 without Xero Projects');
  await page.waitForTimeout(ARM_GAP_MS);
  await place.click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-big', job_id: 'job-empty' } }]);
});

test('a job already costed in Xero Projects keeps Place shut until the operator ticks the bill is not in it', async ({ page }) => {
  await openMaterials(page);
  await row(page, 'q-small').click();
  const d = detail(page, 'q-small');
  await d.locator('[data-mrq-q="q-small"]').fill('SWP-26044');
  await d.locator('[data-mrq-q="q-small"]').press('Enter');
  await d.locator('[data-mrq-act="pick"][data-mrq-job="job-proj"]').click();
  await expect(d.locator('[data-mrq-project="costed"]')).toContainText('Already costed in Xero Projects');
  await expect(d.locator('[data-mrq-project="costed"]')).toContainText('SWP-26044 Quinn Ashby patio, $12,400.00 of expenses');
  const place = d.locator('[data-mrq-act="place"]');
  await expect(place).toBeDisabled();
  await d.locator('[data-mrq-ack="q-small"]').check();
  await expect(place).toBeEnabled();
  await place.click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-small', job_id: 'job-proj' } }]);
  await expect(row(page, 'q-small')).toHaveCount(0);
});

test("taking the queue's suggestion posts use_suggestion so the audit reads accept-suggestion", async ({ page }) => {
  await openMaterials(page);
  await row(page, 'q-mid').click();
  const d = detail(page, 'q-mid');
  await expect(d).toContainText('Suggested: SWF-25500');
  await expect(d).toContainText('Reference found, no matching job');
  await d.locator('[data-mrq-act="usesuggest"]').click();
  await expect(d.locator('[data-mrq-picked]')).toContainText('SWF-25500 Rowan Pike');
  await d.locator('[data-mrq-act="place"]').click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-mid', use_suggestion: true } }]);
});

test('Not job related takes two presses, then posts materials_recon_not_job_related with the queue id only', async ({ page }) => {
  await openMaterials(page);
  await row(page, 'q-small').click();
  const notjob = detail(page, 'q-small').locator('[data-mrq-act="notjob"]');
  await notjob.click();
  await expect(notjob).toHaveText('Confirm: not job related');
  expect(await posts(page)).toEqual([]);
  await page.waitForTimeout(ARM_GAP_MS);
  await notjob.click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_not_job_related', body: { queue_id: 'q-small' } }]);
  await expect(row(page, 'q-small')).toHaveCount(0);
  await expect(page.locator('#matReconSummary')).toHaveText('2 open bills · $10,410.00 ex GST on no job · 4 placed · 3 not job related');
});

test('a refused write keeps the bill on the list and shows the server message', async ({ page }) => {
  const refusal = 'bill xinv-q-big already has a materials fact on job SWF-24001 (source xero_ref_link); revert that fact before manual assignment';
  await openMaterials(page, { refuse: { materials_recon_assign: refusal } });
  await row(page, 'q-big').click();
  const d = await pickSearched(page, 'q-big', 'Ellis', 'job-empty');
  await d.locator('[data-mrq-act="place"]').click();
  await expect(d.locator('[data-mrq-err]')).toHaveText('Not placed: ' + refusal);
  await expect(row(page, 'q-big')).toHaveCount(1);
  await expect(page.locator('#matReconSummary')).toContainText('3 open bills');
});
