// The labour cards read the fields ops-api really sends (secureworks-backend
// pull request 1624: trade_labour_budget and labour_reconciliation), and the
// rate lines "Rate assumed on N shifts" / "N shifts with no rate, left out".
// Before this, both cards read keys the server never sends, so the Trade App
// card said "No labour budget allocated" on every job. A trade never sees a
// budget figure; a failed read says so, never a zero.
// Search <trade-labour-card> in trade.html and <labour-recon-card> in ops.html.
const path = require('node:path');
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const RESPONSES = require('../fixtures/labour-card/responses.json');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

function completeJobDetail(uid) {
  return {
    access_tier: 'office', quote_visible: true,
    job: { id: 'e2e-job-1', job_number: 'E2E-JOB-001', type: 'patio', status: 'complete', client_name: 'Fixture Homeowner',
      site_suburb: 'Joondalup', scheduled_date: '2026-09-09', scope_json: { config: { length: 6, projection: 4 } } },
    crew: [{ id: 'asn-1', user_id: uid, users: { id: uid, name: 'Lead installer' }, scheduled_date: '2026-09-09', status: 'complete',
      started_at: '2026-09-09T00:00:00Z', completed_at: '2026-09-09T08:00:00Z' }],
    purchaseOrders: [], documents: [], notes: [], media: [],
  };
}

async function openScopeTab(page, persona, labour) {
  const uid = PERSONAS[persona].profile.id;
  const reads = [];
  await page.route(`${OPS_API}**`, async (route) => {
    const a = new URL(route.request().url()).searchParams.get('action');
    if (a === 'trade_job_detail') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(completeJobDetail(uid)) });
    if (a === 'trade_labour_budget') {
      reads.push(a);
      if (labour.status) return route.fulfill({ status: labour.status, contentType: 'application/json', body: JSON.stringify({ error: labour.error }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(labour.body) });
    }
    return route.fallback();
  });
  // A cold first load can still be fetching the cloud client when Log In is
  // pressed ("Still loading"); wait for it so the press is heard.
  await page.waitForFunction(() => !!window.SECUREWORKS_CLOUD);
  await signIn(page, PERSONAS[persona]);
  await page.evaluate(() => window.openJob('e2e-job-1'));
  await expect(page.locator('.jd-tabs')).toBeVisible();
  await page.locator('.jd-tab[data-tab="scope"]').click();
  return reads;
}

test.describe('Trade App labour card, office viewer', () => {
  test.use({ persona: 'allocator' });

  test('reads labour_budget, total_hours, total_cost and remainder from the real response', async ({ appPage: page }) => {
    await openScopeTab(page, 'allocator', { body: RESPONSES.trade_labour_budget.clean });
    const card = page.locator('#tabLabourBudget');
    await expect(card).toContainText('Budget$1,800');
    await expect(card).toContainText('Logged16.0 hrs');
    await expect(card).toContainText('Cost$640');
    await expect(card).toContainText('Remainder$1,160');
    await expect(card).not.toContainText('No labour budget allocated');
    await expect(card.locator('[data-labour-trade]')).toHaveCount(2);
    await expect(card.locator('[data-labour-rate-assumed]')).toHaveCount(0);
    await expect(card.locator('[data-labour-rate-missing]')).toHaveCount(0);
  });

  test('names assumed and missing rates as shift counts', async ({ appPage: page }) => {
    await openScopeTab(page, 'allocator', { body: RESPONSES.trade_labour_budget.assumed_and_missing });
    const card = page.locator('#tabLabourBudget');
    await expect(card.locator('[data-labour-rate-assumed]')).toHaveText('Rate assumed on 2 shifts');
    await expect(card.locator('[data-labour-rate-missing]')).toHaveText('1 shift with no rate, left out');
  });

  test('every shift unpriced still shows the left-out line, never a bare zero', async ({ appPage: page }) => {
    await openScopeTab(page, 'allocator', { body: RESPONSES.trade_labour_budget.all_missing });
    const card = page.locator('#tabLabourBudget');
    await expect(card.locator('[data-labour-rate-missing]')).toHaveText('2 shifts with no rate, left out');
    await expect(card).not.toContainText('No hours logged yet');
  });

  test('a budget of 0 reads None and draws no remainder', async ({ appPage: page }) => {
    await openScopeTab(page, 'allocator', { body: RESPONSES.trade_labour_budget.no_budget });
    const card = page.locator('#tabLabourBudget');
    await expect(card).toContainText('BudgetNone');
    await expect(card).toContainText('No labour budget allocated');
    await expect(card).not.toContainText('Remainder');
    await expect(card).not.toContainText('over');
    await expect(card.locator('[data-labour-rate-assumed]')).toHaveText('Rate assumed on 1 shift');
  });

  test('an older response without the rate counts draws no rate line', async ({ appPage: page }) => {
    await openScopeTab(page, 'allocator', { body: RESPONSES.trade_labour_budget.before_rate_counts });
    const card = page.locator('#tabLabourBudget');
    await expect(card).toContainText('Budget$1,800');
    await expect(card.locator('[data-labour-rate-assumed], [data-labour-rate-missing]')).toHaveCount(0);
  });

  test('a refused read (rate history unreadable) says it could not load, never a zero', async ({ appPage: page }) => {
    await openScopeTab(page, 'allocator', { status: 503, error: 'trade_rate_read_failed' });
    const card = page.locator('#tabLabourBudget');
    await expect(card.locator('[data-labour-error]')).toHaveText('Could not load labour');
    await expect(card).not.toContainText('$');
  });
});

