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
  assert.match(f.root.innerHTML, /data-rp="undo">Undo</, 'Undo shows on a decision the screen holds an id for');
  assert.doesNotMatch(f.root.innerHTML, /ask the office lead/);
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
  assert.match(f.root.innerHTML, /Split \$1,000\.00 ex GST: Posts, \$600\.00 ex GST on SWF-990001; Posts, \$300\.00 ex GST on SWP-990002; Posts, \$100\.00 ex GST not for a job \(overhead\)\./);
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
  assert.match(h.root.innerHTML, /Split the \$120\.50 ex GST credit: Returned posts, take \$100\.50 ex GST off SWP-990002; Returned posts, take \$20\.00 ex GST off overhead \(not for a job\)\./);
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

test('a credit with its own card and in the bill credits list is shown once and counted once', async () => {
  const card = raw({ id: 'ZZTEST-credit', kind: 'credit', kind_words: 'Credit', document_number: 'CN-7', amount_ex: -80, suggestion: null,
    lines: [{ line_id: 'C7', description: 'Returned rails', amount_ex: -80, state: 'needs_person' }],
    bill: { document_id: 'doc-1', document_number: 'ZZ-1', item_id: 'ZZTEST-item-1', state: 'waiting', job_id: null, job_number: null, job_site: null, division: null } });
  card.bills = [card.bill];
  const bill = raw({ credits: [
    { document_id: 'doc-cn7', document_number: 'CN-7', is_credit: true, amount_ex: 80, lines: [{ line_id: 'C7', description: 'Returned rails', amount_ex: 80, state: 'needs_person' }] },
    { document_id: 'doc-cn8', document_number: 'CN-8', is_credit: true, amount_ex: 15, lines: [{ line_id: 'C8', description: 'Freight', amount_ex: 15, state: 'placed' }] },
  ] });
  const f = fixture({ bills: [bill, card] });
  await f.api.refresh();
  const html = f.root.innerHTML;
  assert.equal((html.match(/CN-7/g) || []).length, 1, 'CN-7 once: its own card');
  assert.equal((html.match(/data-rp-id="ZZTEST-credit"/g) || []).length, 1);
  assert.match(html, /CN-8, Credit \$15\.00 ex GST/);
  assert.equal((html.match(/Deciding this bill carries these credits/g) || []).length, 1);
  await f.api.press('ZZTEST-item-1', 'accept_job');
  assert.match(f.root.innerHTML, /Its 2 credits follow it\./, 'two distinct credits, not three');
  // The same credit as its card and its entry alone: one credit.
  const g = fixture({ bills: [raw({ credits: [bill.credits[0]] }), card] });
  await g.api.refresh();
  assert.equal((g.root.innerHTML.match(/CN-7/g) || []).length, 1);
  await g.api.press('ZZTEST-item-1', 'accept_job');
  assert.match(g.root.innerHTML, /Its credit follows it\./);
});

// Hold fix (director 01:53): money is signed cents everywhere.
const mixedBill = () => raw({ amount_ex: 90, lines: [
  { line_id: 'L1', description: 'Posts', amount_ex: 100 },
  { line_id: 'L2', description: 'Discount', amount_ex: -10 },
] });

