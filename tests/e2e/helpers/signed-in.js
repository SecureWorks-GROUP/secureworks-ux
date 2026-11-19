/**
 * Reusable Playwright signed-in session mock for SecureWorks dashboards
 * (ops.html via shared/auth-gate.js, ceo.html via #authGate / unlockReport, etc.).
 *
 * Mocks window.supabase (reusing the cloud.supabase stub pattern) with a
 * persisted authenticated session and routes all backend traffic (REST,
 * Edge Functions, Auth, Storage, Realtime WebSockets, and CDN scripts) to
 * local fixtures so zero requests reach the live backend.
 */

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';

const DEFAULT_USER = {
  id: '00000000-0000-4000-8000-000000009901',
  email: 'zztest-ops@example.test',
  name: 'ZZTEST Operator',
  role: 'ops_manager',
  org_id: '00000000-0000-4000-8000-000000000001',
};

const DEFAULT_DIGEST_FIXTURE = {
  alerts: [
    {
      severity: 'amber',
      title: 'ZZTEST fixture alert',
      detail: 'ZZTEST fixture detail for automated e2e rendering.',
      action: 'ZZTEST review action',
    },
  ],
  ai_narrative: 'ZZTEST morning brief fixture.',
  summary_text: 'ZZTEST morning brief fixture.',
  built_at: '2026-11-18T23:00:00.000Z',
  digest_date: '2026-11-19',
  stored: true,
};

