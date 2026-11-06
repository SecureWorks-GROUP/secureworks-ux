// Trade invoicing fix 4 (6 Nov 2026), weekly invoice group section:
// - a crew member the office removed from a group is never offered Join; a
//   plain line says so, from a newer server's read or an older server's join
//   refusal;
// - each group shows once, in the group section with its one hours form; a
//   group job's card in the job list only links to it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const settle = () => new Promise((r) => setImmediate(r));
const REMOVED = 'The office removed you from this group. Ask the office if this is wrong.';

function loadCore() {
  const box = {};
  vm.runInNewContext(fs.readFileSync('shared/group-work-order.js', 'utf8') + '\nthis.GroupWorkOrderCore = GroupWorkOrderCore;', box);
  return box.GroupWorkOrderCore;
}

function harness(handlers) {
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
  window.GroupWorkOrderCore = loadCore();
  const g = window.GroupWorkOrderInvoice;
  const calls = [];
  const toasts = [];
  g.use((action, params, body) => {
    calls.push({ action, body });
    const fn = handlers[action];
    return fn ? fn(body) : Promise.reject(new Error('unexpected ' + action));
  }, () => {}, 'user-1', { toast: (m, e) => toasts.push([m, e]) });
  return { g, calls, toasts };
}

// Like trade.html's api(): a 403 carries the generic access_denied code and
// the server's own code only in the answer body.
function refusal(status, code, message, onBody) {
  const err = new Error(message);
  err.status = status;
  err.body = { code, error: message };
  err.code = onBody ? 'access_denied' : code;
  return err;
}

const base = { group_id: 'group-a', job_id: 'job-a', job_number: 'JOB-A', client_name: 'Client', site_suburb: 'Suburb' };
// What a server returns for a crew member who is not on the group.
const outsider = (discovery, awaiting) => ({ ...base, discovery, awaiting, pot_total: null, my_share: null, needs_hours: true, client_signed: null, group_share_office_review_required: true });

async function loaded(groups, handlers = {}) {
  const h = harness({ my_group_work_orders: () => Promise.resolve({ groups }), ...handlers });
  h.g.load();
  await settle();
  return h;
}

test('a newer server that names the removal: a plain line, no Join, no hours, no sign-off', async () => {
  for (const discovery of [
    { state: 'setup_required', reason: 'removed_by_office', message: 'Server words.' },
    { state: 'removed' },
  ]) {
    const h = await loaded([outsider(discovery, 'awaiting_office')]);
    const html = h.g.html([]);
    assert.ok(html.includes(REMOVED), 'the plain removal line shows');
    assert.match(html, /data-group-removed/);
    assert.match(html, /Removed by office/);
    assert.doesNotMatch(html, /Join group work order|data-invoice-group-join/);
    assert.doesNotMatch(html, /data-group-hours-form|data-group-sign-open|Your share/);
  }
  const flagged = await loaded([{ ...outsider({ state: 'join' }, 'needs_join'), removed_by_office: true }]);
  assert.ok(flagged.g.html([]).includes(REMOVED));
  assert.doesNotMatch(flagged.g.html([]), /data-invoice-group-join/);
});

test('an older server still offers Join; its removal refusal replaces the button with the line', async () => {
  for (const onBody of [false, true]) {
    const h = await loaded([outsider({ state: 'join' }, 'needs_join')], {
      join_group_work_order: () => Promise.reject(refusal(onBody ? 403 : 409, 'group_member_removed', 'The office removed you from this group.', onBody)),
    });
    assert.match(h.g.html([]), /data-invoice-group-join/);
    h.g.join('group-a');
    await settle();
    const html = h.g.html([]);
    assert.ok(html.includes(REMOVED));
    assert.doesNotMatch(html, /data-invoice-group-join/);
    assert.deepEqual(h.toasts, [], 'the line says it; no error toast on top');
    h.g.join('group-a');
    await settle();
    assert.equal(h.calls.filter((c) => c.action === 'join_group_work_order').length, 1, 'no second join is sent');
  }
});

test('any other join refusal keeps Join and says why', async () => {
  const h = await loaded([outsider({ state: 'join' }, 'needs_join')], {
    join_group_work_order: () => Promise.reject(refusal(409, 'group_split_frozen', 'This group’s pay is frozen.')),
  });
  h.g.join('group-a');
  await settle();
  assert.match(h.g.html([]), /data-invoice-group-join/);
  assert.deepEqual(h.toasts, [['This group’s pay is frozen.', true]]);
});

test('a non-member the server holds for the office sees the server reason, never a sign-off button', async () => {
  const h = await loaded([outsider({ state: 'setup_required', reason: 'paid_by_hours', message: 'You are paid by the hour on this job.' }, 'awaiting_office')]);
  const html = h.g.html([]);
  assert.match(html, /data-group-not-member/);
  assert.match(html, /You are paid by the hour on this job\./);
  assert.doesNotMatch(html, /data-group-sign-open|data-group-hours-form|Already finalised/);
});

test('a group job shows its one hours form in the group section; its job card only links there', async () => {
  const member = { ...base, discovery: { state: 'member' }, awaiting: 'needs_hours', crew_hours: [{ name: 'Me', me: true, hours: 0 }] };
  const h = await loaded([member]);
  const section = h.g.html(['job-a']);
  const card = h.g.jobCardHtml({ job_id: 'job-a', job_number: 'JOB-A' }, '<div data-group-mode></div>');
  assert.equal((section.match(/data-group-hours-form=/g) || []).length, 1, 'the section holds the one hours form');
  assert.match(section, /data-invoice-group="group-a"/);
  assert.doesNotMatch(card, /data-group-hours-form|data-group-sign-open|data-invoice-group="/);
  assert.match(card, /data-invoice-group-goto="group-a"/);
  assert.match(card, /Go to the group work order/);
  assert.match(card, /data-group-mode/);
});

test('job page: the shared core never offers Join to a removed member', () => {
  const core = loadCore();
  const removed = { enabled: true, group_id: 'group-a', participant: false, discovery: { state: 'setup_required', reason: 'removed_by_office' } };
  assert.equal(core.tradeMode(removed), 'removed');
  const html = core.tradeHtml('removed', removed);
  assert.ok(html.includes(REMOVED));
  assert.doesNotMatch(html, /data-group-wo-action/);
  assert.equal(core.tradeMode({ enabled: true, group_id: 'group-a', discovery: { state: 'join' } }), 'join');
  assert.equal(core.removalRefusal(refusal(409, 'group_member_removed', 'x')), true);
  assert.equal(core.removalRefusal(refusal(403, 'removed_by_office', 'x', true)), true);
  assert.equal(core.removalRefusal(refusal(409, 'group_split_frozen', 'x')), false);
});
