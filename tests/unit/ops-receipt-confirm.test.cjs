// cl-receipt-ownjob: the office confirm for a receipt sent by someone not booked
// on its job. Made-up ZZTEST ids and amounts only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, waiting, money } = require('../../modules/ops-receipt-confirm.js');

const marked = (extra = {}) => ({
  id: 'ZZTEST-r1', status: 'pending', unbooked_job_id: 'ZZTEST-job', job_id: 'ZZTEST-job',
  vendor_name: 'ZZTEST supplier', total_amount: 80, receipt_date: '2026-11-16',
  created_at: '2026-11-16T01:00:00Z', jobs: { job_number: 'ZZTEST-01' }, ...extra,
});

function fixture(byStatus = { pending: [marked()], queried: [] }) {
  const root = { hidden: true, innerHTML: '', addEventListener() {} };
  const calls = [];
  const host = {
    visible: () => true, identity: () => 'ZZTEST-office',
    read: async (action, params) => { calls.push({ action, params }); return { expenses: byStatus[params.status] || [] }; },
    post: async (action, body) => { calls.push({ action, body }); return { success: true, status: body.intent || 'approved' }; },
  };
  const api = create(host);
  api.mount(root);
  return { root, calls, host, api };
}
const posts = (f) => f.calls.filter((c) => c.body);

test('only marked receipts the office has not confirmed are listed, with the mark', async () => {
  const f = fixture({
    pending: [marked(), marked({ id: 'ZZTEST-plain', unbooked_job_id: null })],
    queried: [marked({ id: 'ZZTEST-q', status: 'queried' })],
  });
  await f.api.refresh();
  assert.equal(f.root.hidden, false);
  assert.match(f.root.innerHTML, /Receipts to confirm/);
  assert.equal((f.root.innerHTML.match(/data-rc-mark/g) || []).length, 2);
  assert.match(f.root.innerHTML, /Not booked on this job/);
  assert.doesNotMatch(f.root.innerHTML, /ZZTEST-plain/);
  assert.deepEqual(f.calls.map((c) => c.params.status), ['pending', 'queried']);
  assert.deepEqual(
    [marked(), marked({ status: 'approved' }), marked({ status: 'pushed_to_xero' }), marked({ status: 'rejected' }), marked({ unbooked_job_id: null })].map(waiting),
    [true, false, false, false, false],
  );
});

test('nothing waiting hides the section; a failed read shows an error, never an empty list', async () => {
  const empty = fixture({ pending: [], queried: [] });
  await empty.api.refresh();
  assert.equal(empty.root.hidden, true);
  const broken = fixture();
  broken.host.read = async () => { throw Object.assign(new Error('down'), { status: 503 }); };
  await broken.api.refresh();
  assert.equal(broken.root.hidden, false);
  assert.match(broken.root.innerHTML, /Could not load the receipts/);
  assert.doesNotMatch(broken.root.innerHTML, /No receipt is waiting/);
});

test('approve takes a second deliberate press and sends confirm_unbooked true once', async () => {
  const f = fixture();
  await f.api.refresh();
  await f.api.press('ZZTEST-r1', 'confirm');
  assert.equal(posts(f).length, 0, 'no confirm without the first press');
  await f.api.press('ZZTEST-r1', 'approve');
  assert.equal(posts(f).length, 0, 'the first press only asks');
  assert.match(f.root.innerHTML, /Yes, approve on job ZZTEST-01/);
  assert.match(f.root.innerHTML, /not booked on job ZZTEST-01/);
  await f.api.press('ZZTEST-r1', 'confirm');
  assert.deepEqual(posts(f), [{ action: 'approve_expense', body: { expense_id: 'ZZTEST-r1', confirm_unbooked: true } }]);
  assert.match(f.root.innerHTML, /Approved on job ZZTEST-01\./);
  await f.api.press('ZZTEST-r1', 'confirm');
  assert.equal(posts(f).length, 1, 'a finished row is never sent again');
});

test('cancel leaves the receipt unchanged', async () => {
  const f = fixture();
  await f.api.refresh();
  await f.api.press('ZZTEST-r1', 'approve');
  await f.api.press('ZZTEST-r1', 'cancel');
  await f.api.press('ZZTEST-r1', 'confirm');
  assert.equal(posts(f).length, 0);
});

test('query and send back need a reason and no confirm', async () => {
  const f = fixture();
  await f.api.refresh();
  await f.api.press('ZZTEST-r1', 'query');
  await f.api.press('ZZTEST-r1', 'query_send', 'no');
  assert.equal(posts(f).length, 0, 'a too-short reason is not sent');
  await f.api.press('ZZTEST-r1', 'query_send', 'Which job was this for?');
  assert.deepEqual(posts(f)[0].body, { expense_id: 'ZZTEST-r1', intent: 'queried', query_reason: 'Which job was this for?' });
  const g = fixture();
  await g.api.refresh();
  await g.api.press('ZZTEST-r1', 'reject');
  await g.api.press('ZZTEST-r1', 'reject_send', 'Not our job');
  assert.deepEqual(posts(g)[0].body, { expense_id: 'ZZTEST-r1', intent: 'rejected', rejection_reason: 'Not our job' });
});

