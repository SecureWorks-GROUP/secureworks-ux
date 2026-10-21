// Ops job page: the job's work order on the Build tab, the Overview, and in
// the office Work Order PDF (docs/job-work-order-screens.md). On for office,
// every job type. ?wo=live does not hide it and does not bring back the old
// crew form. A trade role sees none of it.
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
    { description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', kind: 'labour', rate: 35, rate_unit: 'm', total: 1316 },
    { description: 'Plinth install', qty: 21, unit: 'each', kind: 'labour', rate: 10, rate_unit: 'each', total: 210 },
    { description: 'Root removal / hard digging', qty: 2, unit: 'hrs', kind: 'labour', rate: 80, rate_unit: 'hr', total: 160 },
    { description: 'Remove tree roots between 378/1 and 378/2', hours: 4, kind: 'labour', total: 320, variation_number: 1, variation_approved_at: '2026-10-14T02:00:00Z' },
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

// Same stub as openBuild, on a chosen job tab, with an optional trade role.
async function openSurface(page, tab, data, answers, email, role) {
  await page.route('https://marninms98-dotcom.github.io/**', (route) => route.fulfill({ status: 200, body: '' }));
  await revealOpsStaticFixture(page);
  await page.evaluate(({ data, answers, email, role, tab }) => {
    window.__calls = [];
    window.__answers = answers;
    _opsUserEmail = email;
    if (role) {
      window.SECUREWORKS_CLOUD = {
        auth: {
          getRole: function () { return role; },
          isLoggedIn: function () { return true; },
        },
      };
    }
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
    showJobSubView(tab);
  }, { data, answers, email, role: role || '', tab });
}

function overviewRead(wo, lines, figures) {
  return {
    job_work_order: {
      schema: 'job-work-order.v1',
      work_order: wo,
      figures: figures,
      lines: lines,
      variations: [],
      labour_before_approval: { amount_ex: 0, line_count: 0, note: '' },
    },
    list_job_actions: [],
    list_trade_invoice_lines: { lines: [] },
  };
}

test.describe('Job work order on the Ops job page', () => {
  test('office by default: the Build tab shows the work order panel with no preview setting', async ({ page }) => {
    await page.goto('/ops.html');
    await page.evaluate(() => { try { localStorage.removeItem('sw_wo_preview'); } catch (e) {} });
    const draft = workOrder();
    await openBuild(page, detailPayload(draft), {
      job_work_order: { work_order: draft, figures: detailPayload(draft).job_work_order.figures, lines: [], variations: [] },
    }, SHAUN);
    await expect(page.locator('#jdBuild')).toContainText('Materials Dispatch');
    const panel = page.locator('[data-job-wo-panel]');
    await expect(panel).toContainText('WO-0042');
    await expect(panel).toContainText('Agreed labour');
    await expect(panel.locator('.jwo-preview')).toHaveCount(0);
    expect(await page.evaluate(() => window.__calls.filter((c) => c.action === 'job_work_order').length)).toBeGreaterThan(0);
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

  test('real jobs: the allocation comes from the quote lines the backend sends (rate, rate_unit, total)', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    // The quote line builder's shape (backend docs/quote-work-order-lines-v1.md).
    const lines = [
      { line_key: 'install:0', source: 'quote', basis: 'fence_install', description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', hours: null, rate: 35, rate_unit: 'm', total: 1316, counted: true, flags: [], needs_review: false },
      { line_key: 'plinths', source: 'quote', basis: 'fence_plinths', description: 'Plinth install', qty: 21, unit: 'each', hours: null, rate: 10, rate_unit: 'each', total: 210, counted: true, flags: [], needs_review: false },
      { line_key: 'extra:5', source: 'quote', basis: 'quote_extra', description: 'Root removal / hard digging', qty: 2, unit: 'hrs', hours: 2, rate: 80, rate_unit: 'hr', total: 160, counted: false, flags: ['saved_as_material', 'outside_quote_labour'], needs_review: true },
    ];
    const draft = workOrder({ scope_items: lines, agreed_labour_ex: 1526 });
    await openBuild(page, detailPayload(draft), { job_work_order: { work_order: draft, figures: {}, variations: [] } }, SHAUN);
    const table = page.locator('[data-job-wo-panel] [data-job-wo-lines]').first();
    await expect(table.locator('thead')).toContainText('Allocation');
    const install = table.locator('tbody tr').filter({ hasText: 'Install Colorbond fencing' });
    await expect(install).toContainText('$1,316.00');
    await expect(install).toContainText('$35.00/m');
    const roots = table.locator('tbody tr').filter({ hasText: 'Root removal / hard digging' });
    await expect(roots).toContainText('$160.00');
    await expect(roots).toContainText('$80.00/h');
    await expect(roots.locator('[data-job-wo-not-counted]')).toHaveText('Not in the agreed labour');
    await expect(table.locator('tfoot')).toContainText('$1,526.00');
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
    await expect(page.locator('[data-job-wo-none]')).toContainText('Work order not filled yet');

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
    const data = detailPayload(workOrder({ scope_items: [{ description: 'Labour: 2 trades x 1.5 days', hours: 24, total: 1080 }] }));
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

  test('?wo=live still prints the stored work order', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    const printed = await page.evaluate((data) => {
      let html = '';
      window.open = () => ({ document: { write: (h) => { html += h; }, close() {} }, focus() {} });
      generateRichWorkOrder(data);
      return html;
    }, detailPayload(workOrder()));
    expect(printed).toContain('Work Order WO-0042');
    expect(printed).toContain('Agreed labour (draft)');
    expect(printed).not.toContain('Labour base (37.6m @ $35/m)');
  });
});

// "Create work order" leads to the job work order for every job type. The old
// office form does not write kind='crew', and ?wo=live does not bring it back.
const FENCE_JOB = { id: 'job-fence-1', job_number: 'SWF-26904', type: 'fencing', status: 'accepted', client_name: 'Fixture Fence Client', site_suburb: 'Dianella' };
const PATIO_JOB = { id: 'job-patio-1', job_number: 'SWP-261542', type: 'patio', status: 'accepted', client_name: 'Fixture Patio Client', site_suburb: 'Bayswater' };
const REPAIR_JOB = { id: 'job-repair-1', job_number: 'SWR-26001', type: 'repair', status: 'accepted', client_name: 'Fixture Repair Client', site_suburb: 'Morley' };

// The page's own functions with every read and write answered by `answers`.
async function stubOps(page, answers, email) {
  await page.route('https://marninms98-dotcom.github.io/**', (route) => route.fulfill({ status: 200, body: '' }));
  await revealOpsStaticFixture(page);
  await page.evaluate(({ answers, email }) => {
    window.__calls = [];
    window.__answers = answers;
    _opsUserEmail = email;
    _poJobList = [];
    window.opsFetch = async function (action, params) {
      window.__calls.push({ method: 'GET', action, params });
      const a = window.__answers[action];
      if (a === undefined) throw new Error('no fixture for ' + action);
      if (a && a.reject) { const e = new Error(a.reject.message); e.code = a.reject.code; throw e; }
      return JSON.parse(JSON.stringify(Array.isArray(a) ? a.shift() : a));
    };
    window.opsPost = async function (action, body) {
      window.__calls.push({ method: 'POST', action, body });
      const a = window.__answers[action];
      if (a && a.reject) { const e = new Error(a.reject.message); e.code = a.reject.code; e.status = a.reject.status; throw e; }
      return JSON.parse(JSON.stringify(a || {}));
    };
  }, { answers, email });
}

const PIPELINE = { columns: { accepted: [FENCE_JOB, PATIO_JOB, REPAIR_JOB] } };

test.describe('Create work order leads to the job work order for every job type', () => {
  test('a job with no work order yet opens its draft from the Build tab, filled from the quote', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const draft = workOrder();
    await openBuild(page, detailPayload(null), {
      create_work_order: { created: true, work_order: draft, quote_fill: { reason: 'filled' } },
      job_detail: detailPayload(draft),
      job_work_order: { work_order: draft, figures: {}, variations: [] },
    }, 'esther@secureworkswa.com.au');
    await expect(page.locator('[data-job-wo-none]')).toContainText('it fills from the accepted quote');
    await page.locator('[data-job-wo-open]').click();
    const panel = page.locator('[data-job-wo-panel]');
    await expect(panel.locator('[data-job-wo-chip]')).toHaveText('Draft, not approved');
    await expect(panel).toContainText('Install Colorbond fencing');
    await expect(page.locator('[data-job-wo-message]')).toHaveText('Draft opened, filled from the accepted quote. Check it, then approve.');
    await expect(page.locator('[data-job-wo-open]')).toHaveCount(0);
    const posts = await page.evaluate(() => window.__calls.filter((c) => c.method === 'POST'));
    expect(posts).toEqual([{ method: 'POST', action: 'create_work_order', body: { kind: 'job', job_id: 'job-fence-1' } }]);
  });

  test('a refused open reads in words and nothing else is written', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    await openBuild(page, detailPayload(null), {
      create_work_order: { reject: { code: 'draft_not_created', status: 500, message: 'raw' } },
    }, SHAUN);
    await page.locator('[data-job-wo-open]').click();
    await expect(page.locator('[data-job-wo-message]')).toHaveText('The draft could not be opened. Try again.');
    await expect(page.locator('[data-job-wo-open]')).toBeEnabled();
    const posts = await page.evaluate(() => window.__calls.filter((c) => c.method === 'POST').map((c) => c.action));
    expect(posts).toEqual(['create_work_order']);
    expect(await page.evaluate(() => window.__calls.filter((c) => c.action === 'job_detail').length)).toBe(0);
  });

  test('?wo=live still offers Open the draft and does not open the old form', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    await openBuild(page, detailPayload(null), { list_trade_invoice_lines: { lines: [] } }, SHAUN);
    await expect(page.locator('[data-job-wo-none]')).toContainText('Work order not filled yet');
    await expect(page.locator('[data-job-wo-open]')).toBeEnabled();
    await expect(page.locator('#woNewBtn')).toHaveCount(0);
    await expect(page.locator('#woModal')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('sw_wo_preview'))).toBeNull();
  });

  test('the job quick view and the calendar offer Open Work Order for every type, including with ?wo=live', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    const labels = await page.evaluate(([fence, patio, repair]) => {
      const proc = (j) => Object.assign({}, j, { status: 'processing', po_count: 1, assignment_count: 1, wo_count: 0 });
      const first = (j) => getNextAction(proc(j)).actions[0];
      const ms = { id: 'job-ms-1', job_number: 'SWMS-1', type: 'makesafe', status: 'accepted' };
      return {
        fence: first(fence), patio: first(patio), repair: first(repair), makesafe: first(ms),
        calFence: getBlockerFixButton('work_order', fence.id, false, 'fencing'),
        calRepair: getBlockerFixButton('work_order', repair.id, false, 'repair'),
        calMs: getBlockerFixButton('work_order', ms.id, false, 'makesafe'),
      };
    }, [FENCE_JOB, PATIO_JOB, REPAIR_JOB]);
    expect(labels.fence).toEqual({ label: 'Open Work Order', onclick: "closeQuickView();JobWorkOrderOps.openForJob('job-fence-1')", primary: true });
    expect(labels.patio.label).toBe('Open Work Order');
    expect(labels.repair).toEqual({ label: 'Open Work Order', onclick: "closeQuickView();JobWorkOrderOps.openForJob('job-repair-1')", primary: true });
    expect(labels.makesafe.onclick).toContain("JobWorkOrderOps.openForJob('job-ms-1')");
    const ready = await page.evaluate((fence) => {
      const proc = (j) => Object.assign({}, j, { status: 'processing', po_count: 1, assignment_count: 1, wo_count: 0 });
      return getNextAction(Object.assign({}, proc(fence), { job_work_order: { work_order: { id: 'wo-1', status: 'approved', kind: 'job' } } }));
    }, FENCE_JOB);
    expect(ready.hint).not.toContain('work order');
    expect(ready.hint).toContain('Everything ready');
    expect(labels.calFence).toContain("JobWorkOrderOps.openForJob('job-fence-1')");
    expect(labels.calRepair).toContain("JobWorkOrderOps.openForJob('job-repair-1')");
    expect(labels.calRepair).toContain('Open Work Order');
    expect(labels.calRepair).not.toContain('openCreateWOModal');
    expect(labels.calMs).toContain("JobWorkOrderOps.openForJob('job-ms-1')");
    for (const action of [labels.fence, labels.patio, labels.repair, labels.makesafe]) {
      expect(action.label).toBe('Open Work Order');
      expect(action.onclick).not.toContain('openCreateWOModal');
    }
  });

  test('Create Work Order on a fencing job opens the job page on the Build tab, not the old form', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const draft = workOrder();
    await stubOps(page, {
      pipeline: PIPELINE,
      job_detail: detailPayload(draft),
      job_work_order: { work_order: draft, figures: {}, variations: [] },
    }, SHAUN);
    await page.evaluate((id) => openCreateWOModal(id), FENCE_JOB.id);
    await expect(page.locator('#jdBuild [data-job-wo-panel]')).toContainText('WO-0042');
    await expect(page.locator('#jdBuild')).toHaveClass(/active/);
    await expect(page.locator('#woModal')).toHaveCount(0);
    const actions = await page.evaluate(() => window.__calls.map((c) => c.action));
    expect(actions).not.toContain('scope_to_po');
    expect(await page.evaluate(() => window.__calls.filter((c) => c.method === 'POST').length)).toBe(0);
  });

  test('the old form is gone and a forced submit posts no crew work order', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    const draft = workOrder();
    await stubOps(page, {
      pipeline: PIPELINE,
      job_detail: detailPayload(draft),
      job_work_order: { work_order: draft, figures: {}, variations: [] },
      scope_to_po: { job_id: REPAIR_JOB.id, materials: [{ description: 'Ridge capping', quantity: 3, unit: 'lm' }] },
      create_work_order: { id: 'crew-wo-1' },
      list_work_orders: { work_orders: [] },
    }, SHAUN);
    await expect(page.locator('#woNewBtn')).toHaveCount(0);
    await expect(page.locator('#woSubmitBtn')).toHaveCount(0);
    await expect(page.locator('#woModal')).toHaveCount(0);
    await expect(page.locator('#woJobSelect')).toHaveCount(0);
    await page.evaluate(() => { openWOModal(); autoWOFromScope(); return submitWO(); });
    const calls = await page.evaluate(() => window.__calls.map((c) => c.method + ' ' + c.action));
    expect(calls).not.toContain('GET scope_to_po');
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([]);
    expect(calls).not.toContain('POST create_work_order');
  });

  test('a repair job with no work order block opens a job draft, and a server refusal stays on that panel', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    const data = detailPayload(null);
    data.job = Object.assign({}, data.job, { id: REPAIR_JOB.id, type: 'repair', job_number: REPAIR_JOB.job_number, client_name: REPAIR_JOB.client_name, site_suburb: REPAIR_JOB.site_suburb });
    data.job_work_order = null;
    const draft = workOrder({ job_id: REPAIR_JOB.id });
    await openBuild(page, data, {
      list_trade_invoice_lines: { lines: [] },
      create_work_order: { reject: { code: 'job_type_not_eligible', status: 422, message: 'raw fencing and patio' } },
    }, SHAUN);
    await expect(page.locator('[data-job-wo-none]')).toContainText('Work order not filled yet');
    await expect(page.locator('[data-job-wo-open]')).toContainText('Open the draft');
    await page.locator('[data-job-wo-open]').click();
    await expect(page.locator('[data-job-wo-message]')).toHaveText('The draft could not be opened. This job type is not on the server yet.');
    await expect(page.locator('[data-job-wo-open]')).toBeEnabled();
    await expect(page.locator('#woModal')).toHaveCount(0);
    let posts = await page.evaluate(() => window.__calls.filter((c) => c.method === 'POST'));
    expect(posts).toEqual([{ method: 'POST', action: 'create_work_order', body: { kind: 'job', job_id: 'job-repair-1' } }]);

    const opened = detailPayload(draft);
    opened.job = data.job;
    await openBuild(page, data, {
      list_trade_invoice_lines: { lines: [] },
      create_work_order: { created: true, work_order: draft, quote_fill: { reason: 'filled' } },
      job_detail: opened,
      job_work_order: { work_order: draft, figures: {}, lines: [], variations: [] },
    }, SHAUN);
    await page.locator('[data-job-wo-open]').click();
    await expect(page.locator('[data-job-wo-chip]')).toHaveText('Draft, not approved');
    posts = await page.evaluate(() => window.__calls.filter((c) => c.method === 'POST'));
    expect(posts).toEqual([{ method: 'POST', action: 'create_work_order', body: { kind: 'job', job_id: 'job-repair-1' } }]);
  });

  test('a general quick-quote job and a make-safe job show the same blank panel', async ({ page }) => {
    await page.goto('/ops.html');
    const general = detailPayload(null);
    general.job = Object.assign({}, general.job, { id: 'job-gen-1', type: 'general', job_number: 'SWG-1' });
    general.job.pricing_json = { source: 'quick_quote', job_type_label: 'Handyman', job_description: 'Fix a gate', line_items: [] };
    general.job_work_order = null;
    await openBuild(page, general, { list_trade_invoice_lines: { lines: [] } }, SHAUN);
    await expect(page.locator('#jdBuild')).toContainText('Job Details');
    await expect(page.locator('[data-job-wo-none]')).toContainText('Work order not filled yet');
    await expect(page.locator('[data-job-wo-open]')).toBeVisible();

    const ms = detailPayload(null);
    ms.job = Object.assign({}, ms.job, { id: 'job-ms-1', type: 'makesafe', job_number: 'SWMS-1' });
    ms.job_work_order = null;
    await openBuild(page, ms, { list_trade_invoice_lines: { lines: [] } }, SHAUN);
    await expect(page.locator('[data-job-wo-none]')).toContainText('Work order not filled yet');
    await expect(page.locator('[data-job-wo-open]')).toBeEnabled();
    const actions = await page.evaluate(() => window.__calls.map((c) => c.action));
    expect(actions).not.toContain('create_work_order');
    expect(actions).toContain('list_trade_invoice_lines');
  });
});

