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
check('TP-11: on by default (ask the server); ?recon=0 or sw_recon 0 turns it off; 1 forces it on', () => {
  assert.strictEqual(C.tabSwitch('', null), 'ask');
  assert.strictEqual(C.tabSwitch('?recon=1', null), 'on');
  assert.strictEqual(C.tabSwitch('?a=1&recon=0', null), 'off');
  assert.strictEqual(C.tabSwitch('?recon=10', null), 'ask');
  assert.strictEqual(C.tabSwitch('', '1'), 'on');
  assert.strictEqual(C.tabSwitch('', '0'), 'off');
  assert.strictEqual(C.tabSwitch('?recon=1', '0'), 'on');
  assert.strictEqual(C.tabSwitch('?recon=0', '1'), 'off');
});
check('TP-11: the probe shows the tab on a list, hides it on a refusal, and an unknown read stays unknown', () => {
  assert.strictEqual(C.probeAnswer({ items: [] }, null), true);
  assert.strictEqual(C.probeAnswer({}, null), null);
  assert.strictEqual(C.probeAnswer(null, { status: 403, code: 'operator_access_required' }), false);
  assert.strictEqual(C.probeAnswer(null, { status: 403, code: 'operator_org_required' }), false);
  assert.strictEqual(C.probeAnswer(null, { status: 403, body: { code: 'not_staff' } }), false);
  assert.strictEqual(C.probeAnswer(null, { status: 403 }), false);
  assert.strictEqual(C.probeAnswer(null, { status: 401, code: 'user_jwt_required' }), null);
  assert.strictEqual(C.probeAnswer(null, new Error('Sign in required')), null);
  assert.strictEqual(C.probeAnswer(null, { status: 500 }), null);
});
const LABELS = { reasons: { no_ref_no_po: 'No reference, no matching PO' }, rules: { several_candidates: 'more than one job fits' } };
const Q = [
  { id: 'q1', status: 'open', xero_invoice_id: 'x1', contact_name: 'Steel Co', invoice_number: 'B-1', invoice_date: '2026-10-20', sub_total: 120.5, suggestion_reason: 'no_ref_no_po' },
  { id: 'q2', status: 'open', xero_invoice_id: 'x2', contact_name: 'Timber Co', invoice_number: 'B-2', invoice_date: '2026-10-21', sub_total: 980,
    proposal: { kind: 'review', rule: 'several_candidates', outcome: 'queued_for_review', candidates: [{ job_id: 'j1', job_number: 'SWF-1001', signals: ['po_number', 'site_suburb'] }, { job_id: 'j2', job_number: 'SWP-2002', signals: [] }] } },
  { id: 'q3', status: 'open', xero_invoice_id: 'x3', contact_name: null, invoice_number: 'B-3', sub_total: null },
  { id: 'q4', status: 'assigned', xero_invoice_id: 'x4', sub_total: 5000 },
];
const AI = [
  { xero_invoice_id: 'x1', decision: 'job', job_number: 'SWP-3003', confidence: 0.72, reason: 'Delivery address matches the job site', second_check_status: 'disagreed', second_check: { decision: 'job', job_number: 'SWP-3004' } },
  { xero_invoice_id: 'x1', decision: 'job', job_number: 'OLD-1', confidence: 0.4, reason: 'older row' },
];
check('TP-11: bills to place are the open rows only, largest first, an unknown amount last', () => {
  const rows = C.billRows(Q, AI, LABELS);
  assert.deepStrictEqual(rows.map((r) => r.id), ['q2', 'q1', 'q3']);
  assert.strictEqual(rows[2].amountEx, null);
  assert.strictEqual(rows[2].supplier, 'Supplier not named');
  assert.strictEqual(C.billTotalEx(rows), 1100.5);
});
check('TP-11: each bill carries the best guess, its reason and which keys agreed or disagreed', () => {
  const rows = C.billRows(Q, AI, LABELS);
  const b1 = rows.find((r) => r.id === 'q1');
  assert.strictEqual(C.billGuessWords(b1.guess), 'SWP-3003 (AI, sure 72%)');
  assert.strictEqual(b1.reason, 'Delivery address matches the job site');
  assert.deepStrictEqual(b1.keys, [{ agree: false, words: 'Second check disagreed: says SWP-3004' }]);
  const b2 = rows.find((r) => r.id === 'q2');
  assert.strictEqual(C.billGuessWords(b2.guess), 'No pick: 2 possible jobs (Bill agent)');
  assert.strictEqual(b2.reason, 'more than one job fits');
  assert.deepStrictEqual(b2.keys, [{ agree: null, words: 'SWF-1001: po number, site suburb' }]);
  const b3 = rows.find((r) => r.id === 'q3');
  assert.strictEqual(C.billGuessWords(b3.guess), 'No guess');
  assert.strictEqual(b3.reason, '');
  const noAi = C.billRows(Q, [], LABELS).find((r) => r.id === 'q1');
  assert.strictEqual(noAi.reason, 'No reference, no matching PO');
  assert.strictEqual(C.billGuessWords(C.billGuess({ suggested_job_number: 'SWF-9', suggestion_source: 'agent_prematch' }, null)), 'SWF-9 (Bill agent)');
  assert.strictEqual(C.billGuessWords(C.billGuess({ proposal: { kind: 'job', job_number: 'SWF-8', confidence: 'high' } }, null)), 'SWF-8 (Bill agent, strong)');
  assert.strictEqual(C.billGuessWords(C.billGuess({}, { decision: 'not_job_related', confidence: 0.6 })), 'Not job related? (AI, sure 60%)');
  assert.deepStrictEqual(C.billKeys({}, { second_check_status: 'agreed' }), [{ agree: true, words: 'Second check agreed' }]);
});
check('TP-11: the head line never counts an unread side as none', () => {
  assert.strictEqual(C.needsWords({ matchCount: 3, billCount: 2, billEx: 1100.5 }), '3 messages or invoices to match · 2 bills to place ($1,100.50 ex GST)');
  assert.strictEqual(C.needsWords({ matchCount: 1, billCount: 1, billEx: 5 }), '1 message or invoice to match · 1 bill to place ($5.00 ex GST)');
  assert.strictEqual(C.needsWords({ matchCount: 50, matchMore: true, billCount: 1000, billEx: 9, billsFull: true }), 'at least 50 messages or invoices to match · at least 1000 bills to place (at least $9.00 ex GST)');
  const e = C.needsWords({ matchErr: true, billsErr: true });
  assert(/not known/.test(e) && !/\b0\b/.test(e));
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
  assert.strictEqual(C.confirmWords(invoice, { kind: 'job', job_id: JOB_A.job_id }), 'Record that this invoice is for SWF-1001 \u00b7 Sampleton \u00b7 accepted? Finance will link it in Xero. Nothing changes in Xero from here.');
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
  assert.strictEqual(C.confirmWords(c, { kind: 'split' }), 'Record that this message belongs to SWF-1001 and SWP-2002? Any amount in it is unknown for each job: money is read from Xero only, and how a bill shared between jobs is split is on hold for Finance.');
});
check('a job number is checked before it is asked for', () => {
  assert.strictEqual(C.jobNumberOk('SWP-26376'), true);
  assert.strictEqual(C.jobNumberOk(' SW1346 '), true);
  assert.strictEqual(C.jobNumberOk(''), false);
  assert.strictEqual(C.jobNumberOk('SWP 26376'), false);
  assert.strictEqual(C.refusalWords({ code: 'job_not_found' }), 'That job was not found.');
});

