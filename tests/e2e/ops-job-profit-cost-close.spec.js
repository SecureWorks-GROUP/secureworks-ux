// Cost close on Job profit (// <job-profit-cost-close>): the server's answer
// worded on the job detail and tagged in the list. Synthetic local capture ->
// real page renderer. No production read, no mutation.
const { test, expect } = require('@playwright/test');
const capture = require('../fixtures/job-profit-order-source.json');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      ? route.continue() : route.abort();
  });
});

function close(over) {
  return Object.assign({
    ok: true, cost_state: 'final', cost_final: true, final_on: '2026-09-19', closed_by: 'rule:cost-close-v1',
    finished: true, finished_on: '2026-08-10', finished_basis: 'work_done', last_cost_on: '2026-08-20',
    waiting_on: [], all_costs_paid: true, quiet_days: 30, as_of: '2026-11-15', rule: 'cost-close-v1'
  }, over || {});
}
function response(cc) {
  const data = JSON.parse(JSON.stringify(capture.response));
  if (cc === undefined) delete data.cost_close; else data.cost_close = cc;
  return data;
}
async function open(page) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => {
    document.querySelectorAll('.view,.sub-view').forEach(el => el.classList.remove('active'));
    document.getElementById('viewFinancials').classList.add('active');
    document.getElementById('subJobprofit').classList.add('active');
  });
}
async function render(page, data) {
  await open(page);
  await page.evaluate(data => { document.getElementById('jpDetail').innerHTML = _jpRenderDetail(data); }, data);
  return page.locator('#jpDetail [data-jp-cost-close]');
}

test('final says since when, what finished it, and that a later cost reopens it', async ({ page }, testInfo) => {
  const note = await render(page, response(close()));
  await expect(note).toHaveAttribute('data-jp-cost-close', 'final');
  await expect(note).toContainText('Final');
  await expect(note).toContainText('no cost has landed for 30 days');
  await expect(note).toContainText('Final since 19 Sept 26');
  await expect(note).toContainText('Finished 10 Aug 26 (the work was recorded as done)');
  await expect(note).toContainText('A cost that lands later reopens it');
  await expect(note).toContainText('Every cost is paid in Xero');
  await expect(note).toContainText('not that the job was invoiced or that every line is verified');
  await page.screenshot({ path: testInfo.outputPath('cost-close-final.png'), fullPage: true });
});

test('settling names the day it becomes final', async ({ page }) => {
  const note = await render(page, response(close({ cost_state: 'settling', cost_final: false, final_on: '2026-12-01', closed_by: null, all_costs_paid: false })));
  await expect(note).toHaveAttribute('data-jp-cost-close', 'settling');
  await expect(note).toContainText('It becomes final on 1 Dec 26 if no cost lands before then');
  await expect(note).not.toContainText('Final since');
});

test('waiting lists each reason in plain words and never reads as final', async ({ page }) => {
  const note = await render(page, response(close({
    cost_state: 'waiting', cost_final: false, final_on: null, closed_by: null,
    waiting_on: ['materials_not_linked', 'work_done_no_labour_overdue', 'no_finish_day', 'dispatch_order_not_billed', 'work_order_not_billed', 'variation_cost_not_in', 'draft_bill_on_job', 'some_new_code']
  })));
  await expect(note).toHaveAttribute('data-jp-cost-close', 'waiting');
  await expect(note).toContainText('Not final');
  const items = note.locator('[data-jp-cc-waiting] li');
  await expect(items).toHaveCount(8);
  await expect(items.nth(0)).toHaveText('Materials owed but none linked');
  await expect(items.nth(1)).toHaveText('Work done and no labour linked after 14 days');
  await expect(items.nth(2)).toHaveText('No finish day is on record for this job');
  await expect(items.nth(3)).toHaveText('A supplier order sent from Dispatch has no bill yet');
  await expect(items.nth(4)).toHaveText('A work order agrees more labour than has been billed');
  await expect(items.nth(5)).toHaveText('A variation was agreed and its cost is not in yet');
  await expect(items.nth(6)).toHaveText('A bill for this job is still a draft in Xero');
  await expect(items.nth(7)).toHaveText('some new code');
  await expect(note.locator('.jp-tag.ok')).toHaveCount(0);
});

