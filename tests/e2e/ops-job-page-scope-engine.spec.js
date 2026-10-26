// The job page (ops.html) on a job saved from the Scope Engine patio tool (docs/job-scope-record.md).
// Offline: ops-api is replaced by tests/fixtures/scope-engine-patio.js, shaped exactly as the
// engine's save writes it. Guards: every tab reads the record through modules/job-scope-record.js,
// links open the Scope Engine, unknown money is said (never $0 or "Margin: 100%"), and the old
// patio tool is never embedded for an engine job.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { JOB_ID, buildEnginePatioDetail, buildScopeRevisions, pricingJson } = require('../fixtures/scope-engine-patio');

const ENGINE = 'https://marninms98-dotcom.github.io/patio/scope-engine/';
test.use({ viewport: { width: 1360, height: 1000 } });

async function boot(page, { pricing = null, status = null, pipeline = null, bare = false } = {}) {
  await page.route('**/functions/v1/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not stubbed"}' }));
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  const detail = buildEnginePatioDetail();
  if (pricing) detail.job.pricing_json = pricing;
  if (status) detail.job.status = status;
  if (bare) { detail.media = []; detail.documents = []; detail.work_orders = []; delete detail.readiness; }
  const revs = buildScopeRevisions().map((r) => Object.assign({ revision_number: 1 }, r));
  await page.evaluate(({ detail, revs, pipeline }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const unknown = () => Promise.reject(Object.assign(new Error('Unknown action'), { status: 400 }));
    window.opsFetch = (action) => {
      if (action === 'job_detail') return Promise.resolve(clone(detail));
      if (action === 'annotations') return Promise.resolve({ annotations: [] });
      if (action === 'list_job_actions') return Promise.resolve([]);
      return unknown();
    };
    window.opsPost = (action) => action === 'list_scope_revisions_for_job' ? Promise.resolve({ ok: true, revisions: clone(revs) }) : unknown();
    window.opsAuthHeaders = async (extra) => Object.assign({ Authorization: 'Bearer e2e' }, extra || {});
    window.__pipelineReads = [];
    if (pipeline !== null) {
      const fetch0 = window.opsFetch;
      window.opsFetch = (action, params) => {
        if (action !== 'pipeline') return fetch0(action, params);
        window.__pipelineReads.push(params);
        return pipeline === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(clone(pipeline));
      };
    }
  }, { detail, revs, pipeline });
  await page.evaluate((id) => openJobDetail(id), JOB_ID);
  await expect(page.locator('#jobDetailView')).toHaveClass(/active/);
}
const tab = (page, t) => page.evaluate((t) => showJobSubView(t), t);

test('Overview: summary line, Scope card with revision, inputs and five documents, engine links', async ({ page }) => {
  await boot(page);
  await tab(page, 'overview');
  const ov = page.locator('#jdOverview');
  await expect(ov).toContainText('Gable, end to the yard, 7,200 x 4,500 mm');
  await expect(ov).not.toContainText('patio project');
  const card = ov.locator('[data-scope-card="engine"]');
  await expect(card).toContainText('Rev 3');
  await expect(card).toContainText('2 earlier revisions kept');
  await expect(card).toContainText('On risers over the gutter');
  await expect(card).toContainText('6 of 8 measured');
  for (const d of ['Quote', 'Scope of works', 'Work order', 'Material order', 'Crew guide']) await expect(card).toContainText(d);
  await expect(ov.locator('a', { hasText: 'Open Scope' })).toHaveAttribute('href', ENGINE + '?jobId=' + JOB_ID);
  await expect(ov).toContainText('Estimated margin 37.8% before commission');
});

test('Money: sealed costs, commission not known, frozen copy named Rev 3, no "Margin: 100%"', async ({ page }) => {
  await boot(page);
  await tab(page, 'money');
  const m = page.locator('#jdMoney');
  const costs = m.locator('[data-scope-costs]');
  await expect(costs).toContainText('Estimated costs, Rev 3');
  await expect(costs).toContainText('$6,120.00');
  await expect(costs).toContainText('Not known yet');
  await expect(costs).toContainText('20%, $3,190.00');
  await expect(m).not.toContainText('Margin: 100%');
  await expect(m).toContainText('Estimated margin 37.8% before commission');
  await m.locator('a', { hasText: 'View Frozen Revisions' }).click();
  await expect(m).toContainText('Scope Engine Rev 3');
  await expect(m).toContainText('Scope Engine patio 2.0');
  await expect(m).not.toContainText('Revision ?');
});