check('AC-M3: an offered job reads number, type, suburb and status in words', () => {
  assert.strictEqual(C.jobWords({ job_number: 'SWP-26376', type: 'patio', suburb: 'Synthville', status: 'in_progress' }), 'SWP-26376 · patio · Synthville · in progress');
  assert.strictEqual(C.jobWords({ job_number: 'SWP-26376' }), 'SWP-26376');
  assert(!/_/.test(C.jobWords({ job_number: 'X-1', type: 'insurance_repair', status: 'trade_report_in' })));
});
check('AC-M4: why a job is offered comes only from the server reasons', () => {
  assert.strictEqual(C.reasonWords({ job_number: 'SWF-1001', reasons: ['candidate', 'job_number_in_message'] }), 'SWF-1001: the system listed this job as possible; the job number is in the message');
  assert.strictEqual(C.reasonWords({ job_number: 'SWF-1001', reasons: ['made_up'] }), '');
  assert.strictEqual(C.reasonWords({ job_number: 'SWF-1001' }), '');
  const it = C.fromJobItem({ event_id: 'e', shown_hash: 'h', cause: 'ambiguity:one_candidate', counterpart_role: 'supplier',
    offered: [{ job_id: 'j', job_number: 'SWF-1001', type: 'fencing', suburb: 'S', status: 'accepted', reasons: ['ladder_job'] }] });
  assert.deepStrictEqual(it.offered_jobs[0].reasons, ['ladder_job']);
  assert.strictEqual(it.offered_jobs[0].type, 'fencing');
  assert.strictEqual(it.summary.counterpart_role, 'supplier');
});
check('AC-M5: the sender is named from the role, else said to be not known', () => {
  assert.strictEqual(C.senderWords('supplier'), 'Supplier');
  assert.strictEqual(C.senderWords('job_customer'), 'Customer');
  assert.strictEqual(C.senderWords('builder'), 'Builder');
  assert.strictEqual(C.senderWords('staff'), 'Us');
  assert.strictEqual(C.senderWords(null), 'Sender not known');
  assert.strictEqual(C.senderWords('lead'), 'Sender not known');
});
check('AC-M7: dates read in Perth time', () => {
  assert.strictEqual(C.perthWhen('2026-10-08T09:10:21Z'), '8 Oct 2026, 5:10pm');
  assert.strictEqual(C.perthWhen('2026-10-20T16:30:00Z'), '21 Oct 2026, 12:30am');
  assert.strictEqual(C.perthWhen('2026-10-21T01:52:00Z'), '21 Oct 2026, 9:52am');
  assert.strictEqual(C.perthWhen(null), '');
});
check('AC-M8: the recorded line says what, by you, and when', () => {
  const c = Object.assign({}, message, { offered_jobs: [JOB_A, JOB_B] });
  assert.strictEqual(C.recordedWords(c, { kind: 'split' }, '2026-10-21T01:52:00Z'), 'Recorded by you at 9:52am: on SWF-1001 and SWP-2002.');
  assert.strictEqual(C.recordedWords(message, { kind: 'job', job_id: JOB_B.job_id }, '2026-10-21T01:52:00Z'), 'Recorded by you at 9:52am: on SWP-2002.');
  assert.strictEqual(C.recordedWords(invoice, { kind: 'unrelated' }, '2026-10-21T01:52:00Z'), 'Recorded by you at 9:52am: this invoice is not for any job.');
  assert.strictEqual(C.recordedWords(message, { kind: 'escalate', to: 'sales' }, '2026-10-21T01:52:00Z'), 'Recorded by you at 9:52am: passed to Sales.');
});
check('AC-M1: an empty list never says nothing needs matching while rows are left out or unread', () => {
  const lo = C.leftOut({ left_out: { no_identity: 2, never_asked: 1, not_ranked: 0, backlog: 0 }, left_out_unreadable: false });
  assert.strictEqual(lo.state, 'ok'); assert.strictEqual(lo.total, 3);
  const empty = C.leftOutWords(lo, false);
  assert(!/Nothing needs matching/.test(empty));
  assert(/3 messages are left off it: 2 with no contact to match them by, 1 loaded from history and never matched\./.test(empty));
  assert(/Find by job/.test(empty));
  assert(/^Also waiting, left off today's list: 2 with no contact/.test(C.leftOutWords(lo, true)));
  const none = C.leftOut({ left_out: { no_identity: 0, never_asked: 0, not_ranked: 0, backlog: 0 }, left_out_unreadable: false });
  assert.strictEqual(C.leftOutWords(none, false), 'Nothing needs matching right now.');
  assert.strictEqual(C.leftOutWords(none, true), '');
  for (const res of [{ left_out: null, left_out_unreadable: true }, { left_out: { no_identity: 1 }, left_out_unreadable: false }]) {
    const u = C.leftOut(res);
    assert.strictEqual(u.state, 'unreadable');
    assert(!/Nothing needs matching/.test(C.leftOutWords(u, false)));
    assert(/could not be read/.test(C.leftOutWords(u, true)));
  }
  const absent = C.leftOut({ items: [] });
  assert.strictEqual(absent.state, 'absent');
  assert(!/Nothing needs matching/.test(C.leftOutWords(absent, false)));
  assert.strictEqual(C.leftOutWords(absent, true), '');
});

check('AC-M6: a call original shows length and where to listen, and never words', () => {
  const v = C.originalView({ kind: 'call', direction: 'inbound', at: '2026-10-20T01:00:00Z',
    call: { duration_seconds: 184, status: 'completed', line: '+61489267771', words_shown: false,
      words_note: 'Call words are not shown here.', where_to_listen: 'In GoHighLevel: open this contact\'s conversation.' } });
  assert.strictEqual(v.callNote, 'Call words are not shown here.');
  assert(/GoHighLevel/.test(v.listen));
  assert.deepStrictEqual(v.rows.find((r) => r[0] === 'Length'), ['Length', '3 min 4 s']);
  assert.strictEqual(v.body, null);
  const unknown = C.originalView({ kind: 'call', call: {} });
  assert.strictEqual(unknown.callNote, 'Call words are not shown here.');
  assert.deepStrictEqual(unknown.rows.find((r) => r[0] === 'Length'), ['Length', 'Not recorded']);
});
check('AC-M6: an email original shows its fields, words and every file with why', () => {
  const v = C.originalView({ kind: 'email', direction: 'inbound', at: '2026-10-20T01:00:00Z',
    email: { from: 'a@example.com', to: ['fencing@secureworkswa.com.au'], cc: [], subject: 'Plans', body: 'Subject: Plans\n\nSee attached', body_source: 'message', body_truncated: true },
    attachments: { read: 'ok', items: [{ file_name: 'plans.pdf', size_bytes: 2048, status_words: 'Saved' }, { file_name: 'logo.png', size_bytes: 20, status_words: 'Not saved: a picture in the email itself, such as a signature' }],
      files: 'not_available', files_note: 'Opening the file itself is not available yet: the files are kept private.', on_message: 2 } });
  assert.deepStrictEqual(v.rows.find((r) => r[0] === 'Subject'), ['Subject', 'Plans']);
  assert.strictEqual(v.body, 'Subject: Plans\n\nSee attached');
  assert(/only the first part/.test(v.bodyNote));
  assert.deepStrictEqual(v.files, [{ name: 'plans.pdf', words: '2 KB, Saved' }, { name: 'logo.png', words: '20 bytes, Not saved: a picture in the email itself, such as a signature' }]);
  assert(/kept private/.test(v.filesNote));
});
check('AC-M6: a file list that was not read is never shown as no files', () => {
  const failedList = C.originalView({ kind: 'email', email: {}, attachments: { read: 'failed', items: null } });
  assert.strictEqual(failedList.files, null);
  assert(/could not be read/.test(failedList.filesNote));
  assert(!/No files/.test(failedList.filesNote));
  const kept = C.originalView({ kind: 'email', email: {}, attachments: { read: 'ok', items: [], on_message: 2 } });
  assert(/no file list was kept/.test(kept.filesNote));
  const none = C.originalView({ kind: 'email', email: {}, attachments: { read: 'ok', items: [], on_message: 0 } });
  assert.strictEqual(none.filesNote, 'No files.');
  const cut = C.originalView({ kind: 'email', email: {}, attachments: { read: 'ok', items: [{ file_name: 'a.pdf', status_words: 'Saved' }], more_not_listed: true } });
  assert(/More files than shown here/.test(cut.filesNote));
});
check('AC-M6: a text original shows the whole text; a bad answer and errors are in words', () => {
  const v = C.originalView({ kind: 'text', direction: 'outbound', text: { body: 'On our way', body_source: 'message', line: '+61489267771' } });
  assert.strictEqual(v.body, 'On our way');
  assert(C.originalView(null).error);
  assert.strictEqual(C.originalErrorWords({ code: 'message_not_found' }), 'That message is no longer there.');
  assert(/not switched on/.test(C.originalErrorWords(new Error('Unknown action: context_message_original'))));
  assert(/Only an admin/.test(C.originalErrorWords({ code: 'operator_access_required' })));
});

if (failed) { console.error(failed + ' recon check(s) failed'); process.exit(1); }
console.log('PASS recon: tab flag, default-on probe, bills to place rows, actions, body, escalate, split, find by job, refusals, words, open the original');
