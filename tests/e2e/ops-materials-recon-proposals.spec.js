// Financials > Bill Reconciliation: the bill agent's proposals and the five presses on a queued bill (CFO-17):
// Confirm, Change job, Split, Overhead (not job related) and Leave.
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



function proposalFixture() {
  const f = buildFixture();
  // A job proposal: the backend fills Suggested job from it (suggestion_source agent_prematch).
  f.queue.rows.push(queueRow('q-agent', {
    contact_name: 'Fencing Wholesalers Example', invoice_number: 'FW-552301', sub_total: 1840.5, total: 2024.55, invoice_date: '2026-10-20',
    suggested_job_id: 'job-empty', suggested_job_number: 'SWP-26050', suggestion_confidence: 'medium', suggestion_source: 'agent_prematch',
    proposal: { kind: 'job', job_id: 'job-empty', job_number: 'SWP-26050', confidence: 'high', suggestion_confidence: 'medium', rule: 'po_job_number',
      reason: 'SWP-26050: job on the purchase order (PO-1000123 on reference); it names one live job and nothing points elsewhere.',
      candidates: [{ job_id: 'job-empty', job_number: 'SWP-26050', signals: ['po_job_number'] }], outcome: 'queued_for_review' },
  }));
  f.invoices['xinv-q-agent'] = { ok: true, invoice: {
    xero_invoice_id: 'xinv-q-agent', invoice_number: 'FW-552301', status: 'AUTHORISED', reference: 'PO-1000123', sub_total: 1840.5, total: 2024.55,
    amount_due: 2024.55, line_amount_types: 'Exclusive',
    line_items: [{ description: 'Colorbond panels 2400', quantity: 1, unit_amount: 1840.5, line_amount: 1840.5, account_code: '305', tracking: [] }],
  } };
  f.invoices['xinv-q-review'] = { ok: true, invoice: {
    xero_invoice_id: 'xinv-q-review', invoice_number: 'TJ-88', status: 'AUTHORISED', reference: null, sub_total: 640, total: 704,
    amount_due: 704, line_amount_types: 'Exclusive',
    line_items: [
      { description: 'Posts SWF-25010', quantity: 1, unit_amount: 400, line_amount: 400, account_code: '305', tracking: [] },
      { description: 'Rails SWP-26050', quantity: 1, unit_amount: 240, line_amount: 240, account_code: '305', tracking: [] },
    ],
  } };
  // A review: the agent saw two jobs and picked none.
  f.queue.rows.push(queueRow('q-review', {
    contact_name: 'Two Job Supplies', invoice_number: 'TJ-88', sub_total: 640, total: 704, invoice_date: '2026-10-18',
    proposal: { kind: 'review', job_id: null, job_number: null, confidence: 'low', suggestion_confidence: 'low', rule: 'split_bill',
      reason: 'The bill names more than one job: SWF-25010 (job number on the bill); SWP-26050 (job number on the bill).',
      candidates: [
        { job_id: 'job-plain', job_number: 'SWF-25010', signals: ['job_number'] },
        { job_id: 'job-empty', job_number: 'SWP-26050', signals: ['job_number'] },
      ], outcome: 'queued_for_review' },
  }));
  // Not job related: every line on an overhead account.
  f.queue.rows.push(queueRow('q-oh', {
    contact_name: 'Fuel Card Example', invoice_number: 'FC-10', sub_total: 320, total: 352, invoice_date: '2026-10-15',
    proposal: { kind: 'not_job_related', job_id: null, job_number: null, confidence: 'medium', suggestion_confidence: 'medium', rule: 'overhead_account',
      reason: 'Every line is on an overhead account (449).', candidates: [], outcome: 'queued_for_review' },
  }));
  f.queue.proposals = 'ok';
  return f;
}

test.use({ viewport: { width: 1360, height: 1000 } });

