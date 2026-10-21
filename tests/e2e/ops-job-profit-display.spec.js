// Financials > Job profit detail (ops.html, search // <job-profit>): display fixes
// L7, L8, L10, L13 and recovery wording (CFO, 21 Oct). Offline: the renderer is
// called with made-up engine rows, and every ops-api read is answered in the page.
// No live read, no write.
//
// Contract under guard (display only; every figure still comes from the engine):
//  - L7: each trade's own lines open under its row with what each line was counted as.
//  - L8: "Committed (open orders)" is its own card from committed_open_ex, never added to
//    actual cost; unpriced orders and emailed invoices are counts, never dollars; a read
//    without the field says so instead of $0.00.
//  - L10: status, how a materials record was placed, and the definitions under the job read
//    in staff words, not engine codes or field names.
//  - L13: at phone width the job page is no wider than the screen and its tables stack.
//  - A failed job list read says nothing is known and what to do next.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const ENGINE_LABELS = {
  quoted_ex: 'What was quoted: the value of a sent or accepted quote, ex GST. Null when no quote was sent. Never the live price. quoted_source names the quote it came from.',
  expected_cost_ex: 'Expected cost fixed at the quote, ex GST, with expected_labour_ex, expected_materials_ex and expected_commission_ex. expected_source is frozen_at_acceptance, accepted_quote_revision or sent_quote_revision.',
  committed_open_ex: 'Priced open purchase orders with no supplier invoice emailed and no bill placed, ex GST. Committed, not actual.',
  xero_project_expenses_ex: 'Expenses on record against the job\'s Xero Project. One linked by contact only gives no figure and the job is flagged xero_project_linked_by_contact_only.',
  margin: 'Null when job_financials would suppress it (no client invoice, no cost, no labour linked).',
  some_new_key: 'Not shown: the page lists the keys it explains.',
};

function job(over) {
  return Object.assign({
    job_id: '00000000-0000-4000-8000-0000000000c1', job_number: 'SWP-26376', client_name: 'Test Client',
    work_type: 'patio', status: 'in_progress', created_at: '2026-08-20T00:00:00Z',
    quoted_ex: 16818.57, quoted_source: 'sent_quote:newest_current:quote_revision',
    expected_source: 'sent_quote_revision', expected_cost_ex: 8821.31,
    expected_labour_ex: 3200, expected_materials_ex: 4732.73, expected_commission_ex: 888.58,
    actual_cost_ex: 2715, actual_labour_ex: 2715, actual_materials_ex: 0, actual_commission_ex: 0, actual_other_ex: 0,
    invoiced_ex: 8636.36, collected_ex: 8636.36, invoice_count: 1, revenue_verified_paid: true,
    profit_ex: null, margin_pct: null, committed_open_ex: 5200,
    completeness: ['materials_not_linked', 'open_purchase_orders'],
  }, over || {});
}

const PARTY = '00000000-0000-4000-8000-0000000000d1';
function tradeLine(description, amount, date, hours) {
  return { source: 'trade_line', party_id: PARTY, party: 'Patio Crew', lane: 'labour', description, amount_ex: amount,
    event_date: date, hours, document_number: 'SW-INV-4', is_actual: true, match_method: 'job_id' };
}
const TRADES = [{ party_id: PARTY, party: 'Patio Crew', amount_ex: 2715, lines: 3, first: '2026-10-06', last: '2026-10-08' }];
const TRADE_LINES = [tradeLine('Beams and purlins', 1000, '2026-10-08', 20), tradeLine('Footings and posts', 1615, '2026-10-06', 32), tradeLine('Materials Ordered', 100, '2026-10-08', null)];

async function render(page, data, opts) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  return page.evaluate(({ data, inView }) => {
    const d = Object.assign({ job: {}, trades: [], cost_events: [], revenue_events: [], timeline: [], labels: {} }, data);
    let host;
    if (inView) {
      // The real container, so the page's own layout applies (phone checks).
      showView('financials');
      document.querySelectorAll('.sub-view').forEach((el) => el.classList.remove('active'));
      document.getElementById('subJobprofit').classList.add('active');
      host = document.getElementById('jpDetail');
    } else {
      host = document.createElement('div');
      document.body.appendChild(host);
    }
    host.id = host.id || 'displayHost';
    host.innerHTML = _jpRenderDetail(d);
    return host.innerText;
  }, { data, inView: !!(opts && opts.inView) });
}

test('L7: a trade\'s own lines open under its row, with what each was counted as', async ({ page }) => {
  await render(page, { job: job(), trades: TRADES, cost_events: TRADE_LINES });
  const toggle = page.locator('[data-jp-trade-toggle]');
  await expect(toggle).toHaveText('Show 3 lines');
  const lines = page.locator('[data-jp-trade-lines]');
  await expect(lines).toBeHidden();
  await toggle.click();
  await expect(lines).toBeVisible();
  await expect(toggle).toHaveText('Hide 3 lines');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const items = lines.locator('li');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Footings and posts');
  await expect(items.nth(2)).toContainText('Materials Ordered');
  await expect(items.nth(2)).toContainText('$100.00');
  await expect(items.nth(2)).toContainText('counted as labour');
  await toggle.click();
  await expect(lines).toBeHidden();
});

