// Rules test for the Debt Workshop screen (modules/ops-debt-workshop.js, docs/debt-workshop.md).
// Runs in the PR gate (npm run test:debt-workshop, part of test:e2e). Loads the module in a bare
// VM and checks the pure DebtWorkshopCore that every figure and button on the screen goes
// through: the job type filters, the donut matching the list, the list order, the next-step
// words (orange only when a draft is ready), the statement and send gates with their reasons,
// refusals in plain words, the tab flag, the conversation order, notes and the ladder.
// It also checks the module file itself carries no long dash and no emoji.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const FILE = 'modules/ops-debt-workshop.js';
const src = fs.readFileSync(FILE, 'utf8');
let failed = 0;
function check(name, fn) {
  try { fn(); } catch (e) { failed += 1; console.error('FAIL debt-workshop: ' + name + '\n  ' + e.message); }
}

const ctx = {
  document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {} },
  window: {}, localStorage: null, opsFetch: async () => ({}), opsPost: async () => ({ ok: true }), showToast() {},
  console, Intl, Date, Math, Number, String, Object, Array, JSON, Promise, setTimeout,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const C0 = ctx.DebtWorkshopCore;
// Answers built inside the VM have its own prototypes: compare them as plain JSON.
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const C = C0 && new Proxy(C0, { get: (o, k) => (typeof o[k] === 'function' ? (...a) => plain(o[k](...a)) : o[k]) });
if (!C) { console.error('FAIL debt-workshop: DebtWorkshopCore missing'); process.exit(1); }

check('the core sits between its sentinels', () => {
  assert(src.indexOf('// <debt-workshop-core>') >= 0 && src.indexOf('// </debt-workshop-core>') > src.indexOf('// <debt-workshop-core>'));
});
check('no long dash, no en dash and no emoji anywhere in the module', () => {
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    assert(!/[\u2013\u2014]/.test(line), 'dash on line ' + (i + 1) + ': ' + line.trim().slice(0, 80));
    assert(!/\p{Extended_Pictographic}/u.test(line), 'emoji on line ' + (i + 1) + ': ' + line.trim().slice(0, 80));
  });
});
check('the banned-text guard catches a long dash and an emoji in a message', () => {
  assert.strictEqual(C.hasBanned('Hi Sam, thanks'), false);
  assert.strictEqual(C.hasBanned('Hi Sam \u2014 thanks'), true);
  assert.strictEqual(C.hasBanned('Thanks \u{1F600}'), true);
});

check('Perth dates and words', () => {
  assert.strictEqual(C.perthDate(new Date('2026-09-30T23:30:00Z')), '2026-10-01');
  assert.strictEqual(C.dateWords('2026-10-17'), 'Sat 17 Oct');
  assert.strictEqual(C.whenWords('2026-10-08', '2026-10-08'), 'today');
  assert.strictEqual(C.whenWords('2026-10-09', '2026-10-08'), 'tomorrow');
  assert.strictEqual(C.whenWords('2026-10-13', '2026-10-08'), 'on Tue 13 Oct');
  assert.strictEqual(C.perthDay('2026-10-07T20:00:00Z'), '2026-10-08');
  assert.strictEqual(C.perthTime('2026-10-07T23:02:00Z'), '7:02am');
});

check('invoice names never repeat a word: Invoice INV-1059, Final invoice INV-1705', () => {
  assert.strictEqual(C.invoiceLabel(null, 'INV-1059'), 'Invoice INV-1059');
  assert.strictEqual(C.invoiceLabel('invoice', 'INV-1059'), 'Invoice INV-1059');
  assert.strictEqual(C.invoiceLabel('final', 'INV-1705'), 'Final invoice INV-1705');
  assert.strictEqual(C.invoiceLabel('go_ahead', 'INV-1068'), 'Go-ahead invoice INV-1068');
  assert.strictEqual(C.invoiceLabel('deposit', 'INV-1001'), 'Deposit invoice INV-1001');
  assert.strictEqual(C.invoiceLabel('progress', 'INV-1002'), 'Progress invoice INV-1002');
  assert.strictEqual(C.invoiceLabel(undefined, ''), 'Invoice');
  // The screen builds every invoice name through invoiceLabel, never "kind + ' invoice '".
  assert.ok(src.indexOf("kindWord(i.kind) + ' invoice '") < 0 && src.indexOf("kindWord(row.kind) + ' invoice '") < 0);
});
check('job type filter: fencing, patio, and the account lane or make-safe work is Insurance', () => {
  assert.strictEqual(C.typeKey({ job_type: 'fencing', lane: 'homeowner' }), 'fencing');
  assert.strictEqual(C.typeKey({ job_type: 'patio', lane: 'homeowner' }), 'patio');
  assert.strictEqual(C.typeKey({ job_type: 'makesafe' }), 'insurance');
  assert.strictEqual(C.typeKey({ job_type: null, lane: 'account' }), 'insurance');
  assert.strictEqual(C.typeKey({ job_type: 'mystery' }), 'other');
  assert.strictEqual(C.badge('patio').color, '#B5651D');
});

