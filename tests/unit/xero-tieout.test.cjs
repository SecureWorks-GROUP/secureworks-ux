// Tie to Xero rules (modules/ops-xero-tieout.js, <xero-tieout-core>).
// The page side is one read and one innerHTML; everything it decides is here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../../modules/ops-xero-tieout.js');
const { answer, month } = require('../fixtures/xero-tieout.js');

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

test('the module carries no long dash and no emoji', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../modules/ops-xero-tieout.js'), 'utf8');
  assert.equal(/[–—]/.test(src), false, 'long dash');
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src), false, 'emoji');
});
