// Guard for Dispatch S5, partial deliveries (modules/ops-dispatch.js, contract
// docs/dispatch-partial-deliveries-v1.md in secureworks-backend): under each
// order in Deliveries and install, "Record what arrived" opens a quantity box
// per line (the remaining quantity to start) and the day it arrived (today in
// Perth to start). Save sends one dispatch_delivery_record_receipt per line
// with a quantity; Undo sends one dispatch_delivery_void_receipt. The screen
// never works out a line's state itself: it shows what the server answers.
//
// Every read and write is stubbed by a small model of the server's rules.
// Invented job numbers, suppliers and people; no client data. Nothing here
// sends an email or a text, and nothing touches Xero.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const JOB = 'job-s5';
const PO = 'po-s5-1';
const ROW = {
  id: JOB, job_number: 'SWF-900771', type: 'fencing', work_type: 'fencing', site_suburb: 'Suburb S', client_name: 'Test Client',
  site_address: '1 Test Street', status: 'accepted', value: 1000, value_inc_gst: true, description: null,
  next_scheduled_date: null, last_scheduled_date: null, council_status: null, council_step: null, council_required: false, po_count: 1,
  updated_at: '2026-10-12T05:00:00+00:00',
  dispatch_stage: 'materials_ordered', dispatch_stage_index: 3, dispatch_stage_source: 'set', dispatch_stage_from: 'accepted',
  dispatch_stage_set_at: '2026-10-12T05:00:00+00:00', dispatch_stage_set_by: 'Test Person', dispatch_todo: true, dispatch_todo_out: null,
  dispatch_next_step: null, materials_lines_total: 2, materials_lines_ready: 0,
  deliveries_orders_total: 1, deliveries_orders_sighted: 0,
};
const S5_ROW = Object.assign({}, ROW, { deliveries_orders_on_site: 0, deliveries_lines_part_delivered: 0 });

