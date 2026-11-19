// SecureWorks Crew: plain Home and Pay prompts for open group work orders
// waiting on the signed-in trade (Join -> Add your days -> Lock in the shares -> Invoice my share),
// behind the existing group_work_order_v1 server switch (my_group_work_orders.enabled).
// Made-up ZZTEST jobs, roles and amounts only; no real staff names or pay figures.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

async function installGroupFixture(page, { enabled = true, groups = [], bookings = [] } = {}) {
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(async (cfg) => {
    const { db, ops } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    const dates = await import('/crew/js/lib/dates.js');
    const today = dates.todayISO();

    db.me.name = 'Trade';
    db.others.forEach((p) => { p.name = 'Crew'; });
    store.setState({ user: { ...store.getState().user, name: 'Trade', label: 'Trade' } });

    const jobMap = new Map();
    const mkJob = (g) => ({
      id: g.job_id,
      type: 'patio',
      status: 'in_progress',
      job_number: g.job_number,
      client_name: g.client_name || 'Customer',
      site_address: '',
      site_suburb: g.site_suburb,
      notes: ''
    });
    for (const g of cfg.groups) jobMap.set(g.job_id, mkJob(g));
    for (const b of cfg.bookings) {
      if (!jobMap.has(b.job_id)) {
        jobMap.set(b.job_id, { id: b.job_id, type: 'patio', status: 'scheduled', job_number: b.job_number || 'ZZTEST-000', client_name: 'Customer', site_address: '', site_suburb: b.site_suburb || 'ZZTEST', notes: '' });
      }
    }
    const toDate = (offset) => (offset == null ? null : dates.addDays(today, offset));
    const asgRows = cfg.bookings.map((b, i) => ({
      id: 'zz-asg-' + i,
      job_id: b.job_id,
      user_id: db.me.id,
      scheduled_date: toDate(b.dayOffset),
      scheduled_end: null,
      start_time: '07:00',
      status: b.status || 'confirmed',
      role: 'installer',
      clocked_on_at: b.clockOn ? `${today}T07:00:00+08:00` : null,
      clocked_off_at: b.clockOff ? `${today}T15:00:00+08:00` : null,
      hours_worked: b.hours || null,
      jobs: jobMap.get(b.job_id)
    }));

    const liveGroups = cfg.groups.map((g) => ({ ...g }));
    window.__zzGroups = liveGroups;

    ops.my_jobs = () => ({
      today: asgRows.filter((a) => a.scheduled_date === today),
      thisWeek: asgRows.filter((a) => a.scheduled_date && a.scheduled_date > today),
      upcoming: [],
      recent: asgRows.filter((a) => a.scheduled_date && a.scheduled_date < today),
      recentCompleted: [],
      unscheduled: asgRows.filter((a) => !a.scheduled_date)
    });
    ops.my_group_work_orders = () => {
      if (!cfg.enabled) return { enabled: false, group_job_ids: [], groups: [], payable_routes: [] };
      return {
        enabled: true,
        group_job_ids: liveGroups.map((g) => g.job_id),
        groups: liveGroups.map((g) => ({ ...g })),
        payable_routes: liveGroups.map((g) => ({ job_id: g.job_id, route: 'group', group_id: g.group_id, discovery: g.discovery || { state: g.awaiting === 'needs_join' ? 'join' : 'member' } }))
      };
    };
    ops.trade_job_detail = (p) => {
      const j = jobMap.get(p.jobId) || { id: p.jobId, type: 'patio', status: 'in_progress', job_number: 'ZZTEST-000', client_name: 'Customer', site_address: '', site_suburb: 'ZZTEST' };
      return { job: j, crew: [], notes: [], media: [], documents: [], purchase_orders: [] };
    };
    ops.group_work_order_my_share = (p, b) => {
      if (!cfg.enabled) return { enabled: false };
      const g = liveGroups.find((x) => (b.group_id && x.group_id === b.group_id) || (b.job_id && x.job_id === b.job_id));
      if (!g) return { enabled: true, job_id: b.job_id, group_id: null, participant: false, discovery: { state: 'setup_required' } };
      if (g.awaiting === 'needs_join') {
        return { enabled: true, job_id: g.job_id, group_id: g.group_id, participant: false, discovery: { state: 'join', message: 'The group work order for this job is open. Join it to add your hours.' } };
      }
      return { enabled: true, participant: true, discovery: { state: 'member' }, ...g };
    };
    ops.join_group_work_order = (p, b) => {
      const g = liveGroups.find((x) => x.group_id === b.group_id || x.job_id === b.job_id);
      g.awaiting = 'needs_hours';
      g.needs_hours = true;
      g.discovery = { state: 'member' };
      g.crew_hours = [{ name: 'Crew', me: false, hours: 8, approved: true }, { name: 'Trade', me: true, hours: 0, approved: false }];
      return { ok: true, group_id: g.group_id, job_id: g.job_id, status: 'open', client_signed: true };
    };
    ops.submit_group_work_order_hours = (p, b) => {
      const g = liveGroups.find((x) => x.group_id === b.group_id || x.job_id === b.job_id);
      g.awaiting = 'ready';
      g.needs_hours = false;
      g.client_signed = true;
      g.pot_total = 2000;
      g.projected_my_share = 1000;
      g.crew_hours = [{ name: 'Crew', me: false, hours: 8, approved: true }, { name: 'Trade', me: true, hours: 8, approved: true }];
      g.my_entries = [{ work_date: b.work_date, start_time: b.start_time, finish_time: b.finish_time, break_minutes: b.break_minutes || 0, hours: 8 }];
      return { enabled: true, participant: true, discovery: { state: 'member' }, ...g };
    };
    ops.freeze_group_work_order = (p, b) => {
      const g = liveGroups.find((x) => x.group_id === b.group_id || x.job_id === b.job_id);
      g.awaiting = 'frozen';
      g.my_budget = 1000;
      g.my_share = 892.86;
      g.my_cash_pay = 892.86;
      g.my_super = 107.14;
      g.budget_includes_super = true;
      return { enabled: true, participant: true, discovery: { state: 'member' }, ...g };
    };
    ops.generate_trade_invoice = (p, b) => {
      const item = (b.extra_items || [])[0] || {};
      const g = liveGroups.find((x) => x.group_id === item.group_id);
      if (g) g.submitted = { invoice_id: 'zz-inv-group', invoice_number: 'ZZTEST-INV-01', status: 'pending_acknowledgment', review: null };
      return { success: true, invoice_id: 'zz-inv-group', invoice_number: 'ZZTEST-INV-01', group_release: { released: false } };
    };

    store.invalidate('myjobs');
    store.invalidate('groups');
    store.invalidate('group:');
  }, { enabled, groups, bookings });
}

