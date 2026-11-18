// P2-03.10/11: cost lines to place. Made-up ZZTEST ids, jobs and amounts only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../modules/ops-reconcile-place.js');

const J1 = '11111111-0000-4000-8000-000000000001';
const raw = (extra = {}) => ({
  id: 'ZZTEST-item-1', kind: 'bill', card: 'cost', kind_words: 'Bill', party: 'ZZTEST Supplier', document_number: 'ZZ-1',
  document_date: '2026-11-03', amount_ex: 1000, waiting_days: 3, shown_hash: 'hash-1', reason_words: 'One reason found',
  suggestion: { outcome: 'job', job_id: J1, job_number: 'SWF-990001', job_site: '12 Test St' },
  clues: [{ code: 'po', words: 'Order number', seen_where: 'reference', seen_value: 'PO-1', counts: true }, { code: 'ai', words: 'The AI read it', counts: false }],
  against: [], lines: [{ line_id: 'L1', description: 'Posts', amount_ex: 1000, tag: 'Fencing' }], held: null, ...extra,
});

test('the switch is off unless the address or this browser turns it on', () => {
  assert.equal(P.switchOn('', null), false);
  assert.equal(P.switchOn('?x=1', '0'), false);
  assert.equal(P.switchOn('', '1'), true);
  assert.equal(P.switchOn('?reconcile_place=1', null), true);
  assert.equal(P.switchOn('?reconcile_place=0', '1'), false);
});

test('only cost items are kept; a line the server marks not counted is left out', () => {
  assert.equal(P.itemFromList({ ...raw(), card: 'message' }), null);
  assert.equal(P.itemFromList({ ...raw(), id: '' }), null);
  const it = P.itemFromList(raw({ lines: [{ line_id: 'L1', amount_ex: 600 }, { line_id: 'L2', amount_ex: 400, state: null }] }));
  assert.deepEqual(it.lines.map((l) => l.line_id), ['L1']);
});

test('words: amounts, dates, waits and suggestions', () => {
  assert.deepEqual([1240, -120.5, null, '', true].map((a) => P.amountWords(a)), ['$1,240.00 ex GST', 'Credit $120.50 ex GST', 'Amount not read', 'Amount not read', 'Amount not read']);
  assert.equal(P.amountWords(120.5, true), 'Credit $120.50 ex GST');
  assert.deepEqual(['2026-11-03', '2026-13-01', null].map(P.dateWords), ['3 Nov', 'Date not read', 'Date not read']);
  assert.deepEqual([0, 1, 3.9, null, -1].map(P.waitWords), ['Waiting since today', 'Waiting 1 day', 'Waiting 3 days', '', '']);
  const w = (extra) => P.suggestionWords(P.itemFromList(raw(extra)));
  assert.equal(w({}), 'Suggested: SWF-990001, 12 Test St');
  assert.equal(w({ suggestion: { outcome: 'overhead' } }), 'Suggested: not for a job (overhead)');
  assert.equal(w({ suggestion: { outcome: 'division_stock', division: 'fencing' } }), 'Suggested: Fencing stock');
  assert.equal(w({ suggestion: null }), 'No suggestion');
  assert.equal(w({ held: { code: 'possible_duplicate', words: 'Looks like a document already counted' } }), 'Held: Looks like a document already counted');
});

test('a document is placed here only with its hash and an amount on every line', () => {
  assert.equal(P.blockedWhy(P.itemFromList(raw())), null);
  assert.match(P.blockedWhy(P.itemFromList(raw({ amount_ex: null }))), /no amount/);
  assert.match(P.blockedWhy(P.itemFromList(raw({ lines: [{ line_id: 'L1', amount_ex: null }] }))), /no amount/);
  assert.match(P.blockedWhy(P.itemFromList(raw({ lines: [] }))), /no amount/);
  assert.match(P.blockedWhy(P.itemFromList(raw({ shown_hash: '' }))), /cannot be placed/);
  assert.match(P.blockedWhy(P.itemFromList(raw({ held: { words: 'x' } }))), /Held/);
});