test('open and does-not-apply are said as such', async ({ page }) => {
  let note = await render(page, response(close({ cost_state: 'open', cost_final: false, final_on: null, finished: false, finished_on: null, finished_basis: null })));
  await expect(note).toHaveAttribute('data-jp-cost-close', 'open');
  await expect(note).toContainText('The work is not finished, or the job was sent back to work');
  note = await render(page, response(close({ cost_state: 'not_applicable', cost_final: false, final_on: null, finished: false, finished_on: null, finished_basis: null, last_cost_on: null })));
  await expect(note).toHaveAttribute('data-jp-cost-close', 'not_applicable');
  await expect(note).toContainText('Does not apply');
});

test('a failed read, an unknown state or a final without its day is Not known, never Final', async ({ page }) => {
  for (const cc of [
    { ok: false, reason: 'cost close read failed: timeout' },
    close({ cost_state: 'closed' }),
    close({ final_on: null }),
    close({ cost_final: false }),
    close({ cost_state: 'waiting', cost_final: true }),
    null
  ]) {
    const note = await render(page, response(cc));
    await expect(note).toHaveAttribute('data-jp-cost-close', 'unknown');
    await expect(note).toContainText('Not known');
    await expect(note).toContainText('not known to be final');
    await expect(note.locator('.jp-tag.ok')).toHaveCount(0);
  }
  const failed = await render(page, response({ ok: false, reason: 'cost close read failed: timeout' }));
  await expect(failed).toContainText('cost close read failed: timeout');
});

test('an answer without the field draws no cost close section', async ({ page }) => {
  await open(page);
  const html = await page.evaluate(data => _jpRenderDetail(data), response(undefined));
  expect(html).not.toContain('data-jp-cost-close');
  expect(html).not.toContain('Is the cost final?');
});

test('the list tags final, settling and waiting; a job the server did not answer is not known; open has no tag', async ({ page }) => {
  await open(page);
  const row = id => Object.assign({}, capture.response.job, { job_id: id, job_number: id.toUpperCase() });
  const jobs = ['j-final', 'j-settling', 'j-waiting', 'j-open', 'j-missing', 'j-bad'].map(row);
  const by_job = {
    'j-final': close(),
    'j-settling': close({ cost_state: 'settling', cost_final: false, final_on: '2026-12-01' }),
    'j-waiting': close({ cost_state: 'waiting', cost_final: false, final_on: null, waiting_on: ['no_cost_linked'] }),
    'j-open': close({ cost_state: 'open', cost_final: false, final_on: null }),
    'j-bad': close({ final_on: null })
  };
  const tags = await page.evaluate(async ({ jobs, by_job }) => {
    window.opsFetch = async () => ({ jobs, has_more: false, cost_close: { ok: true, by_job } });
    await _jpLoadPage(true);
    const out = {};
    document.querySelectorAll('#jpListBody tr').forEach((tr, i) => {
      const t = tr.querySelector('[data-jp-cc]');
      out[jobs[i].job_id] = t ? t.getAttribute('data-jp-cc') + ':' + t.textContent : null;
    });
    return out;
  }, { jobs, by_job });
  expect(tags).toEqual({
    'j-final': 'final:Cost final', 'j-settling': 'settling:Cost settling', 'j-waiting': 'waiting:Cost not final',
    'j-open': null, 'j-missing': 'unknown:Cost state not known', 'j-bad': 'unknown:Cost state not known'
  });
  await expect(page.locator('#jpListBody [data-jp-cc="waiting"]')).toHaveAttribute('title', 'No cost linked');

  // The whole page's read failed: every job is not known. No field at all: no tag.
  const failed = await page.evaluate(async jobs => {
    window.opsFetch = async () => ({ jobs, has_more: false, cost_close: { ok: false, reason: 'cost close read failed' } });
    await _jpLoadPage(true);
    const all = [...document.querySelectorAll('#jpListBody [data-jp-cc]')].map(t => t.getAttribute('data-jp-cc'));
    window.opsFetch = async () => ({ jobs, has_more: false });
    await _jpLoadPage(true);
    return { all, none: document.querySelectorAll('#jpListBody [data-jp-cc]').length, rows: document.querySelectorAll('#jpListBody tr').length };
  }, jobs);
  expect(failed.all).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  expect(failed.none).toBe(0);
  expect(failed.rows).toBe(6);
});
