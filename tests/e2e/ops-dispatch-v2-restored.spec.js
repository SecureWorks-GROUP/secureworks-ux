// Dispatch v2 (approved build, Oct 2026): the parts of the v1 job workspace
// the approved page keeps "exactly as built", against a stubbed ops-api.
// Nothing leaves: every read and write is answered by the stub, and each
// write is checked for its exact body.
//
//  - The Working out and sketch pad, at the foot of Scope and notes, saved
//    through the v1 dispatch_materials_save_workings.
//  - The Deliveries table in "Deliveries and install": expected date,
//    confirmed date and sighted on site for each purchase order, through the
//    three v1 delivery writes.
//  - Purchase orders in Sources, read only (v2 makes no purchase orders).
//  - One Emails panel: the v2 order emails (held, TEST and sent) read only,
//    and the supplier replies thread, in the v1 list and view look.
// Supplier names, addresses and job numbers are made up.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { V2_ANSWER, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

const ROW = (over) => Object.assign({
  site_address: '12 Example Street', value: 12000, value_inc_gst: true, description: null,
  next_scheduled_date: null, last_scheduled_date: null, council_status: null, council_required: false, po_count: 0,
  dispatch_next_step: null, ghl_contact_id: null,
}, over);
const JOBS = {
  f1: ROW({ id: 'job-f1', job_number: 'SWF-930001', client_name: 'Jane Smith', site_suburb: 'Gwelup', type: 'fencing', work_type: 'fencing',
    status: 'order_materials', updated_at: '2026-10-22T05:00:00+00:00', board: { title: 'SWF-930001 · Jane Smith' } }),
  p1: ROW({ id: 'job-p1', job_number: 'SWP-930002', client_name: 'Tom Lee', site_suburb: 'Yokine', type: 'patio', work_type: 'patio',
    status: 'order_materials', updated_at: '2026-10-21T05:00:00+00:00', board: { title: 'SWP-930002 · Tom Lee' } }),
};
const ACTIVE = () => ({ columns: { accepted: [JOBS.f1, JOBS.p1].map((r) => JSON.parse(JSON.stringify(r))) }, total: 2, dispatch_materials: 'ok' });
const DETAIL = (id) => {
  const r = Object.values(JOBS).find((j) => j.id === id);
  return r ? { job: { id, job_number: r.job_number, type: r.type, scope_json: null, ghl_contact_id: null }, media: [], documents: [], invoices: [] } : { status: 404, body: { error: 'Job not found' } };
};

// The v1 materials answer for a job: its working out and its orders.
const OLD = (over) => Object.assign({
  suppliers: [], lines: [], counts: { total: 0, ready: 0 }, can_suggest: false,
  workings: { working_out: '', working_out_updated_at: null, sketch_png: null, sketch_updated_at: null },
  orders_status: 'ok', orders: [], deliveries: { rows: [], counted: 0, sighted: 0, all_sighted: false },
}, over);

// Boots Ops on Dispatch with ops-api stubbed; the first job (SWF-930001,
// fencing) opens on its own.
async function boot(page, { viewport = { width: 1440, height: 900 }, api = {}, storage = {} } = {}) {
  const calls = [];
  const handlers = Object.assign({
    pipeline: () => ACTIVE(),
    job_detail: (url) => DETAIL(url.searchParams.get('jobId')),
    job_notes: (url) => ({ job_id: url.searchParams.get('jobId'), total: 0, notes: [] }),
    list_pos: () => ({ purchase_orders: [] }),
    ...V2_EMPTY_READS,
  }, api);
  await page.setViewportSize(viewport);
  await installOpsSessionStub(page);
  if (Object.keys(storage).length) {
    await page.addInitScript((s) => { Object.keys(s).forEach((k) => { try { localStorage.setItem(k, s[k]); } catch (e) { /* none */ } }); }, storage);
  }
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
    const out = key === 'archive' ? { columns: {}, total: 0 } : handlers[key] ? await handlers[key](url, body) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    let reply = wrapped ? out.body : out;
    if (action === 'pipeline' && (!wrapped || out.status < 300)) reply = V2_ANSWER(reply, view);
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(OPS_FILE + '#dispatch');
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const root = page.locator('#dispatchRoot');
  await expect(root.locator('[data-dpc-region="v2mat"] .dpc-v2-draft')).toBeVisible();
  const of = (action) => calls.filter((c) => c.action === action);
  const writes = () => calls.filter((c) => c.method === 'POST' && /^dispatch_/.test(c.action));
  return { calls, of, root, writes };
}