test('a refusal shows the server words, never a machine code', () => {
  assert.equal(P.refusalWords({ status: 409, body: { error: 'reconcile_evidence_changed', message: 'This changed while you were looking. The list has been read again, please choose again.' } }),
    'This changed while you were looking. The list has been read again, please choose again.');
  assert.equal(P.refusalWords({ status: 409, body: { error: 'reconcile_item_closed' }, message: 'reconcile_item_closed' }), 'This could not be recorded. The list has been read again, please choose again.');
  assert.equal(P.refusalWords({ status: 403, body: { error: 'operator_access_required', message: 'Only admin, owner or ops manager can decide a Reconcile item.' } }),
    'Only admin, owner or ops manager can decide a Reconcile item.');
  assert.equal(P.refusalWords({ status: 403, body: { error: 'person_session_required' } }), 'You cannot record this. Sign in again as office staff.');
  assert.match(P.refusalWords(new TypeError('Load failed')), /connection dropped .* may or may not have been recorded/);
  assert.match(P.listErrorWords(new TypeError('Load failed')), /connection dropped while reading the list/);
  assert.equal(P.listErrorWords({ status: 400, message: 'Unknown action' }), 'The cost line list is not on the server yet.');
  assert.equal(P.listErrorWords({ status: 503 }), 'The list could not be read. Nothing is shown as placed.');
});

function fixture(lists = { bills: [raw()], card_bank: [], receipts: [] }, answer = { decision_id: 'ZZTEST-d1', item_status: 'decided' }) {
  const calls = [];
  const root = { hidden: true, innerHTML: '', addEventListener() {}, querySelector() { return null; } };
  const host = {
    visible: () => true, identity: () => 'ZZTEST-office',
    read: async (action, params) => {
      calls.push({ action, params });
      if (action === 'search_jobs') return { results: [{ id: 'J2', job_number: 'SWP-990002', client_name: 'Client B', site_suburb: 'ZZTEST East' }] };
      return { items: lists[params.tab] || [] };
    },
    post: async (action, body) => { calls.push({ action, body }); if (answer instanceof Error) throw answer; return answer; },
  };
  const api = P.create(host);
  api.mount(root);
  return { calls, root, host, api };
}
const posts = (f) => f.calls.filter((c) => c.body);

test('it reads the three cost tabs only, never the message tab', async () => {
  const f = fixture();
  await f.api.refresh();
  assert.deepEqual(f.calls.map((c) => c.params.tab), ['bills', 'card_bank', 'receipts']);
  assert.ok(f.calls.every((c) => c.action === 'reconcile_list' && c.params.limit === 100));
  assert.match(f.root.innerHTML, /Cost lines to place/);
  assert.match(f.root.innerHTML, /1 waiting/);
  assert.match(f.root.innerHTML, /Suggested: SWF-990001, 12 Test St/);
  assert.match(f.root.innerHTML, /\(a suggestion only\)/);
});

test('put on the suggested job asks first, then sends the six fields once', async () => {
  const f = fixture();
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'accept_job');
  assert.equal(posts(f).length, 0, 'the first press only asks');
  assert.match(f.root.innerHTML, /Put \$1,000\.00 ex GST on SWF-990001, 12 Test St\./);
  await f.api.press('ZZTEST-item-1', 'record');
  assert.deepEqual(posts(f), [{ action: 'reconcile_decide', body: { item_id: 'ZZTEST-item-1', shown_hash: 'hash-1', action: 'place', parts: [{ job_id: J1 }], note: null, accepted_suggestion: true } }]);
  assert.match(f.root.innerHTML, /Put on SWF-990001 by you, just now\./);
  assert.match(f.root.innerHTML, /data-rp-decision="ZZTEST-d1"/, 'the decision id is kept');
  assert.match(f.root.innerHTML, /To reverse one, ask the office lead\./);
  assert.doesNotMatch(f.root.innerHTML, /Undo/, 'no Undo button until reconcile_undo is on main');
  assert.equal(f.calls.filter((c) => c.action === 'reconcile_list').length, 6, 'the list is read again after a recorded decision');
  await f.api.press('ZZTEST-item-1', 'record');
  assert.equal(posts(f).length, 1, 'a recorded card is never sent again without a new choice');
});