test('Confirm: the agent\'s job proposal shows its reason, and Use it places it as the person\'s press', async ({ page }) => {
  await openMaterials(page, { fixture: proposalFixture() });
  await expect(row(page, 'q-agent').locator('[data-mrq-by-agent]')).toHaveText('(agent)');
  await row(page, 'q-agent').click();
  const d = detail(page, 'q-agent');
  await expect(d.locator('[data-mrq-proposal="job"]')).toContainText('Bill agent suggests SWP-26050 (strong)');
  await expect(d.locator('[data-mrq-proposal="job"]')).toContainText('PO-1000123');
  await d.locator('[data-mrq-act="usesuggest"]').click();
  await expect(d.locator('[data-mrq-act="place"]')).toHaveText('Place on SWP-26050');
  await d.locator('[data-mrq-act="place"]').click();
  await expect.poll(() => posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-agent', use_suggestion: true } }]);
});

test('Change job: a review lists the jobs the agent saw, and picking one places it there', async ({ page }) => {
  await openMaterials(page, { fixture: proposalFixture() });
  await expect(row(page, 'q-review').locator('[data-mrq-cell-review]')).toHaveText('For a person');
  await row(page, 'q-review').click();
  const d = detail(page, 'q-review');
  await expect(d.locator('[data-mrq-proposal="review"]')).toContainText('The bill agent did not pick a job');
  await expect(d.locator('[data-mrq-cands] [data-mrq-act="pickcand"]')).toHaveCount(2);
  await expect(d).toContainText('use Split across jobs below');
  expect(await posts(page)).toEqual([]);
  await d.locator('[data-mrq-act="pickcand"][data-mrq-job="job-empty"]').click();
  await expect(d.locator('[data-mrq-picked]')).toContainText('SWP-26050');
  // Its lines name another job too, so placing whole takes a second press.
  await d.locator('[data-mrq-act="place"]').click();
  await expect(d.locator('[data-mrq-act="place"]')).toHaveText('Confirm: place all $640.00 on SWP-26050');
  expect(await posts(page)).toEqual([]);
  await page.waitForTimeout(ARM_GAP_MS);
  await d.locator('[data-mrq-act="place"]').click();
  await expect.poll(() => posts(page)).toEqual([{ action: 'materials_recon_assign', body: { queue_id: 'q-review', job_id: 'job-empty' } }]);
});

test('Split: a review that names two jobs can be split across them', async ({ page }) => {
  await openMaterials(page, { fixture: proposalFixture() });
  await row(page, 'q-review').click();
  const d = detail(page, 'q-review');
  await d.locator('[data-mrq-act="splitopen"]').click();
  await expect(d.locator('[data-mrq-act="splitsave"]')).toBeDisabled();
  expect(await posts(page)).toEqual([]);
});

test('Overhead: a not-job-related proposal says why, and filing it still takes two presses', async ({ page }) => {
  await openMaterials(page, { fixture: proposalFixture() });
  await expect(row(page, 'q-oh').locator('[data-mrq-cell-notjob]')).toHaveText('Not job related?');
  await row(page, 'q-oh').click();
  const d = detail(page, 'q-oh');
  await expect(d.locator('[data-mrq-proposal="not_job_related"]')).toContainText('overhead account (449)');
  await d.locator('[data-mrq-act="notjob"]').click();
  expect(await posts(page)).toEqual([]);
  await page.waitForTimeout(ARM_GAP_MS);
  await d.locator('[data-mrq-act="notjob"]').click();
  await expect.poll(() => posts(page)).toEqual([{ action: 'materials_recon_not_job_related', body: { queue_id: 'q-oh' } }]);
});

test('Leave: closes the bill, writes nothing, and the bill stays on the list', async ({ page }) => {
  await openMaterials(page, { fixture: proposalFixture() });
  await row(page, 'q-agent').click();
  const d = detail(page, 'q-agent');
  await d.locator('[data-mrq-act="usesuggest"]').click();
  await d.locator('[data-mrq-act="leave"]').click();
  await expect(detail(page, 'q-agent')).toHaveCount(0);
  await expect(row(page, 'q-agent')).toBeVisible();
  expect(await posts(page)).toEqual([]);
});

test('a failed proposal read says so on the bill, never "no suggestion"', async ({ page }) => {
  const f = proposalFixture();
  f.queue.proposals = 'failed';
  await openMaterials(page, { fixture: f });
  await row(page, 'q-big').click();
  await expect(detail(page, 'q-big').locator('[data-mrq-proposals-failed]')).toContainText('could not be read');
});

test('a bill with no proposal shows no agent line', async ({ page }) => {
  await openMaterials(page, { fixture: proposalFixture() });
  await row(page, 'q-big').click();
  const d = detail(page, 'q-big');
  await expect(d.locator('[data-mrq-proposal]')).toHaveCount(0);
  await expect(d.locator('[data-mrq-proposals-failed]')).toHaveCount(0);
});