test('ZZTEST Home and Pay show open group prompts in step order and keep future-only and non-actionable groups quiet', async ({ page }) => {
  const errors = watchErrors(page);
  await installGroupFixture(page, {
    enabled: true,
    groups: [
      { group_id: 'zz-g-frozen', job_id: 'zz-j-east', job_number: 'ZZTEST-104', site_suburb: 'ZZTEST East', awaiting: 'frozen', needs_hours: false, client_signed: true, pay_basis: 'all_in_12_v2', my_share: 900 },
      { group_id: 'zz-g-ready', job_id: 'zz-j-south', job_number: 'ZZTEST-103', site_suburb: 'ZZTEST South', awaiting: 'ready', needs_hours: false, client_signed: true, pay_basis: 'all_in_12_v2' },
      { group_id: 'zz-g-days', job_id: 'zz-j-west', job_number: 'ZZTEST-102', site_suburb: 'ZZTEST West', awaiting: 'needs_hours', needs_hours: true, client_signed: false, pay_basis: 'all_in_12_v2' },
      { group_id: 'zz-g-old', job_id: 'zz-j-old', job_number: 'ZZTEST-105', site_suburb: 'ZZTEST Old', awaiting: 'needs_hours', needs_hours: true, client_signed: false, pay_basis: 'all_in_12_v2' },
      { group_id: 'zz-g-join', job_id: 'zz-j-north', job_number: 'ZZTEST-101', site_suburb: 'ZZTEST North', awaiting: 'needs_join', needs_hours: true, client_signed: null, discovery: { state: 'join' } },
      { group_id: 'zz-g-future-hrs', job_id: 'zz-j-fut1', job_number: 'ZZTEST-106', site_suburb: 'ZZTEST Future Hours', awaiting: 'needs_hours', needs_hours: true, client_signed: false },
      { group_id: 'zz-g-future-join', job_id: 'zz-j-fut2', job_number: 'ZZTEST-107', site_suburb: 'ZZTEST Future Join', awaiting: 'needs_join', needs_hours: true, client_signed: null, discovery: { state: 'join' } },
      { group_id: 'zz-g-others', job_id: 'zz-j-others', job_number: 'ZZTEST-108', site_suburb: 'ZZTEST Waiting', awaiting: 'awaiting_others', needs_hours: false, client_signed: false },
      { group_id: 'zz-g-done', job_id: 'zz-j-done', job_number: 'ZZTEST-109', site_suburb: 'ZZTEST Invoiced', awaiting: 'frozen', needs_hours: false, client_signed: true, submitted: { invoice_id: 'zz-inv-done', invoice_number: 'ZZTEST-INV-09', status: 'pending_acknowledgment' } }
    ],
    bookings: [
      { job_id: 'zz-j-north', dayOffset: -1, status: 'completed' },
      { job_id: 'zz-j-west', dayOffset: -2, status: 'confirmed' },
      // zz-j-old deliberately has no my_jobs booking (>30 days ago) so it must still prompt.
      { job_id: 'zz-j-fut1', dayOffset: 3, status: 'confirmed' },
      { job_id: 'zz-j-fut2', dayOffset: 4, status: 'scheduled' },
      { job_id: 'zz-j-others', dayOffset: -1, status: 'completed' }
    ]
  });

  const expectedTitles = [
    'Join the group on ZZTEST North',
    'Add your days on ZZTEST Old',
    'Add your days on ZZTEST West',
    'Lock in the shares',
    'Invoice my share'
  ];

  for (const hash of ['#/today', '#/pay']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    const box = page.locator('[data-group-prompts]');
    await expect(box).toBeVisible();
    const titles = box.locator('button.item .main > b');
    await expect(titles).toHaveText(expectedTitles);
    await expect(box).toContainText('ZZTEST South');
    await expect(box).toContainText('ZZTEST East');
    await expect(box).not.toContainText('ZZTEST Future Hours');
    await expect(box).not.toContainText('ZZTEST Future Join');
    await expect(box).not.toContainText('ZZTEST Waiting');
    await expect(box).not.toContainText('ZZTEST Invoiced');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(wide).toBe(false);
  }

  // On Pay, the Records -> Group work orders row stays reachable in one click and reuses groupWords.
  const recordRow = page.locator('.kvrow', { hasText: 'Group work orders' });
  await expect(recordRow).toContainText('5 to do');
  await recordRow.click();
  const sheet = page.getByRole('dialog', { name: 'Group work orders' });
  await expect(sheet).toContainText('Join the group');
  await expect(sheet).toContainText('Add your days');
  await expect(sheet).toContainText('Lock in the shares');
  await expect(sheet).toContainText('Invoice my share');
  expect(errors).toEqual([]);
});