test('another job and not for a job send accepted_suggestion false', async () => {
  const f = fixture();
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'another');
  await f.api.press('ZZTEST-item-1', 'search', 'SWP');
  await f.api.press('ZZTEST-item-1', 'pick', 0);
  assert.match(f.root.innerHTML, /Put \$1,000\.00 ex GST on SWP-990002, ZZTEST East\./);
  await f.api.press('ZZTEST-item-1', 'record');
  assert.deepEqual(posts(f)[0].body.parts, [{ job_id: 'J2' }]);
  assert.equal(posts(f)[0].body.accepted_suggestion, false);
  const g = fixture();
  await g.api.refresh();
  await g.api.press('ZZTEST-item-1', 'overhead');
  await g.api.press('ZZTEST-item-1', 'record');
  assert.deepEqual(posts(g)[0].body, { item_id: 'ZZTEST-item-1', shown_hash: 'hash-1', action: 'overhead', parts: [], note: null, accepted_suggestion: false });
});

test('back cancels; a held or amountless card has no buttons and sends nothing', async () => {
  const f = fixture({ bills: [raw(), raw({ id: 'ZZTEST-held', held: { words: 'Looks like a document already counted' } }), raw({ id: 'ZZTEST-noamt', amount_ex: null })] });
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'overhead');
  await f.api.press('ZZTEST-item-1', 'back');
  await f.api.press('ZZTEST-item-1', 'record');
  for (const id of ['ZZTEST-held', 'ZZTEST-noamt']) { await f.api.press(id, 'overhead'); await f.api.press(id, 'record'); }
  assert.equal(posts(f).length, 0);
});

test('a split posts exactly its parts only when every line adds up', async () => {
  const f = fixture();
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'split');
  await f.api.press('ZZTEST-item-1', 'search', 'SWP');
  await f.api.press('ZZTEST-item-1', 'pick', 0);
  f.api.partCount('ZZTEST-item-1', 0, 0, true);
  f.api.partCount('ZZTEST-item-1', 0, 0, true);
  f.api.partEdit('ZZTEST-item-1', 0, 0, 'target', 'job:' + J1); f.api.partEdit('ZZTEST-item-1', 0, 0, 'text', '600');
  f.api.partEdit('ZZTEST-item-1', 0, 1, 'target', 'job:J2'); f.api.partEdit('ZZTEST-item-1', 0, 1, 'text', '300');
  f.api.partEdit('ZZTEST-item-1', 0, 2, 'target', 'overhead');
  await f.api.press('ZZTEST-item-1', 'save_split');
  assert.equal(posts(f).length, 0);
  assert.doesNotMatch(f.root.innerHTML, /data-rp-confirm/, 'Left $100.00: no confirm');
  f.api.partEdit('ZZTEST-item-1', 0, 2, 'text', '100');
  await f.api.press('ZZTEST-item-1', 'save_split');
  assert.match(f.root.innerHTML, /Split \$1,000\.00 ex GST: \$600\.00 on SWF-990001, \$300\.00 on SWP-990002, \$100\.00 not for a job\./);
  await f.api.press('ZZTEST-item-1', 'record');
  assert.deepEqual(posts(f)[0].body.parts, [
    { line_id: 'L1', target: 'job', amount_ex: 600, job_id: J1 },
    { line_id: 'L1', target: 'job', amount_ex: 300, job_id: 'J2' },
    { line_id: 'L1', target: 'overhead', amount_ex: 100 },
  ]);
  assert.equal(posts(f)[0].body.action, 'split');
});

