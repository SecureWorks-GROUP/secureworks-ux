// Tie to Xero rules (modules/ops-xero-tieout.js, <xero-tieout-core>).
// The page side is one read and one innerHTML; everything it decides is here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../../modules/ops-xero-tieout.js');
const { answer, month, spendRevenue, answerWithSpendRevenue } = require('../fixtures/xero-tieout.js');

test('money and shares read plainly, and an unknown amount is blank, never $0', () => {
  assert.equal(Core.money(149125.84), '$149,125.84');
  assert.equal(Core.money('0'), '$0.00');
  assert.equal(Core.money(-60), '-$60.00');
  assert.equal(Core.money(null), '');
  assert.equal(Core.money(undefined), '');
  assert.equal(Core.money('abc'), '');
  assert.equal(Core.money(true), '');
  assert.equal(Core.pct(0.0494), '4.94%');
  assert.equal(Core.pct(0), '0.00%');
  assert.equal(Core.pct(null), '');
  assert.equal(Core.monthLabel('2026-10'), 'Oct 2026');
  assert.equal(Core.monthLabel('nonsense'), 'nonsense');
});

test('an answer without its months is a failed read, never an empty one', () => {
  assert.equal(Core.readable(answer()), true);
  assert.equal(Core.readable({ ok: true, tieout: { months: [] } }), true);
  assert.equal(Core.readable({ ok: true }), false);
  assert.equal(Core.readable({ ok: true, tieout: {} }), false);
  assert.equal(Core.readable({ ok: true, tieout: { months: 'none' } }), false);
  assert.equal(Core.readable(null), false);
});

test('a month carries the server figures as they came', () => {
  const m = Core.month(answer().tieout.months[0]);
  assert.equal(m.label, 'Mar 2034');
  assert.equal(m.bills, 17);
  assert.equal(m.total, 5496.74);
  assert.equal(m.onJob, 2970.35);
  assert.equal(m.trade, 500);
  assert.equal(m.overhead, 710.39);
  assert.equal(m.overheadFiled, 259.99);
  assert.equal(m.overheadEvidence, 450.4);
  assert.equal(m.unplaced, 1316);
  assert.equal(m.share, 0.2395);
  assert.equal(m.addsUp, true);
  assert.deepEqual(m.over, { bills: 1, ex: 50 });
  assert.deepEqual(m.negative, { bills: 1, ex: -60 });
  assert.deepEqual(m.notCounted, { bills: 1, ex: 77.77 });
});

test('reasons keep the server order and leave out the ones with nothing in them', () => {
  const m = Core.month(answer().tieout.months[0]);
  assert.deepEqual(m.reasons.map((r) => [r.key, r.ex]), [
    ['waiting_in_bills_to_place', 500.55],
    ['installer_awaiting_confirmation', 600],
    ['holding_job', 120],
    ['not_in_intake', 45.45],
    ['rows_short_of_bill', 50],
  ]);
  assert.equal(m.reasons[0].action, 'bills_to_place');
  assert.equal(Core.month(answer().tieout.months[1]).reasons.length, 0);
});

test('a part the server has not read is not read, never $0', () => {
  const m = Core.month(answer().tieout.months[0]);
  assert.equal(m.spend.read, false);
  assert.equal(m.spend.ex, null);
  assert.equal(m.spend.partialRows, 12);
  assert.equal(m.credit.read, false);
  assert.equal(m.credit.totalEx, null);
  const feb = Core.month(answer().tieout.months[1]);
  assert.equal(feb.credit.read, true);
  assert.equal(feb.credit.notes, 2);
  assert.equal(feb.credit.totalEx, 300);
  assert.equal(feb.credit.onJobEx, 250);
});

test('a month that does not add up, or cannot be checked, says so', () => {
  const bad = month(); bad.bills = Object.assign({}, bad.bills, { parts_add_up: false });
  assert.equal(Core.month(bad).addsUp, false);
  const unk = month(); unk.bills = Object.assign({}, unk.bills); delete unk.bills.parts_add_up;
  assert.equal(Core.month(unk).addsUp, null);
  const a = answer(); a.tieout.months[1] = bad; a.tieout.months[2] = unk;
  const h = Core.headline(a.tieout);
  assert.equal(h.monthsShown, 3);
  assert.equal(h.monthsAddUp, 1);
  assert.equal(h.monthsDoNotAddUp, 1);
  assert.equal(h.monthsUnknown, 1);
});