test('Money: an unpriced engine scope says not known, never $0 costs', async ({ page }) => {
  const p = Object.assign(pricingJson(), { totalExGST: null, gst: null, totalIncGST: null, materialCostEstimate: null, totalCostEstimate: null, pricing_complete: false,
    internal: { costs_complete: false, costs_to_confirm: ['Materials (3 rows with no cost)'], materials: null, labour: 2900, cost: null, commission: null, commission_basis: 'not_set' } });
  await boot(page, { pricing: p });
  await tab(page, 'overview');
  await expect(page.locator('#jdOverview')).toContainText('Not priced yet');
  await tab(page, 'money');
  const costs = page.locator('#jdMoney [data-scope-costs]');
  await expect(costs).toContainText('Still to price: Materials (3 rows with no cost)');
  await expect(costs).not.toContainText('$0.00');
  const quote = page.locator('#jdMoney .jd-money-card-head', { hasText: 'Quote Value' });
  await expect(quote).toContainText('Not priced yet');
  await expect(quote).not.toContainText('$0.00');
});

test('Build: sealed scope and material lines; the old patio tool is not embedded', async ({ page }) => {
  await boot(page);
  await tab(page, 'build');
  const b = page.locator('#jdBuild');
  await expect(b).toContainText('Material lines (6)');
  await expect(b).toContainText('Trimdek roof sheet 4,600');
  await expect(b.locator('iframe')).toHaveCount(0);
  await expect(b.locator('a', { hasText: 'Open in Scope Engine' })).toHaveAttribute('href', ENGINE + '?jobId=' + JOB_ID);
});

test('Files: the Scope Engine documents for Rev 3 above the photos', async ({ page }) => {
  await boot(page);
  await tab(page, 'files');
  const f = page.locator('#jdFiles');
  await expect(f).toContainText('Scope Engine documents (Rev 3)');
  await expect(f.locator('a', { hasText: 'Material order' })).toHaveAttribute('href', ENGINE + '?jobId=' + JOB_ID);
});

test('Files: an engine job with no photos, documents or work orders still lists its documents', async ({ page }) => {
  await boot(page, { bare: true });
  await tab(page, 'files');
  const f = page.locator('#jdFiles');
  await expect(f).toContainText('Scope Engine documents (Rev 3)');
  await expect(f).not.toContainText('No files yet');
});

// <job-dispatch-stage>: the Overview's Dispatch card, read through modules/ops-dispatch.js.
const dispatchRow = (over = {}) => Object.assign({
  id: JOB_ID, job_number: 'SWP-990301', type: 'patio', status: 'order_materials', client_name: 'Casey Morgan',
  updated_at: '2026-10-25T06:44:00Z', value_inc_gst: true, description: 'Gable patio', work_type: 'patio',
  dispatch_todo: true, dispatch_stage: 'materials_ordered', dispatch_stage_index: 3, dispatch_stage_source: 'set',
  dispatch_stage_from: null, dispatch_stage_set_at: '2026-10-25T06:44:00Z', dispatch_stage_set_by: 'Office Person',
  dispatch_next_step: 'Chase Stratco for the delivery date',
}, over);
const listAnswer = (rows) => ({ columns: { order_materials: rows }, total: rows.length, dispatch_stages: 'ok', todo_total: rows.filter((r) => r.dispatch_todo).length });

test('Overview: an accepted job shows its Dispatch stage, next step and a way into Dispatch', async ({ page }) => {
  await boot(page, { status: 'order_materials', pipeline: listAnswer([dispatchRow(), dispatchRow({ id: 'other-job', job_number: 'SWP-9903010', dispatch_todo: false })]) });
  await tab(page, 'overview');
  const card = page.locator('#jdOverview [data-dispatch-card]');
  await expect(card).toContainText('Stage: Materials ordered');
  await expect(card).toContainText('in To do');
  await expect(card).toContainText('Next step: Chase Stratco for the delivery date');
  await expect(card.locator('[aria-current="step"]')).toHaveAttribute('data-dispatch-stop', 'materials_ordered');
  expect(await page.evaluate(() => window.__pipelineReads)).toEqual([{ dispatch: 1, search: 'SWP-990301' }]);
  await card.locator('a', { hasText: 'Open in Dispatch' }).click();
  await expect(page.locator('#jobDetailView')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => sessionStorage.getItem('sw_dispatch_job'))).toBe(JOB_ID);
});

test('Overview: a failed Dispatch read says so, never "not started"', async ({ page }) => {
  await boot(page, { status: 'scheduled', pipeline: 'fail' });
  await tab(page, 'overview');
  const card = page.locator('#jdOverview [data-dispatch-card]');
  await expect(card).toContainText('Could not read the Dispatch stage.');
  await expect(card).not.toContainText('Not started');
});

test('Overview: a quoted job has no Dispatch card and no Dispatch read', async ({ page }) => {
  await boot(page, { pipeline: listAnswer([dispatchRow()]) });
  await tab(page, 'overview');
  await expect(page.locator('#jdOverview')).toContainText('Rev 3');
  await expect(page.locator('#jdOverview [data-dispatch-card]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pipelineReads)).toEqual([]);
});