test('a 409 shows the server words and reads the list again; an answer with no decision is not shown as done', async () => {
  const refused = Object.assign(new Error('x'), { status: 409, body: { error: 'reconcile_evidence_changed', message: 'This changed while you were looking. The list has been read again, please choose again.' } });
  const f = fixture(undefined, refused);
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'accept_job');
  await f.api.press('ZZTEST-item-1', 'record');
  assert.equal(f.calls.filter((c) => c.action === 'reconcile_list').length, 6, 'read again after the 409');
  assert.match(f.root.innerHTML, /This changed while you were looking/);
  assert.doesNotMatch(f.root.innerHTML, /reconcile_evidence_changed/);
  const g = fixture(undefined, { ok: true });
  await g.api.refresh();
  await g.api.press('ZZTEST-item-1', 'overhead');
  await g.api.press('ZZTEST-item-1', 'record');
  assert.doesNotMatch(g.root.innerHTML, /by you, just now/);
  assert.match(g.root.innerHTML, /did not confirm this was recorded/);
});

test('every page of a tab is read by its next cursor; a notice only when the list does not say it is complete', async () => {
  const many = (from, n) => Array.from({ length: n }, (_, i) => raw({ id: 'ZZTEST-' + (from + i) }));
  const f = fixture();
  const pages = { '': { items: many(0, 100), next: 'c1' }, c1: { items: many(100, 100), next: 'c2' }, c2: { items: many(200, 5), counts: { bills: 205 } } };
  f.host.read = async (action, params) => { f.calls.push({ action, params }); return params.tab === 'bills' ? pages[params.after || ''] : { items: [] }; };
  await f.api.refresh();
  assert.deepEqual(f.calls.filter((c) => c.params.tab === 'bills').map((c) => c.params.after || ''), ['', 'c1', 'c2']);
  assert.match(f.root.innerHTML, /205 waiting/);
  assert.doesNotMatch(f.root.innerHTML, /more may be waiting/);
  const g = fixture({ bills: many(0, 100), card_bank: [], receipts: [] });
  await g.api.refresh();
  assert.match(g.root.innerHTML, /The list did not say it was complete, so more may be waiting/);
  const h = fixture();
  h.host.read = async () => { throw Object.assign(new Error('down'), { status: 503 }); };
  await h.api.refresh();
  assert.match(h.root.innerHTML, /The list could not be read\. Nothing is shown as placed\./);
  assert.match(h.root.innerHTML, /Read the list again/);
  assert.doesNotMatch(h.root.innerHTML, /Nothing to place/);
});

test('a dropped connection on a decision says so plainly and offers a re-read, without reading on its own', async () => {
  const f = fixture(undefined, new TypeError('Load failed'));
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'overhead');
  await f.api.press('ZZTEST-item-1', 'record');
  assert.match(f.root.innerHTML, /The connection dropped before an answer came back/);
  assert.match(f.root.innerHTML, /data-rp="reread">Read the list again/);
  assert.equal(f.calls.filter((c) => c.action === 'reconcile_list').length, 3);
  await f.api.press('ZZTEST-item-1', 'reread');
  assert.equal(f.calls.filter((c) => c.action === 'reconcile_list').length, 6);
});

