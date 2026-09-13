const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace, clone } = require('./workspace-harness.cjs');

const requirement = { id: 'r', description: 'Fence panel', specification: 'Original profile', quantity: 10, unit: 'each', phase: 'installation', destination: 'site', owner: 'Shaun' };
test('an edited requirement keeps its original quantity until explicit reconciliation', async () => {
  const ui = await workspace();
  ui.records.a.requirements = [clone(requirement)];
  await ui.core.load('a');
  await ui.click('edit-requirement', 'r');
  const values = { ...requirement, quantity: '10', specification: 'Exact human specification' };
  ui.input('requirement', values);
  ui.records.a.version++;
  ui.records.a.requirements[0].quantity = 12;
  await ui.app.refresh();
  assert.match(ui.host.innerHTML, /name="quantity"[^>]*value="10"/);
  assert.match(ui.host.innerHTML, /Evidence changed since this editor opened/);
  assert.match(ui.host.innerHTML, /current evidence/);
  await ui.submit('requirement', values);
  assert.equal(ui.commands.length, 0);
  assert.equal(ui.records.a.requirements[0].quantity, 12);
  await ui.click('select', 'b');
  await ui.click('select', 'a');
  assert.match(ui.host.innerHTML, /Exact human specification/);
  await ui.click('reconcile-editor', 'form');
  await ui.submit('requirement', values);
  assert.equal(ui.commands.length, 1);
  assert.equal(ui.commands[0].expected_version, 1);
  assert.equal(ui.commands[0].payload.quantity, 10);
  assert.equal(ui.commands[0].payload.specification, 'Exact human specification');
});

for (const [action, kind, values] of [
  ['add-group', 'group', { name: 'My retained group' }],
  ['record-stock', 'stock', { description: 'Verified posts', quantity: '3', unit: 'each', location: 'yard', evidence: 'Exact count' }],
  ['add-allocation', 'allocation', { requirement_id: 'r', supply_id: 'stock:s', quantity: '2' }],
  ['add-receipt', 'receipt', { allocation_id: 'a', usable_quantity: '2', damaged_quantity: '1', location: 'yard', evidence: 'Exact receipt' }],
  ['transfer-receipt', 'transfer', { quantity: '2', location: 'site', evidence: 'Exact transfer' }],
  ['add-movement', 'movement', { title: 'Chosen movement', from_location: 'yard', to_location: 'site', date: '', time: '', requirement_id: ['r'] }],
  ['review-allocation', 'suitability', { reason: 'Exact reason', evidence: 'Exact compatibility evidence' }]
]) {
  test(`${kind} editor retains source binding through refresh and job navigation`, async () => {
    const ui = await workspace();
    ui.records.a.requirements = [{ ...requirement, reviewed_source_version: 'source-1' }];
    ui.records.a.allocations = [{ id: 'a', requirement_id: 'r', quantity: 5 }];
    ui.records.a.supply_lots = [{ id: 'stock:s', description: 'Recorded panels', quantity: 5, unit: 'each' }];
    ui.records.a.receipts = [{ id: 'receipt', allocation_id: 'a', usable_quantity: 5, damaged_quantity: 1, location: 'yard' }];
    await ui.core.load('a');
    await ui.click(action, action === 'transfer-receipt' ? 'receipt' : 'a');
    ui.input(kind, values);
    ui.records.a.source_version = 'source-2';
    await ui.core.load('a');
    await ui.click('select', 'b');
    await ui.click('select', 'a');
    await ui.submit(kind, values);
    assert.equal(ui.commands.length, 0);
    assert.match(ui.host.innerHTML, /reconcile this editor/);
    await ui.click('reconcile-editor', 'form');
    await ui.submit(kind, values);
    assert.equal(ui.commands.length, 1);
    assert.equal(ui.commands[0].source_version, 'source-2');
  });
}

