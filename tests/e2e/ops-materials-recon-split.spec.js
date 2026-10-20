// Financials > Bill Reconciliation: Split across jobs, overhead part and installer Confirm (CFO-17).
// Offline fixture, made-up suppliers, jobs and amounts. No live write.
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
      if (action === 'materials_recon_split') return copy({ ok: true, action: 'split' });
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


// Shared installer bill: the Emeka Henry style case (one installer, several jobs). Made-up figures.
function splitFixture() {
  const f = buildFixture();
  f.queue.rows.push(queueRow('q-inst', { contact_name: 'Installer Example', invoice_number: 'IE-31', sub_total: 1000, total: 1100, invoice_date: '2026-10-05' }));
  f.invoices['xinv-q-inst'] = {
    ok: true,
    invoice: {
      xero_invoice_id: 'xinv-q-inst', invoice_number: 'IE-31', status: 'AUTHORISED', sub_total: 1000, total: 1100, amount_due: 1100,
      line_amount_types: 'Exclusive',
      line_items: [
        { description: 'Install fence SWF-25010', quantity: 1, unit_amount: 600, line_amount: 600, account_code: '306', tracking: [] },
        { description: 'Install patio SWP-26050', quantity: 1, unit_amount: 400, line_amount: 400, account_code: '306', tracking: [] },
      ],
    },
  };
  return f;
}

async function addSplitJob(d, id, query, jobId) {
  await d.locator('[data-mrq-sq="' + id + '"]').fill(query);
  await d.locator('[data-mrq-act="splitfind"]').click();
  await d.locator('[data-mrq-act="splitpick"][data-mrq-job="' + jobId + '"]').click();
}

test.use({ viewport: { width: 1360, height: 1000 } });

test('an installer bill says so and Place reads Confirm and place', async ({ page }) => {
  await openMaterials(page, { fixture: splitFixture() });
  await row(page, 'q-inst').click();
  const d = detail(page, 'q-inst');
  await expect(d.locator('[data-mrq-installer]')).toContainText('Installer bill');
  await pickSearched(page, 'q-inst', 'Ellis', 'job-empty');
  await expect(d.locator('[data-mrq-act="place"]')).toHaveText('Confirm and place on SWP-26050');
  await row(page, 'q-big').click();
  await expect(detail(page, 'q-big').locator('[data-mrq-installer]')).toHaveCount(0);
});

test('split keeps Save shut until the parts and overhead add up to the bill to the cent', async ({ page }) => {
  await openMaterials(page, { fixture: splitFixture() });
  await row(page, 'q-inst').click();
  const d = detail(page, 'q-inst');
  await d.locator('[data-mrq-act="splitopen"]').click();
  await addSplitJob(d, 'q-inst', 'Ellis', 'job-empty');
  await addSplitJob(d, 'q-inst', 'Harper', 'job-plain');
  const save = d.locator('[data-mrq-act="splitsave"]');
  const amts = d.locator('[data-mrq-amt="q-inst"]');
  await expect(amts).toHaveCount(2);
  await expect(save).toBeDisabled();
  await amts.nth(0).fill('400');
  await amts.nth(1).fill('599.99');
  await expect(d.locator('[data-mrq-left]')).toHaveText('Left to place: $0.01');
  await expect(save).toBeDisabled();
  await d.locator('[data-mrq-oh="q-inst"]').fill('0.02');
  await expect(d.locator('[data-mrq-left]')).toHaveText('Over the bill by: $0.01');
  await expect(save).toBeDisabled();
  await d.locator('[data-mrq-oh="q-inst"]').fill('0.01');
  await expect(d.locator('[data-mrq-left]')).toHaveText('Balanced: the parts and overhead add up to the bill.');
  await expect(save).toBeEnabled();
  await amts.nth(0).fill('0');
  await expect(d.locator('[data-mrq-left]')).toHaveText('Every part needs an amount above $0.00, in dollars and cents.');
  await expect(save).toBeDisabled();
  expect(await posts(page)).toEqual([]);
});

