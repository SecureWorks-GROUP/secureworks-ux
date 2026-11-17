// Dispatch v2 Book install (item 4, picture approved by Shaun 16 Nov 2026),
// against a stubbed ops-api that keeps its own booking the way the backend
// contract section 3h says (secureworks-backend feat/dispatch-book-install).
// Nothing leaves: every read and press is answered by the stub, and each
// press is checked for its exact body.
//
//  - Not booked: Book install with the earliest install day beside it; the
//    form opens with that day filled in, the Calendar's crew list, several
//    helpers, days and a note; Book as tentative is one press.
//  - Booked: the days, the crew and a Tentative chip, with Confirm (asks
//    first, then texts the crew), Move (every day together) and Remove.
//  - The screen never sends a job stage move, a Calendar booking call or a
//    text of its own: only the five dispatch_v2_install actions.
// The job, the client and the crew are made up.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { PERTH_TODAY, V2_ANSWER, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const JOB_ID = 'job-bi1';
const JOB_NUMBER = 'SWF-940001';
const HENRY = 'aa000000-0000-4000-8000-000000000001';
const JAN = 'aa000000-0000-4000-8000-000000000002';
const HUGO = 'aa000000-0000-4000-8000-000000000003';
const USERS = [
  { id: HENRY, name: 'Henry', email: 'henry@crew.test', role: 'lead_installer', phone: '+61400000001' },
  { id: JAN, name: 'Jan', email: 'jan@crew.test', role: 'installer', phone: '+61400000002' },
  { id: HUGO, name: 'Hugo', email: 'hugo@crew.test', role: 'installer', phone: '+61400000003' },
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const add = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dow = (day) => new Date(day + 'T00:00:00Z').getUTCDay();
// The next given weekday at least a week out.
const nextDow = (want) => { let d = add(PERTH_TODAY, 7); while (dow(d) !== want) d = add(d, 1); return d; };
const words = (day) => { const d = new Date(day + 'T00:00:00Z'); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const FRI = nextDow(5);
const MON_AFTER = add(FRI, 3);
const NO_DASH = /[–—]/;

// The backend's booking, kept in memory: book / confirm / move / remove.
function fakeInstall() {
  const fake = { rows: [], fail: {} };
  const view = () => {
    if (!fake.rows.length) return { job_id: JOB_ID, booked: false, state: 'none', days: [], first_day: null, last_day: null, people: [], booking_ids: [], booked_at: null };
    const days = [...new Set(fake.rows.map((r) => r.day))].sort();
    const people = [];
    fake.rows.forEach((r) => { if (!people.some((p) => p.user_id === r.user_id)) people.push({ user_id: r.user_id, name: r.name, role: r.role, days: [] }); });
    const conf = fake.rows.filter((r) => r.confirmed).length;
    return {
      job_id: JOB_ID, booked: true, state: conf === 0 ? 'tentative' : conf === fake.rows.length ? 'confirmed' : 'mixed',
      days, first_day: days[0], last_day: days[days.length - 1], people, booking_ids: fake.rows.map((r) => r.id), booked_at: '2026-11-16T06:10:00.000Z',
    };
  };
  const forced = (action) => { const q = fake.fail[action]; return q && q.length ? q.shift() : null; };
  const working = (first, n) => { const out = []; let d = first; while (out.length < n) { if (dow(d) !== 0 && dow(d) !== 6) out.push(d); d = add(d, 1); } return out; };
  let n = 0;
  fake.api = {
    dispatch_v2_install: () => ({ install: view() }),
    dispatch_v2_install_book: (url, b) => {
      const f = forced('dispatch_v2_install_book'); if (f) return f;
      const days = working(b.first_day, b.days || 1);
      [b.lead].concat(b.helpers || []).forEach((p, i) => days.forEach((day) => fake.rows.push({ id: 'row-' + (++n), user_id: p.user_id, name: p.name, role: i ? 'helper' : 'lead_installer', day, confirmed: false })));
      return { success: true, booked_days: days, rows_created: fake.rows.length, texted: [], job_status_changed: false, install: view() };
    },
    dispatch_v2_install_confirm: () => {
      const f = forced('dispatch_v2_install_confirm'); if (f) return f;
      fake.rows.forEach((r) => { r.confirmed = true; });
      const names = [...new Set(fake.rows.map((r) => r.name))];
      return { success: true, confirmed: fake.rows.length, failed: [], texted: names, no_phone: [], text_failed: [], client_texted: false, job_status_changed: false, install: view() };
    },
    dispatch_v2_install_move: (url, b) => {
      const was = view().first_day;
      const offset = (Date.parse(b.new_start) - Date.parse(was)) / 86400000;
      const back = fake.rows.filter((r) => r.confirmed).length;
      fake.rows.forEach((r) => { r.day = add(r.day, offset); r.confirmed = false; });
      return { success: true, changed: true, from: null, to: null, back_to_tentative: back, texted: [], job_status_changed: false, install: view() };
    },
    dispatch_v2_install_remove: () => {
      const removed = fake.rows.length;
      fake.rows = [];
      return { success: true, removed, failed: [], texted: [], job_status_changed: false, install: view() };
    },
    list_users: () => ({ users: USERS }),
  };
  fake.boardInstall = () => {
    const v = view();
    return v.booked
      ? { booked: true, day: v.first_day, first_day: v.first_day, last_day: v.last_day, archive_on: null, passed: false, tentative: v.state === 'tentative' }
      : { booked: false, day: null, first_day: null, last_day: null, archive_on: null, passed: false, tentative: false };
  };
  return fake;
}

async function boot(page, fake) {
  const calls = [];
  const row = () => ({
    id: JOB_ID, job_number: JOB_NUMBER, client_name: 'Example Client', site_suburb: 'Testville', type: 'fencing', work_type: 'fencing',
    status: 'order_confirmed', updated_at: '2026-11-16T05:00:00+00:00', site_address: '1 Test Street', value: 9000, value_inc_gst: true, description: 'Colorbond fence',
    next_scheduled_date: null, last_scheduled_date: null, po_count: 0, dispatch_next_step: null, ghl_contact_id: null,
    board: { title: JOB_NUMBER + ' · Example Client', install: fake.boardInstall() },
  });
  const handlers = Object.assign({}, V2_EMPTY_READS, {
    pipeline: () => ({ columns: { accepted: [row()] }, total: 1, dispatch_materials: 'ok' }),
    job_detail: () => ({ job: { id: JOB_ID, job_number: JOB_NUMBER, type: 'fencing', scope_json: null, ghl_contact_id: null }, media: [], documents: [], invoices: [] }),
    job_notes: () => ({ job_id: JOB_ID, total: 0, notes: [] }),
    list_pos: () => ({ purchase_orders: [] }),
    // The Arrival read: the earliest install Dispatch works out (a Friday).
    dispatch_arrival: () => ({
      job_id: JOB_ID, install: null, installs: [], arrival_read: 'ok',
      arrival: { today: PERTH_TODAY, install_day: null, orders: [], counts: { orders: 0, sent: 0, confirmed: 0, late: 0 }, all_confirmed_in_time: false, earliest_install: { day: FRI } },
    }),
  }, fake.api);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    const action = /\/functions\/v1\/ops-api$/.test(url.pathname) ? url.searchParams.get('action') : null;
    // A ghl-proxy send (an SMS or email) is recorded; its profile read is not.
    if (/ghl-proxy/.test(url.pathname) && /send/i.test(url.searchParams.get('action') || '')) calls.push({ action: 'ghl-proxy', method: request.method(), url, body: null });
    if (!action) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    calls.push({ action, method: request.method(), url, body });
    const view = url.searchParams.get('view') || 'active';
    const out = action === 'pipeline' && view === 'archive' ? { columns: {}, total: 0 } : handlers[action] ? await handlers[action](url, body) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    let reply = wrapped ? out.body : out;
    if (action === 'pipeline') reply = V2_ANSWER(reply, view);
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(OPS_FILE + '#dispatch');
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const root = page.locator('#dispatchRoot');
  await root.locator('.dpc-job', { hasText: JOB_NUMBER }).click();
  await expect(root.locator('.dpc-jobhead h2')).toContainText(JOB_NUMBER);
  const bi = root.locator('.dpc-bi');
  const of = (action) => calls.filter((c) => c.action === action);
  // Every press the screen made that could change a booking, a job or send.
  const risky = () => calls.filter((c) => /^(create_assignment|update_assignment|delete_assignment|confirm_assignment|bulk_confirm|reschedule_job_bookings|update_job_status|update_repair_stage|send_sms|ghl-proxy)$/.test(c.action));
  return { calls, of, root, bi, risky };
}

const sent = (c) => { const b = Object.assign({}, c.body); delete b.operator_email; return b; };

test.describe('Dispatch v2 Book install', () => {
  test('not booked: Book install with the earliest day; the form books tentative in one press', async ({ page }) => {
    const fake = fakeInstall();
    const { bi, of, risky } = await boot(page, fake);
    await expect(bi).toContainText(`Earliest install: ${words(FRI)} (the working day after the last delivery)`);
    await bi.locator('[data-dpc-bi="book"]').click();
    const form = bi.locator('.dpc-bi-form');
    await expect(form).toContainText('Tentative, nobody is texted');
    await expect(form.locator('[data-dpc-bi-field="first"]')).toHaveValue(FRI);
    await expect(form.locator('[data-dpc-bi-field="days"]')).toHaveValue('1');
    // Book stays off until a lead is picked.
    await expect(form.locator('[data-dpc-bi="book-go"]')).toBeDisabled();
    await form.locator('[data-dpc-bi-field="lead"]').selectOption(HENRY);
    // The lead is not offered again as a helper.
    await expect(form.locator('.dpc-bi-helper')).toHaveText(['Hugo', 'Jan']);
    await form.locator(`[data-dpc-bi-field="helper"][value="${JAN}"]`).check();
    await form.locator('[data-dpc-bi-field="days"]').fill('2');
    await form.locator('[data-dpc-bi-field="days"]').dispatchEvent('change');
    // Two working days from a Friday: Friday and the Monday after.
    await expect(form).toContainText(`weekends skipped: ${words(FRI)}, ${words(MON_AFTER)}`);
    await form.locator('[data-dpc-bi-field="note"]').fill('Colorbond 1.8m, side gate');
    await form.locator('[data-dpc-bi="book-go"]').click();

    await expect(bi.locator('.dpc-bi-booked')).toContainText(`${words(FRI)} to ${words(MON_AFTER)} (2 days)`);
    await expect(bi.locator('.dpc-bi-line')).toContainText('Henry, Jan');
    await expect(bi.locator('.dpc-bi-chip')).toHaveText('Tentative');
    await expect(bi.locator('[data-dpc-bi="confirm"]')).toHaveText('Confirm (texts crew)');
    await expect(bi.locator('[data-dpc-bi="move"]')).toBeVisible();
    await expect(bi.locator('[data-dpc-bi="remove"]')).toBeVisible();
    await expect(bi).toContainText('Nobody was texted.');
    expect(of('dispatch_v2_install_book').map(sent)).toEqual([{
      job_id: JOB_ID, first_day: FRI, days: 2,
      lead: { user_id: HENRY, name: 'Henry' }, helpers: [{ user_id: JAN, name: 'Jan' }], note: 'Colorbond 1.8m, side gate',
    }]);
    expect(risky()).toEqual([]);
    expect(await bi.innerText()).not.toMatch(NO_DASH);
  });

  test('Confirm asks first, then confirms once and names who was texted', async ({ page }) => {
    const fake = fakeInstall();
    fake.rows.push({ id: 'r1', user_id: HENRY, name: 'Henry', role: 'lead_installer', day: FRI, confirmed: false });
    fake.rows.push({ id: 'r2', user_id: JAN, name: 'Jan', role: 'helper', day: FRI, confirmed: false });
    const { bi, of, risky } = await boot(page, fake);
    await bi.locator('[data-dpc-bi="confirm"]').click();
    await expect(bi.locator('.dpc-bi-ask')).toHaveText('Confirm the install and text Henry and Jan "New job assigned"? The client is not texted.');
    expect(of('dispatch_v2_install_confirm')).toHaveLength(0);
    await bi.locator('[data-dpc-bi="confirm-go"]').click();
    await expect(bi.locator('.dpc-bi-chip')).toHaveText('Confirmed');
    await expect(bi).toContainText('Confirmed. Texted "New job assigned": Henry, Jan.');
    await expect(bi.locator('[data-dpc-bi="confirm"]')).toHaveCount(0);
    expect(of('dispatch_v2_install_confirm').map(sent)).toEqual([{ job_id: JOB_ID }]);
    expect(risky()).toEqual([]);
  });

  test('Cancel on the Confirm question sends nothing', async ({ page }) => {
    const fake = fakeInstall();
    fake.rows.push({ id: 'r1', user_id: HENRY, name: 'Henry', role: 'lead_installer', day: FRI, confirmed: false });
    const { bi, of } = await boot(page, fake);
    await bi.locator('[data-dpc-bi="confirm"]').click();
    await bi.locator('[data-dpc-bi="ask-no"]').click();
    await expect(bi.locator('[data-dpc-bi="confirm"]')).toBeVisible();
    expect(of('dispatch_v2_install_confirm')).toHaveLength(0);
  });

  test('Move shifts every day together; a confirmed booking says it went back to Tentative', async ({ page }) => {
    const fake = fakeInstall();
    fake.rows.push({ id: 'r1', user_id: HENRY, name: 'Henry', role: 'lead_installer', day: FRI, confirmed: true });
    fake.rows.push({ id: 'r2', user_id: HENRY, name: 'Henry', role: 'lead_installer', day: MON_AFTER, confirmed: true });
    const { bi, of, risky } = await boot(page, fake);
    await expect(bi.locator('.dpc-bi-chip')).toHaveText('Confirmed');
    await bi.locator('[data-dpc-bi="move"]').click();
    const input = bi.locator('[data-dpc-bi-field="move-first"]');
    await expect(input).toHaveValue(FRI);
    await expect(bi).toContainText('Every day and every person moves together. Nobody is texted. A confirmed booking goes back to Tentative');
    // The same day is not a move.
    await expect(bi.locator('[data-dpc-bi="move-go"]')).toBeDisabled();
    const NEXT_FRI = add(FRI, 7);
    await input.fill(NEXT_FRI);
    await input.dispatchEvent('change');
    await bi.locator('[data-dpc-bi="move-go"]').click();
    await expect(bi.locator('.dpc-bi-chip')).toHaveText('Tentative');
    await expect(bi.locator('.dpc-bi-line')).toContainText(`${words(NEXT_FRI)} to ${words(add(MON_AFTER, 7))} (2 days)`);
    await expect(bi).toContainText('Back to Tentative: press Confirm to text the crew the new days.');
    expect(of('dispatch_v2_install_move').map(sent)).toEqual([{ job_id: JOB_ID, new_start: NEXT_FRI }]);
    expect(risky()).toEqual([]);
  });

  test('Remove asks first, then takes the install off and offers Book install again', async ({ page }) => {
    const fake = fakeInstall();
    fake.rows.push({ id: 'r1', user_id: HENRY, name: 'Henry', role: 'lead_installer', day: FRI, confirmed: false });
    const { bi, of, risky } = await boot(page, fake);
    await bi.locator('[data-dpc-bi="remove"]').click();
    await expect(bi.locator('.dpc-bi-ask')).toHaveText('Remove every day of this install from the Calendar? Nobody is texted.');
    await bi.locator('[data-dpc-bi="remove-go"]').click();
    await expect(bi.locator('[data-dpc-bi="book"]')).toBeVisible();
    await expect(bi).toContainText('Install removed. Nobody was texted.');
    expect(of('dispatch_v2_install_remove').map(sent)).toEqual([{ job_id: JOB_ID }]);
    expect(risky()).toEqual([]);
  });

  test('a refused booking says why, reads the booking again and keeps the reason on screen', async ({ page }) => {
    const fake = fakeInstall();
    fake.fail.dispatch_v2_install_book = [{ status: 409, body: { error: 'This job already has an install booked. Move or Remove it first.', code: 'already_booked' } }];
    const { bi, of } = await boot(page, fake);
    await bi.locator('[data-dpc-bi="book"]').click();
    await bi.locator('[data-dpc-bi-field="lead"]').selectOption(HENRY);
    await bi.locator('[data-dpc-bi="book-go"]').click();
    await expect(bi.locator('.dpc-bi-err')).toHaveText('Not saved: This job already has an install booked. Move or Remove it first.');
    // The booking is read again after the refusal, and the reason stays.
    await expect.poll(() => of('dispatch_v2_install').length).toBeGreaterThan(1);
    await expect(bi.locator('[data-dpc-bi="book"]')).toBeVisible();
    await expect(bi.locator('.dpc-bi-err')).toHaveText('Not saved: This job already has an install booked. Move or Remove it first.');
  });
});
