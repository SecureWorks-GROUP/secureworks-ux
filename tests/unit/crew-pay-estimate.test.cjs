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