test('a bill with a discount line sums signed: place, overhead and split each read and send what partsFor sends', async () => {
  const f = fixture({ bills: [mixedBill()] });
  await f.api.refresh();
  assert.equal(P.blockedWhy(P.itemFromList(mixedBill())), null);
  assert.match(f.root.innerHTML, /Discount, Credit \$10\.00 ex GST/);
  assert.match(f.root.innerHTML, /Posts, \$100\.00 ex GST/);
  await f.api.press('ZZTEST-item-1', 'accept_job');
  assert.match(f.root.innerHTML, /Put \$100\.00 ex GST on SWF-990001, 12 Test St and take \$10\.00 ex GST off it \(net \$90\.00 ex GST\)\./);
  await f.api.press('ZZTEST-item-1', 'back');
  await f.api.press('ZZTEST-item-1', 'overhead');
  assert.match(f.root.innerHTML, /Mark \$100\.00 ex GST and a \$10\.00 ex GST credit as not for a job \(overhead\) \(net \$90\.00 ex GST\)\./);
  await f.api.press('ZZTEST-item-1', 'back');
  await f.api.press('ZZTEST-item-1', 'split');
  assert.match(f.root.innerHTML, /Lines total \$90\.00 ex GST\. Allocated \$0\.00 ex GST\. 2 lines are not fully placed yet\./);
  f.api.partEdit('ZZTEST-item-1', 0, 0, 'target', 'job:' + J1); f.api.partEdit('ZZTEST-item-1', 0, 0, 'text', '100');
  f.api.partEdit('ZZTEST-item-1', 1, 0, 'target', 'job:' + J1); f.api.partEdit('ZZTEST-item-1', 1, 0, 'text', '10');
  const it = () => f.api.state().items[0];
  assert.equal(P.footerHtml(it()), 'Lines total $90.00 ex GST. Allocated $90.00 ex GST. Every line is placed.');
  assert.doesNotMatch(P.footerHtml(it()), /\$110\.00/);
  await f.api.press('ZZTEST-item-1', 'save_split');
  assert.match(f.root.innerHTML, /Split \$90\.00 ex GST: Posts, \$100\.00 ex GST on SWF-990001; Discount, take \$10\.00 ex GST off SWF-990001\./);
  await f.api.press('ZZTEST-item-1', 'record');
  assert.deepEqual(posts(f)[0].body.parts, [
    { line_id: 'L1', target: 'job', amount_ex: 100, job_id: J1 },
    { line_id: 'L2', target: 'job', amount_ex: -10, job_id: J1 },
  ]);
});

test('an over on one line and an under on another never read as all placed', async () => {
  const f = fixture({ bills: [raw({ amount_ex: 150, lines: [
    { line_id: 'L1', description: 'Posts', amount_ex: 100 }, { line_id: 'L2', description: 'Rails', amount_ex: 50 },
  ] })] });
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'split');
  f.api.partEdit('ZZTEST-item-1', 0, 0, 'target', 'job:' + J1); f.api.partEdit('ZZTEST-item-1', 0, 0, 'text', '110');
  f.api.partEdit('ZZTEST-item-1', 1, 0, 'target', 'job:' + J1); f.api.partEdit('ZZTEST-item-1', 1, 0, 'text', '40');
  const lines = f.api.state().items[0].split.lines;
  assert.match(P.leftHtml(lines[0]), />Over by \$10\.00 ex GST</);
  assert.match(P.leftHtml(lines[1]), />Left \$10\.00 ex GST</);
  const foot = P.footerHtml(f.api.state().items[0]);
  assert.equal(foot, 'Lines total $150.00 ex GST. Allocated $150.00 ex GST. 2 lines are not fully placed yet.');
  await f.api.press('ZZTEST-item-1', 'save_split');
  assert.equal(posts(f).length, 0);
});

