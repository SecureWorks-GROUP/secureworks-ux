// Proof of today's merged screens (Follow-up 56, 18 Nov 2026), re-rendered
// from fixtures with no network: the weekly pay run (P1-10.6, #714), jobs
// needing a work order (P1-05.3, #727 and #728) and the labour cards
// (AX-LABOUR-CARD, #724). Each test draws the screen, checks the lines that
// prove it is the merged one, and takes its picture. With PROOF_SHOT_DIR set
// the pictures are written there (docs/evidence/proof-18nov/); otherwise they
// go to the test output folder. Roles and ZZTEST job numbers only, made-up
// amounts.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, PERSONAS } = require('../fixtures/test');
const { revealOpsStaticFixture, installOpsSessionStub } = require('../helpers/ops-auth');
const { signIn } = require('../helpers/auth');
const RESPONSES = require('../fixtures/labour-card/responses.json');

const root = path.resolve(__dirname, '../..');
const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const OPS_FILE = 'file://' + path.join(root, 'ops.html');

test.describe.configure({ timeout: 60_000 });

function shotPath(testInfo, name) {
  const dir = process.env.PROOF_SHOT_DIR;
  if (dir) { fs.mkdirSync(dir, { recursive: true }); return path.join(dir, name); }
  return testInfo.outputPath(name);
}

// ---- Pay run week (modules/ops-pay-run.js, PayRun.open) -------------------

const CHECKS = ['pay_equals_job_cost', 'nobody_above_work_order', 'super_is_12_over_112',
  'no_paid_line_without_work_order', 'nothing_lost', 'crew_accepted'];

function invoice(n, role, extra = {}) {
  return { invoice_id: `ZZTEST-id-${n}`, invoice_number: `ZZTEST-INV-${n}`, kind: 'standard', trade_name: role,
    user_id: `ZZTEST-user-${n}`, week_start: '2026-11-16', total_inc_super: 1120, paid_to_you: 1000, super_amount: 120,
    reimbursements: 0, gst: 0, into_bank: 1000, verdict: 'clean', stops: [], xero_bill_id: null, pushed: false, ...extra };
}

const PAY_RUN = {
  ok: true, week_start: '2026-11-16', cut_off: '2026-11-22T23:59:59+08:00', stage: 'before_xero', run: null, can_approve: true,
  counts: { clean: 3, stopped: 1, late: 1 },
  totals: { total_inc_super: 4480, paid_to_you: 4000, super: 480, gst: 0, reimbursements: 0, into_bank: 4000 },
  held: { lines_waiting: 2, amount_ex: 250.5, by_reason: [{ reason: 'ZZTEST', lines: 2, amount_ex: 250.5 }] },
  invoices: [
    invoice(4, 'Repair crew', { verdict: 'stopped', stops: [{ code: 'no_times', words: 'ZZTEST stop: a line has no finish time.' }] }),
    invoice(1, 'Fencing crew'),
    invoice(2, 'Lead installer'),
    invoice(3, 'Patio crew'),
  ],
  late_invoices: [{ invoice_id: 'ZZTEST-late-1', invoice_number: 'ZZTEST-LATE-1', user_id: 'ZZTEST-user-late', submitted_at: '2026-11-23T08:00:00+08:00' }],
  super_by_person: [{ user_id: 'ZZTEST-user-1', trade_name: 'Fencing crew', super_amount: 120 },
    { user_id: 'ZZTEST-user-2', trade_name: 'Lead installer', super_amount: 120 },
    { user_id: 'ZZTEST-user-3', trade_name: 'Patio crew', super_amount: 120 }],
  standing: CHECKS.map((code) => ({ code, pass: true, checked: 3, failed: 0, words: 'No difference found.', invoices: [], skipped: 0, skipped_why: null, expected: 0, actual: 0 })),
  run_blocked: false, run_blocked_words: null, clean_ids_hash: 'ZZTEST',
};