test('a server refusal shows the server words, never a machine code, and is not retried', async () => {
  for (const [body, words] of [
    [{ error: 'expense_unbooked_confirm_needed', message: 'The person who sent this receipt is not booked on its job. Check the job, then confirm to approve.', userMessage: 'The person who sent this receipt is not booked on its job. Check the job, then confirm to approve.' },
      'The person who sent this receipt is not booked on its job. Check the job, then confirm to approve.'],
    [{ error: 'The receipt changed. Reload it and try again.' }, 'The receipt changed. Reload it and try again.'],
    [{ error: 'some_code' }, 'The office could not save this. Reload the list and check the receipt before trying again.'],
  ]) {
    const f = fixture();
    await f.api.refresh();
    f.host.post = async (action, b) => { f.calls.push({ action, body: b }); throw Object.assign(new Error('x'), { status: 409, body }); };
    await f.api.press('ZZTEST-r1', 'approve');
    await f.api.press('ZZTEST-r1', 'confirm');
    assert.ok(f.root.innerHTML.includes(words.replace(/'/g, '&#39;')), words);
    assert.doesNotMatch(f.root.innerHTML, /some_code|expense_unbooked/);
    await f.api.press('ZZTEST-r1', 'confirm');
    assert.equal(posts(f).length, 1);
    assert.match(f.root.innerHTML, /Reload the list/);
  }
});

test('an answer that does not confirm approval is not shown as approved', async () => {
  const f = fixture();
  await f.api.refresh();
  f.host.post = async (action, body) => { f.calls.push({ action, body }); return { success: true, status: 'queried' }; };
  await f.api.press('ZZTEST-r1', 'approve');
  await f.api.press('ZZTEST-r1', 'confirm');
  assert.doesNotMatch(f.root.innerHTML, /Approved on job/);
});

test('the page reads only when Matching opens, on login and on Reload: no timer', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const src = fs.readFileSync(require.resolve('../../modules/ops-receipt-confirm.js'), 'utf8');
  const reads = [];
  const handlers = {};
  let observer = null;
  const classes = new Set();
  const view = { classList: { contains: (c) => classes.has(c) } };
  const root = { hidden: true, innerHTML: '', addEventListener() {} };
  const timers = [];
  const window = {
    SECUREWORKS_CLOUD: {
      auth: { isLoggedIn: () => true, getRole: () => 'ops_manager', getUser: () => ({ id: 'ZZTEST-office' }) },
      on: (name, fn) => { handlers[name] = fn; },
    },
    opsFetch: async (action, params) => { reads.push(params.status); return { expenses: [] }; },
    opsPost: async () => ({}),
  };
  const document = {
    readyState: 'complete',
    getElementById: (id) => (id === 'viewRecon' ? view : id === 'receiptConfirmRoot' ? root : null),
    createElement: () => ({}),
    head: { appendChild() {} },
    addEventListener: (name) => { throw new Error('unexpected document listener ' + name); },
  };
  const ctx = {
    window, document,
    MutationObserver: function (fn) { observer = fn; this.observe = () => {}; },
    setInterval: (...a) => { timers.push(a); return 1; },
    setTimeout: (...a) => { timers.push(a); return 1; },
    clearInterval() {}, Promise, Date, Number, String, Array, Object, isFinite, JSON,
  };
  vm.runInNewContext(src, ctx);
  const settle = () => new Promise((r) => setImmediate(r));
  await settle();
  assert.equal(reads.length, 0, 'nothing read while Matching is closed');
  classes.add('active'); observer(); await settle();
  assert.deepEqual(reads, ['pending', 'queried'], 'opening Matching reads once');
  observer(); observer(); await settle();
  assert.equal(reads.length, 2, 'other class changes while open read nothing');
  handlers['auth:login'](); await settle();
  assert.equal(reads.length, 4, 'login reads again');
  classes.delete('active'); observer(); await settle();
  classes.add('active'); observer(); await settle();
  assert.equal(reads.length, 6, 'reopening Matching reads again');
  assert.equal(timers.length, 0, 'no timer is ever set');
});

test('an amount not read never shows as $0.00; a missing job number is named', async () => {
  assert.deepEqual(
    [null, undefined, true, false, '', '  ', 'abc', {}, 0, '0', 12.5, '80'].map(money),
    ['Amount not read', 'Amount not read', 'Amount not read', 'Amount not read', 'Amount not read', 'Amount not read',
      'Amount not read', 'Amount not read', '$0.00', '$0.00', '$12.50', '$80.00'],
  );
  const f = fixture({ pending: [marked({ total_amount: null, jobs: { job_number: null } })], queried: [] });
  await f.api.refresh();
  assert.match(f.root.innerHTML, /ZZTEST supplier, Amount not read/);
  assert.doesNotMatch(f.root.innerHTML, /\$0\.00/);
  assert.match(f.root.innerHTML, /Job number not available/);
  await f.api.press('ZZTEST-r1', 'approve');
  assert.match(f.root.innerHTML, /Yes, approve on job number not available/);
  await f.api.press('ZZTEST-r1', 'confirm');
  assert.match(f.root.innerHTML, /Approved on job number not available\./);
});

test('a full page of unmarked receipts shows the overflow notice, never a hidden box', async () => {
  const plain = Array.from({ length: 200 }, (_, i) => marked({ id: 'ZZTEST-p' + i, unbooked_job_id: null }));
  const f = fixture({ pending: plain, queried: [] });
  await f.api.refresh();
  assert.equal(f.root.hidden, false);
  assert.match(f.root.innerHTML, /More receipts may be waiting than this list shows/);
  assert.doesNotMatch(f.root.innerHTML, /No receipt is waiting/);
});