// The server's rules for one order with two lines (dispatch_line_receipts.ts).
function model({ s5 = true } = {}) {
  const m = {
    s5,
    lines: [
      { id: 'line-panels', description: 'Colorbond panels', quantity: 42, unit: 'sheets' },
      { id: 'line-posts', description: 'Steel posts', quantity: 10, unit: 'each' },
    ],
    receipts: [],
  };
  const live = (lineId) => m.receipts.filter((r) => r.line_id === lineId && !r.voided);
  const received = (lineId) => live(lineId).reduce((sum, r) => sum + r.quantity, 0);
  m.status = (l) => {
    const got = received(l.id);
    if (got >= l.quantity) return 'delivered';
    return got > 0 ? 'part_delivered' : 'on_po';
  };
  m.projectLine = (l) => Object.assign(
    { id: l.id, supplier_id: 'sup-1', description: l.description, quantity: l.quantity, unit: l.unit, status: 'to_order', display_status: s5 ? m.status(l) : 'on_po',
      purchase_order_id: PO, source: 'manual', position: l.id === 'line-panels' ? 1 : 2, updated_at: '2026-10-12T05:00:00+00:00' },
    s5 ? { received_quantity: received(l.id), receipts: m.receipts.filter((r) => r.line_id === l.id).map((r) => Object.assign({}, r)) } : {},
  );
  m.summary = () => {
    const onSite = m.lines.every((l) => m.status(l) === 'delivered') ? 1 : 0;
    const part = m.lines.filter((l) => m.status(l) === 'part_delivered').length;
    return Object.assign({ counted: 1, sighted: 0, all_sighted: false }, s5 ? { on_site: onSite, all_on_site: onSite === 1, lines_part_delivered: part } : {});
  };
  m.counts = () => ({ total: 2, ready: m.lines.filter((l) => m.status(l) === 'delivered').length });
  m.order = { id: PO, po_number: 'PO-1000771', status: 'sent', source: 'dispatch', supplier_id: 'sup-1', in_xero: false, updated_at: '2026-10-12T05:00:00+00:00' };
  m.materials = () => ({
    job_id: JOB,
    suppliers: [{ supplier_id: 'sup-1', name: 'Supplier One', email: 'orders@supplier.example.test', order: m.order }],
    lines: m.lines.map(m.projectLine),
    counts: m.counts(),
    can_suggest: false,
    workings: { working_out: null, working_out_updated_at: null, sketch_png: null, sketch_updated_at: null },
    orders: [m.order],
    orders_status: 'ok',
    deliveries: Object.assign(m.summary(), {
      rows: [{
        kind: 'order', purchase_order_id: PO, po_number: 'PO-1000771', supplier_id: 'sup-1', supplier_name: 'Supplier One', status: 'sent',
        made_in_dispatch: true, in_xero: false, updated_at: '2026-10-12T05:00:00+00:00',
        delivery: { step: 1, expected: null, expected_editable: true, confirmed: { state: 'waiting' }, sighted: null },
      }],
    }),
  });
  m.answer = (receipt, extra) => {
    const l = m.lines.find((x) => x.id === receipt.line_id);
    const line = m.projectLine(l);
    return Object.assign({ success: true }, extra, {
      receipt,
      line: { id: l.id, purchase_order_id: PO, display_status: line.display_status, received_quantity: line.received_quantity, receipts: line.receipts },
      deliveries: m.summary(),
      counts: m.counts(),
    });
  };
  m.record = (body) => {
    const same = m.receipts.find((r) => r.id === body.client_receipt_id);
    if (same) return m.answer(same, { unchanged: true });
    const r = { id: body.client_receipt_id, line_id: body.line_id, quantity: body.quantity, received_on: body.received_on, note: null,
      recorded_at: '2026-10-15T02:00:00Z', recorded_by: 'Test Person', voided: false, voided_at: null, voided_by: null };
    m.receipts.push(r);
    return m.answer(r);
  };
  m.void = (body) => {
    const r = m.receipts.find((x) => x.id === body.receipt_id);
    if (!r) return { status: 404, body: { error: 'Receipt not found on this job', code: 'receipt_not_found' } };
    if (r.voided) return m.answer(r, { unchanged: true });
    Object.assign(r, { voided: true, voided_at: '2026-10-15T03:00:00Z', voided_by: 'Test Person' });
    return m.answer(r);
  };
  return m;
}

async function boot(page, { m, ops = {} } = {}) {
  const calls = [];
  const handlers = Object.assign({
    pipeline: () => ({ columns: { accepted: [m.s5 ? S5_ROW : ROW] }, total: 1, dispatch_stages: 'ok', todo_total: 1, dispatch_materials: 'ok', dispatch_deliveries: 'ok' }),
    job_detail: () => ({ job: { id: JOB, job_number: 'SWF-900771', type: 'fencing', scope_json: null, ghl_contact_id: null }, media: [], documents: [], invoices: [] }),
    job_notes: () => ({ job_id: JOB, total: 0, notes: [] }),
    job_story: () => ({ version: 'job-story-v1', job: {}, as_of: TODAY, now: {}, money: {}, loops: [], checks: [], timeline: [] }),
    get_job_conversation: () => ({ messages: [], summary: { count: 0, channels: {} } }),
    list_pos: () => ({ purchase_orders: [] }),
    list_suppliers: () => ({ suppliers: [{ id: 'sup-1', name: 'Supplier One', email: 'orders@supplier.example.test', is_active: true }] }),
    dispatch_materials: () => m.materials(),
    dispatch_order_emails: () => ({ job_id: JOB, drafts: [], threads: [], orders_for_link: [], threads_status: 'ok' }),
    dispatch_delivery_record_receipt: (url, body) => m.record(body),
    dispatch_delivery_void_receipt: (url, body) => m.void(body),
  }, ops);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    const fn = (/\/functions\/v1\/([a-z0-9-]+)$/.exec(url.pathname) || [])[1] || null;
    const action = url.searchParams.get('action');
    if (fn !== 'ops-api' || !action) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    calls.push({ action, method: request.method(), body });
    const out = handlers[action] ? await handlers[action](url, body) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(wrapped ? out.body : out) });
  });
  await page.goto(OPS_FILE + '#dispatch');
  const root = page.locator('#dispatchRoot');
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWF-900771 · Suburb S');
  const sched = root.locator('[data-dpc-region="sched"]');
  await expect(sched.locator('[data-dpc-deliv-row]')).toHaveCount(1);
  const writes = () => calls.filter((c) => c.method === 'POST').map((c) => c.action);
  return { calls, writes, root, sched };
}