// Customer variations (secureworks-backend docs/job-work-orders-v1.md,
// "Customer variations"): staff record one on the job's work order, edit it
// while it is a draft, Shaun approves it (it joins the approved work order as
// a marked addendum) and a draft can be cancelled. Every edit, approval and
// cancellation carries the updated_at of the variation on screen. The
// customer invoice line is a preview only: no Xero draft is ever created here.
const CV_DRAFT_AT = '2026-10-13T06:00:00.123456+00:00';

function approvedWo() {
  return workOrder({
    status: 'approved', approved_at: '2026-10-13T05:00:00Z', updated_at: '2026-10-13T05:00:00Z',
    scope_items: scopeItems().slice(0, 3),
  });
}

function addendum() {
  return {
    id: 'cv-1', variation_number: 1, label: 'Variation 1 - approved 13 Oct 2026', approved_at: '2026-10-13T07:00:00Z',
    approved_by: 'user-shaun', description: 'Remove the tree roots the quote left',
    lines: [{ line_key: 'variation:1:0', source: 'variation', is_variation: true, variation_number: 1, description: 'Remove tree roots between 378/1 and 378/2', qty: 4, unit: 'hrs', hours: 4 }],
    hours_total: 4, trade_allocation_ex: 320, customer_price_ex: 921.6,
  };
}

