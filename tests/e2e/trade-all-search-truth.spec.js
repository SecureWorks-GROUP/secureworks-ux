const { test, expect } = require('@playwright/test');
const { installSupabaseAuthStub, signIn } = require('../helpers/auth');
const { installFeedStubs, installExternalRequestGuard, perthDate, addIsoDays } = require('../helpers/feed-stub');

// Trade App audit 2026-09-23, findings 3 and 4 (captain example a): Ryan, Jobs >
// Everyone > All, search "Michael Johnson" showed two "Allocated" patio cards,
// neither tappable — his own job tomorrow (Embleton SWP-26183), which his
// make-safe-only Everyone view did not carry, and an archived lost quote with
// no number or suburb ("Suburb TBC"). Rows below are shaped from the real
// read-only rows; no network, no real login. Guards <all-tab-search-card-truth>,
// <lead-own-rows-merge> and <trade-job-list-money-strip> in trade.html.

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const APP_ORIGIN = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:4173').origin;
const ORG = '00000000-0000-0000-0000-000000000001';

const PERSONAS = {
  ryan: { email: 'ryan@example.test', password: 'x', profile: { id: 'e2e-ryan', email: 'ryan@example.test', name: 'Ryan', role: 'crew', trade_tier: 2, managed_verticals: ['makesafe'], invoice_type: 'hourly', org_id: ORG } },
  henry: { email: 'henry@example.test', password: 'x', profile: { id: 'e2e-henry', email: 'henry@example.test', name: 'Henry', role: 'lead_installer', trade_tier: 2, managed_verticals: ['fencing'], invoice_type: 'hourly', org_id: ORG } },
  crew: { email: 'crew@example.test', password: 'x', profile: { id: 'e2e-crew', email: 'crew@example.test', name: 'Crew Member', role: 'crew', trade_tier: 1, managed_verticals: [], invoice_type: 'hourly', org_id: ORG } }
};

const EMPTY = { today: [], thisWeek: [], upcoming: [], recent: [], recentCompleted: [], unscheduled: [] };

const EMBLETON_JOB = {
  id: 'dd8d4096-4e6d-4336-8cfa-9547c884b9b6', job_number: 'SWP-26183', client_name: 'Michael Johnson',
  client_phone: null, client_email: null, site_address: '(street), Embleton WA 6062, Australia', site_suburb: 'Embleton',
  type: 'patio', status: 'in_progress', created_at: '2026-05-07T08:37:26Z', updated_at: '2026-09-23T00:00:00Z', completed_at: null, external_ref: null
};
// Archived lost quote: no number, no address, no crew ever.
const LOST_QUOTE = {
  id: '4eade65f-4a55-41a6-b40e-8e7d35e27932', job_number: null, client_name: 'Michael Johnson',
  client_phone: null, client_email: null, site_address: null, site_suburb: null,
  type: 'patio', status: 'quoted', created_at: '2025-11-13T06:52:16Z', updated_at: '2025-11-13T06:52:16Z', completed_at: null, external_ref: null
};

function row(id, job, extra = {}) {
  return {
    id, scheduled_date: addIsoDays(perthDate(), 1), scheduled_end: null, start_time: '07:00', status: 'scheduled',
    role: 'installer', notes: null, assignment_type: null, crew_name: null, started_at: null, completed_at: null,
    clocked_on_at: null, clocked_off_at: null, travel_started_at: null, arrived_at: null, break_minutes: 0, job_phase: 'assigned',
    jobs: { notes: null, metadata: {}, archived: false, ...job },
    ...extra
  };
}

// Ryan's own patio row on SWP-26183 — only the personal (mine) read carries it.
const RYAN_OWN_PATIO = row('asg-ryan-embleton', EMBLETON_JOB);
// Another crew's make-safe: what his make-safe-scoped Everyone read returns.
const OTHER_MAKESAFE = row('asg-other-ms', {
  id: 'ms-job-1', job_number: 'SWMS-260001', client_name: 'Other Client', type: 'makesafe', status: 'scheduled',
  site_suburb: 'Morley', site_address: 'Morley WA'
}, { user: { id: 'u-other', name: 'Anthony' }, crew_name: 'Anthony' });

