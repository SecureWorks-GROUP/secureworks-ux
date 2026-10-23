// Financials > Job profit detail (ops.html, search // <job-profit>). Offline: the
// renderer is called with made-up engine rows. No API call, no live read.
//
// Contract under guard (display only, no money figure computed):
//  - While profit is withheld, linked cost is a floor. A lane under its expected
//    cost reads "Not known until all cost is in", never a green saving; a lane
//    already over reads "at least" the overrun. The total follows the same rule.
//  - Materials owed but none linked reads "None linked yet", not $0.00.
//  - A job still in delivery says profit is not due yet, not "unknown".
//  - Where quoted and expected came from reads in staff words, not engine codes.
//  - A published profit keeps the plain differences it had before.
//  - In the job list, a job with no cost or no client invoice linked reads
//    "None linked" in that column, not $0.00.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

function job(over) {
  return Object.assign({
    job_id: '00000000-0000-4000-8000-0000000000a1', job_number: 'T-FENCE', client_name: 'Test Client',
    work_type: 'fencing', status: 'archived', created_at: '2026-07-01T00:00:00Z',
    quoted_ex: 13255, quoted_source: 'sent_quote:accepted:quote_revision',
    expected_source: 'frozen_at_acceptance', expected_cost_ex: 8027.95,
    expected_labour_ex: 2900, expected_materials_ex: 4400, expected_commission_ex: 727.95,
    actual_cost_ex: 3640, actual_labour_ex: 2945, actual_materials_ex: 0, actual_commission_ex: 695, actual_other_ex: 0,
    invoiced_ex: 13255, collected_ex: 13255, invoice_count: 2, revenue_verified_paid: true,
    profit_ex: null, margin_pct: null, xero_project_expenses_ex: 9723.37,
    cost_flag: 'xero_project_exceeds_line_costs', completeness: ['xero_project_exceeds_line_costs', 'materials_not_linked'],
  }, over || {});
}

async function render(page, j) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  return page.evaluate((j) => {
    const host = document.createElement('div');
    host.innerHTML = _jpRenderDetail({ job: j, trades: [], cost_events: [], revenue_events: [], timeline: [], labels: {} });
    document.body.appendChild(host);
    const rows = Array.from(host.querySelectorAll('[data-jp-lanes] tbody tr')).map((tr) => Array.from(tr.cells).map((c) => c.innerText.trim()));
    return { rows, text: host.innerText };
  }, j);
}

test('withheld profit: an underspend is not a saving, an overrun is "at least"', async ({ page }) => {
  const { rows, text } = await render(page, job());
  expect(rows[0]).toEqual(['Labour', '$2,900.00', '$2,945.00', 'at least $45.00']);
  expect(rows[1]).toEqual(['Materials', '$4,400.00', 'None linked yet', 'Not known until all cost is in']);
  expect(rows[2][3]).toBe('Not known until all cost is in');
  expect(rows[4]).toEqual(['Total', '$8,027.95', '$3,640.00', 'Not known until all cost is in']);
  expect(text).toMatch(/actual cost so far/i); // card labels are upper-cased by CSS
  expect(text).toContain('a lower actual is not a saving');
  expect(text).toContain('accepted quote');
  expect(text).toContain('fixed when the quote was accepted');
  expect(text).not.toContain('accepted:quote_revision');
  expect(text).toContain('Profit and margin unknown.');
});

test('a job in delivery says profit is not due yet', async ({ page }) => {
  const { text } = await render(page, job({ status: 'in_progress', quoted_source: 'sent_quote:newest_current:quote_revision', expected_source: 'sent_quote_revision' }));
  expect(text).toContain('Job not finished: profit not due yet.');
  expect(text).not.toContain('Profit and margin unknown.');
  expect(text).toContain('sent quote, not accepted');
  expect(text).toContain('from a sent quote, not accepted');
});

test('a published profit keeps plain differences', async ({ page }) => {
  const { rows, text } = await render(page, job({
    actual_cost_ex: 7600, actual_materials_ex: 3960, profit_ex: 5655, margin_pct: 42.7,
    cost_flag: 'ok', completeness: [], xero_project_expenses_ex: null,
  }));
  expect(rows[0][3]).toBe('$45.00');
  expect(rows[1]).toEqual(['Materials', '$4,400.00', '$3,960.00', '$-440.00']);
  expect(rows[4][3]).toBe('$-427.95');
  expect(text).toMatch(/actual cost/i);
  expect(text).not.toMatch(/actual cost so far/i);
  expect(text).not.toContain('Not known until all cost is in');
});

test('job list: nothing linked reads None linked, not $0.00', async ({ page }) => {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  const cells = await page.evaluate((rows) => {
    _jp.rows = rows; _jp.more = false;
    _jpRenderList();
    return Array.from(document.querySelectorAll('#jpListBody tr')).map((tr) => [tr.cells[4].innerText.trim(), tr.cells[5].innerText.trim()]);
  }, [
    { job_id: 'a', job_number: 'T-EMPTY', status: 'complete', actual_cost_ex: 0, invoiced_ex: 0, collected_ex: 0, completeness: ['missing_client_invoice', 'no_cost_linked'], cost_flag: 'no_cost_linked' },
    { job_id: 'b', job_number: 'T-SOME', status: 'complete', actual_cost_ex: 1200, invoiced_ex: 3000, collected_ex: 0, completeness: [], cost_flag: 'ok' },
  ]);
  expect(cells[0]).toEqual(['None linked', 'None linked']);
  expect(cells[1]).toEqual(['$1,200.00', '$3,000.00']);
});
