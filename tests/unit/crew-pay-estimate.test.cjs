const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').resolve(__dirname, '../../crew/js/lib/invoice.js'), 'utf8');
const ctx = { hoursBetween: () => 0 };
vm.createContext(ctx);
vm.runInContext(source.replace(/^import .*;$/gm, '').replace(/export /g, ''), ctx);
const line = (amount, type = 'other') => ({ kind: 'other', type, amount });
const run = (lines, opts = {}) => ctx.estimate(lines, { basis: 'inclusive_12_112_v1', ...opts });

test('ZZTEST inclusive pay rounds to cents and keeps reimbursements outside super and GST', () => {
  for (const [gross, superPaid, paidToYou] of [[1120, 120, 1000], [1000, 107.14, 892.86], [0.14, 0.02, 0.12]]) {
    const m = run([line(gross)]);
    assert.equal(m.superPaid, superPaid);
    assert.equal(m.paidToYou, paidToYou);
    assert.equal(m.intoBank, paidToYou);
  }
  const m = run([line(560), line(80, 'reimbursement')], { gstOn: true });
  assert.deepEqual([m.gross, m.base, m.superPaid, m.paidToYou, m.reimb, m.gst, m.intoBank], [640, 560, 60, 500, 80, 56, 636]);
  assert.equal(run([line(1120)], { deduction: { amount: 25 } }).intoBank, 975);
});

test('ZZTEST old basis keeps its existing sum', () => {
  const m = ctx.estimate([line(1000)], { gstOn: true });
  assert.deepEqual([m.gross, m.superHeld, m.gst, m.pay], [1000, 60, 100, 1040]);
});

test('ZZTEST inclusive pay skips a repayment the server did not apply', () => {
  const m = run([line(14)], { deduction: { amount: 25, applied: false, outcome: 'payable_below_deduction' } });
  assert.deepEqual([m.paidToYou, m.takeOff, m.intoBank, m.pay], [12.5, 0, 12.5, 12.5]);
});

test('ZZTEST inclusive pay honours the server repayment decision with GST and reimbursements', () => {
  const lines = [line(560), line(80, 'reimbursement')];
  for (const [applied, takeOff, intoBank] of [[false, 0, 636], [true, 25, 611]]) {
    const m = run(lines, { gstOn: true, deduction: { amount: 25, applied } });
    assert.deepEqual([m.superPaid, m.paidToYou, m.reimb, m.gst, m.takeOff, m.intoBank, m.pay], [60, 500, 80, 56, takeOff, intoBank, intoBank]);
  }
});

test('ZZTEST inclusive pay keeps the existing estimate when applied is absent', () => {
  const m = run([line(14)], { deduction: { amount: 25 } });
  assert.deepEqual([m.takeOff, m.intoBank, m.pay], [25, -12.5, -12.5]);
});

test('ZZTEST null basis keeps the old rows and repayment threshold', () => {
  for (const [gross, superHeld, takeOff, pay] of [[1000, 60, 25, 1015], [10, 0.6, 0, 10.4]]) {
    const m = run([line(gross)], { basis: null, gstOn: true, deduction: { amount: 25 } });
    assert.deepEqual([m.gross, m.superBase, m.superHeld, m.gst, m.takeOff, m.pay], [gross, gross, superHeld, gross / 10, takeOff, pay]);
    for (const key of ['base', 'superPaid', 'paidToYou', 'intoBank']) assert.equal(key in m, false);
  }
});
