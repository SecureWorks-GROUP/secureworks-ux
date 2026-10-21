// Financials > Job profit detail, "Bills placed whole on this job" (ops.html, search
// // <job-profit>). Offline: the renderer is called with made-up engine rows, and
// get_xero_invoice is answered in the page. No live read, no write.
//
// Contract under guard (display only; the engine's figures and allocation are unchanged):
//  - A supplier bill linked whole whose lines name another job reads "Not confirmed for this
//    job", says how it was placed and that it counts here in full until a person moves, splits
//    or unplaces it, and lists the named jobs as evidence (inferred from the line text), never
//    as a split. How it was placed reads from match_method: a person, a machine or Xero's reference.
//  - A bill whose lines name only this job, and the parts of a person's split, show no note.
//  - A bill placed whole as one row offers a read-only check of its lines; a failed read says
//    so with Try again.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const JOB = {
  job_id: '00000000-0000-4000-8000-0000000000b1', job_number: 'SWF-27001', client_name: 'Test Client',
  work_type: 'fencing', status: 'complete', created_at: '2026-08-01T00:00:00Z',
  quoted_ex: null, expected_cost_ex: null, actual_cost_ex: 5083.4, actual_labour_ex: 5083.4,
  invoiced_ex: 0, collected_ex: 0, profit_ex: null, margin_pct: null, completeness: ['missing_client_invoice'],
};

function line(description, amount, over) {
  return Object.assign({ source: 'supplier_bill', document_id: 'xinv-31', document_number: '31', party: 'Installer EH',
    match_method: 'xero_invoices.job_id', event_date: '2026-08-27', lane: 'labour', description, amount_ex: amount }, over || {});
}

async function render(page, job, costs, invoices) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  return page.evaluate(({ job, costs, invoices }) => {
    window.__reads = [];
    window.opsFetch = (action, params) => {
      window.__reads.push({ action, params });
      if (action === 'get_xero_invoice' && invoices[params.xero_invoice_id]) return Promise.resolve(JSON.parse(JSON.stringify(invoices[params.xero_invoice_id])));
      const e = new Error('Xero did not answer'); e.status = 502; return Promise.reject(e);
    };
    const host = document.createElement('div');
    host.id = 'wholeBillHost';
    host.innerHTML = _jpRenderDetail({ job, trades: [], cost_events: costs, revenue_events: [], timeline: [], labels: {} });
    document.body.appendChild(host);
    return host.innerText;
  }, { job, costs, invoices: invoices || {} });
}

test('a bill linked whole whose lines name ten jobs reads not confirmed, with the jobs as evidence', async ({ page }) => {
  const costs = [line('SWF-26824 plinths and gate', 1519), line('SWF-26824 less work order paid in app', -1302),
    line('SWF-27001 install', 820), line('SWF-27002 install', 640), line('Ute hire', 65.08)];
  const text = await render(page, Object.assign({}, JOB, { job_number: 'SBX-HOLD' }), costs);
  const note = page.locator('#wholeBillHost [data-jp-whole-bill="xinv-31"]');
  await expect(note).toContainText('Not confirmed for this job');
  await expect(note).toContainText("Installer EH 31, $1,742.08, is linked whole by the bill's job in Xero (Xero's reference, not a person), but its lines name 3 jobs. It counts here in full until a person moves, splits or unplaces it.");
  await expect(note).toContainText("Jobs named on the bill's lines (inferred from the line text; evidence, not a split)");
  await expect(note.locator('[data-bill-ref="SWF-26824"]')).toHaveText('SWF-26824: $217.00 on 2 lines');
  await expect(note).toContainText('No single job named: $65.08');
  expect(text).toContain('Naming a job on a bill shows evidence only and never puts cost on that job.');
});

test('a bill whose lines name only this job, and a split part, show no whole-bill note', async ({ page }) => {
  const costs = [line('SWF-27001 install', 820), line('SWF-27001 gate', 100),
    line('SWF-27002 install', 640, { document_id: 'xinv-32', match_method: 'manual_split' })];
  const text = await render(page, JOB, costs);
  await expect(page.locator('#wholeBillHost [data-jp-whole-bill]')).toHaveCount(0);
  expect(text).not.toContain('Bills placed whole on this job');
});

test('a bill placed whole as one row offers a read-only check of its lines', async ({ page }) => {
  const costs = [line('manual_queue:assign-to-job SWF-27001', 5083.4, { source: 'materials_fact', match_method: 'manual_queue' })];
  const invoices = { 'xinv-31': { ok: true, invoice: { line_items: [
    { description: 'SWF-26824 plinths and gate', line_amount: 1519 }, { description: 'SWF-27001 install', line_amount: 820 }] } } };
  await render(page, JOB, costs, invoices);
  const note = page.locator('#wholeBillHost [data-jp-whole-bill="xinv-31"]');
  await expect(note).toContainText('is placed whole by a person in Bills to place');
  await note.locator('button').click();
  const check = note.locator('[data-jp-bill-check="xinv-31"]');
  await expect(check).toContainText('Not confirmed for this job');
  await expect(check.locator('[data-bill-ref="SWF-27001"]')).toHaveText('SWF-27001 (this job): $820.00 on 1 line');
  await expect(check.locator('[data-bill-ref="SWF-26824"]')).toHaveText('SWF-26824: $1,519.00 on 1 line');
  expect(await page.evaluate(() => window.__reads)).toEqual([{ action: 'get_xero_invoice', params: { xero_invoice_id: 'xinv-31' } }]);
});

test('an unconfirmed installer bill a machine placed says so and offers the same check', async ({ page }) => {
  const costs = [line('Installer EH 31', 5083.4, { source: 'installer_bill_unconfirmed', match_method: 'xero_ref_link' })];
  const text = await render(page, JOB, costs);
  const note = page.locator('#wholeBillHost [data-jp-whole-bill="xinv-31"]');
  await expect(note).toContainText('is placed whole by a machine from its Xero reference');
  await expect(note.locator('button')).toHaveText('Check which jobs its lines name');
  expect(text).toContain('unplacing a bill is not available');
});

test('a failed line read says so and offers Try again', async ({ page }) => {
  const costs = [line('manual_queue:assign-to-job SWF-27001', 5083.4, { source: 'materials_fact', match_method: 'manual_queue' })];
  await render(page, JOB, costs);
  const note = page.locator('#wholeBillHost [data-jp-whole-bill="xinv-31"]');
  await note.locator('button').click();
  await expect(note.locator('[data-jp-bill-check]')).toContainText("Could not read the bill's lines: Xero did not answer");
  await expect(note.locator('[data-jp-bill-check] button')).toHaveText('Try again');
});
