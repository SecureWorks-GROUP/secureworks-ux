const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace } = require('./workspace-harness.cjs');

function selectedOption(html, field, value) {
  const select = html.match(new RegExp(`<select name="${field}"[^>]*>([\\s\\S]*?)</select>`))?.[1];
  assert.ok(select, `Rendered ${field} selector`);
  assert.match(select, new RegExp(`<option value="${value}" selected>Unavailable`));
}

const cases = [
  { name: 'receipt allocation', action: 'add-receipt', kind: 'receipt', field: 'allocation_id', previous: 'aa', replacement: 'ab', collection: 'allocations', command: 'receipt_upsert',
    values: { allocation_id: 'aa', usable_quantity: '2', damaged_quantity: '1', location: 'yard', evidence: 'Exact docket for allocation A' } },
  { name: 'allocation requirement', action: 'add-allocation', kind: 'allocation', field: 'requirement_id', previous: 'ra', replacement: 'rb', collection: 'requirements', command: 'allocation_upsert',
    values: { requirement_id: 'ra', supply_id: 'sa', quantity: '2' } },
  { name: 'allocation supply lot', action: 'add-allocation', kind: 'allocation', field: 'supply_id', previous: 'sa', replacement: 'sb', collection: 'supply_lots', command: 'allocation_upsert',
    values: { requirement_id: 'ra', supply_id: 'sa', quantity: '2' } },
  { name: 'requirement group', action: 'edit-requirement', actionId: 'ra', kind: 'requirement', field: 'group_id', previous: 'ga', replacement: '', collection: 'groups', command: 'requirement_upsert',
    values: { description: 'Exact panel specification', specification: 'Human detail', quantity: '2', unit: 'each', group_id: 'ga', phase: 'installation', destination: 'site', owner: 'Shaun' } }
];

for (const scenario of cases) test(`removed ${scenario.name} remains selected until explicitly replaced`, async () => {
  const ui = await workspace();
  Object.assign(ui.records.a, {
    groups: [{ id: 'ga', name: 'First group' }, { id: 'gb', name: 'Remaining group' }],
    requirements: [{ id: 'ra', description: 'First panels', quantity: 4, unit: 'each', group_id: 'ga' }, { id: 'rb', description: 'Remaining panels', quantity: 6, unit: 'each' }],
    allocations: scenario.kind === 'receipt' ? [{ id: 'aa', requirement_id: 'ra', quantity: 4, unit: 'each' }, { id: 'ab', requirement_id: 'rb', quantity: 6, unit: 'each' }] : [],
    supply_lots: [{ id: 'sa', description: 'First lot', unit: 'each', quantity: 4 }, { id: 'sb', description: 'Remaining lot', unit: 'each', quantity: 6 }]
  });
  await ui.core.load('a');
  await ui.click(scenario.action, scenario.actionId);
  ui.input(scenario.kind, scenario.values);
  ui.records.a[scenario.collection] = ui.records.a[scenario.collection].filter(item => item.id !== scenario.previous);
  if (scenario.kind === 'requirement') ui.records.a.requirements[0].group_id = null;
  ui.records.a.version++;
  await ui.app.refresh();
  selectedOption(ui.host.innerHTML, scenario.field, scenario.previous);
  await ui.click('select', 'b');
  await ui.click('select', 'a');
  selectedOption(ui.host.innerHTML, scenario.field, scenario.previous);
  const edited = { ...scenario.values, ...(scenario.kind === 'receipt' ? { location: 'site' } : { quantity: '3' }) };
  ui.input(scenario.kind, edited);
  await ui.click('reconcile-editor', 'form');
  selectedOption(ui.host.innerHTML, scenario.field, scenario.previous);
  await ui.submit(scenario.kind, edited);
  assert.equal(ui.commands.length, 0);
  assert.match(ui.host.innerHTML, /previous selection is unavailable or unconfirmed/);
  const replaced = { ...edited, [scenario.field]: scenario.replacement };
  await ui.submit(scenario.kind, replaced);
  assert.equal(ui.commands.length, 0, 'Submitting another identity without explicitly changing the retained selection is blocked');
  ui.input(scenario.kind, replaced);
  await ui.submit(scenario.kind, replaced);
  assert.equal(ui.commands.length, 1);
  assert.equal(ui.commands[0].command, scenario.command);
  assert.equal(ui.commands[0].expected_version, 1);
  assert.equal(ui.commands[0].payload[scenario.field], scenario.replacement || null);
  if (scenario.kind === 'receipt') {
    assert.equal(ui.commands[0].payload.evidence, scenario.values.evidence);
    assert.equal(ui.commands[0].payload.location, 'site');
    assert.equal(ui.commands[0].payload.usable_quantity, 2);
    assert.equal(ui.commands[0].payload.damaged_quantity, 1);
  }
});

