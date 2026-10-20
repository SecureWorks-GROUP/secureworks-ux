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
  assert.strictEqual(C.bodyFor(owing, { kind: 'escalate', to: 'sales' }).escalate_to, 'sales');
  assert.strictEqual(C.bodyFor(message, { kind: 'escalate', to: 'finance' }).escalate_to, 'finance');
  assert.strictEqual(C.bodyFor(invoice, { kind: 'escalate', to: 'sales' }).escalate_to, 'finance');
});
check('an invoice passes only to Finance; a message to Finance or Sales', () => {
  assert.deepStrictEqual(C.passTargets(invoice), ['finance']);
  assert.deepStrictEqual(C.passTargets(message), ['finance', 'sales']);
  assert.deepStrictEqual(C.passTargets(owing), ['finance', 'sales']);
  assert.strictEqual(C.confirmWords(message, { kind: 'escalate', to: 'finance' }), 'Pass this message to Finance? It stays on the list with them.');
});
check('the confirm line names the job and what happens', () => {
  assert.strictEqual(C.confirmWords(invoice, { kind: 'job', job_id: JOB_A.job_id }), 'Record that this invoice is for SWF-1001 (Sampleton, accepted)? Finance will link it in Xero. Nothing changes in Xero from here.');
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
  assert.strictEqual(C.heldWith({ decision_state: 'decided', last_action: 'escalate', owner: 'finance' }), 'With Finance');
  assert.strictEqual(C.heldWith({ subject_kind: 'invoice', decision_state: 'decided', last_action: 'correct', owner: 'finance', summary: { decided_jobs: [{ job_id: JOB_A.job_id, job_number: 'SWF-1001' }] } }), 'With Finance: SWF-1001');
  assert.strictEqual(C.heldWith({ subject_kind: 'invoice', decision_state: 'decided', last_action: 'unrelated', owner: 'finance' }), 'With Finance, not for any job');
  assert.strictEqual(C.heldWith({ decision_state: 'undecided', owner: 'context_resolver' }), '');
});

const jobItem = { event_id: 'ffffffff-0000-4000-8000-000000000009', channel: 'email', direction: 'inbound', occurred_at: '2026-10-08T09:10:21Z',
  from_address: 'orders@supplier.example', subject: 'Material Order Ref SWF-1001 & SWP-2002', preview: 'Delivery moved', counterpart_role: 'supplier',
  cause: 'defect:no_identity', decision_state: 'none', last_action: null, shown_hash: '00112233445566778899aabbccddeeff',
  offered: [{ job_id: JOB_A.job_id, job_number: 'SWF-1001' }, { job_id: JOB_B.job_id, job_number: 'SWP-2002' }] };
check('a Find by job row becomes a card with the hash and cause the server gave', () => {
  const c = C.fromJobItem(jobItem);
  assert.strictEqual(c.subject_kind, 'event');
  assert.strictEqual(c.subject_id, jobItem.event_id);
  assert.strictEqual(c.evidence_hash, jobItem.shown_hash);
  assert.strictEqual(c.cause, 'defect:no_identity');
  assert.deepStrictEqual(c.offered_jobs.map((j) => j.job_number), ['SWF-1001', 'SWP-2002']);
  assert.strictEqual(c.summary.from, 'orders@supplier.example');
  assert.strictEqual(C.causeWords('defect:no_identity'), 'No contact on this message, so it was never matched');
});
check('a message with several suggested jobs can be split onto all of them, and only them', () => {
  const c = C.fromJobItem(jobItem);
  assert.strictEqual(C.canSplit(c), true);
  assert.strictEqual(C.canSplit(message), false);
  assert.strictEqual(C.canSplit(Object.assign({}, invoice, { offered_jobs: [JOB_A, JOB_B] })), false);
  assert.strictEqual(C.splitLabel(c), 'It is both SWF-1001 and SWP-2002');
  assert.deepStrictEqual(C.bodyFor(c, { kind: 'split' }), { subject_kind: 'event', subject_id: jobItem.event_id, shown_hash: jobItem.shown_hash,
    action: 'split', job_ids: [JOB_A.job_id, JOB_B.job_id], cause: 'defect:no_identity' });
  assert.strictEqual(C.confirmWords(c, { kind: 'split' }), 'Record that this message belongs to SWF-1001 and SWP-2002? It will show on each of them.');
});
check('a job number is checked before it is asked for', () => {
  assert.strictEqual(C.jobNumberOk('SWP-26376'), true);
  assert.strictEqual(C.jobNumberOk(' SW1346 '), true);
  assert.strictEqual(C.jobNumberOk(''), false);
  assert.strictEqual(C.jobNumberOk('SWP 26376'), false);
  assert.strictEqual(C.refusalWords({ code: 'job_not_found' }), 'That job was not found.');
});

if (failed) { console.error(failed + ' recon check(s) failed'); process.exit(1); }
console.log('PASS recon: tab flag, actions, body, escalate, split, find by job, refusals, words');
