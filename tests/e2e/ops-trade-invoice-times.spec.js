// Ops sees WHEN a trade says the hours were worked (Captain, 2026-10-12):
// the date, start and finish sit beside the hours on a trade invoice and on a
// job's labour when the line carries them, and an older line with no times
// shows exactly what it always did. Search `// <trade-time-entry-ops>` in
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

test('job P&L trade lines: the times sit beside the hours when the line carries them', async ({ page }) => {
  await bootOps(page);
  await page.evaluate(([timed, older]) => {
    const host = document.createElement('div');
    host.id = 'e2ePnlHost';
    host.innerHTML = window.renderJobPnlDetail({ job_id: 'job-1', job_number: 'SWF-26001', lines: [timed, older] });
    document.body.appendChild(host);
  }, [TIMED, OLDER]);

  const rows = page.locator('#e2ePnlHost .pnl-lines-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('td').first()).toHaveText('Wed 7 Oct');
  await expect(rows.nth(0).locator('[data-line-when]')).toHaveText('07:00 to 15:30, 30 min break');
  await expect(rows.nth(1).locator('[data-line-when]')).toHaveCount(0);
  await expect(rows.nth(1).locator('td').nth(3)).toHaveText('6.0');
});

test('job labour: the days and times sit under the trade when the labour read carries them', async ({ page }) => {
  await bootOps(page, {
    labour_reconciliation: {
      reconciliation: {
        labour_budget: 1000, hours_logged: 18, labour_cost: 990,
        trades: [
          { name: 'New Trade', hours: 12, rate: 55, cost: 660, lines: [SECOND_DAY, TIMED] },
          { name: 'Older Trade', hours: 6, rate: 55, cost: 330 }
        ]
      }
    }
  });
  await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'jdLabourRecon';
    document.body.appendChild(host);
    await window.loadLabourReconciliation('job-1');
  });

  const panel = page.locator('#jdLabourRecon');
  await expect(panel).toContainText('Labour Reconciliation');
  await expect(panel.locator('[data-labour-when]')).toHaveCount(1);
  await expect(panel.locator('[data-labour-when] div')).toHaveText([
    'Wed 7 Oct, 07:00 to 15:30, 30 min break · 8h',
    'Thu 8 Oct, 08:00 to 12:00 · 4h'
  ]);
});
