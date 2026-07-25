const { test: base, expect } = require('@playwright/test');
const { installSupabaseAuthStub } = require('../helpers/auth');
const { installFeedStubs, installExternalRequestGuard, loadJsonFixture } = require('../helpers/feed-stub');

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
    const fencingAll = loadJsonFixture('fencing-manager-jobs.json');
    const fencingMine = loadJsonFixture('fencing-manager-mine.json');
    const fencingCalendar = loadJsonFixture('trade-calendar-fencing.json');
    const fencingRows = ['today', 'thisWeek', 'upcoming', 'recent', 'makesafePool']
      .flatMap((bucket) => fencingAll[bucket] || []);
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
          const mode = url.searchParams.get('mode') === 'mine' ? 'mine' : 'all';
          return {
            ...fencingCalendar,
            mode,
            events: mode === 'mine'
              ? fencingCalendar.events.filter((event) => event.user_id === PERSONAS.fencing_manager.profile.id)
              : fencingCalendar.events
          };
        },
        trade_job_detail: ({ url }) => {
          if (persona !== 'fencing_manager') return loadJsonFixture('job-detail.json');
          const jobId = url.searchParams.get('jobId');
          const assignment = fencingRows.find((row) => row.jobs && row.jobs.id === jobId);
          if (!assignment) return { status: 404, body: { error: 'Unknown fencing fixture job' } };
          return {
            job: assignment.jobs,
            crew: fencingRows
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
        crew_charges_on_my_jobs: { charges: [] }
      }
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