test('an installer split saves on the second press as labour, and leaves the list', async ({ page }) => {
  await openMaterials(page, { fixture: splitFixture() });
  await row(page, 'q-inst').click();
  const d = detail(page, 'q-inst');
  await d.locator('[data-mrq-act="splitopen"]').click();
  await addSplitJob(d, 'q-inst', 'Ellis', 'job-empty');
  await addSplitJob(d, 'q-inst', 'Harper', 'job-plain');
  const amts = d.locator('[data-mrq-amt="q-inst"]');
  await amts.nth(0).fill('400');
  await amts.nth(1).fill('600');
  const save = d.locator('[data-mrq-act="splitsave"]');
  await expect(save).toHaveText('Confirm and save the split');
  await save.dblclick();
  expect(await posts(page)).toEqual([]);
  await expect(save).toHaveText('Confirm: split $1,000.00 across 2 jobs');
  await page.waitForTimeout(ARM_GAP_MS);
  await save.click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_split', body: {
    xero_invoice_id: 'xinv-q-inst',
    parts: [{ job_id: 'job-empty', amount_ex: 400, lane: 'labour' }, { job_id: 'job-plain', amount_ex: 600, lane: 'labour' }],
    overhead_ex: 0, overhead_note: null,
  } }]);
  await expect(row(page, 'q-inst')).toHaveCount(0);
  await expect(page.locator('#matReconJustDone [data-mrq-done]')).toHaveText(['$1,000.00 Installer Example IE-31 split across SWP-26050, SWF-25010']);
});

test('a supplier bill split with an overhead part goes as materials; a costed project needs its tick', async ({ page }) => {
  await openMaterials(page);
  await row(page, 'q-big').click();
  const d = detail(page, 'q-big');
  await d.locator('[data-mrq-act="splitopen"]').click();
  await addSplitJob(d, 'q-big', 'Quinn', 'job-proj');
  await expect(d.locator('[data-mrq-split] [data-mrq-project="costed"]')).toBeVisible();
  await d.locator('[data-mrq-amt="q-big"]').fill('8000');
  await d.locator('[data-mrq-oh="q-big"]').fill('450');
  await d.locator('[data-mrq-ohnote="q-big"]').fill('Yard stock');
  const save = d.locator('[data-mrq-act="splitsave"]');
  await expect(save).toBeDisabled();
  await d.locator('[data-mrq-sack="q-big"]').check();
  await expect(save).toBeEnabled();
  await expect(save).toHaveText('Save the split');
  await save.click();
  await page.waitForTimeout(ARM_GAP_MS);
  await save.click();
  expect(await posts(page)).toEqual([{ action: 'materials_recon_split', body: {
    xero_invoice_id: 'xinv-q-big',
    parts: [{ job_id: 'job-proj', amount_ex: 8000, lane: 'materials' }],
    overhead_ex: 450, overhead_note: 'Yard stock',
  } }]);
});

test('a refused split keeps the bill and shows the server words', async ({ page }) => {
  await openMaterials(page, { fixture: splitFixture(), refuse: { materials_recon_split: 'Split refused: SWP-26050 is a holding job' } });
  await row(page, 'q-inst').click();
  const d = detail(page, 'q-inst');
  await d.locator('[data-mrq-act="splitopen"]').click();
  await addSplitJob(d, 'q-inst', 'Ellis', 'job-empty');
  await d.locator('[data-mrq-amt="q-inst"]').fill('1000');
  const save = d.locator('[data-mrq-act="splitsave"]');
  await save.click();
  await page.waitForTimeout(ARM_GAP_MS);
  await save.click();
  await expect(d.locator('[data-mrq-err]')).toHaveText('Not split: Split refused: SWP-26050 is a holding job');
  await expect(row(page, 'q-inst')).toHaveCount(1);
});
