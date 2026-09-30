// Rules test for the Clear Debt desk screen (modules/ops-clear-debt-desk.js).
// Runs in the PR gate. Loads the module in a bare VM and checks the pure core that
// every figure on the screen goes through: Perth-date ages, the no-due-date bucket,
// the header (overdue includes holds, with check first and fix first shown beside it),
// the Xero stamp, the morning-list order, holds shown with no draft and never approved,
// the outcome and promise checks, and that the send button can never be armed.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync('modules/ops-clear-debt-desk.js', 'utf8');
let failed = 0;
function check(name, fn) {
  try { fn(); } catch (e) { failed += 1; console.error('FAIL clear-debt-desk: ' + name + '\n  ' + e.message); }
}

const posts = [];
const ctx = { document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}), querySelectorAll: () => [] }, window: {}, localStorage: null, opsFetch: async () => ({}), opsPost: async (action, body) => { posts.push({ action, body }); return { ok: true }; }, showToast() {}, console, Intl, Date, Math, Number, String, Object, Array, JSON, Promise };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const C = ctx.ClearDebtDeskCore;

check('core is exposed', () => { assert(C && typeof C.bookTotals === 'function'); });
if (!C) { console.error('FAIL clear-debt-desk: ClearDebtDeskCore missing'); process.exit(1); }

check('Perth date: 23:30 UTC on 30 Sep is 1 Oct in Perth', () => {
  assert.strictEqual(C.perthDate(new Date('2026-09-30T23:30:00Z')), '2026-10-01');
  assert.strictEqual(C.perthDate(new Date('2026-09-30T15:59:00Z')), '2026-09-30');
  assert.strictEqual(C.perthDate(new Date('2026-09-30T16:00:00Z')), '2026-10-01');
});
check('days past due count Perth calendar days; the due date itself is not overdue', () => {
  assert.strictEqual(C.daysPast('2026-09-29', '2026-10-01'), 2);
  assert.strictEqual(C.daysPast('2026-10-01', '2026-10-01'), 0);
  assert.strictEqual(C.daysPast('2026-10-07', '2026-10-01'), -6);
  assert.strictEqual(C.daysPast('2026-09-29T00:00:00', '2026-10-01'), 2);
  assert.strictEqual(C.daysPast(null, '2026-10-01'), null);
  assert.strictEqual(C.daysPast('', '2026-10-01'), null);
});
check('age buckets: no due date is its own bucket, never not due and never 90+', () => {
  assert.strictEqual(C.ageBucket(null), 'no_due');
  assert.strictEqual(C.ageBucket(0), 'not_due');
  assert.strictEqual(C.ageBucket(-3), 'not_due');
  assert.strictEqual(C.ageBucket(1), '1_30');
  assert.strictEqual(C.ageBucket(30), '1_30');
  assert.strictEqual(C.ageBucket(31), '31_60');
  assert.strictEqual(C.ageBucket(61), '61_90');
  assert.strictEqual(C.ageBucket(91), '90_plus');
});

