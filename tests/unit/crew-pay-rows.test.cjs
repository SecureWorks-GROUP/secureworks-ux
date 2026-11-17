const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const root = resolve(__dirname, '../..');
const source = readFileSync(resolve(root, 'crew/js/ui/paybits.js'), 'utf8');
let PayRows;
test.before(async () => {
  const { html, cx } = await import('../../crew/js/lib/h.js');
  const { fmtMoney } = await import('../../crew/js/lib/dates.js');
  const ctx = vm.createContext({ html, cx, fmtMoney });
  vm.runInContext(source.replace(/^import .*;$/gm, '').replace(/export /g, ''), ctx);
  PayRows = ctx.PayRows;
});

function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node !== 'object') return String(node);
  return text(node.props.children);
}

function payRows(repayment) {
  return PayRows({ m: { pay_view: {
    total_inc_super: 1120, paid_to_super: 120, paid_to_you: 1000,
    reimbursements: 0, gst: 0, repayment, into_bank: 960, tax_set_aside: null,
  } } });
}

test('saved invoice omits the balance line when no numeric balance was sent', () => {
  for (const balance_left of [undefined, null, '', 'unknown', NaN, Infinity]) {
    const output = text(payRows({ label: 'Loan repayment', amount: 40, balance_left }));
    assert.ok(output.includes('Loan repayment'));
    assert.ok(output.includes('-$40.00'));
    assert.ok(!output.includes('Balance left'), String(balance_left));
  }
});

test('repayment shows the server label and numeric balance, including zero', () => {
  for (const balance_left of [160, 0]) {
    const output = text(payRows({ label: 'Loan repayment', amount: 40, balance_left }));
    assert.ok(output.includes('Loan repayment'));
    assert.ok(output.includes(`Balance left $${balance_left.toFixed(2)}`));
    assert.ok(output.includes('-$40.00'));
  }
});

test('recurring hire uses its own label without a repayment prefix or balance line', () => {
  const output = text(payRows({ label: 'Ute hire', amount: 40 }));
  assert.ok(output.includes('Ute hire'));
  assert.ok(!output.includes('Repayment:'));
  assert.ok(!output.includes('Balance left'));
  assert.ok(output.includes('Into your bank account$960.00'));
});
