const { test: base, expect } = require('@playwright/test');
const { installSupabaseAuthStub } = require('../helpers/auth');
const {
  installFeedStubs,
  installExternalRequestGuard,
  loadJsonFixture,
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
    const fencingRows = () => ['today', 'thisWeek', 'upcoming', 'recent', 'unscheduled', 'makesafePool']
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
    const feed = await installFeedStubs(page, {
      endpoint: `${SUPABASE_ORIGIN}/functions/v1/ops-api`,
      requestLog: feedRequests,
      actions: {
        makesafe_board: makesafeResponse,
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
        trade_job_detail: ({ url }) => {
          if (persona !== 'fencing_manager') return loadJsonFixture('job-detail.json');
          const jobId = url.searchParams.get('jobId');
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
        my_hours: feedScenario === 'wo-labour-explainer'
          ? labourExplainerHours
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
          if (feedScenario !== 'wo-labour-explainer' || persona !== 'installer') {
            return { status: 409, body: { error: 'WO labour explainer fixture is not enabled' } };
          }
          const body = request.postDataJSON();
          const line = body.extra_items && body.extra_items[0];
          if (!line || line.job_number !== 'SWF-26767') {
            return { status: 422, body: { error: 'Expected the reconciled work-order line' } };
          }
          return {
            ok: true,
            invoice_number: 'SW-INV-E2E-26767',
            total_inc: 272,
            pending_ops_review: true,
            wo_labour_payouts: [{ name: 'Tendo', total_ex: 287.5 }]
          };
        }
      },
      allowedWriteActions: feedScenario === 'fencing-allocation'
        ? ['allocate_job']
        : (feedScenario === 'fencing-stage-lifecycle'
            ? ['update_my_assignment', 'clock_event']
            : (feedScenario === 'wo-labour-explainer' ? ['generate_trade_invoice'] : []))
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