const ov = {
  rows: [
    { xero_invoice_id: 'a', job_type: 'fencing', lane: 'homeowner', category: 'active', amount_due: 1000, day: 2, step_due: { step: 'd1', label: 'Day 1 text' } },
    { xero_invoice_id: 'b', job_type: 'patio', lane: 'homeowner', category: 'active', amount_due: 2500.5, day: 5, step_due: null, next_step: { step: 'd7', date: '2026-10-10' } },
    { xero_invoice_id: 'c', job_type: 'fencing', lane: 'homeowner', category: 'escalating', amount_due: 1420.37, day: 12, step_due: { step: 'd12' } },
    { xero_invoice_id: 'd', job_type: 'patio', lane: 'homeowner', category: 'bad_debt', amount_due: 900, day: 30, on_jan_list: true, step_due: { step: 'd21' } },
    { xero_invoice_id: 'e', job_type: 'fencing', lane: 'homeowner', category: null, amount_due: 5900, day: 0 },
    { xero_invoice_id: 'f', job_type: 'makesafe', lane: 'account', category: 'bad_debt', amount_due: 400, day: 40 },
  ],
  companies: [
    { company_key: 'k1', name: 'Harbour Restoration', category: 'bad_debt', past_due: { count: 3, amount: 2413.1, oldest_days: 31 }, statement: { status: 'ready' } },
    { company_key: 'k2', name: 'Northside Strata', category: null, past_due: { count: 0, amount: 0 }, in_grace: { count: 1, amount: 300 }, statement: { status: 'nothing_due' } },
  ],
};
check('items: companies stand for the account lane, so its invoice rows are not counted twice', () => {
  const all = C.items(ov, 'all');
  assert.deepStrictEqual(all.map((i) => i.id), ['a', 'b', 'c', 'd', 'e', 'company:k1', 'company:k2']);
  assert.deepStrictEqual(C.items(ov, 'insurance').map((i) => i.id), ['company:k1', 'company:k2']);
  assert.deepStrictEqual(C.items(ov, 'patio').map((i) => i.id), ['b', 'd']);
  assert.deepStrictEqual(C.items({ rows: ov.rows }, 'insurance').map((i) => i.id), ['f'], 'with no companies the account rows show alone');
});
check('totals: by category from the same items, not-due left out of the donut', () => {
  const t = C.totals(C.items(ov, 'all'));
  assert.deepStrictEqual(t.active, { count: 2, amount: 3500.5 });
  assert.deepStrictEqual(t.escalating, { count: 1, amount: 1420.37 });
  assert.deepStrictEqual(t.bad_debt, { count: 4, amount: 3313.1 }, 'Quinn plus 3 company invoices');
  assert.deepStrictEqual(t.all, { count: 7, amount: 8233.97 });
  const f = C.totals(C.items(ov, 'fencing'));
  assert.deepStrictEqual(f.all, { count: 2, amount: 2420.37 });
});
check('default category: the first with something in it', () => {
  assert.strictEqual(C.defaultCategory(C.totals(C.items(ov, 'all'))), 'active');
  assert.strictEqual(C.defaultCategory(C.totals(C.items(ov, 'insurance'))), 'bad_debt');
  assert.strictEqual(C.defaultCategory(C.totals([])), 'active');
});
check('donut: one arc per category with money, arcs cover the circle, the picked one marked', () => {
  const t = C.totals(C.items(ov, 'all'));
  const segs = C.donut(t, 'escalating', 78);
  assert.deepStrictEqual(segs.map((s) => s.key), ['active', 'escalating', 'bad_debt']);
  assert.deepStrictEqual(segs.map((s) => s.on), [false, true, false]);
  const share = segs.reduce((a, s) => a + s.share, 0);
  assert(Math.abs(share - 1) < 1e-9);
  assert.strictEqual(C.donut(C.totals([]), 'active').length, 0);
});
check('list order: ready drafts first, then the oldest, then the biggest', () => {
  const list = C.listFor(C.items(ov, 'all'), 'active');
  assert.deepStrictEqual(list.map((i) => i.id), ['a', 'b']);
  const many = C.listFor([
    { type: 'row', id: 'x', category: 'active', amount: 10, day: 3, row: { step_due: null } },
    { type: 'row', id: 'y', category: 'active', amount: 50, day: 3, row: { step_due: null } },
    { type: 'row', id: 'z', category: 'active', amount: 5, day: 6, row: { step_due: null } },
    { type: 'row', id: 'r', category: 'active', amount: 1, day: 1, row: { step_due: { step: 'd1' } } },
  ], 'active');
  assert.deepStrictEqual(many.map((i) => i.id), ['r', 'z', 'y', 'x']);
});
check('all companies (Insurance): biggest past due first, nothing past due last', () => {
  const co = (k, cat, amt) => ({ company_key: k, name: k, category: cat, past_due: { count: amt ? 1 : 0, amount: amt } });
  const list = C.listFor(C.items({ rows: [], companies: [co('quiet', null, 0), co('small', 'escalating', 583), co('big', 'bad_debt', 2413.1)] }, 'insurance'), null);
  assert.deepStrictEqual(list.map((i) => i.id), ['company:big', 'company:small', 'company:quiet']);
});
check('next step words: orange only when a draft is ready; day 21 is a visit, not a message', () => {
  const today = '2026-10-08';
  assert.deepStrictEqual(C.nextStep(ov.rows[0], today), { text: 'Day 1 text ready', tone: 'ready' });
  assert.deepStrictEqual(C.nextStep(ov.rows[1], today), { text: 'Day 7 text + call on Sat 10 Oct', tone: 'plain' });
  assert.deepStrictEqual(C.nextStep(ov.rows[2], today), { text: 'Day 12 text ready', tone: 'ready' });
  assert.deepStrictEqual(C.nextStep(ov.rows[3], today), { text: 'On Jan\'s visit list', tone: 'plain' });
  assert.strictEqual(C.nextStep({ step_due: { step: 'd21' }, kind: 'progress' }, today).text, 'Hold, no more steps');
  assert.strictEqual(C.nextStep({ category: 'says_paid' }, today).tone, 'quiet');
  assert.strictEqual(C.nextStep({ paused_until: '2026-10-17' }, today).text, 'Paused until Sat 17 Oct');
  assert.strictEqual(C.nextStep({ suggestion: { status: 'pending' } }, today).tone, 'ready');
  assert.strictEqual(C.isReady({ step_due: { step: 'd21' } }), false);
  assert.strictEqual(C.dayText({ day: 12 }), 'day 12');
  assert.strictEqual(C.dayText({ day: 0 }), 'not due yet');
});
check('statement gate: says why it cannot be approved', () => {
  const on = { sending_on: true, viewer_is_owner: true };
  assert.deepStrictEqual(C.statementGate({ statement: { status: 'ready' } }, on), { ok: true, reason: '' });
  assert.strictEqual(C.statementGate({ statement: { status: 'ready' } }, { sending_on: false, viewer_is_owner: true }).reason, 'Sending is off until you switch it on');
  assert.strictEqual(C.statementGate({ statement: { status: 'no_email' } }, on).reason, 'No accounts email set');
  assert.strictEqual(C.statementGate({ statement: { status: 'sent' } }, on).reason, 'Sent this week');
  assert.strictEqual(C.statementGate({ statement: { status: 'ready' } }, { sending_on: true, viewer_is_owner: false }).reason, 'Only an owner can approve');
  assert.strictEqual(C.statementWords({ statement: { status: 'ready' } }).tone, 'ready');
});
check('send gate: sending off first, then owner, then contact, then a possible payment (overridable)', () => {
  const s = { sending_on: true, viewer_is_owner: true };
  assert.strictEqual(C.sendGate({ settings: { sending_on: false, viewer_is_owner: true }, linked: true }).reason, 'Sending is off until you switch it on');
  assert.strictEqual(C.sendGate({ settings: { sending_on: true, viewer_is_owner: false }, linked: true }).code, 'not_owner');
  assert.strictEqual(C.sendGate({ settings: s, linked: false, channel: 'sms' }).code, 'payer_not_linked');
  assert.strictEqual(C.sendGate({ settings: s, linked: false, channel: 'sms', who: 'Peter' }).reason, 'Link Peter\'s contact first', 'names the payer');
  assert.strictEqual(C.sendGate({ settings: s, linked: false, channel: 'email' }).ok, true, 'an email needs no GHL contact');
  const nb = C.sendGate({ settings: s, linked: true, channel: 'sms', who: 'Peter' });
  assert.deepStrictEqual([nb.ok, nb.code], [true, ''], 'a linked neighbour is texted at their own contact');
  const pp = C.sendGate({ settings: s, linked: true, possible: [{ amount: 1 }] });
  assert.deepStrictEqual([pp.ok, pp.code, pp.override], [false, 'possible_payment', true]);
  assert.strictEqual(C.sendGate({ settings: s, linked: true, possible: [] }).ok, true);
});
check('the payer: payer_contact wins over the job; an older backend reads as the job\'s client', () => {
  const J = { row: { payer_name: 'Riley Shaw', neighbour_of: 'Taylor Brooks' }, job: { client_name: 'Taylor Brooks', client_phone: '0400 000 111', ghl_contact_id: 'Ct7Qw000000111xRz' },
    payer_contact: { name: 'Riley Shaw', phone: '0400 000 222', email: 'riley@example.test', ghl_contact_id: null, label: 'B', is_primary: false } };
  const p = C.payerOf(J);
  assert.deepStrictEqual([p.name, p.phone, p.ghl_contact_id, p.is_primary, p.known], ['Riley Shaw', '0400 000 222', null, false, true], 'never the job\'s phone or contact');
  const old = C.payerOf({ row: { payer_name: 'Casey Morgan' }, job: { client_phone: '0400 000 003', ghl_contact_id: 'Ct7Qw000000003xRz' } });
  assert.deepStrictEqual([old.phone, old.ghl_contact_id, old.known], ['0400 000 003', 'Ct7Qw000000003xRz', false]);
  assert.strictEqual(C.firstName('Peter  Johnson'), 'Peter');
});
check('shared fence line: the payer\'s share first, paid or owing, nothing for a single share', () => {
  const shares = [
    { label: 'A', payer_name: 'Taylor Brooks', owing: 0, paid: true },
    { label: 'B', payer_name: 'Riley Shaw', owing: 1025.06, paid: false },
  ];
  assert.strictEqual(C.shareSummary(shares, 'B'), 'Shared fence: Riley (B) owes $1,025.06 · Taylor (A) paid');
  assert.strictEqual(C.shareSummary([{ label: 'main', payer_name: 'Casey Morgan', owing: 10, paid: false }], 'main'), '');
  assert.strictEqual(C.shareSummary(null, 'B'), '');
  assert.strictEqual(C.partyWords({ is_payer: false, party_name: 'Taylor Brooks' }), 'Taylor Brooks');
  assert.strictEqual(C.partyWords({ is_payer: true, party_name: 'Riley Shaw' }), '', 'the payer\'s own messages need no name');
});
check('a message not yet filed on a job gets a quiet label, every other message none', () => {
  assert.strictEqual(C.unplacedWords({ id: 'bev:u1', unplaced: true }), 'not yet filed on a job');
  assert.strictEqual(C.unplacedWords({ id: 'bev:p1' }), '');
  assert.strictEqual(C.unplacedWords({ id: 'bev:p2', unplaced: 'true' }), '', 'only a real true counts');
  assert.strictEqual(C.unplacedWords(null), '');
});
check('the GoHighLevel first name is hinted only when drafts use it and it differs from Xero', () => {
  const J = (p) => ({ row: { payer_name: 'Tuan Tran' }, payer_contact: Object.assign({ name: 'Tuan Tran' }, p) });
  assert.strictEqual(C.ghlNameHint(J({ greeting_name: 'Vincent', greeting_name_source: 'ghl' })), 'GHL: Vincent');
  assert.strictEqual(C.ghlNameHint(J({ greeting_name: 'Tuan', greeting_name_source: 'ghl' })), '', 'same name, no hint');
  assert.strictEqual(C.ghlNameHint(J({ greeting_name: 'Tuan', greeting_name_source: 'xero' })), '');
  assert.strictEqual(C.ghlNameHint(J({})), '', 'an older backend without the fields');
  assert.strictEqual(C.ghlNameHint({}), '');
});
check('refusals: known codes in plain words, otherwise the backend reason, never a bare code', () => {
  const e = new Error('part_paid'); e.status = 409;
  assert.strictEqual(C.refusalText(e), C.REFUSALS.part_paid);
  assert.strictEqual(C.refusalText({ ok: false, code: 'possible_payment', reason: 'x' }), C.REFUSALS.possible_payment);
  const r = new Error('Sending is off'); r.refusal = { code: 'sending_off', fact: 'off' };
  assert.strictEqual(C.refusalText(r), C.REFUSALS.sending_off);
  assert.strictEqual(C.refusalText({ ok: false, code: 'not_open' }), C.REFUSALS.not_open);
  const b = new Error('API error: 409'); b.body = { ok: false, code: 'already_sent' };
  assert.strictEqual(C.refusalText(b), C.REFUSALS.already_sent);
  assert.strictEqual(C.refusalText({ ok: false, code: 'weird_thing', reason: 'The bank feed could not be read.' }), 'The bank feed could not be read.');
  assert.strictEqual(C.refusalText({ ok: false, code: 'weird_thing' }), 'That did not go through. Nothing was sent.');
  assert.strictEqual(C.refusalText(new Error('Unknown action')), 'This part is not switched on yet: the backend has not been deployed.');
  assert.strictEqual(C.answerRefused({ ok: true }), false);
  assert.strictEqual(C.answerRefused({ ok: false }), true);
  assert.strictEqual(C.answerRefused({ ok: true, sent: false }), true);
});
check('not deployed: only an unknown action, never any other 400 or 404', () => {
  const e = new Error('Unknown action'); e.status = 400;
  assert(C.isNotDeployed(e));
  const c = new Error('x'); c.status = 400; c.code = 'unknown_action';
  assert(C.isNotDeployed(c));
  const n = new Error('That invoice is not in the debt book'); n.status = 404; n.code = 'not_in_book';
  assert(!C.isNotDeployed(n), 'a real 404 is an answer');
  const b = new Error('Unsupported field: x'); b.status = 400; b.code = 'debt_ws_bad_request';
  assert(!C.isNotDeployed(b), 'a real 400 is an answer');
  const s = new Error('boom'); s.status = 500;
  assert(!C.isNotDeployed(s));
});
check('the amount a draft was written for goes with the send', () => {
  assert.strictEqual(C.draftAmount({ amount: 1420.37 }, { amount_due: 900 }), 1420.37);
  assert.strictEqual(C.draftAmount({ amount: 0 }, { amount_due: 900 }), 900, 'falls back to the amount owing');
  assert.strictEqual(C.draftAmount({}, {}), null);
});
check('a promise pauses only while its date is still ahead (pausedUntil > today)', () => {
  assert.strictEqual(C.isPaused({ paused_until: '2026-10-09' }, '2026-10-08'), true);
  assert.strictEqual(C.isPaused({ paused_until: '2026-10-08' }, '2026-10-08'), false, 'the promised day itself is not paused');
  assert.strictEqual(C.isPaused({ paused_until: null }, '2026-10-08'), false);
  assert.notStrictEqual(C.nextStep({ paused_until: '2026-10-08', next_step: { step: 'd3', date: '2026-10-08' } }, '2026-10-08').text, 'Paused until Thu 8 Oct');
});
check('reply steps have their own labels', () => {
  assert.strictEqual(C.stepLabel('reply_says_paid'), 'Reply: says paid');
  assert.strictEqual(C.stepLabel('reply_promise'), 'Reply: promise to pay');
  assert.strictEqual(C.stepLabel('reply_problem'), 'Reply: problem raised');
});
check('a statement refused for possible payments lists the invoices', () => {
  // The backend shape: one entry per invoice, each with its possible payments.
  const a = C.statementPossible({ code: 'possible_payment', possible_payments: [
    { xero_invoice_id: 'x1', invoice_number: 'INV-9301', possible_payments: [{ amount: 1332.1, date: '2026-10-06', payer_text: 'HARBOUR RESTO' }] },
    { xero_invoice_id: 'x2', invoice_number: 'INV-9302', possible_payments: [{ amount: 561, date: null, payer_text: '' }] },
  ] });
  assert.deepStrictEqual(a, [{ invoice: 'INV-9301', words: '$1,332.10 on Tue 6 Oct from HARBOUR RESTO' }, { invoice: 'INV-9302', words: '$561.00' }]);
  assert.deepStrictEqual(C.statementPossible(null), []);
});
check('the tab shows with ?debt=1, the browser flag, or tab_visible', () => {
  assert.strictEqual(C.tabVisible('', null, null), false);
  assert.strictEqual(C.tabVisible('?debt=1', null, null), true);
  assert.strictEqual(C.tabVisible('?x=2&debt=1', null, null), true);
  assert.strictEqual(C.tabVisible('?debt=10', null, null), false);
  assert.strictEqual(C.tabVisible('', '1', null), true);
  assert.strictEqual(C.tabVisible('', '0', { tab_visible: false }), false);
  assert.strictEqual(C.tabVisible('', null, { tab_visible: true }), true);
});
check('a visibility read answers true, false, or unknown (unknown never hides the tab)', () => {
  assert.strictEqual(C.probeAnswer({ settings: { tab_visible: true } }), true);
  assert.strictEqual(C.probeAnswer({ settings: { tab_visible: false } }), false);
  assert.strictEqual(C.probeAnswer({ settings: {} }), null);
  assert.strictEqual(C.probeAnswer({}), null);
  assert.strictEqual(C.probeAnswer(null), null);
});
check('conversation: oldest first, newest at the bottom, a day line when the Perth day changes', () => {
  const th = C.thread({ messages: [
    { id: '3', occurred_at: '2026-10-07T02:00:00Z', body: 'c' },
    { id: '1', occurred_at: '2026-10-05T01:00:00Z', body: 'a' },
    { id: '2', occurred_at: '2026-10-05T03:00:00Z', body: 'b' },
  ] }, '2026-10-07');
  assert.deepStrictEqual(th.map((x) => x.type === 'day' ? 'day:' + x.label : x.m.id), ['day:Mon 5 Oct', '1', '2', 'day:Today', '3']);
  assert.strictEqual(C.callTitle({ direction: 'outbound', call_duration: 31, call_status: 'no_answer' }), 'Call out · 0:31 · no answer');
});
check('notes: a person\'s note reads normally, the screen\'s own records are muted', () => {
  assert.deepStrictEqual(C.noteView({ kind: 'note', body: 'Spoke to them' }).auto, false);
  const t = C.noteView({ kind: 'text_sent', step: 'd3', body: 'Hi...' });
  assert.deepStrictEqual([t.auto, t.text], [true, 'Day 3 text sent']);
  assert.strictEqual(C.noteView({ kind: 'promise', meta: { promise_date: '2026-10-17' } }).text, 'Promised to pay by Sat 17 Oct');
  assert.strictEqual(C.noteView({ kind: 'promise', body: 'Promised to pay by Friday the 17th of October', meta: { promise_date: '2026-10-17' } }).text, 'Promised to pay by Friday the 17th of October', 'the backend line, not doubled');
  assert.strictEqual(C.noteView({ kind: 'jan_list', meta: { removed: true } }).text, 'Removed from Jan\'s visit list');
  assert.strictEqual(C.noteView({ kind: 'jan_list', meta: {} }).text, 'Put on Jan\'s visit list');
  assert.strictEqual(C.noteView({ kind: 'category_change', body: 'Moved to Says paid' }).text, 'Moved to Says paid');
  assert.strictEqual(C.noteView({ kind: 'skip', step: 'd1' }).text, 'Day 1 text skipped');
});
check('ladder: the invoice first, then the steps with their state', () => {
  const l = C.ladder([{ step: 'd1', status: 'done', date: '2026-10-01' }, { step: 'd12', status: 'due', date: '2026-10-12' }, { step: 'd17', status: 'upcoming', date: '2026-10-17' }], '2026-09-30');
  assert.deepStrictEqual(l.map((n) => [n.label, n.status, n.when]), [['Invoice', 'done', 'Wed 30 Sep'], ['Day 1 text', 'done', 'Thu 1 Oct'], ['Day 12 text', 'due', 'ready now'], ['Day 17 final text', 'upcoming', 'Sat 17 Oct']]);
});
check('story and money: a few plain lines, invoices paid or owing', () => {
  const st = C.storyLines({ now: { line: 'Complete since Thu 25 Sep.', blockers: [{ what: 'Gate latch loose' }] }, timeline: [{ date: '2026-09-24', what: 'Install' }, { date: '2026-09-25', what: 'Done' }], money: { job_value: { amount: 4840 } } }, 4);
  assert.strictEqual(st.now, 'Complete since Thu 25 Sep.');
  assert.deepStrictEqual(st.blockers, ['Gate latch loose']);
  assert.strictEqual(st.recent.length, 2);
  assert.strictEqual(st.jobValue, 4840);
  assert.strictEqual(C.storyLines(null), null);
  const m = C.moneyRows([{ kind: 'progress', invoice_number: 'INV-1', total: 3419.63, amount_due: 0, status: 'PAID' }, { kind: 'final', invoice_number: 'INV-2', total: 1420.37, amount_due: 1420.37, status: 'AUTHORISED' }]);
  assert.deepStrictEqual(m.rows.map((r) => [r.label, r.paid]), [['Progress INV-1', true], ['Final INV-2', false]]);
  assert.strictEqual(m.owing, 1420.37);
  assert.strictEqual(C.paymentWords({ amount: 1420.37, date: '2026-10-06', payer: 'C MORGAN' }), '$1,420.37 on Tue 6 Oct from C MORGAN');
  assert.strictEqual(C.fileKind('application/pdf'), 'PDF');
  assert.strictEqual(C.fileKind('', 'photo.JPG'), 'IMG');
});