test('a credit shows as a credit under its bill; deciding the bill carries it', async () => {
  const credit = (bill, extra = {}) => raw({ id: 'ZZTEST-credit', kind: 'credit', kind_words: 'Credit', amount_ex: -120.5,
    lines: [{ line_id: 'C1', description: 'Returned posts', amount_ex: -120.5 }], suggestion: null, bill, ...extra });
  const words = (bill) => P.billWords(P.itemFromList(credit(bill)));
  assert.equal(words({ document_number: 'ZZ-1', state: 'waiting', item_id: 'ZZTEST-item-1' }), 'Against bill ZZ-1: the bill is still waiting for a decision.');
  assert.equal(words({ document_number: 'ZZ-1', state: 'not_loaded' }), 'Against bill ZZ-1: waiting for its bill to load.');
  assert.equal(words({ document_number: 'ZZ-1', state: 'placed', job_id: J1, job_number: 'SWF-990001', job_site: '12 Test St' }), 'Against bill ZZ-1: the bill is on SWF-990001, 12 Test St.');
  assert.equal(words({ document_number: 'ZZ-1', state: 'overhead' }), 'Against bill ZZ-1: the bill is not for a job.');
  assert.equal(words({ document_number: 'ZZ-1', state: 'mystery' }), "Against bill ZZ-1: the bill's state was not read.");
  assert.equal(words(null), 'Not against a bill.');
  assert.equal(words(undefined), 'The bill this credit is against was not read.');

  // Bill undecided and on the list: the credit sits under it, and either can be decided.
  const f = fixture({ bills: [raw(), credit({ document_number: 'ZZ-100', state: 'waiting', item_id: 'ZZTEST-item-1' })] });
  await f.api.refresh();
  const html = f.root.innerHTML;
  assert.ok(html.indexOf('data-rp-group="ZZTEST-item-1"') < html.indexOf('data-rp-id="ZZTEST-credit"'), 'the credit is inside the bill group');
  assert.match(html, /Deciding this bill carries these credits/);
  assert.match(html, /Credit \$120\.50 ex GST/);
  assert.match(html, /Decide the bill and this credit follows it\. Placing it alone fixes it here\./);
  assert.doesNotMatch(html, /-\$120/, 'never a bare minus');
  await f.api.press('ZZTEST-item-1', 'accept_job');
  assert.match(f.root.innerHTML, /Put \$1,000\.00 ex GST on SWF-990001, 12 Test St\. Its credit follows it\./);
  const g = fixture({ bills: [raw(), credit({ document_number: 'ZZ-100', state: 'waiting', item_id: 'ZZTEST-item-1' })] });
  await g.api.refresh();
  await g.api.press('ZZTEST-credit', 'overhead');
  assert.match(g.root.innerHTML, /Mark the \$120\.50 ex GST credit as not for a job \(overhead\)\./);
  await g.api.press('ZZTEST-credit', 'record');
  assert.match(g.root.innerHTML, /Credit marked not for a job by you, just now\./);

  // Bill not loaded into the cost lines: waits, no buttons, nothing sent.
  const w = fixture({ bills: [credit({ document_number: 'ZZ-200', state: 'not_loaded' })] });
  await w.api.refresh();
  assert.match(w.root.innerHTML, /waiting for its bill to load/);
  assert.match(w.root.innerHTML, /This credit waits for its bill to load into the cost lines/);
  assert.doesNotMatch(w.root.innerHTML, /data-rp="(another|split|overhead|accept_job)"/);
  await w.api.press('ZZTEST-credit', 'overhead');
  await w.api.press('ZZTEST-credit', 'record');
  assert.equal(posts(w).length, 0);

  // Bill placed on a job: one press puts the credit where its bill is.
  const b = fixture({ bills: [credit({ document_number: 'ZZ-1', state: 'placed', job_id: J1, job_number: 'SWF-990001', job_site: '12 Test St' })] });
  await b.api.refresh();
  assert.match(b.root.innerHTML, /Put on SWF-990001, where its bill is/);
  await b.api.press('ZZTEST-credit', 'bill_job');
  assert.match(b.root.innerHTML, /Take \$120\.50 ex GST off SWF-990001, 12 Test St \(a credit\)\./);
  await b.api.press('ZZTEST-credit', 'record');
  assert.deepEqual(posts(b)[0].body, { item_id: 'ZZTEST-credit', shown_hash: 'hash-1', action: 'place', parts: [{ job_id: J1 }], note: null, accepted_suggestion: false });

  // A split credit reads as a credit and sends negative parts that add up to it.
  const h = fixture({ bills: [credit({ document_number: 'ZZ-1', state: 'split' })] });
  await h.api.refresh();
  await h.api.press('ZZTEST-credit', 'split');
  assert.match(h.root.innerHTML, /Returned posts, Credit \$120\.50 ex GST/);
  assert.match(h.root.innerHTML, /Left \$120\.50 ex GST/);
  await h.api.press('ZZTEST-credit', 'search', 'SWP');
  await h.api.press('ZZTEST-credit', 'pick', 0);
  h.api.partCount('ZZTEST-credit', 0, 0, true);
  h.api.partEdit('ZZTEST-credit', 0, 0, 'target', 'job:J2'); h.api.partEdit('ZZTEST-credit', 0, 0, 'text', '100.50');
  h.api.partEdit('ZZTEST-credit', 0, 1, 'target', 'overhead'); h.api.partEdit('ZZTEST-credit', 0, 1, 'text', '20');
  await h.api.press('ZZTEST-credit', 'save_split');
  assert.match(h.root.innerHTML, /Split the \$120\.50 ex GST credit: \$100\.50 off SWP-990002, \$20\.00 not for a job\./);
  await h.api.press('ZZTEST-credit', 'record');
  assert.deepEqual(posts(h)[0].body.parts, [
    { line_id: 'C1', target: 'job', amount_ex: -100.5, job_id: 'J2' },
    { line_id: 'C1', target: 'overhead', amount_ex: -20 },
  ]);
});