test('L7: a trade whose lines are not all in the read says how many are', async ({ page }) => {
  await render(page, { job: job(), trades: TRADES, cost_events: TRADE_LINES.slice(0, 2) });
  await expect(page.locator('[data-jp-trade-toggle]')).toHaveText('Show 3 lines');
  await page.locator('[data-jp-trade-toggle]').click();
  await expect(page.locator('[data-jp-lines-short]')).toHaveText('2 of 3 lines are in this read.');
});

test('L8: committed open orders is its own card and is not added to actual cost', async ({ page }) => {
  const text = await render(page, { job: job({ ordered_not_billed_count: 2, invoice_emailed_count: 1 }) });
  const card = page.locator('[data-jp-committed]');
  await expect(card).toContainText('$5,200.00');
  await expect(card).toContainText('open orders; not in actual cost; plus 2 orders with no price, amount not known; 1 supplier invoice emailed, no bill matched yet');
  expect(text).toContain('$2,715.00'); // actual so far unchanged
  expect(text).not.toContain('Open purchase orders $5,200.00');
});

test('L8: no priced open orders, an unknown figure and a read without the field each say so', async ({ page }) => {
  await render(page, { job: job({ committed_open_ex: 0 }) });
  await expect(page.locator('[data-jp-committed]')).toContainText('$0.00');
  await expect(page.locator('[data-jp-committed]')).toContainText('no priced open orders');
  await render(page, { job: job({ committed_open_ex: null }) });
  await expect(page.locator('[data-jp-committed] .v')).toHaveText('Not known');
  const j = job(); delete j.committed_open_ex;
  await render(page, { job: j });
  await expect(page.locator('[data-jp-committed] .v')).toHaveText('Not in this read');
});

test('L10: status, how a record was placed and the definitions read in staff words', async ({ page }) => {
  const costs = [
    { source: 'materials_fact', party: 'Steel Supplies', description: 'manual_queue:assign-to-job SWP-26376', document_id: 'x1', document_number: 'B-1', lane: 'materials', amount_ex: 10, match_method: 'manual_split' },
    { source: 'materials_fact', party: 'Steel Supplies', description: 'ref:SWP-26376', document_id: 'x2', document_number: 'B-2', lane: 'materials', amount_ex: 20, match_method: 'manual_split' },
    { source: 'materials_fact', party: 'Steel Supplies', description: 'po:PO-640 unique amt±5%/$50 win-60d', document_id: 'x3', document_number: 'B-3', lane: 'materials', amount_ex: 30, match_method: 'manual_split' },
    { source: 'materials_fact', party: 'Steel Supplies', description: 'manual_split:3 jobs + overhead 120.5', document_id: 'x4', document_number: 'B-4', lane: 'materials', amount_ex: 40, match_method: 'manual_split' },
  ];
  const text = await render(page, { job: job(), cost_events: costs, labels: ENGINE_LABELS });
  expect(text).not.toContain('in_progress');
  expect(text).toContain('Placed by a person in Bills to place on SWP-26376');
  expect(text).toContain('Placed by a machine: the bill\'s Xero reference names SWP-26376');
  expect(text).toContain('Placed by a machine: matched to purchase order PO-640 by amount and date');
  expect(text).toContain('Split by a person across 3 jobs, with $120.50 to overhead');
  for (const code of ['manual_queue:', 'quoted_source', 'expected_labour_ex', 'job_financials', 'xero_project_linked_by_contact_only', 'frozen_at_acceptance']) expect(text).not.toContain(code);
  await expect(page.locator('[data-jp-label]')).toHaveCount(5);
  await expect(page.locator('[data-jp-label="committed_open_ex"]')).toContainText('An order with no price is never counted here as $0.00.');
  expect(text).not.toContain('Not shown: the page lists the keys it explains.');
});

test('L13: at phone width the job page fits the screen and its tables stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await render(page, { job: job(), trades: TRADES, cost_events: TRADE_LINES, labels: ENGINE_LABELS }, { inView: true });
  await page.locator('[data-jp-trade-toggle]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const lanes = page.locator('[data-jp-lanes] tbody tr').first();
  expect(await lanes.evaluate((tr) => getComputedStyle(tr).display)).toBe('grid');
  await expect(page.locator('[data-jp-lanes] thead')).toBeHidden();
  // The cell the misreading was about is on screen, not cut off.
  const box = await page.locator('[data-jp-lanes] tbody tr').nth(1).locator('td').nth(3).boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('a failed job list read says nothing is known and what to do next', async ({ page }) => {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  const text = await page.evaluate(async () => {
    window._canSeeJobProfit = () => true;
    window.opsFetch = () => { const e = new Error('canceling statement due to statement timeout'); e.status = 500; return Promise.reject(e); };
    showView('financials');
    document.querySelectorAll('.sub-view').forEach((el) => el.classList.remove('active'));
    document.getElementById('subJobprofit').classList.add('active');
    await loadJobProfit();
    return document.getElementById('jpListBody').innerText;
  });
  expect(text).toContain('Could not load the job list, so no job here is known: canceling statement due to statement timeout. Press Retry; if it keeps failing, narrow the filters and try again.');
});