function draftVariation(over) {
  return Object.assign({
    id: 'cv-1', job_id: 'job-fence-1', status: 'draft', work_order_id: null, variation_number: null, label: null,
    description: 'Remove the tree roots the quote left', tasks: [{ description: 'Remove tree roots between 378/1 and 378/2', hours: 4 }],
    hours_total: 4, trade_allocation_ex: 320, customer_price_ex: 921.6, created_by: 'user:esther',
    created_at: '2026-10-13T06:00:00Z', updated_at: CV_DRAFT_AT, approved_at: null, cancelled_at: null, cancel_reason: null, invoice: null,
  }, over || {});
}

function approvedVariation() {
  return draftVariation({ status: 'approved', work_order_id: 'wo-1', variation_number: 1, label: 'Variation 1 - approved 13 Oct 2026', approved_at: '2026-10-13T07:00:00Z', updated_at: '2026-10-13T07:00:00Z' });
}

// job_detail and the job_work_order read for an approved work order with the
// given customer variations; approved ones are also its addenda.
function withVariations(list) {
  const wo = approvedWo();
  const data = detailPayload(wo);
  const approved = list.filter((v) => v.status === 'approved');
  const addenda = approved.length ? [addendum()] : [];
  const figures = approved.length
    ? { agreed_ex: 2006, customer_variations_ex: 320, customer_variations_price_ex: 921.6, customer_variation_count: 1, agreed_total_ex: 2326, billed_to_date_ex: 1000, variations_ex: 0, variation_count: 0, billed_within_agreed_scope_ex: 1000, remaining_ex: 1326, used_ratio: 0.43, over_agreed: false, rules: [{ key: 'has_customer_variations', level: 'info', message: '1 approved customer variation added to the agreed labour.' }] }
    : Object.assign({ customer_variations_ex: 0, customer_variation_count: 0, agreed_total_ex: 2006 }, data.job_work_order.figures);
  data.job_work_order.figures = figures;
  data.job_work_order.addenda = addenda;
  data.job_work_order.customer_variations_open_count = list.filter((v) => v.status !== 'cancelled').length;
  const read = { schema: 'job-work-order.v1', work_order: wo, figures, addenda, customer_variations: list, invoices: [], lines: [], variations: [] };
  return { data, read };
}

async function posts(page) {
  return page.evaluate(() => window.__calls.filter((c) => c.method === 'POST').map((c) => ({ action: c.action, body: c.body })));
}