const DEFAULT_CEO_REPORT_FIXTURE = {
  sync_health: {
    xero_last_sync: '2026-11-19T01:00:00.000Z',
    ads_last_date: '2026-11-19',
  },
  summary: {
    stats: {
      revenue_mtd: 120000,
      margin_pct: 34,
      gross_profit_mtd: 40800,
      yoy_change_pct: 12,
      is_fallback: false,
      display_month: '2026-11-01',
      dso: 22,
    },
    targets: {
      revenue: 180000,
      margin: 30,
      pipeline_coverage: 2,
      win_rate: 40,
      dso: 30,
      cycle_time: 60,
      cost_to_revenue: 70,
      concentration_risk: 50,
    },
    pipeline_forecast: {
      weighted_pipeline: 360000,
      raw_pipeline: 540000,
      coverage: 2.0,
      avg_cycle_days: 28,
    },
    revenue_by_type: {
      patios: { revenue: 70000 },
      fencing: { revenue: 50000 },
    },
    stacked_revenue: {
      months: ['Sep', 'Oct', 'Nov'],
      fencing: [40000, 45000, 50000],
      patios: [60000, 65000, 70000],
      renovations: [0, 0, 0],
      insurance_work: [0, 0, 0],
      other: [0, 0, 0],
    },
    aged_receivables: {
      current: { total: 15000, count: 2 },
      '1-30': { total: 5000, count: 1 },
      '31-60': { total: 0, count: 0 },
      '61-90': { total: 0, count: 0 },
      '90+': { total: 0, count: 0 },
    },
  },
  marketing: {
    stats: {
      win_rate: 42,
      cpl: 65,
      ppad: 4.5,
      cpa: 180,
    },
  },
  budget_burn: {
    pct_used: 55,
    mtd_spend: 5500,
    budget: 10000,
    daily_rate: 290,
    remaining: 4500,
    projected_month_end: 8700,
    days_left: 11,
  },
  insights: {
    insights: [
      {
        severity: 'amber',
        title: 'ZZTEST Insight',
        action: 'ZZTEST weekly check',
        message: 'ZZTEST fixture insight message.',
      },
    ],
    scorecard: [
      { name: 'ZZTEST Score', value: 92, unit: '%', target: 85, status: 'green' },
    ],
  },
  trends: {
    months: ['Sep', 'Oct', 'Nov'],
    revenue: { data: [100000, 110000, 120000] },
    costs: { data: [66000, 72000, 79200] },
    margin_pct: { data: [34, 35, 34] },
    win_rate: { rate: [38, 40, 42] },
    avg_deal_size: { data: [9500, 10200, 11000] },
    google_ads: {
      spend: [8000, 8500, 5500],
      cpl: [72, 68, 65],
      conversions: [110, 125, 84],
    },
  },
  cash_forecast: {
    projected_cash_30d: 95000,
    projected_cash_60d: 165000,
    projected_cash_90d: 240000,
    overdue: 5000,
    due_30d: 15000,
    pipeline_30d: 75000,
    months_runway: 4.2,
    monthly_fixed_costs: 35000,
  },
  debt: {
    clients: [
      {
        contact_name: 'ZZTEST Receivable Client',
        total_owed: 5000,
        oldest_bucket: '1-30',
        invoices: [{ id: 'zztest-inv-1' }],
      },
    ],
  },
  problem_jobs: [],
  division_pl: {
    months: ['Sep', 'Oct', 'Nov'],
    divisions: [
      {
        division: 'patios',
        current: { revenue: 70000, costs: 45500, gross_profit: 24500, margin_pct: 35 },
        previous: { margin_pct: 33 },
        trend: { revenue: [60000, 65000, 70000], margin_pct: [32, 33, 35] },
      },
      {
        division: 'fencing',
        current: { revenue: 50000, costs: 33700, gross_profit: 16300, margin_pct: 33 },
        previous: { margin_pct: 32 },
        trend: { revenue: [40000, 45000, 50000], margin_pct: [31, 32, 33] },
      },
    ],
    totals: {
      current: { revenue: 120000, costs: 79200, gross_profit: 40800, margin_pct: 34 },
      previous: { margin_pct: 33 },
    },
    unallocated_costs: 0,
  },
  costs: {
    cost_to_revenue: {
      current_month_pct: 66,
      trailing_12m_pct: 68,
    },
    top_suppliers: [
      { name: 'ZZTEST Steel Supply', total: 24000 },
      { name: 'ZZTEST Hardware', total: 14000 },
    ],
    categories: [
      { category: 'ZZTEST Materials', amount: 48000 },
      { category: 'ZZTEST Labour', amount: 31200 },
    ],
    cost_trend: [
      { month: 'Sep', revenue: 100000, costs: 66000, gross_profit: 34000 },
      { month: 'Oct', revenue: 110000, costs: 72000, gross_profit: 38000 },
      { month: 'Nov', revenue: 120000, costs: 79200, gross_profit: 40800 },
    ],
  },
  clv: {
    overall: {
      avg_clv: 12500,
      total_customers: 48,
      repeat_rate: 18,
    },
    concentration: {
      top_5_pct: 22,
    },
    top_customers: [
      { contact_name: 'ZZTEST Top Client', total_revenue: 18000 },
    ],
    by_channel: [
      { channel: 'ZZTEST Organic', revenue: 70000 },
      { channel: 'ZZTEST Referral', revenue: 50000 },
    ],
  },
};

const DEFAULT_OPS_API_FIXTURES = {
  list_users: {
    users: [
      {
        id: DEFAULT_USER.id,
        email: DEFAULT_USER.email,
        name: DEFAULT_USER.name,
        role: DEFAULT_USER.role,
      },
    ],
  },
  pipeline: {
    columns: {
      quoted: [
        {
          id: 'zztest-job-0001',
          job_number: 'ZZTEST-0001',
          client_name: 'ZZTEST Fixture Client',
          site_address: '1 ZZTEST Way, ZZTEST Suburb WA 6000',
          type: 'patio',
          status: 'quoted',
          quoted_value: 1100,
        },
      ],
    },
  },
  list_pos: { purchase_orders: [], orders: [] },
  pending_prices: { pending_prices: [] },
  debt_ws_overview: { tab_visible: false },
  recon_daily_list: { items: [], rows: [] },
  pay_run: { allowed: false, weeks: [] },
};