const today = '2026-10-01';
const book = [
  { xero_invoice_id: 'a', payer: 'client', is_debt: true, hold: null, due_date: '2026-09-29', amount_due: 1000 },
  { xero_invoice_id: 'b', payer: 'client', is_debt: true, hold: null, due_date: '2026-10-07', amount_due: 500 },
  { xero_invoice_id: 'c', payer: 'mlb', is_debt: true, hold: null, due_date: '2026-08-01', amount_due: 300 },
  { xero_invoice_id: 'd', payer: 'other_builder', is_debt: true, hold: 'check_first', hold_reason: 'Builder rejected', due_date: '2026-05-01', amount_due: 200 },
  { xero_invoice_id: 'e', payer: 'client', is_debt: true, hold: 'fix_first', due_date: '2026-09-20', amount_due: 150 },
  { xero_invoice_id: 'f', payer: 'aj', is_debt: true, hold: null, due_date: null, amount_due: 70 },
  { xero_invoice_id: 'g', payer: 'client', is_debt: false, kind: 'deposit', hold: null, due_date: '2026-09-01', amount_due: 2000 },
  { xero_invoice_id: 'h', payer: 'not_chased', is_debt: false, kind: 'builder', hold: null, due_date: '2026-06-01', amount_due: 5.5 },
];
check('header totals: overdue is the whole debt past due (holds included); holds shown beside it', () => {
  const t = C.bookTotals(book, today);
  assert.deepStrictEqual([t.open.n, t.open.amount], [8, 4225.5]);
  assert.deepStrictEqual([t.debt.n, t.debt.amount], [6, 2220]);
  assert.deepStrictEqual([t.notDebt.n, t.notDebt.amount], [2, 2005.5]);
  assert.deepStrictEqual([t.overdue.n, t.overdue.amount], [4, 1650], 'overdue = a + c + d + e, matching Xero');
  assert.deepStrictEqual([t.overdueHeld.n, t.overdueHeld.amount], [2, 350], 'of which on hold = d + e');
  assert.deepStrictEqual([t.checkFirst.n, t.checkFirst.amount], [1, 200]);
  assert.deepStrictEqual([t.fixFirst.n, t.fixFirst.amount], [1, 150]);
  assert.deepStrictEqual([t.noDue.n, t.noDue.amount], [1, 70]);
});
check('debt by payer and by age (debt only, no-due bucket kept apart)', () => {
  const t = C.bookTotals(book, today);
  assert.strictEqual(t.byPayer.client.amount, 1650);
  assert.strictEqual(t.byPayer.client.overdue, 1150, 'client overdue includes the fix-first hold, like the plan table');
  assert.strictEqual(t.byPayer.mlb.amount, 300);
  assert.strictEqual(t.byPayer.aj.amount, 70);
  assert.strictEqual(t.byAge.no_due.aj, 70);
  assert.strictEqual(t.byAge.not_due.client, 500);
  assert.strictEqual(t.byAge['1_30'].client, 1150);
  assert.strictEqual(t.byAge['61_90'].mlb, 300);
  assert.strictEqual(t.byAge['90_plus'].other_builder, 200);
  assert.strictEqual(t.byAge['90_plus'].all, 200);
});
check('money sums stay exact to the cent', () => {
  const t = C.bookTotals([{ is_debt: true, amount_due: 0.1, due_date: null }, { is_debt: true, amount_due: 0.2, due_date: null }], today);
  assert.strictEqual(t.debt.amount, 0.3);
});
check('Xero stamp wording', () => {
  assert.strictEqual(C.stampText({ matches: true, differs_by: 0, invoice_count: 0 }, '2026-09-30T23:02:11Z'), 'Matches Xero, read 07:02');
  assert.strictEqual(C.stampText({ matches: false, differs_by: 3583.48, invoice_count: 6 }, '2026-09-30T23:02:11Z'), 'Differs by $3,583.48 on 6 invoices');
  assert.strictEqual(C.stampText({ matches: false, differs_by: 12, invoice_count: 1 }, null), 'Differs by $12.00 on 1 invoice');
  assert.strictEqual(C.stampText(null, '2026-09-30T23:02:11Z'), 'Read from Xero 07:02, not yet checked against our copy');
  // debt_book (backend fm/debt-reader-1) sends its own stamp and a +08:00 read_at: its words win.
  assert.strictEqual(C.stampText({ matches: true, differs_by: 0, invoice_count: 0, stamp: 'Matches Xero, read 07:02' }, '2026-10-01T07:02:11+08:00'), 'Matches Xero, read 07:02');
  assert.strictEqual(C.stampText({ matches: false, differs_by: 5, invoice_count: 1, stamp: 'Differs by $5.00 on 1 invoice' }, null), 'Differs by $5.00 on 1 invoice');
  assert.strictEqual(C.stampText({ matches: true }, '2026-10-01T07:02:11+08:00'), 'Matches Xero, read 07:02');
});
check('newest refresh stamp, not the oldest', () => {
  assert.strictEqual(C.newestStamp([{ debt_as_of: '2026-09-20T01:00:00Z' }, { debt_as_of: '2026-09-29T01:00:00Z' }, { debt_as_of: null }], 'debt_as_of'), '2026-09-29T01:00:00Z');
  assert.strictEqual(C.newestStamp([], 'debt_as_of'), null);
});

