// Office-entered days on the caller's own group share. Hidden unless the
// server says office_entered is true. ZZTEST wording only.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

const REASON = 'ZZTEST office entered the missing day';
const DISPUTE = 'ZZTEST these hours are not the days I worked';

async function openGroup(page, shape) {
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate((next) => {
    const { db, ops } = window.__crewDemo;
    const group = db.groups.find((x) => x.group_id === 'g-dunc');
    if (group) { group.client_name = 'Customer'; group.site_suburb = 'ZZTEST'; group.job_number = 'ZZTEST-100'; }
    const job = (db.jobs || []).find((x) => x.id === 'j-dunc');
    if (job) { job.client_name = 'Customer'; job.site_suburb = 'ZZTEST'; job.site_address = ''; job.job_number = 'ZZTEST-100'; }
    db.me.name = 'Trade';
    (db.others || []).forEach((p) => { p.name = 'Crew'; });
    const real = ops.group_work_order_my_share;
    window.__disputes = [];
    window.__shape = next;
    ops.group_work_order_my_share = (p, b) => {
      const row = real(p, b);
      if (!row || row.participant === false || !window.__shape) return row;
      const marks = window.__disputed
        ? { office_entered: true, office_entry_reason: 'ZZTEST office entered the missing day', office_entered_at: '2026-11-12T04:00:00+08:00', disputed: true, dispute_reason: window.__disputed }
        : window.__shape;
      if (marks.meOnly) {
        return { ...row, hourly_rate: 'RATELEAK', crew_hours: [{ name: 'Trade', me: true, hours: 0, office_entered: true, office_entry_reason: 'ZZTEST office entered the missing day', office_entered_at: '2026-11-12T04:00:00+08:00', hourly_rate: 'RATELEAK' }] };
      }
      return { ...row, ...marks };
    };
    ops.dispute_office_group_hours = (p, b) => {
      window.__disputes.push(JSON.parse(JSON.stringify(b)));
      window.__disputed = b.reason;
      return { ok: true };
    };
    return import('/crew/js/lib/store.js').then((store) => { store.invalidate('groups'); store.invalidate('group:'); });
  }, shape);
  await page.evaluate(() => { location.hash = '#/pay/group/j-dunc'; });
}

test('the office-entered card stays hidden when the marks are absent or false', async ({ page }) => {
  const errors = watchErrors(page);
  await openGroup(page, null);
  await expect(page.getByText('Add your hours')).toBeVisible();
  await expect(page.locator('[data-office-entry]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dispute these hours' })).toHaveCount(0);

  await openGroup(page, { office_entered: false, hourly_rate: 'RATELEAK' });
  await expect(page.getByText('Add your hours')).toBeVisible();
  await expect(page.locator('[data-office-entry]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an office-entered share shows the reason, sends the dispute, then shows the disputed state', async ({ page }) => {
  const errors = watchErrors(page);
  await openGroup(page, {
    office_entered: true,
    office_entry_reason: REASON,
    office_entered_at: '2026-11-12T04:00:00+08:00',
    disputed: false,
    hourly_rate: 'RATELEAK'
  });
  const card = page.locator('[data-office-entry]');
  await expect(card).toContainText('The office entered these days');
  await expect(card).toContainText(REASON);
  await expect(card).toContainText(/Entered /);
  await expect(page.locator('body')).not.toContainText('RATELEAK');

  await page.getByRole('button', { name: 'Dispute these hours' }).click();
  const sheet = page.getByRole('dialog', { name: 'Dispute these hours' });
  await expect(sheet.getByRole('button', { name: 'Send dispute' })).toBeDisabled();
  await sheet.getByLabel('Why are these hours wrong?').fill('ab');
  await expect(sheet.getByRole('button', { name: 'Send dispute' })).toBeDisabled();
  await sheet.getByLabel('Why are these hours wrong?').fill(DISPUTE);
  await sheet.getByRole('button', { name: 'Send dispute' }).click();
  await expect(page.getByRole('status')).toContainText('Dispute sent');
  await expect(page.locator('[data-office-disputed]')).toContainText('Disputed, waiting on office');
  await expect(page.locator('[data-office-entry]')).toContainText(DISPUTE);
  await expect(page.getByRole('button', { name: 'Dispute these hours' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__disputes)).toEqual([{ group_id: 'g-dunc', reason: DISPUTE }]);
  expect(errors).toEqual([]);
});

test('marks that arrive only on the caller row still show, and a frozen share has no dispute button', async ({ page }) => {
  const errors = watchErrors(page);
  await openGroup(page, { meOnly: true });
  await expect(page.locator('[data-office-entry]')).toContainText(REASON);
  await expect(page.getByRole('button', { name: 'Dispute these hours' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('RATELEAK');

  await page.evaluate(async () => {
    window.__shape = { office_entered: true, office_entry_reason: 'ZZTEST office entered the missing day', office_entered_at: '2026-11-12T04:00:00+08:00', awaiting: 'frozen', client_signed: true };
    window.__disputed = null;
    const store = await import('/crew/js/lib/store.js');
    store.invalidate('group:j-dunc');
  });
  await expect(page.locator('[data-office-entry]')).toContainText('The office entered these days');
  await expect(page.getByRole('button', { name: 'Dispute these hours' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
