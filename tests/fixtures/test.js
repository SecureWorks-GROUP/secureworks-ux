const { test: base, expect } = require('@playwright/test');
const { installSupabaseAuthStub } = require('../helpers/auth');
const {
  installFeedStubs,
  installExternalRequestGuard,
  loadJsonFixture,
  perthDate,
  perthWeekMonday,
  addIsoDays
} = require('../helpers/feed-stub');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const APP_ORIGIN = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:4173').origin;

const PERSONAS = {
  allocator: {
    email: 'allocator@example.test',
    password: 'e2e-password',
    profile: {
      id: 'e2e-allocator',
      email: 'allocator@example.test',
      name: 'E2E Allocator',
      role: 'ops_manager',
      trade_tier: 3,
      managed_verticals: ['makesafe'],
      org_id: '00000000-0000-0000-0000-000000000001'
    }
  },
  installer: {
    email: 'installer@example.test',
    password: 'e2e-password',
    profile: {
      id: 'e2e-installer',
      email: 'installer@example.test',
      name: 'E2E Installer',
      role: 'crew',
      trade_tier: 1,
      managed_verticals: [],
      org_id: '00000000-0000-0000-0000-000000000001'
    }
  },
  fencing_manager: {
    email: 'henry@example.test',
    password: 'e2e-password',
    profile: {
      id: 'e2e-henry',
      email: 'henry@example.test',
      name: 'Henry Fence',
      role: 'lead_installer',
      trade_tier: 2,
      managed_verticals: ['fencing'],
      org_id: '00000000-0000-0000-0000-000000000001'
    }
  }
};