const items = [
  { id: 't1', group: 'text', amount: 400, days_overdue: 1, draft: { id: 'd1', status: 'pending' } },
  { id: 'h1', group: 'hold', amount: 9000, days_overdue: 90 },
  { id: 'c1', group: 'call', amount: 300, days_overdue: 3, draft: { id: 'd2', status: 'approved' } },
  { id: 'b1', group: 'broken_promise', amount: 50, days_overdue: 20 },
  { id: 't2', group: 'text', amount: 400, days_overdue: 5, draft: { id: 'd3', status: 'pending' } },
  { id: 's1', group: 'statement', amount: 5000, days_overdue: 20 },
  { id: 'j1', group: 'jan', amount: 10, days_overdue: 8 },
  { id: 'p1', group: 'deposit_reminder', amount: 800, days_overdue: 0, draft: { id: 'd4', status: 'skipped' } },
  { id: 't3', group: 'text', amount: 900, days_overdue: 1 },
];
check('morning list order: broken promises, Jan, calls, texts, statements, deposit reminders; then amount, then age', () => {
  assert.deepStrictEqual(C.sortMorning(items).map((i) => i.id), ['b1', 'j1', 'c1', 't3', 't2', 't1', 's1', 'p1']);
});
const withHold = items.concat([
  { id: 'x1', group: 'text', hold: 'check_first', amount: 99999, draft: { id: 'dx', status: 'pending' } },
  { id: 'x2', group: 'jan', step: 'jan_visit', hold: 'fix_first', amount: 20, days_overdue: 9 },
]);
check('held payers are kept out of the chase groups, even with a draft', () => {
  assert(!C.sortMorning(withHold).some((i) => i.id === 'x1' || i.id === 'x2' || i.id === 'h1'));
  assert.strictEqual(C.waitingCount(withHold), 2, 'a held draft never waits for Shaun');
});
check('held payers are listed apart, by amount then age', () => {
  assert.deepStrictEqual(C.heldItems(withHold).map((i) => i.id), ['x1', 'h1', 'x2']);
});
check('waiting for Shaun counts pending drafts only', () => { assert.strictEqual(C.waitingCount(items), 2); });
check('Jan tab takes the Jan group only; held Jan-step payers are listed apart', () => {
  assert.deepStrictEqual(C.janFromMorning(withHold).map((i) => i.id), ['j1']);
  assert.deepStrictEqual(C.janHeldFromMorning(withHold).map((i) => i.id), ['x2']);
});

check('send is off: label fixed, never armed', () => {
  assert.strictEqual(C.SEND_LABEL, 'Sending off until Shaun says go');
  assert.strictEqual(C.SENDING_ON, false);
  const b = C.sendButtonHtml({ id: 'd1', status: 'approved' });
  assert(/disabled/.test(b), 'send button must be disabled');
  assert(!/onclick/i.test(b), 'send button must have no handler');
  assert(b.indexOf('Sending off until Shaun says go') >= 0);
});

check('outcome checks: promised needs a positive amount and a date not in the past', () => {
  assert.strictEqual(C.outcomeProblem({ code: 'no_answer' }, today), null);
  assert(C.outcomeProblem({ code: 'promised' }, today));
  assert(C.outcomeProblem({ code: 'promised', amount: 100 }, today));
  assert(C.outcomeProblem({ code: 'promised', amount: 0, date: '2026-10-03' }, today));
  assert(C.outcomeProblem({ code: 'promised', amount: 100, date: '2026-09-30' }, today));
  assert.strictEqual(C.outcomeProblem({ code: 'promised', amount: 100, date: '2026-10-01' }, today), null);
  assert(C.outcomeProblem({ code: 'shouted' }, today), 'unknown outcome codes are refused');
  assert.deepStrictEqual(Array.from(C.OUTCOMES.map((o) => o.code)), ['no_answer', 'spoke', 'promised', 'disputed', 'says_paid']);
});