test('order editor retains selected requirements and still requires resolving stale rows', async () => {
  const values = { supplier_name: 'Chosen supplier', delivery_address: 'Chosen destination', delivery_date: '', notes: 'Exact order notes', requirement_id: ['r'], 'quantity:r': '2', 'price:r': '3', existing_supply_reviewed: 'on' };
  const ui = await workspace();
  ui.records.a.requirements = [{ ...requirement, reviewed_source_version: 'source-1' }];
  ui.records.a.allocations = [{ id: 'a', requirement_id: 'r', quantity: 5 }];
  ui.records.a.supply_lots = [{ id: 'stock:s', description: 'Recorded panels', quantity: 5, unit: 'each' }];
  ui.records.a.receipts = [{ id: 'receipt', allocation_id: 'a', usable_quantity: 5, damaged_quantity: 1, location: 'yard' }];
  await ui.core.load('a');
  await ui.click('prepare-order');
  ui.input('order', values);
  ui.records.a.source_version = 'source-2';
  await ui.core.load('a');
  await ui.click('select', 'b');
  await ui.click('select', 'a');
  await ui.submit('order', values);
  assert.equal(ui.commands.length, 0);
  assert.match(ui.host.innerHTML, /reconcile this editor/);
  await ui.click('reconcile-editor', 'form');
  await ui.submit('order', values);
  assert.equal(ui.commands.length, 0);
  assert.match(ui.host.innerHTML, /Resolve stale or unavailable requirement selections/);
  ui.records.a.requirements[0].reviewed_source_version = 'source-2';
  await ui.core.load('a');
  await ui.click('reconcile-editor', 'form');
  await ui.submit('order', values);
  assert.equal(ui.commands.length, 1);
  assert.equal(ui.commands[0].command, 'order_prepare');
  assert.deepEqual(ui.commands[0].payload.requirement_ids, ['r']);
});

const mail = { sender: 'ops@example.test', to: 'supplier@example.test', cc: 'copy@example.test', subject: 'Exact subject', body: 'Human text\nSecond line', purchase_commitment: 'false' };
test('an open saved email keeps text and original evidence even before the first edit', async () => {
  const ui = await workspace();
  ui.records.a.drafts = [{ ...mail, id: 'd', to: [mail.to], cc: [mail.cc], attachments: [], purchase_commitment: false }];
  await ui.core.load('a');
  await ui.click('tab', 'email');
  await ui.click('open-draft', 'd');
  ui.records.a.version++;
  ui.records.a.drafts[0].body = 'Concurrent saved text';
  await ui.app.refresh();
  assert.match(ui.host.innerHTML, /Human text\nSecond line/);
  ui.input('draft', mail, 'draft');
  await ui.click('save-draft');
  assert.equal(ui.commands.length, 0);
  assert.equal(ui.core.editor('a', 'draft:d').body, mail.body);
  await ui.click('close-draft');
  await ui.click('select', 'b');
  await ui.click('select', 'a');
  await ui.click('open-draft', 'd');
  await ui.click('reconcile-editor', 'draft:d');
  await ui.click('review-draft');
  assert.deepEqual(ui.commands.map(item => item.command), ['draft_upsert', 'draft_review']);
  assert.equal(ui.commands[0].expected_version, 1);
  assert.equal(ui.commands[1].expected_version, 2);
  assert.equal(ui.commands[0].payload.body, mail.body);
  assert.match(ui.host.innerHTML, /Exact draft reviewed and persisted/);
});

test('working notes keep their text and baseline when evidence changes', async () => {
  const ui = await workspace();
  await ui.click('tab', 'notes');
  ui.input('note', { text: 'Exact scratch note\nSecond line' }, 'note');
  const original = clone(ui.core.editor('a', 'note'));
  ui.records.a.version++;
  await ui.app.refresh();
  await ui.click('save-note');
  assert.equal(ui.commands.length, 0);
  assert.deepEqual(ui.core.editor('a', 'note'), original);
  await ui.click('reconcile-editor', 'note');
  await ui.click('save-note');
  assert.equal(ui.commands[0].expected_version, 1);
  assert.deepEqual(ui.commands[0].payload, original);
});