test('a credit with a positive line reads that line as a cost, in its own sign', async () => {
  const mixedCredit = raw({ id: 'ZZTEST-credit', kind: 'credit', kind_words: 'Credit', amount_ex: -95, suggestion: null,
    lines: [{ line_id: 'C1', description: 'Returned posts', amount_ex: -100 }, { line_id: 'C2', description: 'Restocking fee', amount_ex: 5 }],
    bill: null });
  const f = fixture({ bills: [mixedCredit] });
  await f.api.refresh();
  assert.match(f.root.innerHTML, /Restocking fee, \$5\.00 ex GST/);
  assert.match(f.root.innerHTML, /Returned posts, Credit \$100\.00 ex GST/);
  await f.api.press('ZZTEST-credit', 'split');
  assert.match(f.root.innerHTML, /A cost on this credit: each part is added where it goes\./);
  assert.match(f.root.innerHTML, /Lines total Credit \$95\.00 ex GST\./);
  await f.api.press('ZZTEST-credit', 'search', 'SWP');
  await f.api.press('ZZTEST-credit', 'pick', 0);
  f.api.partEdit('ZZTEST-credit', 0, 0, 'target', 'job:J2'); f.api.partEdit('ZZTEST-credit', 0, 0, 'text', '100');
  f.api.partEdit('ZZTEST-credit', 1, 0, 'target', 'overhead'); f.api.partEdit('ZZTEST-credit', 1, 0, 'text', '5');
  assert.match(P.footerHtml(f.api.state().items[0]), /Allocated Credit \$95\.00 ex GST\. Every line is placed\./);
  await f.api.press('ZZTEST-credit', 'save_split');
  assert.match(f.root.innerHTML, /Split the \$95\.00 ex GST credit: Returned posts, take \$100\.00 ex GST off SWP-990002; Restocking fee, \$5\.00 ex GST not for a job \(overhead\)\./);
  await f.api.press('ZZTEST-credit', 'record');
  assert.deepEqual(posts(f)[0].body.parts, [
    { line_id: 'C1', target: 'job', amount_ex: -100, job_id: 'J2' },
    { line_id: 'C2', target: 'overhead', amount_ex: 5 },
  ]);
  const g = fixture({ bills: [mixedCredit] });
  await g.api.refresh();
  await g.api.press('ZZTEST-credit', 'overhead');
  assert.match(g.root.innerHTML, /Mark \$5\.00 ex GST and a \$100\.00 ex GST credit as not for a job \(overhead\) \(net the \$95\.00 ex GST credit\)\./);
});

test('a document is refused when its lines do not add up to its amount, or it comes to 0.00', () => {
  assert.match(P.blockedWhy(P.itemFromList(raw({ amount_ex: 1100 }))), /lines do not add up to the document's amount/);
  assert.match(P.blockedWhy(P.itemFromList(raw({ amount_ex: 0, lines: [{ line_id: 'L1', amount_ex: 10 }, { line_id: 'L2', amount_ex: -10 }] }))), /comes to \$0\.00/);
  assert.equal(P.blockedWhy(P.itemFromList(raw())), null);
});

// Undo (backend #1682): POST reconcile_undo { decision_id } -> { ok, undone: true, decision_id, restored_item_id }.
async function decided(undoAnswer) {
  const f = fixture();
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'accept_job');
  await f.api.press('ZZTEST-item-1', 'record');
  f.host.post = async (action, body) => {
    f.calls.push({ action, body });
    if (undoAnswer instanceof Error) throw undoAnswer;
    return undoAnswer;
  };
  return f;
}
const undoPosts = (f) => f.calls.filter((c) => c.action === 'reconcile_undo');
const listReads = (f) => f.calls.filter((c) => c.action === 'reconcile_list').length;

test('undo asks first, sends only the decision id once, then reads the list again', async () => {
  const f = await decided({ ok: true, undone: true, decision_id: 'ZZTEST-d2', restored_item_id: 'ZZTEST-item-1' });
  const before = listReads(f);
  await f.api.undo('ZZTEST-d1', 'undo_yes');
  assert.equal(undoPosts(f).length, 0, 'no undo without the first press');
  await f.api.undo('ZZTEST-d1', 'undo');
  assert.equal(undoPosts(f).length, 0, 'the first press only asks');
  assert.match(f.root.innerHTML, /Undo this\? It puts the item back on the list as it was before\./);
  await f.api.undo('ZZTEST-d1', 'undo_back');
  assert.doesNotMatch(f.root.innerHTML, /Undo this\?/);
  await f.api.undo('ZZTEST-d1', 'undo');
  await f.api.undo('ZZTEST-d1', 'undo_yes');
  assert.deepEqual(undoPosts(f), [{ action: 'reconcile_undo', body: { decision_id: 'ZZTEST-d1' } }]);
  assert.match(f.root.innerHTML, /Undone by you, just now\. It is back on the list\./);
  assert.doesNotMatch(f.root.innerHTML, /data-rp="undo"/, 'an undone decision has no Undo');
  assert.equal(listReads(f) - before, 3, 'the list is read again (three tabs)');
  await f.api.undo('ZZTEST-d1', 'undo');
  await f.api.undo('ZZTEST-d1', 'undo_yes');
  assert.equal(undoPosts(f).length, 1, 'never sent twice');
});