check('promises: from the list, broken first, then open, then kept', () => {
  const ps = C.promisesFromMorning([
    { id: 'x', payer_name: 'X', promise: { amount: 10, date: '2026-10-02', status: 'open' }, invoices: [{ invoice_number: 'INV-1' }] },
    { id: 'y', payer_name: 'Y', promise: { amount: 20, date: '2026-09-29', status: 'broken' }, invoices: [] },
    { id: 'z', payer_name: 'Z' },
    { id: 'k', payer_name: 'K', promise: { amount: 5, date: '2026-09-20', status: 'kept' } },
  ]);
  assert.deepStrictEqual(ps.map((p) => p.payer_name), ['Y', 'X', 'K']);
  assert.deepStrictEqual(Array.from(ps[1].invoice_numbers), ['INV-1']);
});
check('promises from the real morning list: broken ones on items, open ones in paused[]', () => {
  const ps = C.promisesFromMorning({
    items: [
      { id: 'b', payer_key: 'c-b', payer_name: 'Broken B', group: 'broken_promise', promise: { amount: 20, date: '2026-09-29', status: 'broken' }, invoices: [{ invoice_number: 'INV-2' }] },
      { id: 'n', payer_key: 'c-n', payer_name: 'No promise', group: 'text', promise: null, invoices: [] },
    ],
    paused: [
      { payer_key: 'c-o', payer_name: 'Open O', payer: 'client', amount: 300, invoices: [{ invoice_number: 'INV-3' }], promise: { amount: null, date: '2026-10-03', status: 'open' }, resumes_on: '2026-10-04' },
    ],
  });
  assert.deepStrictEqual(ps.map((p) => [p.payer_name, p.status]), [['Broken B', 'broken'], ['Open O', 'open']]);
  assert.strictEqual(ps[1].resumes_on, '2026-10-04');
  assert.strictEqual(ps[1].promised_amount, null, 'a promise with no amount stays without one');
  assert.deepStrictEqual(Array.from(ps[1].invoice_numbers), ['INV-3']);
});
check('real hold items (group hold, step null) are held, never chased, and keep no step chip', () => {
  const hold = { id: '2026-10-01:mlb:hold:check_first:INV-1', group: 'hold', step: null, step_label: 'Check first: In dispute', hold: 'check_first', hold_reason: 'In dispute', amount: 5, invoices: [], draft: null };
  assert.strictEqual(C.isHeld(hold), true);
  assert.strictEqual(C.sortMorning([hold]).length, 0);
  assert.strictEqual(C.heldItems([hold]).length, 1);
});
check('drafts: none written yet is told apart from none waiting', () => {
  assert.strictEqual(C.anyDrafts([{ draft: null }, { draft: null }]), false);
  assert.strictEqual(C.anyDrafts([{ draft: null }, { draft: { id: 'd', status: 'skipped' } }]), true);
});
check('deposits come from the live book: not debt, deposit kind, oldest first', () => {
  const d = C.depositsFromBook([
    { xero_invoice_id: 'g', is_debt: false, kind: 'deposit', invoice_date: '2026-09-01', amount_due: 2000 },
    { xero_invoice_id: 'q', is_debt: false, kind: 'deposit', invoice_date: '2026-07-01', amount_due: 100 },
    { xero_invoice_id: 'r', is_debt: false, kind: 'progress_claim', invoice_date: '2026-06-01', amount_due: 100 },
    { xero_invoice_id: 's', is_debt: true, kind: 'part_payment', invoice_date: '2026-06-01', amount_due: 100 },
  ], today);
  assert.deepStrictEqual(d.map((x) => x.xero_invoice_id), ['r', 'q', 'g'], 'before-work progress claims sit with deposits');
  assert.strictEqual(d[1].days_since_invoice, 92);
  // Real debt_book: materials/progress claims before a first payment carry not_debt_reason, and not-chased contacts never count.
  const real = C.depositsFromBook([
    { xero_invoice_id: 'm', payer: 'client', is_debt: false, kind: 'materials', not_debt_reason: 'before_first_payment', invoice_date: '2026-09-20', amount_due: 1 },
    { xero_invoice_id: 'x', payer: 'not_chased', is_debt: false, kind: 'deposit', invoice_date: '2026-09-01', amount_due: 1 },
    { xero_invoice_id: 'p', payer: 'client', is_debt: false, kind: 'plan_fee', not_debt_reason: 'plan_fee', invoice_date: '2026-09-01', amount_due: 1 },
  ], today);
  assert.deepStrictEqual(real.map((x) => x.xero_invoice_id), ['m']);
});
check('an undeployed action is told apart from a real failure', () => {
  assert.strictEqual(C.isNotDeployed(new Error('Unknown action')), true);
  assert.strictEqual(C.isNotDeployed(Object.assign(new Error('API error: 404'), { status: 404 })), true);
  assert.strictEqual(C.isNotDeployed(new Error('Xero rate limit')), false);
});

async function decideRefusals() {
  const list = [
    { id: 'ok', group: 'text', amount: 10, invoices: [{ xero_invoice_id: 'i1' }], draft: { id: 'd-ok', status: 'pending', text: 'Hi' } },
    { id: 'held', group: 'text', hold: 'check_first', amount: 10, invoices: [{ xero_invoice_id: 'i2' }], draft: { id: 'd-held', status: 'pending', text: 'Hi' } },
    { id: 'done', group: 'text', amount: 10, invoices: [{ xero_invoice_id: 'i3' }], draft: { id: 'd-done', status: 'skipped', text: 'Hi' } },
  ];
  ctx.CDD.morning = { items: list };
  ctx.CDD.ticked = { 'd-held': true, 'd-done': true, 'd-gone': true, 'd-ok': true };
  for (const id of ['d-held', 'd-done', 'd-gone']) {
    await assert.rejects(ctx.cddDecideOne(id, 'approve'), /no longer waiting/, id + ' must be refused');
    assert(!ctx.CDD.ticked[id], id + ' must be unticked once refused');
  }
  assert.strictEqual(posts.length, 0, 'a refused draft never reaches debt_draft_decide');
  await ctx.cddDecideOne('d-ok', 'approve');
  assert.deepStrictEqual(posts.map((p) => [p.action, p.body.draft_id, p.body.decision]), [['debt_draft_decide', 'd-ok', 'approve']]);
}

(async () => {
try { await decideRefusals(); } catch (e) { failed += 1; console.error('FAIL clear-debt-desk: only a pending draft on the current chase list can be decided\n  ' + e.message); }
if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('PASS clear-debt-desk: Perth ages, no-due bucket, overdue with holds beside it, holds listed with no draft and never approved, Xero stamp, morning order, send off, outcomes, promises, deposits');
})();
