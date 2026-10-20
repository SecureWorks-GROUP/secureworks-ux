// Rules test for the Matching screen (modules/ops-recon.js). Runs in the PR gate
// (npm run test:recon, part of test:e2e). Loads the module in a bare VM and checks the pure
// ReconCore: the tab flag, the action each choice records (confirm only for a suggested job on
// a message, correct for any job on an invoice), the body sent (the hash shown, the cause shown,
// never a person), where escalate goes, refusals in words, and that the module file carries no
// long dash and no emoji.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const FILE = 'modules/ops-recon.js';
const src = fs.readFileSync(FILE, 'utf8');
let failed = 0;
function check(name, fn) {
  try { fn(); } catch (e) { failed += 1; console.error('FAIL recon: ' + name + '\n  ' + e.message); }
}
const ctx = {
  document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {}, readyState: 'complete' },
  window: {}, localStorage: { getItem: () => null }, opsFetch: async () => ({}), opsPost: async () => ({}), showToast() {},
  console, Date, Math, Number, String, Object, Array, JSON, Promise, setTimeout,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const C0 = ctx.ReconCore;
if (!C0) { console.error('FAIL recon: ReconCore missing'); process.exit(1); }
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const C = new Proxy(C0, { get: (o, k) => (typeof o[k] === 'function' ? (...a) => plain(o[k](...a)) : o[k]) });

const JOB_A = { job_id: 'aaaaaaaa-0000-4000-8000-000000000001', job_number: 'SWF-1001', suburb: 'Sampleton', status: 'accepted', live: true };
const JOB_B = { job_id: 'bbbbbbbb-0000-4000-8000-000000000002', job_number: 'SWP-2002', suburb: null, status: 'complete', live: false };
const invoice = { band: 1, subject_kind: 'invoice', subject_id: 'iiiiiiii-0000-4000-8000-000000000001', evidence_hash: '0123456789abcdef0123456789abcdef', cause: 'ambiguity:invoice_no_job', offered_jobs: [JOB_A], other_jobs: [] };
const message = { band: 3, subject_kind: 'event', subject_id: 'eeeeeeee-0000-4000-8000-000000000001', evidence_hash: 'fedcba9876543210fedcba9876543210', cause: 'ambiguity:several_candidates', offered_jobs: [JOB_A], other_jobs: [JOB_B] };
const owing = Object.assign({}, message, { band: 2 });

check('the core sits between its sentinels', () => {
  assert(src.indexOf('// <recon-core>') >= 0 && src.indexOf('// </recon-core>') > src.indexOf('// <recon-core>'));
});
check('no long dash, no en dash and no emoji anywhere in the module', () => {
  src.split('\n').forEach((line, i) => {
    assert(!/[–—]/.test(line), 'dash on line ' + (i + 1));
    assert(!/\p{Extended_Pictographic}/u.test(line), 'emoji on line ' + (i + 1));
  });
});
check('the tab shows only with ?recon=1 or the browser flag', () => {
  assert.strictEqual(C.tabVisible('', null), false);
  assert.strictEqual(C.tabVisible('?recon=1', null), true);
  assert.strictEqual(C.tabVisible('?a=1&recon=1', null), true);
  assert.strictEqual(C.tabVisible('?recon=10', null), false);
  assert.strictEqual(C.tabVisible('', '1'), true);
});
check('a suggested job on a message is confirm; another job is correct', () => {
  assert.strictEqual(C.actionFor(message, { kind: 'job', job_id: JOB_A.job_id }), 'confirm');
  assert.strictEqual(C.actionFor(message, { kind: 'job', job_id: JOB_B.job_id }), 'correct');
});
check('any job on an invoice is correct', () => {
  assert.strictEqual(C.actionFor(invoice, { kind: 'job', job_id: JOB_A.job_id }), 'correct');
});
check('the body carries the hash and cause shown, and never a person', () => {
  const b = C.bodyFor(invoice, { kind: 'job', job_id: JOB_A.job_id });
  assert.deepStrictEqual(b, { subject_kind: 'invoice', subject_id: invoice.subject_id, shown_hash: invoice.evidence_hash, action: 'correct', job_ids: [JOB_A.job_id], cause: 'ambiguity:invoice_no_job' });
  ['user_id', 'by', 'person', 'operator'].forEach((k) => assert(!(k in b), k + ' in body'));
  assert.deepStrictEqual(C.bodyFor(message, { kind: 'unrelated' }).job_ids, []);
  assert.strictEqual(C.bodyFor(message, { kind: 'unresolved' }).action, 'unresolved');
});
check('escalate goes to finance for money, sales otherwise', () => {
  assert.strictEqual(C.bodyFor(invoice, { kind: 'escalate' }).escalate_to, 'finance');
  assert.strictEqual(C.bodyFor(owing, { kind: 'escalate' }).escalate_to, 'finance');
  assert.strictEqual(C.bodyFor(message, { kind: 'escalate' }).escalate_to, 'sales');
  assert(!('escalate_to' in C.bodyFor(message, { kind: 'unrelated' })));
});
check('the confirm line names the job and what happens', () => {
  assert.strictEqual(C.confirmWords(invoice, { kind: 'job', job_id: JOB_A.job_id }), 'Record that this invoice belongs to SWF-1001 (Sampleton, accepted)?');
  assert(/stays on the list/.test(C.confirmWords(message, { kind: 'unresolved' })));
});
check('refusals are words, never codes', () => {
  assert(/changed since/.test(C.refusalWords({ code: 'evidence_changed' })));
  assert(/admin, owner or ops manager/.test(C.refusalWords({ code: 'operator_access_required' })));
  assert(/not switched on yet/.test(C.refusalWords({ message: 'Unknown action' })));
  assert.strictEqual(C.refusalWords({ code: 'something_new' }), 'Something went wrong. Please try again.');
  assert.strictEqual(C.mustReread({ code: 'evidence_changed' }), true);
  assert.strictEqual(C.mustReread({ code: 'not_staff' }), false);
});
check('money, waits and groups', () => {
  assert.strictEqual(C.money(12345.5), '$12,345.50');
  assert.strictEqual(C.money(null), '$0.00');
  assert.strictEqual(C.waitWords(0.4), 'under a day');
  assert.strictEqual(C.waitWords(12.9), '12 days');
  assert.deepStrictEqual(C.grouped([invoice, owing, message]).map((g) => [g.band, g.items.length]), [[1, 1], [2, 1], [3, 1]]);
});
check('held items say who has them', () => {
  assert.strictEqual(C.heldWith({ decision_state: 'decided', last_action: 'escalate', owner: 'finance' }), 'With finance');
  assert.strictEqual(C.heldWith({ decision_state: 'undecided', owner: 'context_resolver' }), '');
});

if (failed) { console.error(failed + ' recon check(s) failed'); process.exit(1); }
console.log('PASS recon: tab flag, actions, body, escalate, refusals, words');
