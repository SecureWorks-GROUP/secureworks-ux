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
