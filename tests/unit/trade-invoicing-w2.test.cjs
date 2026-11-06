// Weekly invoice group section: a failed group read holds only the group jobs,
// group-paid jobs are named with their next step, and a member logs their own
// hours from the invoice through the same group hours action as the job page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const settle = () => new Promise((r) => setImmediate(r));

function loadInvoiceModule() {
  const document = {
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return { setAttribute() {}, appendChild() {} }; },
    head: { appendChild() {} },
    body: { appendChild() {} },
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync('modules/trade-group-invoice.js', 'utf8'), {
    window, document, Promise, Error, Number, String, Object, Array, Math, Date, Intl, isNaN, isFinite, setTimeout,
  });
  const core = {};
  vm.runInNewContext(fs.readFileSync('shared/group-work-order.js', 'utf8') + '\nthis.GroupWorkOrderCore = GroupWorkOrderCore;', core);
  window.GroupWorkOrderCore = core.GroupWorkOrderCore;
  return window.GroupWorkOrderInvoice;
}

function harness(handlers) {
  const g = loadInvoiceModule();
  const calls = [];
  let changes = 0;
  const toasts = [];
  g.use((action, params, body) => {
    calls.push({ action, body });
    const fn = handlers[action];
    return fn ? fn(body) : Promise.reject(new Error('unexpected ' + action));
  }, () => { changes++; }, 'user-1', { toast: (m, e) => toasts.push([m, e]) });
  return { g, calls, toasts, get changes() { return changes; } };
}

const member = {
  group_id: 'group-a', job_id: 'job-a', job_number: 'JOB-A', client_name: 'Client', site_suburb: 'Suburb',
  awaiting: 'needs_hours', crew_hours: [{ name: 'Me', me: true, hours: 0 }], pay_basis: 'all_in_12_v2',
};

test('a failed group read lets ordinary jobs through and only the group section retries', async () => {
  const h = harness({ my_group_work_orders: () => Promise.reject(new Error('down')) });
  h.g.load();
  await settle();
  assert.equal(h.g.routesReady(), false);
  assert.equal(h.g.routesSettled(), true);
  assert.equal(h.g.readFailed(), true);
  assert.equal(h.g.ready(), true, 'submit is not held by a failed group read');
  assert.deepEqual(Array.from(h.g.items()), [], 'no group share rides on the invoice while unread');
  const html = h.g.html([]);
  assert.match(html, /data-group-read-failed/);
  assert.match(html, /Your other jobs can still be invoiced/);
  assert.match(html, /data-group-retry/);
  assert.doesNotMatch(html, /Retry before submitting/);
});

test('a share selected before the read failed is not submitted', async () => {
  let fail = false;
  const frozen = { ...member, awaiting: 'frozen', client_signed: true, my_share: 100, pay_basis: 'legacy' };
  const h = harness({ my_group_work_orders: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve({ groups: [frozen] })) });
  h.g.load();
  await settle();
  h.g.select('group-a', true);
  assert.equal(h.g.items().length, 1);
  fail = true;
  h.g.load(true);
  await settle();
  assert.deepEqual(Array.from(h.g.items()), []);
});

test('jobs my_hours says are paid through a group are never hours cards and show the next step', async () => {
  const h = harness({ my_group_work_orders: () => Promise.resolve({ groups: [], payable_routes: [] }) });
  h.g.setRouteJobs([
    { job_id: 'job-b', job_number: 'JOB-B', route: 'group_setup_required', next_step: 'Create the crew group for this job, then add your hours to it.', discovery: { state: 'create' } },
    { job_id: 'job-c', job_number: 'JOB-C', route: 'group_setup_required', next_step: 'The office needs to approve the job work order before the crew group can be set up.' },
  ]);
  assert.equal(h.g.isGroupJob('job-b'), true);
  assert.equal(h.g.isGroupJob('job-z'), false);
  h.g.load();
  await settle();
  const html = h.g.html([]);
  assert.match(html, /data-group-route-job="job-b"/);
  assert.match(html, /Create the crew group for this job/);
  assert.match(html, /data-invoice-group-create="job-b"/);
  assert.match(html, /The office needs to approve the job work order/);
  assert.doesNotMatch(html.split('data-group-route-job="job-c"')[1], /data-invoice-group-create/);
});