check('debt report: the Send words, the gate, the route and "last sent"', () => {
  const d = { from: 'admin@secureworkswa.com.au', to: ['marnin@secureworkswa.com.au'], cc: ['shaun@secureworkswa.com.au'], sending_on: true, viewer_is_owner: true, can_send: true, why_not: null };
  assert.strictEqual(C.nameFromEmail('marnin@secureworkswa.com.au'), 'Marnin');
  assert.strictEqual(C.reportSendLabel(d), 'Send to Marnin');
  assert.strictEqual(C.reportSendLabel({ to: ['a@secureworkswa.com.au', 'b@secureworkswa.com.au'] }), 'Send report');
  assert.deepStrictEqual(C.reportGate(d), { ok: true, reason: '' });
  assert.strictEqual(C.reportGate(Object.assign({}, d, { viewer_is_owner: false })).reason, 'Only an owner can send the report.');
  assert.strictEqual(C.reportGate(Object.assign({}, d, { sending_on: false })).reason, 'Sending is off until you switch it on.');
  assert.strictEqual(C.reportGate(Object.assign({}, d, { can_send: false, why_not: 'No one is set to receive the report' })).reason, 'No one is set to receive the report.');
  assert.strictEqual(C.reportRoute(d), 'Sends from admin@secureworkswa.com.au to marnin@secureworkswa.com.au, cc shaun@secureworkswa.com.au.');
  assert.strictEqual(C.reportLastSent(null, d, '2026-10-15'), 'Last sent to Marnin: never');
  assert.strictEqual(C.reportLastSent({ at: '2026-10-15T01:02:00Z', to: ['marnin@secureworkswa.com.au'], by: 'Shaun' }, d, '2026-10-15'), 'Last sent to Marnin: today, 9:02am by Shaun');
  assert.strictEqual(C.reportLastSent({ at: '2026-10-12T00:00:00Z', kind: 'auto', to: ['marnin@secureworkswa.com.au'] }, d, '2026-10-15'), 'Last sent to Marnin: Mon 12 Oct, 8:00am (Monday auto-send)');
  assert.strictEqual(C.reportRefusalText({ code: 'send_not_confirmed' }), 'The email could not be confirmed. Check Sent Items in the admin mailbox before sending it again.');
  assert.strictEqual(C.reportRefusalText({ code: 'recently_sent' }), C.REFUSALS.recently_sent);
});

