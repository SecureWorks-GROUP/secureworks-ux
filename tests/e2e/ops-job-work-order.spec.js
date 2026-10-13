// Ops job page: the job's work order on the Build tab and in the office Work
// Order PDF (docs/job-work-order-screens.md). Behind the preview switch
// (?wo=preview); with it off the Build tab and the PDF are unchanged.
//
// The page's own render functions run against a job_detail payload; opsFetch
// and opsPost are replaced in the page so every read and the one write
// (approve_work_order) are recorded and nothing reaches a server.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const SHAUN = 'shaun@secureworkswa.com.au';
const DRAFT_UPDATED_AT = '2026-10-13T03:04:05.123456+00:00';

function scopeItems() {
  return [
    { description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', kind: 'labour', rate_ex: 35, allocation_ex: 1316 },
    { description: 'Plinth install', qty: 21, unit: 'each', kind: 'labour', rate_ex: 10, allocation_ex: 210 },
    { description: 'Root removal / hard digging', qty: 2, unit: 'hrs', kind: 'labour', rate_ex: 80, allocation_ex: 160 },
    { description: 'Remove tree roots between 378/1 and 378/2', hours: 4, kind: 'labour', allocation_ex: 320, variation_number: 1, variation_approved_at: '2026-10-14T02:00:00Z' },
  ];
}

function workOrder(over) {
  return Object.assign({
    id: 'wo-1', job_id: 'job-fence-1', wo_number: 'WO-0042', kind: 'job', status: 'draft',
    scope_items: scopeItems(), special_instructions: 'Dog on site.', agreed_labour_ex: 2006,
    approved_at: null, updated_at: DRAFT_UPDATED_AT,
  }, over || {});
}

function detailPayload(wo) {
  const approved = wo && wo.status === 'approved';
  return {
    job: {
      id: 'job-fence-1', type: 'fencing', job_number: 'SWF-26904', status: 'accepted',
      client_name: 'Fixture Fence Client', site_address: '1 Fixture St', site_suburb: 'Dianella',
      scope_json: { job: { runs: [{ name: 'Run A', length: 37.6, panels: [{ height: 1800, retaining: 0 }] }], supplier: 'RNR' } },
      pricing_json: { totalExGST: 7030 },
    },
    documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [], purchase_orders: [],
    job_work_order: wo === undefined ? null : {
      work_order: wo,
      live_work_order_id: approved ? wo.id : null,
      draft_work_order_id: approved ? null : (wo && wo.id) || null,
      figures: approved
        ? { agreed_ex: 2006, billed_to_date_ex: 1000, variations_ex: 0, variation_count: 0, billed_within_agreed_scope_ex: 1000, remaining_ex: 1006, used_ratio: 0.4985, over_agreed: false, rules: [] }
        : { agreed_ex: null, billed_to_date_ex: 0, variations_ex: 0, variation_count: 0, billed_within_agreed_scope_ex: 0, remaining_ex: null, used_ratio: null, over_agreed: false, rules: [{ key: 'no_approved_work_order', level: 'info', message: 'No approved work order yet, so no labour counts against it.' }] },
      invoice_count: 0,
      variation_count: 0,
    },
  };
}

// Open the job page Build tab with the page's own functions, reads and the
// approve write answered by `answers` (keyed by action).
async function openBuild(page, data, answers, email) {
  await page.route('https://marninms98-dotcom.github.io/**', (route) => route.fulfill({ status: 200, body: '' }));
  await revealOpsStaticFixture(page);
  await page.evaluate(({ data, answers, email }) => {
    window.__calls = [];
    window.__answers = answers;
    _opsUserEmail = email;
    window.opsFetch = async function (action, params) {
      window.__calls.push({ method: 'GET', action, params });
      const a = window.__answers[action];
      if (a && a.reject) { const e = new Error(a.reject.message); e.code = a.reject.code; throw e; }
      return JSON.parse(JSON.stringify(Array.isArray(a) ? a.shift() : a));
    };
    window.opsPost = async function (action, body) {
      window.__calls.push({ method: 'POST', action, body });
      const a = window.__answers[action];
      if (a && a.reject) { const e = new Error(a.reject.message); e.code = a.reject.code; e.status = a.reject.status; throw e; }
      return JSON.parse(JSON.stringify(a || {}));
    };
    _currentJobId = data.job.id;
    _currentJobData = data;
    document.getElementById('jobDetailView').classList.add('active');
    showJobSubView('build');
  }, { data, answers, email });
}

test.describe('Job work order on the Ops job page (preview)', () => {
  test('preview off: the Build tab carries no work order panel', async ({ page }) => {
    await page.goto('/ops.html');
    await page.evaluate(() => { try { localStorage.removeItem('sw_wo_preview'); } catch (e) {} });
    await openBuild(page, detailPayload(workOrder()), {}, SHAUN);
    await expect(page.locator('#jdBuild')).toContainText('Materials Dispatch');
    await expect(page.locator('[data-job-wo-panel]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__calls.filter((c) => c.action === 'job_work_order').length)).toBe(0);
  });

  test('a draft shows its lines, hours and allocation; Shaun approves it with the updated_at he read', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const draft = workOrder();
    const approved = workOrder({ status: 'approved', approved_at: '2026-10-13T05:00:00Z', updated_at: '2026-10-13T05:00:00Z' });
    const detailRead = {
      schema: 'job-work-order.v1', work_order: draft, figures: detailPayload(draft).job_work_order.figures,
      invoices: [], lines: [], variations: [],
      labour_before_approval: { amount_ex: 195, line_count: 1, note: 'Labour billed on this job with no approved work order to count it against. It links and counts when the work order is approved.' },
    };
    await openBuild(page, detailPayload(draft), {
      job_work_order: [detailRead, Object.assign({}, detailRead, { work_order: approved, labour_before_approval: { amount_ex: 0, line_count: 0, note: '' } })],
      approve_work_order: { work_order: approved },
      job_detail: detailPayload(approved),
    }, SHAUN);

    const panel = page.locator('[data-job-wo-panel]');
    await expect(panel).toContainText('WO-0042');
    await expect(panel.locator('[data-job-wo-chip]')).toHaveText('Draft, not approved');
    await expect(panel).toContainText('Install Colorbond fencing');
    await expect(panel).toContainText('37.6 m');
    await expect(panel).toContainText('2 h');
    await expect(panel).toContainText('$1,316.00');
    await expect(panel.locator('[data-job-wo-addendum]')).toContainText('Variation 1');
    await expect(panel).toContainText('Agreed labour (draft)');
    await expect(panel).toContainText('$2,006.00');
    // The job_work_order read lands and adds what was billed before approval.
    await expect(panel).toContainText('Billed before approval');
    await expect(panel).toContainText('$195.00');

    await panel.locator('[data-job-wo-approve]').click();
    await expect(panel.locator('[data-job-wo-confirm]')).toContainText('Once sealed nothing on it can change');
    await panel.locator('[data-job-wo-approve-yes]').click();

    await expect(page.locator('[data-job-wo-chip]')).toHaveText('Approved and sealed');
    await expect(page.locator('[data-job-wo-message]')).toHaveText('Approved and sealed.');
    await expect(page.locator('[data-job-wo-approve]')).toHaveCount(0);
    await expect(page.locator('[data-job-wo-figures]')).toContainText('Billed to date');
    const posts = await page.evaluate(() => window.__calls.filter((c) => c.method === 'POST'));
    expect(posts).toHaveLength(1);
    expect(posts[0].action).toBe('approve_work_order');
    expect(posts[0].body).toEqual({ work_order_id: 'wo-1', expected_updated_at: DRAFT_UPDATED_AT });
  });

  test('a stale review is refused in words and the draft is read again before anyone approves', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const draft = workOrder();
    const moved = workOrder({ updated_at: '2026-10-13T04:00:00Z', agreed_labour_ex: 2100 });
    await openBuild(page, detailPayload(draft), {
      job_work_order: [{ work_order: draft, figures: {}, variations: [] }, { work_order: moved, figures: {}, variations: [] }],
      approve_work_order: { reject: { code: 'stale_review', status: 409, message: 'stale' } },
      job_detail: detailPayload(moved),
    }, SHAUN);
    await page.locator('[data-job-wo-approve]').click();
    await page.locator('[data-job-wo-approve-yes]').click();
    await expect(page.locator('[data-job-wo-message]')).toContainText('changed after it was read');
    await expect(page.locator('[data-job-wo-panel]')).toContainText('$2,100.00');
    await expect(page.locator('[data-job-wo-chip]')).toHaveText('Draft, not approved');
    const reads = await page.evaluate(() => window.__calls.filter((c) => c.action === 'job_detail').length);
    expect(reads).toBe(1);
  });

  test('every job_detail read reads the work order again, so a draft filled later is not shown empty', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const empty = workOrder({ scope_items: [], agreed_labour_ex: null });
    const filled = workOrder({ updated_at: '2026-10-13T06:00:00Z' });
    await openBuild(page, detailPayload(empty), {
      job_work_order: [{ work_order: empty, figures: {}, variations: [] }, { work_order: filled, figures: {}, variations: [] }],
      job_detail: detailPayload(filled),
    }, SHAUN);
    await expect(page.locator('[data-job-wo-no-lines]')).toBeVisible();
    await page.evaluate(() => refreshJobDetail());
    const panel = page.locator('[data-job-wo-panel]');
    await expect(panel).toContainText('Install Colorbond fencing');
    await expect(page.locator('[data-job-wo-no-lines]')).toHaveCount(0);
    await expect(page.locator('[data-job-wo-approve]')).toBeEnabled();
    const reads = await page.evaluate(() => window.__calls.filter((c) => c.action === 'job_work_order').length);
    expect(reads).toBe(2);
  });

  test('anyone but Shaun sees the work order with no Approve button', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    await openBuild(page, detailPayload(workOrder()), { job_work_order: { work_order: workOrder(), figures: {}, variations: [] } }, 'esther@secureworkswa.com.au');
    await expect(page.locator('[data-job-wo-panel]')).toContainText('WO-0042');
    await expect(page.locator('[data-job-wo-approve]')).toHaveCount(0);
  });

  test('an empty draft, a job with none yet, and a failed read each say so', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    await openBuild(page, detailPayload(workOrder({ scope_items: [], agreed_labour_ex: null })), { job_work_order: { reject: { code: 'x', message: 'down' } } }, SHAUN);
    await expect(page.locator('[data-job-wo-no-lines]')).toBeVisible();
    await expect(page.locator('[data-job-wo-approve]')).toBeDisabled();
    await expect(page.locator('[data-job-wo-detail-failed]')).toBeVisible();

    await openBuild(page, detailPayload(null), {}, SHAUN);
    await expect(page.locator('[data-job-wo-none]')).toBeVisible();

    const unreadable = detailPayload(workOrder());
    unreadable.job_work_order = { unreadable: true };
    await openBuild(page, unreadable, {}, SHAUN);
    await expect(page.locator('[data-job-wo-unreadable]')).toBeVisible();
  });

  test('the Work Order PDF prints the stored work order instead of the recomputed labour', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const printed = await page.evaluate((data) => {
      let html = '';
      window.open = () => ({ document: { write: (h) => { html += h; }, close() {} }, focus() {} });
      generateRichWorkOrder(data);
      return html;
    }, detailPayload(workOrder()));
    expect(printed).toContain('Work Order WO-0042');
    expect(printed).toContain('DRAFT: not approved yet');
    expect(printed).toContain('Root removal / hard digging');
    expect(printed).toContain('Variation 1');
    expect(printed).toContain('Agreed labour (draft)');
    expect(printed).toContain('$2,006.00');
    // The old rate copy's recomputed lines are gone.
    expect(printed).not.toContain('Labour base (');
    expect(printed).not.toContain('Margin');
    // The fence specification still prints from the scope.
    expect(printed).toContain('Fence Specification');
  });

  test('a patio job with a stored work order prints it too', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const data = detailPayload(workOrder({ scope_items: [{ description: 'Labour: 2 trades x 1.5 days', hours: 24, allocation_ex: 1080 }] }));
    data.job.type = 'patio';
    data.job.scope_json = { config: { length: 6, projection: 4 } };
    const printed = await page.evaluate((data) => {
      let html = '';
      window.open = () => ({ document: { write: (h) => { html += h; }, close() {} }, focus() {} });
      window.alert = (m) => { html = 'ALERT ' + m; };
      generateRichWorkOrder(data);
      return html;
    }, data);
    expect(printed).not.toContain('ALERT');
    expect(printed).toContain('Labour: 2 trades x 1.5 days');
    expect(printed).toContain('24 h');
    expect(printed).not.toContain('Fence Specification');
  });

  test('preview off: the Work Order PDF is the old printout', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    const printed = await page.evaluate((data) => {
      let html = '';
      window.open = () => ({ document: { write: (h) => { html += h; }, close() {} }, focus() {} });
      generateRichWorkOrder(data);
      return html;
    }, detailPayload(workOrder()));
    expect(printed).toContain('Labour base (37.6m @ $35/m)');
    expect(printed).toContain('Margin');
    expect(printed).not.toContain('WO-0042');
  });
});
