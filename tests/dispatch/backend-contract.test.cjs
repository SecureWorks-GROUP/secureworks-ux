const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { workspace } = require('./workspace-harness.cjs');

const snapshot = process.env.DISPATCH_CORE_SNAPSHOT;
const deno = process.env.DENO_BIN || '/Users/marninstobbe/.deno/bin/deno';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function captureTransferPayload({ receiptId = id(3), quantity = '2.5', usable = 5, damaged = 3 } = {}) {
  let attempts = 0;
  const ui = await workspace({ post: async (action, envelope) => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary network failure');
    return ui.records[envelope.job_id];
  } });
  ui.records.a.requirements = [{ id: id(1), description: 'Custom fence panels', quantity: 8, unit: 'each' }];
  ui.records.a.allocations = [{ id: id(2), requirement_id: id(1), quantity: usable + damaged, unit: 'each' }];
  ui.records.a.receipts = [{ id: receiptId, allocation_id: id(2), usable_quantity: usable, damaged_quantity: damaged, location: 'yard', evidence: 'Counted at yard' }];
  await ui.core.load('a');
  await ui.click('transfer-receipt', receiptId);
  const values = { quantity, location: 'site', evidence: 'Delivered and checked panels' };
  ui.input('transfer', values);
  await ui.core.load('a');
  await ui.click('select', 'b');
  await ui.click('select', 'a');
  await ui.submit('transfer', values);
  await ui.click('retry-write');
  assert.equal(ui.commands.length, 2);
  assert.equal(ui.commands[0].command, 'receipt_transfer');
  assert.equal(ui.commands[1].command, 'receipt_transfer');
  assert.equal(ui.commands[0].request_id, ui.commands[1].request_id);
  assert.equal(ui.commands[0].payload.new_id, ui.commands[1].payload.new_id);
  return ui.commands[0].payload;
}

function runReducerContract(workbenchPath, payload, damagedPayload) {
  const source = `
    import { strict as assert } from 'node:assert';
    const { emptyState, reduceCommand, DispatchError } = await import(${JSON.stringify(pathToFileURL(workbenchPath).href)});
    const payload = ${JSON.stringify(payload)};
    const damagedPayload = ${JSON.stringify(damagedPayload)};
    const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
    const apply = (state, command, body, source = 'source-1') => reduceCommand(state, command, body, source, 'operator', '2026-09-13T00:00:00Z');
    let state = emptyState();
    state = await apply(state, 'requirement_upsert', { id: id(1), description: 'Custom fence panels', quantity: 8, unit: 'each', destination: 'site' });
    state = await apply(state, 'allocation_upsert', { id: id(2), requirement_id: id(1), supply_id: 'stock:' + id(8), quantity: 8 });
    state = await apply(state, 'receipt_upsert', { id: id(3), allocation_id: id(2), usable_quantity: 5, damaged_quantity: 3, location: 'yard', evidence: 'Counted at yard' });
    await assert.rejects(() => apply(state, 'receipt_transfer', { id: id(3), quantity: 2.5, location: 'site', evidence: 'Missing split id' }), DispatchError);
    const moved = await apply(state, 'receipt_transfer', payload);
    assert.equal(moved.receipts.length, 2);
    assert.equal(moved.receipts[0].id, id(3));
    assert.equal(moved.receipts[0].usable_quantity, 2.5);
    assert.equal(moved.receipts[0].damaged_quantity, 3);
    assert.equal(moved.receipts[1].id, payload.new_id);
    assert.equal(moved.receipts[1].usable_quantity, 2.5);
    assert.equal(moved.receipts[1].damaged_quantity, 0);
    assert.equal(moved.receipts[1].location, 'site');
    assert.equal(moved.receipts[1].split_from, id(3));
    let damaged = emptyState();
    damaged = await apply(damaged, 'requirement_upsert', { id: id(1), description: 'Custom fence panels', quantity: 6, unit: 'each', destination: 'site' });
    damaged = await apply(damaged, 'allocation_upsert', { id: id(2), requirement_id: id(1), supply_id: 'stock:' + id(8), quantity: 6 });
    damaged = await apply(damaged, 'receipt_upsert', { id: id(4), allocation_id: id(2), usable_quantity: 5, damaged_quantity: 1, location: 'yard', evidence: 'Damaged panel retained' });
    await assert.rejects(() => apply(damaged, 'receipt_transfer', { id: id(4), quantity: 5, location: 'site', evidence: 'All usable moved' }), DispatchError);
    const damagedSplit = await apply(damaged, 'receipt_transfer', damagedPayload);
    assert.equal(damagedSplit.receipts[1].split_from, id(4));
    assert.equal(damagedSplit.receipts[1].id, damagedPayload.new_id);
  `;
  execFileSync(deno, ['eval', '--cached-only', source], { stdio: 'pipe' });
}

test('UI receipt transfer payload satisfies the real backend split contract', { skip: !snapshot }, async () => {
  const workbenchPath = path.resolve(snapshot, 'supabase/functions/ops-api/dispatch_workbench.ts');
  const payload = await captureTransferPayload();
  const damagedPayload = await captureTransferPayload({ receiptId: id(4), quantity: '5', usable: 5, damaged: 1 });
  assert.match(payload.id, /^00000000-0000-4000-8000-\d{12}$/);
  assert.match(payload.new_id, /^00000000-0000-4000-8000-\d{12}$/);
  assert.notEqual(payload.new_id, payload.id);
  assert.match(damagedPayload.new_id, /^00000000-0000-4000-8000-\d{12}$/);
  assert.notEqual(damagedPayload.new_id, damagedPayload.id);
  runReducerContract(workbenchPath, payload, damagedPayload);
});
