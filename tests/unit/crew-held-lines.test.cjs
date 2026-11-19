// P1-05.13 / F1: a trade's own lines that wait on the office. Made-up ZZTEST ids and amounts only.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../crew/js/lib/held.js');
const FORBIDDEN = /taken off|deducted|deduction|work order budget|_[a-z]+_|\bnull\b|undefined/i;

test('every hold reason has plain words, with no code, no amount and no forbidden wording', async () => {
  const H = await load();
  const codes = ['no_work_order', 'no_amount', 'over_amount', 'hourly_no_maximum', 'no_job', 'not_job_work', 'reimbursement', 'not_on_crew', 'commission_no_figure', 'rate_above_rule'];
  for (const code of codes) {
    const words = H.heldWords(code);
    assert.ok(words.length > 10, code);
    assert.doesNotMatch(words, FORBIDDEN, code);
    assert.doesNotMatch(words, /\$|\d/, code);
  }
  assert.equal(H.heldWords('ZZTEST_unknown'), 'The office is checking this line before it is paid.');
  assert.equal(H.heldWords(undefined), 'The office is checking this line before it is paid.');
});

test('the send splits into in pay, waiting and not approved only when the server sent every part', async () => {
  const H = await load();
  assert.equal(H.sendSplit({}), null);
  assert.equal(H.sendSplit({ ok: true, invoice_id: 'ZZTEST-inv' }), null);
  assert.equal(H.sendSplit({ send: { in_pay_ex: 500, held_ex: 0, declined_ex: 0 } }), null);
  assert.equal(H.sendSplit({ send: { in_pay_ex: 500, held_ex: '120', declined_ex: 0 } }), null);
  assert.deepEqual(H.sendSplit({ send: { in_pay_ex: 500, held_ex: 120, declined_ex: 0 } }), { inPay: 500, waiting: 120, notApproved: 0 });
  assert.deepEqual(H.sendSplit({ send: { in_pay_ex: 500, held_ex: 0, declined_ex: 30 } }), { inPay: 500, waiting: 0, notApproved: 30 });
});

test('held lines from the send use the app words, never the server sentence', async () => {
  const H = await load();
  const res = { invoice_id: null, held_lines: [
    { line_id: 'ZZTEST-l1', job_number: 'ZZTEST-1', reason: 'over_amount', words: 'With the office: $999.00 was left', amount_ex: 120 },
    { line_id: 'ZZTEST-l2', job_number: null, reason: 'no_job', amount_ex: 40 }, null] };
  const lines = H.sendHeldLines(res);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].words, H.HELD_WORDS.over_amount);
  assert.doesNotMatch(JSON.stringify(lines), /999/);
  assert.equal(lines[1].jobNumber, '');
  assert.equal(H.allHeld(res), true);
  assert.equal(H.allHeld({ ...res, invoice_id: 'ZZTEST-inv' }), false);
  assert.equal(H.allHeld({ invoice_id: null }), false);
});

test('line states and counts; holding and follow-on invoices only by their kind', async () => {
  const H = await load();
  assert.deepEqual(['awaiting', 'queried', 'rejected', 'approved', null].map((s) => H.heldState({ office_review_status: s })), ['waiting', 'waiting', 'not_approved', 'approved', '']);
  assert.deepEqual(H.heldCounts({ lines: [{ office_review_status: 'awaiting' }, { office_review_status: 'queried' }, { office_review_status: 'rejected' }] }), { waiting: 2, notApproved: 1 });
  assert.equal(H.isHeldInvoice({ invoice_kind: 'held' }), true);
  assert.equal(H.isHeldInvoice({}), false);
  assert.equal(H.isFollowOn({ invoice_kind: 'follow_on' }), true);
  assert.equal(H.isFollowOn({ invoice_kind: 'standard' }), false);
});

test('the phone keeps at most ten recent holding invoices per trade, newest first, for eight weeks', async () => {
  const H = await load();
  const day = 86400000, t = 1_800_000_000_000;
  let list = [];
  for (let i = 0; i < 12; i++) list = H.addPointer(list, 'ZZTEST-' + i, '2026-11-09', t + i);
  assert.equal(list.length, 10);
  assert.equal(list[0].id, 'ZZTEST-11');
  list = H.addPointer(list, 'ZZTEST-5', '2026-11-09', t + 99);
  assert.equal(list.filter((p) => p.id === 'ZZTEST-5').length, 1);
  assert.equal(list[0].id, 'ZZTEST-5');
  assert.deepEqual(H.livePointers([{ id: 'a', at: t }, { id: 'b', at: t - 60 * day }, { id: '', at: t }, null], t).map((p) => p.id), ['a']);
  assert.equal(H.heldKey('ZZTEST-user'), 'held:ZZTEST-user');
});

test('the week\'s own invoice comes before a follow-on or holding invoice of the same week, when the list names the kind', async () => {
  const { invoiceForWeek } = await import('../../crew/js/lib/invoice.js');
  const own = { id: 'ZZTEST-own', week_start: '2026-11-09', status: 'pushed_to_xero' };
  const follow = { id: 'ZZTEST-fo', week_start: '2026-11-09', status: 'pending_ops_review', invoice_kind: 'follow_on' };
  assert.equal(invoiceForWeek([follow, own], '2026-11-09').id, 'ZZTEST-own');
  assert.equal(invoiceForWeek([follow], '2026-11-09').id, 'ZZTEST-fo');
  // Today's list carries no kind: the first live row, as before.
  assert.equal(invoiceForWeek([{ ...follow, invoice_kind: undefined }, own], '2026-11-09').id, 'ZZTEST-fo');
});