test('the headline is the server six-month line', () => {
  const h = Core.headline(answer().tieout);
  assert.equal(h.total, 9996.74);
  assert.equal(h.unplaced, 1316);
  assert.equal(h.unplacedShare, 0.1317);
  assert.equal(h.accountedShare, 0.8683);
  assert.equal(h.monthsAddUp, 3);
  const none = Core.headline({ months: [] });
  assert.equal(none.total, null);
  assert.equal(none.accountedShare, null);
});

test('the bar is drawn from the parts and is empty for a month with no bills', () => {
  const parts = Core.barParts(Core.month(answer().tieout.months[0]));
  assert.deepEqual(parts.map((p) => p.key), ['on_job', 'trade', 'overhead', 'unplaced']);
  const sum = parts.reduce((a, p) => a + p.width, 0);
  assert.ok(Math.abs(sum - 100) < 0.05, 'widths add to 100: ' + sum);
  assert.deepEqual(Core.barParts(Core.month(answer().tieout.months[2])).map((p) => p.width), [0, 0, 0, 0]);
  assert.deepEqual(Core.barParts(Core.month({})).map((p) => p.width), [0, 0, 0, 0]);
});

test('what is not read yet is passed on in the server words', () => {
  assert.deepEqual(Core.notYetRead(answer().tieout), ['Spend money and card spend are not in the bill intake yet.']);
  assert.deepEqual(Core.notYetRead({}), []);
});

test('without the second read the page is the bills page', () => {
  const x = Core.spendRevenue(answer());
  assert.equal(x.present, false);
  assert.equal(x.ok, false);
  assert.deepEqual(x.byMonth, {});
  assert.equal(Core.spendRevenue(null).present, false);
});

test('a second read that failed keeps the reason and shows no figure', () => {
  for (const sr of [{ ok: false, reason: 'function does not exist' }, { ok: true }, { ok: true, answer: {} }, { ok: true, answer: { months: 'none' } }]) {
    const x = Core.spendRevenue(Object.assign(answer(), { spend_revenue: sr }));
    assert.equal(x.present, true);
    assert.equal(x.ok, false);
    assert.deepEqual(x.byMonth, {});
    assert.equal(x.six, null);
  }
  assert.equal(Core.spendRevenue(Object.assign(answer(), { spend_revenue: { ok: false, reason: 'function does not exist' } })).reason, 'function does not exist');
  assert.equal(Core.spendRevenue(Object.assign(answer(), { spend_revenue: { ok: true } })).reason, 'no answer');
});

test('card and bank spend carries the server figures, sorted only when the server sorted them', () => {
  const x = Core.spendRevenue(answerWithSpendRevenue());
  assert.equal(x.ok, true);
  assert.equal(x.anySorted, true);
  const mar = x.byMonth['2034-03'].spend;
  assert.equal(mar.status, 'partial');
  assert.equal(mar.sorted, true);
  assert.equal(mar.transactions, 7);
  assert.equal(mar.withLines, 5);
  assert.equal(mar.total, 575.26);
  assert.equal(mar.direct, 130);
  assert.equal(mar.directOnJob, null, 'direct cost spend is on no job: unknown, never 0');
  assert.equal(mar.overhead, 70);
  assert.equal(mar.notACost, 200);
  assert.equal(mar.income, 30);
  assert.equal(mar.unknownAccount, 50);
  assert.equal(mar.unknownLines, 1);
  assert.equal(mar.noDetail, 95.25);
  assert.equal(mar.paidAhead, 0);
  assert.equal(mar.paidAheadLines, 0);
  assert.equal(mar.differ, 0.01);
  assert.equal(mar.differPayments, 0);
  assert.equal(mar.unreadLines, 0);
  assert.equal(mar.addsUp, true);
  assert.equal(mar.accounts.length, 7);
  assert.deepEqual(mar.accounts[3], { code: '999', name: '', kind: 'account_unknown', lines: 1, ex: 50 });
  assert.deepEqual(mar.tracking[1], { tracking: '', lines: 1, ex: 30 });
  const feb = x.byMonth['2034-02'].spend;
  assert.equal(feb.sorted, false);
  assert.equal(feb.status, 'not_yet_read');
  assert.equal(feb.total, 410.5);
  assert.equal(feb.direct, null);
  assert.equal(feb.overhead, null);
  assert.equal(feb.addsUp, null);
  const jan = x.byMonth['2034-01'].spend;
  assert.equal(jan.status, 'not_in_copy');
  assert.equal(jan.total, null);
  assert.equal(Core.spendMonth({ status: 'something new' }).status, 'unknown');
  assert.equal(Core.spendMonth({ status: 'something new' }).sorted, false);
  assert.equal(Core.spendMonth(null).sorted, false);
});