// ── The working out pad ────────────────────────────────────────────────────

test.describe('Dispatch v2: the working out pad, kept from v1', () => {
  // The stub keeps the pad's text and sketch, with a stamp per save.
  function padApi(start) {
    const w = Object.assign({ working_out: '', working_out_updated_at: null, sketch_png: null, sketch_updated_at: null }, start);
    let n = 0;
    return {
      w,
      api: {
        dispatch_materials: () => OLD({ workings: Object.assign({}, w) }),
        dispatch_materials_save_workings: (url, body) => {
          n += 1;
          const at = `2026-10-23T01:00:${String(n).padStart(2, '0')}.000Z`;
          if ('working_out' in body) { w.working_out = body.working_out; w.working_out_updated_at = at; }
          if ('sketch_png' in body) { w.sketch_png = body.sketch_png; w.sketch_updated_at = at; }
          return { success: true, workings: Object.assign({}, w) };
        },
      },
    };
  }

  test('the pad sits at the foot of Scope and notes and saves when typing stops, and when it is left', async ({ page }) => {
    const pad = padApi({ working_out: '42 m run', working_out_updated_at: '2026-10-22T01:00:00.000Z' });
    const { root, of, writes } = await boot(page, { api: pad.api });
    const scope = root.locator('.dpc-sec', { has: page.locator('h3', { hasText: 'Scope and notes' }) });
    const box = scope.locator('details[data-dpc-mat-workout]');
    await expect(box.locator('summary')).toHaveText('Working out and sketch');
    // Folded shut until opened, and the fold is kept per browser.
    await expect(box).not.toHaveAttribute('open', '');
    await box.locator('summary').click();
    const text = box.locator('[data-dpc-mat-pad]');
    await expect(text).toHaveValue('42 m run');
    await expect(box.locator('[data-dpc-mat-canvas]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sw_dispatch_workout_open'))).toBe('1');
    expect(of('dispatch_materials').map((c) => c.url.searchParams.get('job_id'))).toEqual(['job-f1']);

    // Typing saves once, when it stops, against the stamp it was typed over.
    await text.fill('42 m run / 2.4 m bays = 18 bays');
    await expect(box.locator('[data-dpc-region="matsave"]')).toHaveText('All changes saved');
    expect(writes().map((c) => c.body)).toEqual([
      { job_id: 'job-f1', working_out: '42 m run / 2.4 m bays = 18 bays', expected_working_out_updated_at: '2026-10-22T01:00:00.000Z', operator_email: expect.any(String) },
    ]);
    // Leaving the pad saves at once, with the stamp of the save before.
    await text.fill('18 bays, 19 posts');
    await root.locator('.dpc-jobhead h2').click();
    await expect.poll(() => writes().length).toBe(2);
    expect(writes()[1].body).toMatchObject({ working_out: '18 bays, 19 posts', expected_working_out_updated_at: '2026-10-23T01:00:01.000Z' });
    await page.waitForTimeout(1500);
    expect(writes()).toHaveLength(2);
    // Only the pad's own write: nothing touched a v2 line, box or email.
    expect(writes().map((c) => c.action)).toEqual(['dispatch_materials_save_workings', 'dispatch_materials_save_workings']);
    expect(await box.innerText()).not.toMatch(/[–—]/);
  });

  test('a stroke on the sketch saves its picture, and Clear sketch saves it empty', async ({ page }) => {
    const pad = padApi({});
    const { root, writes } = await boot(page, { api: pad.api, storage: { sw_dispatch_workout_open: '1' } });
    const box = root.locator('details[data-dpc-mat-workout]');
    await expect(box).toHaveAttribute('open', '');
    const canvas = box.locator('[data-dpc-mat-canvas]');
    await canvas.scrollIntoViewIfNeeded();
    const b = await canvas.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, b.y + 60, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => writes().length).toBe(1);
    expect(writes()[0].body).toMatchObject({ job_id: 'job-f1', sketch_png: expect.stringMatching(/^data:image\/png;base64,/), expected_sketch_updated_at: null });
    await expect(box.locator('[data-dpc-region="matsave"]')).toHaveText('All changes saved');
    await box.locator('[data-dpc-mat-clear]').click();
    await expect.poll(() => writes().length).toBe(2);
    expect(writes()[1].body).toMatchObject({ sketch_png: null, expected_sketch_updated_at: '2026-10-23T01:00:01.000Z' });
  });

  test('a pad changed somewhere else says so and shows the latest; a failed save offers Retry', async ({ page }) => {
    const pad = padApi({ working_out: 'old', working_out_updated_at: '2026-10-22T01:00:00.000Z' });
    let refuse = 'changed';
    const api = Object.assign({}, pad.api, {
      dispatch_materials_save_workings: (url, body) => {
        if (refuse === 'changed') {
          refuse = 'down';
          pad.w.working_out = 'typed on another screen';
          pad.w.working_out_updated_at = '2026-10-23T02:00:00.000Z';
          return { status: 409, body: { error: 'The working out changed', code: 'workings_changed' } };
        }
        if (refuse === 'down') { refuse = null; return { status: 500, body: { error: 'down' } }; }
        return pad.api.dispatch_materials_save_workings(url, body);
      },
    });
    const { root, of, writes } = await boot(page, { api, storage: { sw_dispatch_workout_open: '1' } });
    const box = root.locator('details[data-dpc-mat-workout]');
    const text = box.locator('[data-dpc-mat-pad]');
    await expect(text).toHaveValue('old');
    await text.fill('mine');
    await expect(box.locator('.dpc-mat-notice')).toHaveText('This changed somewhere else. Showing the latest.');
    await expect(text).toHaveValue('typed on another screen');
    expect(of('dispatch_materials')).toHaveLength(2);
    // A save that fails says Not saved, and Retry sends it once more.
    await text.fill('mine again');
    await expect(box.locator('[data-dpc-region="matsave"]')).toContainText('Not saved.');
    await box.locator('[data-dpc-mat-retry="saves"]').click();
    await expect(box.locator('[data-dpc-region="matsave"]')).toHaveText('All changes saved');
    expect(writes().map((c) => c.body.working_out)).toEqual(['mine', 'mine again', 'mine again']);
  });

  test('a failed read says so with Retry, never an empty pad', async ({ page }) => {
    let down = true;
    const { root, of } = await boot(page, {
      storage: { sw_dispatch_workout_open: '1' },
      api: { dispatch_materials: () => (down ? { status: 500, body: { error: 'down' } } : OLD({ workings: { working_out: 'back', working_out_updated_at: null, sketch_png: null, sketch_updated_at: null } })) },
    });
    const box = root.locator('details[data-dpc-mat-workout]');
    await expect(box.locator('[role="alert"]')).toContainText('Could not load the working out.');
    await expect(box.locator('[data-dpc-mat-pad]')).toHaveCount(0);
    down = false;
    await box.locator('[data-dpc-mat-retry="read"]').click();
    await expect(box.locator('[data-dpc-mat-pad]')).toHaveValue('back');
    expect(of('dispatch_materials')).toHaveLength(2);
  });
});