test('pay run week re-renders from fixtures, read only', async ({ page }, testInfo) => {
  const css = fs.readFileSync(path.join(root, 'ops.html'), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ZZTEST-proof-pay-run') return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1100px;margin:auto;padding:20px"><button id="payTab">Pay run</button><div id="payRunHost"></div></main><script src="/modules/ops-pay-run.js"></script></body></html>` });
    if (url.pathname === '/modules/ops-pay-run.js') return route.fulfill({ path: path.join(root, 'modules/ops-pay-run.js'), contentType: 'text/javascript' });
    return route.abort();
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/ZZTEST-proof-pay-run');
  await page.evaluate((answer) => {
    window.__writes = [];
    window.opsFetch = async (action) => {
      if (action !== 'pay_run') throw new Error('Read unavailable');
      return structuredClone(answer);
    };
    window.opsPost = async (action) => { window.__writes.push(action); throw new Error('No write is allowed'); };
    return PayRun.open(document.getElementById('payRunHost'), document.getElementById('payTab'));
  }, PAY_RUN);
  const run = page.locator('[data-pay-run]');
  await expect(run.locator('[data-week-label]')).toContainText('16 Nov 2026');
  await expect(run.locator('[data-check]')).toHaveCount(6);
  await expect(run.locator('[data-pay-run-table] tbody tr')).toHaveCount(4);
  await expect(run.locator('[data-pay-run-table] tbody tr').first()).toHaveAttribute('data-verdict', 'stopped');
  await expect(run.locator('[data-held-lines]')).toHaveText('Still with the office: 2 lines, $250.50');
  await page.screenshot({ path: shotPath(testInfo, 'pay-run-week-1280.png'), fullPage: true });
  expect(await page.evaluate(() => window.__writes)).toEqual([]);
});

// ---- Jobs needing a work order (modules/ops-office-wo-queue.js) ----------

const GAPS = (heldAt) => ({
  counts: { no_work_order: 1, no_amount: 1, jobs_with_held_lines: 1 },
  jobs: [
    { job_id: 'ZZTEST-job-201', job_number: 'ZZTEST-201', type: 'fencing', status: 'scheduled', reason: 'no_work_order',
      work_order_id: null, held_lines: 2, held_amount_ex: 748, held_trades: 2, oldest_held_at: heldAt },
    { job_id: 'ZZTEST-job-202', job_number: 'ZZTEST-202', type: 'repair', status: 'accepted', reason: 'no_amount',
      work_order_id: 'ZZTEST-wo-202', held_lines: 0, held_amount_ex: 0, held_trades: 0, oldest_held_at: null },
  ],
});
const FILL_ROW = { id: 'ZZTEST-wo-202', job_id: 'ZZTEST-job-202', wo_number: 'WO-202', status: 'draft', agreed_labour_ex: null,
  needs_allowance: true, updated_at: '2026-11-18T01:00:00.000Z', job_number: 'ZZTEST-202', job_type: 'repair', client_name: null, site_suburb: null };

test('jobs needing a work order re-render from fixtures', async ({ page }, testInfo) => {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.waitForFunction(() => window.OfficeWoFill && window.JobWorkOrderOps, null, { timeout: 45_000 });
  const heldAt = new Date(Date.now() - (3 * 86400000 + 3600000)).toISOString();
  await page.evaluate(({ gaps, draft }) => {
    window.__posts = [];
    window.SECUREWORKS_CLOUD = { auth: { getRole: () => 'ops_manager' } };
    window.JobWorkOrderOps.openForJob = function () {};
    document.querySelectorAll('.view.active,.sub-view.active').forEach((el) => el.classList.remove('active'));
    document.getElementById('viewFinancials').classList.add('active');
    document.getElementById('subWorkorders').classList.add('active');
    window.opsFetch = async (action) => {
      if (action === 'job_work_order_gaps') return gaps;
      if (action === 'list_office_job_work_orders') return { enabled: true, work_orders: [draft] };
      if (action === 'list_work_orders') return { work_orders: [], cap_read: 'ok' };
      if (action === 'work_order_changes') return { changes: [] };
      return {};
    };
    window.opsPost = async (action) => { window.__posts.push(action); throw new Error('no writes here'); };
    return loadWOs();
  }, { gaps: GAPS(heldAt), draft: FILL_ROW });
  const section = page.locator('[data-office-wo-gaps]');
  await expect(section).toContainText('Needs a work order');
  await expect(section).toContainText('Jobs with no work order: 1');
  await expect(section).toContainText('Work orders with no amount: 1');
  await expect(section).toContainText('Jobs with pay waiting: 1');
  await expect(section.locator('[data-office-wo-gap="ZZTEST-job-201"] [data-office-wo-gap-waiting]'))
    .toHaveText('2 pay lines from 2 trades are waiting on this job ($748.00), oldest 3 days');
  await expect(section.locator('[data-office-wo-gap="ZZTEST-job-202"]')).toContainText('No amount yet');
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: shotPath(testInfo, 'jobs-needing-work-order-1280.png') });
  expect(await page.evaluate(() => window.__posts)).toEqual([]);
});