test('money paid ahead, lines that differ and unread lines are the server counts, absent on an older answer', () => {
  const sp = Core.spendMonth({
    status: 'partial', transactions: 5, with_line_detail: 5, total_ex: 530, overhead_ex: 160,
    paid_ahead_ex: 345, paid_ahead_lines: 2, lines_differ_ex: 25, lines_differ_transactions: 3, unread_lines: 1,
    parts_add_up: false,
  });
  assert.equal(sp.paidAhead, 345);
  assert.equal(sp.paidAheadLines, 2);
  assert.equal(sp.differ, 25);
  assert.equal(sp.differPayments, 3);
  assert.equal(sp.unreadLines, 1);
  assert.equal(sp.addsUp, false);
  // An answer from before these fields: unknown, never 0 dollars, and nothing counted.
  const old = Core.spendMonth({ status: 'read', transactions: 1, total_ex: 10, overhead_ex: 10 });
  assert.equal(old.paidAhead, null);
  assert.equal(old.paidAheadLines, 0);
  assert.equal(old.differPayments, 0);
  assert.equal(old.unreadLines, 0);
  assert.equal(Core.SPEND_KINDS.some((k) => k.key === 'paid_ahead'), true);
});

test('customer invoices carry the server figures as they came', () => {
  const x = Core.spendRevenue(answerWithSpendRevenue());
  const mar = x.byMonth['2034-03'].revenue;
  assert.equal(mar.invoices, 5);
  assert.equal(mar.total, 2400);
  assert.equal(mar.onJob, 1600);
  assert.equal(mar.holding, 300);
  assert.equal(mar.notOnJob, 550);
  assert.equal(mar.notOnJobInvoices, 2);
  assert.equal(mar.share, 0.3542);
  assert.deepEqual(mar.over, { invoices: 1, ex: 50 });
  assert.deepEqual(mar.drafts, { invoices: 2, ex: 1110 });
  assert.equal(mar.addsUp, true);
  assert.equal(x.byMonth['2034-01'].revenue.addsUp, false);
  assert.equal(Core.revenueMonth({}).total, null);
  assert.equal(Core.revenueMonth({}).addsUp, null);
});

test('the second six-month line is the server line, and spend with no month read is unknown', () => {
  const six = Core.spendRevenue(answerWithSpendRevenue()).six;
  assert.equal(six.revenueTotal, 12400);
  assert.equal(six.revenueNotOnJob, 850);
  assert.equal(six.revenueOnJobShare, 0.9315);
  assert.equal(six.spendMonthsRead, 1);
  assert.equal(six.spendTotal, 575.26);
  assert.equal(six.spendDirect, 130);
  const none = Core.spendRevenue(answerWithSpendRevenue({ last_6_months: { revenue_total_ex: 0, spend_months_read: 0, spend_total_ex: null, spend_direct_cost_ex: null, revenue_on_job_share: null } })).six;
  assert.equal(none.spendMonthsRead, 0);
  assert.equal(none.spendTotal, null);
  assert.equal(none.revenueOnJobShare, null);
});

test('the not read yet line for card spend goes once the second read sorts it', () => {
  assert.deepEqual(Core.notYetRead(answer().tieout, ['spend_money']), []);
  assert.deepEqual(Core.notYetRead(answer().tieout, []), ['Spend money and card spend are not in the bill intake yet.']);
  const unsorted = spendRevenue();
  unsorted.answer.months.forEach((m) => { m.spend.status = 'not_yet_read'; });
  assert.equal(Core.spendRevenue({ spend_revenue: unsorted }).anySorted, false);
});

test('the module carries no long dash and no emoji', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../modules/ops-xero-tieout.js'), 'utf8');
  assert.equal(/[–—]/.test(src), false, 'long dash');
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src), false, 'emoji');
});