test('backend #1675: switched off reads as off, the line-limit refusal is plain words', async () => {
  const f = fixture();
  f.host.read = async (action, params) => { f.calls.push({ action, params }); return { ok: true, enabled: false }; };
  await f.api.refresh();
  assert.match(f.root.innerHTML, /The cost line list is not switched on yet\./);
  assert.doesNotMatch(f.root.innerHTML, /could not be read|Nothing to place/);
  const g = fixture();
  g.host.read = async () => { throw Object.assign(new Error('x'), { status: 422, body: { ok: false, error: 'reconcile_list_too_many_lines', code: 'reconcile_list_too_many_lines', message: 'This page holds more cost lines than one read may show. Nothing is shown as placed. Read a smaller page.' } }); };
  await g.api.refresh();
  assert.match(g.root.innerHTML, /more cost lines on one page than it can show at once\. Nothing is shown as placed\. Tell the office lead\./);
  assert.doesNotMatch(g.root.innerHTML, /reconcile_list_too_many_lines|Nothing to place/);
});

test('backend #1675: a credit shared by several bills shows in full under the first and marked under each other', async () => {
  const b = (id, n, state, extra = {}) => ({ document_id: 'doc-' + n, document_number: n, item_id: id, state, job_id: null, job_number: null, job_site: null, division: null, ...extra });
  const bill2 = raw({ id: 'ZZTEST-item-2', document_number: 'ZZ-2', shown_hash: 'hash-2' });
  const sharedCredit = raw({ id: 'ZZTEST-credit', kind: 'credit', kind_words: 'Credit', document_number: 'CN-9', amount_ex: -50, suggestion: null,
    lines: [{ line_id: 'C1', description: 'Rebate', amount_ex: -50, state: 'needs_person' }],
    bill: { several: true }, bills: [b('ZZTEST-item-1', 'ZZ-1', 'waiting'), b('ZZTEST-item-2', 'ZZ-2', 'waiting')] });
  const f = fixture({ bills: [raw(), bill2, sharedCredit] });
  await f.api.refresh();
  const html = f.root.innerHTML;
  assert.equal((html.match(/data-rp-id="ZZTEST-credit"/g) || []).length, 1, 'one set of controls');
  assert.equal((html.match(/data-rp-shared="ZZTEST-credit"/g) || []).length, 1, 'a marked line under the second bill');
  assert.ok(html.indexOf('data-rp-group="ZZTEST-item-1"') < html.indexOf('data-rp-id="ZZTEST-credit"'));
  assert.ok(html.indexOf('data-rp-group="ZZTEST-item-2"') < html.indexOf('data-rp-shared="ZZTEST-credit"'));
  assert.match(html, /Shared by 2 bills: ZZ-1 \(still waiting for a decision\), ZZ-2 \(still waiting for a decision\)\./);
  assert.match(html, /Shared: decide its bills and this credit follows them\. Placing it alone fixes it here\./);
  assert.match(html, /Credit, shared<\/span> ZZTEST Supplier CN-9, Credit \$50\.00 ex GST\. Shown in full under bill ZZ-1\./);
  assert.equal((html.match(/Deciding this bill carries these credits/g) || []).length, 2);
  await f.api.press('ZZTEST-credit', 'overhead');
  await f.api.press('ZZTEST-credit', 'record');
  assert.equal(posts(f)[0].body.item_id, 'ZZTEST-credit');
  // One of its bills not loaded: the credit waits, no buttons.
  const w = fixture({ bills: [raw({ ...sharedCredit, bills: [b('ZZTEST-item-1', 'ZZ-1', 'waiting'), b(null, 'ZZ-3', 'not_loaded')] })] });
  await w.api.refresh();
  assert.match(w.root.innerHTML, /This credit waits for one of its bills to load/);
  assert.doesNotMatch(w.root.innerHTML, /data-rp="(another|split|overhead)"/);
  // Several, but none named: not placed.
  assert.match(P.blockedWhy(P.itemFromList({ ...sharedCredit, bills: [] })), /did not name the bills/);
});