test.describe('Customer variations on the job work order (preview)', () => {
  test('staff add a variation with tasks, hours, allocation and price; it is saved as a draft and shown', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const before = withVariations([]);
    const after = withVariations([draftVariation()]);
    await openBuild(page, before.data, {
      job_work_order: [before.read, after.read],
      create_customer_variation: { customer_variation: draftVariation() },
      job_detail: after.data,
    }, 'esther@secureworkswa.com.au');

    const cv = page.locator('[data-job-wo-cv]');
    await cv.locator('[data-job-wo-cv-add]').click();
    const form = cv.locator('[data-job-wo-cv-form="create"]');
    // Checked in words before anything is sent.
    await form.locator('[data-job-wo-cv-save]').click();
    await expect(form.locator('[data-job-wo-cv-errors]')).toContainText('Describe the variation.');
    expect(await posts(page)).toEqual([]);

    await form.locator('[data-cv-f="description"]').fill('Remove the tree roots the quote left');
    await form.locator('[data-cv-task="0"] [data-cv-tf="description"]').fill('Remove tree roots between 378/1 and 378/2');
    await form.locator('[data-cv-task="0"] [data-cv-tf="hours"]').fill('4');
    await form.locator('[data-job-wo-cv-add-task]').click();
    // Typed words survive the repaint that adds the row.
    await expect(form.locator('[data-cv-task="0"] [data-cv-tf="hours"]')).toHaveValue('4');
    await form.locator('[data-cv-task="1"] [data-cv-tf="description"]').fill('Extend the fence along the side');
    await form.locator('[data-cv-task="1"] [data-cv-tf="hours"]').fill('3');
    await form.locator('[data-cv-task="1"] [data-cv-tf="qty"]').fill('6');
    await form.locator('[data-cv-task="1"] [data-cv-tf="unit"]').fill('m');
    await form.locator('[data-cv-f="trade_allocation_ex"]').fill('320');
    await form.locator('[data-cv-f="customer_price_ex"]').fill('921.60');
    await form.locator('[data-job-wo-cv-save]').click();

    await expect(page.locator('[data-job-wo-cv-message]')).toContainText('Variation saved as a draft');
    await expect(page.locator('[data-job-wo-cv-row][data-cv-id="cv-1"]')).toContainText('Draft, not approved');
    await expect(page.locator('[data-job-wo-cv-form]')).toHaveCount(0);
    expect(await posts(page)).toEqual([{ action: 'create_customer_variation', body: {
      job_id: 'job-fence-1', description: 'Remove the tree roots the quote left',
      tasks: [{ description: 'Remove tree roots between 378/1 and 378/2', hours: 4 }, { description: 'Extend the fence along the side', hours: 3, qty: 6, unit: 'm' }],
      trade_allocation_ex: 320, customer_price_ex: 921.6,
    } }]);
  });

  test('a draft is edited with the updated_at it was read at', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const before = withVariations([draftVariation()]);
    const edited = draftVariation({ customer_price_ex: 990, updated_at: '2026-10-13T08:00:00Z' });
    const after = withVariations([edited]);
    await openBuild(page, before.data, {
      job_work_order: [before.read, after.read],
      update_customer_variation: { customer_variation: edited },
      job_detail: after.data,
    }, 'esther@secureworkswa.com.au');
    await page.locator('[data-job-wo-cv-edit][data-cv-id="cv-1"]').click();
    const form = page.locator('[data-job-wo-cv-form="edit"]');
    await expect(form.locator('[data-cv-f="customer_price_ex"]')).toHaveValue('921.6');
    await form.locator('[data-cv-f="customer_price_ex"]').fill('990');
    await form.locator('[data-job-wo-cv-save]').click();
    await expect(page.locator('[data-job-wo-cv-message]')).toHaveText('Variation saved.');
    await expect(page.locator('[data-job-wo-cv-row][data-cv-id="cv-1"]')).toContainText('$990.00');
    const sent = await posts(page);
    expect(sent).toHaveLength(1);
    expect(sent[0].action).toBe('update_customer_variation');
    expect(sent[0].body).toMatchObject({ variation_id: 'cv-1', expected_updated_at: CV_DRAFT_AT, customer_price_ex: 990, trade_allocation_ex: 320 });
  });

  test('Shaun approves a draft as shown; it joins the work order as Variation 1 and the figures use the agreed total', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const before = withVariations([draftVariation()]);
    const after = withVariations([approvedVariation()]);
    await openBuild(page, before.data, {
      job_work_order: [before.read, after.read],
      approve_customer_variation: { customer_variation: approvedVariation() },
      job_detail: after.data,
    }, SHAUN);
    const panel = page.locator('[data-job-wo-panel]');
    await expect(panel.locator('[data-job-wo-addendum]')).toHaveCount(0);
    await page.locator('[data-job-wo-cv-approve][data-cv-id="cv-1"]').click();
    await expect(page.locator('[data-job-wo-cv-confirm="approve"]')).toContainText('It joins WO-0042 as the next numbered addendum');
    await page.locator('[data-job-wo-cv-confirm-yes]').click();

    await expect(page.locator('[data-job-wo-cv-message]')).toHaveText('Variation 1 - approved 13 Oct 2026. It is on the work order as an addendum.');
    const add = panel.locator('[data-job-wo-addendum][data-variation-number="1"]');
    await expect(add.locator('[data-job-wo-addendum-title]')).toContainText('Variation 1 - approved 13 Oct 2026');
    await expect(add).toContainText('Remove tree roots between 378/1 and 378/2');
    await expect(add).toContainText('4 h');
    await expect(add.locator('[data-job-wo-addendum-money]')).toHaveText('Trade allocation $320.00 · Customer price $921.60 ex GST');
    await expect(panel.locator('[data-job-wo-agreed-total]')).toContainText('$2,326.00');
    await expect(panel.locator('[data-job-wo-rule="has_customer_variations"]')).toBeVisible();
    await expect(page.locator('[data-job-wo-cv-row][data-cv-id="cv-1"] [data-job-wo-cv-chip]')).toHaveText('Variation 1 - approved 13 Oct 2026');
    expect(await posts(page)).toEqual([{ action: 'approve_customer_variation', body: { variation_id: 'cv-1', expected_updated_at: CV_DRAFT_AT } }]);
  });

  test('a stale approval is refused in words and the variation is read again', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const before = withVariations([draftVariation()]);
    const moved = withVariations([draftVariation({ trade_allocation_ex: 400, updated_at: '2026-10-13T09:00:00Z' })]);
    await openBuild(page, before.data, {
      job_work_order: [before.read, moved.read],
      approve_customer_variation: { reject: { code: 'stale_review', status: 409, message: 'raw' } },
      job_detail: moved.data,
    }, SHAUN);
    await page.locator('[data-job-wo-cv-approve][data-cv-id="cv-1"]').click();
    await page.locator('[data-job-wo-cv-confirm-yes]').click();
    await expect(page.locator('[data-job-wo-cv-message]')).toContainText('changed after it was read');
    await expect(page.locator('[data-job-wo-cv-row][data-cv-id="cv-1"]')).toContainText('$400.00');
    await expect(page.locator('[data-job-wo-cv-row][data-cv-id="cv-1"] [data-job-wo-cv-chip]')).toHaveText('Draft, not approved');
    expect(await page.evaluate(() => window.__calls.filter((c) => c.action === 'job_detail').length)).toBe(1);
  });

  test('only Shaun sees Approve; a variation on a draft work order says to approve the work order first', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const { data, read } = withVariations([draftVariation()]);
    await openBuild(page, data, { job_work_order: read }, 'esther@secureworkswa.com.au');
    await expect(page.locator('[data-job-wo-cv-row][data-cv-id="cv-1"]')).toBeVisible();
    await expect(page.locator('[data-job-wo-cv-approve]')).toHaveCount(0);
    await expect(page.locator('[data-job-wo-cv-edit][data-cv-id="cv-1"]')).toBeEnabled();

    const draftWo = workOrder();
    const onDraft = detailPayload(draftWo);
    await openBuild(page, onDraft, { job_work_order: { work_order: draftWo, figures: {}, addenda: [], customer_variations: [draftVariation()], variations: [] } }, SHAUN);
    await expect(page.locator('[data-job-wo-cv-approve][data-cv-id="cv-1"]')).toBeDisabled();
    await expect(page.locator('[data-job-wo-cv-hold]')).toContainText('Approve the work order first');
  });

  test('a draft is cancelled with its reason and the updated_at it was read at', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const before = withVariations([draftVariation()]);
    const cancelled = draftVariation({ status: 'cancelled', cancelled_at: '2026-10-13T10:00:00Z', cancel_reason: 'Customer changed their mind' });
    const after = withVariations([cancelled]);
    await openBuild(page, before.data, {
      job_work_order: [before.read, after.read],
      cancel_customer_variation: { customer_variation: cancelled },
      job_detail: after.data,
    }, 'esther@secureworkswa.com.au');
    await page.locator('[data-job-wo-cv-cancel][data-cv-id="cv-1"]').click();
    await page.locator('[data-job-wo-cv-cancel-reason]').fill('Customer changed their mind');
    await page.locator('[data-job-wo-cv-confirm-yes]').click();
    await expect(page.locator('[data-job-wo-cv-message]')).toContainText('Variation cancelled');
    await expect(page.locator('[data-job-wo-cv-row][data-cv-id="cv-1"]')).toContainText('Cancelled 13 Oct 2026: Customer changed their mind');
    await expect(page.locator('[data-job-wo-cv-edit]')).toHaveCount(0);
    expect(await posts(page)).toEqual([{ action: 'cancel_customer_variation', body: { variation_id: 'cv-1', expected_updated_at: CV_DRAFT_AT, reason: 'Customer changed their mind' } }]);
  });

  test('a typed cancel reason survives a repaint while the confirm is open', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const draft = draftVariation({ id: 'cv-2' });
    const { data, read } = withVariations([approvedVariation(), draft]);
    await openBuild(page, data, {
      job_work_order: [read, read],
      cancel_customer_variation: { customer_variation: Object.assign({}, draft, { status: 'cancelled' }) },
      job_detail: data,
    }, 'esther@secureworkswa.com.au');
    await page.evaluate(() => {
      const post = window.opsPost;
      window.opsPost = function (action, body) {
        if (action !== 'prepare_customer_variation_invoice_line') return post(action, body);
        window.__calls.push({ method: 'POST', action, body });
        return new Promise((resolve) => { window.__answerPreview = () => resolve({ line: { description: 'Variation 1', quantity: 1, unit_price: 921.6 } }); });
      };
    });
    await page.locator('[data-job-wo-cv-invoice-line][data-cv-id="cv-1"]').click();
    await page.locator('[data-job-wo-cv-cancel][data-cv-id="cv-2"]').click();
    await page.locator('[data-job-wo-cv-cancel-reason]').fill('Customer changed their mind');
    await page.evaluate(() => window.__answerPreview());
    await expect(page.locator('[data-job-wo-cv-invoice-preview]')).toBeVisible();
    await expect(page.locator('[data-job-wo-cv-cancel-reason]')).toHaveValue('Customer changed their mind');
    await page.locator('[data-job-wo-cv-confirm-yes]').click();
    await expect(page.locator('[data-job-wo-cv-message]')).toContainText('Variation cancelled');
    const sent = (await posts(page)).filter((c) => c.action === 'cancel_customer_variation');
    expect(sent).toEqual([{ action: 'cancel_customer_variation', body: { variation_id: 'cv-2', expected_updated_at: CV_DRAFT_AT, reason: 'Customer changed their mind' } }]);
  });

  test('an approved variation previews its customer invoice line, and nothing creates a Xero draft', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const { data, read } = withVariations([approvedVariation()]);
    await openBuild(page, data, {
      job_work_order: read,
      prepare_customer_variation_invoice_line: {
        customer_variation_id: 'cv-1',
        line: { description: 'Variation 1 - approved 13 Oct 2026: Remove the tree roots the quote left\n- Remove tree roots between 378/1 and 378/2', quantity: 1, unit_price: 921.6, account_code: '200' },
        invoice: { status: 'prepared', line: null },
        create_invoice_draft: { job_id: 'job-fence-1', line_items: [], reference: 'SWF-26904 Variation 1' },
        xero_draft_switched_on: false,
      },
    }, SHAUN);
    await page.locator('[data-job-wo-cv-invoice-line][data-cv-id="cv-1"]').click();
    const preview = page.locator('[data-job-wo-cv-invoice-preview]');
    await expect(preview).toContainText('Variation 1 - approved 13 Oct 2026: Remove the tree roots the quote left');
    await expect(preview).toContainText('$921.60');
    await expect(page.locator('[data-job-wo-cv-invoice]')).toContainText('Reference SWF-26904 Variation 1');
    await expect(page.locator('[data-job-wo-cv-invoice-note]')).toContainText('Preview only: nothing is sent to Xero from here.');
    await expect(page.locator('[data-job-wo-panel] button', { hasText: /xero/i })).toHaveCount(0);
    expect(await posts(page)).toEqual([{ action: 'prepare_customer_variation_invoice_line', body: { variation_id: 'cv-1' } }]);
  });

  test('a refused invoice line preview reads in the variations message, never in an open form', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const { data, read } = withVariations([approvedVariation()]);
    await openBuild(page, data, {
      job_work_order: read,
      prepare_customer_variation_invoice_line: { reject: { code: 'invoice_line_unavailable', status: 422, message: 'The invoice line could not be built.' } },
    }, SHAUN);
    await page.locator('[data-job-wo-cv-add]').click();
    const form = page.locator('[data-job-wo-cv-form="create"]');
    await form.locator('[data-cv-f="description"]').fill('Second gate');
    await page.locator('[data-job-wo-cv-invoice-line][data-cv-id="cv-1"]').click();
    await expect(page.locator('[data-job-wo-cv-message]')).toHaveText('The invoice line could not be built.');
    await expect(form.locator('[data-cv-f="description"]')).toHaveValue('Second gate');
    await expect(form.locator('[data-job-wo-cv-errors]')).toHaveCount(0);
    expect(await posts(page)).toEqual([{ action: 'prepare_customer_variation_invoice_line', body: { variation_id: 'cv-1' } }]);
  });

  test('a refused invoice line preview leaves a save still in flight busy', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const { data, read } = withVariations([approvedVariation()]);
    await openBuild(page, data, { job_work_order: read }, SHAUN);
    await page.evaluate(() => {
      const post = window.opsPost;
      window.opsPost = function (action, body) {
        if (action === 'prepare_customer_variation_invoice_line') {
          window.__calls.push({ method: 'POST', action, body });
          return new Promise((resolve, reject) => { window.__refusePreview = () => { const e = new Error('The invoice line could not be built.'); e.code = 'invoice_line_unavailable'; reject(e); }; });
        }
        if (action === 'create_customer_variation') {
          window.__calls.push({ method: 'POST', action, body });
          return new Promise(() => {});
        }
        return post(action, body);
      };
    });
    await page.locator('[data-job-wo-cv-add]').click();
    const form = page.locator('[data-job-wo-cv-form="create"]');
    await form.locator('[data-cv-f="description"]').fill('Second gate');
    await form.locator('[data-cv-task="0"] [data-cv-tf="description"]').fill('Hang a second gate');
    await form.locator('[data-cv-task="0"] [data-cv-tf="hours"]').fill('2');
    await form.locator('[data-cv-f="trade_allocation_ex"]').fill('90');
    await form.locator('[data-cv-f="customer_price_ex"]').fill('250');
    await page.locator('[data-job-wo-cv-invoice-line][data-cv-id="cv-1"]').click();
    await form.locator('[data-job-wo-cv-save]').click();
    await expect(form.locator('[data-job-wo-cv-save]')).toBeDisabled();
    await page.evaluate(() => window.__refusePreview());
    await expect(page.locator('[data-job-wo-cv-message]')).toHaveText('The invoice line could not be built.');
    await expect(form.locator('[data-job-wo-cv-save]')).toBeDisabled();
    await expect(form.locator('[data-job-wo-cv-errors]')).toHaveCount(0);
    expect((await posts(page)).map((c) => c.action)).toEqual(['prepare_customer_variation_invoice_line', 'create_customer_variation']);
  });

  test('the Work Order PDF prints the approved variation as a marked addendum, its allocation only in the cost breakdown', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const { data, read } = withVariations([approvedVariation()]);
    await openBuild(page, data, { job_work_order: read }, SHAUN);
    await expect(page.locator('[data-job-wo-cv-row]')).toHaveCount(1);
    const printed = await page.evaluate(() => {
      let html = '';
      window.open = () => ({ document: { write: (h) => { html += h; }, close() {} }, focus() {} });
      JobWorkOrderOps.openPdf();
      return html;
    });
    expect(printed).toContain('ADDENDUM: Variation 1 - approved 13 Oct 2026');
    expect(printed).toContain('Remove tree roots between 378/1 and 378/2');
    expect(printed).toContain('Trade allocation for this variation');
    expect(printed).toContain('Agreed total');
    expect(printed).toContain('$2,326.00');
    expect(printed).not.toContain('921.6');
  });

  test('?wo=live still shows customer variations and does not post a crew work order', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    const { data, read } = withVariations([draftVariation()]);
    await openBuild(page, data, { job_work_order: read }, SHAUN);
    await expect(page.locator('[data-job-wo-panel]')).toBeVisible();
    await expect(page.locator('[data-job-wo-cv]')).toBeVisible();
    await expect(page.locator('#woModal')).toHaveCount(0);
    const posts = await page.evaluate(() => window.__calls.filter((c) => c.method === 'POST'));
    expect(posts).toEqual([]);
    expect(await page.evaluate(() => window.__calls.some((c) => c.action === 'job_work_order'))).toBe(true);
  });
});

