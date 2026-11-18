// P2-03.11: the split add-ups, in whole cents. Made-up amounts only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../modules/ops-reconcile-split.js');

test('typed amounts are read as cents from their text, never through a float', () => {
  assert.deepEqual(['600', '600.5', '600.50', '$1,240.00', ' 0.01 ', '33.34'].map(S.toCents), [60000, 60050, 60050, 124000, 1, 3334]);
  assert.deepEqual(['', '0', '0.00', '-5', '1.234', 'abc', null, '1e3'].map(S.toCents), [null, null, null, null, null, null, null, null]);
  assert.deepEqual([1000, '1000.00', -120.5, null, '', true].map(S.lineCents), [100000, 100000, -12050, null, null, null]);
});

test('left is what a line still needs; a credit is measured by its size', () => {
  assert.equal(S.left(100000, [60000, 30000]), 10000);
  assert.equal(S.left(-12050, [12050]), 0);
  assert.equal(S.left(100000, [null]), 100000);
});

test('valid needs every line fully placed and every part a place and an amount', () => {
  const line = (parts) => [{ line_id: 'L1', cents: 100000, parts }];
  assert.equal(S.valid(line([{ target: 'job', job_id: 'J1', text: '600' }, { target: 'job', job_id: 'J2', text: '300' }, { target: 'overhead', text: '100' }])), true);
  assert.equal(S.valid(line([{ target: 'job', job_id: 'J1', text: '600' }, { target: 'job', job_id: 'J2', text: '300' }])), false, 'left $100.00');
  assert.equal(S.valid(line([{ target: '', text: '1000' }])), false, 'a part with no place');
  assert.equal(S.valid(line([{ target: 'job', job_id: '', text: '1000' }])), false, 'a job part with no job');
  assert.equal(S.valid([{ line_id: 'L1', cents: null, parts: [{ target: 'overhead', text: '1' }] }]), false, 'a line with no amount');
  assert.equal(S.valid([]), false);
});

test('parts are sent in dollars to two places with the line sign, job_id only on a job part', () => {
  assert.deepEqual(S.partsFor([
    { line_id: 'L1', cents: 100000, parts: [{ target: 'job', job_id: 'J1', text: '600' }, { target: 'overhead', job_id: 'J1', text: '400' }] },
    { line_id: 'L2', cents: -3334, parts: [{ target: 'job', job_id: 'J2', text: '33.34' }] },
  ]), [
    { line_id: 'L1', target: 'job', amount_ex: 600, job_id: 'J1' },
    { line_id: 'L1', target: 'overhead', amount_ex: 400 },
    { line_id: 'L2', target: 'job', amount_ex: -33.34, job_id: 'J2' },
  ]);
  assert.equal(JSON.stringify(S.partsFor([{ line_id: 'L', cents: 1, parts: [{ target: 'overhead', text: '0.01' }] }])), '[{"line_id":"L","target":"overhead","amount_ex":0.01}]');
});