// ── The chat window (approved 16 Oct 2026) ──
check('chat window: the green Proposed words per step, the bar\'s who and its second line', () => {
  assert.strictEqual(C.proposedWords('d7'), 'day 7 reminder (with a call)');
  assert.strictEqual(C.proposedWords('d1'), 'day 1 reminder');
  assert.strictEqual(C.proposedWords('d17'), 'day 17 final reminder');
  assert.strictEqual(C.proposedWords('reply_problem'), 'reply to a problem raised');
  assert.strictEqual(C.payerTitle({ name: 'Riley Shaw', label: 'B' }), 'Riley Shaw (B)');
  assert.strictEqual(C.payerTitle({ name: 'Casey Morgan', label: 'main' }), 'Casey Morgan', 'one payer: no letter');
  assert.strictEqual(C.chatSub({ invoice_number: 'INV-1703', amount_due: 1216.63, day: 8 }), 'Texts go from 771 · INV-1703 · $1,216.63 · day 8');
  assert.strictEqual(C.stepLabel('manual'), 'Manual text');
  assert.strictEqual(C.noteView({ kind: 'text_sent', step: 'manual', body: 'Thanks' }).text, 'Manual text sent');
});
check('chat window: Debt log notes and promises are yellow lines in time order; the screen\'s own records stay out', () => {
  const conv = { messages: [
    { id: 'm1', channel: 'sms', direction: 'outbound', occurred_at: '2026-10-06T01:02:00Z', body: 'Day 1' },
    { id: 'm2', channel: 'sms', direction: 'inbound', occurred_at: '2026-10-08T08:41:00Z', body: 'Sorry, I will sort it this week' },
  ] };
  const notes = [
    { id: 'n1', kind: 'note', body: 'said she would pay by Friday', created_by_name: 'Shaun', created_at: '2026-10-08T08:50:00Z', xero_invoice_ids: ['inv-a'] },
    { id: 'n2', kind: 'text_sent', step: 'd1', created_by_name: 'Shaun', created_at: '2026-10-06T01:02:00Z', xero_invoice_ids: ['inv-a'] },
    { id: 'n3', kind: 'promise', body: 'Promised to pay by Friday the 10th of October', created_by_name: 'Shaun', created_at: '2026-10-07T02:00:00Z', xero_invoice_ids: ['inv-a'] },
    { id: 'n4', kind: 'note', body: 'Neighbour paid share A', created_by_name: 'Shaun', created_at: '2026-10-07T03:00:00Z', xero_invoice_ids: ['inv-b'] },
    { id: 'n5', kind: 'call', body: 'no answer', created_by_name: 'Shaun', created_at: '2026-10-07T04:00:00Z', xero_invoice_ids: [] },
  ];
  const mine = C.chatItems(conv, notes, '2026-10-08', { invoiceId: 'inv-a' });
  assert.deepStrictEqual(mine.map((x) => x.type === 'day' ? 'day:' + x.label : x.m.id), ['day:Tue 6 Oct', 'm1', 'day:Yesterday', 'dlog:n3', 'dlog:n5', 'day:Today', 'm2', 'dlog:n1']);
  const line = mine.find((x) => x.m && x.m.id === 'dlog:n1').m;
  assert.deepStrictEqual([line.channel, line.text], ['dlog', 'Note by Shaun: said she would pay by Friday']);
  assert.strictEqual(mine.find((x) => x.m && x.m.id === 'dlog:n3').m.text, 'Promise by Shaun: Promised to pay by Friday the 10th of October');
  assert.strictEqual(mine.find((x) => x.m && x.m.id === 'dlog:n5').m.text, 'Call note by Shaun: no answer');
  // Everyone on this job: the other share's note shows too.
  const all = C.chatItems(conv, notes, '2026-10-08', { invoiceId: 'inv-a', all: true });
  assert(all.some((x) => x.m && x.m.id === 'dlog:n4'));
  assert.strictEqual(C.chatItems({ messages: [] }, [], '2026-10-08', {}).length, 0);
});
check('chat window: what the bottom holds, and why nothing goes when it cannot', () => {
  const today = '2026-10-08';
  const ok = { allowed: true, code: null, reason: null };
  const draft = { kind: 'draft', step: 'd12', text: 'Hi Casey' };
  const mode = (J, own) => C.composeMode(J, today, own);
  assert.strictEqual(mode({ row: {}, suggestion: draft, manual_text: ok }).mode, 'step', 'the proposed step first');
  assert.deepStrictEqual(mode({ row: {}, suggestion: draft, manual_text: ok }, true), { mode: 'manual', reason: '', proposed: true }, 'own text, with the step to put back');
  assert.strictEqual(mode({ row: {}, suggestion: draft }, true).mode, 'step', 'an older backend: only the proposed step');
  assert.strictEqual(mode({ row: {}, suggestion: draft, manual_text: { allowed: false, code: 'not_chased_by_text', reason: 'x' } }, true).mode, 'step');
  const between = mode({ row: { next_step: { step: 'd17', date: '2026-10-13' } }, suggestion: null, manual_text: ok });
  assert.deepStrictEqual(between, { mode: 'manual', reason: '', next: 'Day 17 final text on Tue 13 Oct' }, 'no step today: your own text');
  assert.strictEqual(mode({ row: { next_step: { step: 'd17', date: '2026-10-13' } }, suggestion: null }).reason, 'Nothing to send today. Next: Day 17 final text on Tue 13 Oct.');
  // Paused chasing (Shaun, 16 Oct 2026): the reason shows above an empty box for his own text.
  assert.deepStrictEqual(mode({ row: { category: 'says_paid' }, manual_text: ok }), { mode: 'manual', reason: '', paused: 'They say they have paid. Follow-ups are paused while Xero catches up.' });
  assert.strictEqual(mode({ row: { category: 'rectification' }, manual_text: ok }).paused, 'In Rectification. Chasing stops until the fix is done.');
  assert.strictEqual(mode({ row: { paused_until: '2026-10-10' }, manual_text: ok }).paused, 'Follow-ups paused until Sat 10 Oct, a promise to pay.');
  assert.deepStrictEqual(mode({ row: { on_jan_list: true }, manual_text: ok }), { mode: 'manual', reason: '', paused: 'On Jan\'s visit list. No more texts.' });
  // An older backend without manual_text: the reason in place of the box, as before.
  assert.deepStrictEqual(mode({ row: { category: 'rectification' } }), { mode: 'none', reason: 'In Rectification. Chasing stops until the fix is done.' });
  // Still no text from here: a company invoice, a contact never chased, paid in Xero.
  assert.deepStrictEqual(mode({ row: { lane: 'account' }, manual_text: ok }), { mode: 'none', reason: 'Company invoices go on the Monday statement, not a text.' });
  assert.deepStrictEqual(mode({ row: { not_chased: true, category: 'says_paid' }, manual_text: ok }), { mode: 'none', reason: 'This contact is never chased, so no texts go from here.' });
  assert.strictEqual(mode({ row: {}, manual_text: { allowed: false, code: 'not_chased_by_text', reason: 'This invoice is no longer open in our Xero copy' } }).reason, 'This invoice is no longer open in our Xero copy.');
  assert.strictEqual(mode({ row: { open: false }, suggestion: draft, manual_text: ok }).mode, 'none', 'paid in Xero: nothing to send');
  assert.strictEqual(mode({ row: {}, suggestion: { kind: 'move' }, manual_text: ok }).mode, 'move');
});