test.describe('Trade App labour card, trade viewer', () => {
  test.use({ persona: 'installer' });

  test('a trade sees no labour budget card and no budget figure on a complete job', async ({ appPage: page }) => {
    await openScopeTab(page, 'installer', { body: RESPONSES.trade_labour_budget.assumed_and_missing });
    await expect(page.locator('#jdTab_scope')).toBeVisible();
    await expect(page.locator('#tabLabourBudget')).toHaveCount(0);
    await expect(page.locator('#jdTab_scope')).not.toContainText('$1,800');
    await expect(page.locator('#jdTab_scope')).not.toContainText('Labour Budget');
  });
});

async function bootOps(page, recon) {
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const action = match && match[1];
    if (action === 'labour_reconciliation' && recon) {
      if (recon.status) return route.fulfill({ status: recon.status, contentType: 'application/json', body: JSON.stringify({ error: recon.error }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recon.body) });
    }
    const body = action === 'pipeline' ? { columns: {} } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(OPS_FILE);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
}

async function reconPanel(page) {
  return page.evaluate(async () => {
    var host = document.getElementById('jdLabourRecon');
    if (!host) { host = document.createElement('div'); host.id = 'jdLabourRecon'; document.body.appendChild(host); }
    await loadLabourReconciliation('e2e-job-1');
    return host.textContent;
  });
}

test.describe('Ops Dash Labour Reconciliation', () => {
  test.use({ persona: 'allocator' });

  test('reads total_hours and total_labour_cost from the real response', async ({ page }) => {
    await bootOps(page, { body: RESPONSES.labour_reconciliation.clean });
    const text = await reconPanel(page);
    expect(text).toContain('Labour Budget$1,800.00');
    expect(text).toContain('Hours Logged16.0h');
    expect(text).toContain('Labour Cost$640.00');
    expect(text).toContain('Remainder$1,160.00');
    expect(text).not.toContain('Rate assumed');
    expect(text).not.toContain('with no rate');
  });

  test('names assumed and missing rates as shift counts', async ({ page }) => {
    await bootOps(page, { body: RESPONSES.labour_reconciliation.assumed_and_missing });
    const text = await reconPanel(page);
    expect(text).toContain('Rate assumed on 2 shifts');
    expect(text).toContain('1 shift with no rate, left out');
    expect(text).toContain('Hours Logged10.0h');
  });

  test('every shift unpriced shows the left-out line, not "No labour data recorded yet"', async ({ page }) => {
    await bootOps(page, { body: RESPONSES.labour_reconciliation.all_missing });
    const text = await reconPanel(page);
    expect(text).toContain('1 shift with no rate, left out');
    expect(text).not.toContain('No labour data recorded yet');
    expect(text).toContain('RemainderNo budget');
  });

  test('an older response without the rate counts draws no rate line', async ({ page }) => {
    await bootOps(page, { body: RESPONSES.labour_reconciliation.before_rate_counts });
    const text = await reconPanel(page);
    expect(text).toContain('Labour Cost$640.00');
    expect(text).not.toContain('shift');
  });

  test('missing figures read Unknown, never $0', async ({ page }) => {
    await bootOps(page, { body: { labour_budget: 1800, trades: [] } });
    const text = await reconPanel(page);
    expect(text).toContain('Hours LoggedUnknown');
    expect(text).toContain('Labour CostUnknown');
    expect(text).toContain('RemainderUnknown');
  });

  test('a refused read says the labour data is unavailable', async ({ page }) => {
    await bootOps(page, { status: 503, error: 'labour_assignments_read_failed' });
    const text = await reconPanel(page);
    expect(text).toBe('Labour data unavailable');
  });
});