test('ZZTEST each prompt takes the trade to its group step through join, days, lock and invoice', async ({ page }) => {
  const errors = watchErrors(page);
  await installGroupFixture(page, {
    enabled: true,
    groups: [
      { group_id: 'zz-g-flow', job_id: 'zz-j-flow', job_number: 'ZZTEST-201', site_suburb: 'ZZTEST Patio', awaiting: 'needs_join', needs_hours: true, client_signed: true, pay_basis: 'all_in_12_v2', discovery: { state: 'join' } }
    ],
    bookings: [{ job_id: 'zz-j-flow', dayOffset: -1, status: 'completed' }]
  });

  // 1. Join the group from Home
  await page.evaluate(() => { location.hash = '#/today'; });
  await page.locator('[data-group-prompts] button.item', { hasText: 'Join the group on ZZTEST Patio' }).click();
  await expect(page).toHaveURL(/#\/pay\/group\/zz-j-flow$/);
  await page.getByRole('button', { name: 'Join the group work order' }).click();
  await expect(page.getByRole('button', { name: 'Add a day you worked' })).toBeVisible();

  // 2. Back on Home: now prompts Add your days
  await page.evaluate(() => { location.hash = '#/today'; });
  await page.locator('[data-group-prompts] button.item', { hasText: 'Add your days on ZZTEST Patio' }).click();
  await expect(page).toHaveURL(/#\/pay\/group\/zz-j-flow$/);
  await page.getByRole('button', { name: 'Add a day you worked' }).click();
  const day = page.getByRole('dialog', { name: 'Add a day you worked' });
  await day.locator('.daypick:not([disabled])').first().click();
  await day.locator('input[type="time"]').first().fill('07:00');
  await day.locator('input[type="time"]').nth(1).fill('15:30');
  await day.getByRole('button', { name: '30 min', exact: true }).click();
  await day.getByRole('button', { name: /^Save / }).click();
  await expect(page.getByRole('button', { name: 'Lock in the shares' })).toBeVisible();

  // 3. On Pay: now prompts Lock in the shares
  await page.evaluate(() => { location.hash = '#/pay'; });
  await page.locator('[data-group-prompts] button.item', { hasText: 'Lock in the shares' }).click();
  await expect(page).toHaveURL(/#\/pay\/group\/zz-j-flow$/);
  await page.getByRole('button', { name: 'Lock in the shares' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lock in the shares' }).click();
  await expect(page.getByRole('button', { name: 'Invoice my share' })).toBeVisible();

  // 4. On Home: now prompts Invoice my share -> send -> prompt clears on Home and Pay
  await page.evaluate(() => { location.hash = '#/today'; });
  await page.locator('[data-group-prompts] button.item', { hasText: 'Invoice my share' }).click();
  await expect(page).toHaveURL(/#\/pay\/group\/zz-j-flow$/);
  await page.getByRole('button', { name: 'Invoice my share' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Invoice my share' }).click();
  await expect(page.getByRole('heading', { name: 'Share invoiced' })).toBeVisible();

  await page.evaluate(() => { location.hash = '#/today'; });
  await expect(page.locator('[data-group-prompts]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/pay'; });
  await expect(page.locator('[data-group-prompts]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('ZZTEST switch off (group_work_order_v1 disabled) shows zero prompts on Home and Pay', async ({ page }) => {
  const errors = watchErrors(page);
  await installGroupFixture(page, {
    enabled: false,
    groups: [
      { group_id: 'zz-g-off', job_id: 'zz-j-off', job_number: 'ZZTEST-301', site_suburb: 'ZZTEST Off', awaiting: 'needs_hours', needs_hours: true }
    ],
    bookings: [{ job_id: 'zz-j-off', dayOffset: -1, status: 'completed' }]
  });

  await page.evaluate(() => { location.hash = '#/today'; });
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('[data-group-prompts]')).toHaveCount(0);
  await expect(page.locator('main.page')).not.toContainText('ZZTEST Off');

  await page.evaluate(() => { location.hash = '#/pay'; });
  await expect(page.getByRole('heading', { name: 'Pay', exact: true })).toBeVisible();
  await expect(page.locator('[data-group-prompts]')).toHaveCount(0);
  await expect(page.locator('.kvrow', { hasText: 'Group work orders' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