async function boot(page, persona, actions) {
  await installExternalRequestGuard(page, { allowedOrigins: [APP_ORIGIN] });
  await installSupabaseAuthStub(page, {
    users: Object.fromEntries(Object.values(PERSONAS).map((entry) => [entry.email, entry])),
    profileEndpoint: `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy`
  });
  const log = [];
  const stub = await installFeedStubs(page, { endpoint: `${SUPABASE_ORIGIN}/functions/v1/ops-api`, actions, requestLog: log });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/trade.html');
  await signIn(page, PERSONAS[persona]);
  return { log, stub };
}

function embletonDetail() {
  return {
    job: EMBLETON_JOB,
    crew: [{ id: 'asg-ryan-embleton', user_id: PERSONAS.ryan.profile.id, name: 'Ryan', status: 'scheduled' }],
    purchaseOrders: [], documents: [], media: [], notes: []
  };
}

function ryanActions(searchJobs) {
  return {
    my_jobs: ({ url }) => (url.searchParams.get('mode') === 'all'
      ? { ...EMPTY, thisWeek: [OTHER_MAKESAFE], _adminView: true }
      : { ...EMPTY, thisWeek: [RYAN_OWN_PATIO] }),
    search_all_jobs: ({ url }) => {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      if (!q) return { lens: 'company', jobs: [], total: 0, next_offset: null };
      const jobs = searchJobs.filter((job) => String(job.client_name || '').toLowerCase().includes(q));
      return { lens: 'search', jobs, total: jobs.length, next_offset: null, truncated: false };
    },
    trade_job_detail: ({ url }) => (url.searchParams.get('jobId') === EMBLETON_JOB.id
      ? embletonDetail()
      : { status: 404, body: { error: 'Unknown job' } })
  };
}

async function openJobsTab(page, filter) {
  await page.locator('[data-view="myJobs"]').click();
  await expect(page.locator('#jobSearchBar')).toBeVisible();
  await page.locator(`.filter-chip[data-filter="${filter}"]`).click();
}

