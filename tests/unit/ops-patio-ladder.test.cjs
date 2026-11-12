// node --test tests/unit/ops-patio-ladder.test.cjs
// The Ops job page's patio status ladder (getNextStatuses in ops.html, cut out as shipped) offers Order Materials
// where the stage-gate engine's patio graph does, never Processing: the Dispatch board lists Order Materials onward
// only, so a patio moved to Processing never reached Dispatch (patio walk step 8, 12 Nov 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ENGINE = require('../../modules/ops-stage-gate-engine.js');

const OPS = readFileSync(resolve(__dirname, '..', '..', 'ops.html'), 'utf8');
const a = OPS.indexOf('function getNextStatuses(current, jobType) {');
const b = OPS.indexOf('\nasync function setCouncilRequired(', a);
assert.ok(a !== -1 && b !== -1, 'getNextStatuses found in ops.html');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(OPS.slice(a, b) + '\nthis.getNextStatuses = getNextStatuses;', ctx);
const ladder = (s, type) => Array.from(ctx.getNextStatuses(s, type || 'patio'));
const PATIO = ENGINE.transitionsFor('patio');

test('the patio ladder never offers Processing', () => {
  for (const s of ['quoted', 'accepted', 'awaiting_deposit', 'approvals', 'order_materials', 'awaiting_supplier', 'order_confirmed', 'processing', 'scheduled', 'in_progress', 'complete', 'invoiced']) {
    assert.ok(!ladder(s).includes('processing'), s + ' offers Processing');
  }
});

test('it offers Order Materials wherever the stage-gate engine moves a patio forward to it', () => {
  const into = Object.keys(PATIO).filter((s) => PATIO[s].forward.includes('order_materials'));
  assert.deepEqual(into.sort(), ['approvals', 'awaiting_deposit']);
  for (const s of into) assert.ok(ladder(s).includes('order_materials'), s);
});

test('from Order Materials to Scheduled it follows the engine forward, step for step', () => {
  for (const s of ['order_materials', 'awaiting_supplier', 'order_confirmed']) assert.deepEqual(ladder(s), PATIO[s].forward, s);
});

test('a patio already at Processing can be moved to Order Materials (or started, as before)', () => {
  assert.deepEqual(ladder('processing'), ['order_materials', 'in_progress']);
});

test('fencing, repair and other job types keep their ladders', () => {
  assert.deepEqual(ladder('accepted', 'fencing'), ['awaiting_deposit']);
  assert.deepEqual(ladder('accepted', 'repair'), ['processing']);
  assert.deepEqual(ladder('accepted', 'decking'), ['approvals', 'processing']);
});