test('only the newest decision on an item shows Undo; an entry without an id shows none', () => {
  const recent = [{ decision_id: 'd3', item_id: 'A' }, { decision_id: 'd2', item_id: 'B' }, { decision_id: 'd1', item_id: 'A' }, { decision_id: null, item_id: 'C' }, { decision_id: 'd0', item_id: 'D', undone: true }];
  assert.deepEqual(recent.map((_, i) => P.canUndo(recent, i)), [true, true, false, false, false]);
});

test('an undo refusal shows the server words and reads the list again; 403 keeps its words', async () => {
  const words = 'Only the newest decision on this item can be undone. The list has been read again.';
  const f = await decided(Object.assign(new Error('x'), { status: 409, body: { ok: false, error: 'reconcile_not_latest', code: 'reconcile_not_latest', message: words, userMessage: words } }));
  const before = listReads(f);
  await f.api.undo('ZZTEST-d1', 'undo');
  await f.api.undo('ZZTEST-d1', 'undo_yes');
  assert.ok(f.root.innerHTML.includes(words));
  assert.doesNotMatch(f.root.innerHTML, /reconcile_not_latest|Undone by you/);
  assert.equal(listReads(f) - before, 3);
  const g = await decided(Object.assign(new Error('x'), { status: 403, body: { ok: false, error: 'operator_access_required', message: 'Only admin, owner or ops manager can decide Reconcile items.' } }));
  await g.api.undo('ZZTEST-d1', 'undo');
  await g.api.undo('ZZTEST-d1', 'undo_yes');
  assert.match(g.root.innerHTML, /Only admin, owner or ops manager can decide Reconcile items\./);
  assert.match(g.root.innerHTML, /data-rp="undo">Undo</, 'a refused undo can be pressed again');
});

test('a dropped or unclear undo never says undone and offers a re-read', async () => {
  const f = await decided(new TypeError('Load failed'));
  await f.api.undo('ZZTEST-d1', 'undo');
  await f.api.undo('ZZTEST-d1', 'undo_yes');
  assert.match(f.root.innerHTML, /This may or may not have been undone\. Read the list again before trying again\./);
  assert.match(f.root.innerHTML, /data-rp="reread"/);
  assert.doesNotMatch(f.root.innerHTML, /Undone by you/);
  for (const unclear of [{}, { ok: true }, { undone: 'true' }, null]) {
    const g = await decided(unclear);
    await g.api.undo('ZZTEST-d1', 'undo');
    await g.api.undo('ZZTEST-d1', 'undo_yes');
    assert.match(g.root.innerHTML, /did not confirm this was undone/, JSON.stringify(unclear));
    assert.doesNotMatch(g.root.innerHTML, /Undone by you/);
  }
});