// A stuck Xero draft record (secureworks-backend docs/job-work-orders-v1.md,
// "A stuck Xero draft record"), on the panel ?wo=preview shows. An approved variation whose invoice record is
// 'unknown', or 'creating' for 15 minutes, says so; Shaun checks Xero by hand
// and answers with reconcile_customer_variation_xero_draft, which never calls
// Xero, carrying the record's updated_at as read.
const XERO_ID = '0f8e2c1a-3b4d-4e5f-8a9b-1c2d3e4f5a6b';
const XERO_LINK = 'https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=' + XERO_ID;
const STUCK_AT = '2026-10-15T02:00:01.234567+00:00';

function stuckVariation(status, over) {
  return Object.assign(approvedVariation(), {
    invoice: Object.assign({
      status, line: { description: 'Variation 1 - approved 13 Oct 2026: Remove the tree roots the quote left', quantity: 1, unit_price: 921.6, account_code: '200' },
      prepared_at: '2026-10-15T01:00:00Z', xero_contact_id: 'contact-1', xero_requested_by: 'user-esther',
      xero_requested_at: '2026-10-15T02:00:00Z', xero_invoice_id: null, invoice_number: null, xero_created_at: null,
      failure: status === 'unknown' ? 'Xero did not answer in time' : null, updated_at: STUCK_AT,
    }, over || {}),
  });
}