test('stale order requirement stays selected through refresh and cannot be dropped by FormData', async () => {
  const ui = await workspace();
  Object.assign(ui.records.a, {
    source_version: 'source-1',
    requirements: [
      { id: 'req-a', description: 'First panels', quantity: 4, unit: 'each', reviewed_source_version: 'source-1' },
      { id: 'req-b', description: 'Remaining panels', quantity: 6, unit: 'each', reviewed_source_version: 'source-1' }
    ]
  });
  await ui.core.load('a');
  await ui.click('prepare-order');
  ui.input('order', { supplier_name: 'Exact supplier', delivery_address: 'Site', existing_supply_reviewed: true, requirement_ids: ['req-a', 'req-b'] });
  ui.records.a.requirements[0].reviewed_source_version = 'source-2';
  ui.records.a.version++;
  await ui.app.refresh();
  assert.match(ui.host.innerHTML, /value="req-a"[^>]*checked/);
  assert.match(ui.host.innerHTML, /value="req-a"[^>]*disabled/);
  assert.match(ui.host.innerHTML, /stale or unavailable/);
  ui.input('order', { supplier_name: 'Keep my edits', notes: 'unrelated field' });
  await ui.click('reconcile-editor', 'form');
  await ui.submit('order', { supplier_name: 'Keep my edits', delivery_address: 'Site', existing_supply_reviewed: true, requirement_ids: ['req-b'] });
  assert.equal(ui.commands.length, 0);
  assert.match(ui.host.innerHTML, /Resolve stale or unavailable requirement selections/);
  ui.records.a.requirements[0].reviewed_source_version = 'source-1';
  await ui.core.load('a');
  await ui.click('reconcile-editor', 'form');
  ui.input('order', { supplier_name: 'Exact supplier', delivery_address: 'Site', existing_supply_reviewed: true, requirement_ids: ['req-a', 'req-b'] });
  await ui.submit('order', { supplier_name: 'Exact supplier', delivery_address: 'Site', existing_supply_reviewed: true, requirement_ids: ['req-a', 'req-b'] });
  assert.equal(ui.commands.length, 1);
  assert.equal(ui.commands[0].command, 'order_prepare');
  assert.deepEqual(ui.commands[0].payload.requirement_ids, ['req-a', 'req-b']);
});

test('new custody forms require an explicit allocation or requirement choice', async () => {
  const ui = await workspace();
  ui.records.a.requirements = [{ id: 'ra', description: 'Panels', unit: 'each' }];
  ui.records.a.allocations = [{ id: 'aa', requirement_id: 'ra', quantity: 4, unit: 'each' }];
  ui.records.a.supply_lots = [{ id: 'sa', unit: 'each', quantity: 4 }];
  await ui.core.load('a');
  await ui.click('add-receipt');
  assert.match(ui.host.innerHTML, /<select name="allocation_id" required><option value="">Choose an allocation/);
  await ui.submit('receipt', { allocation_id: '', usable_quantity: '1', damaged_quantity: '0', location: 'yard', evidence: 'Docket' });
  assert.equal(ui.commands.length, 0);
  await ui.click('add-allocation');
  assert.match(ui.host.innerHTML, /<select name="requirement_id" required><option value="">Choose a requirement/);
  await ui.submit('allocation', { requirement_id: '', supply_id: 'sa', quantity: '1' });
  assert.equal(ui.commands.length, 0);
});

test('purchase destination defaults once and preserves an intentional blank through refresh and navigation', async () => {
  const ui = await workspace();
  ui.records.a.job.site_address = 'Original site';
  await ui.core.load('a');
  await ui.click('prepare-order');
  assert.match(ui.host.innerHTML, /name="delivery_address" value="Original site" required/);
  ui.records.a.job.site_address = 'Changed site';
  ui.records.a.version++;
  await ui.app.refresh();
  assert.match(ui.host.innerHTML, /name="delivery_address" value="Original site" required/);
  ui.input('order', { supplier_name: 'Exact supplier', delivery_address: '', notes: 'Keep my destination empty' });
  await ui.app.refresh();
  await ui.click('select', 'b');
  await ui.click('select', 'a');
  await ui.click('reconcile-editor', 'form');
  assert.match(ui.host.innerHTML, /name="delivery_address" value="" required/);
  assert.match(ui.host.innerHTML, /name="supplier_name" value="Exact supplier"/);
  assert.equal(ui.commands.length, 0);
});

test('saved order with an explicit empty destination never inherits the site address', async () => {
  const ui = await workspace();
  ui.records.a.job.site_address = 'Existing site';
  ui.records.a.order_drafts = [{ id: 'po-a', delivery_address: '', supplier_name: 'Saved supplier', line_items: [] }];
  await ui.core.load('a');
  await ui.click('edit-order', 'po-a');
  await ui.app.refresh();
  assert.match(ui.host.innerHTML, /name="delivery_address" value="" required/);
});