const test = base.extend({
  persona: ['installer', { option: true }],
  feedScenario: ['normal', { option: true }],
  feedRequests: async ({}, use) => {
    const requests = [];
    await use(requests);
  },

  appPage: async ({ page, persona, feedScenario, feedRequests }, use) => {
    const selected = PERSONAS[persona];
    if (!selected) throw new Error(`Unknown E2E persona: ${persona}`);

    const guard = await installExternalRequestGuard(page, { allowedOrigins: [APP_ORIGIN] });

    await installSupabaseAuthStub(page, {
      users: Object.fromEntries(Object.values(PERSONAS).map((entry) => [entry.email, entry])),
      profileEndpoint: `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy`
    });

    const board = loadJsonFixture('makesafe-board.json');
    if (persona !== 'allocator') {
      board.permissions = {
        visibility: 'allocated_only',
        sees_all_makesafes: false,
        can_allocate: false
      };
    }

    const makesafeResponse = feedScenario === 'access-denied'
      ? { status: 403, body: { error: 'Trade access is not available for this account' } }
      : board;
    let fencingAll = loadJsonFixture('fencing-manager-jobs.json');
    const fencingMine = loadJsonFixture('fencing-manager-mine.json');
    const fencingCalendar = loadJsonFixture('trade-calendar-fencing.json');
    const fencingRows = () => ['today', 'thisWeek', 'upcoming', 'recent', 'recentCompleted', 'unscheduled', 'makesafePool']
      .flatMap((bucket) => fencingAll[bucket] || []);
    const fencingAssignment = (assignmentId) => fencingRows().find((row) => row.id === assignmentId);
    const weekStart = perthWeekMonday();
    const labourExplainerHours = {
      week_start: weekStart,
      week_ending: addIsoDays(weekStart, 6),
      assignments: [
        {
          id: 'e2e-wo-holder-assignment',
          job_id: 'e2e-wo-holder-job',
          scheduled_date: addIsoDays(weekStart, 1),
          hours_worked: 8,
          jobs: {
            id: 'e2e-wo-holder-job',
            job_number: 'SWF-26767',
            client_name: 'Kelvin Gillies',
            site_suburb: 'Joondalup',
            type: 'fencing'
          }
        }
      ],
      rate: 50,
      rate_resolved: true,
      total_hours: 8,
      already_submitted: false
    };
    const perMetreInvoiceHours = {
      week_start: weekStart,
      week_ending: addIsoDays(weekStart, 6),
      assignments: [
        {
          id: 'e2e-per-metre-assignment',
          job_id: 'e2e-per-metre-job',
          scheduled_date: addIsoDays(weekStart, 2),
          jobs: {
            id: 'e2e-per-metre-job',
            job_number: 'SWF-E2E-PM',
            client_name: 'Per Metre Fixture',
            site_suburb: 'Balcatta',
            type: 'fencing',
            scope_json: { runs: [{ lengthM: 10 }] }
          }
        }
      ],
      super_rate: 0.12,
      gst_on: false,
      already_submitted: false
    };
    const submittedPerMetreMoney = {
      ...perMetreInvoiceHours,
      already_submitted: true,
      gross_earned: 350,
      super_rate: undefined,
      super_amount: 42,
      net_pay: 308,
      gst_on: true,
      gst_amount: 30.80,
      total_inc: 338.80
    };
    const workOrders = [
      {
        id: 'wo-fence-authorised',
        wo_number: 'WO-FENCE-001',
        job_id: 'fence-job-henry',
        job_number: 'FENCE-HENRY-001',
        client_name: 'Henry Client',
        job_type: 'fencing',
        status: 'complete',
        site_address: '11 Boundary Road',
        scope_items: [{ description: 'Install fencing', quantity: 10, rate: 10, total: 100 }],
        subtotal: 100,
        gst: 10,
        total: 110,
        already_invoiced: false,
        can_invoice: true
      },
      {
        id: 'wo-patio-not-managed',
        wo_number: 'WO-PATIO-002',
        job_number: 'PATIO-NOT-AUTHORISED',
        client_name: 'Patio Client',
        job_type: 'patio',
        status: 'complete',
        subtotal: 200,
        gst: 20,
        total: 220,
        can_invoice: true
      },
      {
        id: 'wo-other-tenant',
        org_id: '00000000-0000-0000-0000-000000000999',
        wo_number: 'WO-OTHER-TENANT',
        job_number: 'OTHER-TENANT-FENCE',
        client_name: 'Outside Tenant',
        job_type: 'fencing',
        status: 'complete',
        subtotal: 300,
        gst: 30,
        total: 330,
        can_invoice: true
      }
    ];
    // All-tab company feed (secureworks-backend docs/trade-all-means-all-v1.md).
    // Paged deliberately small so the scroll pager has to run more than once, and
    // only served under the all-jobs-feed scenarios — every other scenario keeps
    // the unregistered-action 404 the suite already relied on.
    const ALL_FEED_PAGE_SIZE = 30;
    const allFeedJobs = Array.from({ length: 90 }, (_, index) => ({
      id: `e2e-all-job-${String(index + 1).padStart(3, '0')}`,
      job_number: `SWALL-${1000 + index}`,
      client_name: `All Feed Client ${index + 1}`,
      site_suburb: `Feedville ${index + 1}`,
      site_address: `${index + 1} Ledger Road, Feedville`,
      type: index % 2 === 0 ? 'fencing' : 'patio',
      status: index % 3 === 0 ? 'complete' : 'scheduled'
    }));
    const searchableMakesafeJob = {
      id: 'e2e-makesafe-search-only',
      job_number: 'E2E-MS-HIDDEN-001',
      client_name: 'Search Fixture Client',
      site_suburb: 'Searchville',
      site_address: '1 Search Lane, Searchville WA 6000',
      type: 'makesafe',
      status: 'scheduled',
      makesafe_details: {
        substatus: 'waiting_on_trade_report',
        makesafe_type: 'Storm damage roof report'
      }
    };
    // ── Crew roster + lead installer (secureworks-backend PR #513) ──
    // Its own rows rather than the shared fencing fixture, so spec 11 keeps the
    // exact assignment set it recorded. Deliberately shaped like production:
    // Alyx holds TWO rows on the same job (a multi-day allocation, one row per
    // day) and `role` is 'lead_installer' on every row — the default that made
    // the backend refuse to read it as the lead signal.
    const crewLeadRows = [
      {
        id: 'fence-assignment-alyx', user_id: 'e2e-alyx', crew_name: 'Alyx Crew',
        users: { name: 'Alyx Crew' }, role: 'lead_installer', status: 'scheduled',
        scheduled_date: perthDate(), start_time: '07:30'
      },
      {
        id: 'fence-assignment-alyx-day2', user_id: 'e2e-alyx', crew_name: 'Alyx Crew',
        users: { name: 'Alyx Crew' }, role: 'lead_installer', status: 'scheduled',
        scheduled_date: addIsoDays(perthDate(), 1), start_time: '07:30'
      },
      {
        id: 'fence-assignment-sam', user_id: 'e2e-sam', crew_name: 'Sam Offsider',
        users: { name: 'Sam Offsider' }, role: 'lead_installer', status: 'scheduled',
        scheduled_date: perthDate(), start_time: '07:30'
      }
    ];
    // Nobody designated: the migration deliberately shipped no backfill.
    let crewLeadAssignmentId = null;
    const crewLeadDetail = (jobId) => {
      const row = fencingRows().find((entry) => entry.jobs && entry.jobs.id === jobId);
      if (!row) return { status: 404, body: { error: 'Unknown fencing fixture job' } };
      // 'crew-lead-legacy' models an ops-api deployment that predates PR #513:
      // no `leadInstaller` key and no `is_lead` on any row.
      const legacy = feedScenario === 'crew-lead-legacy';
      const crew = crewLeadRows.map((entry) => (legacy
        ? { ...entry }
        : { ...entry, name: entry.users.name, is_lead: entry.id === crewLeadAssignmentId }));
      const payload = {
        job: row.jobs, crew, purchaseOrders: [], documents: [], media: [], notes: []
      };
      if (!legacy) {
        const lead = crew.find((entry) => entry.is_lead) || null;
        payload.leadInstaller = lead
          ? { assignment_id: lead.id, user_id: lead.user_id, name: lead.name }
          : null;
      }
      return payload;
    };
    const CREW_LEAD_SCENARIOS = ['crew-lead', 'crew-lead-legacy', 'crew-lead-refused'];
    // One place deciding which scenario may write, so adding a scenario cannot
    // accidentally widen an existing one.
    const WRITE_SCENARIOS = {
      'fencing-allocation': ['allocate_job'],
      'fencing-stage-lifecycle': ['update_my_assignment', 'clock_event'],
      'wo-labour-explainer': ['generate_trade_invoice'],
      'trade-invoice-super-gst': ['generate_trade_invoice'],
      'trade-invoice-per-metre-gst': ['submit_trade_invoice'],
      'crew-lead': ['set_job_lead'],
      'crew-lead-refused': ['set_job_lead']
    };

    const feed = await installFeedStubs(page, {
      endpoint: `${SUPABASE_ORIGIN}/functions/v1/ops-api`,
      requestLog: feedRequests,
      actions: {
        makesafe_board: makesafeResponse,
        search_all_jobs: ({ url }) => {
          if (!['all-jobs-feed', 'all-jobs-feed-denied', 'trade-makesafe-search'].includes(feedScenario)) {
            return { status: 404, body: { error: 'No E2E fixture registered for search_all_jobs' } };
          }
          const q = (url.searchParams.get('q') || '').trim().toLowerCase();
          const offset = Number(url.searchParams.get('offset') || 0);
          if (feedScenario === 'trade-makesafe-search') {
            const haystack = [searchableMakesafeJob.job_number, searchableMakesafeJob.client_name,
              searchableMakesafeJob.site_suburb, searchableMakesafeJob.site_address].join(' ').toLowerCase();
            const jobs = q && haystack.includes(q) ? [searchableMakesafeJob] : [];
            return {
              jobs,
              lens: q ? 'search' : 'assigned',
              total: jobs.length,
              page_size: ALL_FEED_PAGE_SIZE,
              offset,
              truncated: false,
              next_offset: null
            };
          }
          if (!q && feedScenario === 'all-jobs-feed-denied') {
            // Server declined the company lens: the client must not paint this
            // assignment-scoped answer as "every job in the company".
            return {
              jobs: [],
              lens: 'assigned',
              total: 0,
              page_size: ALL_FEED_PAGE_SIZE,
              offset,
              truncated: false,
              next_offset: null
            };
          }
          const pool = q
            ? allFeedJobs.filter((job) =>
              job.job_number.toLowerCase().includes(q) || job.client_name.toLowerCase().includes(q))
            : allFeedJobs;
          const page = pool.slice(offset, offset + ALL_FEED_PAGE_SIZE);
          const hasMore = offset + page.length < pool.length;
          return {
            jobs: page,
            lens: q ? 'search' : 'company',
            total: pool.length,
            page_size: ALL_FEED_PAGE_SIZE,
            offset,
            truncated: hasMore,
            next_offset: hasMore ? offset + ALL_FEED_PAGE_SIZE : null
          };
        },
        list_users: persona === 'fencing_manager'
          ? {
              users: [
                {
                  id: PERSONAS.fencing_manager.profile.id,
                  name: PERSONAS.fencing_manager.profile.name,
                  role: PERSONAS.fencing_manager.profile.role
                },
                { id: 'e2e-alyx', name: 'Alyx Crew', role: 'crew' }
              ]
            }
          : {
              users: [PERSONAS.allocator, PERSONAS.installer].map(({ profile }) => ({
                id: profile.id,
                name: profile.name,
                role: profile.role
              }))
            },
        my_jobs: ({ url }) => {
          if (persona !== 'fencing_manager') return loadJsonFixture('my-jobs.json');
          return url.searchParams.get('mode') === 'mine' ? fencingMine : fencingAll;
        },
        trade_calendar: ({ url }) => {
          if (persona !== 'fencing_manager') {
            return { status: 403, body: { error: 'Trade calendar fixture is fencing-manager only' } };
          }
          if (feedScenario === 'calendar-unknown-action') {
            return { status: 404, body: { error: 'unknown action' } };
          }
          const mode = url.searchParams.get('mode') === 'mine' ? 'mine' : 'all';
          const from = url.searchParams.get('from') || '0000-01-01';
          const to = url.searchParams.get('to') || '9999-12-31';
          return {
            ...fencingCalendar,
            mode,
            events: fencingCalendar.events.filter((event) => {
              const overlaps = event.scheduled_date <= to && (event.scheduled_end || event.scheduled_date) >= from;
              return overlaps && (mode !== 'mine' || event.user_id === PERSONAS.fencing_manager.profile.id);
            })
          };
        },
        set_job_lead: ({ request }) => {
          if (feedScenario === 'crew-lead-refused') {
            return { status: 409, body: { error: 'That person is not an active crew member on this job' } };
          }
          if (feedScenario !== 'crew-lead') {
            return { status: 409, body: { error: 'Lead installer fixture is not enabled' } };
          }
          const body = request.postDataJSON();
          if (body.clear === true) {
            crewLeadAssignmentId = null;
            return { success: true, job_id: body.jobId, lead: null };
          }
          const row = crewLeadRows.find((entry) => entry.id === body.assignmentId);
          if (!row) {
            return { status: 409, body: { error: 'That person is not an active crew member on this job' } };
          }
          crewLeadAssignmentId = row.id;
          return {
            success: true,
            job_id: body.jobId,
            lead: { assignment_id: row.id, user_id: row.user_id, name: row.users.name }
          };
        },
        trade_job_detail: ({ url }) => {
          const jobId = url.searchParams.get('jobId');
          if (feedScenario === 'trade-makesafe-search' && jobId === searchableMakesafeJob.id) {
            return {
              job: searchableMakesafeJob,
              crew: [],
              purchaseOrders: [],
              documents: [],
              media: [],
              notes: [],
              serviceReport: null,
              makesafe_details: searchableMakesafeJob.makesafe_details
            };
          }
          if (CREW_LEAD_SCENARIOS.includes(feedScenario)) return crewLeadDetail(jobId);
          if (persona !== 'fencing_manager') return loadJsonFixture('job-detail.json');
          const assignment = fencingRows().find((row) => row.jobs && row.jobs.id === jobId);
          if (!assignment) return { status: 404, body: { error: 'Unknown fencing fixture job' } };
          return {
            job: assignment.jobs,
            crew: fencingRows()
              .filter((row) => row.jobs && row.jobs.id === jobId && row.id)
              .map((row) => ({
                id: row.id,
                user_id: row.user_id,
                name: row.crew_name,
                status: row.status,
                scheduled_date: row.scheduled_date,
                start_time: row.start_time
              })),
            purchaseOrders: [],
            documents: [],
            media: [],
            notes: []
          };
        },
        crew_charges_on_my_jobs: { charges: [] },
        my_hours: feedScenario === 'trade-invoice-per-metre-gst'
          ? perMetreInvoiceHours
          : feedScenario === 'trade-invoice-per-metre-missing-rate'
            ? submittedPerMetreMoney
            : feedScenario === 'trade-invoice-per-metre-missing-gst'
              ? { ...submittedPerMetreMoney, super_rate: 0.12, gst_amount: undefined }
          : ['wo-labour-explainer', 'trade-invoice-super-gst'].includes(feedScenario)
            ? {
              ...labourExplainerHours,
              super_rate: 0.12,
              gross_earned: 400,
              super_amount: 48,
              net_pay: 352,
              gst_on: false
            }
            : {
              week_start: weekStart,
              week_ending: addIsoDays(weekStart, 6),
              assignments: [],
              total_hours: 0,
              already_submitted: false
            },
        my_trade_invoices: { invoices: [] },
        my_work_orders: {
          work_orders: persona === 'fencing_manager' ? workOrders : []
        },
        allocate_job: async ({ request }) => {
          if (feedScenario !== 'fencing-allocation' || persona !== 'fencing_manager') {
            return { status: 409, body: { error: 'Allocation fixture is not enabled' } };
          }
          const body = request.postDataJSON();
          const open = (fencingAll.makesafePool || []).find((row) => row.jobs && row.jobs.id === body.jobId);
          if (!open) return { ok: true, mode: 'idempotent', deduped: true };
          const assignment = {
            ...open,
            id: 'fence-assignment-new',
            user_id: body.userId,
            status: 'scheduled',
            assignment_type: 'install',
            scheduled_date: body.scheduledDate,
            start_time: body.startTime || null,
            end_time: body.endTime || null,
            crew_name: body.userId === PERSONAS.fencing_manager.profile.id ? PERSONAS.fencing_manager.profile.name : 'Alyx Crew'
          };
          fencingAll.makesafePool = (fencingAll.makesafePool || []).filter((row) => !row.jobs || row.jobs.id !== body.jobId);
          fencingAll.upcoming = (fencingAll.upcoming || []).concat([assignment]);
          return { ok: true, mode: 'create', assignment };
        },
        update_my_assignment: async ({ request }) => {
          if (feedScenario !== 'fencing-stage-lifecycle' || persona !== 'fencing_manager') {
            return { status: 409, body: { error: 'Assignment lifecycle fixture is not enabled' } };
          }
          const body = request.postDataJSON();
          const assignment = fencingAssignment(body.assignmentId);
          if (!assignment || assignment.user_id !== PERSONAS.fencing_manager.profile.id) {
            return { status: 403, body: { error: 'Not your assignment' } };
          }
          if (body.status) assignment.status = body.status;
          return { assignment: { ...assignment } };
        },
        clock_event: async ({ request }) => {
          if (feedScenario !== 'fencing-stage-lifecycle' || persona !== 'fencing_manager') {
            return { status: 409, body: { error: 'Clock lifecycle fixture is not enabled' } };
          }
          const body = request.postDataJSON();
          const assignment = fencingAssignment(body.assignment_id);
          if (!assignment || assignment.user_id !== PERSONAS.fencing_manager.profile.id) {
            return { status: 403, body: { error: 'Not your assignment' } };
          }
          if (body.event === 'clock_on' || body.event === 'start_travel') assignment.status = 'in_progress';
          if (body.event === 'clock_off') assignment.status = 'complete';
          return {
            success: true,
            assignment: {
              ...assignment,
              clocked_on_at: body.event === 'clock_off' ? null : new Date().toISOString(),
              arrived_at: body.event === 'clock_on' ? new Date().toISOString() : null,
              clocked_off_at: body.event === 'clock_off' ? new Date().toISOString() : null
            },
            net_hours: body.event === 'clock_off' ? 1 : null
          };
        },
        generate_trade_invoice: ({ request }) => {
          if (!['wo-labour-explainer', 'trade-invoice-super-gst'].includes(feedScenario) || persona !== 'installer') {
            return { status: 409, body: { error: 'WO labour explainer fixture is not enabled' } };
          }
          const body = request.postDataJSON();
          const line = body.extra_items && body.extra_items[0];
          if (!line || line.job_number !== 'SWF-26767') {
            return { status: 422, body: { error: 'Expected the reconciled work-order line' } };
          }
          if (feedScenario === 'trade-invoice-super-gst') {
            if (body.gst_on !== true) {
              return { status: 422, body: { error: 'Expected GST choice to be submitted' } };
            }
            if (['super_rate', 'super_amount', 'gross_earned', 'net_pay'].some((field) => Object.hasOwn(body, field))) {
              return { status: 422, body: { error: 'Browser must not submit calculated super figures' } };
            }
            return {
              ok: true,
              invoice_number: 'SW-INV-E2E-SUPER-GST',
              gross_earned: 272,
              super_rate: 0.12,
              super_amount: 32.64,
              net_pay: 239.36,
              gst_on: true,
              gst_amount: 23.94,
              total_inc: 263.30,
              pending_ops_review: true
            };
          }
          return {
            ok: true,
            invoice_number: 'SW-INV-E2E-26767',
            total_inc: 272,
            pending_ops_review: true,
            wo_labour_payouts: [{ name: 'Tendo', total_ex: 287.5 }]
          };
        },
        submit_trade_invoice: ({ request }) => {
          if (feedScenario !== 'trade-invoice-per-metre-gst' || persona !== 'fencing_manager') {
            return { status: 409, body: { error: 'Per-metre GST fixture is not enabled' } };
          }
          const body = request.postDataJSON();
          if (body.gst_on !== true) {
            return { status: 422, body: { error: 'Expected GST choice to be submitted' } };
          }
          if (['super_rate', 'super_amount', 'gross_earned', 'net_pay'].some((field) => Object.hasOwn(body, field))) {
            return { status: 422, body: { error: 'Browser must not submit calculated super figures' } };
          }
          return {
            success: true,
            xero_bill_number: 'DRAFT-E2E-PM',
            gross_earned: 350,
            super_rate: 0.12,
            super_amount: 42,
            net_pay: 308,
            gst_on: true,
            gst_amount: 30.80,
            total_inc: 338.80
          };
        }
      },
      allowedWriteActions: WRITE_SCENARIOS[feedScenario] || []
    });

    await page.route('https://cdnjs.cloudflare.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.jspdf = window.jspdf || {};'
    }));
    await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } })
    }));

    await page.goto('/trade.html');
    await use(page);
    expect(feed.unexpectedWrites, 'stubbed E2E flows must never attempt an ops-api write').toEqual([]);
    expect(guard.blockedRequests, 'stubbed E2E flows must never reach an unstubbed external endpoint').toEqual([]);
  }
});

module.exports = { test, expect, PERSONAS };
