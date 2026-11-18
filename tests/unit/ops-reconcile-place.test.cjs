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
  assert.deepEqual([1240, -120.5, null, '', true].map(P.amountWords), ['$1,240.00 ex GST', '-$120.50 ex GST', 'Amount not read', 'Amount not read', 'Amount not read']);
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
  assert.equal(P.refusalWords({ status: 403, body: { error: 'person_session_required' } }), 'Please sign in again. A decision is recorded against your own sign in.');
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
  await f.api.press('ZZTEST-item-1', 'record');
  assert.equal(posts(f).length, 1, 'a finished card is never sent again');
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

test('a full page shows the overflow notice; a failed read never shows the list as clear', async () => {
  const many = Array.from({ length: 100 }, (_, i) => raw({ id: 'ZZTEST-' + i }));
  const f = fixture({ bills: many, card_bank: [], receipts: [] });
  await f.api.refresh();
  assert.match(f.root.innerHTML, /More may be waiting than this list shows/);
  const g = fixture();
  g.host.read = async () => { throw Object.assign(new Error('down'), { status: 503 }); };
  await g.api.refresh();
  assert.match(g.root.innerHTML, /The list could not be read\. Nothing is shown as placed\./);
  assert.doesNotMatch(g.root.innerHTML, /Nothing to place/);
});

test('a credit shows as a credit with its bill and the bill state, and can be placed, split or marked', async () => {
  const credit = (bill, extra = {}) => raw({ id: 'ZZTEST-credit', kind: 'credit', kind_words: 'Credit', amount_ex: -120.5,
    lines: [{ line_id: 'C1', description: 'Returned posts', amount_ex: -120.5 }], suggestion: null, bill, ...extra });
  const words = (bill) => P.billWords(P.itemFromList(credit(bill)));
  assert.equal(words({ document_number: 'ZZ-1', state: 'waiting', item_id: 'ZZTEST-item-1' }), 'Against bill ZZ-1: the bill is still waiting for a decision.');
  assert.equal(words({ document_number: 'ZZ-1', state: 'placed', job_id: J1, job_number: 'SWF-990001', job_site: '12 Test St' }), 'Against bill ZZ-1: the bill is on SWF-990001, 12 Test St.');
  assert.equal(words({ document_number: 'ZZ-1', state: 'overhead' }), 'Against bill ZZ-1: the bill is not for a job.');
  assert.equal(words({ document_number: 'ZZ-1', state: 'mystery' }), "Against bill ZZ-1: the bill's state was not read.");
  assert.equal(words(null), 'Not against a bill.');
  assert.equal(words(undefined), 'The bill this credit is against was not read.');

  // Bill undecided: shown plainly, the credit is still placeable on its own.
  const f = fixture({ bills: [raw(), credit({ document_number: 'ZZ-1', state: 'waiting', item_id: 'ZZTEST-item-1' })] });
  await f.api.refresh();
  assert.match(f.root.innerHTML, /Credit \$120\.50 ex GST/);
  assert.match(f.root.innerHTML, /Placing this credit does not decide its bill/);
  assert.match(f.root.innerHTML, /Show the bill/);
  await f.api.press('ZZTEST-credit', 'overhead');
  assert.match(f.root.innerHTML, /Mark the \$120\.50 ex GST credit as not for a job \(overhead\)\./);
  await f.api.press('ZZTEST-credit', 'record');
  assert.match(f.root.innerHTML, /Credit marked not for a job by you, just now\./);

  // Bill placed on a job: one press puts the credit where its bill is.
  const g = fixture({ bills: [credit({ document_number: 'ZZ-1', state: 'placed', job_id: J1, job_number: 'SWF-990001', job_site: '12 Test St' })] });
  await g.api.refresh();
  assert.match(g.root.innerHTML, /Put on SWF-990001, where its bill is/);
  await g.api.press('ZZTEST-credit', 'bill_job');
  assert.match(g.root.innerHTML, /Take \$120\.50 ex GST off SWF-990001, 12 Test St \(a credit\)\./);
  await g.api.press('ZZTEST-credit', 'record');
  assert.deepEqual(posts(g)[0].body, { item_id: 'ZZTEST-credit', shown_hash: 'hash-1', action: 'place', parts: [{ job_id: J1 }], note: null, accepted_suggestion: false });

  // A split credit sends negative parts that add up to the credit.
  const h = fixture({ bills: [credit({ document_number: 'ZZ-1', state: 'split' })] });
  await h.api.refresh();
  await h.api.press('ZZTEST-credit', 'split');
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