test('the create button on a listed group job uses the existing create action', async () => {
  const h = harness({
    my_group_work_orders: () => Promise.resolve({ groups: [], payable_routes: [] }),
    create_group_work_order: () => Promise.resolve({ ok: true }),
  });
  h.g.setRouteJobs([{ job_id: 'job-b', job_number: 'JOB-B', route: 'group_setup_required', discovery: { state: 'create' } }]);
  h.g.load();
  await settle();
  h.g.create('job-b');
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find((c) => c.action === 'create_group_work_order'))), { action: 'create_group_work_order', body: { job_id: 'job-b' } });
});

test('a member gets an hours box on the invoice, with booked days as quick picks', async () => {
  const h = harness({ my_group_work_orders: () => Promise.resolve({ groups: [member] }) });
  h.g.setRouteJobs([{ job_id: 'job-a', route: 'group', group_id: 'group-a', booked_dates: ['2026-11-03', '2026-11-04'] }]);
  h.g.load();
  await settle();
  const html = h.g.html([]);
  assert.match(html, /data-group-hours-form="group-a"/);
  assert.match(html, /data-group-hours-day="2026-11-03"/);
  assert.match(html, /data-group-hours-day="2026-11-04"/);
  assert.match(html, /Any day you worked on this job/);
  assert.doesNotMatch(html, /Add your hours before your share can be calculated/);
});

test('no hours box once the shares are finalised or before joining', async () => {
  for (const awaiting of ['frozen', 'needs_join', 'awaiting_office']) {
    const h = harness({ my_group_work_orders: () => Promise.resolve({ groups: [{ ...member, awaiting }] }) });
    h.g.load();
    await settle();
    assert.doesNotMatch(h.g.html([]), /data-group-hours-form/, awaiting);
  }
});

test('saving hours sends any day through submit_group_work_order_hours and reloads', async () => {
  let reads = 0;
  const h = harness({
    my_group_work_orders: () => { reads++; return Promise.resolve({ groups: [member] }); },
    submit_group_work_order_hours: () => Promise.resolve({ ok: true, group_id: 'group-a' }),
  });
  h.g.load();
  await settle();
  // A day that is not booked is fine: members log any day on the job.
  h.g.hoursInput('group-a', 'work_date', '2026-11-07');
  h.g.hoursInput('group-a', 'start_time', '07:00');
  h.g.hoursInput('group-a', 'finish_time', '15:30');
  h.g.hoursInput('group-a', 'break_minutes', '30');
  h.g.saveHours('group-a');
  h.g.saveHours('group-a');
  await settle();
  await settle();
  const saves = h.calls.filter((c) => c.action === 'submit_group_work_order_hours');
  assert.equal(saves.length, 1, 'a double tap saves once');
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].body)), { group_id: 'group-a', work_date: '2026-11-07', start_time: '07:00', finish_time: '15:30', break_minutes: 30 });
  assert.equal(reads, 2, 'the group is read again after a save');
  const html = h.g.html([]);
  assert.match(html, /data-group-hours-saved/);
  assert.match(html, /value=""/);
});

test('a failed save keeps the typed times and shows the reason', async () => {
  const h = harness({
    my_group_work_orders: () => Promise.resolve({ groups: [member] }),
    submit_group_work_order_hours: () => Promise.reject(new Error('The group shares are already finalised, so hours cannot change.')),
  });
  h.g.load();
  await settle();
  h.g.hoursInput('group-a', 'work_date', '2026-11-05');
  h.g.hoursInput('group-a', 'start_time', '06:45');
  h.g.hoursInput('group-a', 'finish_time', '14:15');
  h.g.saveHours('group-a');
  await settle();
  const html = h.g.html([]);
  assert.match(html, /data-group-hours-error/);
  assert.match(html, /already finalised/);
  assert.match(html, /value="2026-11-05"/);
  assert.match(html, /value="06:45"/);
  assert.match(html, /value="14:15"/);
});

