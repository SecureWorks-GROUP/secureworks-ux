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
  assert.strictEqual(C.sendGate({ settings: s, linked: false, channel: 'sms' }).code, 'no_contact');
  assert.strictEqual(C.sendGate({ settings: s, linked: false, channel: 'email' }).ok, true, 'an email needs no GHL contact');
  const pp = C.sendGate({ settings: s, linked: true, possible: [{ amount: 1 }] });
  assert.deepStrictEqual([pp.ok, pp.code, pp.override], [false, 'possible_payment', true]);
  assert.strictEqual(C.sendGate({ settings: s, linked: true, possible: [] }).ok, true);
});
check('refusals: known codes in plain words, otherwise the backend reason, never a bare code', () => {
  const e = new Error('part_paid'); e.status = 409;
  assert.strictEqual(C.refusalText(e), C.REFUSALS.part_paid);
  assert.strictEqual(C.refusalText({ ok: false, code: 'possible_payment', reason: 'x' }), C.REFUSALS.possible_payment);
  const r = new Error('Sending is off'); r.refusal = { code: 'sending_off', fact: 'off' };
  assert.strictEqual(C.refusalText(r), C.REFUSALS.sending_off);
  const b = new Error('API error: 409'); b.body = { ok: false, code: 'already_sent' };
  assert.strictEqual(C.refusalText(b), C.REFUSALS.already_sent);
  assert.strictEqual(C.refusalText({ ok: false, code: 'weird_thing', reason: 'The bank feed could not be read.' }), 'The bank feed could not be read.');
  assert.strictEqual(C.refusalText({ ok: false, code: 'weird_thing' }), 'That did not go through. Nothing was sent.');
  assert.strictEqual(C.refusalText(new Error('Unknown action')), 'This part is not switched on yet: the backend has not been deployed.');
  assert.strictEqual(C.answerRefused({ ok: true }), false);
  assert.strictEqual(C.answerRefused({ ok: false }), true);
  assert.strictEqual(C.answerRefused({ ok: true, sent: false }), true);
});
check('not deployed: unknown action, 400 or 404', () => {
  const e = new Error('Unknown action'); e.status = 400;
  assert(C.isNotDeployed(e));
  const n = new Error('x'); n.status = 404;
  assert(C.isNotDeployed(n));
  const s = new Error('boom'); s.status = 500;
  assert(!C.isNotDeployed(s));
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

if (failed) { console.error(failed + ' debt-workshop check(s) failed'); process.exit(1); }
console.log('PASS debt-workshop: core rules, gates, refusals, thread, notes, ladder; no long dash or emoji in the module');