function recordedVariation() {
  return stuckVariation('xero_draft_created', { xero_invoice_id: XERO_ID, invoice_number: 'INV-0123', xero_created_at: '2026-10-16T01:00:00Z', updated_at: '2026-10-16T01:00:00Z' });
}

test.describe('A stuck Xero draft on a customer variation (preview)', () => {
  test('?wo=live still shows a stuck Xero draft and does not reconcile it on its own', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    const { data, read } = withVariations([stuckVariation('unknown')]);
    await openBuild(page, data, { job_work_order: read }, SHAUN);
    await expect(page.locator('[data-job-wo-panel]')).toBeVisible();
    await expect(page.locator('[data-job-wo-cv-xero-stuck]')).toBeVisible();
    const posts = await page.evaluate(() => window.__calls.filter((c) => c.method === 'POST').map((c) => c.action));
    expect(posts).not.toContain('reconcile_customer_variation_xero_draft');
    expect(posts).not.toContain('create_work_order');
  });

  test('Shaun records the draft found in Xero from its link; the answer carries the record as read', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const before = withVariations([stuckVariation('unknown')]);
    const after = withVariations([recordedVariation()]);
    await openBuild(page, before.data, {
      job_work_order: [before.read, after.read],
      reconcile_customer_variation_xero_draft: { customer_variation_id: 'cv-1', invoice: recordedVariation().invoice, duplicate: false },
      job_detail: after.data,
    }, SHAUN);
    const stuck = page.locator('[data-job-wo-cv-row][data-cv-id="cv-1"] [data-job-wo-cv-xero-stuck="unknown"]');
    await expect(stuck).toContainText('Xero draft not confirmed');
    await expect(stuck).toContainText('Xero did not confirm whether the draft for this line was made (asked for 15 Oct 2026, 10:00 am)');
    await expect(stuck.locator('[data-job-wo-cv-xero-failure]')).toHaveText('What went wrong: Xero did not answer in time');

    await stuck.locator('[data-job-wo-cv-xero-open]').click();
    const dialog = page.getByRole('dialog', { name: 'What does Xero show?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('This screen never calls Xero');
    await expect(dialog.locator('[data-job-wo-cv-xero-submit]')).toBeDisabled();
    await dialog.getByLabel(/I found the draft in Xero/).check();
    await dialog.locator('[data-cv-xero-f="invoiceId"]').fill(XERO_LINK);
    await dialog.locator('[data-cv-xero-f="invoiceNumber"]').fill('INV-0123');
    await expect(dialog.locator('[data-job-wo-cv-xero-submit]')).toBeDisabled();
    await dialog.getByLabel('I checked Xero by hand just now.').check();
    // What was typed survives the repaint the tick makes.
    await expect(dialog.locator('[data-cv-xero-f="invoiceId"]')).toHaveValue(XERO_LINK);
    await expect(dialog.locator('[data-job-wo-cv-xero-what]')).toContainText('Nothing is sent to Xero or the customer.');
    await dialog.locator('[data-job-wo-cv-xero-submit]').click();

    await expect(page.locator('[data-job-wo-cv-message]')).toHaveText('Recorded: INV-0123 is this variation\'s Xero draft. Nothing was sent to Xero or the customer.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-job-wo-cv-xero-stuck]')).toHaveCount(0);
    await expect(page.locator('[data-job-wo-cv-invoice]')).toContainText('In Xero as a draft INV-0123.');
    expect(await posts(page)).toEqual([{
      action: 'reconcile_customer_variation_xero_draft',
      body: { variation_id: 'cv-1', expected_updated_at: STUCK_AT, outcome: 'draft_exists', xero_invoice_id: XERO_ID, invoice_number: 'INV-0123' },
    }]);
  });

  test('Shaun releases a stuck creating line once its claim is 15 minutes old; nothing else is sent', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const stuckOne = stuckVariation('creating', { xero_requested_at: old });
    const before = withVariations([stuckOne]);
    const released = stuckVariation('prepared', { xero_requested_at: old, updated_at: '2026-10-16T02:00:00Z' });
    const after = withVariations([released]);
    await openBuild(page, before.data, {
      job_work_order: [before.read, after.read],
      reconcile_customer_variation_xero_draft: { customer_variation_id: 'cv-1', invoice: released.invoice, duplicate: false },
      job_detail: after.data,
    }, SHAUN);
    const stuck = page.locator('[data-job-wo-cv-xero-stuck="creating"][data-cv-answerable="1"]');
    await expect(stuck).toContainText('Xero draft stuck');
    await expect(stuck).toContainText('never finished');
    await stuck.locator('[data-job-wo-cv-xero-open]').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/There is no draft in Xero/).check();
    await expect(dialog.locator('[data-job-wo-cv-xero-release-warn]')).toContainText('making it again puts a second one there');
    await expect(dialog.locator('[data-cv-xero-f="invoiceId"]')).toHaveCount(0);
    await dialog.getByLabel('I checked Xero by hand just now.').check();
    await expect(dialog.locator('[data-job-wo-cv-xero-submit]')).toHaveText('Release the line');
    await dialog.locator('[data-job-wo-cv-xero-submit]').click();
    await expect(page.locator('[data-job-wo-cv-message]')).toContainText('Released: the line is back to prepared');
    await expect(page.locator('[data-job-wo-cv-xero-stuck]')).toHaveCount(0);
    expect(await posts(page)).toEqual([{
      action: 'reconcile_customer_variation_xero_draft',
      body: { variation_id: 'cv-1', expected_updated_at: STUCK_AT, outcome: 'no_draft' },
    }]);
  });

  test('a creating line under 15 minutes old says it is being made, with no button', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const fresh = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data, read } = withVariations([stuckVariation('creating', { xero_requested_at: fresh })]);
    await openBuild(page, data, { job_work_order: read }, SHAUN);
    const stuck = page.locator('[data-job-wo-cv-xero-stuck="creating"][data-cv-answerable="0"]');
    await expect(stuck).toContainText('Xero draft being made');
    await expect(stuck).toContainText('If it still says this after');
    await expect(page.locator('[data-job-wo-cv-xero-open]')).toHaveCount(0);
  });

  test('anyone but Shaun sees the stuck state and who answers it, with no button', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const { data, read } = withVariations([stuckVariation('unknown')]);
    await openBuild(page, data, { job_work_order: read }, 'esther@secureworkswa.com.au');
    await expect(page.locator('[data-job-wo-cv-xero-stuck="unknown"]')).toContainText('Xero draft not confirmed');
    await expect(page.locator('[data-job-wo-cv-xero-approver-only]')).toHaveText('Only Shaun records what Xero shows, after checking it by hand.');
    await expect(page.locator('[data-job-wo-cv-xero-open]')).toHaveCount(0);
  });

  test('a mistyped id is caught before anything is sent; Back closes the dialog', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const { data, read } = withVariations([stuckVariation('unknown')]);
    await openBuild(page, data, { job_work_order: read }, SHAUN);
    await page.locator('[data-job-wo-cv-xero-open]').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/I found the draft in Xero/).check();
    await dialog.locator('[data-cv-xero-f="invoiceId"]').fill('INV-0123');
    await dialog.getByLabel('I checked Xero by hand just now.').check();
    await dialog.locator('[data-job-wo-cv-xero-submit]').click();
    await expect(dialog.locator('[data-job-wo-cv-xero-errors]')).toContainText('That is not a Xero invoice id.');
    await expect(dialog.locator('[data-cv-xero-f="invoiceId"]')).toHaveValue('INV-0123');
    const contactLink = 'https://go.xero.com/Contacts/View/' + XERO_ID;
    await dialog.locator('[data-cv-xero-f="invoiceId"]').fill(contactLink);
    await dialog.locator('[data-job-wo-cv-xero-submit]').click();
    await expect(dialog.locator('[data-job-wo-cv-xero-errors]')).toContainText('That is not a Xero invoice id.');
    await expect(dialog.locator('[data-cv-xero-f="invoiceId"]')).toHaveValue(contactLink);
    await dialog.locator('[data-job-wo-cv-xero-close]').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-job-wo-cv-xero-open]')).toBeEnabled();
    expect(await posts(page)).toEqual([]);
  });

  test('a refusal reads in words: one that leaves the record as read stays in the dialog, a stale one reads the job again', async ({ page }) => {
    await page.goto('/ops.html?wo=preview');
    const before = withVariations([stuckVariation('unknown')]);
    const moved = withVariations([stuckVariation('unknown', { updated_at: '2026-10-16T03:00:00Z', failure: 'Second try timed out' })]);
    await openBuild(page, before.data, {
      job_work_order: [before.read, moved.read],
      reconcile_customer_variation_xero_draft: { reject: { code: 'xero_invoice_already_recorded', status: 409, message: 'raw' } },
      job_detail: moved.data,
    }, SHAUN);
    await page.locator('[data-job-wo-cv-xero-open]').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/I found the draft in Xero/).check();
    await dialog.locator('[data-cv-xero-f="invoiceId"]').fill(XERO_ID);
    await dialog.getByLabel('I checked Xero by hand just now.').check();
    await dialog.locator('[data-job-wo-cv-xero-submit]').click();
    await expect(dialog.locator('[data-job-wo-cv-xero-errors]')).toHaveText('That Xero invoice is already recorded for another variation. Check the invoice id in Xero.');
    await expect(dialog.locator('[data-job-wo-cv-xero-submit]')).toBeEnabled();

    await page.evaluate(() => { window.__answers.reconcile_customer_variation_xero_draft = { reject: { code: 'stale_review', status: 409, message: 'raw' } }; });
    await dialog.locator('[data-job-wo-cv-xero-submit]').click();
    await expect(page.locator('[data-job-wo-cv-message]')).toHaveText('The Xero draft record changed after it was read. It has been read again: check it, then answer.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-job-wo-cv-xero-failure]')).toHaveText('What went wrong: Second try timed out');
    const sent = await posts(page);
    expect(sent).toHaveLength(2);
    for (const c of sent) expect(c.body.expected_updated_at).toBe(STUCK_AT);
  });

  test('the Build list keeps an old crew work order, read-only and labelled', async ({ page }) => {
    await page.goto('/ops.html');
    const draft = workOrder();
    const data = detailPayload(draft);
    data.work_orders = [
      { id: 'wo-old', wo_number: 'WO-OLD', kind: 'crew', status: 'draft', trade_name: 'Old Trade' },
      { id: 'wo-job', wo_number: 'WO-JOB', kind: 'job', status: 'approved', trade_name: 'The Job' },
      { id: 'wo-plain', wo_number: 'WO-PLAIN', status: 'draft' },
    ];
    await openBuild(page, data, {
      job_work_order: { work_order: draft, figures: data.job_work_order.figures, lines: [], variations: [] },
      list_trade_invoice_lines: { lines: [] },
    }, SHAUN);
    const list = page.locator('#jdBuild');
    await expect(list).toContainText('Work Orders (3)');
    await expect(list).toContainText('WO-JOB');
    await expect(list).toContainText('WO-PLAIN');
    const old = list.locator('[data-office-wo="wo-old"]');
    await expect(old).toContainText('WO-OLD');
    await expect(old).toContainText('Old crew work order (retiring)');
    await expect(old).toContainText('Old Trade');
    await page.evaluate(() => showJobSubView('files'));
    const filesOld = page.locator('#jdFiles [data-office-wo="wo-old"]');
    await expect(filesOld).toContainText('Old crew work order (retiring)');
    await expect(filesOld).not.toContainText('Save to Files');
    await expect(page.locator('#jdFiles [data-office-wo="wo-job"]')).toContainText('Save to Files');
  });

  test('classic and new Overview show the work order card, the overrun, and the line review', async ({ page }) => {
    const wo = workOrder({
      status: 'approved', approved_at: '2026-10-13T05:00:00Z', approved_by_name: 'Shaun Kay',
      makesafe_labour_allowance_ex: 400,
    });
    const figures = {
      agreed_ex: 2006, billed_to_date_ex: 2400, remaining_ex: -394, over_agreed: true,
      variations_ex: 0, variation_count: 0, rules: [],
    };
    const lines = [
      { trade_name: 'Sam Crew', description: 'Install day', line_total_ex: 1500, total_hours: 8, review_state: 'approved', work_order_id: 'wo-1' },
      { trade_name: 'Pat Query', description: 'Extra posts', line_total_ex: 900, acknowledgment_status: 'queried', job_work_order_id: 'wo-1' },
    ];
    const data = detailPayload(wo);
    data.job_work_order.figures = figures;
    const answers = overviewRead(wo, lines, figures);

    await page.goto('/ops.html');
    await openSurface(page, 'overview', data, answers, SHAUN);
    const classic = page.locator('#jdOverview [data-job-wo-overview-card]');
    await expect(classic).toBeVisible();
    await expect(classic).toContainText('Approved');
    await expect(classic).toContainText('Approved by Shaun Kay');
    await expect(classic).toContainText('Agreed labour');
    await expect(classic).toContainText('$2,006.00');
    await expect(classic).toContainText('Make-safe allowance');
    await expect(classic).toContainText('$400.00');
    await expect(classic).toContainText('Over agreed by $394.00');
    await expect(classic).toContainText('Sam Crew');
    await expect(classic.locator('[data-job-wo-review="approved"]')).toBeVisible();
    await expect(classic.locator('[data-job-wo-review="queried"]')).toBeVisible();
    await expect(classic).toContainText('Billed labour $2,400.00 against agreed labour $2,006.00');
    await expect(page.locator('#ov2Root')).toHaveCount(0);

    await page.goto('/ops.html?overview=v2');
    await openSurface(page, 'overview', data, answers, SHAUN);
    const next = page.locator('#ov2Root [data-job-wo-overview-card]');
    await expect(next).toBeVisible();
    await expect(next).toContainText('WO-0042');
    await expect(next).toContainText('Over agreed by $394.00');
    await expect(next).toContainText('Sam Crew');
    await expect(page.locator('#ov2Root [data-job-wo-overview]')).toBeVisible();
  });

  test('a trade role on Ops sees no panel, no card, and no agreed labour', async ({ page }) => {
    await page.goto('/ops.html');
    const wo = workOrder({ status: 'approved', approved_at: '2026-10-13T05:00:00Z', agreed_labour_ex: 2006 });
    const data = detailPayload(wo);
    await openSurface(page, 'build', data, {
      job_work_order: { work_order: wo, figures: data.job_work_order.figures, lines: [], variations: [] },
    }, SHAUN, 'installer');
    await expect(page.locator('#jdBuild')).toContainText('Materials Dispatch');
    await expect(page.locator('[data-job-wo-panel]')).toHaveCount(0);
    await expect(page.locator('#jdBuild')).not.toContainText('Agreed labour');
    await expect(page.locator('#jdBuild')).not.toContainText('$2,006.00');
    expect(await page.evaluate(() => window.__calls.filter((c) => c.action === 'job_work_order').length)).toBe(0);

    await page.evaluate(() => showJobSubView('overview'));
    await expect(page.locator('[data-job-wo-overview-card]')).toHaveCount(0);
    await expect(page.locator('#jdOverview')).not.toContainText('Agreed labour');
    await expect(page.locator('#jdOverview')).not.toContainText('$2,006.00');
  });
});

