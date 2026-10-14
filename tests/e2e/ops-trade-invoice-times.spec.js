// Ops sees WHEN a trade says the hours were worked (Captain, 2026-10-12):
// the date, start and finish sit beside the hours on a trade invoice when the
// line carries them, and an older line with no times shows exactly what it
// always did. Search `// <trade-time-entry-ops>` in
// ops.html. The page makes no network request it is not handed here.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

const TIMED = { job_number: 'SWF-26001', line_type: 'labour', cost_lane: 'labour', total_hours: 8, hourly_rate: 55, line_total_ex: 440, work_date: '2026-10-07', start_time: '07:00:00', finish_time: '15:30:00', break_minutes: 30 };
const SECOND_DAY = { job_number: 'SWF-26001', line_type: 'labour', cost_lane: 'labour', total_hours: 4, hourly_rate: 55, line_total_ex: 220, work_date: '2026-10-08', start_time: '08:00', finish_time: '12:00', break_minutes: 0 };
const OLDER = { job_number: 'SWF-25990', line_type: 'labour', cost_lane: 'labour', total_hours: 6, hourly_rate: 55, line_total_ex: 330, line_date: '2026-09-02' };

async function bootOps(page, responses = {}) {
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const body = match && responses[match[1]] ? responses[match[1]] : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(OPS_FILE);
  await page.waitForFunction(() => typeof window.renderTradeBillTable === 'function' && typeof window.swTradeTimeEntry === 'function');
}

test('trade bills: an invoice whose lines carry times lists them under the trade; an older invoice shows nothing extra', async ({ page }) => {
  await bootOps(page);
  await page.evaluate(([timed, second, older]) => {
    window.renderTradeBillTable([
      { id: 'inv-new', users: { name: 'New Trade' }, week_start: '2026-10-05', total_hours: 12, total_inc: 660, status: 'pending_ops_review', lines: [second, timed] },
      { id: 'inv-old', users: { name: 'Older Trade' }, week_start: '2026-08-31', total_hours: 6, total_inc: 330, status: 'paid', lines: [older] }
    ]);
  }, [TIMED, SECOND_DAY, OLDER]);

  const rows = page.locator('#tradeBillTable tbody tr');
  const fresh = rows.filter({ hasText: 'New Trade' });
  await expect(fresh.locator('[data-invoice-when] summary')).toHaveText('Times worked (2)');
  // In the order they were worked, each with its job, span and hours.
  await expect(fresh.locator('[data-invoice-when] div')).toHaveText([
    'Wed 7 Oct · SWF-26001 · 07:00 to 15:30, 30 min break · 8h',
    'Thu 8 Oct · SWF-26001 · 08:00 to 12:00 · 4h'
  ]);
  await expect(rows.filter({ hasText: 'Older Trade' }).locator('[data-invoice-when]')).toHaveCount(0);
});

// A trade who hires a ute from us has a weekly amount taken off what he is paid
// (Captain, 2026-10-13; secureworks-backend
// docs/trade-recurring-deductions-2026-10-13.md). Search
// `// <trade-recurring-deduction-ops>` in ops.html.
test('trade bills: an invoice carrying a deduction shows the amount payable with the label and amount; every other invoice reads as before', async ({ page }) => {
  await bootOps(page);
  await page.evaluate(() => {
    window.renderTradeBillTable([
      {
        id: 'inv-ute', users: { name: 'Ute Trade' }, week_start: '2026-10-12', total_hours: 8, total_inc: 440, status: 'pushed_to_xero',
        trade_payable: 316, payable_before_deduction: 416, recurring_deduction: { id: 'rule-1', label: 'Ute hire', amount: 100 }
      },
      // Today's server: trade_payable on every invoice, no deduction key.
      { id: 'inv-plain', users: { name: 'Plain Trade' }, week_start: '2026-10-12', total_hours: 8, total_inc: 440, trade_payable: 416, status: 'pushed_to_xero' },
      // An older response with none of the new fields.
      { id: 'inv-older', users: { name: 'Older Trade' }, week_start: '2026-10-05', total_hours: 6, total_inc: 330, status: 'paid' }
    ]);
  });

  const rows = page.locator('#tradeBillTable tbody tr');
  const ute = rows.filter({ hasText: 'Ute Trade' }).locator('td').nth(3);
  await expect(ute.locator('[data-invoice-payable]')).toHaveText('$316.00');
  await expect(ute.locator('[data-invoice-deduction]')).toHaveText('Payable after Ute hire −$100.00');
  await expect(ute.locator('[data-invoice-total]')).toHaveText('Invoice total $440.00');

  // No new row, wording or figure for a trade with no deduction: the cell is
  // the one string it always was, and the status cell carries no note.
  for (const [name, total, status] of [['Plain Trade', '$440.00', 'pushed to xero'], ['Older Trade', '$330.00', 'paid']]) {
    const cells = rows.filter({ hasText: name }).locator('td');
    expect(await cells.nth(3).innerHTML()).toBe(total);
    expect(await cells.nth(5).innerHTML()).toBe(status);
  }
});

test('trade bills: the reason a deduction was not taken shows at every status, once', async ({ page }) => {
  await bootOps(page);
  const below = 'Ute hire $200.00 was not taken: this invoice pays $150.00, which is less than the deduction.';
  const noWeek = 'Weekly deduction Ute hire NOT applied: this invoice has no invoice week.';
  const overlap = 'Weekly deduction NOT applied: two rules cover this week (Ute hire, Ute hire).';
  await page.evaluate(([below, noWeek, overlap]) => {
    window.renderTradeBillTable([
      // Paid in full and already in Xero: the stored query_note has moved on.
      { id: 'inv-below', users: { name: 'Below Trade' }, week_start: '2026-10-19', total_hours: 3, total_inc: 150, trade_payable: 150, status: 'pushed_to_xero', query_note: below, recurring_deduction_note: below },
      { id: 'inv-noweek', users: { name: 'No Week Trade' }, total_hours: 0, total_inc: 900, trade_payable: 900, status: 'paid', recurring_deduction_note: noWeek },
      // Pending review: the read folds the reason into query_note, shown as before.
      { id: 'inv-overlap', users: { name: 'Overlap Trade' }, week_start: '2026-10-19', total_hours: 8, total_inc: 440, trade_payable: 416, status: 'pending_ops_review', query_note: 'Manual hours need a check | ' + overlap, recurring_deduction_note: overlap },
      // A note that is not about a deduction stays where it always was.
      { id: 'inv-other', users: { name: 'Other Trade' }, week_start: '2026-10-19', total_hours: 8, total_inc: 440, status: 'pushed_to_xero', query_note: 'Old review note' }
    ]);
  }, [below, noWeek, overlap]);

  const rows = page.locator('#tradeBillTable tbody tr');
  const belowRow = rows.filter({ hasText: 'Below Trade' });
  await expect(belowRow.locator('[data-deduction-note]')).toHaveText(below);
  await expect(belowRow.locator('td').nth(3)).toHaveText('$150.00');
  await expect(rows.filter({ hasText: 'No Week Trade' }).locator('[data-deduction-note]')).toHaveText(noWeek);

  const overlapRow = rows.filter({ hasText: 'Overlap Trade' });
  await expect(overlapRow).toContainText('Manual hours need a check | ' + overlap);
  await expect(overlapRow.locator('[data-deduction-note]')).toHaveCount(0);

  const otherRow = rows.filter({ hasText: 'Other Trade' });
  await expect(otherRow.locator('[data-deduction-note]')).toHaveCount(0);
  await expect(otherRow).not.toContainText('Old review note');
});