test('missing times are refused before any call', async () => {
  const h = harness({ my_group_work_orders: () => Promise.resolve({ groups: [member] }) });
  h.g.load();
  await settle();
  h.g.hoursInput('group-a', 'work_date', '2026-11-05');
  h.g.saveHours('group-a');
  await settle();
  assert.equal(h.calls.filter((c) => c.action === 'submit_group_work_order_hours').length, 0);
  assert.match(h.g.html([]), /Enter the date, the start and the finish/);
});

test('trade words: no developer phrases on the invoice group screens', async () => {
  const h = harness({ my_group_work_orders: () => Promise.resolve({ groups: [{ ...member, pot_total: 1000 }], payable_routes: [{ job_id: 'job-h', route: 'hours' }] }) });
  h.g.load();
  await settle();
  const html = h.g.html([]) + h.g.routeHtml({ job_id: 'job-h', job_type: 'patio' }) + h.g.savedEntriesHtml([{ work_date: '2026-11-03' }]);
  assert.doesNotMatch(html, /invoice route|ordinary pay|Saved draft entries|hourly invoice lines|pool \$/i);
  assert.match(html, /crew total \$1,000\.00/);
  assert.match(html, /Paid by the hour on this invoice/);
});

// Job page: a failed "Save hours" keeps the typed times and shows why.
function jobPage(submit) {
  let click;
  const calls = [];
  const msg = {};
  const inputs = {
    '[data-group-wo-date]': { value: '2026-11-05' },
    '[data-group-wo-start]': { value: '07:00' },
    '[data-group-wo-finish]': { value: '15:00' },
    '[data-group-wo-break]': { value: '' },
  };
  const slot = {
    attrs: { 'data-group-wo-slot': 'job', 'data-group-id': 'group' }, innerHTML: 'FORM',
    getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; },
    querySelector(k) { return inputs[k] || (k === '[data-group-wo-msg]' ? msg : null); },
  };
  const document = { addEventListener(_, fn) { click = fn; }, querySelectorAll() { return [slot]; }, getElementById() { return {}; }, createElement() { return {}; }, head: { appendChild() {} } };
  const window = {};
  const ctx = { window, document, Promise, Error, Number, String, isFinite, Math };
  vm.runInNewContext(fs.readFileSync('shared/group-work-order.js', 'utf8') + '\nwindow.GroupWorkOrderCore = GroupWorkOrderCore;', ctx);
  vm.runInNewContext(fs.readFileSync('modules/trade-group-work-order.js', 'utf8'), ctx);
  window.GroupWorkOrderTrade.use((action, params, body) => { calls.push({ action, body }); return submit(action, body); });
  const btn = { disabled: false, getAttribute() { return 'save-hours'; }, closest() { return slot; } };
  return { slot, msg, calls, btn, press() { click({ target: { closest() { return btn; } } }); } };
}

test('job page: a failed hours save keeps the inputs and shows the reason', async () => {
  const p = jobPage(() => Promise.reject(new Error('Someone else on the crew is saving right now. Try again in a moment.')));
  p.press();
  await settle();
  assert.equal(p.slot.innerHTML, 'FORM', 'the form is not wiped');
  assert.match(p.msg.textContent, /Try again in a moment/);
  assert.equal(p.btn.disabled, false);
});

test('job page: a second tap while saving sends nothing', async () => {
  let resolve;
  const p = jobPage(() => new Promise((r) => { resolve = r; }));
  p.press();
  p.press();
  assert.equal(p.calls.length, 1);
  resolve({ ok: true, group_id: 'group' });
  await settle();
});