const rail = (root) => root.locator('[data-dpc-deliv-rail]');
const chip = (root, name) => root.locator('.dpc-line-ro', { hasText: name }).locator('.dpc-status');

test('Partial deliveries: Record what arrived starts at what is still to come and today, and saves one receipt per line with a quantity', async ({ page }) => {
  const m = model();
  const { calls, writes, root, sched } = await boot(page, { m });
  await expect(rail(root)).toHaveText('0 of 1 orders sighted on site.');

  await sched.getByRole('button', { name: 'Record what arrived' }).click();
  const form = sched.locator('.dpc-recv-form');
  await expect(form.getByLabel('Quantity arrived for Colorbond panels')).toHaveValue('42');
  await expect(form.getByLabel('Quantity arrived for Steel posts')).toHaveValue('10');
  await expect(form.getByLabel('Day it arrived on PO-1000771')).toHaveValue(TODAY);
  // Opening the form writes nothing.
  expect(writes()).toEqual([]);

  // A quantity that is not a number, or a day after today, holds Save.
  const save = form.locator('[data-dpc-recv="save"]').first();
  await form.getByLabel('Quantity arrived for Colorbond panels').fill('eighteen');
  await expect(save).toBeDisabled();
  await expect(form.locator('.dpc-recv-hint')).toHaveText('Each quantity must be a number.');
  await form.getByLabel('Quantity arrived for Colorbond panels').fill('18');
  await form.getByLabel('Quantity arrived for Steel posts').fill('0');
  await expect(save).toBeEnabled();

  await save.click();
  await expect(sched.locator('.dpc-recv-form')).toHaveCount(0);
  const sent = calls.filter((c) => c.action === 'dispatch_delivery_record_receipt');
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0].body).sort()).toEqual(['client_receipt_id', 'job_id', 'line_id', 'operator_email', 'quantity', 'received_on']);
  expect(sent[0].body).toMatchObject({ job_id: JOB, line_id: 'line-panels', quantity: 18, received_on: TODAY });
  expect(sent[0].body.client_receipt_id).toMatch(UUID);

  // What the server answers: the line part delivered, the rail naming it.
  await expect(sched.locator('.dpc-recv-line', { hasText: 'Colorbond panels' }).locator('.dpc-recv-name')).toHaveText('Colorbond panels: 18 of 42 sheets received');
  await expect(chip(root, 'Colorbond panels')).toHaveText('Part delivered, 18 of 42');
  await expect(chip(root, 'Steel posts')).toHaveText('On PO');
  await expect(rail(root)).toHaveText('0 of 1 order on site; 1 line part delivered.');

  // The rest arrives: the next form starts at 24 and 10, and both lines save.
  await sched.getByRole('button', { name: 'Record what arrived' }).click();
  await expect(form.getByLabel('Quantity arrived for Colorbond panels')).toHaveValue('24');
  await expect(form.getByLabel('Quantity arrived for Steel posts')).toHaveValue('10');
  await form.locator('[data-dpc-recv="save"]').first().click();
  await expect(sched.locator('.dpc-recv-form')).toHaveCount(0);
  await expect(chip(root, 'Colorbond panels')).toHaveText('Delivered');
  await expect(chip(root, 'Steel posts')).toHaveText('Delivered');
  await expect(rail(root)).toHaveText('Every order on this job is on site. Press Materials on site to move the job.');

  // Only receipts were written: never a sighting, a line, an order or the stage.
  expect(writes()).toEqual(['dispatch_delivery_record_receipt', 'dispatch_delivery_record_receipt', 'dispatch_delivery_record_receipt']);
});

