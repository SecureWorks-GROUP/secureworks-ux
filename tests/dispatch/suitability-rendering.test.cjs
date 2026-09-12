const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace } = require('./workspace-harness.cjs');

async function suitabilityWorkspace() {
  const ui = await workspace();
  ui.records.a.requirements = [
    { id: 'requirement-current', description: 'Current fence panels', quantity: 4, unit: 'each' },
    { id: 'requirement-stale', description: 'Stale gate posts', quantity: 2, unit: 'each' },
    { id: 'requirement-unknown', description: 'Unclassified fixings', quantity: 10, unit: 'each' }
  ];
  ui.records.a.allocations = [
    {
      id: 'allocation-current',
      requirement_id: 'requirement-current',
      quantity: 4,
      unit: 'each',
      supply_id: 'stock:current-panels',
      suitability_status: 'current',
      supply_valid: true,
      current_supply_revision: 'supply-revision-1',
      supply_revision: 'supply-revision-1',
      requirement_revision: 'requirement-revision-1',
      suitability_confirmation: {
        reason: 'Panels match the signed scope',
        evidence: 'Photo and docket verified',
        requirement_revision: 'requirement-revision-1',
        supply_revision: 'supply-revision-1'
      }
    },
    {
      id: 'allocation-stale',
      requirement_id: 'requirement-stale',
      quantity: 2,
      unit: 'each',
      supply_id: 'stock:stale-posts',
      suitability_status: 'stale',
      supply_valid: true,
      current_supply_revision: 'supply-revision-2',
      supply_revision: 'supply-revision-1',
      suitability_obligation: {
        code: 'allocation_suitability',
        allocation_id: 'allocation-stale',
        requirement_id: 'requirement-stale',
        owner: 'Shaun',
        next_action: 'Confirm this supply suits the current material specification with evidence, or allocate replacement supply'
      }
    },
    {
      id: 'allocation-unknown',
      requirement_id: 'requirement-unknown',
      quantity: 10,
      unit: 'each',
      supply_id: 'stock:unknown-fixings'
    }
  ];
  await ui.core.load('a');
  return ui;
}

test('allocation suitability states render readable compatibility facts', async () => {
  const ui = await suitabilityWorkspace();
  assert.match(ui.host.innerHTML, /Current fence panels/);
  assert.match(ui.host.innerHTML, /Compatibility: current/);
  assert.match(ui.host.innerHTML, /Stale gate posts/);
  assert.match(ui.host.innerHTML, /Compatibility: stale/);
  assert.match(ui.host.innerHTML, /Owner: Shaun/);
  assert.match(ui.host.innerHTML, /Next action: Confirm this supply suits the current material specification with evidence, or allocate replacement supply/);
  assert.match(ui.host.innerHTML, /Unclassified fixings/);
  assert.match(ui.host.innerHTML, /Compatibility: unknown \/ unavailable/);
  assert.doesNotMatch(ui.host.innerHTML, /\[object Object\]/);
});

test('allocation without suitability obligation does not infer owner or next action', async () => {
  const ui = await workspace();
  ui.records.a.requirements = [{ id: 'requirement-unknown', description: 'Unclassified fixings', quantity: 10, unit: 'each' }];
  ui.records.a.allocations = [{ id: 'allocation-unknown', requirement_id: 'requirement-unknown', quantity: 10, unit: 'each', supply_id: 'stock:unknown-fixings' }];
  await ui.core.load('a');
  assert.match(ui.host.innerHTML, /Unclassified fixings/);
  assert.match(ui.host.innerHTML, /stock:unknown-fixings/);
  assert.match(ui.host.innerHTML, /Compatibility: unknown \/ unavailable/);
  assert.doesNotMatch(ui.host.innerHTML, /Owner:/);
  assert.doesNotMatch(ui.host.innerHTML, /Next action:/);
  assert.doesNotMatch(ui.host.innerHTML, /\[object Object\]/);
});

test('suitability review requires explicit evidence and sends the optimistic envelope', async () => {
  const ui = await suitabilityWorkspace();
  await ui.click('review-allocation', 'allocation-stale');
  assert.match(ui.host.innerHTML, /Review allocation compatibility/);
  await ui.submit('suitability', { reason: '', evidence: 'Docket and photo checked' });
  assert.equal(ui.commands.length, 0);
  assert.match(ui.host.innerHTML, /A reason and compatibility evidence are required/);
  await ui.submit('suitability', { reason: 'Post profile matches revised scope', evidence: 'Docket and photo checked' });
  const command = ui.commands.at(-1);
  assert.equal(command.command, 'allocation_confirm_suitability');
  assert.equal(command.job_id, 'a');
  assert.equal(command.expected_version, 0);
  assert.equal(command.source_version, 'source-1');
  assert.match(command.request_id, /^00000000-0000-4000-8000-\d{12}$/);
  assert.deepEqual(command.payload, {
    id: 'allocation-stale',
    reason: 'Post profile matches revised scope',
    evidence: 'Docket and photo checked'
  });
});