// ════════════════════════════════════════════════════════════
// CONTRACT WITH THE BACKEND
// The screen must only word codes ops-api really throws, and only post fields ops-api accepts
// (each debt_ws_ POST refuses any field outside its onlyKeys list with a 400).
//
// BACKEND_CODES and BACKEND_ONLY_KEYS are a hand copy of secureworks-backend
// supabase/functions/ops-api/debt_ws_actions.ts (and the read/write codes in debt_ws_store.ts).
// CI has only this repo, so the checks always run against this copy. When the backend sits next
// to this worktree (../backend-debt-workshop, or DEBT_WS_BACKEND_DIR), the copy is also checked
// against the real files: if that check fails, the backend changed, so UPDATE THE COPY BELOW.
// ════════════════════════════════════════════════════════════
const path = require('path');
const BACKEND_CODES = [
  'DEBT_WS_FAILED', 'METHOD_NOT_ALLOWED', 'already_sent', 'amount_required', 'bank_check_unavailable', 'contact_already_linked',
  'contact_belongs_to_other_payer', 'contact_row_not_found', 'conversation_unreadable',
  'debt_ws_bad_request', 'debt_ws_read_failed', 'debt_ws_write_failed', 'email_failed', 'jan_list_changed',
  'jan_list_closed', 'job_mismatch', 'job_not_found', 'no_email', 'no_job', 'no_recipients', 'not_chased_by_text', 'not_found',
  'not_in_book', 'not_open', 'not_owner', 'nothing_due', 'operator_access_required', 'owner_not_set', 'paid',
  'part_paid', 'payer_not_linked', 'payer_not_on_job', 'possible_payment', 'recently_sent', 'recipient_not_internal',
  'report_pdf_failed', 'send_not_confirmed', 'send_refused_by_guard', 'sending_off',
  'server_key_required', 'step_not_due', 'suggestion_mismatch', 'suggestion_not_pending', 'text_not_allowed',
  'unknown_action', 'user_required', 'xero_rate_limited', 'xero_unavailable',
];
const BACKEND_ONLY_KEYS = {
  debt_ws_note: ['xero_invoice_id', 'company_key', 'share_key', 'job_id', 'body', 'note', 'text', 'promise_date'],
  debt_ws_decide: ['xero_invoice_id', 'step', 'suggestion_id', 'action', 'text', 'override_possible_payment', 'amount', 'channel', 'client_ref'],
  debt_ws_set_category: ['xero_invoice_id', 'category', 'suggestion_id'],
  debt_ws_link_contact: ['job_id', 'ghl_contact_id', 'xero_invoice_id', 'replace'],
  debt_ws_statement_send: ['company_key', 'override_possible_payment'],
  debt_ws_jan_list_remove: ['share_key', 'visit_date'],
  debt_ws_agent_submit: ['xero_invoice_id', 'xero_invoice_ids', 'step', 'kind', 'channel', 'text', 'why', 'proposed_category', 'agent_version'],
  // The debt report send takes no fields: the backend reads the recipients from its settings.
  debt_ws_report_send: [],
};
// Fields every dashboard POST carries (opsPost adds operator_email); the backend's ENVELOPE.
const ENVELOPE = ['action', 'operator_email'];
// Codes or fields the screen handles ahead of a backend change that adds them. Keep this empty
// unless a backend PR is pending; once it lands, the drift check below fails until they move
// into BACKEND_CODES / BACKEND_ONLY_KEYS.
const AHEAD = { codes: [], keys: {} };

