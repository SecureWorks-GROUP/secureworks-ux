// Dispatch v2 (approved build, Oct 2026): the screen side of slices 2, 3, 4,
// 7 and 8, against a stubbed ops-api. No test lets anything leave: every
// write is fulfilled by the stub and checked for its exact body.
//
//  - Slice 2: the board list (pipeline&dispatch=1&board=v2): Active / Archive,
//    folding stage sections with counts, "SWF · Full Name" cards, the red and
//    amber flags, and an Archive search.
//  - Slice 3: the header rail shows the real stages; a press only asks
//    "Move SWF-x to <Stage>?"; Move sends update_job_status (compare-and-set
//    on the stage the screen showed, source 'dispatch') or
//    update_repair_stage. set_dispatch_stage and
//    set_dispatch_install_confirmed are never sent.
//  - Slice 4 (screen): an order made in Dispatch has no Push to Xero, Email
//    or Approve & Send on the old PO board, and the backend's
//    dispatch_po_refused answer is shown in its own words.
//  - Slice 7: the Arrival line, thin on the card and full in the open job.
//  - Slice 8: Supplier replies (match pills, Accept / Dismiss, best guesses)
//    and the Unmatched supplier emails tray.
//  - The phone width (390) has no sideways scroll.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { PERTH_TODAY, V2_ANSWER, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const PERTH_YEAR = Number(PERTH_TODAY.slice(0, 4));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A Perth day n days from today, as YYYY-MM-DD.
const dayFrom = (n) => new Date(Date.parse(PERTH_TODAY + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// The page's own day words: "Tue 27/10", with the year only when it is not this year.
const words = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}${d.getUTCFullYear() !== PERTH_YEAR ? '/' + d.getUTCFullYear() : ''}`;
};

const ROW = (over) => Object.assign({
  site_address: '1 Test Street', value: 12000, value_inc_gst: true, description: null,
  next_scheduled_date: null, last_scheduled_date: null, council_status: null, council_required: false, po_count: 0,
  dispatch_next_step: null, ghl_contact_id: null,
}, over);

const INSTALL = (day, extra) => Object.assign({ booked: true, day, first_day: day, last_day: day, archive_on: null, passed: false, tentative: false }, extra);
const NO_INSTALL = { booked: false, day: null, first_day: null, last_day: null, archive_on: null, passed: false, tentative: false };

const ARRIVAL = (installDay, orders) => ({
  today: PERTH_TODAY, install_day: installDay, orders,
  counts: { orders: orders.length, sent: orders.length, confirmed: orders.filter((o) => o.mark === 'solid').length, late: orders.filter((o) => o.flag).length },
  all_confirmed_in_time: orders.length > 0 && orders.every((o) => o.mark === 'solid' && !o.flag),
});
const F1_ORDERS = [
  { supplier_name: 'Metroll', delivery_date: dayFrom(4), mark: 'solid', flag: null },
  { supplier_name: 'Bunnings', delivery_date: dayFrom(6), mark: 'ring', flag: null },
  { supplier_name: 'Emu Concrete', delivery_date: null, mark: 'ring', flag: 'no_date' },
];

const JOBS = {
  f1: ROW({
    id: 'job-f1', job_number: 'SWF-910001', client_name: 'Jane Smith', site_suburb: 'Gwelup', type: 'fencing', work_type: 'fencing',
    status: 'order_materials', updated_at: '2026-10-20T05:00:00+00:00', description: '40m Colorbond fence',
    board: {
      title: 'SWF-910001 · Jane Smith', days_in_stage: 3, install: INSTALL(dayFrom(10)),
      arrival: ARRIVAL(dayFrom(10), F1_ORDERS),
    },
  }),
  p1: ROW({
    id: 'job-p1', job_number: 'SWP-910002', client_name: 'Tom Lee', site_suburb: 'Yokine', type: 'patio', work_type: 'patio',
    status: 'awaiting_supplier', updated_at: '2026-10-19T05:00:00+00:00',
    board: {
      title: 'SWP-910002 · Tom Lee', days_in_stage: 1, install: NO_INSTALL,
      deposit: { required: true, paid: false, state: 'not_paid' },
      flags: { deposit_not_paid: true, no_install_booked: true, install_date_passed: false },
    },
  }),
  r1: ROW({
    id: 'job-r1', job_number: 'SWR-910003', client_name: 'Ann Wu', site_suburb: 'Bassendean', type: 'repair', work_type: 'repair',
    status: 'materials', updated_at: '2026-10-18T05:00:00+00:00',
    board: { title: 'SWR-910003 · Ann Wu', days_in_stage: 0, install: INSTALL(dayFrom(2)) },
  }),
};
const ARCHIVED = ROW({
  id: 'job-a1', job_number: 'SWF-910009', client_name: 'Old Client', site_suburb: 'Duncraig', type: 'fencing', work_type: 'fencing',
  status: 'complete', updated_at: '2026-10-10T05:00:00+00:00',
  board: {
    view: 'archive', title: 'SWF-910009 · Old Client', stage_key: 'scheduled', stage_label: 'Scheduled', stage_order: 5, stage_phase: 'after',
    install: INSTALL(dayFrom(-6), { passed: true, archive_on: dayFrom(-5) }), moves: null,
  },
});
const OLDER = ROW({
  id: 'job-a2', job_number: 'SWF-900777', client_name: 'Long Ago', site_suburb: 'Kardinya', type: 'fencing', work_type: 'fencing',
  status: 'complete', updated_at: '2026-03-01T05:00:00+00:00',
  board: {
    view: 'archive', title: 'SWF-900777 · Long Ago', stage_key: 'scheduled', stage_label: 'Scheduled', stage_order: 5, stage_phase: 'after',
    install: INSTALL('2026-02-20', { passed: true, archive_on: '2026-02-21' }), moves: null,
  },
});

const ACTIVE = () => ({ columns: { accepted: [JOBS.f1, JOBS.p1, JOBS.r1].map((r) => JSON.parse(JSON.stringify(r))) }, total: 3, dispatch_materials: 'ok' });
const ARCHIVE_GROUP = (rows) => ({ columns: { archive: rows }, total: rows.length, board: { groups: [{ key: 'archive', track: 'archive', label: 'Dispatch archive', count: rows.length, job_ids: rows.map((r) => r.id) }], total: rows.length } });

const DETAIL = (id) => {
  const r = Object.values(JOBS).concat([ARCHIVED, OLDER]).find((j) => j.id === id);
  return r ? { job: { id, job_number: r.job_number, type: r.type, scope_json: null, ghl_contact_id: null }, media: [], documents: [], invoices: [] } : { status: 404, body: { error: 'Job not found' } };
};

// Boots Ops on Dispatch with ops-api stubbed. `api[action]` returns a JSON
// body or { status, body }; `api.archive` answers the Archive read.
async function boot(page, api = {}, { viewport = { width: 1440, height: 900 } } = {}) {
  const calls = [];
  const handlers = Object.assign({
    pipeline: () => ACTIVE(),
    archive: () => ARCHIVE_GROUP([JSON.parse(JSON.stringify(ARCHIVED))]),
    job_detail: (url) => DETAIL(url.searchParams.get('jobId')),
    job_notes: (url) => ({ job_id: url.searchParams.get('jobId'), total: 0, notes: [] }),
    list_pos: () => ({ purchase_orders: [] }),
    ...V2_EMPTY_READS,
  }, api);
  await page.setViewportSize(viewport);
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    const action = /\/functions\/v1\/ops-api$/.test(url.pathname) ? url.searchParams.get('action') : null;
    if (!action) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    calls.push({ action, method: request.method(), url, body });
    const view = url.searchParams.get('view') || 'active';
    const key = action === 'pipeline' && view === 'archive' ? 'archive' : action;
    const out = handlers[key] ? await handlers[key](url, body) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    let reply = wrapped ? out.body : out;
    if (action === 'pipeline' && (!wrapped || out.status < 300)) reply = V2_ANSWER(reply, view);
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(OPS_FILE + '#dispatch');
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const root = page.locator('#dispatchRoot');
  const of = (action) => calls.filter((c) => c.action === action);
  const writes = () => calls.filter((c) => c.method === 'POST' && c.action !== 'operator_heartbeat');
  return { calls, of, root, writes };
}

const openJob = async (root, number) => {
  await root.locator('.dpc-job', { hasText: number }).click();
  await expect(root.locator('.dpc-jobhead h2')).toContainText(number);
};

// ── Slice 2: the list ─────────────────────────────────────────────────────────

test.describe('Dispatch v2 list', () => {
  test('Active lists the stage sections in pipeline order with counts, and each card reads SWF · Full Name', async ({ page }) => {
    const { root, of } = await boot(page);
    const list = root.locator('.dpc-job-list');
    await expect(root.locator('[data-dpc-mode="active"]')).toHaveText('Active 3');
    await expect(root.locator('[data-dpc-mode="archive"]')).toHaveText('Archive 1');
    await expect(list.locator('.dpc-grp-name')).toHaveText(['Order Materials', 'Awaiting Supplier', 'Order Confirmed', 'Schedule Install', 'Scheduled', 'Repairs: Materials', 'Repairs: Scheduled']);
    await expect(list.locator('.dpc-grp-count')).toHaveText(['1', '1', '0', '0', '0', '1', '0']);
    await expect(list.locator('.dpc-job strong')).toHaveText(['SWF-910001 · Jane Smith', 'SWP-910002 · Tom Lee', 'SWR-910003 · Ann Wu']);
    const f1 = list.locator('.dpc-job', { hasText: 'SWF-910001' });
    await expect(f1.locator(':scope > span:not(.dpc-job-top):not(.dpc-flags):not(.dpc-vh):not(.dpc-arrthin)').first()).toHaveText('Gwelup · 40m Colorbond fence');
    await expect(f1.locator('.dpc-muted')).toHaveText(`3 days in stage · Install ${words(dayFrom(10))}`);
    await expect(list.locator('.dpc-job', { hasText: 'SWR-910003' }).locator('.dpc-muted')).toHaveText(`In stage since today · Install ${words(dayFrom(2))}`);
    // The read is the v2 board, both views read once up front.
    const reads = of('pipeline').map((c) => [c.url.searchParams.get('dispatch'), c.url.searchParams.get('board'), c.url.searchParams.get('view')]);
    expect(reads).toEqual(expect.arrayContaining([['1', 'v2', 'active'], ['1', 'v2', 'archive']]));
    expect(reads).toHaveLength(2);
  });

  test('a deposit not paid is a red flag and no install booked an amber one, on the card and the header', async ({ page }) => {
    const { root } = await boot(page);
    const p1 = root.locator('.dpc-job', { hasText: 'SWP-910002' });
    await expect(p1.locator('.dpc-flag')).toHaveText(['Deposit not paid', 'No install booked']);
    await expect(p1.locator('.dpc-flag-red')).toHaveText('Deposit not paid');
    await expect(p1.locator('.dpc-flag-amber')).toHaveText('No install booked');
    await expect(p1.locator('.dpc-muted')).toHaveText('1 day in stage · Not booked');
    await expect(root.locator('.dpc-job', { hasText: 'SWF-910001' }).locator('.dpc-flag')).toHaveCount(0);
    await openJob(root, 'SWP-910002');
    await expect(root.locator('.dpc-jobhead .dpc-flag-red')).toHaveText('Deposit not paid');
    await expect(root.locator('.dpc-jobhead .dpc-flag-amber')).toHaveText('No install booked');
  });

  test('a stage section folds and stays folded after a reload', async ({ page }) => {
    const { root } = await boot(page);
    const head = root.locator('[data-dpc-fold="awaiting_supplier"]');
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(head).toBeFocused();
    await expect(root.locator('.dpc-job', { hasText: 'SWP-910002' })).toHaveCount(0);
    await expect(root.locator('.dpc-job')).toHaveCount(2);
    await page.reload();
    await expect(root.locator('.dpc-job')).toHaveCount(2);
    await expect(root.locator('[data-dpc-fold="awaiting_supplier"]')).toHaveAttribute('aria-expanded', 'false');
    await root.locator('[data-dpc-fold="awaiting_supplier"]').click();
    await expect(root.locator('.dpc-job')).toHaveCount(3);
  });

  test('Archive lists the jobs that left Scheduled, and its search finds older ones', async ({ page }) => {
    const { root, of } = await boot(page, {
      archive: (url) => {
        const q = url.searchParams.get('search');
        if (!q) return ARCHIVE_GROUP([JSON.parse(JSON.stringify(ARCHIVED))]);
        return ARCHIVE_GROUP(/kardinya/i.test(q) ? [JSON.parse(JSON.stringify(OLDER))] : []);
      },
    });
    await root.locator('[data-dpc-mode="archive"]').click();
    await expect(root.locator('[data-dpc-mode="archive"]')).toHaveAttribute('aria-pressed', 'true');
    const list = root.locator('.dpc-job-list');
    await expect(list.locator('.dpc-grp-name')).toHaveText(['Dispatch archive']);
    await expect(list.locator('.dpc-grp-sub')).toHaveText('Last 30 days, newest first');
    const card = list.locator('.dpc-job');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/dpc-job-archived/);
    await expect(card.locator('strong')).toHaveText('SWF-910009 · Old Client');
    const on = dayFrom(-5).split('-').map(Number);
    await expect(card.locator('.dpc-muted')).toHaveText(`Installed ${words(dayFrom(-6))} · archived ${on[2]}/${on[1]}${on[0] !== PERTH_YEAR ? '/' + on[0] : ''} · Ops Dash: Scheduled`);
    // No Arrival line on an archived card.
    await expect(card.locator('.dpc-arrthin')).toHaveCount(0);

    await root.locator('[data-dpc-search]').fill('Kardinya');
    await expect(list.locator('.dpc-job strong')).toHaveText(['SWF-900777 · Long Ago']);
    await expect(list.locator('.dpc-grp-sub')).toHaveText('Every archived job that matches, newest first');
    const search = of('pipeline').filter((c) => c.url.searchParams.get('search'));
    expect(search.at(-1).url.searchParams.get('view')).toBe('archive');
    expect(search.at(-1).url.searchParams.get('board')).toBe('v2');
    await root.locator('[data-dpc-search]').fill('Nowhere');
    await expect(list).toHaveText('No archived jobs match.');

    // Back to Active clears the search.
    await root.locator('[data-dpc-mode="active"]').click();
    await expect(root.locator('[data-dpc-search]')).toHaveValue('');
    await expect(root.locator('.dpc-job')).toHaveCount(3);
  });

  test('a failed Archive read says so with Retry and never empties Active', async ({ page }) => {
    let down = true;
    const { root } = await boot(page, { archive: () => (down ? { status: 500, body: { error: 'e2e' } } : ARCHIVE_GROUP([JSON.parse(JSON.stringify(ARCHIVED))])) });
    await expect(root.locator('.dpc-job')).toHaveCount(3);
    await root.locator('[data-dpc-mode="archive"]').click();
    const list = root.locator('.dpc-job-list');
    await expect(list.locator('[role="alert"]')).toContainText('Could not load the archive.');
    await expect(list).not.toContainText('No jobs');
    down = false;
    await list.locator('[data-dpc-retry="archive"]').click();
    await expect(root.locator('.dpc-job')).toHaveCount(1);
    await root.locator('[data-dpc-mode="active"]').click();
    await expect(root.locator('.dpc-job')).toHaveCount(3);
  });
});

// ── Slice 3: the rail ─────────────────────────────────────────────────────────

test.describe('Dispatch v2 rail', () => {
  test('the rail shows the real stages; a press asks first, Cancel sends nothing, Move sends update_job_status once', async ({ page }) => {
    let moved = false;
    const { root, of, writes } = await boot(page, {
      pipeline: () => {
        const out = ACTIVE();
        if (moved) out.columns.accepted[0].status = 'awaiting_supplier';
        return out;
      },
      update_job_status: () => { moved = true; return { success: true, job_id: 'job-f1', status: 'awaiting_supplier' }; },
    });
    const tape = root.locator('[data-dpc-region="tape"]');
    await expect(tape.locator('.dpc-tape-meta')).toContainText('Pipeline stage');
    await expect(tape.locator('.dpc-tape-meta strong')).toHaveText('Order Materials');
    await expect(tape.locator('.dpc-tape-meta')).toContainText('1 of 5');
    await expect(tape.locator('.dpc-tape-label')).toHaveText(['Order Materials', 'Awaiting Supplier', 'Order Confirmed', 'Schedule Install', 'Scheduled']);
    await expect(tape.locator('[data-dpc-stage="order_materials"]')).toHaveAttribute('aria-current', 'step');
    await expect(tape.locator('[data-dpc-stage="order_materials"]')).toBeDisabled();
    await expect(tape).toContainText('Same as the Ops Dash pipeline. Moving here moves the job there too.');
    // No Mark confirmed any more.
    await expect(page.locator('#viewDispatch')).not.toContainText('Mark confirmed');

    await tape.locator('[data-dpc-stage="awaiting_supplier"]').click();
    const ask = tape.locator('.dpc-tape-confirm');
    await expect(ask).toContainText('Move SWF-910001 to Awaiting Supplier? It moves on the Ops Dash too.');
    await expect(ask.locator('[data-dpc-stage-go]')).toBeFocused();
    await ask.locator('[data-dpc-stage-cancel]').click();
    await expect(ask).toHaveCount(0);
    await expect(tape.locator('[data-dpc-stage="awaiting_supplier"]')).toBeFocused();
    expect(writes()).toEqual([]);

    await tape.locator('[data-dpc-stage="awaiting_supplier"]').click();
    await tape.locator('[data-dpc-stage-go]').click();
    await expect(tape.locator('[role="status"]')).toHaveText('Moved to Awaiting Supplier.');
    expect(of('update_job_status')).toHaveLength(1);
    expect(of('update_job_status')[0].body).toEqual({ jobId: 'job-f1', status: 'awaiting_supplier', expected_statuses: ['order_materials'], source: 'dispatch', operator_email: expect.any(String) });
    // The list re-reads and the card moves section.
    await expect(root.locator('[data-dpc-grp="awaiting_supplier"] .dpc-job')).toHaveCount(2);
    await expect(tape.locator('.dpc-tape-meta strong')).toHaveText('Awaiting Supplier');
    expect(writes().map((c) => c.action)).toEqual(['update_job_status']);
  });

  test('a move back asks too, and "moved somewhere else" re-reads without a second write', async ({ page }) => {
    const { root, of } = await boot(page, {
      update_job_status: () => ({ success: false, skipped: 'status_changed', current_status: 'order_confirmed' }),
    });
    await openJob(root, 'SWP-910002');
    const tape = root.locator('[data-dpc-region="tape"]');
    await tape.locator('[data-dpc-stage="order_materials"]').click();
    await expect(tape.locator('.dpc-tape-confirm')).toContainText('Move SWP-910002 to Order Materials?');
    const reads = of('pipeline').length;
    await tape.locator('[data-dpc-stage-go]').click();
    await expect(tape.locator('[role="status"]')).toHaveText('This job moved somewhere else. Showing the latest.');
    expect(of('update_job_status').map((c) => c.body.expected_statuses)).toEqual([['awaiting_supplier']]);
    await expect.poll(() => of('pipeline').length).toBeGreaterThan(reads);
    expect(of('update_job_status')).toHaveLength(1);
  });

  test('a failed move says so with Retry, and Retry sends the same move once', async ({ page }) => {
    const answers = [{ status: 500, body: { error: 'e2e' } }, { success: true }];
    const { root, of } = await boot(page, { update_job_status: () => answers.shift() });
    const tape = root.locator('[data-dpc-region="tape"]');
    await tape.locator('[data-dpc-stage="schedule_install"]').click();
    await tape.locator('[data-dpc-stage-go]').click();
    await expect(tape.locator('[role="alert"]')).toContainText('Not moved. The job is still in Order Materials.');
    await page.waitForTimeout(300);
    expect(of('update_job_status')).toHaveLength(1);
    await tape.locator('[data-dpc-stage-retry]').click();
    await expect(tape.locator('[role="status"]')).toHaveText('Moved to Schedule Install.');
    expect(of('update_job_status').map((c) => c.body.status)).toEqual(['schedule_install', 'schedule_install']);
  });

  test('moving to Scheduled with nothing booked still asks, and says no install is booked', async ({ page }) => {
    const { root } = await boot(page, { update_job_status: () => ({ success: true }) });
    await openJob(root, 'SWP-910002');
    const tape = root.locator('[data-dpc-region="tape"]');
    await tape.locator('[data-dpc-stage="scheduled"]').click();
    await expect(tape.locator('.dpc-tape-confirm')).toContainText('Move SWP-910002 to Scheduled? It moves on the Ops Dash too. No install is booked on this job.');
  });

  test('a repair moves on the Repairs board with update_repair_stage', async ({ page }) => {
    const { root, of, writes } = await boot(page, { update_repair_stage: () => ({ success: true, repair_stage: 'scheduled' }) });
    await openJob(root, 'SWR-910003');
    const tape = root.locator('[data-dpc-region="tape"]');
    await expect(tape.locator('.dpc-tape-meta')).toContainText('Repairs stage');
    await expect(tape.locator('.dpc-tape-label')).toHaveText(['Materials', 'Scheduled']);
    await expect(tape).toContainText('Same as the Repairs board. Moving here moves the job there too.');
    await tape.locator('[data-dpc-stage="scheduled"]').click();
    await expect(tape.locator('.dpc-tape-confirm')).toContainText('Move SWR-910003 to Scheduled? It moves on the Repairs board too.');
    await tape.locator('[data-dpc-stage-go]').click();
    await expect(tape.locator('[role="status"]')).toHaveText('Moved to Scheduled.');
    expect(of('update_repair_stage').map((c) => c.body)).toEqual([{ jobId: 'job-r1', stage: 'scheduled', operator_email: expect.any(String) }]);
    expect(writes().map((c) => c.action)).toEqual(['update_repair_stage']);
  });

  test('an archived job past Scheduled cannot be moved from Dispatch', async ({ page }) => {
    const { root } = await boot(page);
    await root.locator('[data-dpc-mode="archive"]').click();
    await openJob(root, 'SWF-910009');
    const tape = root.locator('[data-dpc-region="tape"]');
    await expect(tape).toContainText('Moved past Scheduled on the Ops Dash. Dispatch does not move it from here.');
    await expect(tape.locator('[data-dpc-stage]')).toHaveCount(0);
  });

  test('the module never names the retired v1 stage writes', async () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'modules', 'ops-dispatch.js'), 'utf8');
    // Only the header comment may mention them, to say they are never called.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/set_dispatch_stage|set_dispatch_install_confirmed/);
  });
});

// ── Slice 7: the Arrival line ─────────────────────────────────────────────────

test.describe('Dispatch v2 Arrival line', () => {
  test('a thin line on the card and the full line in the open job, from dispatch_arrival', async ({ page }) => {
    const { root, of } = await boot(page, {
      dispatch_arrival: (url) => ({ job_id: url.searchParams.get('job_id'), arrival: ARRIVAL(dayFrom(10), F1_ORDERS), arrival_read: 'ok' }),
    });
    const f1 = root.locator('.dpc-job', { hasText: 'SWF-910001' });
    await expect(f1.locator('.dpc-arrthin-dot')).toHaveCount(3);
    await expect(f1.locator('.dpc-vh')).toHaveText('Arrival: 3 orders: 1 confirmed, 1 not in time.');
    // No order, no thin line.
    await expect(root.locator('.dpc-job', { hasText: 'SWP-910002' }).locator('.dpc-arrthin')).toHaveCount(0);

    const arr = root.locator('[data-dpc-region="arrival"]');
    await expect(arr.locator('.dpc-arr-title')).toHaveText('Arrival line');
    await expect(arr.locator('.dpc-arr-q')).toHaveText('Will it all be on site before the install?');
    await expect(arr.locator('.dpc-arr-count')).toHaveText('3 orders: 1 confirmed, 1 not in time');
    await expect(arr.locator('.dpc-arr-count')).toHaveClass(/late/);
    await expect(arr.locator('.dpc-arr-tod')).toHaveText(`Today ${words(PERTH_TODAY)}`);
    await expect(arr.locator('.dpc-arr-inst')).toHaveText(`Install ${words(dayFrom(10))}`);
    await expect(arr.locator('.dpc-arr-mk.ok b')).toHaveText('Metroll');
    await expect(arr.locator('.dpc-arr-mk.wait small')).toHaveText(`${words(dayFrom(6))}, not confirmed`);
    await expect(arr.locator('.dpc-arr-out b')).toHaveText('Emu Concrete');
    await expect(arr.locator('.dpc-arr-out small')).toHaveText('no date yet');
    await expect(arr.locator('.dpc-arr-legend')).toHaveText('Solid = supplier confirmed the date. Ring = date expected, not confirmed. Past the install line = no date, or arriving too late.');
    expect(of('dispatch_arrival').map((c) => c.url.searchParams.get('job_id'))).toEqual(['job-f1']);
  });

  test('a job with no order says so; a failed read falls back to the list row, else says so with Retry', async ({ page }) => {
    let down = true;
    const { root } = await boot(page, {
      // The list's own Arrival read failed for job-p1 (no row line to fall back to).
      pipeline: () => { const out = ACTIVE(); out.columns.accepted[1].board.arrival = null; return out; },
      dispatch_arrival: (url) => (down ? { status: 500, body: { error: 'e2e' } } : { job_id: url.searchParams.get('job_id'), arrival: ARRIVAL(null, []), arrival_read: 'ok' }),
    });
    const arr = root.locator('[data-dpc-region="arrival"]');
    // job-f1: the list row's own line is drawn when the read failed.
    await expect(arr.locator('.dpc-arr-count')).toHaveText('3 orders: 1 confirmed, 1 not in time');
    await openJob(root, 'SWP-910002');
    // job-p1 has no row line: the failure shows.
    await expect(arr.locator('[role="alert"]')).toContainText('Could not load the Arrival line.');
    down = false;
    await arr.locator('[data-dpc-retry="arrival"]').click();
    await expect(arr).toContainText('No supplier orders on this job yet.');
  });
});

// ── Slice 8: supplier replies and the tray ────────────────────────────────────

const EMAIL = (over) => Object.assign({
  id: 'em-1', received_at: `${PERTH_YEAR}-10-21T01:30:00+00:00`, from_email: 'orders@metroll.example', subject: 'RE: Material Order Ref SWF-910001',
  snippet: 'Delivery booked for Monday.', supplier_name: 'Metroll', state: 'matched', rung: 'thread', match_reason: null,
  job_id: 'job-f1', job_number: 'SWF-910001', order_id: 'ord-1', candidates: [], delivery_label: null, decision: null,
}, over);
const SUG = (over) => Object.assign({
  id: 'sg-1', email_id: 'em-1', label: `Delivery ${words(dayFrom(4))}`, quote: 'We can deliver Monday morning.', weekday_mismatch: false, day_word_only: true,
  other_dates: [], state: 'open', can_accept: true, needs_order_pick: false, acted_by_email: null, acted_at: null,
}, over);
const REPLIES = (emails, suggestions, extra) => Object.assign({ ok: true, job_id: 'job-f1', emails, suggestions, orders: [{ order_id: 'ord-1', supplier_name: 'Metroll', sent_at: `${PERTH_YEAR}-10-20T01:00:00+00:00` }], orders_wired: true, scan: { enabled: true } }, extra);

test.describe('Dispatch v2 supplier replies', () => {
  test('each reply shows how it was matched; Accept saves the date and a stage-move offer opens the rail confirm', async ({ page }) => {
    let accepted = false;
    const { root, of, writes } = await boot(page, {
      dispatch_v2_replies: (url) => (url.searchParams.get('job_id') !== 'job-f1' ? REPLIES([], [], { job_id: url.searchParams.get('job_id') }) : REPLIES(
        [EMAIL(), EMAIL({ id: 'em-2', rung: 'job_number', supplier_name: 'Bunnings', subject: 'Order SWF-910001', snippet: 'Thanks, order received.' }), EMAIL({ id: 'em-3', rung: 'supplier_ref', supplier_name: 'Emu Concrete', snippet: 'Our ref 4471.' })],
        [SUG({ state: accepted ? 'accepted' : 'open', acted_by_email: accepted ? 'ops@example.test' : null })],
      )),
      dispatch_v2_suggestion_accept: () => { accepted = true; return { ok: true, order: { supplier_name: 'Metroll', confirmed_delivery_date: dayFrom(4) }, stage_move_offer: { job_id: 'job-f1', from_status: 'order_materials', to_status: 'order_confirmed' } }; },
      update_job_status: () => ({ success: true }),
    });
    const rep = root.locator('[data-dpc-region="mail"]');
    // Supplier replies are in the job's one Emails panel: each on its own line
    // in the list with how it was matched, the one needing an answer open.
    await expect(rep.locator('h3')).toHaveText('Emails');
    await expect(rep.locator('.dpc-mail-list .dpc-rung')).toHaveText(['Same thread', 'Job number', 'Their number']);
    await expect(rep.locator('[data-dpc-mail-key="r:em-1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(rep.locator('[data-dpc-mail-key="r:em-1"] .dpc-mail-drafttag')).toHaveText('Date to check');
    await expect(rep.locator('.dpc-mail-view .dpc-rung')).toHaveCount(0);
    // The header notice points to the date waiting.
    const note = root.locator('.dpc-sugnote');
    await expect(note).toContainText('1 supplier delivery date to check.');
    const sug = rep.locator('[data-dpc-sug="sg-1"]');
    await expect(sug.locator('strong')).toHaveText(`Delivery ${words(dayFrom(4))}`);
    await expect(sug.locator('.dpc-sug-quote')).toHaveText('"We can deliver Monday morning."');
    await expect(sug.locator('.dpc-sug-hints')).toHaveText('The email gave only a day word, such as "Thursday" or "tomorrow".');
    await expect(sug.locator('.dpc-sug-foot')).toHaveText('Accept saves this date on the supplier box. It does not move the job.');
    expect(writes()).toEqual([]);

    await sug.locator('[data-dpc-sug-accept]').click();
    await expect(rep.locator('[role="status"]').first()).toHaveText(`Delivery date saved: Metroll, ${words(dayFrom(4))}.`);
    expect(of('dispatch_v2_suggestion_accept').map((c) => c.body)).toEqual([{ suggestion_id: 'sg-1', operator_email: expect.any(String) }]);
    // The offer only asks; nothing moved yet.
    const tape = root.locator('[data-dpc-region="tape"]');
    await expect(tape.locator('.dpc-tape-confirm')).toContainText('The supplier confirmed the delivery. Move SWF-910001 to Order Confirmed? It moves on the Ops Dash too.');
    await expect(tape.locator('[data-dpc-stage-cancel]')).toHaveText('Not now');
    expect(of('update_job_status')).toEqual([]);
    await tape.locator('[data-dpc-stage-go]').click();
    await expect(tape.locator('[role="status"]')).toHaveText('Moved to Order Confirmed.');
    expect(of('update_job_status').map((c) => c.body)).toEqual([{ jobId: 'job-f1', status: 'order_confirmed', expected_statuses: ['order_materials'], source: 'dispatch', operator_email: expect.any(String) }]);
    await expect(sug.locator('.dpc-sug-state')).toContainText('Accepted by ops@example.test');
    expect(writes().map((c) => c.action)).toEqual(['dispatch_v2_suggestion_accept', 'update_job_status']);
  });

  test('Not now on the offer moves nothing; Dismiss saves no date; a date that needs its order asks which', async ({ page }) => {
    const { root, of } = await boot(page, {
      dispatch_v2_replies: () => REPLIES([EMAIL()], [SUG(), SUG({ id: 'sg-2', label: 'Delivery Friday', needs_order_pick: true, day_word_only: false, weekday_mismatch: true, other_dates: [dayFrom(9)] })]),
      dispatch_v2_suggestion_accept: () => ({ ok: true, order: { supplier_name: 'Metroll', confirmed_delivery_date: dayFrom(4) }, stage_move_offer: { job_id: 'job-f1', from_status: 'order_materials', to_status: 'order_confirmed' } }),
      dispatch_v2_suggestion_dismiss: () => ({ ok: true }),
    });
    const rep = root.locator('[data-dpc-region="mail"]');
    const two = rep.locator('[data-dpc-sug="sg-2"]');
    await expect(two.locator('.dpc-sug-hints li')).toHaveText(['The email named a weekday that is not on this date. The date was used.', `The email also named ${words(dayFrom(9))}.`]);
    await expect(two.locator('[data-dpc-sug-accept]')).toBeDisabled();
    await two.locator('[data-dpc-sug-order]').selectOption('ord-1');
    await expect(two.locator('[data-dpc-sug-accept]')).toBeEnabled();
    await two.locator('[data-dpc-sug-dismiss]').click();
    await expect(rep).toContainText('Dismissed. No date was saved.');
    expect(of('dispatch_v2_suggestion_dismiss').map((c) => c.body.suggestion_id)).toEqual(['sg-2']);

    await rep.locator('[data-dpc-sug="sg-1"] [data-dpc-sug-accept]').click();
    const tape = root.locator('[data-dpc-region="tape"]');
    await tape.locator('[data-dpc-stage-cancel]').click();
    await expect(tape.locator('.dpc-tape-confirm')).toHaveCount(0);
    expect(of('update_job_status')).toEqual([]);
  });

  test('the order pick is sent with Accept, and a refusal is said in plain words', async ({ page }) => {
    const { root, of } = await boot(page, {
      dispatch_v2_replies: () => REPLIES([EMAIL()], [SUG({ needs_order_pick: true })]),
      dispatch_v2_suggestion_accept: () => ({ status: 409, body: { ok: false, error: 'orders not wired', code: 'orders_not_wired' } }),
    });
    const sug = root.locator('[data-dpc-sug="sg-1"]');
    await sug.locator('[data-dpc-sug-order]').selectOption('ord-1');
    await sug.locator('[data-dpc-sug-accept]').click();
    await expect(sug.locator('[role="alert"]')).toHaveText('Supplier orders are not switched on yet, so a delivery date cannot be saved.');
    expect(of('dispatch_v2_suggestion_accept').map((c) => c.body)).toEqual([{ suggestion_id: 'sg-1', order_id: 'ord-1', operator_email: expect.any(String) }]);
  });

  test('a best guess asks "Is this email about this job?" and each answer is one press', async ({ page }) => {
    const { root, of } = await boot(page, {
      dispatch_v2_replies: () => REPLIES([EMAIL({ id: 'em-g', rung: 'best_guess', state: 'needs_confirmation', match_reason: 'Same supplier, one open order' }), EMAIL({ id: 'em-h', rung: 'best_guess', state: 'needs_confirmation' })], []),
      dispatch_v2_replies_confirm_guess: () => ({ ok: true }),
      dispatch_v2_replies_reject_guess: () => ({ ok: true }),
    });
    const rep = root.locator('[data-dpc-region="mail"]');
    await expect(root.locator('.dpc-sugnote')).toContainText('2 best guess emails to confirm.');
    const g = rep.locator('[data-dpc-rep="em-g"]');
    await expect(rep.locator('[data-dpc-mail-key="r:em-g"] .dpc-rung')).toHaveText('Best guess');
    await expect(g.locator('.dpc-rep-why')).toHaveText('Same supplier, one open order');
    await expect(g.locator('.dpc-rep-ask')).toContainText('Is this email about this job?');
    await g.locator('[data-dpc-rep-confirm]').click();
    await expect(rep).toContainText('Put on this job.');
    await rep.locator('[data-dpc-mail-key="r:em-h"]').click();
    await rep.locator('[data-dpc-rep="em-h"] [data-dpc-rep-reject]').click();
    await expect(rep).toContainText('Sent back to the Unmatched supplier emails tray.');
    expect(of('dispatch_v2_replies_confirm_guess').map((c) => c.body.email_id)).toEqual(['em-g']);
    expect(of('dispatch_v2_replies_reject_guess').map((c) => c.body.email_id)).toEqual(['em-h']);
  });

  test('no email and a failed read each say so', async ({ page }) => {
    let down = true;
    const { root } = await boot(page, { dispatch_v2_replies: () => (down ? { status: 500, body: { error: 'e2e' } } : REPLIES([], [], { scan: { enabled: false } })) });
    const rep = root.locator('[data-dpc-region="mail"]');
    await expect(rep.locator('[role="alert"]')).toContainText('Could not load the supplier replies.');
    down = false;
    await rep.locator('[data-dpc-retry="replies"]').click();
    await expect(rep).toContainText('No email on this job yet. Order emails made in Materials, and supplier replies to them, show here.');
    await expect(rep).toContainText('Supplier emails are not being read yet.');
  });

  test('the tray lists unmatched emails; a candidate, a picked job and Hide are each one press', async ({ page }) => {
    let emails = [
      EMAIL({ id: 'tu-1', state: 'unmatched', rung: null, job_id: null, job_number: null, supplier_name: 'Stratco', from_email: 'tradewa@stratco.example', subject: 'Your order', candidates: [{ order_id: 'ord-9', job_id: 'job-p1', job_number: 'SWP-910002', supplier_name: 'Stratco', reason: 'open Stratco order' }] }),
      EMAIL({ id: 'tu-2', state: 'unmatched', rung: null, job_id: null, job_number: null, supplier_name: null, from_email: 'someone@example.test', subject: 'Delivery' }),
      EMAIL({ id: 'tu-3', state: 'unmatched', rung: null, job_id: null, job_number: null, supplier_name: 'Bunnings', subject: 'Statement' }),
    ];
    const { root, of } = await boot(page, {
      dispatch_v2_replies_unmatched: () => ({ ok: true, include_other: false, emails, counts: { needs_confirmation: 0, unmatched_order_desk: emails.length, unmatched_other: 0 } }),
      dispatch_v2_replies_assign: (url, body) => { emails = emails.filter((m) => m.id !== body.email_id); return { ok: true, job_number: body.job_id === 'job-p1' ? 'SWP-910002' : 'SWR-910003' }; },
      dispatch_v2_replies_hide: (url, body) => { emails = emails.filter((m) => m.id !== body.email_id); return { ok: true }; },
    });
    const btn = root.locator('[data-dpc-tray-toggle]');
    await expect(btn).toHaveText('Unmatched supplier emails 3');
    await btn.click();
    const tray = root.locator('[data-dpc-region="tray"]');
    await expect(tray.locator('h3')).toHaveText('Unmatched supplier emails');
    await expect(tray.locator('[data-dpc-tray-item]')).toHaveCount(3);
    await tray.locator('[data-dpc-tray-assign="tu-1"]').click();
    await expect(tray).toContainText('Put on SWP-910002.');
    await tray.locator('[data-dpc-tray-job="tu-2"]').selectOption('job-r1');
    await tray.locator('[data-dpc-tray-put="tu-2"]').click();
    await expect(tray).toContainText('Put on SWR-910003.');
    await tray.locator('[data-dpc-tray-hide="tu-3"]').click();
    await expect(tray).toContainText('Hide this email from the tray? It stays in admin@.');
    await tray.locator('[data-dpc-tray-hide-go="tu-3"]').click();
    await expect(tray).toContainText('Nothing to sort. Every supplier email is on a job.');
    await expect(btn).toHaveText('Unmatched supplier emails 0');
    expect(of('dispatch_v2_replies_assign').map((c) => [c.body.email_id, c.body.job_id, c.body.order_id || null])).toEqual([['tu-1', 'job-p1', 'ord-9'], ['tu-2', 'job-r1', null]]);
    expect(of('dispatch_v2_replies_hide').map((c) => c.body.email_id)).toEqual(['tu-3']);
  });
});

// ── Slice 4 (screen): the old PO board and the SMS ask ────────────────────────

const PO = (over) => Object.assign({
  po_number: 'PO-1', supplier_name: 'Metroll', status: 'draft', total: 100, line_items: [], communications: [],
  created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z', job_id: 'job-f1',
}, over);

test.describe('Dispatch v2 and the old PO board', () => {
  test('an order made in Dispatch has no Email or Approve & Send on the board, and no Push to Xero in Financials', async ({ page }) => {
    await boot(page, { list_pos: () => ({ purchase_orders: [PO({ id: 'po-d', source: 'dispatch' }), PO({ id: 'po-o', po_number: 'PO-2', supplier_name: 'Bunnings' })] }) });
    const d = page.locator('#materialsKanban .kanban-card[data-po-id="po-d"]');
    const o = page.locator('#materialsKanban .kanban-card[data-po-id="po-o"]');
    await expect(d.locator('.po-dispatch-note')).toHaveText("Made in Dispatch. Send it from the job's Dispatch tab.");
    await expect(d.locator('button[onclick*="openPOEmailCompose"]')).toHaveCount(0);
    await expect(d.locator('button[onclick*="approveAndSendPO"]')).toHaveCount(0);
    await expect(o.locator('button[onclick*="openPOEmailCompose"]')).toHaveCount(1);
    await expect(o.locator('button[onclick*="approveAndSendPO"]')).toHaveText('Approve & Send');

    await page.locator('.header-nav button[data-view="financials"]').click();
    await page.locator('#viewFinancials .sub-tab[data-sub="pos"]').click();
    await expect(page.locator('#poTableBody tr[data-po-id="po-d"]')).toContainText('Made in Dispatch');
    await expect(page.locator('#poTableBody tr[data-po-id="po-d"]')).not.toContainText('Push to Xero');
    await expect(page.locator('#poTableBody tr[data-po-id="po-o"]')).toContainText('Push to Xero');
  });

  test("the backend's dispatch_po_refused answer is shown in its own words", async ({ page }) => {
    const { of } = await boot(page, {
      list_pos: () => ({ purchase_orders: [PO({ id: 'po-o' })] }),
      push_po_to_xero: () => ({ status: 409, body: { error: 'This order was made in Dispatch. Send it from Dispatch.', code: 'dispatch_po_refused', action: 'push_po_to_xero', po_id: 'po-o' } }),
    });
    page.on('dialog', (dlg) => dlg.accept());
    await page.locator('.header-nav button[data-view="financials"]').click();
    await page.locator('#viewFinancials .sub-tab[data-sub="pos"]').click();
    await page.locator('#poTableBody tr[data-po-id="po-o"] button', { hasText: 'Push to Xero' }).click();
    await expect(page.locator('#toastContainer')).toContainText('This order was made in Dispatch. Send it from Dispatch.');
    expect(of('push_po_to_xero')).toHaveLength(1);
  });
});

// ── Phone width ───────────────────────────────────────────────────────────────

test('at 390 the list, rail, Arrival line, replies and tray have no sideways scroll', async ({ page }) => {
  const { root } = await boot(page, {
    dispatch_arrival: (url) => ({ job_id: url.searchParams.get('job_id'), arrival: ARRIVAL(dayFrom(10), F1_ORDERS), arrival_read: 'ok' }),
    dispatch_v2_replies: () => REPLIES([EMAIL(), EMAIL({ id: 'em-g', rung: 'best_guess', state: 'needs_confirmation' })], [SUG()]),
    dispatch_v2_replies_unmatched: () => ({ ok: true, emails: [EMAIL({ id: 'tu-1', state: 'unmatched', rung: null, job_id: null })], counts: { needs_confirmation: 0, unmatched_order_desk: 1 } }),
  }, { viewport: { width: 390, height: 844 } });
  await expect(root.locator('.dpc-job')).toHaveCount(3);
  await root.locator('[data-dpc-tray-toggle]').click();
  await expect(root.locator('[data-dpc-tray-item]')).toHaveCount(1);
  await root.locator('[data-dpc-region="tape"] [data-dpc-stage="awaiting_supplier"]').click();
  await expect(root.locator('.dpc-tape-confirm')).toBeVisible();
  // On a phone the labels leave the line and the orders are listed under it.
  await expect(root.locator('.dpc-arr-list li')).toHaveCount(3);
  await expect(root.locator('.dpc-arr-list')).toBeVisible();
  // Measured on the Dispatch tab itself (#dispatchRoot). The Ops header (445px
  // wide at 390) and the old PO board under the tab run wider on main too.
  const over = await page.evaluate(() => {
    const view = document.querySelector('#dispatchRoot');
    const width = document.documentElement.clientWidth;
    const past = Array.from(view.querySelectorAll('*')).filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && (b.right > width + 0.5 || b.left < -0.5);
    }).map((el) => el.className || el.tagName);
    return { scroll: view.scrollWidth - view.clientWidth, past };
  });
  expect(over.past).toEqual([]);
  expect(over.scroll).toBeLessThanOrEqual(0);
});
