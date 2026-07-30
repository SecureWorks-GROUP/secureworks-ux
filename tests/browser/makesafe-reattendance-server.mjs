import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../..'));
const port = Number(process.env.PORT || 4174);
const origin = `http://127.0.0.1:${port}`;
let visitTwoStarted = false;
let reattendancePayload = null;

const profile = {
  id: 'e2e-assigned-trade',
  email: 'assigned.trade@example.test',
  name: 'Assigned Trade',
  role: 'installer',
  trade_tier: 1,
  managed_verticals: [],
  org_id: '00000000-0000-0000-0000-000000000001'
};
const firstReport = {
  id: 'report-visit-1',
  job_id: 'e2e-makesafe-reattend',
  status: 'submitted',
  cycle_number: 1,
  attendance_cycle_id: 'cycle-visit-1',
  cycle_attribution: 'bound',
  submitted_at: '2026-07-27T01:00:00Z',
  checklist_json: {
    damage_description: 'Storm damage made the temporary fence unsafe.',
    work_done: 'Visit one secured the temporary fence.',
    materials_used: ['star pickets'],
    labour_hours: 2,
    trade_count: 1
  }
};

function detail() {
  return {
    job: {
      id: 'e2e-makesafe-reattend',
      job_number: 'SWMS-E2E-REAT',
      type: 'makesafe',
      status: 'scheduled',
      client_name: 'Browser Fixture Client',
      site_address: '10 Fixture Street',
      site_suburb: 'Perth'
    },
    crew: [{ id: 'assignment-1', user_id: profile.id, status: 'complete' }],
    purchaseOrders: [],
    documents: [],
    notes: [],
    media: Array.from({ length: 5 }, (_, index) => ({
      id: `visit-1-photo-${index + 1}`,
      job_id: 'e2e-makesafe-reattend',
      type: 'photo',
      phase: 'completion',
      attendance_cycle_id: 'cycle-visit-1',
      cycle_attribution: 'bound',
      storage_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    })),
    serviceReport: visitTwoStarted ? null : firstReport,
    serviceReports: [firstReport],
    makesafe_details: {
      substatus: visitTwoStarted ? 'waiting_on_trade_report' : 'admin_to_send_report',
      report_received_at: visitTwoStarted ? null : firstReport.submitted_at,
      cycle_number: visitTwoStarted ? 2 : 1,
      reattend_count: visitTwoStarted ? 1 : 0,
      attendance_cycle_id: visitTwoStarted ? 'cycle-visit-2' : 'cycle-visit-1',
      cycle_attribution: 'bound',
      last_reattend_reason: visitTwoStarted ? reattendancePayload?.reason : null
    }
  };
}

const authStub = `(() => {
  const user = ${JSON.stringify({ id: profile.id, email: profile.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} })};
  window.supabase = { createClient() {
    let session = null;
    const listeners = [];
    const notify = (event) => listeners.forEach((listener) => listener(event, session));
    const auth = {
      onAuthStateChange(listener) { listeners.push(listener); setTimeout(() => listener('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword(input) {
        if (input.email !== '${profile.email}' || input.password !== 'e2e-password') return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        session = { access_token: 'e2e-access-token', refresh_token: 'e2e-refresh-token', expires_in: 3600, token_type: 'bearer', user };
        notify('SIGNED_IN');
        return { data: { user, session }, error: null };
      },
      async getSession() { return { data: { session }, error: null }; },
      async refreshSession() { return { data: { session }, error: null }; },
      async getUser() { return { data: { user: session && session.user }, error: null }; },
      async signOut() { session = null; notify('SIGNED_OUT'); return { error: null }; }
    };
    const query = { select() { return query; }, insert() { return query; }, update() { return query; }, delete() { return query; }, eq() { return query; }, order() { return query; }, limit() { return query; }, single() { return Promise.resolve({ data: null, error: null }); }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
    return { auth, from() { return query; } };
  } };
})();`;

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': origin });
  res.end(JSON.stringify(body));
}

async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/__test__/supabase-stub.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(authStub);
      return;
    }
    if (url.pathname === '/__test__/state') {
      json(res, { visitTwoStarted, reattendancePayload });
      return;
    }
    if (url.pathname === '/functions/v1/ghl-proxy') {
      json(res, { profile });
      return;
    }
    if (url.pathname === '/functions/v1/ops-api') {
      const action = url.searchParams.get('action');
      if (action === 'trade_job_detail') return json(res, detail());
      if (action === 'reattend_makesafe') {
        reattendancePayload = await bodyOf(req);
        visitTwoStarted = true;
        return json(res, {
          ok: true,
          reattended: true,
          cycle_number: 2,
          reattend_count: 1,
          attendance_cycle_id: 'cycle-visit-2',
          authorization_relationship: 'assigned_trade'
        });
      }
      if (action === 'makesafe_board') return json(res, { contract_version: 'makesafe-board.v1', columns: { New: [], Allocated: [], Complete: [], Archive: [] }, rows: [], permissions: { visibility: 'allocated_only', sees_all_makesafes: false, can_allocate: false } });
      if (action === 'list_users') return json(res, { users: [profile] });
      if (action === 'my_jobs') return json(res, { today: [], thisWeek: [], upcoming: [], recent: [], unscheduled: [], makesafePool: [] });
      if (action === 'my_hours') return json(res, { assignments: [], total_hours: 0, already_submitted: false });
      if (action === 'my_trade_invoices') return json(res, { invoices: [] });
      if (action === 'my_work_orders') return json(res, { work_orders: [] });
      if (action === 'crew_charges_on_my_jobs') return json(res, { charges: [] });
      return json(res, { ok: true });
    }

    let pathname = url.pathname === '/' ? '/trade.html' : url.pathname;
    const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = join(root, safePath);
    if (!file.startsWith(root)) return json(res, { error: 'not found' }, 404);
    let bytes = await readFile(file);
    if (pathname === '/trade.html') {
      let html = bytes.toString('utf8');
      html = html.replace("window.SUPABASE_URL = 'https://kevgrhcjxspbxgovpmfl.supabase.co';", `window.SUPABASE_URL = '${origin}';`);
      html = html.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', '<script src="/__test__/supabase-stub.js"></script>');
      bytes = Buffer.from(html);
    }
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`MakeSafe reattendance browser fixture listening on ${origin}`);
});