test('Partial deliveries: Undo voids one receipt and the line reads as the server answers', async ({ page }) => {
  const m = model();
  m.receipts.push({ id: '11111111-1111-4111-8111-111111111111', line_id: 'line-panels', quantity: 18, received_on: '2026-10-15', note: null,
    recorded_at: '2026-10-15T02:00:00Z', recorded_by: 'Test Person', voided: false, voided_at: null, voided_by: null });
  const { calls, writes, root, sched } = await boot(page, { m });
  await expect(chip(root, 'Colorbond panels')).toHaveText('Part delivered, 18 of 42');

  await sched.getByRole('button', { name: /^Undo 18 received on .* for Colorbond panels$/ }).click();
  await expect(chip(root, 'Colorbond panels')).toHaveText('On PO');
  await expect(sched.locator('.dpc-recv-void')).toContainText('18, undone by Test Person');
  await expect(sched.getByRole('button', { name: /^Undo / })).toHaveCount(0);
  await expect(rail(root)).toHaveText('0 of 1 orders sighted on site.');
  expect(writes()).toEqual(['dispatch_delivery_void_receipt']);
  const undo = calls.find((c) => c.action === 'dispatch_delivery_void_receipt').body;
  expect(Object.keys(undo).sort()).toEqual(['job_id', 'operator_email', 'receipt_id']);
  expect(undo).toMatchObject({ job_id: JOB, receipt_id: '11111111-1111-4111-8111-111111111111' });
});

test('Partial deliveries: a failed save keeps the form, and Retry sends the same receipt id so nothing is recorded twice', async ({ page }) => {
  const m = model();
  let fail = true;
  const { calls, root, sched } = await boot(page, {
    m,
    ops: {
      dispatch_delivery_record_receipt: (url, body) => {
        if (fail) { fail = false; return { status: 500, body: { error: 'receipt write failed', code: 'deliveries_write_failed' } }; }
        return m.record(body);
      },
    },
  });
  await sched.getByRole('button', { name: 'Record what arrived' }).click();
  const form = sched.locator('.dpc-recv-form');
  await form.getByLabel('Quantity arrived for Steel posts').fill('');
  await form.locator('[data-dpc-recv="save"]').first().click();
  await expect(form.getByRole('alert')).toHaveText('Not all of it was saved. Retry');
  await expect(form.getByLabel('Quantity arrived for Colorbond panels')).toHaveValue('42');

  await form.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(sched.locator('.dpc-recv-form')).toHaveCount(0);
  const sent = calls.filter((c) => c.action === 'dispatch_delivery_record_receipt');
  expect(sent).toHaveLength(2);
  expect(sent[1].body.client_receipt_id).toBe(sent[0].body.client_receipt_id);
  expect(m.receipts).toHaveLength(1);
  await expect(chip(root, 'Colorbond panels')).toHaveText('Delivered');
});

test('Partial deliveries: Cancel writes nothing, and a server without receipts shows no Record what arrived', async ({ page }) => {
  const s5 = await boot(page, { m: model() });
  await s5.sched.getByRole('button', { name: 'Record what arrived' }).click();
  await s5.sched.locator('[data-dpc-recv="cancel"]').click();
  await expect(s5.sched.locator('.dpc-recv-form')).toHaveCount(0);
  expect(s5.writes()).toEqual([]);

  const older = await page.context().newPage();
  const slice6 = await boot(older, { m: model({ s5: false }) });
  await expect(slice6.sched.getByRole('button', { name: 'Record what arrived' })).toHaveCount(0);
  await expect(rail(slice6.root)).toHaveText('0 of 1 orders sighted on site.');
  await expect(chip(slice6.root, 'Colorbond panels')).toHaveText('On PO');
  expect(slice6.writes()).toEqual([]);
});