test.describe('All-tab search tells the truth (audit finding 3)', () => {
  test('Ryan: own job listed once and tappable, the lost quote reads Quote under the client name', async ({ page }) => {
    const { stub } = await boot(page, 'ryan', ryanActions([EMBLETON_JOB, LOST_QUOTE]));
    await openJobsTab(page, 'all');
    await expect(page.locator('#adminToggleAll')).toHaveText('Everyone · make-safe');
    await page.locator('#jobSearchInput').fill('Michael Johnson');

    const list = page.locator('#myJobsList');
    await expect(list).toContainText('All database · all jobs');
    await expect(list).not.toContainText('allocated to other trades');
    await expect(list).toContainText('2 matches — showing all 2');
    await expect(list).toContainText('1 of these is on your list below.');

    // A5: Embleton is Ryan's own card below, not a second search card.
    await expect(list.locator('.jcsr')).toHaveCount(1);
    await expect(list.locator('.jcsr').filter({ hasText: 'SWP-26183' })).toHaveCount(0);
    const own = list.locator('.jc').filter({ hasText: 'SWP-26183' });
    await expect(own).toHaveCount(1);

    // A3: no suburb and no number -> the client is the title; the badge is its
    // pipeline word, never "Allocated"; A4: it cannot open and says so.
    const quote = list.locator('.jcsr').first();
    await expect(quote.locator('.s')).toHaveText('Michael Johnson');
    await expect(quote).not.toContainText('Suburb TBC');
    await expect(quote.locator('.jc-status')).toHaveText('Quote');
    await expect(quote).toContainText('View only · not on your jobs');
    await expect(quote).not.toHaveAttribute('onclick', /.*/);

    // A4: Ryan's own job opens as his allocation, not the search-refusal empty.
    await own.locator('.jc-place').click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('SWP-26183');
    await expect(page.locator('#jobDetailContent')).toContainText('Embleton');
    await expect(page.locator('#jobDetailContent')).not.toContainText('This job is not on your jobs');
    expect(stub.unexpectedWrites).toEqual([]);
  });

  test('badges: allocated only when known, otherwise the pipeline word or Archived', async ({ page }) => {
    const other = (id, status, extra = {}) => ({ ...LOST_QUOTE, id, status, job_number: `SWP-${id}`, site_suburb: 'Joondalup', ...extra });
    const jobs = [
      other('90001', 'draft'),
      other('90002', 'lead'),
      other('90003', 'accepted'),
      other('90004', 'complete'),
      other('90005', 'cancelled'),
      other('90006', 'quoted', { archived: true }),
      other('90007', 'in_progress', { assigned_to_me: true }),
      { id: 'ms-90011', job_number: 'SWMS-90011', client_name: 'Michael Johnson', type: 'makesafe', status: 'scheduled', site_suburb: 'Morley', archived: false },
      { id: 'ms-90012', job_number: 'SWMS-90012', client_name: 'Michael Johnson', type: 'makesafe', status: 'accepted', site_suburb: 'Morley', archived: false },
      { id: 'ms-90013', job_number: 'SWMS-90013', client_name: 'Michael Johnson', type: 'makesafe', status: 'scheduled', site_suburb: 'Morley', archived: false, allocated: true }
    ];
    await boot(page, 'crew', {
      my_jobs: EMPTY,
      search_all_jobs: ({ url }) => (url.searchParams.get('q') ? { lens: 'search', jobs, total: jobs.length, next_offset: null } : { lens: 'assigned', jobs: [], total: 0 })
    });
    await openJobsTab(page, 'all');
    await page.locator('#jobSearchInput').fill('Michael');
    const card = (num) => page.locator('#myJobsList .jcsr').filter({ hasText: `SWP-${num}` });
    const ms = (num) => page.locator('#myJobsList .jcsr').filter({ hasText: `SWMS-${num}` });
    await expect(card('90001').locator('.jc-status')).toHaveText('Draft');
    await expect(card('90002').locator('.jc-status')).toHaveText('Lead');
    await expect(card('90003').locator('.jc-status')).toHaveText('Not scheduled');
    await expect(card('90004').locator('.jc-status')).toHaveText('Complete');
    await expect(card('90005').locator('.jc-status')).toHaveText('Cancelled');
    await expect(card('90006').locator('.jc-status')).toHaveText('Archived');
    await expect(card('90007').locator('.jc-status')).toHaveText('Allocated');
    await expect(ms('90011').locator('.jc-status')).toHaveText('Scheduled');
    await expect(ms('90012').locator('.jc-status')).toHaveText('Not scheduled');
    await expect(ms('90013').locator('.jc-status')).toHaveText('Allocated');
    await expect(page.locator('#myJobsList .jcsr .jc-status', { hasText: 'New' })).toHaveCount(0);
    await expect(page.locator('#myJobsList .jcsr .jc-status', { hasText: 'Allocated' })).toHaveCount(2);
    // Pre-sale and dead records are reference only; delivery-stage jobs open.
    for (const num of ['90001', '90002', '90003', '90005', '90006']) {
      await expect(card(num)).toHaveAttribute('data-view-only', '1');
    }
    for (const num of ['90004', '90007']) {
      await expect(card(num)).toHaveAttribute('onclick', /openJob\(/);
    }
  });

  test('a fencing lead cannot open a quote in their vertical', async ({ page }) => {
    const fenceQuote = {
      id: 'fence-quote-1', job_number: 'SWF-88001', client_name: 'Michael Johnson',
      type: 'fencing', status: 'quoted', site_suburb: 'Balcatta', archived: false
    };
    const fenceLive = {
      id: 'fence-live-1', job_number: 'SWF-88002', client_name: 'Michael Johnson',
      type: 'fencing', status: 'scheduled', site_suburb: 'Balcatta', archived: false
    };
    await boot(page, 'henry', {
      my_jobs: ({ url }) => (url.searchParams.get('mode') === 'all' ? { ...EMPTY, _adminView: true } : EMPTY),
      search_all_jobs: ({ url }) => (url.searchParams.get('q')
        ? { lens: 'search', jobs: [fenceQuote, fenceLive], total: 2, next_offset: null }
        : { lens: 'company', jobs: [], total: 0 })
    });
    await openJobsTab(page, 'all');
    await expect(page.locator('#adminToggleAll')).toHaveText('Everyone · fencing');
    await page.locator('#jobSearchInput').fill('Michael');
    const quote = page.locator('#myJobsList .jcsr').filter({ hasText: 'SWF-88001' });
    const live = page.locator('#myJobsList .jcsr').filter({ hasText: 'SWF-88002' });
    await expect(quote.locator('.jc-status')).toHaveText('Quote');
    await expect(quote).toHaveAttribute('data-view-only', '1');
    await expect(quote).not.toHaveAttribute('onclick', /.*/);
    await expect(live).toHaveAttribute('onclick', /openJob\(/);
  });

  test('a numbered job outside the personal feed opens and the server decides access', async ({ page }) => {
    const oldJob = { ...EMBLETON_JOB, id: 'job-old-own', job_number: 'SWP-24001', status: 'complete', completed_at: '2025-01-10T00:00:00Z' };
    await boot(page, 'crew', {
      my_jobs: EMPTY,
      search_all_jobs: ({ url }) => (url.searchParams.get('q') ? { lens: 'search', jobs: [oldJob], total: 1, next_offset: null } : { lens: 'assigned', jobs: [], total: 0 }),
      trade_job_detail: { status: 403, body: { error: 'Not your job' } }
    });
    await openJobsTab(page, 'all');
    await page.locator('#jobSearchInput').fill('SWP-24001');
    const card = page.locator('#myJobsList .jcsr').filter({ hasText: 'SWP-24001' });
    await expect(card).not.toContainText('View only');
    await card.click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('This job is not on your jobs');
    await expect(page.locator('#jobDetailContent')).not.toContainText('Retry');
  });
});

test.describe('Managed lead keeps own jobs on Everyone (audit finding 4)', () => {
  test('Ryan sees his own patio job on This Week alongside the make-safe Everyone rows', async ({ page }) => {
    const { log } = await boot(page, 'ryan', ryanActions([]));
    await openJobsTab(page, 'thisWeek');
    const list = page.locator('#myJobsList');
    await expect(list.locator('.jc').filter({ hasText: 'SWP-26183' })).toHaveCount(1);
    await expect(list.locator('.jc').filter({ hasText: 'SWMS-260001' })).toHaveCount(1);
    const modes = log.filter((entry) => entry.action === 'my_jobs').map((entry) => new URL(entry.url).searchParams.get('mode'));
    expect(modes).toContain('all');
    expect(modes).toContain('mine');

    await openJobsTab(page, 'assigned');
    await expect(list.locator('.jc').filter({ hasText: 'SWP-26183' })).toHaveCount(1);
  });

  test('a failed own-jobs read is said out loud, never silent', async ({ page }) => {
    await boot(page, 'ryan', {
      my_jobs: ({ url }) => (url.searchParams.get('mode') === 'all'
        ? { ...EMPTY, thisWeek: [OTHER_MAKESAFE], _adminView: true }
        : { status: 500, body: { error: 'boom' } }),
      search_all_jobs: { lens: 'company', jobs: [], total: 0 }
    });
    await openJobsTab(page, 'thisWeek');
    await expect(page.locator('#myJobsList')).toContainText('Could not load your own jobs outside make-safe. Switch to Mine to see them.');
    await expect(page.locator('#myJobsList .jc').filter({ hasText: 'SWMS-260001' })).toHaveCount(1);
  });

  test('a failed own-jobs refresh keeps previously shown own rows', async ({ page }) => {
    let mineFails = false;
    await boot(page, 'ryan', {
      my_jobs: ({ url }) => {
        if (url.searchParams.get('mode') === 'all') {
          return { ...EMPTY, thisWeek: [OTHER_MAKESAFE], _adminView: true };
        }
        if (mineFails) return { status: 500, body: { error: 'boom' } };
        return { ...EMPTY, thisWeek: [RYAN_OWN_PATIO] };
      },
      search_all_jobs: { lens: 'company', jobs: [], total: 0 }
    });
    await openJobsTab(page, 'thisWeek');
    await expect(page.locator('#myJobsList .jc').filter({ hasText: 'SWP-26183' })).toHaveCount(1);
    mineFails = true;
    await page.evaluate(() => window.loadMyJobs());
    await expect(page.locator('#myJobsList')).toContainText('Could not load your own jobs outside make-safe. Switch to Mine to see them.');
    await expect(page.locator('#myJobsList .jc').filter({ hasText: 'SWP-26183' })).toHaveCount(1);
    await expect(page.locator('#myJobsList .jc').filter({ hasText: 'SWMS-260001' })).toHaveCount(1);
  });

  test('merged own today rows sort by start time before the run list freezes', async ({ page }) => {
    const today = perthDate();
    const ownEarly = row('asg-ryan-today', EMBLETON_JOB, { scheduled_date: today, start_time: '07:00' });
    const otherLate = row('asg-other-ms-today', {
      id: 'ms-job-today', job_number: 'SWMS-260099', client_name: 'Other Client', type: 'makesafe',
      status: 'scheduled', site_suburb: 'Morley', site_address: 'Morley WA'
    }, { scheduled_date: today, start_time: '10:00', user: { id: 'u-other', name: 'Anthony' }, crew_name: 'Anthony' });
    await boot(page, 'ryan', {
      my_jobs: ({ url }) => (url.searchParams.get('mode') === 'all'
        ? { ...EMPTY, today: [otherLate], _adminView: true }
        : { ...EMPTY, today: [ownEarly] }),
      search_all_jobs: { lens: 'company', jobs: [], total: 0 }
    });
    await openJobsTab(page, 'today');
    const cards = page.locator('#myJobsList .jc');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('SWP-26183');
    await expect(cards.nth(1)).toContainText('SWMS-260099');
  });
});

test.describe('my_jobs load does not crash after paint', () => {
  async function assertJobsLoadWithoutErrorCard(page, persona, actions) {
    const { log } = await boot(page, persona, actions);
    await expect.poll(() => log.some((entry) => entry.action === 'my_jobs')).toBe(true);
    await expect.poll(async () => page.locator('#myJobsList').evaluate((el) => {
      const text = el.textContent || '';
      if (el.querySelector('.skeleton-card')) return 'loading';
      if (/Error loading jobs/.test(text)) return 'error';
      return 'ready';
    })).toBe('ready');
    await openJobsTab(page, 'thisWeek');
    const list = page.locator('#myJobsList');
    await expect(list.locator('.jc').filter({ hasText: 'SWP-26183' })).toHaveCount(1);
    await expect(list).not.toContainText('Error loading jobs');
    await expect.poll(() => log.filter((entry) => entry.action === 'my_jobs').length)
      .toBeGreaterThan(persona === 'ryan' ? 2 : 1);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await expect(list).not.toContainText('Could not refresh');
  }

  test('a managed lead sees This Week without an error card', async ({ page }) => {
    await assertJobsLoadWithoutErrorCard(page, 'ryan', ryanActions([]));
  });

  test('a crew member sees This Week without an error card', async ({ page }) => {
    await assertJobsLoadWithoutErrorCard(page, 'crew', {
      my_jobs: { ...EMPTY, thisWeek: [row('asg-crew-embleton', EMBLETON_JOB)] },
      search_all_jobs: { lens: 'assigned', jobs: [], total: 0 }
    });
  });
});

test.describe('No job money reaches a trade through the Jobs lists', () => {
  test('metadata.pricing_correction is dropped before cards and the on-device cache', async ({ page }) => {
    const priced = row('asg-priced', {
      ...EMBLETON_JOB, id: 'job-priced', job_number: 'SWF-99001', type: 'fencing',
      metadata: { external_ref: 'REF-1', pricing_correction: { old_total_inc_gst: 12345, new_total_inc_gst: 11000, new_deposit_amount: 3300 }, historical_invoice_number: 'INV-1' }
    });
    await boot(page, 'crew', { my_jobs: { ...EMPTY, thisWeek: [priced] }, search_all_jobs: { lens: 'assigned', jobs: [], total: 0 } });
    await openJobsTab(page, 'thisWeek');
    await expect(page.locator('#myJobsList .jc').filter({ hasText: 'SWF-99001' })).toHaveCount(1);
    const cached = await page.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith('sw_jobs_cache_'))
      .map((key) => localStorage.getItem(key))
      .join('\n'));
    expect(cached).toContain('SWF-99001');
    expect(cached).toContain('REF-1');
    expect(cached).not.toContain('pricing_correction');
    expect(cached).not.toContain('12345');
    expect(cached).not.toContain('INV-1');
  });
});