test.describe('Review fixes: money, make-safe door, gate, work order list', () => {
  test('a job with no work order bills only acknowledged labour, not travel or a rejected line', async ({ page }) => {
    await page.goto('/ops.html');
    const data = detailPayload(null);
    await openSurface(page, 'overview', data, {
      list_trade_invoice_lines: { lines: [
        { id: 'l1', trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', trade_invoices: { status: 'acknowledged' }, acknowledgment_status: 'acknowledged', line_total_ex: 430 },
        { id: 'l2', trade_name: 'Van', description: 'Travel', line_type: 'other', trade_invoices: { status: 'acknowledged' }, line_total_ex: 80 },
        { id: 'l3', trade_name: 'Sam Crew', description: 'Rejected day', line_type: 'labour', trade_invoices: [{ status: 'ops-reject' }], line_total_ex: 100 },
      ] },
    }, SHAUN);
    const card = page.locator('#jdOverview [data-job-wo-overview-card]');
    await expect(card).toContainText('$430.00');
    await expect(card).not.toContainText('$610.00');
    await expect(card).toContainText('Not counted as labour');
    await expect(card).toContainText('Rejected');
    await expect(card).not.toContainText('No crew invoice lines');
    await expect(card.locator('[data-job-wo-review="approved"]')).toBeVisible();
    await expect(card.locator('[data-job-wo-review="queried"]')).toHaveCount(0);
  });

  test('a work order line takes its review from list_trade_invoice_lines', async ({ page }) => {
    await page.goto('/ops.html');
    const wo = workOrder({ status: 'draft' });
    const data = detailPayload(wo);
    await openSurface(page, 'overview', data, {
      job_work_order: { work_order: wo, figures: data.job_work_order.figures, lines: [
        { id: 'wo-line', trade_invoice_line_id: 'inv-1', trade_name: 'Sam Crew', description: 'Install day', line_total_ex: 430, work_order_id: 'wo-1' },
      ], variations: [], labour_before_approval: { amount_ex: 0, line_count: 0, note: '' } },
      list_trade_invoice_lines: { lines: [
        { id: 'inv-1', acknowledgment_status: 'acknowledged', trade_invoices: { status: 'acknowledged' }, line_type: 'labour', line_total_ex: 430, trade_name: 'Sam Crew', description: 'Install day' },
        { id: 'inv-2', acknowledgment_status: 'queried', trade_invoices: [{ status: 'queried' }], line_type: 'labour', line_total_ex: 80, trade_name: 'Pat Query', description: 'Extra posts' },
      ] },
    }, SHAUN);
    const card = page.locator('#jdOverview [data-job-wo-overview-card]');
    await expect(card.locator('[data-job-wo-review="approved"]')).toBeVisible();
    await expect(card.locator('[data-job-wo-review="queried"]')).toBeVisible();
    await expect(card).toContainText('Pat Query');
    await expect(card).not.toContainText('No crew invoice lines');
    const actions = await page.evaluate(() => window.__calls.map((c) => c.action));
    expect(actions).toContain('job_work_order');
    expect(actions).toContain('list_trade_invoice_lines');
  });

  test('Open Work Order on a make-safe stays on Overview and does not open the patio scope tool', async ({ page }) => {
    await page.goto('/ops.html?wo=live');
    const ms = detailPayload(null);
    ms.job = Object.assign({}, ms.job, { id: 'job-ms-1', type: 'makesafe', job_number: 'SWMS-1' });
    ms.job_work_order = null;
    ms.work_orders = [{ id: 'wo-old', wo_number: 'WO-OLD', kind: 'crew', status: 'sent', trade_name: 'Old Trade' }];
    await stubOps(page, {
      job_detail: ms,
      list_trade_invoice_lines: { lines: [] },
      makesafe_board: { jobs: [], column_counts: {} },
    }, SHAUN);
    await page.evaluate(() => JobWorkOrderOps.openForJob('job-ms-1'));
    await expect(page.locator('#jdOverview')).toHaveClass(/active/);
    await expect(page.locator('#jdBuild')).not.toHaveClass(/active/);
    await expect(page.locator('#jdOverview [data-job-wo-card-open]')).toContainText('Open the draft');
    await expect(page.locator('#jdOverview iframe')).toHaveCount(0);
    await page.evaluate(() => {
      window.__answers.create_work_order = { reject: { code: 'job_type_not_eligible', status: 422, message: 'raw fencing and patio' } };
    });
    await page.locator('#jdOverview [data-job-wo-card-open]').click();
    await expect(page.locator('#jdOverview [data-job-wo-message]')).toHaveText('The draft could not be opened. This job type is not on the server yet.');
    await expect(page.locator('#jdOverview [data-job-wo-card-open]')).toBeEnabled();
    await expect(page.locator('#jdOverview')).toHaveClass(/active/);
    await expect(page.locator('#jdBuild')).not.toHaveClass(/active/);
    const builder = page.locator('[data-makesafe-builder-wo]');
    await expect(builder).toContainText('Work order missing');
    await expect(builder).toContainText('Old crew work order (retiring)');
    await expect(builder).toContainText('WO-OLD');
    await expect(builder).not.toContainText('Available');
    await page.evaluate(() => showJobSubView('build'));
    await expect(page.locator('#jdBuild iframe[src*="patio"]')).toHaveCount(0);
    await expect(page.locator('#jdBuild [data-job-wo-open]')).toBeVisible();
  });

  test('Cap 1B gate 14 passes an approved job work order and does not name sw_create_work_order', async ({ page }) => {
    await page.goto('/ops.html');
    const result = await page.evaluate(() => {
      const engine = window.SW_STAGE_GATE_ENGINE;
      function gate(packet) {
        const r = engine.evaluateStageGates({ id: 'job-1', type: 'fencing' }, packet, { assignments: [] }, {});
        return r.gates.find((g) => g.gate_id === 'work_order_present');
      }
      const job = { id: 'job-1', type: 'fencing', status: 'scheduled' };
      return {
        approved: gate({ job: job, work_order: { id: 'wo-1', wo_number: 'WO-0042', status: 'approved', kind: 'job' }, purchase_orders: [] }),
        missing: gate({ job: job, purchase_orders: [] }),
        draft: gate({ job: job, work_order: { id: 'wo-d', status: 'draft', kind: 'job' }, purchase_orders: [] }),
        picked: packetJobWorkOrder({
          job_work_order: { work_order: { id: 'job-wo', status: 'approved', kind: 'job' } },
          work_order: { id: 'crew', kind: 'crew', status: 'sent' },
          work_orders: [{ id: 'crew2', kind: 'crew', status: 'draft' }],
        }),
        crewOnly: packetJobWorkOrder({
          work_order: { id: 'crew', kind: 'crew', status: 'approved' },
          work_orders: [{ id: 'crew2', kind: 'crew', status: 'sent' }],
        }),
      };
    });
    expect(result.approved.status).toBe('pass');
    expect(result.approved.reason).toContain('approved');
    expect(result.approved.next_action).toBeNull();
    expect(result.missing.next_action).toBe('Open the job work order');
    expect(result.draft.next_action).toBe('Open the job work order');
    expect(JSON.stringify(result)).not.toContain('sw_create_work_order');
    expect(result.picked.id).toBe('job-wo');
    expect(result.crewOnly).toBeNull();
  });

  test('the Work Orders tab explains job work orders and lists old crew rows without Send', async ({ page }) => {
    await page.goto('/ops.html');
    await page.evaluate(() => {
      document.getElementById('subWorkorders').classList.add('active');
      renderWOTable([
        { id: 'wo-old', wo_number: 'WO-OLD', kind: 'crew', status: 'draft', trade_name: 'Old Trade' },
        { id: 'wo-job', wo_number: 'WO-JOB', kind: 'job', status: 'draft' },
      ]);
    });
    await expect(page.locator('#woListNote')).toContainText('Job work orders open on each job page');
    await expect(page.locator('#woListNote')).toContainText('Old crew work orders stay listed here, read-only');
    const old = page.locator('#woTable [data-office-wo="wo-old"]');
    await expect(old).toContainText('Old crew work order (retiring)');
    await expect(old.locator('button')).toHaveCount(0);
    const jobRow = page.locator('#woTable [data-office-wo="wo-job"]');
    await expect(jobRow).toContainText('WO-JOB');
    await expect(jobRow.locator('button')).toHaveCount(0);
    await page.evaluate(() => renderWOTable([]));
    await expect(page.locator('[data-wo-list-empty]')).toContainText('Job work orders open on each job page');
    await expect(page.locator('#woListNote')).toContainText('Old crew work orders stay listed here, read-only');
  });
});