test('backend #1678: a bill shows the credits that follow it, read only, each a credit ex GST', async () => {
  const bill = raw({ credits: [
    { document_id: 'doc-cn1', document_number: 'CN-1', is_credit: true, amount_ex: 120.5, lines: [{ line_id: 'c1', description: 'Returned posts', amount_ex: 100.5, state: 'placed' }, { line_id: 'c2', description: 'Freight', amount_ex: 20, state: 'placed' }] },
    { document_id: 'doc-cn2', document_number: 'CN-2', is_credit: true, amount_ex: null, lines: [] },
  ] });
  const f = fixture({ bills: [bill] });
  await f.api.refresh();
  const html = f.root.innerHTML;
  assert.equal((html.match(/Deciding this bill carries these credits/g) || []).length, 1);
  assert.match(html, /CN-1, Credit \$120\.50 ex GST/);
  assert.match(html, /Returned posts, Credit \$100\.50 ex GST/);
  assert.match(html, /CN-2, Amount not read/);
  assert.doesNotMatch(html, /-\$/);
  assert.match(html, /1 waiting/, 'the credits are not items of their own');
  const block = html.slice(html.indexOf('data-rp-bill-credits'), html.indexOf('</div>', html.indexOf('data-rp-bill-credits')));
  assert.doesNotMatch(block, /<button/, 'read only');
  await f.api.press('ZZTEST-item-1', 'accept_job');
  assert.match(f.root.innerHTML, /Put \$1,000\.00 ex GST on SWF-990001, 12 Test St\. Its 2 credits follow it\./);
  await f.api.press('ZZTEST-item-1', 'record');
  assert.deepEqual(posts(f)[0].body.parts, [{ job_id: J1 }], 'the bill is decided as before');
  // No credits[] (or a credit item): nothing shown.
  assert.deepEqual(P.itemFromList(raw()).bill_credits, []);
  assert.deepEqual(P.itemFromList(raw({ kind: 'credit', credits: [{ amount_ex: 1 }] })).bill_credits, []);
});

test('the list is complete when its last page has no next, even when a tab count is higher', async () => {
  const f = fixture();
  f.host.read = async (action, params) => { f.calls.push({ action, params }); return { ok: true, enabled: true, items: params.tab === 'bills' ? [raw()] : [], counts: { bills: 3, card_bank: 0, receipts: 0 }, next: null }; };
  await f.api.refresh();
  assert.doesNotMatch(f.root.innerHTML, /more may be waiting/);
});