// ── The Emails panel: v2 order emails and supplier replies together ────────

// A v2 materials answer with two supplier boxes: Acacia holds an email whose
// TEST copy went, Banksia's email was sent.
const SID = (n) => `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MAIL = (over) => Object.assign({
  id: 'mail-1', supplier_id: SID(1), supplier_name: 'Acacia Steel Pty Ltd', status: 'draft', from: 'admin@secureworkswa.com.au',
  to: ['orders@acacia.example'], cc: ['tony@acacia.example', 'fencing@secureworkswa.com.au'], team_cc: 'fencing@secureworkswa.com.au',
  subject: 'Material Order Ref SWF-930001', body_text: 'Hi Acacia,\n\n14 x Colorbond panels\n\nThanks', edited: false,
  delivery_date: '2026-10-28', line_count: 1, photo_ids: [], empty_detail_lines: [], test: null, sent: null, last_error: null,
  updated_at: '2026-10-23T01:00:00.000Z',
}, over);
const BOX = (n, name, over) => Object.assign({
  supplier_id: SID(n), name, active: true, position: n, is_main: false,
  approved_email: { id: `ap-${n}`, name, used_for: 'fencing', to: ['orders@example.test'], cc: [] },
  send_blocked: null, lines: [], photos: [], open_email: null, sent_emails: [],
}, over);
const MATERIALS = (url) => ({
  job_id: url.searchParams.get('job_id'), job_number: 'SWF-930001', work_type: 'fencing', team_cc: { email: 'fencing@secureworkswa.com.au', open_question: null },
  from: 'admin@secureworkswa.com.au', test_send_done: true, main_supplier_id: null, main_supplier_ticked: false, can_suggest: false,
  draft_list: { lines: [], photos: [] },
  suppliers: url.searchParams.get('job_id') !== 'job-f1' ? [] : [
    BOX(1, 'Acacia Steel Pty Ltd', { open_email: MAIL({ test: { sent_at: '2026-10-23T01:05:00.000Z', sent_to: 'admin@secureworkswa.com.au', sent_by_email: 'shaun@secureworkswa.com.au' } }) }),
    BOX(2, 'Banksia Roofing', { sent_emails: [MAIL({ id: 'mail-2', supplier_id: SID(2), supplier_name: 'Banksia Roofing', status: 'sent', subject: 'Material Order Ref SWF-930001 (Banksia)',
      to: ['sales@banksia.example'], cc: [], body_text: 'Hi Banksia,\n\n6 x roof sheets', line_count: 2, photo_ids: ['p1'],
      sent: { sent_at: '2026-10-20T02:00:00.000Z', sent_by_email: 'shaun@secureworkswa.com.au', from: 'admin@secureworkswa.com.au', to: ['sales@banksia.example'], cc: [] } })] }),
  ],
});
const REPLY = (over) => Object.assign({
  id: 'em-1', received_at: '2026-10-21T01:30:00+00:00', from_email: 'sales@banksia.example', subject: 'RE: Material Order Ref SWF-930001 (Banksia)',
  snippet: 'We can deliver Monday.', supplier_name: 'Banksia Roofing', state: 'matched', rung: 'thread', match_reason: null,
  job_id: 'job-f1', job_number: 'SWF-930001', order_id: 'ord-1', candidates: [], delivery_label: null, decision: null,
}, over);
const REPLIES = (url) => ({
  ok: true, job_id: url.searchParams.get('job_id'), orders_wired: true, scan: { enabled: true },
  orders: [{ order_id: 'ord-1', supplier_name: 'Banksia Roofing', sent_at: '2026-10-20T02:00:00.000Z' }],
  emails: url.searchParams.get('job_id') !== 'job-f1' ? [] : [REPLY()],
  suggestions: url.searchParams.get('job_id') !== 'job-f1' ? [] : [{ id: 'sg-1', email_id: 'em-1', label: 'Delivery Monday 27 October', quote: 'We can deliver Monday.',
    weekday_mismatch: false, day_word_only: true, other_dates: [], state: 'open', can_accept: true, needs_order_pick: false, acted_by_email: null, acted_at: null }],
});

test.describe('Dispatch v2: one Emails panel for order emails and supplier replies', () => {
  test('lists the held, test-sent and sent order emails read only, with the replies, and sends nothing', async ({ page }) => {
    const { root, calls } = await boot(page, { api: { dispatch_v2_materials: MATERIALS, dispatch_v2_replies: REPLIES } });
    const mail = root.locator('[data-dpc-region="mail"]');
    await expect(mail.locator('h3')).toHaveText('Emails');
    await expect(mail.locator('.dpc-eyebrow')).toHaveText('Send');
    // Held first, then the rest newest first.
    const items = mail.locator('.dpc-mail-item');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Acacia Steel Pty Ltd');
    await expect(items.nth(0).locator('.dpc-mail-drafttag')).toHaveText('Held');
    await expect(items.nth(0)).toContainText('Held, test sent');
    await expect(items.nth(1)).toContainText('RE: Material Order Ref SWF-930001 (Banksia)');
    await expect(items.nth(1).locator('.dpc-rung')).toHaveText('Same thread');
    await expect(items.nth(2)).toContainText('Banksia Roofing');
    await expect(items.nth(2)).toContainText('Sent');
    // The reply with a date to check opens first, with Accept and Dismiss.
    const view = mail.locator('.dpc-mail-view');
    await expect(items.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(view.locator('[data-dpc-sug="sg-1"] [data-dpc-sug-accept]')).toBeEnabled();

    // The held email, read only: no send, edit or discard here.
    await items.nth(0).click();
    await expect(view.locator('.dpc-mail-head strong')).toHaveText('Order email to Acacia Steel Pty Ltd');
    await expect(view).toContainText('Held, nothing sent yet. Check it and send it in Materials.');
    await expect(view.locator('.dpc-field')).toHaveText([
      'Fromadmin@secureworkswa.com.au', 'Toorders@acacia.example', 'CCtony@acacia.example, fencing@secureworkswa.com.au', 'SubjectMaterial Order Ref SWF-930001',
    ]);
    await expect(view).toContainText('Test copy sent to admin@secureworkswa.com.au');
    await expect(view.locator('.dpc-v2-pre')).toContainText('14 x Colorbond panels');
    await expect(view.locator('input, textarea, [data-dpc-v2]')).toHaveCount(0);
    // Edit and send goes to the email in its Materials box.
    await view.locator('[data-dpc-mail-goto]').click();
    await expect(root.locator(`[data-dpc-v2-box="${SID(1)}"] [data-dpc-v2-mf="subject"]`)).toBeFocused();

    // The sent email.
    await items.nth(2).click();
    await expect(view.locator('.dpc-mail-head strong')).toHaveText('Order email to Banksia Roofing');
    await expect(view).toContainText('by shaun@secureworkswa.com.au');
    await expect(view).toContainText('2 lines, 1 photo, delivery asked for Wed 28/10.');
    await expect(view.locator('[data-dpc-mail-goto]')).toHaveText('Show in Materials');
    // No v1 purchase order email wording for v2 orders.
    expect(await mail.innerText()).not.toMatch(/purchase order|\bPO\b|Draft ready to send|Link to PO|Send reply/i);
    expect(await mail.innerText()).not.toMatch(/[–—]/);
    expect(calls.filter((c) => c.method === 'POST' && c.action !== 'operator_heartbeat')).toEqual([]);
    expect(calls.filter((c) => c.action === 'dispatch_order_emails')).toEqual([]);
  });

  test('Show in Emails opens the panel on the reply with a date to check', async ({ page }) => {
    const { root } = await boot(page, { api: { dispatch_v2_materials: MATERIALS, dispatch_v2_replies: REPLIES }, storage: { sw_dispatch_mail_open: '0' } });
    const mail = root.locator('[data-dpc-region="mail"]');
    await expect(root.locator('.dpc-sugnote [data-dpc-rep-goto]')).toBeVisible();
    await expect(mail.locator('.dpc-mail')).toHaveCount(0);
    await root.locator('.dpc-sugnote [data-dpc-rep-goto]').click();
    await expect(mail.locator('[data-dpc-mail-key="r:em-1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(mail.locator('.dpc-mail-view [data-dpc-sug-accept]')).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('sw_dispatch_mail_open'))).toBe('1');
  });
});

// ── Deliveries and install: the v1 table, kept ─────────────────────────────

// One purchase order made outside Dispatch on SWF-930001, and a v1
// "not ordered yet" row, which v2 leaves out (a v2 box is ordered by email).
const PO_ROW = (over) => Object.assign({
  kind: 'order', purchase_order_id: 'po-1', po_number: 'PO-3001', supplier_name: 'Plain Hardware', made_in_dispatch: false, status: 'sent',
  updated_at: '2026-10-22T03:00:00.000Z',
  delivery: { step: 1, expected: '2026-10-27', expected_editable: true, confirmed: { state: 'waiting', date: null, by_hand: false, set_by: null, set_at: null }, sighted: null },
}, over);
const ARRIVAL = (orders) => ({
  job_id: 'job-f1', install: null, installs: [], arrival_read: 'ok',
  arrival: { today: '2026-10-23', install_day: '2026-10-30', orders, counts: { orders: orders.length, sent: 1, confirmed: 0, late: 0 }, all_confirmed_in_time: false },
});
const BOX_ORDER = { key: `box:${SID(2)}`, source: 'supplier_box', supplier_id: SID(2), supplier_name: 'Banksia Roofing', order_sent: true, sent_at: '2026-10-20T02:00:00Z',
  delivery_date: '2026-10-28', date_source: 'requested', date_confirmed: false, mark: 'ring', flag: null };
const PO_ORDER = { key: 'po:po-1', source: 'other_order', supplier_id: null, supplier_name: 'Plain Hardware', order_sent: true, sent_at: null,
  delivery_date: '2026-10-27', date_source: 'order', date_confirmed: false, mark: 'ring', flag: null };

// The stub keeps the order's delivery block, as dispatch_deliveries.ts answers.
function delivApi() {
  const row = PO_ROW();
  let n = 0;
  const stamp = () => { n += 1; return `2026-10-23T02:00:${String(n).padStart(2, '0')}.000Z`; };
  const answer = () => ({ success: true, order: { id: 'po-1', updated_at: row.updated_at, status: row.status, delivery: JSON.parse(JSON.stringify(row.delivery)) },
    deliveries: { counted: 1, sighted: row.delivery.sighted ? 1 : 0, all_sighted: !!row.delivery.sighted } });
  return {
    row,
    api: {
      pipeline: () => ({ columns: { accepted: [Object.assign({}, JOBS.f1, { deliveries_orders_total: 1, deliveries_orders_sighted: 0 }), JOBS.p1] }, total: 2, dispatch_materials: 'ok', dispatch_deliveries: 'ok' }),
      dispatch_materials: (url) => (url.searchParams.get('job_id') !== 'job-f1' ? OLD() : OLD({
        orders: [{ id: 'po-1', po_number: 'PO-3001', supplier_name: 'Plain Hardware', status: 'sent', lines: [] }],
        deliveries: { rows: [JSON.parse(JSON.stringify(row)), { kind: 'not_ordered', supplier_id: SID(2), supplier_name: 'Banksia Roofing' }], counted: 1, sighted: row.delivery.sighted ? 1 : 0, all_sighted: false },
      })),
      dispatch_arrival: (url) => (url.searchParams.get('job_id') !== 'job-f1' ? ARRIVAL([]) : ARRIVAL([BOX_ORDER, Object.assign({}, PO_ORDER, { delivery_date: row.delivery.expected })])),
      dispatch_delivery_set_expected: (url, body) => {
        if (body.expected_updated_at !== row.updated_at) return { status: 409, body: { error: 'changed', code: 'order_changed' } };
        row.delivery.expected = body.delivery_date; row.updated_at = stamp(); return answer();
      },
      dispatch_delivery_set_confirmed: (url, body) => {
        if (body.expected_updated_at !== row.updated_at) return { status: 409, body: { error: 'changed', code: 'order_changed' } };
        row.delivery.confirmed = body.confirmed_delivery_date
          ? { state: 'date', date: body.confirmed_delivery_date, by_hand: true, set_by: 'Shaun', set_at: '2026-10-23T02:00:00.000Z' }
          : { state: 'waiting', date: null, by_hand: false, set_by: null, set_at: null };
        row.delivery.step = body.confirmed_delivery_date ? 2 : 1;
        row.updated_at = stamp(); return answer();
      },
      dispatch_delivery_mark_sighted: (url, body) => {
        if (body.expected_updated_at !== row.updated_at) return { status: 409, body: { error: 'changed', code: 'order_changed' } };
        row.delivery.sighted = body.sighted ? { at: '2026-10-23T03:00:00.000Z', by: 'Shaun' } : null;
        row.delivery.step = body.sighted ? 3 : 2;
        row.updated_at = stamp(); return answer();
      },
    },
  };
}

test.describe('Dispatch v2: Deliveries and install, kept from v1', () => {
  test('a purchase order records its expected date, confirmed date and sighting, each once, and the Arrival line is read again', async ({ page }) => {
    const dv = delivApi();
    const { root, of, writes } = await boot(page, { api: dv.api });
    const sched = root.locator('[data-dpc-region="sched"]');
    await expect(sched.locator('h3')).toHaveText('Deliveries and install');
    const po = sched.locator('[data-dpc-deliv-row="po-1"]');
    await expect(po).toContainText('Plain Hardware');
    await expect(po).toContainText('PO-3001 · Made outside Dispatch');
    // v1's "not ordered yet" rows are left out.
    await expect(sched).not.toContainText('Not ordered yet');
    await expect(sched.locator('[data-dpc-deliv-expected="po-1"]')).toHaveValue('2026-10-27');
    await expect(root.locator('[data-dpc-deliv-rail]')).toHaveText('0 of 1 orders sighted on site.');
    const arrivalReads = of('dispatch_arrival').length;

    // The expected date: saved when the box is left.
    await sched.locator('[data-dpc-deliv-expected="po-1"]').fill('2026-10-29');
    await sched.locator('h3').click();
    await expect.poll(() => writes().length).toBe(1);
    expect(writes()[0]).toMatchObject({ action: 'dispatch_delivery_set_expected', body: { purchase_order_id: 'po-1', expected_updated_at: '2026-10-22T03:00:00.000Z', delivery_date: '2026-10-29' } });
    await expect.poll(() => of('dispatch_arrival').length).toBe(arrivalReads + 1);
    await expect(sched.locator('[data-dpc-deliv-expected="po-1"]')).toHaveValue('2026-10-29');

    // The confirmed date, by hand: opening the line sends nothing.
    await po.locator('[data-dpc-deliv-confirm]').click();
    expect(writes()).toHaveLength(1);
    await sched.locator('[data-dpc-deliv-edit-date]').fill('2026-10-30');
    await sched.locator('[data-dpc-deliv-edit="save"]').click();
    await expect(po).toContainText('Set by Shaun');
    expect(writes()[1]).toMatchObject({ action: 'dispatch_delivery_set_confirmed', body: { purchase_order_id: 'po-1', expected_updated_at: '2026-10-23T02:00:01.000Z', confirmed_delivery_date: '2026-10-30', via: 'deliveries' } });

    // Mark sighted, then the rail line counts it.
    await po.locator('[data-dpc-deliv-sight]').click();
    await expect(po.locator('[data-dpc-deliv-unsight="ask"]')).toBeVisible();
    expect(writes()[2]).toMatchObject({ action: 'dispatch_delivery_mark_sighted', body: { purchase_order_id: 'po-1', sighted: true } });
    await expect(root.locator('[data-dpc-deliv-rail]')).toHaveText('Every order on this job is sighted on site.');
    // Not sighted asks first; Keep sends nothing.
    await po.locator('[data-dpc-deliv-unsight="ask"]').click();
    await sched.locator('[data-dpc-deliv-unsight="keep"]').click();
    expect(writes()).toHaveLength(3);
    expect(writes().map((c) => c.action)).toEqual(['dispatch_delivery_set_expected', 'dispatch_delivery_set_confirmed', 'dispatch_delivery_mark_sighted']);
    expect(await sched.innerText()).not.toMatch(/[–—]/);
  });

  test('the boxes ordered by email are listed read only, with where their date came from', async ({ page }) => {
    const dv = delivApi();
    const { root } = await boot(page, { api: dv.api });
    const sched = root.locator('[data-dpc-region="sched"]');
    const box = sched.locator(`[data-dpc-deliv-box="${SID(2)}"]`);
    await expect(box).toContainText('Banksia Roofing');
    await expect(box).toContainText('Order email sent');
    await expect(box).toContainText('Asked for in our email');
    await expect(box).toContainText('Waiting on supplier');
    await expect(box).toContainText('Not recorded here');
    await expect(box.locator('input, button')).toHaveCount(0);
    await expect(sched.locator('.dpc-deliv-boxnote')).toHaveText('Orders sent by email from Materials take their dates from supplier replies (Accept in Emails). A date or a sighting cannot be set by hand on them yet.');
  });

  test('an order changed somewhere else says so and shows the latest; a failed read offers Retry', async ({ page }) => {
    const dv = delivApi();
    let down = false;
    const api = Object.assign({}, dv.api, {
      dispatch_materials: (url, body) => (down ? { status: 500, body: { error: 'down' } } : dv.api.dispatch_materials(url, body)),
    });
    const { root, of } = await boot(page, { api });
    const sched = root.locator('[data-dpc-region="sched"]');
    await expect(sched.locator('[data-dpc-deliv-row="po-1"]')).toBeVisible();
    dv.row.updated_at = '2026-10-23T09:00:00.000Z';
    await sched.locator('[data-dpc-deliv-sight="po-1"]').click();
    await expect(sched.locator('.dpc-deliv-msg')).toHaveText('This order changed somewhere else. Showing the latest.');
    await expect.poll(() => of('dispatch_materials').length).toBe(2);

    down = true;
    await root.locator('.dpc-job', { hasText: 'SWP-930002' }).click();
    await expect(sched.locator('[role="alert"]')).toContainText('Could not load the deliveries.');
    down = false;
    await sched.locator('[data-dpc-deliv-retry="read"]').click();
    await expect(sched).toContainText('No orders on this job yet. Orders sent from Materials show here with their delivery dates.');
  });
});