// ---- Labour cards: Trade App (office viewer) and Ops Dash ---------------

function completeJobDetail(uid) {
  return {
    access_tier: 'office', quote_visible: true,
    job: { id: 'e2e-job-1', job_number: 'ZZTEST-JOB-001', type: 'patio', status: 'complete', client_name: null,
      site_suburb: null, scheduled_date: '2026-09-09', scope_json: { config: { length: 6, projection: 4 } } },
    crew: [{ id: 'asn-1', user_id: uid, users: { id: uid, name: 'Lead installer' }, scheduled_date: '2026-09-09', status: 'complete',
      started_at: '2026-09-09T00:00:00Z', completed_at: '2026-09-09T08:00:00Z' }],
    purchaseOrders: [], documents: [], notes: [], media: [],
  };
}

test.describe('labour cards', () => {
  test.use({ persona: 'allocator' });

  test('Trade App labour card re-renders with rate lines', async ({ appPage: page }, testInfo) => {
    const uid = PERSONAS.allocator.profile.id;
    await page.route(`${OPS_API}**`, async (route) => {
      const a = new URL(route.request().url()).searchParams.get('action');
      if (a === 'trade_job_detail') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(completeJobDetail(uid)) });
      if (a === 'trade_labour_budget') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESPONSES.trade_labour_budget.assumed_and_missing) });
      return route.fallback();
    });
    await page.waitForFunction(() => !!window.SECUREWORKS_CLOUD);
    await signIn(page, PERSONAS.allocator);
    await page.evaluate(() => window.openJob('e2e-job-1'));
    await expect(page.locator('.jd-tabs')).toBeVisible();
    await page.locator('.jd-tab[data-tab="scope"]').click();
    const card = page.locator('#tabLabourBudget');
    await expect(card.locator('[data-labour-rate-assumed]')).toHaveText('Rate assumed on 2 shifts');
    await expect(card.locator('[data-labour-rate-missing]')).toHaveText('1 shift with no rate, left out');
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: shotPath(testInfo, 'labour-card-trade-app.png') });
  });

  test('Ops Dash labour reconciliation re-renders with rate lines', async ({ page }, testInfo) => {
    await installOpsSessionStub(page);
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('file://')) return route.continue();
      const m = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
      const action = m && m[1];
      if (action === 'labour_reconciliation') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESPONSES.labour_reconciliation.assumed_and_missing) });
      const body = action === 'pipeline' ? { columns: {} } : {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(OPS_FILE);
    await expect(page.locator('#viewJobs')).toHaveClass(/active/);
    const text = await page.evaluate(async () => {
      var host = document.getElementById('jdLabourRecon');
      if (!host) {
        host = document.createElement('div');
        host.id = 'jdLabourRecon';
        host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;width:640px;padding:16px;background:var(--sw-white,#fff)';
        document.body.appendChild(host);
      }
      await loadLabourReconciliation('e2e-job-1');
      return host.textContent;
    });
    expect(text).toContain('Rate assumed on 2 shifts');
    expect(text).toContain('1 shift with no rate, left out');
    await page.locator('#jdLabourRecon').screenshot({ path: shotPath(testInfo, 'labour-card-ops-dash.png') });
  });
});
