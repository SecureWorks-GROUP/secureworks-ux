const { test, expect } = require('@playwright/test');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const answer = {
  ok: true,
  as_of: '2026-11-20',
  weeks: ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'],
  behind_trades: [{
    user_id: '00000000-0000-4000-8000-000000000001',
    display_name: 'ZZTEST Trade',
    hourly_rate: 'RATELEAK',
    weeks: [
      { week_start: '2026-10-26', invoice_status: 'paid', held_lines_count: 0, unpriced_wo_lines_count: 0, amount: 512.4 },
      { week_start: '2026-11-02', invoice_status: 'missing', held_lines_count: 0, unpriced_wo_lines_count: 0 },
      { week_start: '2026-11-09', invoice_status: 'draft', held_lines_count: 0, unpriced_wo_lines_count: 0 },
      { week_start: '2026-11-16', invoice_status: 'held', held_lines_count: 3, unpriced_wo_lines_count: 1 }
    ],
    missing_weeks_count: 1,
    unsent_draft_count: 1
  }],
  stuck_groups: [{
    group_id: '00000000-0000-4000-8000-0000000000aa',
    job_number: 'ZZTEST-440',
    site_suburb: 'ZZTEST North',
    stuck_step: 'awaiting_others',
    days_stuck: 6,
    crew_missing: [{ user_id: '00000000-0000-4000-8000-0000000000cc', display_name: 'ZZTEST Crew', hours_entered: 0, hourly_rate: 'RATELEAK' }]
  }]
};

async function open(page, mode) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ZZTEST-pay-behind') return route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main style="max-width:1100px;margin:auto;padding:20px"><div id="host"></div></main><script src="/modules/ops-pay-behind.js"></script></body></html>' });
    if (url.pathname === '/modules/ops-pay-behind.js') return route.fulfill({ path: path.join(root, 'modules/ops-pay-behind.js'), contentType: 'text/javascript' });
    return route.abort();
  });
  await page.goto('/ZZTEST-pay-behind');
  await page.evaluate(async (cfg) => {
    window.ZZ = { reads: [], writes: [], mode: cfg.mode, answer: cfg.answer };
    window.opsFetch = async (action, params) => {
      ZZ.reads.push({ action, params });
      if (ZZ.mode === 403 || ZZ.mode === 404) throw Object.assign(new Error('no'), { status: ZZ.mode });
      if (ZZ.mode === 'off') return { enabled: false, behind_trades: ZZ.answer.behind_trades, stuck_groups: ZZ.answer.stuck_groups };
      return structuredClone(ZZ.answer);
    };
    window.opsPost = async (action, body) => {
      ZZ.writes.push({ action, body });
      if (ZZ.mode === 'disabled') {
        throw Object.assign(new Error('group_office_day_entry_disabled'), {
          status: 409,
          code: 'group_office_day_entry_disabled',
          body: { code: 'group_office_day_entry_disabled', error: 'The office cannot enter crew days yet: it is switched off.' }
        });
      }
      return { ok: true };
    };
    await PayBehind.mountPayBehindPanel(document.getElementById('host'));
  }, { mode, answer });
}

test('who is behind and the stuck group render, and a refusal draws nothing', async ({ page }) => {
  await open(page, 'live');
  await expect(page.getByRole('rowheader', { name: 'ZZTEST Trade' })).toBeVisible();
  await expect(page.getByText('Missing', { exact: true })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
  await expect(page.getByText('Held', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Stuck group work orders' }).click();
  await expect(page.getByRole('heading', { name: 'ZZTEST-440' })).toBeVisible();
  await expect(page.getByText('ZZTEST North')).toBeVisible();
  await expect(page.getByText('Waiting on the crew')).toBeVisible();
  await expect(page.getByText('6 days')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter days' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('RATELEAK');
  await expect(page.locator('body')).not.toContainText('512.4');
  expect(await page.evaluate(() => ZZ.reads)).toEqual([{ action: 'pay_run_who_is_behind', params: { weeks: 4 } }]);

  for (const mode of [403, 404, 'off']) {
    await page.evaluate(async (next) => { ZZ.mode = next; await PayBehind.mountPayBehindPanel(document.getElementById('host')); }, mode);
    await expect(page.locator('[data-pay-behind]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('ZZTEST Trade');
  }
});

test('enter days requires a 3 to 500 character reason and says when office day entry is switched off', async ({ page }) => {
  await open(page, 'live');
  await page.getByRole('tab', { name: 'Stuck group work orders' }).click();
  await page.getByRole('button', { name: 'Enter days' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enter days for ZZTEST Crew' });
  await dialog.getByLabel('Why were these days entered?').fill('ab');
  await dialog.getByRole('button', { name: 'Save the days' }).click();
  await expect(dialog.getByRole('alert')).toContainText('3 to 500 characters');
  expect(await page.evaluate(() => ZZ.writes)).toEqual([]);

  await dialog.getByLabel('Why were these days entered?').evaluate((el) => { el.value = 'x'.repeat(501); });
  await dialog.getByRole('button', { name: 'Save the days' }).click();
  await expect(dialog.getByRole('alert')).toContainText('3 to 500 characters');
  expect(await page.evaluate(() => ZZ.writes)).toEqual([]);

  await dialog.getByLabel('Work date').fill('2026-11-18');
  await dialog.getByLabel('Started').fill('07:00');
  await dialog.getByLabel('Finished').fill('15:00');
  await dialog.getByLabel('Break (minutes)').fill('30');
  await expect(dialog.locator('[data-pb-hours]')).toHaveText('7.5 h');
  await dialog.getByLabel('Why were these days entered?').fill('ZZTEST they worked this day and did not enter it');
  await page.evaluate(() => { ZZ.mode = 'disabled'; });
  await dialog.getByRole('button', { name: 'Save the days' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Office day entry is currently switched off');
  expect(await page.evaluate(() => ZZ.writes)).toEqual([{
    action: 'office_enter_group_hours',
    body: {
      group_id: '00000000-0000-4000-8000-0000000000aa',
      target_user_id: '00000000-0000-4000-8000-0000000000cc',
      reason: 'ZZTEST they worked this day and did not enter it',
      entries: [{ work_date: '2026-11-18', start_time: '07:00', finish_time: '15:00', break_minutes: 30 }]
    }
  }]);
});
