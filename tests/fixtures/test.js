const { test: base, expect } = require('@playwright/test');
const { installSupabaseAuthStub } = require('../helpers/auth');
const { installFeedStubs, loadJsonFixture } = require('../helpers/feed-stub');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';

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
  }
};

const test = base.extend({
  persona: ['installer', { option: true }],
  feedScenario: ['normal', { option: true }],

  appPage: async ({ page, persona, feedScenario }, use) => {
    const selected = PERSONAS[persona];
    if (!selected) throw new Error(`Unknown E2E persona: ${persona}`);

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
    const feed = await installFeedStubs(page, {
      endpoint: `${SUPABASE_ORIGIN}/functions/v1/ops-api`,
      actions: {
        makesafe_board: makesafeResponse,
        list_users: {
          users: Object.values(PERSONAS).map(({ profile }) => ({
            id: profile.id,
            name: profile.name,
            role: profile.role
          }))
        },
        my_jobs: loadJsonFixture('my-jobs.json'),
        trade_job_detail: loadJsonFixture('job-detail.json'),
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
  }
});

module.exports = { test, expect, PERSONAS };