// Follow-up (director 02:45): lines not counted, a bill not counted, and the 409 copy.
test('a line not counted is named on the card, kept out of the amounts and never sent', async () => {
  const doc = raw({ amount_ex: 600, lines: [{ line_id: 'L1', description: 'Posts', amount_ex: 600, state: 'needs_person' }, { line_id: 'L2', description: 'Posts again', amount_ex: 600, state: null }] });
  const f = fixture({ bills: [doc] });
  await f.api.refresh();
  assert.match(f.root.innerHTML, /1 line on this document is not counted \(set aside, for example as a duplicate\)\. It is not placed here and not in the amounts below\./);
  assert.doesNotMatch(f.root.innerHTML, /Posts again/);
  await f.api.press('ZZTEST-item-1', 'split');
  assert.equal(P.footerHtml(f.api.state().items[0]), 'Lines total $600.00 ex GST. Allocated $0.00 ex GST. 1 line is not fully placed yet.');
  assert.equal(f.api.state().items[0].split.lines.length, 1);
  assert.equal(P.setAsideWords(2), '2 lines on this document are not counted (set aside, for example as a duplicate). They are not placed here and not in the amounts below.');
});

test('a document with no counted line says so plainly and has no buttons', async () => {
  const doc = raw({ lines: [{ line_id: 'L1', description: 'Posts', amount_ex: 1000, state: null }] });
  assert.equal(P.blockedWhy(P.itemFromList(doc)), 'No line on this document counts (each one is set aside, for example as a duplicate), so there is nothing to place here.');
  const f = fixture({ bills: [doc] });
  await f.api.refresh();
  assert.doesNotMatch(f.root.innerHTML, /data-rp="(accept_job|split|overhead|other)"/);
  assert.doesNotMatch(f.root.innerHTML, /has no amount/);
  await f.api.press('ZZTEST-item-1', 'accept_job');
  assert.equal(posts(f).length, 0);
});

test('a credit whose bill is not counted, alone or shared, is not placed from here', () => {
  const credit = (extra) => P.itemFromList(raw({ id: 'ZZTEST-credit', kind: 'credit', amount_ex: -50, suggestion: null,
    lines: [{ line_id: 'C1', description: 'Returned posts', amount_ex: -50 }], ...extra }));
  const one = credit({ bill: { document_number: 'ZZ-1', state: 'not_counted', not_counted_reasons: ['duplicate_document'] } });
  assert.equal(P.blockedWhy(one), 'This credit\'s bill is not counted (every line on it is set aside), so the credit is not placed from here. Tell the office lead.');
  assert.equal(P.billWords(one), 'Against bill ZZ-1: the bill is not counted.');
  const both = credit({ bill: { several: true }, bills: [{ document_number: 'ZZ-1', state: 'placed', job_number: 'SWF-990001' }, { document_number: 'ZZ-2', state: 'not_counted' }] });
  assert.match(P.blockedWhy(both), /^One of the bills this credit is shared by is not counted/);
  assert.match(P.billWords(both), /ZZ-2 \(not counted\)/);
});

test('409 copy: the server words stay on the card after the re-read, or above the list when the item has gone', async () => {
  const words = 'Someone already decided this one.';
  const lists = { bills: [raw()], card_bank: [], receipts: [] };
  const f = fixture(lists, Object.assign(new Error('x'), { status: 409, body: { error: 'reconcile_item_closed', message: words, userMessage: words } }));
  await f.api.refresh();
  await f.api.press('ZZTEST-item-1', 'accept_job');
  lists.bills = []; // decided elsewhere: the re-read no longer lists it
  await f.api.press('ZZTEST-item-1', 'record');
  assert.match(f.root.innerHTML, /data-rp-notice>Someone already decided this one\. It is no longer on the list\.</);
  assert.doesNotMatch(f.root.innerHTML, /reconcile_item_closed/);
  const kept = Object.assign(new Error('x'), { status: 409, body: { error: 'reconcile_job_not_live', message: 'That job is not live.' } });
  const g = fixture(undefined, kept);
  await g.api.refresh();
  await g.api.press('ZZTEST-item-1', 'accept_job');
  await g.api.press('ZZTEST-item-1', 'record');
  assert.match(g.root.innerHTML, /That job is not live\./);
  assert.doesNotMatch(g.root.innerHTML, /data-rp-notice/);
  await g.api.refresh();
  assert.doesNotMatch(g.root.innerHTML, /data-rp-notice|That job is not live/, 'a later read clears it');
});