const CHART_STUB_JS = `(() => {
  if (window.Chart) return;
  function ChartStub(ctx, config) {
    this.ctx = ctx;
    this.config = config;
  }
  ChartStub.prototype.destroy = function() {};
  ChartStub.prototype.update = function() {};
  ChartStub.prototype.resize = function() {};
  ChartStub.defaults = {
    font: { family: '', size: 12 },
    color: '',
    plugins: { legend: { labels: { usePointStyle: false, pointStyleWidth: 8 } } },
  };
  window.Chart = ChartStub;
})();`;

const JSPDF_STUB_JS = `(() => {
  if (window.jspdf) return;
  window.jspdf = {
    jsPDF: function() {
      return {
        text() {},
        save() {},
        output() { return ''; },
      };
    },
  };
})();`;

const PERMISSION_ERROR_RE = /\b(permission|401|403|42501)\b/i;

function isLocalUrl(url) {
  return /^(https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/|file:\/\/|data:|blob:|about:)/i.test(url);
}

async function resolveFixture(entry, urlObj, request) {
  if (typeof entry === 'function') {
    return await entry(urlObj, request);
  }
  return entry;
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, accept',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

function normalizeResponse(value, defaultStatus = 200) {
  if (value && typeof value === 'object' && ('status' in value || 'body' in value) && Object.keys(value).every((k) => ['status', 'body', 'contentType', 'headers'].includes(k))) {
    return {
      status: value.status ?? defaultStatus,
      contentType: value.contentType || 'application/json',
      headers: { ...CORS_HEADERS, ...(value.headers || {}) },
      body: typeof value.body === 'string' ? value.body : JSON.stringify(value.body ?? {}),
    };
  }
  return {
    status: defaultStatus,
    contentType: 'application/json',
    headers: { ...CORS_HEADERS },
    body: typeof value === 'string' ? value : JSON.stringify(value ?? {}),
  };
}

/**
 * Installs a mocked authenticated Supabase session + complete offline routing
 * (REST, Edge Functions, Auth, Storage, Realtime WebSockets, CDN scripts).
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {Partial<typeof DEFAULT_USER>} [options.user]
 * @param {string} [options.accessToken]
 * @param {Record<string, any>} [options.opsApi]
 * @param {any} [options.ceoReport]
 * @param {any} [options.digest]
 * @param {Record<string, any>} [options.rest]
 * @param {Record<string, any>} [options.functions]
 * @param {Record<string, any>} [options.tables] - In-browser responses for supabase.from(table)
 * @param {function} [options.onRealtimeMessage]
 */
async function installSignedInSession(page, options = {}) {
  const userCfg = {
    ...DEFAULT_USER,
    ...(options.user || {}),
  };
  const explicitEmail = Boolean(options.user && options.user.email);
  const accessToken = options.accessToken || 'zztest-e2e-access-token';
  const opsApiMap = { ...DEFAULT_OPS_API_FIXTURES, ...(options.opsApi || {}) };
  const ceoReportFixture = options.ceoReport ?? DEFAULT_CEO_REPORT_FIXTURE;
  const digestFixture = options.digest ?? DEFAULT_DIGEST_FIXTURE;
  const restFixtures = options.rest || {};
  const functionFixtures = options.functions || {};
  const inBrowserTables = options.tables || {};

  const requests = [];
  const blockedRequests = [];
  const websockets = [];

  await page.addInitScript(({ user, explicit, token, tables }) => {
    const mockState = {
      clients: [],
      channels: [],
      authEvents: [],
    };
    window.__swSignedInMock = mockState;

    function resolveEmail() {
      if (explicit) return user.email;
      if (Array.isArray(window.CEO_EMAILS) && window.CEO_EMAILS.length > 0) {
        return window.CEO_EMAILS[0];
      }
      return user.email;
    }

    function buildSession() {
      if (signedOut) return null;
      const email = resolveEmail();
      return {
        access_token: token,
        refresh_token: 'zztest-e2e-refresh-token',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: {
          id: user.id,
          email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: { role: user.role },
          user_metadata: { name: user.name },
        },
      };
    }

    let signedOut = false;

    function makeQuery(table) {
      const rows = Array.isArray(tables[table]) ? tables[table] : [];
      const query = {
        select() { return query; },
        insert() { return query; },
        update() { return query; },
        upsert() { return query; },
        delete() { return query; },
        eq() { return query; },
        neq() { return query; },
        gt() { return query; },
        gte() { return query; },
        lt() { return query; },
        lte() { return query; },
        in() { return query; },
        is() { return query; },
        ilike() { return query; },
        like() { return query; },
        or() { return query; },
        order() { return query; },
        limit() { return query; },
        range() { return query; },
        single() { return Promise.resolve({ data: rows[0] || null, error: null }); },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    }

    function createMockClient(url, key) {
      const clientIndex = mockState.clients.length;
      const listeners = [];
      const clientChannels = [];

      const auth = {
        async getSession() {
          return { data: { session: buildSession() }, error: null };
        },
        async getUser() {
          const s = buildSession();
          return { data: { user: s ? s.user : null }, error: null };
        },
        async refreshSession() {
          return { data: { session: buildSession() }, error: null };
        },
        async signInWithPassword() {
          signedOut = false;
          const s = buildSession();
          mockState.authEvents.push('SIGNED_IN');
          listeners.forEach((fn) => fn('SIGNED_IN', s));
          return { data: { user: s.user, session: s }, error: null };
        },
        async signInWithOtp() {
          return { data: {}, error: null };
        },
        async resetPasswordForEmail() {
          return { data: {}, error: null };
        },
        async updateUser() {
          const s = buildSession();
          return { data: { user: s ? s.user : null }, error: null };
        },
        async signOut() {
          signedOut = true;
          mockState.authEvents.push('SIGNED_OUT');
          listeners.forEach((fn) => fn('SIGNED_OUT', null));
          return { error: null };
        },
        onAuthStateChange(listener) {
          listeners.push(listener);
          setTimeout(() => {
            const s = buildSession();
            mockState.authEvents.push('INITIAL_SESSION');
            listener('INITIAL_SESSION', s);
          }, 0);
          return {
            data: {
              subscription: {
                unsubscribe() {
                  const idx = listeners.indexOf(listener);
                  if (idx !== -1) listeners.splice(idx, 1);
                },
              },
            },
          };
        },
      };

      const storage = {
        from() {
          return {
            async upload(path) { return { data: { path }, error: null }; },
            async remove() { return { data: [], error: null }; },
            async download() { return { data: new Blob(), error: null }; },
            async list() { return { data: [], error: null }; },
            getPublicUrl(path) { return { data: { publicUrl: 'https://zztest.invalid/storage/' + path } }; },
            async createSignedUrl(path) { return { data: { signedUrl: 'https://zztest.invalid/signed/' + path }, error: null }; },
          };
        },
      };

      const client = {
        auth,
        from: makeQuery,
        async rpc() { return { data: null, error: null }; },
        storage,
        realtime: {
          setAuth() {},
          connect() {},
          disconnect() {},
        },
        channel(name) {
          const record = {
            name,
            clientIndex,
            bindings: [],
            subscribed: false,
            unsubscribed: false,
            _handlers: [],
          };
          clientChannels.push(record);
          mockState.channels.push(record);
          const handle = {
            on(type, filter, handler) {
              record.bindings.push({ type, filter });
              if (typeof handler === 'function') record._handlers.push(handler);
              return handle;
            },
            subscribe(cb) {
              record.subscribed = true;
              if (typeof cb === 'function') {
                setTimeout(() => cb('SUBSCRIBED'), 0);
              }
              return handle;
            },
            unsubscribe() {
              record.unsubscribed = true;
              record.subscribed = false;
              return Promise.resolve('ok');
            },
          };
          return handle;
        },
        removeChannel(ch) {
          if (ch && typeof ch.unsubscribe === 'function') ch.unsubscribe();
          return Promise.resolve('ok');
        },
        removeAllChannels() {
          return Promise.resolve([]);
        },
        getChannels() {
          return clientChannels.slice();
        },
      };

      mockState.clients.push({ index: clientIndex, url, key, client });
      return client;
    }

    window.supabase = {
      createClient: createMockClient,
    };
  }, {
    user: userCfg,
    explicit: explicitEmail,
    token: accessToken,
    tables: inBrowserTables,
  });

  // Route all non-local WebSockets (including Supabase Realtime) locally so
  // nothing can connect to the live backend.
  await page.routeWebSocket(/^(wss?):\/\//i, (ws) => {
    const url = ws.url();
    if (isLocalUrl(url)) {
      ws.connectToServer();
      return;
    }
    const wsRecord = { url, sent: [], received: [] };
    websockets.push(wsRecord);

    if (/supabase\.co\/realtime\//i.test(url)) {
      ws.onMessage((raw) => {
        wsRecord.sent.push(String(raw));
        try {
          const msg = JSON.parse(String(raw));
          if (options.onRealtimeMessage) {
            options.onRealtimeMessage(msg, ws);
            return;
          }
          // Phoenix / Supabase Realtime protocol local acknowledgement.
          const reply = JSON.stringify({
            topic: msg.topic || 'phoenix',
            event: 'phx_reply',
            payload: { status: 'ok', response: {} },
            ref: msg.ref ?? null,
          });
          wsRecord.received.push(reply);
          ws.send(reply);
        } catch (_) {
          // Ignore non-JSON frames.
        }
      });
      return;
    }

    // Close any unexpected remote WebSocket without connecting upstream.
    ws.close({ code: 1000, reason: 'Blocked by signed-in e2e mock' });
  });

  // Route all non-local HTTP requests to local fixtures or stubbed CDN shims.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();

    if (isLocalUrl(url)) {
      return route.continue();
    }

    // CDN script stubs (prevent console errors and keep runs 100% offline).
    if (/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/i.test(url)) {
      requests.push({ kind: 'cdn', url });
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* @supabase/supabase-js mocked by signed-in e2e helper */',
      });
    }
    if (/cdn\.jsdelivr\.net\/npm\/chart\.js/i.test(url)) {
      requests.push({ kind: 'cdn', url });
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: CHART_STUB_JS,
      });
    }
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/i.test(url)) {
      requests.push({ kind: 'cdn', url });
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: JSPDF_STUB_JS,
      });
    }

    // Supabase backend routes (REST, Auth, Storage, Edge Functions).
    if (url.startsWith(SUPABASE_ORIGIN)) {
      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' });
      }
      const parsed = new URL(url);
      const pathname = parsed.pathname;

      // Supabase Auth REST (/auth/v1/*)
      if (pathname.startsWith('/auth/v1/')) {
        requests.push({ kind: 'auth', url, method: request.method() });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS_HEADERS,
          body: JSON.stringify({
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: 3600,
            user: { id: userCfg.id, email: userCfg.email, role: 'authenticated' },
          }),
        });
      }

      // Supabase PostgREST (/rest/v1/<table>)
      if (pathname.startsWith('/rest/v1/')) {
        const table = pathname.replace(/^\/rest\/v1\//, '');
        requests.push({ kind: 'rest', table, url, method: request.method() });
        const fixture = Object.prototype.hasOwnProperty.call(restFixtures, table)
          ? await resolveFixture(restFixtures[table], parsed, request)
          : [];
        const res = normalizeResponse(fixture);
        return route.fulfill(res);
      }

      // Supabase Storage (/storage/v1/*)
      if (pathname.startsWith('/storage/v1/')) {
        requests.push({ kind: 'storage', url, method: request.method() });
        const fixture = options.storage
          ? await resolveFixture(options.storage, parsed, request)
          : { ok: true };
        return route.fulfill(normalizeResponse(fixture));
      }

      // Supabase Edge Functions (/functions/v1/<name>)
      if (pathname.startsWith('/functions/v1/')) {
        const fnPath = pathname.replace(/^\/functions\/v1\//, '');
        const fnName = fnPath.split('/')[0];
        const action = parsed.searchParams.get('action') || '';
        requests.push({ kind: 'function', fn: fnPath, action, url, method: request.method() });

        if (Object.prototype.hasOwnProperty.call(functionFixtures, fnPath)) {
          const custom = await resolveFixture(functionFixtures[fnPath], parsed, request);
          return route.fulfill(normalizeResponse(custom));
        }
        if (Object.prototype.hasOwnProperty.call(functionFixtures, fnName)) {
          const custom = await resolveFixture(functionFixtures[fnName], parsed, request);
          return route.fulfill(normalizeResponse(custom));
        }

        if (fnName === 'ghl-proxy' && action === 'get_profile') {
          let postedEmail = userCfg.email;
          try {
            const body = request.postDataJSON();
            if (body && body.email) postedEmail = body.email;
          } catch (_) {}
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: CORS_HEADERS,
            body: JSON.stringify({
              profile: {
                id: userCfg.id,
                email: postedEmail,
                name: userCfg.name,
                role: userCfg.role,
                org_id: userCfg.org_id,
              },
            }),
          });
        }

        if (fnName === 'ops-api') {
          const entry = Object.prototype.hasOwnProperty.call(opsApiMap, action)
            ? opsApiMap[action]
            : {};
          const resolved = await resolveFixture(entry, parsed, request);
          return route.fulfill(normalizeResponse(resolved));
        }

        if (fnName === 'reporting-api') {
          const resolved = action === 'ceo_report'
            ? await resolveFixture(ceoReportFixture, parsed, request)
            : {};
          return route.fulfill(normalizeResponse(resolved));
        }

        if (fnName === 'daily-digest') {
          const resolved = await resolveFixture(digestFixture, parsed, request);
          return route.fulfill(normalizeResponse(resolved));
        }

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS_HEADERS,
          body: JSON.stringify({ ok: true }),
        });
      }
    }

    // Block every other remote URL so nothing can reach a live server.
    blockedRequests.push({ url, method: request.method() });
    return route.abort('blockedbyclient');
  });

  return {
    requests,
    blockedRequests,
    websockets,
    async getClientCount() {
      return page.evaluate(() => (window.__swSignedInMock ? window.__swSignedInMock.clients.length : 0));
    },
    async getChannels() {
      return page.evaluate(() => {
        const mock = window.__swSignedInMock;
        if (!mock) return [];
        const shared = window.SECUREWORKS_CLOUD && window.SECUREWORKS_CLOUD.supabase;
        return mock.channels.map((ch) => {
          const clientEntry = mock.clients[ch.clientIndex];
          return {
            name: ch.name,
            clientIndex: ch.clientIndex,
            onSharedClient: Boolean(shared && clientEntry && clientEntry.client === shared),
            bindings: ch.bindings,
            subscribed: ch.subscribed,
            unsubscribed: ch.unsubscribed,
          };
        });
      });
    },
    async getChannel(name) {
      const channels = await this.getChannels();
      return channels.find((ch) => ch.name === name) || null;
    },
    async emitRealtime(channelName, payload) {
      return page.evaluate(({ name, data }) => {
        const mock = window.__swSignedInMock;
        if (!mock) return 0;
        const ch = mock.channels.find((c) => c.name === name && c.subscribed);
        if (!ch) return 0;
        ch._handlers.forEach((fn) => fn(data));
        return ch._handlers.length;
      }, { name: channelName, data: payload });
    },
  };
}

/**
 * Collects console errors and uncaught page errors for a Playwright page and
 * provides assertions against permission/auth failure messages.
 */
function createConsoleErrorCollector(page) {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err && err.message ? err.message : String(err));
  });

  return {
    consoleErrors,
    pageErrors,
    getPermissionErrors() {
      return [...consoleErrors, ...pageErrors].filter((text) => PERMISSION_ERROR_RE.test(text));
    },
  };
}

module.exports = {
  SUPABASE_ORIGIN,
  DEFAULT_USER,
  DEFAULT_DIGEST_FIXTURE,
  DEFAULT_CEO_REPORT_FIXTURE,
  DEFAULT_OPS_API_FIXTURES,
  PERMISSION_ERROR_RE,
  installSignedInSession,
  createConsoleErrorCollector,
};