// Reads the backend's codes and onlyKeys lists out of its source text.
function readBackend(dir) {
  const actionsFile = path.join(dir, 'supabase', 'functions', 'ops-api', 'debt_ws_actions.ts');
  const storeFile = path.join(dir, 'supabase', 'functions', 'ops-api', 'debt_ws_store.ts');
  if (!fs.existsSync(actionsFile)) return null;
  // Windows checkouts may carry CRLF line ends: read them as plain newlines.
  const text = (fs.readFileSync(actionsFile, 'utf8') + '\n' + (fs.existsSync(storeFile) ? fs.readFileSync(storeFile, 'utf8') : '')).replace(/\r\n/g, '\n');
  const codes = new Set();
  const add = (re) => { for (const m of text.matchAll(re)) m.slice(1).forEach((c) => { if (c) codes.add(c); }); };
  add(/new DebtWsError\(\s*(?:"[^"]*"|`[^`]*`|'[^']*'|[^,()]+(?:\([^()]*\))?)\s*,\s*\d{3}\s*,\s*"([A-Za-z_]+)"/g); // (message, status, "code")
  add(/new DebtWsError\([\s\S]{0,400}?\n\s*\d{3},\n\s*"([A-Za-z_]+)"/g); // the same, spread over lines
  add(/\bbad\(\s*(?:"[^"]*"|`[^`]*`)\s*,\s*"([a-z_]+)"\s*,?\s*\)/g); // bad(message, "code")
  add(/\brefuse\(\s*deps,\s*input,\s*(?:\w+\s*\?\s*"([a-z_]+)"\s*:\s*)?"([a-z_]+)"/g); // refuse(deps, input, "code")
  add(/\b(?:refuseStatement|release|refuseReport)\(\s*"([a-z_]+)"/g); // the statement, Jan list and debt report refusals
  add(/\bconst code = \w+ \? "([a-z_]+)" : "([a-z_]+)"/g);
  add(/\bcode: "([A-Za-z_]+)"/g);
  add(/\bcode = "([A-Za-z_]+)"/g); // the default code
  const keys = {};
  for (const m of text.matchAll(/export async function (debtWs\w+)\([\s\S]*?\n}\n/g)) {
    const ok = /onlyKeys\(body,\s*\[([\s\S]*?)\]\)/.exec(m[0]);
    if (!ok) continue;
    const action = m[1].replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    keys[action] = [...ok[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  }
  return { file: actionsFile, codes: [...codes].sort(), keys };
}

// Drives every write on the screen with the fixture and records each POST body.
async function uxPosts() {
  const { buildDebtWorkshopFixture } = require('../tests/fixtures/debt-workshop');
  const fx = buildDebtWorkshopFixture('2026-10-08', { settings: { sending_on: true, viewer_is_owner: true } });
  const sent = [];
  ctx.opsPost = async (action, body) => { sent.push({ action, body: JSON.parse(JSON.stringify(body || {})) }); return { ok: true }; };
  ctx.opsFetch = () => new Promise(() => {}); // the re-reads after a write never land, so they cannot disturb the next step
  const DW = ctx.DW;
  const onJob = (id) => { DW.ov = JSON.parse(JSON.stringify(fx.overview)); DW.view = 'job'; DW.jobId = id; DW.job = JSON.parse(JSON.stringify(fx.jobs[id])); DW.busy = null; };
  onJob(fx.ids.casey);
  await ctx.dwSend(false);
  onJob(fx.ids.casey); await ctx.dwSend(true);
  onJob(fx.ids.casey); await ctx.dwSkip();
  onJob(fx.ids.casey); await ctx.dwDismiss(fx.ids.caseyFlag);
  onJob(fx.ids.casey); DW.noteText = 'Spoke to them'; DW.promise = '2026-10-17'; await ctx.dwSaveNote();
  onJob(fx.ids.casey); await ctx.dwSetCategory('says_paid');
  onJob(fx.ids.casey); await ctx.dwSetCategory('rectification');
  onJob(fx.ids.jamie); await ctx.dwSetCategory('clear');
  onJob(fx.ids.sasha); await ctx.dwMove();
  onJob(fx.ids.sasha); await ctx.dwKeep();
  onJob(fx.ids.avery); await ctx.dwLink(fx.ids.averyContact);
  onJob(fx.ids.riley); await ctx.dwLink(fx.ids.rileyContact);
  onJob(fx.ids.avery); await ctx.dwSend(false);
  // A manual text: Shaun's own words in the reply box, posted as step "manual" with a client_ref.
  onJob(fx.ids.casey); DW.own[fx.ids.casey] = true; DW.refs[fx.ids.casey] = '70000000-0000-4000-8000-000000000001';
  DW.drafts[fx.ids.casey + ':manual'] = 'Thanks Casey, Friday is fine.\n\nCheers,\nShaun'; await ctx.dwSend(false);
  // The reply box holds the proposed step's text word for word (the template, untouched).
  onJob(fx.ids.casey); DW.own[fx.ids.casey] = false; delete DW.drafts[ctx.dwDraftKey()];
  const replyBox = /<textarea[^>]*id="dwReply"[^>]*>([\s\S]*?)<\/textarea>/.exec(ctx.dwMiddleHtml(DW.job));
  const unesc = (h) => h.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const proposedInBox = replyBox ? unesc(replyBox[1]) : null;
  DW.view = 'list'; DW.ov = JSON.parse(JSON.stringify(fx.overview));
  await ctx.dwApprove(fx.ids.harbour, false);
  await ctx.dwApprove(fx.ids.harbour, true);
  await ctx.dwJanRemove(fx.ids.drew);
  // The debt report: Send asks first, then posts on "Yes, send it".
  DW.view = 'report'; DW.rep = JSON.parse(JSON.stringify(fx.report)); DW.repBusy = null; DW.repConfirm = false;
  ctx.dwReportSend();
  const askedFirst = sent.filter((p) => p.action === 'debt_ws_report_send').length === 0 && DW.repConfirm === true;
  await ctx.dwReportSendConfirm();
  return { sent, fx, askedFirst, proposedInBox };
}

(async () => {
  let posted = null;
  try { posted = await uxPosts(); } catch (e) { failed += 1; console.error('FAIL debt-workshop: driving the screen writes\n  ' + (e && e.stack)); }
  if (posted) {
    const { sent, fx, askedFirst, proposedInBox } = posted;
    check('the reply box holds the proposed step\'s text exactly as the template wrote it', () => {
      assert.strictEqual(proposedInBox, fx.jobs[fx.ids.casey].suggestion.text);
    });
    check('a manual text posts step "manual" with the amount owing and its client_ref, no suggestion', () => {
      const m = sent.filter((p) => p.action === 'debt_ws_decide' && p.body.step === 'manual');
      assert.strictEqual(m.length, 1);
      assert.deepStrictEqual(m[0].body, { xero_invoice_id: fx.ids.casey, step: 'manual', action: 'send', text: 'Thanks Casey, Friday is fine.\n\nCheers,\nShaun', channel: 'sms', amount: 1420.37, client_ref: '70000000-0000-4000-8000-000000000001' });
    });
    check('every write on the screen was driven', () => {
      const seen = new Set(sent.map((p) => p.action));
      ['debt_ws_decide', 'debt_ws_note', 'debt_ws_set_category', 'debt_ws_link_contact', 'debt_ws_statement_send', 'debt_ws_jan_list_remove', 'debt_ws_report_send'].forEach((a) => assert(seen.has(a), a + ' was not posted'));
    });
    check('the debt report asks first: Send posts nothing until "Yes, send it", then posts once with no fields', () => {
      assert.strictEqual(askedFirst, true);
      const rs = sent.filter((p) => p.action === 'debt_ws_report_send');
      assert.strictEqual(rs.length, 1);
      assert.deepStrictEqual(rs[0].body, {});
    });
    check('every send carries the amount the draft was written for', () => {
      const sends = sent.filter((p) => p.action === 'debt_ws_decide' && p.body.action === 'send');
      assert.strictEqual(sends.length, 5, 'casey twice, the move reply, avery, casey\'s own text');
      sends.forEach((p) => assert(Number(p.body.amount) > 0, 'no amount on a ' + p.body.step + ' send'));
      assert.deepStrictEqual(sends.map((p) => p.body.amount), [1420.37, 1420.37, 2101, 1351.63, 1420.37]);
      assert.strictEqual(sends[2].body.step, 'reply_problem', 'the move reply is sent on its reply step');
    });
    check('Link contact posts the invoice, so the backend links its PAYER (a neighbour\'s own row on a shared fence)', () => {
      const links = sent.filter((p) => p.action === 'debt_ws_link_contact');
      assert.deepStrictEqual(links.map((p) => [p.body.xero_invoice_id, p.body.ghl_contact_id]), [[fx.ids.avery, fx.ids.averyContact], [fx.ids.riley, fx.ids.rileyContact]]);
    });
    check('Change beside the pill posts set_category with no suggestion_id', () => {
      const own = sent.filter((p) => p.action === 'debt_ws_set_category' && !('suggestion_id' in p.body));
      assert.deepStrictEqual(own.map((p) => [p.body.category, p.body.xero_invoice_id]), [['says_paid', fx.ids.casey], ['rectification', fx.ids.casey], ['clear', fx.ids.jamie]]);
    });
    check('every POST field is one ops-api accepts for that action (onlyKeys)', () => {
      sent.forEach((p) => {
        const allowed = [].concat(ENVELOPE, BACKEND_ONLY_KEYS[p.action] || [], AHEAD.keys[p.action] || []);
        assert(BACKEND_ONLY_KEYS[p.action], p.action + ' is not a backend write');
        Object.keys(p.body).forEach((k) => assert(allowed.includes(k), p.action + ' sends "' + k + '", which the backend refuses'));
      });
    });
  }
  check('every refusal the screen words is a code the backend throws', () => {
    const known = new Set([].concat(BACKEND_CODES, AHEAD.codes));
    Object.keys(C0.REFUSALS).forEach((code) => assert(known.has(code), 'REFUSALS.' + code + ' is not a backend code'));
  });

  const dir = process.env.DEBT_WS_BACKEND_DIR || path.resolve(process.cwd(), '..', 'backend-debt-workshop');
  const be = readBackend(dir);
  if (!be) {
    console.log('NOTE debt-workshop: backend source not found at ' + dir + '; the contract was checked against the copy in this test only.');
  } else {
    check('the backend copy in this test matches ' + path.relative(process.cwd(), be.file) + ' (if not, update BACKEND_CODES)', () => {
      const missing = be.codes.filter((c) => !BACKEND_CODES.includes(c) && !AHEAD.codes.includes(c));
      const gone = BACKEND_CODES.filter((c) => !be.codes.includes(c));
      const landed = AHEAD.codes.filter((c) => be.codes.includes(c));
      assert.deepStrictEqual({ missing, gone, landed }, { missing: [], gone: [], landed: [] });
    });
    check('the onlyKeys copy matches the backend (if not, update BACKEND_ONLY_KEYS)', () => {
      Object.keys(BACKEND_ONLY_KEYS).forEach((a) => {
        assert(be.keys[a], a + ' has no onlyKeys list in the backend');
        const ahead = AHEAD.keys[a] || [];
        assert.deepStrictEqual(be.keys[a].filter((k) => !ahead.includes(k)).sort(), BACKEND_ONLY_KEYS[a].slice().sort(), a);
        ahead.forEach((k) => assert(!be.keys[a].includes(k), a + '.' + k + ' has landed in the backend: move it out of AHEAD'));
      });
    });
    console.log('debt-workshop: contract checked against ' + be.file);
  }

  // The nav button in a bare page: a failed read keeps the tab as last seen and tries again;
  // only a real answer from the backend shows or hides it.
  async function probeRun(answers, seen) {
    const store = seen == null ? {} : { sw_debt_ws_seen: seen };
    const btn = { style: { display: 'none' } };
    const timers = [];
    const pctx = {
      document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}), querySelectorAll: () => [btn], addEventListener() {}, visibilityState: 'visible' },
      window: { location: { search: '' } },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
      opsFetch: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; },
      opsPost: async () => ({ ok: true }), showToast() {},
      console, Intl, Date, Math, Number, String, Object, Array, JSON, Promise,
      setTimeout: (fn, ms) => { timers.push(ms); return timers.length; },
    };
    vm.createContext(pctx);
    vm.runInContext(src, pctx);
    const out = [];
    out.push(await pctx.debtWsProbeVisibility());
    out.push(btn.style.display);
    return { out, store, timers };
  }
  for (const [name, fn] of [
    ['a failed first read keeps a tab seen before, and schedules a retry', async () => {
      const r = await probeRun([new Error('API error: 401')], '1');
      assert.deepStrictEqual(r.out, [true, '']);
      assert.deepStrictEqual(r.timers, [5000]);
    }],
    ['a failed read on a first visit leaves the tab hidden and retries', async () => {
      const r = await probeRun([new Error('timeout')], null);
      assert.deepStrictEqual(r.out, [false, 'none']);
      assert.deepStrictEqual(r.timers, [5000]);
    }],
    ['tab_visible true shows the tab and remembers it', async () => {
      const r = await probeRun([{ settings: { tab_visible: true } }], null);
      assert.deepStrictEqual(r.out, [true, '']);
      assert.strictEqual(r.store.sw_debt_ws_seen, '1');
      assert.deepStrictEqual(r.timers, []);
    }],
    ['tab_visible false hides a remembered tab and forgets it', async () => {
      const r = await probeRun([{ settings: { tab_visible: false } }], '1');
      assert.deepStrictEqual(r.out, [false, 'none']);
      assert.strictEqual(r.store.sw_debt_ws_seen, '0');
    }],
  ]) {
    try { await fn(); } catch (e) { failed += 1; console.error('FAIL debt-workshop: ' + name + '\n  ' + e.message); }
  }

  if (failed) { console.error(failed + ' debt-workshop check(s) failed'); process.exit(1); }
  console.log('PASS debt-workshop: core rules, gates, refusals, thread, notes, ladder, backend contract; no long dash or emoji in the module');
})();
